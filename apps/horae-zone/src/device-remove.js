/**
 * A4, removing a device (plan §3.5 "Lost device"), with the proof Kaleb
 * ruled on 8 Oct 2026 (A4 Decision for Kaleb 5): "A fresh code plus a
 * notice mail, no delay."
 *
 *   /device/remove {device, ticket}   -> {ok: true}
 *
 * WHO. A device signed by the account's own key, that may change the account
 * (A5 re-review, item 2): a pending device never reaches the route, and until
 * the first accepted code confirms the enrolment only the owner device may;
 * any other device answers not-owner. A device can remove itself.
 *
 * THE FRESH CODE is an unlock ticket from /unlock/finish, the same one-time
 * factor /pin/set, /pin/verify and /pin/reset take: read by src/pin.js
 * readTicket (the service's key, this device and account, at most
 * UNLOCK_LIMITS.ticketTtlMs old) and spent once by spendTicket, whose jti row
 * also refuses a ticket an open or a reset already spent. No ticket answers
 * code-needed; a wrong, expired, other device's or spent one answers
 * bad-ticket. The ticket is spent before the removal, so of two removals
 * sent with one ticket only one removes. Like any accepted ticket its spend
 * moves this device's proved_at (schema.sql spent_ticket_proves).
 *
 * AT ONCE. The removal is one batch that spends the device's live nonces and
 * stamps removed_at, both only for a device of the caller's account and only
 * while the caller may still change it (security review L2), so the removed
 * device is refused by its very next request. There is no delay and no undo
 * window. The answer is {ok:true} whatever the id names, so it never says
 * whether a device of another account exists. The row stays.
 *
 * THE NOTICE. Once a device was in fact removed, REMOVED_NOTE goes to the
 * account's address after the answer (src/lockout.js mailAfter), with no
 * number, no link and nothing the request carried. Without a mailer or the
 * account keys that open the address, nothing is read or spent and the
 * answer is unavailable, so no removal goes unannounced. A send that fails
 * after the removal is audited mail-failed; the removal stands.
 */
import { Refusal, ACCOUNT_CHANGER, findDevice, mayChangeAccount } from "./checks.js";
import { hasOnly, keysOrUnavailable } from "./signup.js";
import { mailAfter } from "./lockout.js";
import { MAX_TICKET, readTicket, spendTicket } from "./pin.js";

const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

// A plain note on state; the wording is the owner's to change.
export const REMOVED_NOTE = Object.freeze({
  subject: "Horae Zone: a device was removed",
  text: [
    "A device was removed from this account, from one of its devices, with the account's code.",
    "The removed device can no longer reach the account.",
  ].join("\n"),
});

// The body's target and ticket, shape-checked; a missing ticket is left for
// code-needed, after the caller's standing.
function removeBody(body) {
  const hasTicket = Object.hasOwn(body, "ticket");
  if (!hasOnly(body, hasTicket ? ["device", "ticket"] : ["device"])) throw new Refusal("shape", 400);
  if (typeof body.device !== "string" || !DEVICE_ID.test(body.device)) throw new Refusal("shape", 400);
  if (hasTicket && (typeof body.ticket !== "string" || body.ticket.length === 0 || body.ticket.length > MAX_TICKET)) {
    throw new Refusal("shape", 400);
  }
  return { target: body.device, ticket: hasTicket ? body.ticket : null };
}

async function standingOrRefuse(db, device) {
  if (await mayChangeAccount(db, device.id)) return;
  await findDevice(db, device.id); // refuses no-device when a removal is what stopped it
  throw new Refusal("not-owner", 403);
}

async function freshCodeOrRefuse(db, env, ticket, device, now) {
  if (ticket === null) throw new Refusal("code-needed", 401);
  const claims = await readTicket(env, ticket, device, now);
  if (!claims) throw new Refusal("bad-ticket", 401);
  await spendTicket(db, device, claims); // a spent jti answers bad-ticket
}

export async function removeDevice({ db, device, body, now, env, mailer }) {
  const { target, ticket } = removeBody(body);
  const keys = await keysOrUnavailable(env);
  if (!mailer) throw new Refusal("unavailable", 503);
  await standingOrRefuse(db, device);
  await freshCodeOrRefuse(db, env, ticket, device, now);
  // The nonces go first, while the device is still live.
  await db.batch([
    db.prepare(`UPDATE nonce SET used = 1 WHERE device_id = ? AND used = 0 AND EXISTS (SELECT 1 FROM device WHERE id = ? AND account_id = ?) AND ${ACCOUNT_CHANGER}`)
      .bind(target, target, device.account_id, device.id),
    db.prepare(`UPDATE device SET removed_at = ? WHERE id = ? AND account_id = ? AND removed_at IS NULL AND ${ACCOUNT_CHANGER}`)
      .bind(now, target, device.account_id, device.id),
  ]);
  const removed = await db.prepare("SELECT 1 AS yes FROM device WHERE id = ? AND account_id = ? AND removed_at = ?")
    .bind(target, device.account_id, now).first();
  const after = removed ? mailAfter({ db, keys, mailer, accountId: device.account_id, notes: [REMOVED_NOTE] }) : undefined;
  return { status: 200, json: { ok: true }, after };
}
