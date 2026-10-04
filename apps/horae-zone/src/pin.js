/**
 * A5b, the app PIN, server side (plan §3.3 "Every app open", §3.4, §3.6
 * /pin/*). One PIN per account, the same on every device.
 *
 *   /pin/set    {pin, ticket}            -> {ok: true, grant}   the account's first PIN
 *   /pin/set    {pin, current, ticket?}  -> {ok: true, grant}   a change
 *   /pin/verify {pin, ticket?}           -> {ok: true, grant}   every app open
 *
 * EVERY OPEN. A signed request (Face ID releases the device's signing key)
 * carrying the PIN, every time; a ticket alone never opens. The code is
 * asked too, as an unlock ticket from /unlock/finish, only when the last code
 * this device had accepted and then used to open is PIN_LIMITS.codeEveryMs
 * old or more, or when it never used one. That time is the `at` of the last
 * ticket an open of this device spent (device_check.proved_at), so another
 * device's code never spares this one. A missing code answers code-needed
 * before the PIN is compared, so a PIN guess there learns nothing.
 *
 * THE TICKET VERIFIER (A5 security review item 4). The kid in the payload
 * picks the public key from ticketRing (src/unlock.js), and a kid it does not
 * hold is refused before any signature check; no key is ever taken from the
 * ticket. The ticket must name the signing device and its account, and be
 * unexpired. Its jti is spent once, in the write that accepts it (the
 * spent_ticket insert, whose trigger moves proved_at), and only after the PIN
 * was right, so a mistyped PIN does not cost the code. Every refusal of a
 * ticket is bad-ticket.
 *
 * OFFLINE (§3.3 "Offline and revocation"). Every accepted open hands the
 * device a grant: {v, kid, account, device, until} signed with HZ_TICKET_KEY
 * over `${GRANT_LABEL}.${payload}`, so it can never pass as a ticket. `until`
 * is the device's proved_at plus PIN_LIMITS.codeEveryMs, the moment this
 * service starts answering code-needed, so an open without the code never
 * extends it. While the service cannot be reached, the app checks the PIN on
 * the device and opens only before `until`. The grant is opaque to the user:
 * no screen shows it or anything read from it.
 *
 * WRONG PINS ONLINE (§3.4 "Online wrong PINs") run JanusMirror's lockout,
 * in its own state (src/pin-lockout.js): every comparison of a PIN, an
 * open's or a change's current one, is admitted into the account's PIN
 * lockout first and settled right or wrong after, so a closed window or a
 * closed PIN entry answers locked before any PIN is compared. A code-needed
 * or bad-ticket answer comes before the lockout, since no PIN was compared.
 * The lockout's mail needs the mailer and HZ_REOPEN_BASE, so without them a
 * PIN is never compared (unavailable).
 *
 * CUSTODY. The PIN is never stored, bound, logged or echoed: the service keeps
 * only its verifier (src/account-keys.js pinVerifier, PBKDF2 then HMAC under
 * a pepper HKDF derives from HZ_ACCOUNT_KEY) over a random per-account salt.
 *
 * THE FIRST PIN takes a fresh code (a ticket), and only from a device that may
 * change the account (ACCOUNT_CHANGER, checked in the write: before the first
 * accepted code, the owner device). A pending device never reaches these
 * routes (src/routes.js). The PIN rules (the engine's createPinRules, fed the
 * private blocklist) are injected; without them a PIN cannot be set.
 *
 * A CHANGE (§3.4 "Reuse lock") is an open that also names the new PIN: the
 * current PIN, and the code under the same 12-hour rule as an open, from a
 * device that may change the account. The account keeps its salt, so the new
 * PIN's verifier is compared with the current one and every live pin_lock row
 * by one slow hash; a match answers pin-reused with PIN_LOCKED, the one
 * sentence the plan allows, and nothing about which PIN or until when. The
 * write that replaces the verifier is what locks the old PIN for 365 days
 * (the pin_replaced_locks trigger, schema.sql), so a reset or the annual
 * review's change locks it the same way. The change restarts set_at.
 */
import { sameHex, DAY_MS } from "../../../packages/account-engine/src/limits.mjs";
import { PIN_LOCKED } from "../../../packages/account-engine/src/pin.mjs";
import { Refusal, ACCOUNT_CHANGER, LIVE_DEVICE, b64url, fromB64url, findDevice, mayChangeAccount } from "./checks.js";
import { newSalt } from "./account-keys.js";
import { hasOnly, keysOrUnavailable } from "./signup.js";
import { TICKET_LABEL, ticketKey, ticketRing, reopenBaseOk } from "./unlock.js";
import { admitPinTry, settlePinTry } from "./pin-lockout.js";

