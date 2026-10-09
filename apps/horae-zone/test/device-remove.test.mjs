// A4 Decision for Kaleb 5, decided 8 Oct 2026: what proves a device removal.
// His ruling: "A fresh code plus a notice mail, no delay."
//
//   /device/remove {device, ticket}   -> {ok: true}
//
// The fresh code is an unlock ticket from /unlock/finish, the same one-time
// factor /pin/set, /pin/verify and /pin/reset take, read by the same verifier
// (src/pin.js readTicket) and spent once (spent_ticket). The removal lands at
// once, as before, and the account's address is mailed a note with no number,
// no link and no value the request carried.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../src/index.js';
import { REMOVED_NOTE } from '../src/device-remove.js';
import {
  harness, post, signed, nonceFor, auditRows, everyRow, registeredDevice, confirmedDevice, ticketFor,
  pinCall, signWithTicketKey, PASSWORD, UNLOCK_TICKET_LABEL_TEXT,
} from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses and PINs off the public list.
const ADDRESS = 'device-remove@example.test';
const OTHER = 'device-remove-other@example.test';
const PIN = '274951';
const OK = { status: 200, json: { ok: true } };
const CODE_NEEDED = { status: 401, json: { error: 'code-needed' } };
const BAD_TICKET = { status: 401, json: { error: 'bad-ticket' } };
const NO_DEVICE = { status: 401, json: { error: 'no-device' } };
const TICKET_TTL_MS = 5 * 60 * 1000;

async function answer(res) {
  return { status: res.status, json: await res.json() };
}

const removedAt = (h, id) => h.db.sqlite.prepare('SELECT removed_at FROM device WHERE id = ?').get(id).removed_at;
const removalNotes = (h) => h.mail.filter((m) => m.subject === REMOVED_NOTE.subject);

// The account's owner device, its code enrolled and confirmed, and a second
// device that has proved the code, so neither is pending.
async function twoDevices(h, email = ADDRESS) {
  const owner = await confirmedDevice(h, email);
  const second = { ...(await registeredDevice(h, email, { fresh: false })), seed: owner.seed };
  await ticketFor(h, second); // its first code clears its pending flag
  return { owner, second };
}

async function removal(h, caller, body) {
  return answer(await h.call(await signed(h.call, caller, '/device/remove', body)));
}

// ---- the fresh code ----

test('a removal without a fresh code is refused, and removes nothing', async () => {
  const h = harness();
  const { owner, second } = await twoDevices(h);
  const mailBefore = h.mail.length;
  assert.deepEqual(await removal(h, owner, { device: second.id }), CODE_NEEDED);
  assert.deepEqual(await removal(h, owner, { device: second.id, ticket: 'not.a-ticket' }), BAD_TICKET);
  // A ticket the service signed for another device of the account.
  const forOther = await ticketFor(h, second);
  assert.deepEqual(await removal(h, owner, { device: second.id, ticket: forOther }), BAD_TICKET);
  // A ticket of this device past its five minutes.
  const stale = await ticketFor(h, owner);
  h.clock.ms += TICKET_TTL_MS;
  assert.deepEqual(await removal(h, owner, { device: second.id, ticket: stale }), BAD_TICKET);
  assert.equal(removedAt(h, second.id), null, 'the second device is untouched');
  assert.equal(h.mail.length, mailBefore, 'a refused removal mails nobody');
  assert.equal((await answer(await h.call(await signed(h.call, second, '/pin/verify', { pin: PIN })))).json.error, 'no-pin',
    'NEGATIVE CONTROL: the second device still passes every device check');
});

