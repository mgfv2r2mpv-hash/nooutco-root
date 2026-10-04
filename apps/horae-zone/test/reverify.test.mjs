// A5b, the membership check (plan §3.3 "Offline and revocation", §3.6
// /reverify). The app retries the service at most every 5 minutes and
// re-verifies membership when it answers; these checks never extend the 12
// hours. When the service is online and access has been cut, the app locks
// at its next check.
//
//   /reverify {}  -> {ok: true}                      still a member
//                 |  429 {error: "slow-down"}        sooner than 5 minutes after this device's last
//                 |  401 {error: "no-device"}        cut: the device was removed
//                 |  423 {error: "account-locked"}   cut: the account is locked
//
// A cut is answered before the 5-minute gate, so the app never reads a
// slow-down where it should lock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REVERIFY_LIMITS } from '../src/reverify.js';
import {
  harness, post, signed, nonceFor, everyRow, landsMidFlight, removedMidFlight, registeredDevice, ticketFor, pinCall, pinnedDevice,
} from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses and a PIN with no run of
// three that is not on the public fixture list.
const ADDRESS = 'reverify@example.test';
const OTHER = 'reverify-other@example.test';
const PIN = '274951';
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MEMBER = { status: 200, json: { ok: true } };
const SLOW = { status: 429, json: { error: 'slow-down' } };
const REMOVED = { status: 401, json: { error: 'no-device' } };
const LOCKED = { status: 423, json: { error: 'account-locked' } };
// The router's read of the offline-block lock, the last check before the handler.
const READ_LOCK = 'SELECT 1 AS locked FROM account_lock';

async function answerOf(res) {
  return { status: res.status, json: await res.json() };
}

const check = (h, dev, body = {}) => pinCall(h, dev, '/reverify', body);
const reverifyRows = (h) => h.db.sqlite.prepare('SELECT * FROM reverify ORDER BY device_id').all().map((r) => ({ ...r }));
const provedAt = (h, dev) => h.db.sqlite.prepare('SELECT proved_at FROM device_check WHERE device_id = ?').get(dev.id).proved_at;

// A second device of the account that has proved the code and opened with the PIN.
async function secondDevice(h, dev) {
  const other = { ...(await registeredDevice(h, ADDRESS, { fresh: false })), email: ADDRESS, seed: dev.seed };
  const opened = await pinCall(h, other, '/pin/verify', { pin: PIN, ticket: await ticketFor(h, other) });
  if (opened.status !== 200) throw new Error(`the second device answered ${opened.status}`);
  return other;
}

// ---- the plan tests ----

test('no reverify comes sooner than five minutes after the last', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  assert.deepEqual(REVERIFY_LIMITS, { everyMs: 5 * MINUTE_MS });

  const first = h.clock.ms;
  assert.deepEqual(await check(h, dev), MEMBER, 'the first check answers');
  h.clock.ms = first + 1;
  assert.deepEqual(await check(h, dev), SLOW, 'at once after it, no');
  h.clock.ms = first + 5 * MINUTE_MS - 1;
  assert.deepEqual(await check(h, dev), SLOW, 'a moment short of five minutes, no');
  h.clock.ms = first + 5 * MINUTE_MS;
  assert.deepEqual(await check(h, dev), MEMBER, 'five minutes after the last, yes');

  // A refused check is not a check: the five minutes run from the last answered one.
  const second = h.clock.ms;
  h.clock.ms = second + 4 * MINUTE_MS;
  assert.deepEqual(await check(h, dev), SLOW);
  h.clock.ms = second + 5 * MINUTE_MS;
  assert.deepEqual(await check(h, dev), MEMBER, 'the refused try at four minutes moved nothing');
  assert.deepEqual(reverifyRows(h), [{ device_id: dev.id, account_id: dev.account, at: h.clock.ms }]);
});