const HOUR_MS = 60 * 60 * 1000;

export const PIN_LIMITS = Object.freeze({
  codeEveryMs: 12 * HOUR_MS,
  // schema.sql's pin_replaced_locks trigger writes this number as a literal;
  // test/pin-reuse.test.mjs holds the two equal.
  reuseLockMs: 365 * DAY_MS,
});

export const GRANT_LABEL = "horae-zone-offline-grant-v1";

const PIN = /^[0-9]{6}$/;
const JTI = /^[A-Za-z0-9_-]{22}$/;
const MAX_TICKET = 1024;
const SIG_BYTES = 64;
const enc = new TextEncoder();

// The body's PIN and ticket, shape-checked; `ticket` is optional only where
// the route allows it.
function pinBody(body, { ticketRequired }) {
  const hasTicket = Object.hasOwn(body, "ticket");
  if (!hasOnly(body, hasTicket ? ["pin", "ticket"] : ["pin"]) || typeof body.pin !== "string") throw new Refusal("shape", 400);
  if ((ticketRequired && !hasTicket) || (hasTicket && (typeof body.ticket !== "string" || body.ticket.length > MAX_TICKET))) {
    throw new Refusal("shape", 400);
  }
  return { pin: body.pin, ticket: hasTicket ? body.ticket : null };
}

function claimsOf(payload) {
  try {
    const claims = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromB64url(payload)));
    return claims !== null && typeof claims === "object" && !Array.isArray(claims) ? claims : null;
  } catch {
    return null;
  }
}

// The ticket's claims when it is the service's, unexpired, and names this
// device and its account; otherwise null. Spends nothing.
async function readTicket(env, ticket, device, now) {
  const [payload, sigText, ...rest] = ticket.split(".");
  if (rest.length > 0 || !payload || !sigText) return null;
  const claims = claimsOf(payload);
  const key = claims && typeof claims.kid === "string" ? (await ticketRing(env)).get(claims.kid) : null;
  if (!key) return null;
  let sig;
  try {
    sig = fromB64url(sigText);
  } catch {
    return null; // a base64url length atob cannot decode
  }
  if (!sig || sig.length !== SIG_BYTES) return null;
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, enc.encode(`${TICKET_LABEL}.${payload}`));
  if (!ok || claims.v !== 1 || claims.device !== device.id || claims.account !== device.account_id) return null;
  if (!Number.isSafeInteger(claims.at) || claims.at > now || !Number.isSafeInteger(claims.exp) || claims.exp <= now) return null;
  return typeof claims.jti === "string" && JTI.test(claims.jti) ? claims : null;
}

async function ticketOrRefuse(env, ticket, device, now) {
  const claims = await readTicket(env, ticket, device, now);
  if (!claims) throw new Refusal("bad-ticket", 401);
  return claims;
}

// Spends the ticket's jti for its live device; its trigger (schema.sql) moves
// the device's proved_at to the ticket's `at` in the same write.
async function spendTicket(db, device, claims) {
  const spent = await db.prepare(
    `INSERT INTO spent_ticket (jti, account_id, device_id, at, expires_at) SELECT ?, ?, ?, ?, ? WHERE ${LIVE_DEVICE}
     ON CONFLICT (jti) DO NOTHING RETURNING jti`,
  ).bind(claims.jti, device.account_id, device.id, claims.at, claims.exp, device.id).first();
  if (!spent) {
    await findDevice(db, device.id); // refuses no-device when the removal is what stopped it
    throw new Refusal("bad-ticket", 401);
  }
}

// The ticket's claims when one came; refuses code-needed when this device's
// last code is PIN_LIMITS.codeEveryMs old, or it never had one, and none came.
async function codeOrRefuse(db, env, ticket, device, now) {
  const claims = ticket === null ? null : await ticketOrRefuse(env, ticket, device, now);
  const check = await db.prepare("SELECT proved_at FROM device_check WHERE device_id = ?").bind(device.id).first();
  const codeDue = !check || now - check.proved_at >= PIN_LIMITS.codeEveryMs;
  if (codeDue && !claims) throw new Refusal("code-needed", 401);
  return claims;
}

