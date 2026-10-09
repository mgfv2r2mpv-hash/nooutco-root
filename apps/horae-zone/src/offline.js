/**
 * Offline unlock, the service half (sass-assistant design of 8 Oct 2026,
 * section 1, Option C, approved for building).
 *
 *   /offline/grant  {ticket, hours, jti}           -> {ok: true, pass}
 *   /offline/report {jti, opens, wrongPins, head}  -> {ok: true, receipt}
 *
 * THE PASS. After a good code, the Mac asks for a pass on purpose. The body
 * carries the fresh unlock ticket that code earned (read by src/pin.js
 * readTicket, spent once by spendTicket, whose trigger moves this device's
 * proved_at as an open's does), how many hours the pass should last, and a
 * jti the Mac chose, so the Mac knows the pass's name even when the answer
 * never reaches it. The pass is base64url JSON
 *   {v: 1, typ: "offline-pass", kid, account, device, at, until, jti, maxOpens}
 * signed with HZ_TICKET_KEY over `${PASS_LABEL}.${payload}`. A label of its
 * own, so a pass can never be read as an unlock ticket (TICKET_LABEL) or a
 * PIN grant (GRANT_LABEL), and neither of those as a pass. `at` is the
 * ticket's own time and `until` at most OFFLINE_LIMITS.maxHours after it,
 * whatever `hours` asked. The Mac checks the PIN, the count of opens and the
 * trusted clock itself; the service cannot see an offline open.
 *
 * THE REPORT GATE. One row per pass (offline_pass). While this device holds a
 * pass with no report, a grant answers report-due before the ticket is read
 * as spent, so the code is not used up by the refusal. Every pass needs its
 * report, an unused one included; the Mac sends it the first time it reaches
 * the service after the pass was used, expired, blocked or replaced.
 *
 * A MAC THAT LOST ITS RECORD (option c, the ringleader's call on Pollux's
 * cross-PR finding of 9 Oct 2026). sass #309's vault transfer clears the
 * Mac's offline record but keeps its Horae identity, and the Mac can report
 * only from a record, so its unreported pass would hold it back for good. A
 * grant whose ticket is fresh (its code proved after that pass was issued)
 * and not yet spent re-proves the Mac, and it supersedes the device's own
 * unreported pass: superseded_at is set, reported_at stays null (a
 * superseded pass is never counted as reported, and no count of opens is
 * made up for it), the request's audit row says superseded, the account is
 * mailed SUPERSEDED_NOTE, and the new pass is issued. A code no newer than
 * the pass, or one already spent, still answers report-due before anything
 * is spent. Another device's pass is never touched, and a locked account
 * never reaches the handler (the route is not lockedOk).
 *
 * THE REPORT. The jti, each offline open as {seq, at} with seq running from 1,
 * the count of wrong PINs (at most 10: the tenth deletes the pass on the Mac)
 * and `head`, the log's chain: SHA-256 over `${LOG_LABEL}.${jti}`, then over
 * the previous head's 32 bytes and `${seq}.${at}` for each open, base64url.
 * The service recomputes the head and answers bad-log when it differs. The
 * report marks this device's pass with that jti, once; a second report of it,
 * or a report of a jti this device was never issued (a grant whose answer the
 * Mac lost and the service never wrote), marks nothing. Either way the answer
 * is a receipt, {v: 1, typ: "offline-receipt", kid, account, device, jti}
 * signed over `${RECEIPT_LABEL}.${payload}`, which the Mac verifies before it
 * deletes its record, so the page cannot tell the Mac a report went in.
 * Ten wrong PINs lock the account as /pin/blocked does (src/account-lock.js
 * lockForBlock), and the route passes a lock (lockedOk), so a blocked Mac can
 * still report and get its receipt.
 *
 * MAIL. Every pass mails the account one plain note, and a report of opens
 * another. Neither names a time, a count or a device, the A5b rule. Without a
 * mailer or the account keys a grant answers unavailable before anything is
 * spent, so no pass goes unannounced, and a report that owes a note answers
 * unavailable and marks nothing.
 *
 * CUSTODY. Rows keep the jti, the times, the cap and the two counts. Never the
 * pass, the receipt, the ticket, the log's entries or its head.
 */
