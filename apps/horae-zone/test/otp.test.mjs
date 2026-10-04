// A5, enrolling the one authenticator code (plan §3.1 custody, §3.3 "First
// device" step 4, §3.6 /otp/enrol). POST /otp/enrol {ticket}, signed by a
// registered device and carrying a live /signin ticket of the same account,
// answers {secret, uri} once: the base32 seed and its otpauth URI, for the QR.
// The seed is stored only sealed under the Worker secret HZ_SEED_KEY, bound
// to its account, and no later answer, row, bound value or log carries it.
//
// Once an account has a confirmed code, a device must prove it: a device
// registered after the first accepted code, and every device but the one
// that proved it, reaches only /nonce and /unlock until a code it proves is
// accepted (A4 open point 1: sign-in for a further device is address +
// password + code). Until that first accepted code the enrolment is
// unconfirmed and the owner device may enrol again for a new seed (A5
// security review item 3, A5 re-review item 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OTP_LABEL, openSeed } from '../src/otp.js';
import { otpauthUri, base32Decode } from '../../../packages/account-engine/src/totp.mjs';
import { SIGNIN_LIMITS } from '../src/signin.js';
import { b64url, fromB64url } from '../src/checks.js';
import { initiatorStart, initiatorFinish, unlockChannelFor } from '../../../packages/account-engine/src/pake.mjs';
import {
  harness, post, signed, auditRows, everyRow, signUp, signIn, registeredDevice, registerRequest, deviceKeys,
  enrolRequest, enrolTicket, enrolledDevice, confirmedDevice, codeAt, tryCode, removedMidFlight, landsMidFlight, SPEND_NONCE, SEED_KEY,
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
  const first = await answer(await h.call(await enrolRequest(h.call, dev, await enrolTicket(h, ADDRESS, dev))));
  assert.equal(first.status, 200);
  assert.deepEqual(Object.keys(first.json).sort(), ['secret', 'uri']);
  const { secret, uri } = first.json;
  assert.match(secret, /^[A-Z2-7]{32}$/, 'a 20-byte seed in base32');
  assert.equal(uri, otpauthUri({ key: base32Decode(secret), ...OTP_LABEL }));
  // Nothing after the one answer carries it: not a code try, a table, a
  // bound value or an audit row. The first accepted code confirms the
  // enrolment (A5 security review item 3), and a second enrolment after it,
  // with a fresh ticket, is refused and carries no seed.
  const later = [];
  const tried = await tryCode(h, { ...dev, seed: base32Decode(secret) }, await codeAt({ seed: base32Decode(secret) }, h.clock.ms));
  assert.equal(tried.finish.status, 200);
  later.push(JSON.stringify(tried));
  const again = await answer(await h.call(await enrolRequest(h.call, dev, await enrolTicket(h, ADDRESS, dev))));
  assert.deepEqual(again, { status: 409, json: { error: 'enrolled' } });
  later.push(JSON.stringify(again));
  later.push(JSON.stringify(await answer(await h.call(await signed(h.call, dev, '/pair/offer', {})))));
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
  const expired = await enrolTicket(h, ADDRESS, dev);
  h.clock.ms += SIGNIN_LIMITS.ticketTtlMs;
  assert.deepEqual(await answer(await h.call(await enrolRequest(h.call, dev, expired))), { status: 401, json: { error: 'bad-ticket' } });
  assert.deepEqual(otpRows(h.db), [], 'no seed without a live ticket of this account');
});

test('a ticket enrols once: the ticket that enrolled cannot enrol again or register a device', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const ticket = await enrolTicket(h, ADDRESS, dev);
  assert.equal((await h.call(await enrolRequest(h.call, dev, ticket))).status, 200);
  assert.deepEqual(await answer(await h.call(registerRequest(ticket, dev))), { status: 401, json: { error: 'bad-ticket' } });
});

// Security review M3, carried to A5 (open point 9): a ticket names the keys
// it was issued for, and enrolment spends it only for the device holding
// them, as /device/register does.
test('enrolment spends only a ticket bound to the signing device\'s own keys', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const otherKeys = await deviceKeys();
  const forOther = await signIn(h, ADDRESS, { keys: otherKeys });
  assert.deepEqual(await answer(await h.call(await enrolRequest(h.call, dev, forOther))), { status: 401, json: { error: 'bad-ticket' } });
  assert.deepEqual(await answer(await h.call(await enrolRequest(h.call, dev, await signIn(h, ADDRESS)))), { status: 401, json: { error: 'bad-ticket' } }, 'a ticket bound to no device');
  assert.deepEqual(otpRows(h.db), [], 'no seed for a ticket named for other keys');
  assert.equal((await h.call(registerRequest(forOther, otherKeys))).status, 200, 'the refusal did not spend the ticket');
});

