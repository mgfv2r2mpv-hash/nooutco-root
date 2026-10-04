// A5b, the forgotten PIN (plan §3.4 "Forgotten PIN"): reset with any two of
// the code, the account password and an emailed single-use code, plus Face
// ID on a registered device (the device signature). The emailed code rides
// in the URL fragment. The old PIN is locked.
//
//   /pin/reset {}                                         -> {ok: true}  mails the code
//   /pin/reset {pin, ticket?, password?, emailCode?}      -> {ok: true}  any two of the three
//
// The code is an unlock ticket from /unlock/finish, as at every open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIN_RESET_LIMITS } from '../src/pin-reset.js';
import { accountKeys } from '../src/account-keys.js';
import { PIN_LOCKED } from '../../../packages/account-engine/src/pin.mjs';
import {
  harness, everyRow, registeredDevice, ticketFor, pinCall, pinnedDevice, PASSWORD, RESET_BASE,
} from './helpers.mjs';

// Fixed, fake values: a reserved-domain address and PINs with no run of
// three that are not on the public fixture list.
const ADDRESS = 'pin-reset@example.test';
const FIRST = '274951';
const SECOND = '385062';
const THIRD = '496173';
const WRONG_PASSWORD = 'not the password FAKE';
const WRONG_EMAIL_CODE = 'AAAAAAAAAAAAAAAAAAAAAA';
const HOUR_MS = 60 * 60 * 1000;
const TWO_NEEDED = { status: 400, json: { error: 'two-needed' } };
const BAD_RESET = { status: 401, json: { error: 'bad-reset' } };
const RESET = { status: 200, json: { ok: true } };

// Asks for the emailed code and reads it from the link's fragment, as the
// app does when the owner opens the mail on the device.
async function mailedCode(h, dev) {
  const asked = await pinCall(h, dev, '/pin/reset', {});
  assert.deepEqual(asked, RESET, 'the mail is asked for');
  const message = h.mail.filter((m) => m.to === ADDRESS && m.text.includes(RESET_BASE)).at(-1);
  assert.ok(message, 'a reset mail went to the account address');
  return new URL(message.text.match(/https:\/\/\S+/)[0]).hash.slice(1);
}

// The body's factors, by name, fetched fresh.
async function factors(h, dev, names) {
  const body = {};
  if (names.includes('code')) body.ticket = await ticketFor(h, dev);
  if (names.includes('password')) body.password = PASSWORD;
  if (names.includes('email')) body.emailCode = await mailedCode(h, dev);
  return body;
}

// ---- the plan test ----

test('a forgotten PIN resets with any two of code, password and email code, never one', async () => {
  for (const pair of [['code', 'password'], ['code', 'email'], ['password', 'email'], ['code', 'password', 'email']]) {
    const h = harness();
    const dev = await pinnedDevice(h, ADDRESS, FIRST);
    assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND }), TWO_NEEDED, `${pair}: none alone`);
    for (const one of ['code', 'password', 'email']) {
      assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, ...(await factors(h, dev, [one])) }), TWO_NEEDED, `${pair}: ${one} alone`);
    }
    assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: SECOND }), { status: 401, json: { error: 'bad-pin' } }, `${pair}: NEGATIVE CONTROL, nothing reset yet`);

    assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, ...(await factors(h, dev, pair)) }), RESET, `${pair} resets`);
    assert.equal((await pinCall(h, dev, '/pin/verify', { pin: SECOND })).status, 200, `${pair}: the new PIN opens`);
    assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: FIRST }), { status: 401, json: { error: 'bad-pin' } }, `${pair}: the old PIN no longer opens`);
  }
});

// ---- each factor is checked, and spent only by a reset ----

test('a wrong factor beside a right one is refused as bad-reset, never says which, and spends nothing', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  const emailCode = await mailedCode(h, dev);
  const ticket = await ticketFor(h, dev);

  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, ticket, password: WRONG_PASSWORD }), BAD_RESET, 'wrong password');
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, emailCode, password: WRONG_PASSWORD }), BAD_RESET, 'wrong password beside the email code');
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, ticket, emailCode: WRONG_EMAIL_CODE }), BAD_RESET, 'wrong email code');
  const [payload, sig] = ticket.split('.');
  const forged = `${payload}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BA' : 'AA'}`;
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, ticket: forged, password: PASSWORD }), BAD_RESET, 'a forged ticket');
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: FIRST })).status, 200, 'the PIN is as it was');

  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, ticket, emailCode }), RESET, 'NEGATIVE CONTROL: neither was spent by the refusals');
});

test('a reset spends the ticket and the email code it used', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  const emailCode = await mailedCode(h, dev);
  const ticket = await ticketFor(h, dev);
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, ticket, emailCode }), RESET);
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: THIRD, emailCode, password: PASSWORD }), BAD_RESET, 'the email code works once');
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: THIRD, ticket, password: PASSWORD }), BAD_RESET, 'the ticket works once');
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: SECOND })).status, 200, 'the PIN is the one the reset set');
});

test('a reset locks the old PIN, and a reset to a locked PIN answers the one sentence and spends nothing', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  const salt = h.db.sqlite.prepare('SELECT salt FROM pin WHERE account_id = ?').get(dev.account).salt;
  const emailCode = await mailedCode(h, dev);

  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: FIRST, emailCode, password: PASSWORD }),
    { status: 409, json: { error: 'pin-reused', message: PIN_LOCKED } }, 'the forgotten PIN is not a new one');
  const at = h.clock.ms;
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, emailCode, password: PASSWORD }), RESET, 'the email code survived the refusal');

  const keys = await accountKeys(h.env);
  const locks = h.db.sqlite.prepare('SELECT verifier, locked_until FROM pin_lock WHERE account_id = ?').all(dev.account).map((r) => ({ ...r }));
  assert.deepEqual(locks, [{ verifier: await keys.pinVerifier(FIRST, salt), locked_until: at + 365 * 24 * HOUR_MS }], 'the old PIN is locked');
  assert.equal(h.db.sqlite.prepare('SELECT set_at FROM pin WHERE account_id = ?').get(dev.account).set_at, at, 'a reset restarts the PIN\'s age');
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: FIRST, current: SECOND }), { status: 409, json: { error: 'pin-reused', message: PIN_LOCKED } });
});

