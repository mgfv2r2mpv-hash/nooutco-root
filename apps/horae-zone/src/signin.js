/**
 * A4, sign-in (plan §3.3 "First device" step 3, "Each further device" step 1).
 *
 * POST /signin {email, password, keyDigest} answers {ticket} when the password
 * is the account's, and a uniform 401 bad-login otherwise. keyDigest names the
 * keys the device will register (src/devices.js deviceKeyDigest), and the
 * ticket registers only those keys (security review M3), so a ticket seen in
 * flight cannot add someone else's device. An address with no account
 * answers the same way, after hashing the password the same way, so neither
 * the answer nor how long it takes says whether an account exists.
 * Tries are rate limited per requester (across addresses, every try), per
 * address and requester pair, and per address (from any requester); the last
 * two count wrong passwords only, and a refused try is not counted. A
 * success takes back its places in the pair and address buckets, in the same
 * batch that stores the ticket, so the owner's own sign-ins never fill them.
 * Second review, item 4: the address is never locked; its bucket is a high
 * ceiling (perAddressHour) for load. Third review, item 1: the backoff is the
 * pair's, never the address's. Past backoffAfter failures in the window a
 * pair backs off: a try from that requester at that address is refused, with
 * the same slow-down whatever the password, until backoffMs (doubling with
 * each further failure, never above backoffMaxMs) has passed since its latest
 * counted try, and perPairHour caps it. Strangers' wrong passwords hold back
 * only their own requesters, so polling the address cannot keep the owner's
 * right password from a new requester out.
 * A request signed by a registered device of the account skips the address
 * ceiling, and still pays the requester bucket (security review H2) and the
 * pair bucket with its backoff (second review, item 7), so a stolen device
 * guesses at perPairHour an hour per requester, not at the requester cap:
 * an address at its ceiling holds back a new device, never a known one. Its
 * ticket is stored only while that device is not removed, checked in the
 * same statement (security review L2), so a removal landing mid-flight wins.
 *
 * Turnstile (design of 8 Oct 2026, section 2): every sign-in that is not
 * signed by a registered device of the account it names carries a solved
 * challenge's token as `turnstile`, checked by src/turnstile.js after the
 * account lookup and before any bucket, so a failed challenge is never
 * counted. A device of another account signing gains nothing: it pays the
 * challenge like an unsigned try. A signed sign-in from the account's own
 * device never sees the challenge: the Enclave signature over a fresh nonce
 * is the stronger proof. With the Turnstile keys unset the unsigned and
 * foreign tries answer not-configured; the signed ones still work.
 *
 * A5 re-review, root rule: ownership comes from the email inbox, not the
 * password. The right password on an account with no device yet (its owner
 * device registers only from the sign-up link's ticket, src/signup.js)
 * answers no-owner-device, stores no ticket and mails the owner a note, at
 * most one an hour. Every device a /signin ticket registers starts pending.
 *
 * The ticket is 32 random bytes, handed out once and stored only as a keyed
 * digest bound to its account and its key digest. It registers one device
 * (src/devices.js) and dies after SIGNIN_LIMITS.ticketTtlMs. Until A5 no
 * account has an authenticator code, so sign-in asks for no code; A5 adds
 * the code, RED first.
 *
 * The limits below are the agent's safe defaults, listed for the owner in the
 * design review ("Decisions for Kaleb"): the plan does not fix them.
 */
import { sameHex } from "../../../packages/account-engine/src/limits.mjs";
import { Refusal, LIVE_DEVICE, b64url } from "./checks.js";
import { KEY_DIGEST } from "./devices.js";
import { SIGNUP_LIMITS, hasOnlyOrToken, addressOf, keysOrUnavailable, requesterOf } from "./signup.js";
import { admitThrottle, releaseThrottle } from "./throttle.js";
import { verifyTurnstile } from "./turnstile.js";

export const SIGNIN_LIMITS = Object.freeze({
  ticketTtlMs: 5 * 60 * 1000,
  perAddressHour: 1000,
  perPairHour: 5,
  perRequesterHour: 20,
  backoffAfter: 2,
  backoffBaseMs: 60 * 1000,
  backoffMaxMs: 15 * 60 * 1000,
  windowMs: 60 * 60 * 1000,
});

const TICKET_BYTES = 32;
// Hashed against when the address has no account, so that path costs what a
// wrong password costs. Its output is thrown away.
const NO_ACCOUNT_SALT = b64url(new Uint8Array(16));

// How long a pair (an address and a requester) must stay quiet after its
// latest counted try, given the failures counted in the window: none up to
// backoffAfter, then backoffBaseMs doubling with each further failure, never
// above backoffMaxMs.
export function backoffMs(failures) {
  const past = failures - SIGNIN_LIMITS.backoffAfter;
  if (past <= 0) return 0;
  return Math.min(SIGNIN_LIMITS.backoffBaseMs * 2 ** (past - 1), SIGNIN_LIMITS.backoffMaxMs);
}

// Wrong passwords counted for a pair in the window. They set its backoff;
// the quiet check itself runs in the admitting statement (admitThrottle), so
// tries sent together cannot both pass it.
async function failuresAt(db, pairBucket, now) {
  const { n } = await db.prepare("SELECT COUNT(*) AS n FROM throttle WHERE bucket = ? AND at > ?")
    .bind(pairBucket, now - SIGNIN_LIMITS.windowMs).first();
  return n;
}

