/**
 * A5, enrolling the one authenticator code (plan §3.1 custody, §3.3 "First
 * device" step 4, §3.6 /otp/enrol).
 *
 * POST /otp/enrol {ticket}, signed by a registered device and carrying a live
 * /signin ticket of the same account, answers {secret, uri} once: the base32
 * seed and its otpauth URI, for the QR. The ticket is spent first, and only
 * when it was issued to the signing device's account and bound to its own
 * keys (security review M3), so another account's ticket, or one named for
 * other keys, is refused and stays live. A second enrolment answers enrolled
 * and carries no seed. A removal of the device that lands mid-flight wins
 * (L2): the spend and the insert re-check it, and the answer is no-device.
 *
 * CUSTODY. The seed is 20 random bytes, stored only sealed: AES-GCM under a
 * key HKDF derives from the Worker secret HZ_SEED_KEY (base64url, at least
 * 32 bytes), with the account id as associated data, so a box moved to
 * another account does not open. No later answer, row, bound value, audit
 * row or log carries it. Without a usable seed key the route answers
 * unavailable before it spends the ticket or stores anything.
 *
 * SOLE DEVICE (A5 security review, item 1). Enrolment succeeds only for the
 * account's sole live device, checked in the ticket spend and again in the
 * seed insert, so a device registered in between still blocks it. A second
 * live device answers enrol-blocked (and a refused spend leaves the ticket
 * live). A password thief who registers a device of its own therefore cannot
 * enrol first, and until enrolment no device is pending, so either device can
 * remove the other. A device registered after enrolment starts pending
 * (src/devices.js): it reaches only /nonce and /unlock until a code it
 * proves is accepted.
 */
import { base32Encode, otpauthUri } from "../../../packages/account-engine/src/totp.mjs";
import { Refusal, LIVE_DEVICE, b64url, fromB64url, findDevice } from "./checks.js";
import { deviceKeyDigest } from "./devices.js";
import { hasOnly, keysOrUnavailable } from "./signup.js";

// The label the authenticator app shows. The wording is the owner's to change.
export const OTP_LABEL = Object.freeze({ issuer: "Horae Zone", account: "nooutco" });

const TICKET = /^[A-Za-z0-9_-]{43}$/;
const SEED_BYTES = 20;
const NONCE_BYTES = 12;
const MIN_SECRET_BYTES = 32;
const enc = new TextEncoder();

// A condition bound to an account id: the account has exactly one live
// device. Beside LIVE_DEVICE for the signing device, that device is it.
const SOLE_LIVE = "(SELECT COUNT(*) FROM device WHERE account_id = ? AND removed_at IS NULL) = 1";

async function isSoleLive(db, accountId) {
  return Boolean(await db.prepare(`SELECT 1 AS yes WHERE ${SOLE_LIVE}`).bind(accountId).first());
}

function readSecret(text) {
  try {
    return fromB64url(text);
  } catch {
    return null; // a base64url length atob cannot decode
  }
}

// The AES-GCM key for seed boxes, or null when HZ_SEED_KEY is missing or short.
export async function seedBoxKey(env) {
  const secret = readSecret(env?.HZ_SEED_KEY);
  if (!secret || secret.length < MIN_SECRET_BYTES) return null;
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  secret.fill(0);
  const params = { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode("horae-zone seed box v1") };
  return crypto.subtle.deriveKey(params, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function sealSeed(key, accountId, seed) {
  const iv = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(accountId) }, key, seed);
  const out = new Uint8Array(NONCE_BYTES + sealed.byteLength);
  out.set(iv);
  out.set(new Uint8Array(sealed), NONCE_BYTES);
  return b64url(out);
}

// Throws when the box was sealed under another key or for another account.
export async function openSeed(env, accountId, box) {
  const key = await seedBoxKey(env);
  if (!key) throw new Error("seed box: no seed key");
  const bytes = fromB64url(box);
  if (!bytes || bytes.length <= NONCE_BYTES) throw new Error("seed box: unexpected shape");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.subarray(0, NONCE_BYTES), additionalData: enc.encode(accountId) }, key, bytes.subarray(NONCE_BYTES),
  );
  return new Uint8Array(plain);
}

export async function enrolOtp({ db, device, body, now, env }) {
  if (!hasOnly(body, ["ticket"]) || typeof body.ticket !== "string" || !TICKET.test(body.ticket)) throw new Refusal("shape", 400);
  const boxKey = await seedBoxKey(env);
  if (!boxKey) throw new Refusal("unavailable", 503);
  const keys = await keysOrUnavailable(env);
  // The ticket must name the signing device's own keys (security review M3),
  // and the spend and the insert re-check the device is not removed (L2).
  const own = await db.prepare("SELECT sign_key, agree_key FROM device WHERE id = ? AND removed_at IS NULL").bind(device.id).first();
  if (!own) throw new Refusal("no-device", 401);
  // Both writes also require the device to be the account's sole live one
  // (A5 security review, item 1).
  const spent = await db.prepare(
    `UPDATE ticket SET used = 1 WHERE digest = ? AND account_id = ? AND key_digest = ? AND used = 0 AND expires_at > ? AND ${LIVE_DEVICE} AND ${SOLE_LIVE} RETURNING account_id`,
  ).bind(await keys.ticketDigest(body.ticket), device.account_id, await deviceKeyDigest(own.sign_key, own.agree_key), now, device.id, device.account_id).first();
  if (!spent) {
    await findDevice(db, device.id); // refuses no-device when the removal is what stopped it
    if (!(await isSoleLive(db, device.account_id))) throw new Refusal("enrol-blocked", 409);
    throw new Refusal("bad-ticket", 401);
  }
  const seed = crypto.getRandomValues(new Uint8Array(SEED_BYTES));
  const box = await sealSeed(boxKey, device.account_id, seed);
  const made = await db.prepare(
    `INSERT INTO otp (account_id, box, last_step, created_at) SELECT ?, ?, 0, ? WHERE ${LIVE_DEVICE} AND ${SOLE_LIVE} ON CONFLICT (account_id) DO NOTHING RETURNING account_id`,
  ).bind(device.account_id, box, now, device.id, device.account_id).first();
  if (!made) {
    seed.fill(0);
    await findDevice(db, device.id);
    const enrolled = await db.prepare("SELECT 1 AS yes FROM otp WHERE account_id = ?").bind(device.account_id).first();
    throw enrolled ? new Refusal("enrolled", 409) : new Refusal("enrol-blocked", 409);
  }
  const json = { secret: base32Encode(seed), uri: otpauthUri({ key: seed, ...OTP_LABEL }) };
  seed.fill(0);
  return { status: 200, json };
}