test('a reused code is refused, whether a removal or an open spent it', async () => {
  const h = harness();
  const { owner, second } = await twoDevices(h);
  const third = await registeredDevice(h, ADDRESS, { fresh: false });
  const ticket = await ticketFor(h, owner);
  assert.deepEqual(await removal(h, owner, { device: third.id, ticket }), OK, 'NEGATIVE CONTROL: the fresh code removes');
  assert.deepEqual(await removal(h, owner, { device: second.id, ticket }), BAD_TICKET, 'the same code again');
  assert.equal(removedAt(h, second.id), null);
  // A code an open already spent removes nothing either.
  assert.equal((await pinCall(h, owner, '/pin/set', { pin: PIN, ticket: await ticketFor(h, owner) })).status, 200);
  h.clock.ms += 12 * 60 * 60 * 1000; // the next open needs the code again
  const opened = await ticketFor(h, owner);
  assert.equal((await pinCall(h, owner, '/pin/verify', { pin: PIN, ticket: opened })).status, 200);
  assert.deepEqual(await removal(h, owner, { device: second.id, ticket: opened }), BAD_TICKET);
  assert.equal(removedAt(h, second.id), null, 'the second device is untouched');
});

test('two removals sent together with one code: only one of them removes', async () => {
  const h = harness();
  const { owner, second } = await twoDevices(h);
  const third = await registeredDevice(h, ADDRESS, { fresh: false });
  const ticket = await ticketFor(h, owner);
  const requests = [
    await signed(h.call, owner, '/device/remove', { device: second.id, ticket }),
    await signed(h.call, owner, '/device/remove', { device: third.id, ticket }),
  ];
  const answers = await Promise.all(requests.map(async (r) => answer(await h.call(r))));
  assert.deepEqual(answers.map((a) => a.status).sort(), [200, 401]);
  const removed = [second.id, third.id].filter((id) => removedAt(h, id) !== null);
  assert.equal(removed.length, 1, 'one code, one removal');
});

// ---- at once ----

test('a removal with a fresh code works at once, and the removed device is refused on its very next request', async () => {
  const h = harness();
  const { owner, second } = await twoDevices(h);
  const held = await nonceFor(h.call, second); // a nonce the removed device already holds
  const ticket = await ticketFor(h, owner);
  assert.deepEqual(await removal(h, owner, { device: second.id, ticket }), OK);
  assert.equal(removedAt(h, second.id), h.clock.ms, 'stamped removed at the moment of the request, no delay');
  // The very next request, at the same moment, with the nonce it held.
  assert.deepEqual(await answer(await h.call(await signed(h.call, second, '/pin/verify', { pin: PIN }, { nonce: held }))), NO_DEVICE);
  assert.deepEqual(await answer(await h.call(post('/nonce', {}, { 'x-hz-device': second.id }))), NO_DEVICE);
  assert.equal((await answer(await h.call(await signed(h.call, owner, '/pin/verify', { pin: PIN })))).json.error, 'no-pin',
    'NEGATIVE CONTROL: the device that removed it carries on');
});

test('a device removes itself with its own fresh code', async () => {
  const h = harness();
  const { owner } = await twoDevices(h);
  assert.deepEqual(await removal(h, owner, { device: owner.id, ticket: await ticketFor(h, owner) }), OK);
  assert.deepEqual(await answer(await h.call(post('/nonce', {}, { 'x-hz-device': owner.id }))), NO_DEVICE);
  assert.equal(removalNotes(h).length, 1);
});

// ---- the notice mail ----

test('a removal mails the account address a notice with no secret in it', async () => {
  const h = harness();
  const { owner, second } = await twoDevices(h);
  const ticket = await ticketFor(h, owner);
  assert.deepEqual(await removal(h, owner, { device: second.id, ticket }), OK);
  const notes = removalNotes(h);
  assert.equal(notes.length, 1, 'one notice');
  assert.deepEqual(notes[0], { to: ADDRESS, ...REMOVED_NOTE }, 'to the account address, the fixed note');
  const text = notes[0].subject + notes[0].text;
  const account = h.db.sqlite.prepare('SELECT account_id FROM device WHERE id = ?').get(owner.id).account_id;
  for (const value of [ticket, owner.id, second.id, account, owner.signKey, second.signKey, owner.secret, PASSWORD]) {
    assert.equal(text.includes(value), false, 'the notice carries no value of the request or the account');
  }
  assert.equal(/\d|https?:/.test(text), false, 'no number and no link');
  // The code is not kept in clear anywhere either.
  assert.equal(everyRow(h.db).includes(ticket), false, 'no table holds the ticket');
});