async function signKeyOrUnavailable(env) {
  const signKey = await ticketKey(env);
  if (!signKey) throw new Refusal("unavailable", 503);
  return signKey;
}

// What the lockout's mail needs; without it no PIN is compared.
function mailOrUnavailable(env, mailer) {
  if (!mailer || !reopenBaseOk(env.HZ_REOPEN_BASE)) throw new Refusal("unavailable", 503);
  return env.HZ_REOPEN_BASE;
}

// Compares `pin` with the account's verifier inside the PIN lockout: refuses
// locked before comparing when PIN entry is closed, and bad-pin when wrong.
// Answers the after-work mailing what the lockout owes.
async function checkedPin({ db, device, now, keys, mailer, reopenBase }, pin, row) {
  const lockout = { db, accountId: device.account_id, now, keys, mailer, reopenBase };
  const tried = await admitPinTry(lockout);
  const right = sameHex(await keys.pinVerifier(pin, row.salt), row.verifier);
  const after = await settlePinTry({ ...lockout, tried, right });
  if (!right) throw new Refusal("bad-pin", 401, after);
  return after;
}

// The accepted open's answer: ok and a grant ending 12 hours after this
// device's last accepted code (read after any spend moved it).
async function opened(db, device, signKey) {
  const check = await db.prepare("SELECT proved_at FROM device_check WHERE device_id = ?").bind(device.id).first();
  const claims = { v: 1, kid: signKey.kid, account: device.account_id, device: device.id, until: check.proved_at + PIN_LIMITS.codeEveryMs };
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signKey.key, enc.encode(`${GRANT_LABEL}.${payload}`));
  return { status: 200, json: { ok: true, grant: `${payload}.${b64url(new Uint8Array(sig))}` } };
}

// The PIN rules' answer as a refusal: shape, or too-easy with its one sentence.
function allowedOrRefuse(pinRules, pin) {
  const allowed = pinRules.pinAllowed(pin);
  if (allowed.ok) return;
  if (allowed.reason === "too-easy") throw new Refusal("too-easy", 400, undefined, allowed.message);
  throw new Refusal("shape", 400);
}

export async function setPin({ db, device, body, now, env, pinRules, mailer }) {
  if (body !== null && typeof body === "object" && Object.hasOwn(body, "current")) return changePin({ db, device, body, now, env, pinRules, mailer });
  const { pin, ticket } = pinBody(body, { ticketRequired: true });
  if (!pinRules) throw new Refusal("unavailable", 503);
  const keys = await keysOrUnavailable(env);
  const signKey = await signKeyOrUnavailable(env);
  allowedOrRefuse(pinRules, pin);
  const claims = await ticketOrRefuse(env, ticket, device, now);
  const salt = newSalt();
  const verifier = await keys.pinVerifier(pin, salt);
  // Only while the ticket is unspent, and only from a device that may change
  // the account, checked in the write itself.
  const made = await db.prepare(
    `INSERT INTO pin (account_id, verifier, salt, set_at) SELECT ?, ?, ?, ? WHERE ${ACCOUNT_CHANGER}
     AND NOT EXISTS (SELECT 1 FROM spent_ticket WHERE jti = ?) ON CONFLICT (account_id) DO NOTHING RETURNING account_id`,
  ).bind(device.account_id, verifier, salt, now, device.id, claims.jti).first();
  if (!made) {
    await findDevice(db, device.id);
    if (!(await mayChangeAccount(db, device.id))) throw new Refusal("not-owner", 403);
    const set = await db.prepare("SELECT 1 AS yes FROM pin WHERE account_id = ?").bind(device.account_id).first();
    throw set ? new Refusal("pin-set", 409) : new Refusal("bad-ticket", 401);
  }
  await spendTicket(db, device, claims);
  return opened(db, device, signKey);
}

export async function verifyPin({ db, device, body, now, env, mailer }) {
  const { pin, ticket } = pinBody(body, { ticketRequired: false });
  if (!PIN.test(pin)) throw new Refusal("shape", 400);
  const keys = await keysOrUnavailable(env);
  const signKey = await signKeyOrUnavailable(env);
  const reopenBase = mailOrUnavailable(env, mailer);
  const row = await db.prepare("SELECT verifier, salt FROM pin WHERE account_id = ?").bind(device.account_id).first();
  if (!row) throw new Refusal("no-pin", 409);
  const claims = await codeOrRefuse(db, env, ticket, device, now);
  const after = await checkedPin({ db, device, now, keys, mailer, reopenBase }, pin, row);
  if (claims) await withAfter(after, () => spendTicket(db, device, claims));
  return { ...(await opened(db, device, signKey)), after };
}

