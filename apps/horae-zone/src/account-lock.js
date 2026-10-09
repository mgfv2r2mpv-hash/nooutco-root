/**
 * A5b, the offline block (plan §3.4 "Offline wrong PINs").
 *
 *   /pin/blocked {}  -> 423 {error: "account-locked"}
 *
 * Offline, the app checks the PIN on the device, and 10 wrong in a row block
 * the app there until the service answers (client side, A8). The device then
 * signs this report, and the service locks the account: one account_lock row,
 * and every device route of the account answers account-locked (src/index.js,
 * after the device checks, so an unsigned request learns nothing) until an
 * administrator unlocks it. Time does not unlock it, and neither does a right
 * code, a right PIN or the code path's reopen link.
 *
 * A pending device cannot report (src/routes.js), so a password alone cannot
 * lock an account. The report takes no body: the service keeps no count.
 *
 * THE ADMIN HOOK. /admin/unlock-account (A5c, src/admin.js) calls
 * unlockAccount below.
 *
 * MAIL. The account's address gets one plain note when the account locks,
 * at most one an hour per account (counted in the throttle table). A report
 * on an account already locked sends none. The note names no count, date or
 * duration.
 */
import { LIVE_DEVICE, Refusal, findDevice } from "./checks.js";
import { accountKeys } from "./account-keys.js";
import { hasOnly } from "./signup.js";
import { admitThrottle } from "./throttle.js";
import { mailAfter } from "./lockout.js";

const HOUR_MS = 60 * 60 * 1000;
export const LOCK_NOTES_PER_HOUR = 1;

const LOCKED = { status: 423, json: { error: "account-locked" } };

// Whether the account is locked by the offline block.
export async function accountLocked(db, accountId) {
  return Boolean(await db.prepare("SELECT 1 AS locked FROM account_lock WHERE account_id = ?").bind(accountId).first());
}

// A5c's hook: unlocks the account, and answers whether it was locked.
export async function unlockAccount(db, accountId) {
  return Boolean(await db.prepare("DELETE FROM account_lock WHERE account_id = ? RETURNING account_id").bind(accountId).first());
}

export function lockedNote() {
  return {
    subject: "Horae Zone: account locked",
    text: [
      "The app blocked itself on one of this account's devices after wrong PINs were entered while it could not reach the service.",
      "The account is now locked on every device.",
      "It stays locked until an administrator unlocks it.",
    ].join("\n"),
  };
}

// POST /pin/blocked: the device's report of the offline block. The lock is
// written only while the reporting device is live.
export async function reportBlock({ db, device, body, now, env, mailer }) {
  if (!hasOnly(body, [])) throw new Refusal("shape", 400);
  const locked = await db.prepare(
    `INSERT INTO account_lock (account_id, locked_at) SELECT ?, ? WHERE ${LIVE_DEVICE}
     ON CONFLICT (account_id) DO NOTHING RETURNING account_id`,
  ).bind(device.account_id, now, device.id).first();
  if (!locked) {
    await findDevice(db, device.id); // refuses no-device when the removal is what stopped it
    return LOCKED;
  }
  const due = await admitThrottle(db, now, HOUR_MS, [{ bucket: `pin-block-alert:${device.account_id}`, limit: LOCK_NOTES_PER_HOUR }]);
  if (!due) return LOCKED;
  const keys = await accountKeys(env);
  return { ...LOCKED, after: mailAfter({ db, keys, mailer, accountId: device.account_id, notes: [lockedNote()] }) };
}
