/**
 * A6, "Bring my vault" (plan §3.3 "Each further device" step 4, §3.6
 * /pair/offer and /pair/take): pairing v2 envelopes between two confirmed
 * devices of one account, carried by the handoff table.
 *
 *   /pair/take  {}                                   -> {offer: null}, or
 *                                                       {offer: {from, fromKey, vault, envelope}}
 *   /pair/offer {to, vault, envelope, pin, ticket?}  -> {ok: true}
 *
 * THE ASK. The new device, signed in, registered and past its first code (a
 * pending device never reaches these routes), sends /pair/take. With nothing
 * waiting, its answer is {offer: null} and the service records an ask, bound
 * to the account's current vault id, live HANDOFF_LIMITS.ttlMs. With no vault
 * recorded the answer is no-vault: there is nothing to bring.
 *
 * THE APPROVAL. A device holding the vault sends /pair/offer: Face ID (its
 * signature) and the app PIN (plan: "asks for Face ID + PIN to approve"),
 * compared in the PIN lockout as every PIN is (src/pin.js checkedPin), with
 * the code under the same 12-hour rule as every open (codeOrRefuse; a ticket
 * it carries is spent once). It names the asking device and the vault it
 * holds, and carries the envelope: the vault key sealed on the device to the
 * asker's registered agreement key. The service never opens it and keeps it
 * only until it is taken or dies. The offer lands only on a live ask from a
 * confirmed, live device of the caller's own account, never itself, for the
 * vault current now (no-ask, vault-gone otherwise), all re-checked in the one
 * write. The account is mailed a fixed note (BROUGHT_NOTE).
 *
 * THE TAKE. The asker's next /pair/take hands the envelope out and deletes the
 * row in one statement, only while the vault it was sealed for is still
 * current and the approving device is still live and confirmed, so a switch,
 * a recovery or a removal that lands after the offer leaves nothing to take.
 * The answer names the approving device and its registered agreement key, so
 * the asker can open the envelope (static-static, as the shared door's
 * `adopt`) and show the check word. The check word is the devices' own (plan
 * A8: computed on each screen from the keys each one used), so a service that
 * swapped a key shows two different words.
 */
import { Refusal, LIVE_DEVICE, findDevice } from "./checks.js";
import { hasOnly, keysOrUnavailable } from "./signup.js";
import { MAX_TICKET, PIN, checkedPin, codeOrRefuse, mailOrUnavailable, spendTicket, withAfter } from "./pin.js";
import { mailAfter } from "./lockout.js";
import { currentVault, VAULT_ID } from "./vault.js";

export const HANDOFF_LIMITS = Object.freeze({
  ttlMs: 10 * 60 * 1000,
  maxEnvelope: 4096,
});

// A plain note on state; the wording is the owner's to change.
export const BROUGHT_NOTE = Object.freeze({
  subject: "Horae Zone: vault sent to another device",
  text: [
    "A device of this account approved sending its vault to another device of this account, with the app PIN.",
    "Only that device can open what was sent.",
  ].join("\n"),
});

const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ENVELOPE = /^[A-Za-z0-9_-]+$/;
// A confirmed, live device; binds a device id and an account id.
const CONFIRMED = "EXISTS (SELECT 1 FROM device WHERE id = ? AND account_id = ? AND removed_at IS NULL AND pending = 0)";

function offerBody(body) {
  const hasTicket = Object.hasOwn(body, "ticket");
  const keys = ["to", "vault", "envelope", "pin", ...(hasTicket ? ["ticket"] : [])];
  if (!hasOnly(body, keys)) throw new Refusal("shape", 400);
  const { to, vault, envelope, pin } = body;
  if (typeof to !== "string" || !DEVICE_ID.test(to) || typeof vault !== "string" || !VAULT_ID.test(vault)) throw new Refusal("shape", 400);
  if (typeof envelope !== "string" || envelope.length > HANDOFF_LIMITS.maxEnvelope || !ENVELOPE.test(envelope)) throw new Refusal("shape", 400);
  if (typeof pin !== "string" || !PIN.test(pin)) throw new Refusal("shape", 400);
  if (hasTicket && (typeof body.ticket !== "string" || body.ticket.length === 0 || body.ticket.length > MAX_TICKET)) throw new Refusal("shape", 400);
  return { to, vault, envelope, pin, ticket: hasTicket ? body.ticket : null };
}

// The live ask of `to`, in the caller's account, for the current vault.
async function askOf(db, device, to, now) {
  return db.prepare(
    `SELECT 1 AS asked FROM handoff WHERE device_id = ? AND account_id = ? AND envelope IS NULL AND expires_at > ?
     AND vault_id = (SELECT vault_id FROM vault WHERE account_id = ?) AND ${CONFIRMED}`,
  ).bind(to, device.account_id, now, device.account_id, to, device.account_id).first();
}

