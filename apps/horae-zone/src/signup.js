/**
 * A3, account + email (plan §3.3 "First device", steps 1 and 2).
 *
 * POST /account {email} mails a single-use 6-digit code to an address that
 * has no account yet, and answers {ok:true} either way, so no answer says
 * whether an address already has an account. The code rides in the link's
 * fragment, which a browser never sends to a server.
 *
 * POST /account/email/verify {email, code, password} makes the account only
 * when the code is one of the live ones for that address (up to
 * SIGNUP_LIMITS.liveCodes; a newer start never ends an older code). Each try
 * is reserved before the compare (so parallel guesses cannot pass the try
 * limits), the compare is sameHex over keyed digests against every live code,
 * and a code is spent by the first right try.
 *
 * The limits below are the agent's safe defaults, listed for the owner in the
 * design review ("Decisions for Kaleb"): the plan does not fix them.
 */
import { sameHex } from "../../../packages/account-engine/src/limits.mjs";
import { fragmentLink } from "../../../packages/account-engine/src/mailer.mjs";
import { Refusal } from "./checks.js";
import { accountKeys } from "./account-keys.js";
import { admitThrottle } from "./throttle.js";

// H1 (security review): a start never ends a live code and a wrong guess
// never ends one either, so no one but the address owner can spend or kill
// the owner's code. Guessing is bounded instead by the per-address try cap
// (triesPerAddressHour), of which one requester gets a share
// (triesPerAddressRequesterHour). codeTries is each code's own ceiling and
// is never reached first: a code lives inside one window.
export const SIGNUP_LIMITS = Object.freeze({
  codeTtlMs: 10 * 60 * 1000,
  liveCodes: 3,
  codeTries: 15,
  triesPerAddressHour: 15,
  triesPerAddressRequesterHour: 5,
  codesPerAddressHour: 3,
  codesPerMailboxHour: 3,
  codesPerDay: 500,
  dayMs: 24 * 60 * 60 * 1000,
  startsPerRequesterHour: 10,
  verifiesPerRequesterHour: 20,
  windowMs: 60 * 60 * 1000,
  passwordMin: 12,
  passwordMax: 256,
});

const MAX_ADDRESS = 254;
// M2 (security review): no control or format character anywhere (a
// zero-width or soft-hyphen character made a new address key for the same
// mailbox), and the local part is printable ASCII (no look-alike letters).
const ADDRESS = /^[^\s@\p{Cc}\p{Cf}]+@[^\s@\p{Cc}\p{Cf}]+\.[^\s@\p{Cc}\p{Cf}]+$/u;
const LOCAL = /^[\x21-\x7e]+@/;
const CODE = /^\d{6}$/;
// The one bucket with no key: every start counts toward the daily cap.
export const DAILY_BUCKET = "codes-day";
const CODE_SPACE = 1_000_000;
// A live code for one address; binds address_key, codeTries, now.
const LIVE = "address_key = ? AND used = 0 AND tries < ? AND expires_at > ?";

// The id of the live code whose digest is `digest`, or null. Every digest is
// compared, with no early exit, so how long this takes does not say which
// one matched.
function matchingId(live, digest) {
  let match = null;
  for (const row of live) {
    if (sameHex(digest, row.digest)) match = row.id;
  }
  return match;
}

export const hasOnly = (body, keys) => {
  const got = Object.keys(body);
  return got.length === keys.length && keys.every((k) => Object.hasOwn(body, k));
};

export function addressOf(value) {
  if (typeof value !== "string" || value.length > MAX_ADDRESS || !ADDRESS.test(value) || !LOCAL.test(value)) {
    throw new Refusal("shape", 400);
  }
  return value.toLowerCase();
}

// M2: the mailbox a tagged address delivers to, with the "+tag" stripped,
// for the start limit only (the account key stays the full address). An
// untagged address is its own mailbox and already has its own bucket, so
// this is null for it and a flood of tags never holds the plain address.
function taggedMailbox(address) {
  const at = address.lastIndexOf("@");
  const plus = address.indexOf("+");
  return plus >= 0 && plus < at ? `${address.slice(0, plus)}${address.slice(at)}` : null;
}

// M2: the global daily cap on codes, from HZ_CODES_PER_DAY when set. A value
// that is set but is not a whole number of 1 or more stops starts rather
// than opening the cap.
function codesPerDayOf(env) {
  const value = env.HZ_CODES_PER_DAY;
  if (value === undefined || value === null) return SIGNUP_LIMITS.codesPerDay;
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Refusal("unavailable", 503);
  }
  return n;
}

function passwordOf(value) {
  if (typeof value !== "string" || value.length < SIGNUP_LIMITS.passwordMin || value.length > SIGNUP_LIMITS.passwordMax) {
    throw new Refusal("shape", 400);
  }
  return value;
}

export async function keysOrUnavailable(env) {
  const keys = await accountKeys(env);
  if (!keys) throw new Refusal("unavailable", 503);
  return keys;
}

// The connecting address Cloudflare sets on every request through its edge.
// A request without one is refused as shape (security review L3) rather than
// counted under one requester that every such request would share.
export function requesterOf(request) {
  const ip = (request.headers.get("cf-connecting-ip") ?? "").trim();
  if (ip === "") throw new Refusal("shape", 400);
  return ip;
}

// A uniform 6-digit code: values past the last whole multiple of CODE_SPACE
// are drawn again, so no code is likelier than another.
function newCode() {
  const limit = Math.floor(2 ** 32 / CODE_SPACE) * CODE_SPACE;
  for (;;) {
    const [n] = crypto.getRandomValues(new Uint32Array(1));
    if (n < limit) return String(n % CODE_SPACE).padStart(6, "0");
  }
}