// Runs `work`, and hands a refusal it throws the lockout's after-work, so the
// mail a settled try owes still goes out.
async function withAfter(after, work) {
  try {
    return await work();
  } catch (err) {
    if (err instanceof Refusal && !err.after) throw new Refusal(err.reason, err.status, after, err.sentence);
    throw err;
  }
}

// A change's body: the new PIN, the current one, and the ticket where given.
function changeBody(body) {
  const hasTicket = Object.hasOwn(body, "ticket");
  if (!hasOnly(body, hasTicket ? ["pin", "current", "ticket"] : ["pin", "current"])) throw new Refusal("shape", 400);
  if (typeof body.pin !== "string" || typeof body.current !== "string" || !PIN.test(body.current)) throw new Refusal("shape", 400);
  if (hasTicket && (typeof body.ticket !== "string" || body.ticket.length > MAX_TICKET)) throw new Refusal("shape", 400);
  return { pin: body.pin, current: body.current, ticket: hasTicket ? body.ticket : null };
}

// Whether `verifier` is the account's current PIN or one still locked from reuse.
async function lockedForReuse(db, accountId, verifier, row, now) {
  if (sameHex(verifier, row.verifier)) return true;
  const locks = await db.prepare("SELECT verifier FROM pin_lock WHERE account_id = ? AND locked_until > ?").bind(accountId, now).all();
  return (locks.results ?? []).some((lock) => sameHex(verifier, lock.verifier));
}

async function changePin({ db, device, body, now, env, pinRules, mailer }) {
  const { pin, current, ticket } = changeBody(body);
  if (!pinRules) throw new Refusal("unavailable", 503);
  const keys = await keysOrUnavailable(env);
  const signKey = await signKeyOrUnavailable(env);
  const reopenBase = mailOrUnavailable(env, mailer);
  allowedOrRefuse(pinRules, pin);
  const row = await db.prepare("SELECT verifier, salt FROM pin WHERE account_id = ?").bind(device.account_id).first();
  if (!row) throw new Refusal("no-pin", 409);
  const claims = await codeOrRefuse(db, env, ticket, device, now);
  const after = await checkedPin({ db, device, now, keys, mailer, reopenBase }, current, row);
  return { ...(await withAfter(after, () => replacePin({ db, device, now, keys, signKey, claims, row, pin }))), after };
}

// The change's write, once the current PIN was right.
async function replacePin({ db, device, now, keys, signKey, claims, row, pin }) {
  const verifier = await keys.pinVerifier(pin, row.salt);
  if (await lockedForReuse(db, device.account_id, verifier, row, now)) throw new Refusal("pin-reused", 409, undefined, PIN_LOCKED);
  // Only over the verifier just checked, never onto a PIN locked meanwhile,
  // and only from a device that may change the account, checked in the write.
  const changed = await db.prepare(
    `UPDATE pin SET verifier = ?, set_at = ? WHERE account_id = ? AND verifier = ? AND ${ACCOUNT_CHANGER}
     AND NOT EXISTS (SELECT 1 FROM pin_lock WHERE account_id = ? AND verifier = ? AND locked_until > ?)
     ${claims ? "AND NOT EXISTS (SELECT 1 FROM spent_ticket WHERE jti = ?)" : ""} RETURNING account_id`,
  ).bind(verifier, now, device.account_id, row.verifier, device.id, device.account_id, verifier, now, ...(claims ? [claims.jti] : [])).first();
  if (!changed) {
    await findDevice(db, device.id);
    if (!(await mayChangeAccount(db, device.id))) throw new Refusal("not-owner", 403);
    const stored = await db.prepare("SELECT verifier FROM pin WHERE account_id = ?").bind(device.account_id).first();
    if (!stored || !sameHex(stored.verifier, row.verifier)) throw new Refusal("bad-pin", 401);
    if (await lockedForReuse(db, device.account_id, verifier, stored, now)) throw new Refusal("pin-reused", 409, undefined, PIN_LOCKED);
    throw new Refusal("bad-ticket", 401);
  }
  if (claims) await spendTicket(db, device, claims);
  return opened(db, device, signKey);
}
