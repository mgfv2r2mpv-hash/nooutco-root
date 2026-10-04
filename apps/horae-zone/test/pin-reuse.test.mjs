// A5b, the reuse lock (plan §3.4 "Reuse lock"). Every replaced PIN is locked
// from reuse for 365 days, whether it was reset, replaced at the annual
// review or changed voluntarily; several can be locked at once, kept as keyed
// hashes with a lock-until; the only user-facing text is "That PIN is locked
// for reuse.", with no date, duration, count or hint of which PIN.
//
//   /pin/set {pin, current, ticket?} -> {ok: true, grant}  a change
//
// A change is an open that also names the new PIN: the device signature, the
// current PIN, and the code when this device's last code is 12 hours old.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIN_LIMITS } from '../src/pin.js';
import { accountKeys } from '../src/account-keys.js';
import { PIN_LOCKED } from '../../../packages/account-engine/src/pin.mjs';
import { harness, everyRow, registeredDevice, ticketFor, pinCall, pinnedDevice } from './helpers.mjs';

// Fixed, fake values: a reserved-domain address and PINs with no run of
// three that are not on the public fixture list.
const ADDRESS = 'pin-reuse@example.test';
const FIRST = '274951';
const SECOND = '385062';
const THIRD = '496173';
const DAY_MS = 24 * 60 * 60 * 1000;
const LOCKED = { status: 409, json: { error: 'pin-reused', message: 'That PIN is locked for reuse.' } };

const pinRow = (h, account) => ({ ...h.db.sqlite.prepare('SELECT verifier, salt, set_at FROM pin WHERE account_id = ?').get(account) });
const lockRows = (h) => h.db.sqlite.prepare('SELECT * FROM pin_lock ORDER BY locked_until').all().map((r) => ({ ...r }));

// ---- the plan test ----

test('a replaced PIN is refused with exactly: That PIN is locked for reuse.', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  assert.equal(PIN_LOCKED, 'That PIN is locked for reuse.');

  const changed = await pinCall(h, dev, '/pin/set', { pin: SECOND, current: FIRST });
  assert.equal(changed.status, 200, 'NEGATIVE CONTROL: a change to a PIN never used is accepted');
  assert.deepEqual(Object.keys(changed.json).sort(), ['grant', 'ok']);
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: FIRST }), { status: 401, json: { error: 'bad-pin' } }, 'the replaced PIN no longer opens');
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: SECOND })).status, 200, 'the new PIN opens');

  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: FIRST, current: SECOND }), LOCKED, 'the replaced PIN is locked');
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: SECOND, current: SECOND }), LOCKED, 'the current PIN is not a change');

  // Several locked at once, refused with the one sentence, whichever it is.
  assert.equal((await pinCall(h, dev, '/pin/set', { pin: THIRD, current: SECOND })).status, 200);
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: FIRST, current: THIRD }), LOCKED);
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: SECOND, current: THIRD }), LOCKED);
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: THIRD })).status, 200, 'a refused change leaves the PIN as it was');
});

// ---- what the lock keeps ----

test('the lock is a keyed hash with a lock-until 365 days on, and the PIN opens for reuse after it', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  const { salt } = pinRow(h, dev.account);
  const changedAt = h.clock.ms;
  assert.equal((await pinCall(h, dev, '/pin/set', { pin: SECOND, current: FIRST })).status, 200);
  assert.equal(PIN_LIMITS.reuseLockMs, 365 * DAY_MS);

  const keys = await accountKeys(h.env);
  assert.deepEqual(lockRows(h), [{ account_id: dev.account, verifier: await keys.pinVerifier(FIRST, salt), locked_until: changedAt + PIN_LIMITS.reuseLockMs }]);
  assert.equal(pinRow(h, dev.account).salt, salt, 'the account keeps its salt, so a locked PIN is compared with one slow hash');
  assert.equal(pinRow(h, dev.account).set_at, changedAt, 'a change restarts the PIN\'s age');
  assert.equal(everyRow(h.db).includes(FIRST), false, 'no table holds a locked PIN');
  assert.equal(JSON.stringify(h.db.bound.map((b) => b.values)).includes(FIRST), false, 'no statement was bound with it');

  // A fresh code a minute before the lock-until (ticketFor moves the clock on
  // one 30-second step); a refused change does not spend it.
  h.clock.ms = changedAt + PIN_LIMITS.reuseLockMs - 60_000;
  const late = await ticketFor(h, dev);
  h.clock.ms = changedAt + PIN_LIMITS.reuseLockMs - 1;
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: FIRST, current: SECOND, ticket: late }), LOCKED, 'locked up to the last moment');
  h.clock.ms = changedAt + PIN_LIMITS.reuseLockMs;
  assert.equal((await pinCall(h, dev, '/pin/set', { pin: FIRST, current: SECOND, ticket: late })).status, 200, 'and free once the lock-until has passed');
});

test('the table locks every replaced PIN, however the replacing write came', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  const before = pinRow(h, dev.account);
  h.db.sqlite.prepare('UPDATE pin SET verifier = ?, set_at = ? WHERE account_id = ?').run('pbkdf2-sha256$100000$' + 'ab'.repeat(32), h.clock.ms, dev.account);
  assert.deepEqual(lockRows(h), [{ account_id: dev.account, verifier: before.verifier, locked_until: h.clock.ms + PIN_LIMITS.reuseLockMs }]);
  h.db.sqlite.prepare('UPDATE pin SET set_at = ? WHERE account_id = ?').run(h.clock.ms + 1, dev.account);
  assert.equal(lockRows(h).length, 1, 'a write that keeps the PIN locks nothing');
});

// ---- who may change it ----

test('a change needs the current PIN, and the code once this device\'s last code is 12 hours old', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  const before = pinRow(h, dev.account);
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: SECOND, current: THIRD }), { status: 401, json: { error: 'bad-pin' } });
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: SECOND }), { status: 400, json: { error: 'shape' } }, 'no current PIN and no ticket');
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: SECOND, current: '12345' }), { status: 400, json: { error: 'shape' } });
  assert.deepEqual(pinRow(h, dev.account), before, 'a refused change changes nothing');
  assert.deepEqual(lockRows(h), []);

  h.clock.ms += PIN_LIMITS.codeEveryMs;
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: SECOND, current: FIRST }), { status: 401, json: { error: 'code-needed' } });
  assert.equal((await pinCall(h, dev, '/pin/set', { pin: SECOND, current: FIRST, ticket: await ticketFor(h, dev) })).status, 200);
});

test('a new PIN too easy to guess is refused with its sentence, and a pending device cannot change the PIN', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: '123456', current: FIRST }),
    { status: 400, json: { error: 'too-easy', message: 'That PIN is too easy to guess.' } });
  const pending = await registeredDevice(h, ADDRESS, { fresh: false });
  assert.deepEqual(await pinCall(h, pending, '/pin/set', { pin: SECOND, current: FIRST }), { status: 401, json: { error: 'no-device' } });
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: FIRST })).status, 200, 'the PIN is still the first');
});

test('a change before any PIN is set answers no-pin', async () => {
  const h = harness({});
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  h.db.sqlite.prepare('DELETE FROM pin').run();
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: SECOND, current: FIRST }), { status: 409, json: { error: 'no-pin' } });
});
