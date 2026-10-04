/**
 * A5, enrolling the one authenticator code (plan §3.1 custody, §3.3 "First
 * device" step 4, §3.6 /otp/enrol).
 *
 * POST /otp/enrol {ticket}, signed by a registered device and carrying a live
 * /signin ticket of the same account, answers {secret, uri} once: the base32
 * seed and its otpauth URI, for the QR. The ticket is spent first, and only
 * when it was issued to the signing device's account, so another account's
 * ticket is refused and stays live. A second enrolment answers enrolled and
 * carries no seed.
 *
 * CUSTODY. The seed is 20 random bytes, stored only sealed: AES-GCM under a
 * key HKDF derives from the Worker secret HZ_SEED_KEY (base64url, at least
 * 32 bytes), with the account id as associated data, so a box moved to
 * another account does not open. No later answer, row, bound value, audit
 * row or log carries it. Without a usable seed key the route answers
 * unavailable before it spends the ticket or stores anything.
 *
 * Every other live device of the account is marked pending at enrolment, and
 * a device registered later starts pending (src/devices.js): a pending device
 * reaches only /nonce and /unlock until a code it proves is accepted.
 */
import { base32Encode, otpauthUri } from "../../../packages/account-engine/src/totp.mjs";
import { Refusal, b64url, fromB64url } from "./checks.js";
import { hasOnly, keysOrUnavailable } from "./signup.js";

// The label the authenticator app shows. The wording is the owner's to change.
export const OTP_LABEL = Object.freeze({ issuer: "Horae Zone", account: "nooutco" });

const TICKET = /^[A-Za-z0-9_-]{43}$/;
const SEED_BYTES = 20;
const NONCE_BYTES = 12;
const MIN_SECRET_BYTES = 32;
const enc = new TextEncoder();

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
  const spent = await db.prepare(
    "UPDATE ticket SET used = 1 WHERE digest = ? AND account_id = ? AND used = 0 AND expires_at > ? RETURNING account_id",
  ).bind(await keys.ticketDigest(body.ticket), device.account_id, now).first();
  if (!spent) throw new Refusal("bad-ticket", 401);
  const seed = crypto.getRandomValues(new Uint8Array(SEED_BYTES));
  const box = await sealSeed(boxKey, device.account_id, seed);
  const made = await db.prepare(
    "INSERT INTO otp (account_id, box, last_step, created_at) VALUES (?, ?, 0, ?) ON CONFLICT (account_id) DO NOTHING RETURNING account_id",
  ).bind(device.account_id, box, now).first();
  if (!made) throw new Refusal("enrolled", 409);
  await db.prepare("UPDATE device SET pending = 1 WHERE account_id = ? AND id != ? AND removed_at IS NULL")
    .bind(device.account_id, device.id).run();
  const json = { secret: base32Encode(seed), uri: otpauthUri({ key: seed, ...OTP_LABEL }) };
  seed.fill(0);
  return { status: 200, json };
}