// Any password an account could hold; the length rule for new passwords is
// sign-up's, so a later change to it never locks out an older account.
export function passwordOf(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > SIGNUP_LIMITS.passwordMax) throw new Refusal("shape", 400);
  return value;
}

// Whether the account has ever had a device, removed ones included: until
// its owner device is registered from the sign-up link, a password registers
// nothing (A5 re-review, root rule).
async function hasDevice(db, accountId) {
  return Boolean(await db.prepare("SELECT 1 AS yes FROM device WHERE account_id = ? LIMIT 1").bind(accountId).first());
}

// The note to the owner when the password signed in to an account with no
// device yet, at most one an hour per account. It carries no password, no
// connecting address and no link. The wording is the owner's to change.
export const OWNER_ALERT = Object.freeze({
  subject: "Horae Zone: sign-in refused",
  text: [
    "The password for this account was used to sign in.",
    "The account has no device yet, so the sign-in was refused and no device was added.",
    "An account's first device is registered only from the sign-up email.",
  ].join("\n"),
});
const OWNER_ALERTS_PER_HOUR = 1;

// Sent to the address sealed at sign-up, opened from its box.
async function ownerAlert(db, now, account, keys, mailer) {
  const due = await admitThrottle(db, now, SIGNIN_LIMITS.windowMs, [{ bucket: `owner-alert:${account.id}`, limit: OWNER_ALERTS_PER_HOUR }]);
  if (!due) return undefined;
  return async () => {
    if (!mailer) return "mail-failed";
    try {
      const to = await keys.openAddress(account.address_box, account.address_key);
      return (await mailer({ to, ...OWNER_ALERT })) ? null : "mail-failed";
    } catch {
      return "mail-failed";
    }
  };
}

export async function signIn({ db, device, body, now, env, request, mailer, siteverify }) {
  if (!hasOnlyOrToken(body, ["email", "password", "keyDigest"])) throw new Refusal("shape", 400);
  const address = addressOf(body.email);
  const password = passwordOf(body.password);
  if (typeof body.keyDigest !== "string" || !KEY_DIGEST.test(body.keyDigest)) throw new Refusal("shape", 400);
  const ip = requesterOf(request);
  const keys = await keysOrUnavailable(env);
  const addressKey = await keys.addressKey(address);
  const requester = await keys.requesterKey(ip);
  const account = await db.prepare("SELECT id, address_key, address_box, login_hash, login_salt FROM account WHERE address_key = ?").bind(addressKey).first();
  // device is set only when the request passed every signed check (routes.js "signable").
  const known = Boolean(device && account && device.account_id === account.id);
  if (!known) await verifyTurnstile(env, body.turnstile, { action: "signin", ip, now, siteverify });
  const addressBucket = `signin-address:${addressKey}`;
  const pairBucket = `signin-pair:${addressKey}:${requester}`;
  const perRequester = { bucket: `signin-requester:${requester}`, limit: SIGNIN_LIMITS.perRequesterHour };
  const perPair = { bucket: pairBucket, limit: SIGNIN_LIMITS.perPairHour, quietMs: backoffMs(await failuresAt(db, pairBucket, now)) };
  const buckets = known ? [perRequester, perPair] : [
    perRequester,
    perPair,
    { bucket: addressBucket, limit: SIGNIN_LIMITS.perAddressHour },
  ];
  if (!(await admitThrottle(db, now, SIGNIN_LIMITS.windowMs, buckets))) throw new Refusal("slow-down", 429);
  const login = await keys.hashLogin(password, account ? account.login_salt : NO_ACCOUNT_SALT);
  if (!account || !sameHex(login.hash, account.login_hash)) throw new Refusal("bad-login", 401);
  if (!(await hasDevice(db, account.id))) throw new Refusal("no-owner-device", 403, await ownerAlert(db, now, account, keys, mailer));
  const ticket = b64url(crypto.getRandomValues(new Uint8Array(TICKET_BYTES)));
  const values = [await keys.ticketDigest(ticket), account.id, body.keyDigest, now + SIGNIN_LIMITS.ticketTtlMs];
  if (known) {
    const stored = await db.prepare(`INSERT INTO ticket (digest, account_id, key_digest, expires_at, used) SELECT ?, ?, ?, ?, 0 WHERE ${LIVE_DEVICE} RETURNING digest`)
      .bind(...values, device.id).first();
    if (!stored) throw new Refusal("no-device", 401);
    // After the ticket, not in its batch: the ticket's statement must report
    // whether the device was still live. Should this one fail, the success
    // stays counted, which holds the device back and never lets a guess by.
    await releaseThrottle(db, pairBucket, now).run();
  } else {
    await db.batch([
      db.prepare("INSERT INTO ticket (digest, account_id, key_digest, expires_at, used) VALUES (?, ?, ?, ?, 0)").bind(...values),
      releaseThrottle(db, pairBucket, now),
      releaseThrottle(db, addressBucket, now),
    ]);
  }
  return { status: 200, json: { ticket } };
}
