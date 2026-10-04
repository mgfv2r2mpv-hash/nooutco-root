/**
 * A3, account + email (plan §3.3 "First device", steps 1 and 2).
 *
 * POST /account {email} mails a single-use link to an address that has no
 * account yet, and answers {ok:true} either way, so no answer says whether an
 * address already has an account. The link's fragment, which a browser never
 * sends to a server, carries the code: a 128-bit random token in base64url
 * (second security review: a 6-digit code was guessable, so it needed tight
 * per-address caps that a stranger could fill to lock the owner out). The
 * mail shows no code to type. One link is live for an address at a time: a
 * start mints one when none is live and otherwise mails the live one again
 * (third review, item 2), so a stranger's starts never leave the owner
 * without a working link.
 *
 * POST /account/email/verify {email, code, password, keyDigest} makes the
 * account only when the code is a live one for that address (a start never
 * ends it). Each try is reserved in the throttle before the compare (so
 * parallel guesses cannot pass the try limits), the compare is sameHex over
 * keyed digests against every live code, and a code is spent by the first
 * right try.
 *
 * OWNER DEVICE (A5 re-review, root rule: ownership comes from the email
 * inbox, not the password). The verify answers {ok, ticket}: the one ticket
 * that registers the account's first device, the owner device
 * (src/devices.js), bound to the keys keyDigest names, as a /signin ticket
 * is (security review M3). The account and its owner ticket are written in
 * one batch, so an account never exists without one. A password-only
 * /signin on an account with no device registers nothing (src/signin.js).
 *
 * The limits below are the agent's safe defaults, listed for the owner in the
 * design review ("Decisions for Kaleb"): the plan does not fix them.
 */
import { sameHex } from "../../../packages/account-engine/src/limits.mjs";
import { fragmentLink } from "../../../packages/account-engine/src/mailer.mjs";
import { Refusal, b64url } from "./checks.js";
import { accountKeys } from "./account-keys.js";
import { admitThrottle } from "./throttle.js";

// SHA-256, base64url without padding: the digest of the two public keys a
// ticket may register (src/devices.js deviceKeyDigest).
export const KEY_DIGEST = /^[A-Za-z0-9_-]{43}$/;
const isKeyDigest = (value) => typeof value === "string" && KEY_DIGEST.test(value);
// The owner ticket the verify hands out, as a /signin ticket: 32 random
// bytes, live OWNER_TICKET_TTL_MS, stored only as a keyed digest.
export const OWNER_TICKET_TTL_MS = 5 * 60 * 1000;
const TICKET_BYTES = 32;