test('the emailed code rides in a link fragment, dies after its life, and a newer mail replaces it', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  const first = await mailedCode(h, dev);
  assert.match(first, /^[A-Za-z0-9_-]{22}$/, '128 random bits, base64url');
  const message = h.mail.at(-1);
  assert.ok(message.text.includes(`${RESET_BASE}#${first}`), 'the code rides only after #');
  assert.equal(/\d/.test(message.subject + message.text.replace(/https:\/\/\S+/, '')), false, 'the mail carries no number but the link');

  const second = await mailedCode(h, dev);
  assert.notEqual(second, first);
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, emailCode: first, password: PASSWORD }), BAD_RESET, 'a newer mail ends the older code');

  h.clock.ms += PIN_RESET_LIMITS.codeTtlMs;
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, emailCode: second, password: PASSWORD }), BAD_RESET, 'dead at the end of its life');
  const third = await mailedCode(h, dev);
  h.clock.ms += PIN_RESET_LIMITS.codeTtlMs - 1;
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, emailCode: third, password: PASSWORD }), RESET, 'live up to its last moment');
});

// ---- who may, and how often ----

test('a pending device can neither ask for the mail nor reset, and an account locked by the offline block cannot reset', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  const pending = await registeredDevice(h, ADDRESS, { fresh: false });
  assert.deepEqual(await pinCall(h, pending, '/pin/reset', {}), { status: 401, json: { error: 'no-device' } });
  assert.deepEqual(await pinCall(h, pending, '/pin/reset', { pin: SECOND, password: PASSWORD, ticket: await ticketFor(h, dev) }), { status: 401, json: { error: 'no-device' } });
  assert.equal(h.mail.some((m) => m.text.includes(RESET_BASE)), false, 'no reset mail went out');

  const ticket = await ticketFor(h, dev);
  assert.equal((await pinCall(h, dev, '/pin/blocked', {})).status, 423);
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, password: PASSWORD, ticket }), { status: 423, json: { error: 'account-locked' } });
});

test('reset tries and reset mails are capped per account, each hour', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  const ticket = await ticketFor(h, dev);
  for (let n = 0; n < PIN_RESET_LIMITS.triesPerHour; n += 1) {
    assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, ticket, password: WRONG_PASSWORD }), BAD_RESET, `try ${n + 1}`);
  }
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, ticket, password: PASSWORD }), { status: 429, json: { error: 'slow-down' } }, 'even the right password waits');

  for (let n = 0; n < PIN_RESET_LIMITS.mailsPerHour; n += 1) assert.deepEqual(await pinCall(h, dev, '/pin/reset', {}), RESET);
  const mailed = h.mail.length;
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', {}), { status: 429, json: { error: 'slow-down' } });
  assert.equal(h.mail.length, mailed, 'no mail past the cap');

  h.clock.ms += HOUR_MS;
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, password: PASSWORD, ticket: await ticketFor(h, dev) }), RESET, 'an hour on, the right factors reset');
});

// ---- custody, mail and configuration ----

test('no PIN, password or email code is stored or bound in clear, and the owner is told of the reset with no number', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  const emailCode = await mailedCode(h, dev);
  const before = h.mail.length;
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: SECOND, emailCode, password: PASSWORD }), RESET);

  const rows = everyRow(h.db);
  for (const value of [SECOND, emailCode, PASSWORD]) assert.equal(rows.includes(value), false, 'no table holds a reset value');
  const bound = JSON.stringify(h.db.bound.map((b) => b.values));
  for (const value of [SECOND, emailCode, PASSWORD]) assert.equal(bound.includes(value), false, 'no statement was bound with a reset value');

  const notes = h.mail.slice(before);
  assert.equal(notes.length, 1, 'one note');
  assert.equal(notes[0].to, ADDRESS);
  assert.equal(/\d|https:/.test(notes[0].subject + notes[0].text), false, 'no number and no link');
  assert.match(notes[0].text, /PIN/);
});

test('without a usable reset link base no code is mailed, and without the PIN rules no PIN is reset', async () => {
  const bad = harness({ env: { HZ_RESET_BASE: 'http://horae-zone.example.test/pin-reset' } });
  const dev = await pinnedDevice(bad, ADDRESS, FIRST);
  assert.deepEqual(await pinCall(bad, dev, '/pin/reset', {}), { status: 503, json: { error: 'unavailable' } });
  assert.equal(bad.mail.some((m) => m.text.includes('pin-reset')), false);

  const h = harness();
  const other = await pinnedDevice(h, ADDRESS, FIRST);
  const ticket = await ticketFor(h, other);
  const ruleless = harness({ pinRules: null });
  const third = await registeredDevice(ruleless, ADDRESS);
  assert.deepEqual(await pinCall(ruleless, third, '/pin/reset', { pin: SECOND, password: PASSWORD, ticket: 'x.y' }), { status: 503, json: { error: 'unavailable' } });
  assert.deepEqual(await pinCall(h, other, '/pin/reset', { pin: SECOND, password: PASSWORD, ticket }), RESET, 'NEGATIVE CONTROL: with the rules it resets');
});
