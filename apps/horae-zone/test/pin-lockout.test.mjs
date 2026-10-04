// A5b, the online wrong-PIN lockout (plan §3.4 "Online wrong PINs:
// JanusMirror's lockout. Three wrong in one 30-second window lock that window
// and email the owner. Two locked windows in a row, or four in a day, close
// the path until the single-use emailed link reopens it."). The rules are the
// engine's limits.mjs, the code path's own, with the code path's day cap
// (12 wrong a day, A5 re-review item 4), kept per account in their own row
// (pin_limits), so wrong PINs never close code entry and wrong codes never
// close PIN entry. A change's current PIN counts in the same lockout. The
// link reopens PIN entry only, through /unlock/reopen, and hands out nothing.
//
// A refused PIN try says only `locked`, never which rule, how many or how long.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WINDOW_MS, parseState } from '../../../packages/account-engine/src/limits.mjs';
import { fromB64url, LIVE_NONCES_PER_DEVICE } from '../src/checks.js';
import {
  harness, post, signed, everyRow, pinCall, pinnedDevice, tryCode, codeAt, wrongCodeAt, ticketFor, reopenTokenFrom, REOPEN_BASE,
} from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses and PINs with no run of
// three that are not on the public fixture list.
const ADDRESS = 'pin-lock-owner@example.test';
const OTHER = 'pin-lock-other@example.test';
const PIN = '274951';
const WRONG_PIN = '385062';
const NEW_PIN = '613805';
const LOCKED = { status: 423, json: { error: 'locked' } };
const BAD_PIN = { status: 401, json: { error: 'bad-pin' } };

const lockMail = (h, email) => h.mail.filter((m) => m.to === email && !/sign-up/i.test(m.subject));
const rows = (h, table) => h.db.sqlite.prepare(`SELECT * FROM ${table}`).all();
const pinState = (h, accountId) => {
  const row = rows(h, 'pin_limits').find((r) => accountId === undefined || r.account_id === accountId);
  return row ? parseState(row.state) : null;
};

async function wrongPin(h, dev) {
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: WRONG_PIN }), BAD_PIN);
}

async function lockPinWindow(h, dev) {
  for (let i = 0; i < 3; i += 1) await wrongPin(h, dev);
}

const rightPin = (h, dev) => pinCall(h, dev, '/pin/verify', { pin: PIN });

function assertPlainPinNote(message) {
  assert.equal(typeof message.subject, 'string');
  assert.match(message.subject, /PIN/);
  assert.equal(`${message.subject}${message.text}`.includes(String.fromCharCode(0x2014)), false, 'no em dash');
  for (const pin of [PIN, WRONG_PIN]) assert.equal(`${message.subject}${message.text}`.includes(pin), false, 'no PIN');
  assert.doesNotMatch(message.text, /authenticator code/i, 'a PIN note, not a code note');
}

// ---- the lockout ----

test('three wrong PINs in one window lock it and email; two in a row or four a day close PIN entry until the link', async () => {
  // Two in a row.
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const before = lockMail(h, ADDRESS).length;
  await wrongPin(h, dev);
  await wrongPin(h, dev);
  assert.equal(lockMail(h, ADDRESS).length, before, 'two wrong PINs mail nothing');
  await wrongPin(h, dev);
  const [windowLock] = lockMail(h, ADDRESS).slice(before);
  assert.ok(windowLock, 'the third wrong PIN mails the address');
  assertPlainPinNote(windowLock);
  assert.equal(windowLock.text.includes(REOPEN_BASE), false, 'a window lock carries no link');
  assert.deepEqual(await rightPin(h, dev), LOCKED, 'the window is locked, even to the right PIN');
  h.clock.ms += WINDOW_MS;
  await lockPinWindow(h, dev);
  const mails = lockMail(h, ADDRESS).slice(before);
  assert.equal(mails.length, 2);
  assertPlainPinNote(mails[1]);
  const token = reopenTokenFrom(h, ADDRESS);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/, 'the link carries its token in the fragment');
  for (const later of [WINDOW_MS, 2 * 60 * 60 * 1000]) {
    h.clock.ms += later;
    assert.deepEqual(await rightPin(h, dev), LOCKED, 'PIN entry stays closed until the link');
  }
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: NEW_PIN, current: PIN }), LOCKED, 'a change is closed too');
  const reopened = await h.call(post('/unlock/reopen', { token }));
  assert.deepEqual({ status: reopened.status, json: await reopened.json() }, { status: 200, json: { ok: true } });
  const reopenNote = lockMail(h, ADDRESS).at(-1);
  assertPlainPinNote(reopenNote);
  assert.equal(reopenNote.text.includes(token), false);
  h.clock.ms += WINDOW_MS;
  assert.equal((await rightPin(h, dev)).status, 200, 'the link reopened PIN entry');

  // Four in a day, none of them in a row.
  const g = harness();
  const four = await pinnedDevice(g, OTHER, PIN);
  for (let i = 0; i < 3; i += 1) {
    await lockPinWindow(g, four);
    g.clock.ms += 2 * WINDOW_MS;
  }
  assert.equal(reopenTokenFrom(g, OTHER), null, 'three locked windows apart do not close PIN entry');
  await lockPinWindow(g, four);
  assert.match(reopenTokenFrom(g, OTHER), /^[A-Za-z0-9_-]{43}$/);
  g.clock.ms += 2 * WINDOW_MS;
  assert.deepEqual(await rightPin(g, four), LOCKED);
});

test('NEGATIVE CONTROL: two wrong PINs and then the right one neither lock nor mail', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const before = lockMail(h, ADDRESS).length;
  await wrongPin(h, dev);
  await wrongPin(h, dev);
  assert.equal((await rightPin(h, dev)).status, 200);
  assert.equal(lockMail(h, ADDRESS).length, before);
});