test('a removal that removes nothing mails nobody, and answers the same', async () => {
  const h = harness();
  const { owner } = await twoDevices(h);
  const theirs = await registeredDevice(h, OTHER);
  assert.deepEqual(await removal(h, owner, { device: theirs.id, ticket: await ticketFor(h, owner) }), OK);
  assert.deepEqual(await removal(h, owner, { device: 'never-registered', ticket: await ticketFor(h, owner) }), OK);
  assert.equal(removedAt(h, theirs.id), null, "another account's device is untouched");
  assert.equal(removalNotes(h).length, 0, 'no notice for a removal that changed nothing');
});

test('without a mailer nothing is removed and the code is not spent', async () => {
  const h = harness();
  const { owner, second } = await twoDevices(h);
  const ticket = await ticketFor(h, owner);
  // The deployed Worker builds its mailer from RESEND_KEY and HZ_MAIL_FROM;
  // with neither bound there is none.
  const bare = createHandler({ now: () => h.clock.ms, mailer: null, pinRules: null });
  const call = (req) => bare(req, h.env, { waitUntil: () => {} });
  assert.deepEqual(await answer(await call(await signed(call, owner, '/device/remove', { device: second.id, ticket }))),
    { status: 503, json: { error: 'unavailable' } });
  assert.equal(removedAt(h, second.id), null);
  assert.deepEqual(await removal(h, owner, { device: second.id, ticket }), OK, 'NEGATIVE CONTROL: the same code still removes once mail works');
});

// ---- the audit ----

test('each removal try writes one audit row of route and reason, and a failed notice a second', async () => {
  // The sign-up link still arrives; every send after the setup fails.
  const fail = { on: false };
  const failing = harness({ mailer: async (m) => { failing.mail.push(m); return !fail.on; } });
  const { owner, second } = await twoDevices(failing);
  const ticket = await ticketFor(failing, owner);
  fail.on = true;
  const before = auditRows(failing.db).length;
  await removal(failing, owner, { device: second.id });
  assert.deepEqual(await removal(failing, owner, { device: second.id, ticket }), OK, 'the removal holds when the mail fails');
  await removal(failing, owner, { device: second.id, ticket });
  assert.deepEqual(auditRows(failing.db).slice(before), [
    { route: '/nonce', reason: 'ok' },
    { route: '/device/remove', reason: 'code-needed' },
    { route: '/nonce', reason: 'ok' },
    { route: '/device/remove', reason: 'ok' },
    { route: '/device/remove', reason: 'mail-failed' },
    { route: '/nonce', reason: 'ok' },
    { route: '/device/remove', reason: 'bad-ticket' },
  ]);
  assert.notEqual(removedAt(failing, second.id), null);
});

// ---- the test ticket helper ----

test('a ticket the test key signs for the caller reads as a fresh code', async () => {
  // Pins the form src/pin.js readTicket accepts, so the A4 tests that remove a
  // device without enrolling a code can hand one in (helpers.mjs freshCode).
  const h = harness();
  const { owner, second } = await twoDevices(h);
  const account = h.db.sqlite.prepare('SELECT account_id FROM device WHERE id = ?').get(owner.id).account_id;
  const claims = { v: 1, account, device: owner.id, at: h.clock.ms, exp: h.clock.ms + TICKET_TTL_MS, jti: 'A'.repeat(22) };
  const ticket = await signWithTicketKey(claims, UNLOCK_TICKET_LABEL_TEXT);
  assert.deepEqual(await removal(h, owner, { device: second.id, ticket }), OK);
});
