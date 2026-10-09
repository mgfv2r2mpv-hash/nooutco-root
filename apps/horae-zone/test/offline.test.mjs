// Offline unlock, the service half (sass-assistant design of 8 Oct 2026,
// section 1, Option C, approved for building). After a good code, the Mac asks
// for an offline pass on purpose. Horae Zone signs it, bound to the Mac, under
// a label of its own, ending at most 12 hours after the code's own time. The
// Mac reports its offline opens on a signed report, and the service issues no
// new pass to that Mac until the report of the last one is in.
//
//   /offline/grant  {ticket, hours, jti}              -> {ok: true, pass}
//   /offline/report {jti, opens, wrongPins, head}     -> {ok: true, receipt}
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '../src/routes.js';
import { createHandler } from '../src/index.js';
import {
  harness, signed, auditRows, everyRow, registeredDevice, confirmedDevice, ticketFor, pinCall,
  TICKET_PUBLIC_KEY, UNLOCK_TICKET_LABEL_TEXT, signWithTicketKey, jwkThumbprint, TICKET_PUBLIC_JWK,
} from './helpers.mjs';
import { b64url, fromB64url } from '../src/checks.js';

// Written here apart from src/, so the tests pin the form the Mac checks.
const PASS_LABEL = 'horae-zone-offline-pass-v1';
const RECEIPT_LABEL = 'horae-zone-offline-receipt-v1';
const LOG_LABEL = 'horae-zone-offline-log-v1';
const GRANT_LABEL = 'horae-zone-offline-grant-v1';

// Fixed, fake values: reserved-domain addresses.
const ADDRESS = 'offline@example.test';
const OTHER = 'offline-other@example.test';
const HOUR_MS = 60 * 60 * 1000;
const MAX_OPENS = 20;

const enc = new TextEncoder();
const answer = async (res) => ({ status: res.status, json: await res.json() });
const newJti = () => b64url(crypto.getRandomValues(new Uint8Array(16)));

// The claims of `text` when the test ticket key signed it under `label`, else null.
async function opened(text, label) {
  if (typeof text !== 'string') return null;
  const [payload, sig, ...rest] = text.split('.');
  if (rest.length || !payload || !sig) return null;
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, TICKET_PUBLIC_KEY, fromB64url(sig), enc.encode(`${label}.${payload}`));
  return ok ? JSON.parse(new TextDecoder().decode(fromB64url(payload))) : null;
}

