// A5, enrolling the one authenticator code (plan §3.1 custody, §3.3 "First
// device" step 4, §3.6 /otp/enrol). POST /otp/enrol {ticket}, signed by a
// registered device and carrying a live /signin ticket of the same account,
// answers {secret, uri} once: the base32 seed and its otpauth URI, for the QR.
// The seed is stored only sealed under the Worker secret HZ_SEED_KEY, bound
// to its account, and no later answer, row, bound value or log carries it.
//
// Once an account has a code, a device must prove it: a device registered
// after enrolment, and every device but the enrolling one, reaches only
// /nonce and /unlock until a code it proves is accepted (A4 open point 1:
// sign-in for a further device is address + password + code).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OTP_LABEL, openSeed } from '../src/otp.js';
import { otpauthUri, base32Decode } from '../../../packages/account-engine/src/totp.mjs';
import { SIGNIN_LIMITS } from '../src/signin.js';
import { b64url } from '../src/checks.js';
import {
  harness, post, signed, auditRows, everyRow, signUp, signIn, registeredDevice, registerRequest, deviceKeys,
  enrolRequest, enrolledDevice, codeAt, tryCode, SEED_KEY,
} from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses.
const ADDRESS = 'code-owner@example.test';
const OTHER = 'someone-else@example.test';

async function answer(res) {
  return { status: res.status, json: await res.json() };
}

const otpRows = (db) => db.sqlite.prepare('SELECT * FROM otp').all().map((r) => ({ ...r }));
const pendingOf = (db, id) => db.sqlite.prepare('SELECT pending FROM device WHERE id = ?').get(id).pending;

// ---- the plan test ----

test('the seed is returned once and never again', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const first = await answer(await h.call(await enrolRequest(h.call, dev, await signIn(h, ADDRESS))));
  assert.equal(first.status, 200);
  assert.deepEqual(Object.keys(first.json).sort(), ['secret', 'uri']);
  const { secret, uri } = first.json;
  assert.match(secret, /^[A-Z2-7]{32}$/, 'a 20-byte seed in base32');
  assert.equal(uri, otpauthUri({ key: base32Decode(secret), ...OTP_LABEL }));
  // A second enrolment, with a fresh ticket, is refused and carries no seed.
  const again = await answer(await h.call(await enrolRequest(h.call, dev, await signIn(h, ADDRESS))));
  assert.deepEqual(again, { status: 409, json: { error: 'enrolled' } });
  // Nothing after the one answer carries it: not a code try, a table, a
  // bound value or an audit row.
  const later = [];
  const tried = await tryCode(h, { ...dev, seed: base32Decode(secret) }, await codeAt({ seed: base32Decode(secret) }, h.clock.ms));
  later.push(JSON.stringify(tried));
  later.push(JSON.stringify(await answer(await h.call(await signed(h.call, dev, '/reverify', {})))));
  const seedHex = [...base32Decode(secret)].map((b) => b.toString(16).padStart(2, '0')).join('');
  for (const value of [secret, seedHex, b64url(base32Decode(secret))]) {
    for (const text of later) assert.equal(text.includes(value), false, 'a later answer carries the seed');
    assert.equal(everyRow(h.db).includes(value), false, 'a table carries the seed');
    assert.equal(JSON.stringify(h.db.bound.map((b) => b.values)).includes(value), false, 'a bound value carries the seed');
  }
  assert.equal(otpRows(h.db).length, 1);
});

// ---- the ticket and the device ----

test('enrolment needs a live sign-in ticket of the signing device\'s account', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  await signUp(h, OTHER);
  const theirKeys = await deviceKeys();
  const theirs = await signIn(h, OTHER, { keys: theirKeys });
  assert.deepEqual(await answer(await h.call(await enrolRequest(h.call, dev, theirs))), { status: 401, json: { error: 'bad-ticket' } });
  assert.equal((await h.call(registerRequest(theirs, theirKeys))).status, 200, 'the refusal did not spend the other account\'s ticket');
  assert.deepEqual(await answer(await h.call(await enrolRequest(h.call, dev, 'A'.repeat(43)))), { status: 401, json: { error: 'bad-ticket' } });
  const expired = await signIn(h, ADDRESS);
  h.clock.ms += SIGNIN_LIMITS.ticketTtlMs;
  assert.deepEqual(await answer(await h.call(await enrolRequest(h.call, dev, expired))), { status: 401, json: { error: 'bad-ticket' } });
  assert.deepEqual(otpRows(h.db), [], 'no seed without a live ticket of this account');
});

test('a ticket enrols once: the ticket that enrolled cannot enrol again or register a device', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const keys = await deviceKeys();
  const ticket = await signIn(h, ADDRESS, { keys });
  assert.equal((await h.call(await enrolRequest(h.call, dev, ticket))).status, 200);
  assert.deepEqual(await answer(await h.call(registerRequest(ticket, keys))), { status: 401, json: { error: 'bad-ticket' } });
});

test('enrolment needs a signed request from a registered device', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const ticket = await signIn(h, ADDRESS);
  assert.equal((await answer(await h.call(post('/otp/enrol', { ticket })))).json.error, 'no-device');
  assert.deepEqual(otpRows(h.db), []);
});

