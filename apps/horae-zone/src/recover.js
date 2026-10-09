/**
 * A6, account recovery (plan §3.5 "Lost authenticator, phone passcode or Mac
 * password", R-6: access is recoverable, the vault is not).
 *
 *   /recover {email}                                      -> {ok: true}
 *   /recover {email, code, password, signKey, agreeKey}   -> {device}
 *
 * THE TWO FACTORS are the plan's: an emailed code plus the account password.
 * The start mails a single-use link to the address of an account, with the
 * code in its fragment (a 128-bit token, as sign-up's), and answers {ok:true}
 * whether or not the address has an account, running the same statements
 * either way (sign-up's M1): an address with no account gets a row born
 * spent, which never verifies and is never mailed. One link is live for an
 * address at a time; a start while one is live mails it again, inside
 * RECOVER_LIMITS.resendsPerAddressHour. Every start counts toward a daily cap
 * of recovery's own (RECOVER_DAY_BUCKET, the same number as sign-up's, A6
 * security review LOW-2), so a flood of sign-up starts never holds back the
 * one way back into an account. The finish counts the try before the
 * compare, spends the link with the first right try, and only then checks
 * the password: a wrong one answers
 * bad-login and the link is spent (as the MEDIUM-1 relink). Shape comes first,
 * so a malformed request counts nothing.
 *
 * WHAT IT CHANGES, in one batch, so no Worker that stops midway leaves an
 * account half recovered:
 *   - the new device, with the two public keys the finish carried, is the
 *     account's owner device, confirmed at once (the inbox and the password
 *     are the proof, as the sign-up link is for the first owner);
 *   - every other device loses the owner flag, and every live one is held
 *     back (pending) until it proves the new code; a pending device reaches
 *     only /nonce, /unlock and /vault/state;
 *   - the old seed is deleted, with its exchanges and the code path's
 *     lockout row, so the new device enrols a new authenticator
 *     (/otp/enrol, under the A5 owner rule) and the old one opens nothing;
 *   - every live sign-in ticket is voided;
 *   - the current vault id is tombstoned and every bring in flight is
 *     dropped. So no old vault key can reach the new device through the
 *     service (plan test: "recovery never returns an old vault key"), and
 *     every old device learns at its next launch that its vault is gone.
 * The new device then records its new vault with /vault/switch.
 *
 * WHAT IT DOES NOT CHANGE: the account password, the PIN and its locks, the
 * admin role, and the offline block. A locked account is not recovered
 * (account-locked): only an administrator lifts that lock (A5b).
 *
 * The finish carries the keys rather than a key digest and a ticket (as
 * sign-up does), so there is no second step to miss: the device is
 * registered by the same write that recovers the account.
 *
 * STRANDED ACCOUNTS (A5 residuals). An account whose owner device was
 * removed before its first accepted code, and one that never registered its
 * owner device, come back here too: the batch needs no live device.
 *
 * The notice after (RECOVERED_NOTE) goes to the account's address, with no
 * number, link or id.
 */
import { sameHex } from "../../../packages/account-engine/src/limits.mjs";
import { Refusal, b64url } from "./checks.js";
import {
  hasOnly, addressOf, requesterOf, keysOrUnavailable, codesPerDayOf, linkOf, SIGNUP_LIMITS,
} from "./signup.js";
import { passwordOf } from "./signin.js";
import { isPoint } from "./devices.js";
import { admitThrottle } from "./throttle.js";
import { accountLocked } from "./account-lock.js";
import { mailAfter } from "./lockout.js";

// The recovery starts of the last day, across every address and requester.
export const RECOVER_DAY_BUCKET = "recover-day";

export const RECOVER_LIMITS = Object.freeze({
  codeTtlMs: SIGNUP_LIMITS.codeTtlMs,
  startsPerRequesterHour: SIGNUP_LIMITS.startsPerRequesterHour,
  resendsPerAddressHour: SIGNUP_LIMITS.resendsPerAddressHour,
  verifiesPerRequesterHour: SIGNUP_LIMITS.verifiesPerRequesterHour,
  triesPerAddressRequesterHour: SIGNUP_LIMITS.triesPerAddressRequesterHour,
  windowMs: SIGNUP_LIMITS.windowMs,
});

// Plain notes on state; the wording is the owner's to change. No number:
// the A5b rule for what a user reads.
export const RECOVER_LINK_SUBJECT = "Horae Zone: account recovery link";
export const RECOVERED_NOTE = Object.freeze({
  subject: "Horae Zone: account recovered",
  text: [
    "This account was recovered on a new device, with the emailed link and the account password.",
    "Its authenticator code was cleared; the new device sets up a new one.",
    "Every other device of this account can do nothing until it proves the new code.",
    "Every device deletes the old vault the next time it opens.",
  ].join("\n"),
});

