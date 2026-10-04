/**
 * A5, the code check (plan §3.1, §3.6 /unlock/start, /unlock/finish and
 * /unlock/reopen). The device proves the account's code with CPace (the
 * engine's pake.mjs), keyed by the code under unlockChannelFor(device), so
 * the code never crosses the wire. Start and finish are signed by the same
 * registered device; a pending device may use them (src/routes.js) once the
 * owner device's first accepted code has confirmed the enrolment, and before
 * that answers not-enrolled (A5 re-review, item 2).
 *
 *   /unlock/start  {sid, Ya, clock}   -> {exchange, replies: [{Yb, tagB}] x2}
 *   /unlock/finish {exchange, tagA}   -> {ticket}
 *   /unlock/reopen {token}            -> {ok: true}
 *
 * STEPS. The service offers the current 30-second step and the previous one,
 * never the next (zero forward drift, one step back), and never a step at or
 * before the account's last accepted one. A step it withholds is still
 * answered, with a reply for a random code, so both answers look alike. A
 * code is accepted by one atomic update of last_step, so of two exchanges
 * proving one code only the first finished is accepted, on any device.
 *
 * CUSTODY. An exchange row keeps only keyed digests of the tagA values the
 * service expects (src/account-keys.js tagDigest), compared with sameHex. It
 * dies at CONFIRM_MS, the lockout's confirm time, and is spent by its first
 * finish, from its own device only. Every refusal at finish is bad-code: a
 * wrong code, an unknown, spent or expired exchange, another device's. The
 * one other answer is locked, when the path closed after the start (A5
 * security review item 5).
 *
 * REMOVAL (security review L2). The exchange insert, the exchange spend, the
 * last_step update and the pending clear each re-check in the same statement
 * that the device is not removed, so a removal that lands mid-flight answers
 * no-device: no exchange, no accepted code where the spend or the step update
 * noticed it, and never a ticket. A start or exchange left unfinished that
 * way ages past CONFIRM_MS and counts as a try, as any abandoned one does.
 *
 * TICKET. The service's ECDSA P-256 signature (Worker secret HZ_TICKET_KEY,
 * a private JWK) over `${TICKET_LABEL}.${payload}`, the payload base64url
 * JSON {v, account, device, at, exp, jti, kid}: jti is 128 random bits, kid
 * the RFC 7638 thumbprint of the public key (A5 security review item 4). The
 * A5b verifier must record each jti as spent and accept a ticket only on a
 * request the ticket's device signed. The limits below are the agent's safe
 * defaults, listed for the owner in the design review: the plan does not fix
 * them.
 */
import { sameHex, admit, confirm, reject, CONFIRM_MS, DAY_MS } from "../../../packages/account-engine/src/limits.mjs";
import { fragmentLink } from "../../../packages/account-engine/src/mailer.mjs";
import { responderReply, unlockChannelFor } from "../../../packages/account-engine/src/pake.mjs";
import { hotp, windowOf, clockOffset } from "../../../packages/account-engine/src/totp.mjs";
import { ristretto255 } from "../../../packages/account-engine/vendor/noble/curves/ed25519.js";
import { Refusal, LIVE_DEVICE, ACCOUNT_CHANGER, b64url, fromB64url, findDevice } from "./checks.js";
import { hasOnly, keysOrUnavailable } from "./signup.js";
import { openSeed, seedBoxKey } from "./otp.js";
import {
  ruleLimits, pathClosed, lockNotes, mailAfter, reopenedNote, spendReopen, pendingNotes, settleCapped, capDay, dayHasRoom,
} from "./lockout.js";

export const UNLOCK_LIMITS = Object.freeze({
  ticketTtlMs: 5 * 60 * 1000,
});
// Tries a pending device gets in any 24 hours, a right code included
// (security review item 2). An owner's new device needs one; three allow for
// a mistyped code or a code that changed mid-entry.
export const PENDING_TRIES_PER_DAY = 3;
// Tries all the pending devices of one account get between them in any 24
// hours, counted by account id (A5 re-review item 3), so registering more
// devices with a stolen password buys no more guesses.
export const PENDING_TRIES_PER_ACCOUNT_DAY = 6;
export const TICKET_LABEL = "horae-zone-unlock-ticket-v1";

