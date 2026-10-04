/**
 * A4, devices (plan §3.3 "First device" step 3, "Each further device" step 2;
 * §3.5 "Lost device").
 *
 * POST /device/register {ticket, signKey, agreeKey} adds a device to the
 * account the /signin ticket was issued for, and answers {device}, its new
 * id. Both keys are P-256 public points (raw, base64url): signKey checks the
 * device's request signatures, agreeKey is what later slices seal to it. The
 * body and both keys are checked before the ticket is spent, so a malformed
 * key costs the device nothing. A ticket registers one device and is spent
 * in the same statement that checks it.
 *
 * POST /device/remove {device}, signed by a device of the same account,
 * stamps the device removed and spends its live nonces, so it is refused at
 * once, by every route. The answer is {ok:true} whatever the id names, so it
 * never says whether a device of another account exists. The row stays,
 * marked with when it was removed.
 */
import { Refusal, b64url, fromB64url } from "./checks.js";
import { hasOnly, keysOrUnavailable } from "./signup.js";

const TICKET = /^[A-Za-z0-9_-]{43}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEVICE_ID_BYTES = 16;
const POINT_BYTES = 65;

// True when `text` is a raw P-256 public point WebCrypto accepts for `name`
// (ECDSA or ECDH); an off-curve point is refused by importKey.
async function isPoint(text, name) {
  let bytes;
  try {
    bytes = fromB64url(text);
  } catch {
    return false; // a base64url length atob cannot decode
  }
  if (!bytes || bytes.length !== POINT_BYTES || bytes[0] !== 0x04) return false;
  try {
    await crypto.subtle.importKey("raw", bytes, { name, namedCurve: "P-256" }, false, name === "ECDSA" ? ["verify"] : []);
    return true;
  } catch {
    return false;
  }
}

export async function registerDevice({ db, body, now, env }) {
  if (!hasOnly(body, ["ticket", "signKey", "agreeKey"])) throw new Refusal("shape", 400);
  if (typeof body.ticket !== "string" || !TICKET.test(body.ticket)) throw new Refusal("shape", 400);
  if (!(await isPoint(body.signKey, "ECDSA")) || !(await isPoint(body.agreeKey, "ECDH"))) throw new Refusal("shape", 400);
  const keys = await keysOrUnavailable(env);
  const spent = await db.prepare("UPDATE ticket SET used = 1 WHERE digest = ? AND used = 0 AND expires_at > ? RETURNING account_id")
    .bind(await keys.ticketDigest(body.ticket), now).first();
  if (!spent) throw new Refusal("bad-ticket", 401);
  const id = b64url(crypto.getRandomValues(new Uint8Array(DEVICE_ID_BYTES)));
  await db.prepare("INSERT INTO device (id, account_id, sign_key, agree_key, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, spent.account_id, body.signKey, body.agreeKey, now).run();
  return { status: 200, json: { device: id } };
}

export async function removeDevice({ db, device, body, now }) {
  if (!hasOnly(body, ["device"])) throw new Refusal("shape", 400);
  if (typeof body.device !== "string" || !DEVICE_ID.test(body.device)) throw new Refusal("shape", 400);
  // Both statements match only a device of the caller's account; the nonces
  // go first, while the device is still live.
  await db.batch([
    db.prepare("UPDATE nonce SET used = 1 WHERE device_id = ? AND used = 0 AND EXISTS (SELECT 1 FROM device WHERE id = ? AND account_id = ?)")
      .bind(body.device, body.device, device.account_id),
    db.prepare("UPDATE device SET removed_at = ? WHERE id = ? AND account_id = ? AND removed_at IS NULL")
      .bind(now, body.device, device.account_id),
  ]);
  return { status: 200, json: { ok: true } };
}