// H1 (security review): a start never ends a live code and a wrong guess
// never ends one either, so no one but the address owner can spend or kill
// the owner's code. Second review, item 2: with a 128-bit token no cap is
// needed to stop guessing, so there is no address-level try cap and no
// per-code try ceiling (either was a cap a stranger could fill to lock the
// owner out). Tries stay capped per requester and per (address, requester)
// pair, which bounds load, not guessing. Third review, item 2: a per-address
// mint cap let strangers use up the hour's links, so once those expired the
// owner's start mailed nothing. A start now mints whenever no link is live for
// the address (one live at a time, so at most windowMs / codeTtlMs, 6, an
// hour) and otherwise re-sends the live one, at most resendsPerAddressHour
// times an hour: mail to one address is bounded at 6 + 3 an hour, and every
// live link has been mailed to the address. A tagged address also needs a
// place in codesPerMailboxHour to mint. Item 5: codesPerDay is the hard cap,
// the mail plan's daily limit (3000, or HZ_CODES_PER_DAY), and at
// alertAtPercent of it one alert a day goes to HZ_ALERT_TO.
export const SIGNUP_LIMITS = Object.freeze({
  codeTtlMs: 10 * 60 * 1000,
  triesPerAddressRequesterHour: 5,
  codesPerMailboxHour: 10,
  resendsPerAddressHour: 3,
  codesPerDay: 3000,
  alertAtPercent: 50,
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
// The code: CODE_BYTES random bytes in base64url, no padding.
const CODE_BYTES = 16;
const CODE = /^[A-Za-z0-9_-]{22}$/;
// The one bucket with no key: every start counts toward the daily cap.
export const DAILY_BUCKET = "codes-day";
// Item 5: a row here means the half-cap alert went out in the last day.
export const ALERT_BUCKET = "alert-day";
// A live code for one address; binds address_key, now.
const LIVE = "address_key = ? AND used = 0 AND expires_at > ?";
// Any code for one address inside its life, live or spent (an address with
// an account holds a spent one); binds address_key, now. While one is there,
// a start re-sends instead of minting.
const UNEXPIRED = "address_key = ? AND expires_at > ?";

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
  const at = value.lastIndexOf("@");
  const address = `${value.slice(0, at).toLowerCase()}@${dnsNameOf(value.slice(at + 1))}`;
  if (address.length > MAX_ADDRESS) throw new Refusal("shape", 400);
  return address;
}

// Item 6 (second security review): the domain as its DNS name, so every
// spelling of one domain is one address key. One trailing dot (the DNS root)
// is stripped, then the URL parser maps it to ASCII (IDNA: lower case,
// full-width letters, composed accents, punycode), and every label of the
// result is letters, digits and inner hyphens. A domain with any other
// character, an empty label or an all-digit top label is refused.
const DOMAIN_CHARS = /^[\p{L}\p{M}\p{N}.-]+$/u;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_DOMAIN = 253;

function dnsNameOf(domain) {
  const bare = domain.endsWith(".") ? domain.slice(0, -1) : domain;
  if (!DOMAIN_CHARS.test(bare)) throw new Refusal("shape", 400);
  let name;
  try {
    name = new URL(`http://${bare}`).hostname;
  } catch {
    throw new Refusal("shape", 400);
  }
  const labels = name.split(".");
  if (name.length > MAX_DOMAIN || labels.length < 2 || !labels.every((l) => DNS_LABEL.test(l)) || /^\d+$/.test(labels.at(-1))) {
    throw new Refusal("shape", 400);
  }
  return name;
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

// M2: the global daily cap on codes, from HZ_CODES_PER_DAY when set (item 5:
// the mail plan's daily limit, default 3000). A value
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

// A 128-bit random token, too many values to guess at any rate a cap allows.
function newCode() {
  return b64url(crypto.getRandomValues(new Uint8Array(CODE_BYTES)));
}

// Plain notes on state; the wording is the owner's to change. `msLeft` is
// the link's remaining life (a re-sent link has less than a new one).
function codeMessage(to, link, msLeft) {
  const minutes = Math.ceil(msLeft / 60_000);
  return {
    to,
    subject: "Horae Zone sign-up link",
    text: [
      "Link for the device signing up:",
      link,
      "",
      `Works once. Expires within ${minutes} minutes.`,
      "No account is made without this link.",
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

function linkOf(env, code) {
  try {
    return fragmentLink(env.HZ_LINK_BASE, code);
  } catch {
    throw new Refusal("unavailable", 503);
  }
}

// Third review, item 2: a new code only when the address has no code inside
// its life, checked in the same INSERT, so two starts together cannot both
// mint. M1 (security review): the account check rides inside the same
// INSERT, so an address with an account runs the same statement and the
// same write; its row is born spent (used = 1), never verifies and is never
// mailed. Returns { made, sent }; sent is the code to mail when the row is live.
async function mintCode(db, keys, addressKey, now) {
  const code = newCode();
  const digest = await keys.codeDigest(addressKey, code);
  const box = await keys.sealLink(code, addressKey);
  const row = await db.prepare(
    `INSERT INTO challenge (address_key, digest, link_box, expires_at, tries, used)
     SELECT ?, ?, ?, ?, 0, EXISTS (SELECT 1 FROM account WHERE address_key = ?)
     WHERE NOT EXISTS (SELECT 1 FROM challenge WHERE ${UNEXPIRED}) RETURNING used`,
  ).bind(addressKey, digest, box, now + SIGNUP_LIMITS.codeTtlMs, addressKey, addressKey, now).first();
  if (!row) return { made: false, sent: null };
  return { made: true, sent: row.used === 0 ? { code, msLeft: SIGNUP_LIMITS.codeTtlMs } : null };
}

// The live code for the address, to mail again, or null. Every start that
// does not mint takes a place in the re-send bucket before the lookup, mailed
// or not, so an address with an account inside a code's life (its code is
// spent) runs the same statements as one with a live code (M1).
async function resendCode(db, keys, addressKey, mailboxKey, now) {
  const admitted = await admitThrottle(db, now, SIGNUP_LIMITS.windowMs, [
    { bucket: `resend-address:${addressKey}`, limit: SIGNUP_LIMITS.resendsPerAddressHour },
    ...(mailboxKey ? [{ bucket: `resend-mailbox:${mailboxKey}`, limit: SIGNUP_LIMITS.resendsPerAddressHour }] : []),
  ]);
  if (!admitted) return null;
  const row = await db.prepare(`SELECT link_box, expires_at FROM challenge WHERE ${LIVE} AND link_box IS NOT NULL ORDER BY id DESC LIMIT 1`)
    .bind(addressKey, now).first();
  if (!row) return null;
  try {
    return { code: await keys.openLink(row.link_box, addressKey), msLeft: row.expires_at - now };
  } catch {
    // Sealed under another secret: its digest is under that secret too, so
    // the code could not verify, and there is no live link to send.
    return null;
  }
}

// Item 5: true for the one start that brings the day's count to
// alertAtPercent of the cap while no alert went out in the last day. One
// statement checks both and takes the alert row, so two starts together
// cannot both alert. Every start past the first step runs it, so the M1
// statements still match.
async function takeAlert(db, now, codesPerDay) {
  const threshold = Math.ceil((codesPerDay * SIGNUP_LIMITS.alertAtPercent) / 100);
  const since = now - SIGNUP_LIMITS.dayMs;
  const row = await db.prepare(
    `INSERT INTO throttle (bucket, at) SELECT ?, ?
     WHERE (SELECT COUNT(*) FROM throttle WHERE bucket = ? AND at > ?) >= ?
     AND NOT EXISTS (SELECT 1 FROM throttle WHERE bucket = ? AND at > ?) RETURNING bucket`,
  ).bind(ALERT_BUCKET, now, DAILY_BUCKET, since, threshold, ALERT_BUCKET, since).first();
  return row ? threshold : null;
}

// The operator's address from HZ_ALERT_TO (set at deploy, never in the
// repo), or null when it is unset or not an address.
function alertAddressOf(env) {
  try {
    return addressOf(env.HZ_ALERT_TO);
  } catch {
    return null;
  }
}

// Plain notes on state; it names no address and no requester.
function alertMessage(to, reached, codesPerDay) {
  return {
    to,
    subject: "Horae Zone sign-ups at half the daily cap",
    text: [
      `Sign-up starts in the last 24 hours reached ${reached}, half the daily cap of ${codesPerDay}.`,
      "At the cap, new sign-up starts answer slow-down until the 24-hour count falls.",
      "No other alert is sent for 24 hours.",
    ].join("\n"),
  };
}

// Item 5: the alert's after-work. A missing or bad HZ_ALERT_TO is audited
// alert-unset, a send that fails or throws alert-failed.
function alertAfter(env, mailer, reached, codesPerDay) {
  const to = alertAddressOf(env);
  if (!to) return async () => "alert-unset";
  return async () => {
    try {
      return (await mailer(alertMessage(to, reached, codesPerDay))) ? null : "alert-failed";
    } catch {
      return "alert-failed";
    }
  };
}

// The link mail, then the alert; each failure is a reason for the audit.
function afterAll(works) {
  return async () => {
    const reasons = [];
    for (const work of works) {
      const reason = await work();
      if (reason) reasons.push(reason);
    }
    return reasons;
  };
}

export async function startSignup({ db, body, now, env, request, mailer }) {
  if (!hasOnly(body, ["email"])) throw new Refusal("shape", 400);
  const address = addressOf(body.email);
  const ip = requesterOf(request);
  const keys = await keysOrUnavailable(env);
  if (!mailer) throw new Refusal("unavailable", 503);
  const codesPerDay = codesPerDayOf(env);
  linkOf(env, newCode()); // a link base that cannot carry a link stops the start before any write
  const addressKey = await keys.addressKey(address);
  const requester = await keys.requesterKey(ip);
  const mailbox = taggedMailbox(address);
  const mailboxKey = mailbox ? await keys.addressKey(mailbox) : null;
  // The requester's own cap and the daily cap refuse a start outright.
  const counted = await admitThrottle(db, now, SIGNUP_LIMITS.windowMs, [
    { bucket: `start-requester:${requester}`, limit: SIGNUP_LIMITS.startsPerRequesterHour },
    { bucket: DAILY_BUCKET, limit: codesPerDay, windowMs: SIGNUP_LIMITS.dayMs },
  ]);
  if (!counted) throw new Refusal("slow-down", 429);
  const alerted = await takeAlert(db, now, codesPerDay);
  // Nothing past here refuses. A tagged address mints only inside its
  // mailbox's cap; any start that does not mint re-sends the live link.
  const mints = mailboxKey
    ? await admitThrottle(db, now, SIGNUP_LIMITS.windowMs, [{ bucket: `start-mailbox:${mailboxKey}`, limit: SIGNUP_LIMITS.codesPerMailboxHour }])
    : true;
  const minted = mints ? await mintCode(db, keys, addressKey, now) : { made: false, sent: null };
  const sent = minted.made ? minted.sent : await resendCode(db, keys, addressKey, mailboxKey, now);
  const works = [
    ...(sent ? [mailAfter(mailer, codeMessage(address, linkOf(env, sent.code), sent.msLeft))] : []),
    ...(alerted ? [alertAfter(env, mailer, alerted, codesPerDay)] : []),
  ];
  if (works.length === 0) return { status: 200, json: { ok: true } };
  return { status: 200, json: { ok: true }, after: afterAll(works) };
}

export async function verifySignup({ db, body, now, env, request }) {
  if (!hasOnly(body, ["email", "code", "password", "keyDigest"])) throw new Refusal("shape", 400);
  const address = addressOf(body.email);
  if (typeof body.code !== "string" || !CODE.test(body.code)) throw new Refusal("shape", 400);
  const password = passwordOf(body.password);
  if (!isKeyDigest(body.keyDigest)) throw new Refusal("shape", 400);
  const ip = requesterOf(request);
  const keys = await keysOrUnavailable(env);
  const requester = await keys.requesterKey(ip);
  const addressKey = await keys.addressKey(address);
  const admitted = await admitThrottle(db, now, SIGNUP_LIMITS.windowMs, [
    { bucket: `verify-requester:${requester}`, limit: SIGNUP_LIMITS.verifiesPerRequesterHour },
    { bucket: `verify-pair:${addressKey}:${requester}`, limit: SIGNUP_LIMITS.triesPerAddressRequesterHour },
  ]);
  if (!admitted) throw new Refusal("slow-down", 429);
  const digest = await keys.codeDigest(addressKey, body.code);
  // The try is counted on every live code (a record only: no count ends a
  // code) before the compare.
  const { results: live } = await db.prepare(`UPDATE challenge SET tries = tries + 1 WHERE ${LIVE} RETURNING id, digest`)
    .bind(addressKey, now).all();
  const match = matchingId(live, digest);
  if (match === null) throw new Refusal("bad-code", 401);
  const spent = await db.prepare("UPDATE challenge SET used = 1, link_box = NULL WHERE id = ? AND used = 0 RETURNING id").bind(match).first();
  if (!spent) throw new Refusal("bad-code", 401);
  const login = await keys.hashLogin(password);
  const box = await keys.sealAddress(address, addressKey);
  const id = crypto.randomUUID();
  const ticket = b64url(crypto.getRandomValues(new Uint8Array(TICKET_BYTES)));
  // One batch: the owner ticket is written only beside the account this
  // verify made (never one an earlier race made), and never without it.
  await db.batch([
    db.prepare(
      "INSERT INTO account (id, address_key, address_box, login_hash, login_salt, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (address_key) DO NOTHING",
    ).bind(id, addressKey, box, login.hash, login.salt, now),
    db.prepare(
      "INSERT INTO ticket (digest, account_id, key_digest, expires_at, used, owner) SELECT ?, ?, ?, ?, 0, 1 WHERE EXISTS (SELECT 1 FROM account WHERE id = ? AND address_key = ?)",
    ).bind(await keys.ticketDigest(ticket), id, body.keyDigest, now + OWNER_TICKET_TTL_MS, id, addressKey),
  ]);
  const made = await db.prepare("SELECT 1 AS yes FROM account WHERE id = ?").bind(id).first();
  // Only a race of two right tries reaches here without a row; it answers as
  // a spent code does.
  if (!made) throw new Refusal("bad-code", 401);
  return { status: 200, json: { ok: true, ticket } };
}
