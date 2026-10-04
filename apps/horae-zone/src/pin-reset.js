/**
 * A5b, the forgotten PIN (plan §3.4 "Forgotten PIN"): reset with any two of
 * the code, the account password and an emailed single-use code, plus Face
 * ID on a registered device. The old PIN is locked.
 *
 *   /pin/reset {}                                     -> {ok: true}   mails the code
 *   /pin/reset {pin, ticket?, password?, emailCode?}  -> {ok: true}   any two
 *
 * FACE ID is the device signature every /pin route carries; a pending device
 * never reaches the route (src/routes.js), and both writes below carry
 * ACCOUNT_CHANGER, so only a device that may change the account asks for the
 * mail or resets.
 *
 * THE THREE FACTORS. The code is an unlock ticket from /unlock/finish, read
 * as an open reads it (src/pin.js readTicket: the service's key, this device
 * and account, unexpired, jti unspent). The password is the account's login
 * password, hashed as sign-in hashes it. The emailed code is 128 random bits
 * mailed in the fragment of a link to HZ_RESET_BASE, which a browser never
 * sends to a server; the app reads it there. Only its keyed digest is kept
 * (pin_reset), one live per account: a newer mail replaces it. A factor key
 * holding null, an empty value or any other type answers shape (security
 * review HIGH-1: a null once counted as given yet was never checked, so three
 * nulls reset). Fewer than two answers two-needed before anything is read, and
 * the compare again needs two factors checked and right. Any wrong factor
 * answers bad-reset, the same word whichever it was, and spends nothing; a
 * reset spends the ticket's jti and deletes the emailed code.
 *
 * LIMITS. Every reset try with two factors takes a place in the account's
 * try bucket before any factor is compared (PIN_RESET_LIMITS.triesPerHour,
 * so a device that holds one factor guesses another at that rate), and every
 * mail a place in its mail bucket. Only the account's own devices reach
 * either bucket, so a stranger cannot fill them. The limits are the agent's
 * safe defaults, listed for the owner in the design review.
 *
 * THE NEW PIN passes the PIN rules and is not the current PIN or one locked
 * from reuse (pin-reused, with PIN_LOCKED). The rules answer too-easy only
 * after the try took its place and the factors were right, so wrong factors
 * never read the private list (security review LOW-1). The write that
 * replaces the verifier locks the old PIN for 365 days (schema.sql
 * pin_replaced_locks) and restarts set_at. The owner is mailed a note with no number and no link.
 * A reset does not open the app: the next open is a /pin/verify, with the
 * code when 12 hours have passed, so a reset never extends the offline grant.
 */
import { sameHex } from "../../../packages/account-engine/src/limits.mjs";
import { fragmentLink } from "../../../packages/account-engine/src/mailer.mjs";
import { PIN_LOCKED } from "../../../packages/account-engine/src/pin.mjs";
import { Refusal, ACCOUNT_CHANGER, b64url, findDevice, mayChangeAccount } from "./checks.js";
import { SIGNUP_LIMITS, hasOnly, keysOrUnavailable } from "./signup.js";
import { admitThrottle } from "./throttle.js";
import { mailAfter } from "./lockout.js";
import { PIN, MAX_TICKET, readTicket, spendTicket, allowedOrRefuse, lockedForReuse } from "./pin.js";

const HOUR_MS = 60 * 60 * 1000;

export const PIN_RESET_LIMITS = Object.freeze({
  codeTtlMs: 10 * 60 * 1000,
  triesPerHour: 5,
  mailsPerHour: 3,
  windowMs: HOUR_MS,
});

const FACTORS = ["ticket", "password", "emailCode"];
const CODE_BYTES = 16;
const CODE = /^[A-Za-z0-9_-]{22}$/;

// Plain notes on state; the wording is the owner's to change. Neither carries
// a number, and the reset note no link.
function codeMail(link) {
  return {
    subject: "Horae Zone: app PIN reset link",
    text: [
      "Link for resetting the app PIN, to open on the device that asked for it:",
      link,
      "",
      "Works once, for a short time.",
      "The reset also needs the code or the account password.",
    ].join("\n"),
  };
}

export const RESET_NOTE = Object.freeze({
  subject: "Horae Zone: app PIN reset",
  text: [
    "The app PIN for this account was reset on one of its devices.",
    "The old PIN no longer opens the app.",
  ].join("\n"),
});

// The code's digest, scoped to the account so it can never match a sign-up
// code's (whose scope is a hex address key).
const codeDigest = (keys, accountId, code) => keys.codeDigest(`pin-reset:${accountId}`, code);

// A factor is given only as a non-empty string of its shape; null, an empty
// value or any other type is a malformed body, never a factor left out.
const FACTOR_SHAPE = Object.freeze({
  ticket: (v) => v.length > 0 && v.length <= MAX_TICKET,
  password: (v) => v.length > 0 && v.length <= SIGNUP_LIMITS.passwordMax,
  emailCode: (v) => CODE.test(v),
});

function resetBody(body) {
  const given = FACTORS.filter((k) => Object.hasOwn(body, k));
  if (!hasOnly(body, ["pin", ...given]) || typeof body.pin !== "string") throw new Refusal("shape", 400);
  if (!given.every((k) => typeof body[k] === "string" && FACTOR_SHAPE[k](body[k]))) throw new Refusal("shape", 400);
  if (given.length < 2) throw new Refusal("two-needed", 400);
  const { ticket = null, password = null, emailCode = null } = body;
  return { pin: body.pin, ticket, password, emailCode };
}

function resetBaseOrUnavailable(env, mailer) {
  try {
    if (!mailer) throw new Error("no mailer");
    fragmentLink(env.HZ_RESET_BASE, "x");
    return env.HZ_RESET_BASE;
  } catch {
    throw new Refusal("unavailable", 503);
  }
}