// The log's head as the Mac builds it: SHA-256 over the label and the jti,
// then over the previous head and `${seq}.${at}` for each open.
async function headOf(jti, opens) {
  let h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${LOG_LABEL}.${jti}`)));
  for (const { seq, at } of opens) {
    const step = enc.encode(`${seq}.${at}`);
    const both = new Uint8Array(h.length + step.length);
    both.set(h);
    both.set(step, h.length);
    h = new Uint8Array(await crypto.subtle.digest('SHA-256', both));
  }
  return b64url(h);
}

async function grant(h, dev, body) {
  return answer(await h.call(await signed(h.call, dev, '/offline/grant', body)));
}

async function report(h, dev, jti, opens = [], wrongPins = 0, extra = {}) {
  return answer(await h.call(await signed(h.call, dev, '/offline/report', { jti, opens, wrongPins, head: await headOf(jti, opens), ...extra })));
}

const passRows = (h) => h.db.sqlite.prepare('SELECT * FROM offline_pass ORDER BY issued_at').all();
const proved = (h, id) => h.db.sqlite.prepare('SELECT proved_at FROM device_check WHERE device_id = ?').get(id)?.proved_at;

// ---- the routes ----

test('the two routes are signed, a pending device reaches neither, and only the report passes a lock', () => {
  assert.equal(ROUTES['/offline/grant'].checks, 'signed');
  assert.equal(ROUTES['/offline/report'].checks, 'signed');
  assert.ok(!ROUTES['/offline/grant'].pendingOk && !ROUTES['/offline/report'].pendingOk);
  assert.ok(!ROUTES['/offline/grant'].lockedOk, 'a locked account gets no pass');
  assert.equal(ROUTES['/offline/report'].lockedOk, true, 'a blocked Mac must still report');
});

// ---- the pass ----

test('a fresh code earns a pass bound to the Mac, under its own label, ending the asked hours after the code', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const ticket = await ticketFor(h, dev);
  const at = (await opened(ticket, UNLOCK_TICKET_LABEL_TEXT)).at;
  const jti = newJti();
  const out = await grant(h, dev, { ticket, hours: 10, jti });
  assert.equal(out.status, 200);
  assert.deepEqual(Object.keys(out.json).sort(), ['ok', 'pass']);
  const claims = await opened(out.json.pass, PASS_LABEL);
  assert.ok(claims, 'the pass verifies under the service key and its own label');
  assert.deepEqual(Object.keys(claims).sort(), ['account', 'at', 'device', 'jti', 'kid', 'maxOpens', 'typ', 'until', 'v']);
  assert.equal(claims.v, 1);
  assert.equal(claims.typ, 'offline-pass');
  assert.equal(claims.kid, await jwkThumbprint(TICKET_PUBLIC_JWK));
  assert.equal(claims.device, dev.id);
  assert.equal(claims.account, dev.account);
  assert.equal(claims.at, at, 'at is the code\'s own time');
  assert.equal(claims.until, at + 10 * HOUR_MS);
  assert.equal(claims.jti, jti, 'the jti is the one the Mac chose, so it can report a pass whose answer it lost');
  assert.equal(claims.maxOpens, MAX_OPENS);
  assert.equal(proved(h, dev.id), at, 'the spend moves the device\'s code time as an open does');
  assert.deepEqual(auditRows(h.db).at(-1), { route: '/offline/grant', reason: 'ok' });
});

test('the pass never ends more than 12 hours after the code, whatever hours says', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const ticket = await ticketFor(h, dev);
  const at = (await opened(ticket, UNLOCK_TICKET_LABEL_TEXT)).at;
  const out = await grant(h, dev, { ticket, hours: 48, jti: newJti() });
  assert.equal(out.status, 200);
  assert.equal((await opened(out.json.pass, PASS_LABEL)).until, at + 12 * HOUR_MS);
  assert.equal(passRows(h)[0].until, at + 12 * HOUR_MS, 'the row keeps the capped time');
});

test('a pass is not a ticket, a grant or a receipt, and none of those is a pass', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const out = await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti: newJti() });
  const pass = out.json.pass;
  assert.equal(await opened(pass, UNLOCK_TICKET_LABEL_TEXT), null);
  assert.equal(await opened(pass, GRANT_LABEL), null);
  assert.equal(await opened(pass, RECEIPT_LABEL), null);
  assert.ok(await opened(pass, PASS_LABEL), 'NEGATIVE CONTROL: under its own label it verifies');
  // A pass sent where a ticket is asked for is refused as any bad ticket is.
  assert.deepEqual(await pinCall(h, dev, '/offline/grant', { ticket: pass, hours: 10, jti: newJti() }), { status: 401, json: { error: 'bad-ticket' } });
});

test('the body is exactly {ticket, hours, jti}, each of its shape', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const ticket = await ticketFor(h, dev);
  const SHAPE = { status: 400, json: { error: 'shape' } };
  for (const body of [
    {}, { ticket }, { ticket, hours: 10 }, { hours: 10, jti: newJti() },
    { ticket, hours: 10, jti: newJti(), extra: 1 },
    { ticket, hours: 0, jti: newJti() }, { ticket, hours: -1, jti: newJti() }, { ticket, hours: 1.5, jti: newJti() },
    { ticket, hours: '10', jti: newJti() }, { ticket, hours: true, jti: newJti() },
    { ticket, hours: 10, jti: 'short' }, { ticket, hours: 10, jti: 7 },
    { ticket: 7, hours: 10, jti: newJti() }, { ticket: 'x'.repeat(1025), hours: 10, jti: newJti() },
  ]) {
    assert.deepEqual(await grant(h, dev, body), SHAPE, JSON.stringify(Object.keys(body)));
  }
  assert.equal(passRows(h).length, 0);
  assert.equal((await grant(h, dev, { ticket, hours: 10, jti: newJti() })).status, 200, 'NEGATIVE CONTROL: the shape refusals spent nothing');
});

test('a pass needs a fresh code: none, a stale one, another device\'s and a spent one are refused', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const BAD = { status: 401, json: { error: 'bad-ticket' } };
  assert.deepEqual(await grant(h, dev, { ticket: 'not.a-ticket', hours: 10, jti: newJti() }), BAD);
  const stale = await ticketFor(h, dev);
  h.clock.ms += 5 * 60 * 1000;
  assert.deepEqual(await grant(h, dev, { ticket: stale, hours: 10, jti: newJti() }), BAD, 'past its five minutes');
  const second = { ...(await registeredDevice(h, ADDRESS, { fresh: false })), seed: dev.seed };
  const forSecond = await ticketFor(h, second);
  assert.deepEqual(await grant(h, dev, { ticket: forSecond, hours: 10, jti: newJti() }), BAD, 'another device\'s code');
  const ticket = await ticketFor(h, dev);
  assert.equal((await grant(h, dev, { ticket, hours: 10, jti: newJti() })).status, 200);
  await report(h, dev, passRows(h)[0].jti);
  assert.deepEqual(await grant(h, dev, { ticket, hours: 10, jti: newJti() }), BAD, 'a code is spent once');
  // A ticket signed under the unlock label by another key is refused too.
  const forged = await signWithTicketKey({ v: 1, account: dev.account, device: dev.id, at: h.clock.ms, exp: h.clock.ms + 1000, jti: newJti() }, PASS_LABEL);
  assert.deepEqual(await grant(h, dev, { ticket: forged, hours: 10, jti: newJti() }), BAD, 'a ticket under another label');
  assert.equal(passRows(h).length, 1);
});

test('a pending device and a locked account get no pass', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const pending = await registeredDevice(h, ADDRESS, { fresh: false });
  assert.deepEqual(await grant(h, pending, { ticket: 'x.y', hours: 10, jti: newJti() }), { status: 401, json: { error: 'no-device' } });
  const ticket = await ticketFor(h, dev);
  assert.deepEqual(await pinCall(h, dev, '/pin/blocked', {}), { status: 423, json: { error: 'account-locked' } });
  assert.deepEqual(await grant(h, dev, { ticket, hours: 10, jti: newJti() }), { status: 423, json: { error: 'account-locked' } });
  assert.equal(passRows(h).length, 0);
});

test('without a mailer or the account key, no pass is issued and the code is not spent', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const ticket = await ticketFor(h, dev);
  const before = proved(h, dev.id);
  const UNAVAILABLE = { status: 503, json: { error: 'unavailable' } };
  // The deployed Worker builds its mailer from RESEND_KEY and HZ_MAIL_FROM;
  // with neither bound there is none, and no pass goes unannounced.
  const bare = createHandler({ now: () => h.clock.ms, mailer: null, pinRules: null });
  const call = (req) => bare(req, h.env, { waitUntil: () => {} });
  assert.deepEqual(await answer(await call(await signed(call, dev, '/offline/grant', { ticket, hours: 10, jti: newJti() }))), UNAVAILABLE);
  const keyless = createHandler({ now: () => h.clock.ms, mailer: async () => true, pinRules: null });
  const callKeyless = (req) => keyless(req, { ...h.env, HZ_ACCOUNT_KEY: undefined }, { waitUntil: () => {} });
  assert.deepEqual(await answer(await callKeyless(await signed(callKeyless, dev, '/offline/grant', { ticket, hours: 10, jti: newJti() }))), UNAVAILABLE);
  assert.equal(proved(h, dev.id), before, 'the code is not spent');
  assert.equal(passRows(h).length, 0);
  assert.equal((await grant(h, dev, { ticket, hours: 10, jti: newJti() })).status, 200, 'NEGATIVE CONTROL: the same code earns a pass once mail works');
});

test('the account is mailed a plain note on every pass, with no time and no count', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const before = h.mail.length;
  const out = await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti: newJti() });
  assert.equal(out.status, 200);
  const notes = h.mail.slice(before);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].to, ADDRESS);
  assert.match(notes[0].subject, /offline pass/i);
  assert.doesNotMatch(`${notes[0].subject} ${notes[0].text}`, /[0-9]/, 'no time, date, hour or count');
});

// ---- the report gate ----

test('no new pass on a code no newer than the unreported pass, and the report clears the way', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  // A code proved before the pass was issued: valid and unspent, but not fresh.
  const ticket = await ticketFor(h, dev);
  const first = newJti();
  assert.equal((await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti: first })).status, 200);
  const atBefore = proved(h, dev.id);
  assert.deepEqual(await grant(h, dev, { ticket, hours: 10, jti: newJti() }), { status: 409, json: { error: 'report-due' } });
  assert.equal(proved(h, dev.id), atBefore, 'a report-due refusal spends no code');
  assert.equal(passRows(h).length, 1);
  const done = await report(h, dev, first);
  assert.equal(done.status, 200);
  assert.equal((await grant(h, dev, { ticket, hours: 10, jti: newJti() })).status, 200, 'the same code, unspent, now earns a pass');
});

test('the gate is per Mac: another device of the account is not held back by this one\'s pass', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const second = { ...(await registeredDevice(h, ADDRESS, { fresh: false })), seed: dev.seed };
  await ticketFor(h, second);
  assert.equal((await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti: newJti() })).status, 200);
  assert.equal((await grant(h, second, { ticket: await ticketFor(h, second), hours: 10, jti: newJti() })).status, 200);
});

// ---- a Mac that lost its record (option c) ----
// sass #309's transferAccept clears the Mac's offline record but keeps its
// Horae identity, and the Mac reports only from a record. A fresh code, proved
// after the unreported pass was issued and not yet spent, lets that same Mac
// supersede it: the old row is marked superseded (never reported), the
// request's audit row says so, the account is mailed, and the new pass is issued.

const SUPERSEDED_TEXT = "An offline pass on one of this account's Macs was replaced before it reported its offline opens.";
const superseded = (h) => passRows(h).filter((r) => r.superseded_at !== null);

test('a Mac that lost its record: a fresh code supersedes its own unreported pass, audits it, mails the note and issues the new pass', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const lost = newJti();
  assert.equal((await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti: lost })).status, 200);
  // The vault transfer clears the record; the Mac never reports `lost`.
  h.clock.ms += HOUR_MS;
  const early = await ticketFor(h, dev);
  const ticket = await ticketFor(h, dev);
  const codeAt = (await opened(ticket, UNLOCK_TICKET_LABEL_TEXT)).at;
  const before = h.mail.length;
  const next = newJti();
  const out = await grant(h, dev, { ticket, hours: 10, jti: next });
  assert.equal(out.status, 200, 'the re-proved Mac gets a pass');
  assert.equal((await opened(out.json.pass, PASS_LABEL)).jti, next);
  assert.equal(proved(h, dev.id), codeAt, 'the code is spent');
  const [old, fresh] = passRows(h);
  assert.equal(old.jti, lost);
  assert.equal(old.superseded_at, h.clock.ms, 'the old row is marked superseded when the new pass is issued');
  assert.equal(old.reported_at, null, 'a superseded row never counts as reported');
  assert.equal(old.opens, null, 'no count is made up for opens nobody reported');
  assert.equal(old.wrong_tries, null);
  assert.equal(fresh.jti, next);
  assert.equal(fresh.superseded_at, null);
  assert.equal(fresh.reported_at, null);
  assert.deepEqual(auditRows(h.db).at(-1), { route: '/offline/grant', reason: 'superseded' });
  const notes = h.mail.slice(before);
  assert.equal(notes.length, 2, 'the replacement note and the issued note');
  assert.ok(notes.every((n) => n.to === ADDRESS));
  const note = notes.find((n) => n.text === SUPERSEDED_TEXT);
  assert.ok(note, 'the fixed replacement note');
  assert.doesNotMatch(`${note.subject} ${note.text}`, /[0-9]/, 'no time, date or count');
  assert.ok(notes.some((n) => /offline pass was issued/i.test(n.subject)), 'the usual issued note');
  // The new pass is the gate now: a code proved before it answers report-due.
  assert.deepEqual(await grant(h, dev, { ticket: early, hours: 10, jti: newJti() }), { status: 409, json: { error: 'report-due' } });
  assert.equal(superseded(h).length, 1, 'NEGATIVE CONTROL: a code older than the new pass supersedes nothing');
});

test('NEGATIVE CONTROL: without a fresh ticket it is still report-due, nothing is superseded and no code is spent', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  // Proved before the pass was issued: valid, unspent, not fresh.
  const early = await ticketFor(h, dev);
  assert.equal((await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti: newJti() })).status, 200);
  const atBefore = proved(h, dev.id);
  assert.deepEqual(await grant(h, dev, { ticket: early, hours: 10, jti: newJti() }), { status: 409, json: { error: 'report-due' } });
  assert.equal(proved(h, dev.id), atBefore, 'the refusal spends no code');
  // Proved after the pass, but already spent elsewhere (the first PIN set).
  h.clock.ms += HOUR_MS;
  const spent = await ticketFor(h, dev);
  assert.equal((await pinCall(h, dev, '/pin/set', { pin: '274951', ticket: spent })).status, 200);
  const mailBeforeGrant = h.mail.length;
  assert.deepEqual(await grant(h, dev, { ticket: spent, hours: 10, jti: newJti() }), { status: 409, json: { error: 'report-due' } }, 'a spent code is not spent twice');
  assert.equal(superseded(h).length, 0);
  assert.equal(passRows(h).length, 1);
  assert.equal(h.mail.length, mailBeforeGrant, 'no note for a refusal');
  assert.deepEqual(auditRows(h.db).at(-1), { route: '/offline/grant', reason: 'report-due' });
  // The fresh, unspent code is what supersedes.
  assert.equal((await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti: newJti() })).status, 200, 'NEGATIVE CONTROL: a fresh unspent code supersedes');
  assert.equal(superseded(h).length, 1);
});

test('NEGATIVE CONTROL: another device\'s unreported pass is never superseded, and still blocks that device', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const second = { ...(await registeredDevice(h, ADDRESS, { fresh: false })), seed: dev.seed };
  await ticketFor(h, second);
  const mine = newJti();
  assert.equal((await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti: mine })).status, 200);
  h.clock.ms += HOUR_MS;
  // The other Mac: a code proved before its own pass, still inside its five minutes.
  const secondEarly = await ticketFor(h, second);
  const theirs = newJti();
  assert.equal((await grant(h, second, { ticket: await ticketFor(h, second), hours: 10, jti: theirs })).status, 200);
  const before = h.mail.length;
  assert.equal((await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti: newJti() })).status, 200);
  const rows = Object.fromEntries(passRows(h).map((r) => [r.jti, r]));
  assert.notEqual(rows[mine].superseded_at, null, 'this Mac\'s own pass is superseded');
  assert.equal(rows[theirs].superseded_at, null, 'the other Mac\'s pass is untouched');
  assert.equal(rows[theirs].reported_at, null);
  assert.equal(h.mail.slice(before).filter((n) => n.text === SUPERSEDED_TEXT).length, 1, 'one note, for the one pass replaced');
  assert.deepEqual(await grant(h, second, { ticket: secondEarly, hours: 10, jti: newJti() }), { status: 409, json: { error: 'report-due' } }, 'the other Mac is still held by its own pass');
});

test('NEGATIVE CONTROL: a blocked account refuses the grant and supersedes nothing, by /pin/blocked or by ten wrong PINs offline', async () => {
  // Locked by /pin/blocked.
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  assert.equal((await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti: newJti() })).status, 200);
  h.clock.ms += HOUR_MS;
  const ticket = await ticketFor(h, dev);
  const atBefore = proved(h, dev.id);
  assert.deepEqual(await pinCall(h, dev, '/pin/blocked', {}), { status: 423, json: { error: 'account-locked' } });
  assert.deepEqual(await grant(h, dev, { ticket, hours: 10, jti: newJti() }), { status: 423, json: { error: 'account-locked' } });
  assert.equal(superseded(h).length, 0);
  assert.equal(passRows(h).length, 1);
  assert.equal(proved(h, dev.id), atBefore, 'no code spent');
  // Locked by another Mac's report of ten wrong PINs.
  const h2 = harness();
  const a = await confirmedDevice(h2, ADDRESS);
  const b = { ...(await registeredDevice(h2, ADDRESS, { fresh: false })), seed: a.seed };
  await ticketFor(h2, b);
  assert.equal((await grant(h2, a, { ticket: await ticketFor(h2, a), hours: 10, jti: newJti() })).status, 200);
  const bJti = newJti();
  assert.equal((await grant(h2, b, { ticket: await ticketFor(h2, b), hours: 10, jti: bJti })).status, 200);
  h2.clock.ms += HOUR_MS;
  const aTicket = await ticketFor(h2, a);
  assert.equal((await report(h2, b, bJti, [], 10)).status, 200);
  assert.deepEqual(await grant(h2, a, { ticket: aTicket, hours: 10, jti: newJti() }), { status: 423, json: { error: 'account-locked' } });
  assert.equal(superseded(h2).length, 0, 'a blocked account supersedes nothing');
});

test('a jti already used is refused', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const jti = newJti();
  assert.equal((await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti })).status, 200);
  await report(h, dev, jti);
  assert.deepEqual(await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti }), { status: 400, json: { error: 'shape' } });
});

// ---- the report ----

test('a report marks the pass, keeps its counts, and answers a receipt bound to the Mac and the jti', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const jti = newJti();
  await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti });
  const opens = [{ seq: 1, at: h.clock.ms + 1000 }, { seq: 2, at: h.clock.ms + 2000 }];
  h.clock.ms += 3000;
  const out = await report(h, dev, jti, opens, 3);
  assert.equal(out.status, 200);
  assert.deepEqual(Object.keys(out.json).sort(), ['ok', 'receipt']);
  const receipt = await opened(out.json.receipt, RECEIPT_LABEL);
  assert.deepEqual(Object.keys(receipt).sort(), ['account', 'device', 'jti', 'kid', 'typ', 'v']);
  assert.equal(receipt.typ, 'offline-receipt');
  assert.equal(receipt.device, dev.id);
  assert.equal(receipt.account, dev.account);
  assert.equal(receipt.jti, jti);
  assert.equal(await opened(out.json.receipt, PASS_LABEL), null, 'a receipt is not a pass');
  const row = passRows(h)[0];
  assert.equal(row.reported_at, h.clock.ms);
  assert.equal(row.opens, 2);
  assert.equal(row.wrong_tries, 3);
  // Reported twice (the Mac lost the first answer): the same receipt, nothing moved.
  h.clock.ms += 1000;
  const again = await report(h, dev, jti, opens, 3);
  assert.equal(again.status, 200);
  assert.equal((await opened(again.json.receipt, RECEIPT_LABEL)).jti, jti);
  assert.equal(passRows(h)[0].reported_at, row.reported_at, 'the first report stands');
});

test('a report for a pass the service never issued to this Mac answers a receipt and marks nothing', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const other = await confirmedDevice(h, OTHER);
  const theirs = newJti();
  await grant(h, other, { ticket: await ticketFor(h, other), hours: 10, jti: theirs });
  // The Mac's grant never landed, so it reports the jti it chose.
  const out = await report(h, dev, newJti());
  assert.equal(out.status, 200);
  assert.ok(await opened(out.json.receipt, RECEIPT_LABEL));
  // Another Mac's jti: its pass stays unreported.
  assert.equal((await report(h, dev, theirs)).status, 200);
  assert.equal(passRows(h)[0].reported_at, null, 'another device\'s pass is not marked by this one');
});

test('the report body is exactly its four fields, the log continuous and its head the chain over it', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const jti = newJti();
  await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti });
  const SHAPE = { status: 400, json: { error: 'shape' } };
  const one = [{ seq: 1, at: h.clock.ms }];
  const call = async (body) => answer(await h.call(await signed(h.call, dev, '/offline/report', body)));
  const head = await headOf(jti, one);
  for (const body of [
    {}, { jti, opens: one, wrongPins: 0 }, { jti, opens: one, wrongPins: 0, head, extra: 1 },
    { jti: 'short', opens: one, wrongPins: 0, head },
    { jti, opens: 'x', wrongPins: 0, head },
    { jti, opens: [{ seq: 2, at: h.clock.ms }], wrongPins: 0, head: await headOf(jti, [{ seq: 2, at: h.clock.ms }]) },
    { jti, opens: [{ seq: 1, at: h.clock.ms, x: 1 }], wrongPins: 0, head },
    { jti, opens: [{ seq: 1, at: 'now' }], wrongPins: 0, head },
    { jti, opens: Array.from({ length: MAX_OPENS + 1 }, (_, i) => ({ seq: i + 1, at: h.clock.ms })), wrongPins: 0, head },
    { jti, opens: one, wrongPins: -1, head }, { jti, opens: one, wrongPins: 11, head }, { jti, opens: one, wrongPins: 1.5, head },
    { jti, opens: one, wrongPins: 0, head: 'short' },
  ]) {
    assert.deepEqual(await call(body), SHAPE, JSON.stringify(body).slice(0, 80));
  }
  // A head that is not the chain over the entries: an entry dropped.
  const two = [{ seq: 1, at: h.clock.ms }, { seq: 2, at: h.clock.ms + 1 }];
  assert.deepEqual(await call({ jti, opens: one, wrongPins: 0, head: await headOf(jti, two) }), { status: 400, json: { error: 'bad-log' } });
  assert.deepEqual(await call({ jti, opens: one, wrongPins: 0, head: await headOf(newJti(), one) }), { status: 400, json: { error: 'bad-log' } }, 'another pass\'s chain');
  assert.equal(passRows(h)[0].reported_at, null);
  assert.equal((await call({ jti, opens: two, wrongPins: 0, head: await headOf(jti, two) })).status, 200, 'NEGATIVE CONTROL: the chain over its own entries is taken');
});

test('a report of opens mails a plain note with no count or time; a report of none mails nothing', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const used = newJti();
  await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti: used });
  let before = h.mail.length;
  await report(h, dev, used, [{ seq: 1, at: h.clock.ms }, { seq: 2, at: h.clock.ms + 5 }]);
  const notes = h.mail.slice(before);
  assert.equal(notes.length, 1);
  assert.match(notes[0].subject, /offline/i);
  assert.doesNotMatch(`${notes[0].subject} ${notes[0].text}`, /[0-9]/, 'no count and no time');
  const unused = newJti();
  await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti: unused });
  before = h.mail.length;
  await report(h, dev, unused);
  assert.equal(h.mail.length, before, 'an unused pass reports quietly');
});

test('ten wrong PINs offline: the report locks the account as /pin/blocked does, and still answers a receipt', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const jti = newJti();
  await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti });
  const out = await report(h, dev, jti, [], 10);
  assert.equal(out.status, 200, 'the Mac gets its receipt, so its blocked pass can go');
  assert.ok(await opened(out.json.receipt, RECEIPT_LABEL));
  assert.ok(h.mail.some((m) => /locked/i.test(m.subject)), 'the lock note');
  assert.deepEqual(await pinCall(h, dev, '/offline/grant', { ticket: 'x.y', hours: 10, jti: newJti() }), { status: 423, json: { error: 'account-locked' } });
  assert.deepEqual(await pinCall(h, dev, '/unlock/start', {}), { status: 423, json: { error: 'account-locked' } });
  // A report under ten locks nothing.
  const h2 = harness();
  const dev2 = await confirmedDevice(h2, ADDRESS);
  const jti2 = newJti();
  await grant(h2, dev2, { ticket: await ticketFor(h2, dev2), hours: 10, jti: jti2 });
  assert.equal((await report(h2, dev2, jti2, [], 9)).status, 200);
  assert.equal(h2.db.sqlite.prepare('SELECT COUNT(*) AS n FROM account_lock').get().n, 0, 'NEGATIVE CONTROL: nine wrong locks nothing');
});

test('without a mailer, a report that owes a mail is refused unavailable and marks nothing', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const jti = newJti();
  await grant(h, dev, { ticket: await ticketFor(h, dev), hours: 10, jti });
  const bare = createHandler({ now: () => h.clock.ms, mailer: null, pinRules: null });
  const call = (req) => bare(req, h.env, { waitUntil: () => {} });
  const opens = [{ seq: 1, at: h.clock.ms }];
  const body = { jti, opens, wrongPins: 0, head: await headOf(jti, opens) };
  assert.deepEqual(await answer(await call(await signed(call, dev, '/offline/report', body))), { status: 503, json: { error: 'unavailable' } });
  assert.equal(passRows(h)[0].reported_at, null);
  assert.equal((await report(h, dev, jti, opens)).status, 200, 'NEGATIVE CONTROL: the same report is taken once mail works');
});

// ---- custody ----

test('no row and no audit holds the pass, the receipt, the ticket or the log head', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const ticket = await ticketFor(h, dev);
  const jti = newJti();
  const out = await grant(h, dev, { ticket, hours: 10, jti });
  const opens = [{ seq: 1, at: h.clock.ms }];
  const head = await headOf(jti, opens);
  const done = await report(h, dev, jti, opens);
  const rows = everyRow(h.db);
  for (const [name, value] of [['pass', out.json.pass], ['receipt', done.json.receipt], ['ticket', ticket], ['head', head]]) {
    assert.ok(!rows.includes(value), `${name} is in a row`);
    assert.ok(!rows.includes(value.split('.')[1] ?? value), `${name}'s signature is in a row`);
  }
  for (const row of auditRows(h.db)) assert.match(row.reason, /^[a-z-]+$/);
});