const CODE_BYTES = 16;
const CODE = /^[A-Za-z0-9_-]{22}$/;
const DEVICE_ID_BYTES = 16;
const FINISH_KEYS = ["email", "code", "password", "signKey", "agreeKey"];

function linkMessage(to, link) {
  return {
    to,
    subject: RECOVER_LINK_SUBJECT,
    text: [
      "Link for recovering this account on a new device:",
      link,
      "",
      "Works once, for a short time. The account password is needed too.",
      "A recovery replaces the authenticator code and starts a new vault: the old vault is deleted on every device.",
      "If you did not ask for this, nothing changes unless the link and the password are both used.",
    ].join("\n"),
  };
}

// The link's own digest and box, bound to the address key under a recovery
// label, so a recovery code never verifies as a sign-up code or the reverse.
const scope = (addressKey) => `recover:${addressKey}`;

async function mintLink(db, keys, addressKey, now) {
  const code = b64url(crypto.getRandomValues(new Uint8Array(CODE_BYTES)));
  const digest = await keys.codeDigest(scope(addressKey), code);
  const box = await keys.sealLink(code, scope(addressKey));
  // One live link at a time: a row inside its life, live or spent, is kept.
  const row = await db.prepare(
    `INSERT INTO recovery (address_key, digest, link_box, expires_at, tries, used)
     SELECT ?, ?, ?, ?, 0, NOT EXISTS (SELECT 1 FROM account WHERE address_key = ?) WHERE 1
     ON CONFLICT (address_key) DO UPDATE SET digest = excluded.digest, link_box = excluded.link_box, expires_at = excluded.expires_at,
     tries = 0, used = excluded.used WHERE recovery.expires_at <= ? RETURNING used`,
  ).bind(addressKey, digest, box, now + RECOVER_LIMITS.codeTtlMs, addressKey, now).first();
  if (!row) return { made: false, code: null };
  return { made: true, code: row.used === 0 ? code : null };
}

// The live link, to mail again, inside the re-send cap; null otherwise.
async function resendLink(db, keys, addressKey, now) {
  const admitted = await admitThrottle(db, now, RECOVER_LIMITS.windowMs, [
    { bucket: `recover-resend:${addressKey}`, limit: RECOVER_LIMITS.resendsPerAddressHour },
  ]);
  if (!admitted) return null;
  const row = await db.prepare("SELECT link_box FROM recovery WHERE address_key = ? AND used = 0 AND expires_at > ? AND link_box IS NOT NULL")
    .bind(addressKey, now).first();
  if (!row) return null;
  try {
    return await keys.openLink(row.link_box, scope(addressKey));
  } catch {
    return null; // sealed under another secret: its digest could not verify either
  }
}

function mailLink(mailer, message) {
  return async () => {
    try {
      return (await mailer(message)) ? null : "mail-failed";
    } catch {
      return "mail-failed";
    }
  };
}

async function startRecovery({ db, body, now, env, request, mailer }) {
  const address = addressOf(body.email);
  const ip = requesterOf(request);
  const keys = await keysOrUnavailable(env);
  if (!mailer) throw new Refusal("unavailable", 503);
  const codesPerDay = codesPerDayOf(env);
  linkOf(env, "x"); // a link base that cannot carry a link stops the start before any write
  const addressKey = await keys.addressKey(address);
  const requester = await keys.requesterKey(ip);
  const counted = await admitThrottle(db, now, RECOVER_LIMITS.windowMs, [
    { bucket: `recover-start:${requester}`, limit: RECOVER_LIMITS.startsPerRequesterHour },
    { bucket: RECOVER_DAY_BUCKET, limit: codesPerDay, windowMs: SIGNUP_LIMITS.dayMs },
  ]);
  if (!counted) throw new Refusal("slow-down", 429);
  const minted = await mintLink(db, keys, addressKey, now);
  const code = minted.made ? minted.code : await resendLink(db, keys, addressKey, now);
  if (!code) return { status: 200, json: { ok: true } };
  return { status: 200, json: { ok: true }, after: mailLink(mailer, linkMessage(address, linkOf(env, code))) };
}

// The finish's body, every part checked before anything is read or counted.
async function finishBody(body) {
  const address = addressOf(body.email);
  if (typeof body.code !== "string" || !CODE.test(body.code)) throw new Refusal("shape", 400);
  const password = passwordOf(body.password);
  if (!(await isPoint(body.signKey, "ECDSA")) || !(await isPoint(body.agreeKey, "ECDH"))) throw new Refusal("shape", 400);
  return { address, code: body.code, password, signKey: body.signKey, agreeKey: body.agreeKey };
}