test('NEGATIVE CONTROL: a ticket bound to the signing device\'s keys enrols', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  assert.equal((await h.call(await enrolRequest(h.call, dev, await signIn(h, ADDRESS, { keys: dev })))).status, 200);
  assert.equal(otpRows(h.db).length, 1);
});

// Security review L2, carried to A5 (open point 8): a removal of the
// enrolling device that lands after its request passed the checks wins.
const SPEND_TICKET = 'UPDATE ticket SET used = 1';
const NO_DEVICE = { status: 401, json: { error: 'no-device' } };

test('L2: a device removed after its signed enrol passed the checks gets no seed, and the ticket stays unspent', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const ticket = await enrolTicket(h, ADDRESS, dev);
  const tickets = () => h.db.sqlite.prepare('SELECT used FROM ticket').all().map((r) => r.used);
  const before = tickets();
  const request = await enrolRequest(h.call, dev, ticket);
  removedMidFlight(h, dev.id, SPEND_NONCE);
  assert.deepEqual(await answer(await h.call(request)), NO_DEVICE);
  assert.deepEqual(otpRows(h.db), [], 'no seed was stored');
  assert.deepEqual(tickets(), before, 'the ticket was not spent');
});

test('L2: a device removed after its enrol ticket was spent stores no seed', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const request = await enrolRequest(h.call, dev, await enrolTicket(h, ADDRESS, dev));
  removedMidFlight(h, dev.id, SPEND_TICKET);
  assert.deepEqual(await answer(await h.call(request)), NO_DEVICE);
  assert.deepEqual(otpRows(h.db), [], 'no seed was stored');
});

test('L2 NEGATIVE CONTROL: a removal of some other device mid-flight does not stop an enrol', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const request = await enrolRequest(h.call, dev, await enrolTicket(h, ADDRESS, dev));
  removedMidFlight(h, 'never-registered', SPEND_TICKET);
  assert.equal((await h.call(request)).status, 200);
  assert.equal(otpRows(h.db).length, 1);
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
  const ticket = await enrolTicket(h, ADDRESS, dev);
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
    assert.deepEqual(await answer(await h.call(await enrolRequest(h.call, dev, await enrolTicket(h, ADDRESS, dev)))), { status: 503, json: { error: 'unavailable' } });
    assert.deepEqual(otpRows(h.db), []);
  }
});

// ---- devices must prove the code once the account has one ----

test('a device registered after the first accepted code reaches only /nonce and /unlock until it proves a code', async () => {
  const h = harness();
  const first = await confirmedDevice(h, ADDRESS);
  const next = await registeredDevice(h, ADDRESS, { fresh: false });
  assert.equal(pendingOf(h.db, next.id), 1);
  for (const [p, body] of [['/pair/offer', {}], ['/otp/enrol', { ticket: await signIn(h, ADDRESS) }], ['/device/remove', { device: first.id }]]) {
    assert.deepEqual(await answer(await h.call(await signed(h.call, next, p, body))), { status: 401, json: { error: 'no-device' } }, p);
  }
  assert.equal(pendingOf(h.db, first.id), 0, 'the remove did not happen');
  const tried = await tryCode(h, { ...next, seed: first.seed }, await codeAt(first, h.clock.ms));
  assert.equal(tried.finish.status, 200, 'the code is proved');
  assert.equal(pendingOf(h.db, next.id), 0);
  assert.equal((await answer(await h.call(await signed(h.call, next, '/pair/offer', {})))).json.error, 'not-built', 'it now passes the device checks');
});

// A5 security review, item 1 (HIGH): a password thief who registers a device
// of its own must not enrol first and hold the owner's devices back. A5
// re-review: that device is pending from registration, so it reaches neither
// /otp/enrol nor /device/remove, and the owner device removes it. Item 2 of
// the re-review replaced the sole-device rule with the owner rule: until the
// first accepted code only the owner device enrols, and a pending device no
// longer blocks it.
test('A5 re-review 2: a second registered device cannot enrol, and does not block the owner device', async () => {
  const h = harness();
  const first = await registeredDevice(h, ADDRESS);
  const second = await registeredDevice(h, ADDRESS, { fresh: false });
  assert.deepEqual(await answer(await h.call(await enrolRequest(h.call, second, await enrolTicket(h, ADDRESS, second)))), NO_DEVICE, 'it is pending');
  assert.deepEqual(otpRows(h.db), [], 'no seed was stored');
  assert.equal((await h.call(await enrolRequest(h.call, first, await enrolTicket(h, ADDRESS, first)))).status, 200, 'the owner enrols');
  assert.equal(pendingOf(h.db, first.id), 0);
  assert.equal(pendingOf(h.db, second.id), 1);
  assert.equal((await h.call(await signed(h.call, first, '/device/remove', { device: second.id }))).status, 200, 'and removes the second');
});