export async function offerVault({ db, device, body, now, env, mailer }) {
  const { to, vault, envelope, pin, ticket } = offerBody(body);
  if (to === device.id) throw new Refusal("shape", 400);
  const keys = await keysOrUnavailable(env);
  const reopenBase = mailOrUnavailable(env, mailer);
  if ((await currentVault(db, device.account_id)) !== vault) throw new Refusal("vault-gone", 409);
  if (!(await askOf(db, device, to, now))) throw new Refusal("no-ask", 409);
  const row = await db.prepare("SELECT verifier, salt FROM pin WHERE account_id = ?").bind(device.account_id).first();
  if (!row) throw new Refusal("no-pin", 409);
  const claims = await codeOrRefuse(db, env, ticket, device, now);
  const after = await checkedPin({ db, device, now, keys, mailer, reopenBase }, pin, row);
  return withAfter(after, () => putUp({ db, device, now, keys, mailer, claims, to, vault, envelope, after }));
}

// The offer's write, once the PIN was right: the envelope lands on the ask
// only while every condition still holds, in the one statement.
async function putUp({ db, device, now, keys, mailer, claims, to, vault, envelope, after }) {
  if (claims) await spendTicket(db, device, claims);
  const placed = await db.prepare(
    `UPDATE handoff SET envelope = ?, from_device = ?, expires_at = ?
     WHERE device_id = ? AND account_id = ? AND envelope IS NULL AND expires_at > ? AND vault_id = ?
     AND vault_id = (SELECT vault_id FROM vault WHERE account_id = ?) AND ${CONFIRMED} AND ${CONFIRMED} RETURNING device_id`,
  ).bind(
    envelope, device.id, now + HANDOFF_LIMITS.ttlMs,
    to, device.account_id, now, vault, device.account_id, to, device.account_id, device.id, device.account_id,
  ).first();
  if (!placed) {
    await findDevice(db, device.id); // refuses no-device when the removal is what stopped it
    throw new Refusal("no-ask", 409);
  }
  const notice = mailAfter({ db, keys, mailer, accountId: device.account_id, notes: [BROUGHT_NOTE] });
  return { status: 200, json: { ok: true }, after: both(after, notice) };
}

// Runs two after-works in turn and audits every failure each names.
function both(first, second) {
  if (!first) return second;
  if (!second) return first;
  return async () => [await first(), await second()].flat().filter(Boolean);
}

export async function takeVault({ db, device, body, now }) {
  if (!hasOnly(body, [])) throw new Refusal("shape", 400);
  const vault = await currentVault(db, device.account_id);
  if (vault === null) throw new Refusal("no-vault", 409);
  const taken = await db.prepare(
    `DELETE FROM handoff WHERE device_id = ? AND account_id = ? AND envelope IS NOT NULL AND expires_at > ? AND vault_id = ?
     AND EXISTS (SELECT 1 FROM device WHERE id = handoff.from_device AND account_id = handoff.account_id AND removed_at IS NULL AND pending = 0)
     AND ${CONFIRMED} RETURNING from_device, vault_id, envelope`,
  ).bind(device.id, device.account_id, now, vault, device.id, device.account_id).first();
  if (taken) {
    const from = await db.prepare("SELECT agree_key FROM device WHERE id = ?").bind(taken.from_device).first();
    return { status: 200, json: { offer: { from: taken.from_device, fromKey: from.agree_key, vault: taken.vault_id, envelope: taken.envelope } } };
  }
  // Nothing to hand out: (re)record this device's ask for the current vault.
  // An envelope that can no longer be taken (for a vault no longer current,
  // from a device since removed or held back, or past its life) is dropped;
  // one that landed after the take above looked stays for the next take.
  const asked = await db.prepare(
    `INSERT INTO handoff (device_id, account_id, vault_id, from_device, envelope, expires_at) SELECT ?, ?, ?, NULL, NULL, ? WHERE ${LIVE_DEVICE}
     ON CONFLICT (device_id) DO UPDATE SET account_id = excluded.account_id, vault_id = excluded.vault_id, from_device = NULL, envelope = NULL,
     expires_at = excluded.expires_at
     WHERE handoff.envelope IS NULL OR handoff.expires_at <= ? OR handoff.vault_id <> excluded.vault_id
     OR NOT EXISTS (SELECT 1 FROM device WHERE id = handoff.from_device AND removed_at IS NULL AND pending = 0) RETURNING device_id`,
  ).bind(device.id, device.account_id, vault, now + HANDOFF_LIMITS.ttlMs, device.id, now).first();
  if (!asked) await findDevice(db, device.id);
  return { status: 200, json: { offer: null } };
}