// Counts the try on the live link, then spends it on the first right try.
async function spendLink(db, keys, addressKey, code, now) {
  const live = await db.prepare("UPDATE recovery SET tries = tries + 1 WHERE address_key = ? AND used = 0 AND expires_at > ? RETURNING digest")
    .bind(addressKey, now).first();
  const digest = await keys.codeDigest(scope(addressKey), code);
  if (!live || !sameHex(digest, live.digest)) throw new Refusal("bad-code", 401);
  const spent = await db.prepare("UPDATE recovery SET used = 1, link_box = NULL WHERE address_key = ? AND used = 0 AND digest = ? RETURNING address_key")
    .bind(addressKey, live.digest).first();
  if (!spent) throw new Refusal("bad-code", 401);
}

// The one write that recovers the account onto the new device.
function recoveryBatch(db, accountId, device, now) {
  return db.batch([
    db.prepare("UPDATE device SET owner = 0, pending = CASE WHEN removed_at IS NULL THEN 1 ELSE pending END WHERE account_id = ?").bind(accountId),
    db.prepare("INSERT INTO device (id, account_id, sign_key, agree_key, created_at, pending, owner, confirmed_at) VALUES (?, ?, ?, ?, ?, 0, 1, ?)")
      .bind(device.id, accountId, device.signKey, device.agreeKey, now, now),
    db.prepare("UPDATE ticket SET used = 1 WHERE account_id = ? AND used = 0").bind(accountId),
    db.prepare("DELETE FROM exchange WHERE account_id = ?").bind(accountId),
    db.prepare("DELETE FROM otp WHERE account_id = ?").bind(accountId),
    db.prepare("DELETE FROM limits WHERE account_id = ?").bind(accountId),
    db.prepare("INSERT INTO vault_tombstone (vault_id, account_id, at) SELECT vault_id, account_id, ? FROM vault WHERE account_id = ? ON CONFLICT (vault_id) DO NOTHING")
      .bind(now, accountId),
    db.prepare("DELETE FROM vault WHERE account_id = ?").bind(accountId),
    db.prepare("DELETE FROM handoff WHERE account_id = ?").bind(accountId),
    // Security review MEDIUM-1: every vault a device registered before now
    // holds is gone, recorded or not (src/vault.js stateOf).
    db.prepare("INSERT INTO account_recovery (account_id, at) VALUES (?, ?) ON CONFLICT (account_id) DO UPDATE SET at = excluded.at")
      .bind(accountId, now),
  ]);
}

async function finishRecovery({ db, body, now, env, request, mailer }) {
  const { address, code, password, signKey, agreeKey } = await finishBody(body);
  const ip = requesterOf(request);
  const keys = await keysOrUnavailable(env);
  if (!mailer) throw new Refusal("unavailable", 503);
  const addressKey = await keys.addressKey(address);
  const requester = await keys.requesterKey(ip);
  const admitted = await admitThrottle(db, now, RECOVER_LIMITS.windowMs, [
    { bucket: `recover-verify:${requester}`, limit: RECOVER_LIMITS.verifiesPerRequesterHour },
    { bucket: `recover-pair:${addressKey}:${requester}`, limit: RECOVER_LIMITS.triesPerAddressRequesterHour },
  ]);
  if (!admitted) throw new Refusal("slow-down", 429);
  await spendLink(db, keys, addressKey, code, now);
  const account = await db.prepare("SELECT id, login_hash, login_salt FROM account WHERE address_key = ?").bind(addressKey).first();
  if (!account) throw new Refusal("bad-code", 401);
  const login = await keys.hashLogin(password, account.login_salt);
  if (!sameHex(login.hash, account.login_hash)) throw new Refusal("bad-login", 401);
  if (await accountLocked(db, account.id)) throw new Refusal("account-locked", 423);
  const device = { id: b64url(crypto.getRandomValues(new Uint8Array(DEVICE_ID_BYTES))), signKey, agreeKey };
  await recoveryBatch(db, account.id, device, now);
  const after = mailAfter({ db, keys, mailer, accountId: account.id, notes: [RECOVERED_NOTE] });
  return { status: 200, json: { device: device.id }, after };
}

export async function recover(context) {
  const { body } = context;
  if (hasOnly(body, ["email"])) return startRecovery(context);
  if (hasOnly(body, FINISH_KEYS)) return finishRecovery(context);
  throw new Refusal("shape", 400);
}