const SID = /^[A-Za-z0-9_-]{22}$/;
const POINT = /^[A-Za-z0-9_-]{43}$/;
const EXCHANGE = /^[A-Za-z0-9_-]{22}$/;
const TAG = /^[A-Za-z0-9_-]{43}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const EXCHANGE_BYTES = 16;
const JTI_BYTES = 16;
const CODE_SPACE = 1_000_000;
const enc = new TextEncoder();

// A ristretto255 point a CPace reply can be built on: a valid encoding that is
// not the identity.
function isPoint(bytes) {
  try {
    return !ristretto255.Point.fromBytes(bytes).is0();
  } catch {
    return false;
  }
}

function startBody(body) {
  if (!hasOnly(body, ["sid", "Ya", "clock"])) throw new Refusal("shape", 400);
  if (typeof body.sid !== "string" || !SID.test(body.sid) || typeof body.Ya !== "string" || !POINT.test(body.Ya)) throw new Refusal("shape", 400);
  if (!Number.isSafeInteger(body.clock)) throw new Refusal("shape", 400);
  const sid = fromB64url(body.sid);
  const Ya = fromB64url(body.Ya);
  if (sid.length !== 16 || Ya.length !== 32 || !isPoint(Ya)) throw new Refusal("shape", 400);
  return { sid, Ya, clock: body.clock };
}

// The signing key and its kid, the RFC 7638 thumbprint of the public half:
// base64url SHA-256 over {crv, kty, x, y} in that order, no spaces. A
// verifier holding several public keys (a rotation) picks one by kid.
async function ticketKey(env) {
  try {
    const jwk = JSON.parse(env.HZ_TICKET_KEY);
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const { crv, kty, x, y } = jwk;
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(JSON.stringify({ crv, kty, x, y })));
    return { key, kid: b64url(new Uint8Array(digest)) };
  } catch {
    return null;
  }
}

export function reopenBaseOk(base) {
  try {
    fragmentLink(base, "x");
    return true;
  } catch {
    return false;
  }
}

// Everything a code try needs, checked before anything is admitted or
// stored; a missing or bad value answers unavailable.
async function configOrUnavailable(env, mailer) {
  const [seedKey, signKey] = await Promise.all([seedBoxKey(env), ticketKey(env)]);
  if (!seedKey || !signKey || !mailer || !reopenBaseOk(env.HZ_REOPEN_BASE)) throw new Refusal("unavailable", 503);
  return { keys: await keysOrUnavailable(env), signKey, reopenBase: env.HZ_REOPEN_BASE };
}

// Any 6-digit code, for the reply to a step the service withholds.
function randomCode() {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return String(n % CODE_SPACE).padStart(6, "0");
}

// A try by a device that has proved the code: admitted into the account's
// lockout, whose events become the mail sent after the answer. The day cap
// (A5 re-review item 4) closes the path at the 12th wrong code of the day and
// admits no more tries in flight than the day has left.
async function admitAccountTry({ db, device, now, exchange, clock, keys, mailer, reopenBase }) {
  const clockOffMs = clockOffset(clock, now);
  const ruled = await ruleLimits(db, device.account_id, now, (state) => {
    const settled = settleCapped(state, now);
    if (!settled.state.pathLocked && !dayHasRoom(settled.state, now)) return { ...settled, ok: false };
    const admitted = admit(settled.state, now, exchange, { clockOffMs });
    return { state: admitted.state, ok: admitted.ok, events: settled.events };
  });
  const after = mailAfter({ db, keys, mailer, accountId: device.account_id, notes: lockNotes(ruled.events, ruled.token, reopenBase) });
  if (!ruled.ok) throw new Refusal("locked", 423, after);
  return after;
}

