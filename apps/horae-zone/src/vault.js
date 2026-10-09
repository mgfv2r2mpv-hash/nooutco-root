/**
 * A6, the vault id and the vault switch (plan §3.1 custody, §3.5 "Recovery
 * and vault switch", R-6).
 *
 *   /vault/switch {vault, ticket}  -> {ok: true}
 *   /vault/state  {vault}          -> {state}
 *
 * CUSTODY. Horae Zone holds each account's current vault id and the ids it
 * replaced (vault_tombstone), never a vault key, a wrap or vault data. A vault
 * id is 16 random bytes the device minted, base64url (22 characters).
 *
 * THE SWITCH records a new current vault id: the first one an account
 * records, a "Start a new vault", or the new vault after a recovery. It
 * tombstones the id it replaces and drops every bring in flight (the handoff
 * rows), in one batch. A tombstone is permanent, so an id once replaced is
 * never current again, for any account: switching to it answers vault-used,
 * as does another account's current id. The proof is the removal's (Kaleb's
 * 8 Oct 2026 ruling for /device/remove): a signed request from a device that
 * may change the account (ACCOUNT_CHANGER, checked first and again in every
 * write) and a fresh code, an unlock ticket of its own spent once. No ticket
 * answers code-needed, a wrong, expired, other device's or spent one
 * bad-ticket. A switch to the vault already current changes nothing, spends
 * no code and mails nobody, so a device whose answer was lost can ask again.
 * A switch that replaced a vault mails the account a fixed note
 * (VAULT_SWITCHED_NOTE) after the answer; without a mailer nothing is read
 * or spent (unavailable), so no switch goes unannounced.
 *
 * THE STATE is what a device asks at every launch, about the vault it holds:
 * a statement signed with HZ_TICKET_KEY over `${VAULT_STATE_LABEL}.${payload}`,
 * the payload base64url JSON {v, typ, account, device, vault, state, current,
 * at, exp, kid}. `state` is "current", "gone" (a tombstone of this account),
 * "unknown" (an id this account never recorded) or "none" (the device asked
 * with no vault). A device shreds its wrap only on a statement that verifies
 * with the pinned key, names its account and itself, and says "gone"; a
 * tombstone never lifts, so an old "gone" is still true. "unknown" is never
 * a reason to shred. The route is pendingOk and lockedOk: a device held back
 * by a recovery, or of an account the offline block locked, still learns at
 * its next launch that its vault is gone. The label and typ keep a state
 * from passing as an unlock ticket or a device list, and the reverse.
 */
import { Refusal, ACCOUNT_CHANGER, b64url, findDevice, mayChangeAccount } from "./checks.js";
import { hasOnly, keysOrUnavailable } from "./signup.js";
import { ticketKey } from "./unlock.js";
import { MAX_TICKET, readTicket, spendTicket } from "./pin.js";
import { mailAfter } from "./lockout.js";

export const VAULT_STATE_LABEL = "horae-zone-vault-state-v1";
export const VAULT_STATE_TYP = "horae-zone-vault-state";
export const VAULT_LIMITS = Object.freeze({
  // As the device list: short, so a switch reaches a device that keeps a
  // statement soon.
  stateTtlMs: 10 * 60 * 1000,
});
export const VAULT_ID = /^[A-Za-z0-9_-]{22}$/;

// A plain note on state; the wording is the owner's to change.
export const VAULT_SWITCHED_NOTE = Object.freeze({
  subject: "Horae Zone: a new vault was started",
  text: [
    "A device of this account started a new vault, with the account's code.",
    "Every device of this account deletes the old vault the next time it opens.",
    "What was in the old vault cannot be brought back.",
  ].join("\n"),
});

const enc = new TextEncoder();
// The new id is neither a tombstone nor another account's current vault;
// binds the id, the id, the account id.
const UNCLAIMED = "NOT EXISTS (SELECT 1 FROM vault_tombstone WHERE vault_id = ?) AND NOT EXISTS (SELECT 1 FROM vault WHERE vault_id = ? AND account_id <> ?)";
const isVaultId = (value) => typeof value === "string" && VAULT_ID.test(value);

// The account's current vault id, or null.
export async function currentVault(db, accountId) {
  const row = await db.prepare("SELECT vault_id FROM vault WHERE account_id = ?").bind(accountId).first();
  return row ? row.vault_id : null;
}

// Whether `vault` was ever recorded by any account and is not this account's
// current one: a tombstone anywhere, or another account's current vault.
async function usedElsewhere(db, accountId, vault) {
  const row = await db.prepare(
    "SELECT 1 AS used WHERE EXISTS (SELECT 1 FROM vault_tombstone WHERE vault_id = ?) OR EXISTS (SELECT 1 FROM vault WHERE vault_id = ? AND account_id <> ?)",
  ).bind(vault, vault, accountId).first();
  return Boolean(row);
}