test('a change\'s current PIN counts in the same lockout', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  await wrongPin(h, dev);
  await wrongPin(h, dev);
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: NEW_PIN, current: WRONG_PIN }), BAD_PIN);
  assert.deepEqual(await rightPin(h, dev), LOCKED, 'two wrong opens and one wrong change lock the window');
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: NEW_PIN, current: PIN }), LOCKED);
});

test('PIN tries arriving together never pass the window', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  // Signed first (a device holds at most LIVE_NONCES_PER_DEVICE nonces), then sent together.
  const requests = [];
  for (let i = 0; i < LIVE_NONCES_PER_DEVICE; i += 1) requests.push(await signed(h.call, dev, '/pin/verify', { pin: WRONG_PIN }));
  const answers = await Promise.all(requests.map((r) => h.call(r)));
  assert.deepEqual(answers.map((a) => a.status).sort(), [401, 401, 401, 423, 423], 'exactly 3 of 5 are compared');
  assert.equal(pinState(h).pending.length, 0, 'every admitted try settled');
});

test('the PIN lockout is its own: wrong PINs leave code entry open, and wrong codes leave PIN entry open', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  await lockPinWindow(h, dev);
  h.clock.ms += WINDOW_MS;
  await lockPinWindow(h, dev);
  assert.deepEqual(await rightPin(h, dev), LOCKED, 'PIN entry is closed');
  assert.equal(rows(h, 'limits').every((r) => parseState(r.state).pathLocked === false), true, 'code entry is open');
  h.clock.ms += WINDOW_MS;
  assert.equal((await tryCode(h, dev, await codeAt(dev, h.clock.ms))).finish.status, 200, 'a right code still works');

  const g = harness();
  const other = await pinnedDevice(g, OTHER, PIN);
  for (let w = 0; w < 2; w += 1) {
    for (let i = 0; i < 3; i += 1) {
      assert.deepEqual((await tryCode(g, other, await wrongCodeAt(other, g.clock.ms))).finish, { status: 401, json: { error: 'bad-code' } });
    }
    g.clock.ms += WINDOW_MS;
  }
  assert.equal((await rightPin(g, other)).status, 200, 'a closed code path leaves PIN entry open');
  assert.equal(pinState(g)?.pathLocked ?? false, false);
});

test('PIN entry closes per account: another account\'s PIN still works', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const other = await pinnedDevice(h, OTHER, PIN);
  const otherBefore = lockMail(h, OTHER).length;
  await lockPinWindow(h, dev);
  h.clock.ms += WINDOW_MS;
  await lockPinWindow(h, dev);
  assert.deepEqual(await rightPin(h, dev), LOCKED);
  assert.equal((await rightPin(h, other)).status, 200);
  assert.equal(lockMail(h, OTHER).length, otherBefore);
});

test('the day cap: 12 wrong PINs a day close PIN entry, never more than 2 a window needed', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  for (let i = 0; i < 11; i += 1) {
    await wrongPin(h, dev);
    if (i % 2 === 1) h.clock.ms += WINDOW_MS;
  }
  assert.equal(pinState(h).pathLocked, false, '11 wrong PINs leave PIN entry open');
  await wrongPin(h, dev);
  assert.equal(pinState(h).pathLocked, true, 'the 12th wrong PIN closes it');
  const note = lockMail(h, ADDRESS).at(-1);
  assertPlainPinNote(note);
  assert.match(note.text, /Too many wrong app PINs/);
  assert.ok(reopenTokenFrom(h, ADDRESS), 'the note carries the link');
  h.clock.ms += 2 * WINDOW_MS;
  assert.deepEqual(await rightPin(h, dev), LOCKED);
});

test('a code-needed open is refused before the lockout counts it, and a right ticket is not spent by a locked try', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  h.clock.ms += 12 * 60 * 60 * 1000;
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: WRONG_PIN }), { status: 401, json: { error: 'code-needed' } });
  }
  assert.equal(pinState(h), null, 'no PIN was compared, so nothing was counted');
  const ticket = await ticketFor(h, dev);
  for (let i = 0; i < 3; i += 1) assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: WRONG_PIN, ticket }), BAD_PIN);
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: PIN, ticket }), LOCKED);
  const { jti } = JSON.parse(new TextDecoder().decode(fromB64url(ticket.split('.')[0])));
  assert.equal(rows(h, 'spent_ticket').some((r) => r.jti === jti), false, 'the ticket is not spent');
});

test('a PIN lock state keeps only the engine state and a hash of the link, never a PIN', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  await lockPinWindow(h, dev);
  h.clock.ms += WINDOW_MS;
  await lockPinWindow(h, dev);
  const [row] = rows(h, 'pin_limits');
  assert.deepEqual(Object.keys(row).sort(), ['account_id', 'reopen_hash', 'state', 'version']);
  assert.match(row.reopen_hash, /^[0-9a-f]{64}$/);
  const text = everyRow(h.db);
  for (const pin of [PIN, WRONG_PIN]) assert.equal(text.includes(pin), false);
  assert.equal(text.includes(reopenTokenFrom(h, ADDRESS)), false, 'the token itself is never stored');
});

test('without the lockout\'s mail (no mailer reachable or no reopen base) no PIN is compared', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  h.env.HZ_REOPEN_BASE = 'http://not-https.example.test/reopen';
  assert.deepEqual(await rightPin(h, dev), { status: 503, json: { error: 'unavailable' } });
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: NEW_PIN, current: PIN }), { status: 503, json: { error: 'unavailable' } });
  assert.equal(pinState(h), null, 'nothing was admitted');
});
