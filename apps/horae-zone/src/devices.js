/**
 * A4, devices (plan §3.3 "First device" step 3, "Each further device" step 2;
 * §3.5 "Lost device").
 *
 * POST /device/register {ticket, signKey, agreeKey} adds a device to the
 * account the /signin ticket was issued for, and answers {device}, its new
 * id. Both keys are P-256 public points (raw, base64url): signKey checks the
 * device's request signatures, agreeKey is what later slices seal to it. The
 * body and both keys are checked before the ticket is spent, so a malformed
 * key costs the device nothing. A ticket registers one device, only the keys
 * whose digest /signin bound it to (security review M3), and is spent in the
 * same statement that checks both. Other keys answer bad-ticket and leave the
 * ticket unspent, so a ticket seen in flight neither adds a stranger's device
 * nor uses up the owner's.
 * A5 re-review, root rule: ownership comes from the email inbox, not the
 * password. A ticket the sign-up link's verify handed out (src/signup.js)
 * registers the account's first device as its owner device, not pending,
 * and only while the account has no device. Every other device starts
 * pending, whether or not a code is enrolled or confirmed, and reaches only
 * /nonce and /unlock until a code it proves is accepted (src/unlock.js).
 *
 * POST /device/remove {device}, signed by a device of the same account,
 * stamps the device removed and spends its live nonces, so it is refused at
 * once, by every route. The answer is {ok:true} whatever the id names, so it
 * never says whether a device of another account exists. The row stays,
 * marked with when it was removed.
 */
import { Refusal, LIVE_DEVICE, b64url, fromB64url } from "./checks.js";
import { hasOnly, keysOrUnavailable, KEY_DIGEST } from "./signup.js";

export { KEY_DIGEST };

const TICKET = /^[A-Za-z0-9_-]{43}$/;
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const DEVICE_ID_BYTES = 16;
const POINT_BYTES = 65;

// The digest /signin binds a ticket to: SHA-256 of the raw sign point then the
// raw agree point (65 bytes each, so the join is unambiguous), base64url. A
// device computes it over the keys it is about to register.
export async function deviceKeyDigest(signKey, agreeKey) {
  const sign = fromB64url(signKey);
  const agree = fromB64url(agreeKey);
  const both = new Uint8Array(sign.length + agree.length);
  both.set(sign);
  both.set(agree, sign.length);
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", both)));
}

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
  // An owner ticket is spent only while its account has no device, removed
  // ones included, so it never makes a second owner.
  const spent = await db.prepare(
    `UPDATE ticket SET used = 1 WHERE digest = ? AND key_digest = ? AND used = 0 AND expires_at > ?
     AND (owner = 0 OR NOT EXISTS (SELECT 1 FROM device WHERE device.account_id = ticket.account_id)) RETURNING account_id, owner`,
  ).bind(await keys.ticketDigest(body.ticket), await deviceKeyDigest(body.signKey, body.agreeKey), now).first();
  if (!spent) throw new Refusal("bad-ticket", 401);
  const id = b64url(crypto.getRandomValues(new Uint8Array(DEVICE_ID_BYTES)));
  const owner = spent.owner === 1 ? 1 : 0;
  await db.prepare("INSERT INTO device (id, account_id, sign_key, agree_key, created_at, pending, owner) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, spent.account_id, body.signKey, body.agreeKey, now, 1 - owner, owner).run();
  return { status: 200, json: { device: id } };
}

export async function removeDevice({ db, device, body, now }) {
  if (!hasOnly(body, ["device"])) throw new Refusal("shape", 400);
  if (typeof body.device !== "string" || !DEVICE_ID.test(body.device)) throw new Refusal("shape", 400);
  // Both statements match only a device of the caller's account, and only
  // while the caller is not removed (security review L2), so a removal of the
  // caller that lands mid-flight wins and this one changes nothing. The
  // nonces go first, while the device is still live.
  await db.batch([
    db.prepare(`UPDATE nonce SET used = 1 WHERE device_id = ? AND used = 0 AND EXISTS (SELECT 1 FROM device WHERE id = ? AND account_id = ?) AND ${LIVE_DEVICE}`)
      .bind(body.device, body.device, device.account_id, device.id),
    db.prepare(`UPDATE device SET removed_at = ? WHERE id = ? AND account_id = ? AND removed_at IS NULL AND ${LIVE_DEVICE}`)
      .bind(now, body.device, device.account_id, device.id),
  ]);
  return { status: 200, json: { ok: true } };
}