import { Refusal, LIVE_DEVICE, b64url, fromB64url, findDevice } from "./checks.js";
import { hasOnly, keysOrUnavailable } from "./signup.js";
import { ticketKey } from "./unlock.js";
import { MAX_TICKET, readTicket, spendTicket } from "./pin.js";
import { mailAfter } from "./lockout.js";
import { lockForBlock } from "./account-lock.js";

const HOUR_MS = 60 * 60 * 1000;

export const OFFLINE_LIMITS = Object.freeze({
  // D-21's one 12-hour clock from the last accepted code.
  maxHours: 12,
  // Opens a Mac may make on one pass (design decision 5).
  maxOpens: 20,
  // The tenth wrong PIN offline deletes the pass on the Mac (plan §3.4).
  wrongPins: 10,
});

export const PASS_LABEL = "horae-zone-offline-pass-v1";
export const RECEIPT_LABEL = "horae-zone-offline-receipt-v1";
export const LOG_LABEL = "horae-zone-offline-log-v1";
export const PASS_TYP = "offline-pass";
export const RECEIPT_TYP = "offline-receipt";

const JTI = /^[A-Za-z0-9_-]{22}$/;
const HEAD = /^[A-Za-z0-9_-]{43}$/;
const enc = new TextEncoder();

// A plain note on state; the wording is the owner's to change.
export const ISSUED_NOTE = Object.freeze({
  subject: "Horae Zone: an offline pass was issued",
  text: [
    "One of this account's Macs asked for an offline pass after a code, and Horae Zone issued it.",
    "Until it ends, that Mac can open NoMe with Touch ID and its offline PIN without reaching Horae Zone.",
    "If you did not ask for it, remove that Mac from another device.",
  ].join("\n"),
});

// A fixed note: the device has no name of its own, and the A5b rule keeps a
// note to no time, count or device id.
export const SUPERSEDED_NOTE = Object.freeze({
  subject: "Horae Zone: an offline pass was replaced",
  text: "An offline pass on one of this account's Macs was replaced before it reported its offline opens.",
});

export const OPENED_NOTE = Object.freeze({
  subject: "Horae Zone: a Mac opened offline",
  text: "One of this account's Macs reported that it opened NoMe on its offline pass while it could not reach Horae Zone.",
});

function isJti(value) {
  return typeof value === "string" && JTI.test(value) && fromB64url(value).length === 16;
}

function grantBody(body) {
  if (!hasOnly(body, ["ticket", "hours", "jti"])) throw new Refusal("shape", 400);
  const { ticket, hours, jti } = body;
  if (typeof ticket !== "string" || ticket.length === 0 || ticket.length > MAX_TICKET) throw new Refusal("shape", 400);
  if (!Number.isSafeInteger(hours) || hours < 1 || !isJti(jti)) throw new Refusal("shape", 400);
  return { ticket, hours: Math.min(hours, OFFLINE_LIMITS.maxHours), jti };
}

