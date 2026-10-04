/**
 * A5b, the membership check (plan §3.3 "Offline and revocation", §3.6).
 *
 *   /reverify {}  -> {ok: true}                     still a member
 *                 |  429 {error: "slow-down"}       sooner than REVERIFY_LIMITS.everyMs after this device's last
 *
 * The app retries the service at most every 5 minutes and re-verifies
 * membership when it answers. A cut is answered before the gate, by the
 * checks every device route passes (src/index.js): a removed device answers
 * no-device, an account the offline block locked answers account-locked. So
 * the app locks at its next check, and never reads a slow-down where it
 * should lock. A pending device is no member yet and answers no-device.
 *
 * The check never extends the 12 hours: it answers no grant and leaves
 * device_check alone, so the code is still asked 12 hours after the last one.
 *
 * One write records the check, only while the device is live, the account is
 * not locked and the device's last answered check is at least everyMs old,
 * so a cut that lands mid-flight still wins and a refused check moves
 * nothing. The row holds which device checked and when, for the admin
 * screen's reverification (A5c), and nothing the request carried.
 */
import { LIVE_DEVICE, Refusal, findDevice } from "./checks.js";
import { hasOnly } from "./signup.js";

export const REVERIFY_LIMITS = Object.freeze({ everyMs: 5 * 60_000 });

const MEMBER = { status: 200, json: { ok: true } };

export async function reverify({ db, device, body, now }) {
  if (!hasOnly(body, [])) throw new Refusal("shape", 400);
  const checked = await db.prepare(
    `INSERT INTO reverify (device_id, account_id, at)
     SELECT ?, ?, ? WHERE ${LIVE_DEVICE} AND NOT EXISTS (SELECT 1 FROM account_lock WHERE account_id = ?)
     ON CONFLICT (device_id) DO UPDATE SET at = excluded.at WHERE reverify.at + ? <= excluded.at
     RETURNING device_id`,
  ).bind(device.id, device.account_id, now, device.id, device.account_id, REVERIFY_LIMITS.everyMs).first();
  if (checked) return MEMBER;
  await findDevice(db, device.id); // refuses no-device when a removal is what stopped it
  if (await db.prepare("SELECT 1 AS locked FROM account_lock WHERE account_id = ?").bind(device.account_id).first()) {
    throw new Refusal("account-locked", 423);
  }
  throw new Refusal("slow-down", 429);
}