test('an enrol body must be exactly one ticket', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const ticket = await signIn(h, ADDRESS);
  for (const body of [{}, { ticket: 7 }, { ticket, secret: 'JBSWY3DPEHPK3PXP' }, { ticket: 'short' }]) {
    assert.deepEqual(await answer(await h.call(await signed(h.call, dev, '/otp/enrol', body))), { status: 400, json: { error: 'shape' } });
  }
  assert.equal((await h.call(await enrolRequest(h.call, dev, ticket))).status, 200, 'the ticket still works');
});

// ---- custody ----

test('the seed is stored only sealed under the seed key, bound to its account', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const [row] = otpRows(h.db);
  assert.equal(row.account_id, dev.account);
  assert.deepEqual(await openSeed({ HZ_SEED_KEY: SEED_KEY }, dev.account, row.box), dev.seed);
  await assert.rejects(openSeed({ HZ_SEED_KEY: b64url(new Uint8Array(32).fill(3)) }, dev.account, row.box), 'another key does not open it');
  await assert.rejects(openSeed({ HZ_SEED_KEY: SEED_KEY }, 'another-account', row.box), 'a box moved to another account does not open');
});

test('NEGATIVE CONTROL: two accounts get different seeds', async () => {
  const h = harness();
  const one = await enrolledDevice(h, ADDRESS);
  const two = await enrolledDevice(h, OTHER);
  assert.notEqual(one.secret, two.secret);
});

test('without the seed key, enrolment answers unavailable and stores nothing', async () => {
  for (const HZ_SEED_KEY of [undefined, b64url(new Uint8Array(16).fill(9)), 'not base64url!']) {
    const h = harness({ env: { HZ_SEED_KEY } });
    const dev = await registeredDevice(h, ADDRESS);
    assert.deepEqual(await answer(await h.call(await enrolRequest(h.call, dev, await signIn(h, ADDRESS)))), { status: 503, json: { error: 'unavailable' } });
    assert.deepEqual(otpRows(h.db), []);
  }
});

// ---- devices must prove the code once the account has one ----

test('a device registered after enrolment reaches only /nonce and /unlock until it proves a code', async () => {
  const h = harness();
  const first = await enrolledDevice(h, ADDRESS);
  const next = await registeredDevice(h, ADDRESS, { fresh: false });
  assert.equal(pendingOf(h.db, next.id), 1);
  for (const [p, body] of [['/reverify', {}], ['/otp/enrol', { ticket: await signIn(h, ADDRESS) }], ['/device/remove', { device: first.id }]]) {
    assert.deepEqual(await answer(await h.call(await signed(h.call, next, p, body))), { status: 401, json: { error: 'no-device' } }, p);
  }
  assert.equal(pendingOf(h.db, first.id), 0, 'the remove did not happen');
  const tried = await tryCode(h, { ...next, seed: first.seed }, await codeAt(first, h.clock.ms));
  assert.equal(tried.finish.status, 200, 'the code is proved');
  assert.equal(pendingOf(h.db, next.id), 0);
  assert.equal((await answer(await h.call(await signed(h.call, next, '/reverify', {})))).json.error, 'not-built', 'it now passes the device checks');
});

test('a device registered before enrolment must prove a code after it', async () => {
  const h = harness();
  const first = await registeredDevice(h, ADDRESS);
  const early = await registeredDevice(h, ADDRESS, { fresh: false });
  const res = await answer(await h.call(await enrolRequest(h.call, first, await signIn(h, ADDRESS))));
  assert.equal(res.status, 200);
  assert.equal(pendingOf(h.db, early.id), 1);
  assert.equal((await answer(await h.call(await signed(h.call, early, '/reverify', {})))).json.error, 'no-device');
  const seed = base32Decode(res.json.secret);
  assert.equal((await tryCode(h, { ...early, seed }, await codeAt({ seed }, h.clock.ms))).finish.status, 200);
  assert.equal((await answer(await h.call(await signed(h.call, early, '/reverify', {})))).json.error, 'not-built');
});

test('NEGATIVE CONTROL: the enrolling device and devices of an account with no code are not held back', async () => {
  const h = harness();
  const first = await enrolledDevice(h, ADDRESS);
  assert.equal(pendingOf(h.db, first.id), 0);
  assert.equal((await answer(await h.call(await signed(h.call, first, '/reverify', {})))).json.error, 'not-built');
  const other = await registeredDevice(h, OTHER);
  assert.equal(pendingOf(h.db, other.id), 0);
});

test('enrolment writes one audit row of route and reason', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const ticket = await signIn(h, ADDRESS);
  const before = auditRows(h.db).length;
  await h.call(await enrolRequest(h.call, dev, ticket));
  await h.call(await enrolRequest(h.call, dev, ticket));
  assert.deepEqual(auditRows(h.db).slice(before), [
    { route: '/nonce', reason: 'ok' },
    { route: '/otp/enrol', reason: 'ok' },
    { route: '/nonce', reason: 'ok' },
    { route: '/otp/enrol', reason: 'bad-ticket' },
  ]);
});
