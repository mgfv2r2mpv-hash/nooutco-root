// A5b, the offline block (plan §3.4 "Offline wrong PINs"). Offline, the app
// checks the PIN on the device, and 10 wrong in a row block it there until
// the service answers (client side, A8). The device then reports the block
// on /pin/blocked, and the service locks the whole account until an
// administrator unlocks it through /admin/unlock-account (A5c), whose
// handler calls unlockAccount (src/account-lock.js). The plan test unlocks
// through the route; the mail tests call the hook directly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlockAccount } from '../src/account-lock.js';
import {
  harness, post, signed, addDevice, makeAdmin, registeredDevice, ticketFor, pinCall, pinnedDevice,
} from './helpers.mjs';

// Fixed, fake values: a reserved-domain address and a PIN with no run of
// three that is not on the public fixture list.
const ADDRESS = 'pin-block@example.test';
const PIN = '274951';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const LOCKED = { status: 423, json: { error: 'account-locked' } };

async function answerOf(res) {
  return { status: res.status, json: await res.json() };
}

// A second device of the account that has proved the code and opened with
// the PIN, so it is neither pending nor short of a code.
async function secondDevice(h, dev) {
  const other = { ...(await registeredDevice(h, ADDRESS, { fresh: false })), email: ADDRESS, seed: dev.seed };
  const opened = await pinCall(h, other, '/pin/verify', { pin: PIN, ticket: await ticketFor(h, other) });
  if (opened.status !== 200) throw new Error(`the second device answered ${opened.status}`);
  return other;
}

// ---- the plan test ----

test('ten wrong PINs offline block the device until the service answers, and the service then locks the account until an admin unlocks it', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const other = await secondDevice(h, dev);

  // The blocked device reaches the service and reports the block; the answer
  // keeps it blocked.
  assert.deepEqual(await pinCall(h, dev, '/pin/blocked', {}), LOCKED);

  // The whole account is locked: every device, the PIN and the code alike.
  for (const d of [dev, other]) {
    assert.deepEqual(await pinCall(h, d, '/pin/verify', { pin: PIN }), LOCKED, 'a right PIN does not open');
    assert.deepEqual(await pinCall(h, d, '/unlock/start', {}), LOCKED, 'no code is taken, so no ticket is handed out');
  }
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: PIN, ticket: 'x.y' }), LOCKED);

  // Only an administrator unlocks it: time alone does not.
  h.clock.ms += 365 * DAY_MS;
  assert.deepEqual(await pinCall(h, other, '/pin/verify', { pin: PIN }), LOCKED, 'a year on, still locked');
  h.clock.ms -= 365 * DAY_MS;

  // A device of the account cannot unlock it; an administrator can (A5c).
  assert.deepEqual(await pinCall(h, other, '/admin/unlock-account', { email: ADDRESS }), { status: 403, json: { error: 'not-admin' } },
    'the locked account\'s own device');
  const admin = await addDevice(h.db, { id: 'admin-dev', account: 'admin-acct' });
  makeAdmin(h.db, 'admin-acct');
  assert.deepEqual(await answerOf(await h.call(await signed(h.call, admin, '/admin/unlock-account', { email: ADDRESS }))),
    { status: 200, json: { unlocked: true } });
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: PIN })).status, 200, 'unlocked, the PIN opens again');
  assert.equal((await pinCall(h, other, '/pin/verify', { pin: PIN })).status, 200);
});

test('the lock is read after the device checks: an unsigned request learns nothing, and a pending device cannot lock the account', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const pending = await registeredDevice(h, ADDRESS, { fresh: false });
  assert.deepEqual(await pinCall(h, pending, '/pin/blocked', {}), { status: 401, json: { error: 'no-device' } });
  assert.equal((await h.call(post('/pin/blocked', {}, { 'x-hz-device': dev.id }))).status, 401, 'an unsigned report is refused');
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: PIN })).status, 200, 'NEGATIVE CONTROL: neither locked the account');

  assert.deepEqual(await pinCall(h, dev, '/pin/blocked', {}), LOCKED);
  const unsigned = await answerOf(await h.call(post('/pin/verify', { pin: PIN }, { 'x-hz-device': dev.id })));
  assert.equal(unsigned.status, 401);
  assert.notEqual(unsigned.json.error, 'account-locked', 'an unsigned request is refused before the lock is read');
});

test('a report from another account locks only its own account', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const stranger = await pinnedDevice(h, 'pin-stranger@example.test', PIN);
  assert.deepEqual(await pinCall(h, stranger, '/pin/blocked', {}), LOCKED);
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: PIN })).status, 200);
});

test('the owner is mailed when the account locks, at most once an hour, and the note carries no number', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const before = h.mail.length;
  await pinCall(h, dev, '/pin/blocked', {});
  await pinCall(h, dev, '/pin/blocked', {});
  const notes = h.mail.slice(before);
  assert.equal(notes.length, 1, 'one note for the lock, none for a report on an account already locked');
  assert.equal(notes[0].to, ADDRESS);
  assert.doesNotMatch(`${notes[0].subject}\n${notes[0].text}`, /[0-9]/, 'no count, date or duration');

  await unlockAccount(h.db, dev.account);
  h.clock.ms += HOUR_MS - 1;
  await pinCall(h, dev, '/pin/blocked', {});
  assert.equal(h.mail.length - before, 1, 'a second lock inside the hour sends no second note');
  await unlockAccount(h.db, dev.account);
  h.clock.ms += 2;
  await pinCall(h, dev, '/pin/blocked', {});
  assert.equal(h.mail.length - before, 2, 'NEGATIVE CONTROL: a lock an hour later is mailed');
});

test('the lock row holds the account and its time only, and the report takes no body', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  assert.deepEqual(await pinCall(h, dev, '/pin/blocked', { wrong: 10 }), { status: 400, json: { error: 'shape' } });
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: PIN })).status, 200, 'a refused report locks nothing');
  await pinCall(h, dev, '/pin/blocked', {});
  const cols = h.db.sqlite.prepare('PRAGMA table_info(account_lock)').all().map((c) => c.name).sort();
  assert.deepEqual(cols, ['account_id', 'locked_at']);
});