test('a cut account locks the app at the next check', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const other = await secondDevice(h, dev);
  const stranger = await pinnedDevice(h, OTHER, PIN);
  for (const d of [dev, other, stranger]) assert.deepEqual(await check(h, d), MEMBER, 'NEGATIVE CONTROL: every member answers');

  // Access is cut: the other device's offline block locks the account.
  assert.deepEqual(await pinCall(h, other, '/pin/blocked', {}), LOCKED);
  h.clock.ms += 5 * MINUTE_MS;
  assert.deepEqual(await check(h, dev), LOCKED, 'the next check answers the cut');
  assert.deepEqual(await check(h, stranger), MEMBER, 'another account is not cut');

  // A cut is answered before the gate: a check sooner than five minutes is
  // told the cut, never slow-down.
  h.clock.ms += 1;
  assert.deepEqual(await check(h, dev), LOCKED);

  // A removed device is cut on its own, inside the five minutes too: a nonce
  // it held is refused, and it gets no new one.
  const keep = await pinnedDevice(h, 'reverify-third@example.test', PIN);
  assert.deepEqual(await check(h, keep), MEMBER);
  const held = await nonceFor(h.call, keep);
  h.db.sqlite.prepare('UPDATE device SET removed_at = ? WHERE id = ?').run(h.clock.ms, keep.id);
  h.clock.ms += 1;
  assert.deepEqual(await answerOf(await h.call(await signed(h.call, keep, '/reverify', {}, { nonce: held }))), REMOVED);
  assert.deepEqual(await answerOf(await h.call(post('/nonce', {}, { 'x-hz-device': keep.id }))), REMOVED);
});

// ---- supporting tests ----

test('a cut that lands mid-flight still wins: the check answers the cut, never ok', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  landsMidFlight(h, READ_LOCK, (db) => db.sqlite.prepare('INSERT INTO account_lock (account_id, locked_at) VALUES (?, ?)').run(dev.account, h.clock.ms));
  assert.deepEqual(await check(h, dev), LOCKED, 'a lock after the router read it');
  assert.deepEqual(reverifyRows(h), [], 'and nothing was recorded');

  const h2 = harness();
  const dev2 = await pinnedDevice(h2, ADDRESS, PIN);
  removedMidFlight(h2, dev2.id, READ_LOCK, { nonces: false });
  assert.deepEqual(await check(h2, dev2), REMOVED, 'a removal after the router read the device');
  assert.deepEqual(reverifyRows(h2), []);
});

test('checks never extend the 12 hours: the code is still asked at 12 hours, and no grant comes back', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const proved = provedAt(h, dev);
  for (let at = h.clock.ms; at < proved + 12 * HOUR_MS; at += 5 * MINUTE_MS) {
    h.clock.ms = at;
    assert.deepEqual(await check(h, dev), MEMBER);
  }
  assert.equal(provedAt(h, dev), proved, 'the device code time did not move');
  h.clock.ms = proved + 12 * HOUR_MS;
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: PIN }), { status: 401, json: { error: 'code-needed' } });
});

test('the five minutes are per device: one device checking does not hold back another', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const other = await secondDevice(h, dev);
  assert.deepEqual(await check(h, dev), MEMBER);
  assert.deepEqual(await check(h, other), MEMBER);
  assert.deepEqual(await check(h, dev), SLOW);
});

test('the check takes an empty body, a signature, and a device that is not pending', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  assert.deepEqual(await check(h, dev, { pin: PIN }), { status: 400, json: { error: 'shape' } });
  assert.equal((await h.call(post('/reverify', {}, { 'x-hz-device': dev.id }))).status, 401, 'an unsigned check is refused');
  const pending = await registeredDevice(h, ADDRESS, { fresh: false });
  assert.deepEqual(await check(h, pending), REMOVED, 'a pending device is no member yet');
  assert.deepEqual(reverifyRows(h), [], 'no refused check is recorded');
  assert.deepEqual(await check(h, dev), MEMBER, 'NEGATIVE CONTROL: the refusals held nothing back');
});

test('the record holds only which device checked and when, never a PIN, nonce or signature', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  await check(h, dev);
  assert.deepEqual(Object.keys(reverifyRows(h)[0]), ['device_id', 'account_id', 'at']);
  assert.ok(!everyRow(h.db).includes(PIN));
});