async function signedText(signKey, label, claims) {
  const payload = b64url(enc.encode(JSON.stringify({ v: 1, ...claims, kid: signKey.kid })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signKey.key, enc.encode(`${label}.${payload}`));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

async function signKeyOrUnavailable(env) {
  const signKey = await ticketKey(env);
  if (!signKey) throw new Refusal("unavailable", 503);
  return signKey;
}

// A pass that still holds its device back: not reported and not superseded.
const OPEN_PASS = "reported_at IS NULL AND superseded_at IS NULL";

// When this device's latest open pass was issued, or null when it holds none.
async function openPassIssued(db, deviceId) {
  const row = await db.prepare(`SELECT MAX(issued_at) AS issued_at FROM offline_pass WHERE device_id = ? AND ${OPEN_PASS}`).bind(deviceId).first();
  return row?.issued_at ?? null;
}

// A ticket re-proves the Mac when its code came after the open pass was
// issued and it has not been spent (src/pin.js spendTicket).
async function reProves(db, claims, issuedAt) {
  if (claims.at <= issuedAt) return false;
  return !(await db.prepare("SELECT 1 AS spent FROM spent_ticket WHERE jti = ?").bind(claims.jti).first());
}

async function jtiTaken(db, jti) {
  return Boolean(await db.prepare("SELECT 1 AS taken FROM offline_pass WHERE jti = ?").bind(jti).first());
}

// Only for a live device that holds no open pass, in the write.
function insertPass(db, device, pass) {
  return db.prepare(
    `INSERT INTO offline_pass (jti, account_id, device_id, at, until, issued_at, max_opens)
     SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${LIVE_DEVICE}
     AND NOT EXISTS (SELECT 1 FROM offline_pass WHERE device_id = ? AND ${OPEN_PASS})
     ON CONFLICT (jti) DO NOTHING RETURNING jti`,
  ).bind(pass.jti, device.account_id, device.id, pass.at, pass.until, pass.issuedAt, OFFLINE_LIMITS.maxOpens, device.id, device.id);
}

// Supersedes this device's open passes issued before the code, and issues the
// new one, in one batch. The supersede holds only when the insert will: a live
// device, a jti not taken, and no open pass of this device as new as the code.
async function supersedeAndInsert(db, device, pass) {
  await db.batch([
    db.prepare(
      `UPDATE offline_pass SET superseded_at = ? WHERE device_id = ? AND ${OPEN_PASS} AND issued_at < ? AND ${LIVE_DEVICE}
       AND NOT EXISTS (SELECT 1 FROM offline_pass WHERE jti = ?)
       AND NOT EXISTS (SELECT 1 FROM offline_pass WHERE device_id = ? AND ${OPEN_PASS} AND issued_at >= ?)`,
    ).bind(pass.issuedAt, device.id, pass.at, device.id, pass.jti, device.id, pass.at),
    insertPass(db, device, pass),
  ]);
  const made = await db.prepare("SELECT jti FROM offline_pass WHERE jti = ? AND device_id = ? AND issued_at = ?")
    .bind(pass.jti, device.id, pass.issuedAt).first();
  if (!made) return { made: null, superseded: false };
  // A pass reported between the read and the batch was not superseded: no note for it.
  const replaced = await db.prepare("SELECT COUNT(*) AS n FROM offline_pass WHERE device_id = ? AND superseded_at = ?")
    .bind(device.id, pass.issuedAt).first();
  return { made, superseded: replaced.n > 0 };
}

// POST /offline/grant. Every refusal but a lost race comes before the spend.
export async function grantPass({ db, device, body, now, env, mailer }) {
  const { ticket, hours, jti } = grantBody(body);
  const keys = await keysOrUnavailable(env);
  if (!mailer) throw new Refusal("unavailable", 503);
  const signKey = await signKeyOrUnavailable(env);
  const claims = await readTicket(env, ticket, device, now);
  if (!claims) throw new Refusal("bad-ticket", 401);
  const openIssued = await openPassIssued(db, device.id);
  if (openIssued !== null && !(await reProves(db, claims, openIssued))) throw new Refusal("report-due", 409);
  if (await jtiTaken(db, jti)) throw new Refusal("shape", 400);
  await spendTicket(db, device, claims);
  const pass = { jti, at: claims.at, until: claims.at + hours * HOUR_MS, issuedAt: now };
  const { made, superseded } = openIssued === null
    ? { made: await insertPass(db, device, pass).first(), superseded: false }
    : await supersedeAndInsert(db, device, pass);
  if (!made) {
    await findDevice(db, device.id);
    throw (await openPassIssued(db, device.id)) !== null ? new Refusal("report-due", 409) : new Refusal("shape", 400);
  }
  const signed = await signedText(signKey, PASS_LABEL, {
    typ: PASS_TYP, account: device.account_id, device: device.id, at: pass.at, until: pass.until, jti, maxOpens: OFFLINE_LIMITS.maxOpens,
  });
  const notes = superseded ? [SUPERSEDED_NOTE, ISSUED_NOTE] : [ISSUED_NOTE];
  const after = mailAfter({ db, keys, mailer, accountId: device.account_id, notes });
  return { status: 200, json: { ok: true, pass: signed }, after, ...(superseded ? { audit: "superseded" } : {}) };
}

function opensOf(value) {
  if (!Array.isArray(value) || value.length > OFFLINE_LIMITS.maxOpens) return null;
  const ok = value.every((entry, i) => entry !== null && typeof entry === "object" && !Array.isArray(entry)
    && hasOnly(entry, ["seq", "at"]) && entry.seq === i + 1 && Number.isSafeInteger(entry.at) && entry.at >= 0);
  return ok ? value.map(({ seq, at }) => ({ seq, at })) : null;
}

function reportBody(body) {
  if (!hasOnly(body, ["jti", "opens", "wrongPins", "head"])) throw new Refusal("shape", 400);
  const opens = opensOf(body.opens);
  const { jti, wrongPins, head } = body;
  if (!isJti(jti) || !opens || typeof head !== "string" || !HEAD.test(head)) throw new Refusal("shape", 400);
  if (!Number.isSafeInteger(wrongPins) || wrongPins < 0 || wrongPins > OFFLINE_LIMITS.wrongPins) throw new Refusal("shape", 400);
  return { jti, opens, wrongPins, head };
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

// The log's head over its entries, as the Mac builds it (OfflinePass.swift).
export async function logHead(jti, opens) {
  let head = await sha256(enc.encode(`${LOG_LABEL}.${jti}`));
  for (const { seq, at } of opens) {
    const step = enc.encode(`${seq}.${at}`);
    const both = new Uint8Array(head.length + step.length);
    both.set(head);
    both.set(step, head.length);
    head = await sha256(both);
  }
  return b64url(head);
}

// Two pieces of after-work as one, each failure reason kept.
function bothAfter(first, second) {
  if (!first || !second) return first ?? second;
  return async () => [await first(), await second()].flat();
}

// POST /offline/report.
export async function reportPass({ db, device, body, now, env, mailer }) {
  const { jti, opens, wrongPins, head } = reportBody(body);
  const signKey = await signKeyOrUnavailable(env);
  if ((await logHead(jti, opens)) !== head) throw new Refusal("bad-log", 400);
  const row = await db.prepare("SELECT reported_at FROM offline_pass WHERE jti = ? AND device_id = ?").bind(jti, device.id).first();
  const marks = Boolean(row) && row.reported_at === null;
  const blocked = wrongPins >= OFFLINE_LIMITS.wrongPins;
  const owesMail = marks && (opens.length > 0 || blocked);
  const keys = owesMail ? await keysOrUnavailable(env) : null;
  if (owesMail && !mailer) throw new Refusal("unavailable", 503);
  let after;
  if (marks) {
    const marked = await db.prepare(
      `UPDATE offline_pass SET reported_at = ?, opens = ?, wrong_tries = ?
       WHERE jti = ? AND device_id = ? AND reported_at IS NULL AND ${LIVE_DEVICE} RETURNING jti`,
    ).bind(now, opens.length, wrongPins, jti, device.id, device.id).first();
    if (!marked) await findDevice(db, device.id); // refuses no-device when a removal is what stopped it
    if (marked && opens.length > 0) after = mailAfter({ db, keys, mailer, accountId: device.account_id, notes: [OPENED_NOTE] });
    if (marked && blocked) after = bothAfter(after, await lockForBlock({ db, device, now, env, mailer }));
  }
  const receipt = await signedText(signKey, RECEIPT_LABEL, { typ: RECEIPT_TYP, account: device.account_id, device: device.id, jti });
  return { status: 200, json: { ok: true, receipt }, after };
}