function switchBody(body) {
  const hasTicket = Object.hasOwn(body, "ticket");
  if (!hasOnly(body, hasTicket ? ["vault", "ticket"] : ["vault"]) || !isVaultId(body.vault)) throw new Refusal("shape", 400);
  if (hasTicket && (typeof body.ticket !== "string" || body.ticket.length === 0 || body.ticket.length > MAX_TICKET)) {
    throw new Refusal("shape", 400);
  }
  return { vault: body.vault, ticket: hasTicket ? body.ticket : null };
}

async function standingOrRefuse(db, device) {
  if (await mayChangeAccount(db, device.id)) return;
  await findDevice(db, device.id); // refuses no-device when a removal is what stopped it
  throw new Refusal("not-owner", 403);
}

async function claimsOrRefuse(env, ticket, device, now) {
  if (ticket === null) throw new Refusal("code-needed", 401);
  const claims = await readTicket(env, ticket, device, now);
  if (!claims) throw new Refusal("bad-ticket", 401);
  return claims;
}

export async function switchVault({ db, device, body, now, env, mailer }) {
  const { vault, ticket } = switchBody(body);
  const keys = await keysOrUnavailable(env);
  if (!mailer) throw new Refusal("unavailable", 503);
  await standingOrRefuse(db, device);
  const before = await currentVault(db, device.account_id);
  const claims = await claimsOrRefuse(env, ticket, device, now);
  if (before === vault) return { status: 200, json: { ok: true } };
  if (await usedElsewhere(db, device.account_id, vault)) throw new Refusal("vault-used", 409);
  await spendTicket(db, device, claims); // a spent jti answers bad-ticket
  // One batch: the old id tombstoned, the brings in flight dropped, the new
  // id recorded, each only while the caller may still change the account and
  // the new id is still unclaimed (security review LOW-4: otherwise the old
  // id was tombstoned while it stayed current).
  await db.batch([
    db.prepare(`INSERT INTO vault_tombstone (vault_id, account_id, at) SELECT vault_id, account_id, ? FROM vault WHERE account_id = ? AND ${ACCOUNT_CHANGER}
      AND ${UNCLAIMED} ON CONFLICT (vault_id) DO NOTHING`).bind(now, device.account_id, device.id, vault, vault, device.account_id),
    db.prepare(`DELETE FROM handoff WHERE account_id = ? AND ${ACCOUNT_CHANGER} AND ${UNCLAIMED}`)
      .bind(device.account_id, device.id, vault, vault, device.account_id),
    db.prepare(`INSERT INTO vault (account_id, vault_id, set_at) SELECT ?, ?, ? WHERE ${ACCOUNT_CHANGER} AND ${UNCLAIMED}
      ON CONFLICT (account_id) DO UPDATE SET vault_id = excluded.vault_id, set_at = excluded.set_at`)
      .bind(device.account_id, vault, now, device.id, vault, vault, device.account_id),
  ]);
  if ((await currentVault(db, device.account_id)) !== vault) {
    await standingOrRefuse(db, device);
    throw new Refusal("vault-used", 409);
  }
  const after = before === null ? undefined : mailAfter({ db, keys, mailer, accountId: device.account_id, notes: [VAULT_SWITCHED_NOTE] });
  return { status: 200, json: { ok: true }, after };
}

// Gone: a tombstone of this account, or (security review MEDIUM-1) any id
// that is not current asked by a device registered before the account's last
// recovery, recorded or not, since R-6 shreds every vault from before it.
async function stateOf(db, device, vault) {
  const current = await currentVault(db, device.account_id);
  if (vault === null) return { state: "none", current };
  if (vault === current) return { state: "current", current };
  const gone = await db.prepare(
    `SELECT 1 AS gone WHERE EXISTS (SELECT 1 FROM vault_tombstone WHERE vault_id = ? AND account_id = ?)
     OR EXISTS (SELECT 1 FROM account_recovery AS r JOIN device AS d ON d.account_id = r.account_id
       WHERE r.account_id = ? AND d.id = ? AND d.created_at < r.at)`,
  ).bind(vault, device.account_id, device.account_id, device.id).first();
  return { state: gone ? "gone" : "unknown", current };
}

export async function vaultState({ db, device, body, now, env }) {
  if (!hasOnly(body, ["vault"]) || (body.vault !== null && !isVaultId(body.vault))) throw new Refusal("shape", 400);
  const signKey = await ticketKey(env);
  if (!signKey) throw new Refusal("unavailable", 503);
  const { state, current } = await stateOf(db, device, body.vault);
  const claims = {
    v: 1, typ: VAULT_STATE_TYP, account: device.account_id, device: device.id, vault: body.vault, state, current,
    at: now, exp: now + VAULT_LIMITS.stateTtlMs, kid: signKey.kid,
  };
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signKey.key, enc.encode(`${VAULT_STATE_LABEL}.${payload}`));
  return { status: 200, json: { state: `${payload}.${b64url(new Uint8Array(sig))}` } };
}