// Plain notes on state; the wording is the owner's to change.
function codeMessage(to, code, link) {
  const minutes = SIGNUP_LIMITS.codeTtlMs / 60_000;
  return {
    to,
    subject: "Horae Zone sign-up code",
    text: [
      `Sign-up code: ${code}`,
      `Works once. Expires ${minutes} minutes after it was sent.`,
      "",
      "Link for the device signing up:",
      link,
      "",
      "No account is made without this code.",
    ].join("\n"),
  };
}

// The mail runs after the answer and its audit row; a send that fails or
// throws is audited as mail-failed and changes nothing else.
function mailAfter(mailer, message) {
  return async () => {
    try {
      return (await mailer(message)) ? null : "mail-failed";
    } catch {
      return "mail-failed";
    }
  };
}

export async function startSignup({ db, body, now, env, request, mailer }) {
  if (!hasOnly(body, ["email"])) throw new Refusal("shape", 400);
  const address = addressOf(body.email);
  const ip = requesterOf(request);
  const keys = await keysOrUnavailable(env);
  if (!mailer) throw new Refusal("unavailable", 503);
  const codesPerDay = codesPerDayOf(env);
  let link;
  const code = newCode();
  try {
    link = fragmentLink(env.HZ_LINK_BASE, code);
  } catch {
    throw new Refusal("unavailable", 503);
  }
  const addressKey = await keys.addressKey(address);
  const requester = await keys.requesterKey(ip);
  const mailbox = taggedMailbox(address);
  const admitted = await admitThrottle(db, now, SIGNUP_LIMITS.windowMs, [
    { bucket: `start-requester:${requester}`, limit: SIGNUP_LIMITS.startsPerRequesterHour },
    { bucket: `start-address:${addressKey}`, limit: SIGNUP_LIMITS.codesPerAddressHour },
    ...(mailbox ? [{ bucket: `start-mailbox:${await keys.addressKey(mailbox)}`, limit: SIGNUP_LIMITS.codesPerMailboxHour }] : []),
    { bucket: DAILY_BUCKET, limit: codesPerDay, windowMs: SIGNUP_LIMITS.dayMs },
  ]);
  if (!admitted) throw new Refusal("slow-down", 429);
  const digest = await keys.codeDigest(addressKey, code);
  // A newer code joins the live ones and never replaces them; past
  // liveCodes no code is made or mailed (the start limit keeps that from
  // happening inside one window). M1 (security review): the account check
  // rides inside the same INSERT, so an address with an account runs the
  // same statement and the same write; its row is born spent (used = 1),
  // never verifies, and no mail goes out for it.
  const made = await db.prepare(
    `INSERT INTO challenge (address_key, digest, expires_at, tries, used)
     SELECT ?, ?, ?, 0, EXISTS (SELECT 1 FROM account WHERE address_key = ?)
     WHERE (SELECT COUNT(*) FROM challenge WHERE ${LIVE}) < ? RETURNING used`,
  ).bind(addressKey, digest, now + SIGNUP_LIMITS.codeTtlMs, addressKey, addressKey, SIGNUP_LIMITS.codeTries, now, SIGNUP_LIMITS.liveCodes).first();
  if (!made || made.used !== 0) return { status: 200, json: { ok: true } };
  return { status: 200, json: { ok: true }, after: mailAfter(mailer, codeMessage(address, code, link)) };
}

export async function verifySignup({ db, body, now, env, request }) {
  if (!hasOnly(body, ["email", "code", "password"])) throw new Refusal("shape", 400);
  const address = addressOf(body.email);
  if (typeof body.code !== "string" || !CODE.test(body.code)) throw new Refusal("shape", 400);
  const password = passwordOf(body.password);
  const ip = requesterOf(request);
  const keys = await keysOrUnavailable(env);
  const requester = await keys.requesterKey(ip);
  const addressKey = await keys.addressKey(address);
  const admitted = await admitThrottle(db, now, SIGNUP_LIMITS.windowMs, [
    { bucket: `verify-requester:${requester}`, limit: SIGNUP_LIMITS.verifiesPerRequesterHour },
    { bucket: `verify-address:${addressKey}`, limit: SIGNUP_LIMITS.triesPerAddressHour },
    { bucket: `verify-pair:${addressKey}:${requester}`, limit: SIGNUP_LIMITS.triesPerAddressRequesterHour },
  ]);
  if (!admitted) throw new Refusal("slow-down", 429);
  const digest = await keys.codeDigest(addressKey, body.code);
  // The try is counted on every live code before the compare.
  const { results: live } = await db.prepare(`UPDATE challenge SET tries = tries + 1 WHERE ${LIVE} RETURNING id, digest`)
    .bind(addressKey, SIGNUP_LIMITS.codeTries, now).all();
  const match = matchingId(live, digest);
  if (match === null) throw new Refusal("bad-code", 401);
  const spent = await db.prepare("UPDATE challenge SET used = 1 WHERE id = ? AND used = 0 RETURNING id").bind(match).first();
  if (!spent) throw new Refusal("bad-code", 401);
  const login = await keys.hashLogin(password);
  const box = await keys.sealAddress(address, addressKey);
  const id = crypto.randomUUID();
  const made = await db.prepare(
    "INSERT INTO account (id, address_key, address_box, login_hash, login_salt, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (address_key) DO NOTHING RETURNING id",
  ).bind(id, addressKey, box, login.hash, login.salt, now).first();
  // Only a race of two right tries reaches here without a row; it answers as
  // a spent code does.
  if (!made) throw new Refusal("bad-code", 401);
  return { status: 200, json: { ok: true } };
}