// A try by a pending device (security review item 2). It has shown only the
// password, so its tries count in pending_try, against its own cap and the
// cap all the account's pending devices share (A5 re-review item 3), and
// never in the account's lockout: a password thief cannot lock the owner's
// devices out. A closed path refuses it too, and spends none of its tries.
// The counts and the insert are one statement, so tries arriving together,
// from one device or several, cannot pass either cap. A try refused at a cap
// mails the owner the pending note, at most one an hour, so tries started
// and never finished still reach the owner once the cap is spent.
async function admitPendingTry({ db, device, now, keys, mailer }) {
  if (await pathClosed(db, device.account_id)) throw new Refusal("locked", 423);
  const since = now - DAY_MS;
  const counted = await db.prepare(
    `INSERT INTO pending_try (device_id, account_id, at) SELECT ?, ?, ? WHERE ${LIVE_DEVICE}
     AND (SELECT COUNT(*) FROM pending_try WHERE device_id = ? AND at > ?) < ?
     AND (SELECT COUNT(*) FROM pending_try WHERE account_id = ? AND at > ?) < ? RETURNING device_id`,
  ).bind(
    device.id, device.account_id, now, device.id,
    device.id, since, PENDING_TRIES_PER_DAY,
    device.account_id, since, PENDING_TRIES_PER_ACCOUNT_DAY,
  ).first();
  if (!counted) {
    await findDevice(db, device.id); // refuses no-device when the removal is what stopped it
    const notes = await pendingNotes(db, device.account_id, now, PENDING_TRIES_PER_ACCOUNT_DAY);
    throw new Refusal("locked", 423, mailAfter({ db, keys, mailer, accountId: device.account_id, notes }));
  }
  return undefined;
}

export async function startUnlock({ db, device, body, now, env, mailer }) {
  const { sid, Ya, clock } = startBody(body);
  const { keys, reopenBase } = await configOrUnavailable(env, mailer);
  const otp = await db.prepare("SELECT box, last_step, enrolment, confirmed_by FROM otp WHERE account_id = ?").bind(device.account_id).first();
  // A pending device has nothing to prove until the owner device's first
  // accepted code confirms the enrolment (A5 re-review, item 2), so it can
  // never confirm the enrolment and hold the owner device back.
  if (!otp || (device.pending && otp.confirmed_by === null)) throw new Refusal("not-enrolled", 409);
  const exchange = b64url(crypto.getRandomValues(new Uint8Array(EXCHANGE_BYTES)));
  const after = device.pending
    ? await admitPendingTry({ db, device, now, keys, mailer })
    : await admitAccountTry({ db, device, now, exchange, clock, keys, mailer, reopenBase });

  const seed = await openSeed(env, device.account_id, otp.box);
  const channel = unlockChannelFor(device.id);
  const step = windowOf(now);
  const replies = [];
  const candidates = [];
  for (const s of [step, step - 1]) {
    const offered = s > otp.last_step;
    const { replies: [reply], pending: [expect] } = responderReply({ codes: [offered ? hotp(seed, s) : randomCode()], channel, sid, Ya });
    replies.push({ Yb: b64url(reply.Yb), tagB: b64url(reply.tagB) });
    if (offered) candidates.push({ step: s, digest: await keys.tagDigest(exchange, b64url(expect.tagA)) });
  }
  seed.fill(0);
  const stored = await db.prepare(
    `INSERT INTO exchange (id, account_id, device_id, candidates, expires_at, used, enrolment) SELECT ?, ?, ?, ?, ?, 0, ? WHERE ${LIVE_DEVICE} RETURNING id`,
  ).bind(exchange, device.account_id, device.id, JSON.stringify(candidates), now + CONFIRM_MS, otp.enrolment, device.id).first();
  if (!stored) throw new Refusal("no-device", 401, after);
  return { status: 200, json: { exchange, replies }, after };
}