async function pinRowOrRefuse(db, accountId) {
  const row = await db.prepare("SELECT verifier, salt FROM pin WHERE account_id = ?").bind(accountId).first();
  if (!row) throw new Refusal("no-pin", 409);
  return row;
}

async function admitOrSlowDown(db, now, bucket, limit) {
  if (!(await admitThrottle(db, now, PIN_RESET_LIMITS.windowMs, [{ bucket, limit }]))) throw new Refusal("slow-down", 429);
}

// The refusal for a write its conditions stopped: the device's standing,
// else a factor spent meanwhile.
async function refuseStopped(db, device, otherwise) {
  await findDevice(db, device.id);
  if (!(await mayChangeAccount(db, device.id))) throw new Refusal("not-owner", 403);
  throw new Refusal(otherwise.reason, otherwise.status);
}

async function mailCode({ db, device, now, env, mailer }) {
  const keys = await keysOrUnavailable(env);
  const base = resetBaseOrUnavailable(env, mailer);
  await pinRowOrRefuse(db, device.account_id);
  await admitOrSlowDown(db, now, `pin-reset-mail:${device.account_id}`, PIN_RESET_LIMITS.mailsPerHour);
  const code = b64url(crypto.getRandomValues(new Uint8Array(CODE_BYTES)));
  const stored = await db.prepare(
    `INSERT INTO pin_reset (account_id, digest, expires_at) SELECT ?, ?, ? WHERE ${ACCOUNT_CHANGER}
     ON CONFLICT (account_id) DO UPDATE SET digest = excluded.digest, expires_at = excluded.expires_at RETURNING account_id`,
  ).bind(device.account_id, await codeDigest(keys, device.account_id, code), now + PIN_RESET_LIMITS.codeTtlMs, device.id).first();
  if (!stored) await refuseStopped(db, device, new Refusal("not-owner", 403));
  const notes = [codeMail(fragmentLink(base, code))];
  return { status: 200, json: { ok: true }, after: mailAfter({ db, keys, mailer, accountId: device.account_id, notes }) };
}

// Whether at least two factors were given and every one is right; a factor
// not given is not checked and never counts. Every given one is compared, so
// the time taken says nothing of which failed.
async function factorsRight({ db, device, now, env, keys }, { ticket, password, emailCode }) {
  const checks = [];
  const claims = ticket === null ? null : await readTicket(env, ticket, device, now);
  if (ticket !== null) checks.push(claims !== null);
  if (password !== null) {
    const account = await db.prepare("SELECT login_hash, login_salt FROM account WHERE id = ?").bind(device.account_id).first();
    const login = account ? await keys.hashLogin(password, account.login_salt) : null;
    checks.push(Boolean(login && sameHex(login.hash, account.login_hash)));
  }
  let digest = null;
  if (emailCode !== null) {
    digest = await codeDigest(keys, device.account_id, emailCode);
    const live = await db.prepare("SELECT digest FROM pin_reset WHERE account_id = ? AND expires_at > ?").bind(device.account_id, now).first();
    checks.push(Boolean(live && sameHex(digest, live.digest)));
  }
  return { right: checks.length >= 2 && checks.every(Boolean), claims, digest };
}

export async function resetPin({ db, device, body, now, env, pinRules, mailer }) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Refusal("shape", 400);
  if (Object.keys(body).length === 0) return mailCode({ db, device, now, env, mailer });
  const given = resetBody(body);
  if (!pinRules) throw new Refusal("unavailable", 503);
  const keys = await keysOrUnavailable(env);
  if (!PIN.test(given.pin)) throw new Refusal("shape", 400);
  const row = await pinRowOrRefuse(db, device.account_id);
  await admitOrSlowDown(db, now, `pin-reset-try:${device.account_id}`, PIN_RESET_LIMITS.triesPerHour);
  const { right, claims, digest } = await factorsRight({ db, device, now, env, keys }, given);
  if (!right) throw new Refusal("bad-reset", 401);
  allowedOrRefuse(pinRules, given.pin);
  const verifier = await keys.pinVerifier(given.pin, row.salt);
  if (await lockedForReuse(db, device.account_id, verifier, row, now)) throw new Refusal("pin-reused", 409, undefined, PIN_LOCKED);
  // Over the verifier just read, never onto a PIN locked meanwhile, only with
  // factors still unspent, and only from a device that may change the account.
  const changed = await db.prepare(
    `UPDATE pin SET verifier = ?, set_at = ? WHERE account_id = ? AND verifier = ? AND ${ACCOUNT_CHANGER}
     AND NOT EXISTS (SELECT 1 FROM pin_lock WHERE account_id = ? AND verifier = ? AND locked_until > ?)
     ${claims ? "AND NOT EXISTS (SELECT 1 FROM spent_ticket WHERE jti = ?)" : ""}
     ${digest ? "AND EXISTS (SELECT 1 FROM pin_reset WHERE account_id = ? AND digest = ? AND expires_at > ?)" : ""} RETURNING account_id`,
  ).bind(
    verifier, now, device.account_id, row.verifier, device.id, device.account_id, verifier, now,
    ...(claims ? [claims.jti] : []), ...(digest ? [device.account_id, digest, now] : []),
  ).first();
  if (!changed) await refuseStopped(db, device, new Refusal("bad-reset", 401));
  if (digest) await db.prepare("DELETE FROM pin_reset WHERE account_id = ? AND digest = ?").bind(device.account_id, digest).run();
  if (claims) await spendTicket(db, device, claims);
  return { status: 200, json: { ok: true }, after: mailAfter({ db, keys, mailer, accountId: device.account_id, notes: [RESET_NOTE] }) };
}
