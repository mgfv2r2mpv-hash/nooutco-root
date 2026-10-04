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
 * Tries are rate limited per requester (across addresses, every try) and per
 * address (from any requester, wrong passwords only); a refused try is not
 * counted. A success takes back its place in the address bucket, in the same
 * batch that stores the ticket, so the owner's own sign-ins never fill it.
 * A request signed by a registered device of the account skips the address
 * bucket and still pays the requester bucket (security review H2): strangers
 * who fill the address bucket hold back a new device, never a known one.
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
import { Refusal, b64url } from "./checks.js";
import { KEY_DIGEST } from "./devices.js";
import { SIGNUP_LIMITS, hasOnly, addressOf, keysOrUnavailable, requesterOf } from "./signup.js";
import { admitThrottle, releaseThrottle } from "./throttle.js";

export const SIGNIN_LIMITS = Object.freeze({
  ticketTtlMs: 5 * 60 * 1000,
  perAddressHour: 10,
  perRequesterHour: 20,
  windowMs: 60 * 60 * 1000,
});

const TICKET_BYTES = 32;
// Hashed against when the address has no account, so that path costs what a
// wrong password costs. Its output is thrown away.
const NO_ACCOUNT_SALT = b64url(new Uint8Array(16));

// Any password an account could hold; the length rule for new passwords is
// sign-up's, so a later change to it never locks out an older account.
function passwordOf(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > SIGNUP_LIMITS.passwordMax) throw new Refusal("shape", 400);
  return value;
}

export async function signIn({ db, device, body, now, env, request }) {
  if (!hasOnly(body, ["email", "password", "keyDigest"])) throw new Refusal("shape", 400);
  const address = addressOf(body.email);
  const password = passwordOf(body.password);
  if (typeof body.keyDigest !== "string" || !KEY_DIGEST.test(body.keyDigest)) throw new Refusal("shape", 400);
  const keys = await keysOrUnavailable(env);
  const addressKey = await keys.addressKey(address);
  const requester = await keys.requesterKey(requesterOf(request));
  const account = await db.prepare("SELECT id, login_hash, login_salt FROM account WHERE address_key = ?").bind(addressKey).first();
  // device is set only when the request passed every signed check (routes.js "signable").
  const known = Boolean(device && account && device.account_id === account.id);
  const addressBucket = `signin-address:${addressKey}`;
  const perRequester = { bucket: `signin-requester:${requester}`, limit: SIGNIN_LIMITS.perRequesterHour };
  const perAddress = { bucket: addressBucket, limit: SIGNIN_LIMITS.perAddressHour };
  const buckets = known ? [perRequester] : [perRequester, perAddress];
  if (!(await admitThrottle(db, now, SIGNIN_LIMITS.windowMs, buckets))) throw new Refusal("slow-down", 429);
  const login = await keys.hashLogin(password, account ? account.login_salt : NO_ACCOUNT_SALT);
  if (!account || !sameHex(login.hash, account.login_hash)) throw new Refusal("bad-login", 401);
  const ticket = b64url(crypto.getRandomValues(new Uint8Array(TICKET_BYTES)));
  const store = db.prepare("INSERT INTO ticket (digest, account_id, key_digest, expires_at, used) VALUES (?, ?, ?, ?, 0)")
    .bind(await keys.ticketDigest(ticket), account.id, body.keyDigest, now + SIGNIN_LIMITS.ticketTtlMs);
  await db.batch(known ? [store] : [store, releaseThrottle(db, addressBucket, now)]);
  return { status: 200, json: { ticket } };
}