test('A5 review 1: the probe (password thief registers and tries to enrol first) ends with the thief refused and removed', async () => {
  const h = harness();
  const owner = await registeredDevice(h, ADDRESS); // an account with no otp row
  // The thief holds only the password: it signs in and registers its own device.
  const thief = await registeredDevice(h, ADDRESS, { fresh: false });
  assert.deepEqual(await answer(await h.call(await enrolRequest(h.call, thief, await enrolTicket(h, ADDRESS, thief)))), NO_DEVICE);
  assert.deepEqual(otpRows(h.db), [], 'the thief got no seed');
  assert.equal(pendingOf(h.db, owner.id), 0, 'the owner\'s device is not held back');
  assert.deepEqual(await answer(await h.call(await signed(h.call, owner, '/device/remove', { device: thief.id }))), { status: 200, json: { ok: true } });
  assert.deepEqual(await answer(await h.call(post('/nonce', {}, { 'x-hz-device': thief.id }))), { status: 401, json: { error: 'no-device' } }, 'the thief is out');
  assert.equal((await h.call(await enrolRequest(h.call, owner, await enrolTicket(h, ADDRESS, owner)))).status, 200, 'the owner enrols');
});

test('A5 re-review 2: a device registered between the ticket spend and the seed insert is pending and does not block the enrolment', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const late = await deviceKeys();
  const request = await enrolRequest(h.call, dev, await enrolTicket(h, ADDRESS, dev));
  landsMidFlight(h, SPEND_TICKET, (db) => {
    db.sqlite.prepare('INSERT INTO device (id, account_id, sign_key, agree_key, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('late-device', dev.account, late.signKey, late.agreeKey, h.clock.ms);
  });
  assert.equal((await h.call(request)).status, 200);
  assert.equal(otpRows(h.db).length, 1);
  assert.equal(pendingOf(h.db, 'late-device'), 1);
});

test('A5 review 1 NEGATIVE CONTROL: after the owner device removes another, it enrols', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const gone = await registeredDevice(h, ADDRESS, { fresh: false });
  assert.equal((await h.call(await signed(h.call, dev, '/device/remove', { device: gone.id }))).status, 200);
  assert.equal((await h.call(await enrolRequest(h.call, dev, await enrolTicket(h, ADDRESS, dev)))).status, 200);
  assert.equal(otpRows(h.db).length, 1);
});

// A5 security review, item 3 (MEDIUM): a seed nobody claimed must not lock
// the account in. Until the first accepted code the enrolment is unconfirmed
// and repeatable (a fresh ticket, the owner device), and a repeat replaces
// the seed. A5 re-review: every device but the owner's is pending anyway.
const BAD_CODE = { status: 401, json: { error: 'bad-code' } };
const seedOf = (json) => base32Decode(json.secret);

test('A5 review 3: a repeated enrol before the first accepted code returns a new seed and invalidates the old one', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const first = await answer(await h.call(await enrolRequest(h.call, dev, await enrolTicket(h, ADDRESS, dev))));
  assert.equal(first.status, 200);
  const again = await answer(await h.call(await enrolRequest(h.call, dev, await enrolTicket(h, ADDRESS, dev))));
  assert.equal(again.status, 200, JSON.stringify(again.json));
  assert.deepEqual(Object.keys(again.json).sort(), ['secret', 'uri']);
  assert.notEqual(again.json.secret, first.json.secret, 'a new seed');
  assert.equal(otpRows(h.db).length, 1, 'the new seed replaced the old one');
  assert.deepEqual(await openSeed({ HZ_SEED_KEY: SEED_KEY }, dev.account, otpRows(h.db)[0].box), seedOf(again.json));
  const old = { ...dev, seed: seedOf(first.json) };
  const stale = await tryCode(h, old, await codeAt(old, h.clock.ms));
  assert.equal(stale.proved, false, 'the old seed\'s code is not offered');
  assert.deepEqual(stale.finish, BAD_CODE);
  const fresh = { ...dev, seed: seedOf(again.json) };
  assert.equal((await tryCode(h, fresh, await codeAt(fresh, h.clock.ms))).finish.status, 200, 'the new seed\'s code is accepted');
});

test('A5 review 3: after the first accepted code, a repeat enrol answers enrolled with no seed', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const [before] = otpRows(h.db);
  assert.equal((await tryCode(h, dev, await codeAt(dev, h.clock.ms))).finish.status, 200);
  const again = await answer(await h.call(await enrolRequest(h.call, dev, await enrolTicket(h, ADDRESS, dev))));
  assert.deepEqual(again, { status: 409, json: { error: 'enrolled' } });
  assert.equal(otpRows(h.db)[0].box, before.box, 'the seed is unchanged');
});