// jti is 128 random bits, new on every ticket, so the verifier can record a
// ticket as spent (A5 security review item 4).
async function signTicket(signKey, claims) {
  const jti = b64url(crypto.getRandomValues(new Uint8Array(JTI_BYTES)));
  const payload = b64url(enc.encode(JSON.stringify({ ...claims, jti, kid: signKey.kid })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signKey.key, enc.encode(`${TICKET_LABEL}.${payload}`));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

// The step whose expected tag matches, or null. Every candidate is compared,
// so the time taken does not say which one matched.
function matchedStep(candidates, digest) {
  let step = null;
  for (const c of candidates) if (sameHex(digest, c.digest)) step = c.step;
  return step;
}

// Settles the account's lockout and says whether the path is closed (A5
// security review item 5). A start admitted while the path was open can
// finish after other tries closed it: that finish is refused before its code
// is compared, and its try is dropped from the lockout uncounted, since no
// code was compared. A closed path whose link has died gets a new one, as at
// start.
async function closedAtFinish(db, accountId, now, exchange) {
  return ruleLimits(db, accountId, now, (state) => {
    const settled = settleCapped(state, now);
    const closed = settled.state.pathLocked;
    return { state: closed ? confirm(settled.state, exchange) : settled.state, events: settled.events, closed };
  });
}

export async function finishUnlock({ db, device, body, now, env, mailer }) {
  if (!hasOnly(body, ["exchange", "tagA"])) throw new Refusal("shape", 400);
  if (typeof body.exchange !== "string" || !EXCHANGE.test(body.exchange) || typeof body.tagA !== "string" || !TAG.test(body.tagA)) {
    throw new Refusal("shape", 400);
  }
  const { keys, signKey, reopenBase } = await configOrUnavailable(env, mailer);
  const row = await db.prepare(
    `UPDATE exchange SET used = 1 WHERE id = ? AND device_id = ? AND used = 0 AND expires_at > ? AND ${LIVE_DEVICE} RETURNING account_id, candidates, enrolment`,
  ).bind(body.exchange, device.id, now, device.id).first();
  if (!row) {
    await findDevice(db, device.id); // refuses no-device when the removal is what stopped it
    throw new Refusal("bad-code", 401);
  }
  const gate = await closedAtFinish(db, row.account_id, now, body.exchange);
  const gateNotes = lockNotes(gate.events, gate.token, reopenBase);
  if (gate.closed) throw new Refusal("locked", 423, mailAfter({ db, keys, mailer, accountId: row.account_id, notes: gateNotes }));
  const step = matchedStep(JSON.parse(row.candidates), await keys.tagDigest(body.exchange, body.tagA));
  // A code is accepted once: only an update that moves last_step forward wins,
  // only while the device is not removed (security review L2), and only on
  // the enrolment the exchange was built on (A5 security review item 3). The
  // first accepted code confirms the enrolment, and the otp_confirmed trigger
  // (schema.sql) holds back every other live device in the same write. Only
  // the owner device confirms it (A5 re-review, item 2): before then, the
  // update also requires a device that may change the account.
  const accepted = step !== null && Boolean(await db.prepare(
    `UPDATE otp SET last_step = ?, confirmed_by = COALESCE(confirmed_by, ?) WHERE account_id = ? AND last_step < ? AND enrolment = ? AND ${LIVE_DEVICE}
     AND (confirmed_by IS NOT NULL OR ${ACCOUNT_CHANGER}) RETURNING account_id`,
  ).bind(step, device.id, row.account_id, step, row.enrolment, device.id, device.id).first());
  if (!accepted) await findDevice(db, device.id);
  const ruled = await ruleLimits(db, row.account_id, now, (state) => {
    const settled = settleCapped(state, now);
    if (accepted) return { state: confirm(settled.state, body.exchange), events: settled.events };
    const rejected = reject(settled.state, now, body.exchange);
    return capDay(settled.state, { state: rejected.state, events: [...settled.events, ...rejected.events] }, now);
  });
  // A wrong try by a pending device mails the owner (A5 re-review item 3).
  const pendingWrong = !accepted && device.pending ? await pendingNotes(db, row.account_id, now, PENDING_TRIES_PER_ACCOUNT_DAY) : [];
  const notes = [...gateNotes, ...lockNotes(ruled.events, ruled.token, reopenBase), ...pendingWrong];
  const after = mailAfter({ db, keys, mailer, accountId: row.account_id, notes });
  if (!accepted) throw new Refusal("bad-code", 401, after);
  const cleared = await db.prepare("UPDATE device SET pending = 0 WHERE id = ? AND removed_at IS NULL RETURNING id").bind(device.id).first();
  if (!cleared) throw new Refusal("no-device", 401, after);
  const ticket = await signTicket(signKey, { v: 1, account: row.account_id, device: device.id, at: now, exp: now + UNLOCK_LIMITS.ticketTtlMs });
  return { status: 200, json: { ticket }, after };
}

// The link reopens the code path and nothing else: no ticket, key or seed.
// An unknown, spent or expired token answers bad-link alike.
export async function reopenUnlock({ db, body, now, env, mailer }) {
  if (!hasOnly(body, ["token"]) || typeof body.token !== "string" || !TOKEN.test(body.token)) throw new Refusal("shape", 400);
  const keys = await keysOrUnavailable(env);
  if (!mailer) throw new Refusal("unavailable", 503);
  const accountId = await spendReopen(db, now, body.token);
  if (!accountId) throw new Refusal("bad-link", 401);
  return { status: 200, json: { ok: true }, after: mailAfter({ db, keys, mailer, accountId, notes: [reopenedNote()] }) };
}