test('A5 review 3: an exchange started on the old seed is refused once a repeat enrol replaced it', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const { message, state } = initiatorStart({ code: await codeAt(dev, h.clock.ms), channel: unlockChannelFor(dev.id) });
  const start = await answer(await h.call(await signed(h.call, dev, '/unlock/start', { sid: b64url(message.sid), Ya: b64url(message.Ya), clock: h.clock.ms })));
  assert.equal(start.status, 200);
  const proved = initiatorFinish(state, start.json.replies.map((r) => ({ Yb: fromB64url(r.Yb), tagB: fromB64url(r.tagB) })));
  assert.ok(proved, 'the old seed\'s code was offered when the exchange started');
  assert.equal((await h.call(await enrolRequest(h.call, dev, await enrolTicket(h, ADDRESS, dev)))).status, 200, 'the repeat enrol');
  const done = await answer(await h.call(await signed(h.call, dev, '/unlock/finish', { exchange: start.json.exchange, tagA: b64url(proved.tagA) })));
  assert.deepEqual(done, BAD_CODE);
  assert.equal(otpRows(h.db)[0].last_step, 0, 'no code was accepted');
});

test('A5 re-review 2: a repeat enrol is the owner device\'s alone, so a pending device leaves the old seed', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const second = await registeredDevice(h, ADDRESS, { fresh: false });
  const [before] = otpRows(h.db);
  assert.deepEqual(await answer(await h.call(await enrolRequest(h.call, second, await enrolTicket(h, ADDRESS, second)))), NO_DEVICE, 'it is pending');
  assert.equal(otpRows(h.db)[0].box, before.box, 'the seed is unchanged');
  assert.equal((await tryCode(h, dev, await codeAt(dev, h.clock.ms))).finish.status, 200, 'the old seed still works');
});

test('A5 re-review: a device registered before the first accepted code is pending from the start, and stays so after it', async () => {
  const h = harness();
  const owner = await enrolledDevice(h, ADDRESS);
  const early = await registeredDevice(h, ADDRESS, { fresh: false });
  assert.equal(pendingOf(h.db, early.id), 1, 'pending before any code is confirmed');
  assert.deepEqual(await answer(await h.call(await signed(h.call, early, '/pair/offer', {}))), NO_DEVICE);
  assert.equal((await tryCode(h, owner, await codeAt(owner, h.clock.ms))).finish.status, 200, 'the first accepted code');
  assert.equal(pendingOf(h.db, owner.id), 0, 'the device that proved it');
  assert.equal(pendingOf(h.db, early.id), 1, 'the other device is still held back');
  assert.deepEqual(await answer(await h.call(await signed(h.call, early, '/device/remove', { device: owner.id }))), NO_DEVICE);
  const late = await registeredDevice(h, ADDRESS, { fresh: false });
  assert.equal(pendingOf(h.db, late.id), 1, 'a device registered after it starts pending');
});

test('A5 review 3: a device registered while the confirming code is in flight is held back', async () => {
  const h = harness();
  const owner = await enrolledDevice(h, ADDRESS);
  const late = await deviceKeys();
  const { message, state } = initiatorStart({ code: await codeAt(owner, h.clock.ms), channel: unlockChannelFor(owner.id) });
  const start = await answer(await h.call(await signed(h.call, owner, '/unlock/start', { sid: b64url(message.sid), Ya: b64url(message.Ya), clock: h.clock.ms })));
  const proved = initiatorFinish(state, start.json.replies.map((r) => ({ Yb: fromB64url(r.Yb), tagB: fromB64url(r.tagB) })));
  const request = await signed(h.call, owner, '/unlock/finish', { exchange: start.json.exchange, tagA: b64url(proved.tagA) });
  landsMidFlight(h, 'UPDATE exchange SET used = 1', (db) => {
    db.sqlite.prepare('INSERT INTO device (id, account_id, sign_key, agree_key, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('late-device', owner.account, late.signKey, late.agreeKey, h.clock.ms);
  });
  assert.equal((await h.call(request)).status, 200);
  assert.equal(pendingOf(h.db, 'late-device'), 1);
});

test('NEGATIVE CONTROL: the enrolling device and devices of an account with no code are not held back', async () => {
  const h = harness();
  const first = await enrolledDevice(h, ADDRESS);
  assert.equal(pendingOf(h.db, first.id), 0);
  assert.equal((await answer(await h.call(await signed(h.call, first, '/pair/offer', {})))).json.error, 'not-built');
  const other = await registeredDevice(h, OTHER);
  assert.equal(pendingOf(h.db, other.id), 0);
});

test('enrolment writes one audit row of route and reason', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const ticket = await enrolTicket(h, ADDRESS, dev);
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
