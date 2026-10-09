// A4, devices (plan §3.3 "First device" step 3 and "Each further device"
// steps 1 and 2; §3.5 "Lost device"). POST /signin takes the address, the
// account password and the digest of the device's keys, and answers a
// single-use ticket; POST /device/register takes that ticket and the two
// public keys it was bound to; POST /device/remove,
// signed by a device of the same account with a fresh code (Kaleb's 8 Oct
// 2026 ruling; test/device-remove.test.mjs), stops a device at once. Until A5
// no account has an authenticator code, so /signin asks for no code; A5
// adds the code, RED first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIGNIN_LIMITS, backoffMs } from '../src/signin.js';
import { LIVE_NONCES_PER_DEVICE, NONCE_TTL_MS } from '../src/checks.js';
import { accountKeys } from '../src/account-keys.js';
import {
  harness, post, passToken, signed, nonceFor, addDevice, auditRows, everyRow,
  signUp, signIn, signInRequest, deviceKeys, registerRequest, registeredDevice, keyDigestOf, ANY_KEY_DIGEST, PASSWORD, ROOT, T0,
  removedMidFlight, FIND_DEVICE, SPEND_NONCE, confirmedDevice, ticketFor, removeRequest,
} from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses and TEST-NET requesters.
const ADDRESS = 'device-owner@example.test';
const OTHER = 'someone-else@example.test';

async function answer(res) {
  return { status: res.status, json: await res.json() };
}

const devices = (db) => db.sqlite.prepare('SELECT * FROM device ORDER BY created_at, rowid').all().map((r) => ({ ...r }));
// The devices a /signin ticket registered: every one but the owner device the
// sign-up ticket registered (A5 re-review).
const added = (db) => devices(db).filter((d) => d.owner === 0);
const liveNonces = (db, id, now) => db.sqlite.prepare('SELECT COUNT(*) AS n FROM nonce WHERE device_id = ? AND used = 0 AND expires_at > ?').get(id, now).n;

// ---- the plan tests ----

test('a request with no registered device signature is refused', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const stranger = await deviceKeys();
  // Unsigned, under the registered id.
  assert.equal((await answer(await h.call(post('/pair/offer', {}, { 'x-hz-device': dev.id })))).json.error, 'stale-nonce');
  // Signed by a key that was never registered, under the registered id.
  const forged = await signed(h.call, { id: dev.id, key: stranger.key }, '/pair/offer', {});
  assert.deepEqual(await answer(await h.call(forged)), { status: 401, json: { error: 'bad-signature' } });
  // An id that was never registered.
  assert.deepEqual(await answer(await h.call(post('/nonce', {}, { 'x-hz-device': 'never-registered' }))), { status: 401, json: { error: 'no-device' } });
  // A sign-in ticket is not a device signature.
  const ticket = await signIn(h, ADDRESS);
  assert.equal((await answer(await h.call(post('/pair/offer', { ticket }, { 'x-hz-device': ticket })))).json.error, 'no-device');
});

test('NEGATIVE CONTROL: a request signed by the registered key passes the device checks', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  for (const der of [false, true]) {
    assert.deepEqual(await answer(await h.call(await signed(h.call, dev, '/pair/offer', {}, { der }))), { status: 501, json: { error: 'not-built' } });
  }
});

test('a removed device is refused at once', async () => {
  const h = harness();
  const keep = await confirmedDevice(h, ADDRESS);
  const lost = { ...(await registeredDevice(h, ADDRESS, { fresh: false })), seed: keep.seed };
  await ticketFor(h, lost); // it proves the code, so only the removal stops it
  const ticket = await ticketFor(h, keep);
  const held = await nonceFor(h.call, lost); // a nonce the lost device already holds
  assert.deepEqual(await answer(await h.call(await signed(h.call, keep, '/device/remove', { device: lost.id, ticket }))), { status: 200, json: { ok: true } });
  assert.deepEqual(await answer(await h.call(await signed(h.call, lost, '/pair/offer', {}, { nonce: held }))), { status: 401, json: { error: 'no-device' } });
  assert.deepEqual(await answer(await h.call(post('/nonce', {}, { 'x-hz-device': lost.id }))), { status: 401, json: { error: 'no-device' } });
  assert.equal(liveNonces(h.db, lost.id, h.clock.ms), 0, 'its live nonces are spent with it');
  // The device that removed it carries on.
  assert.equal((await answer(await h.call(await signed(h.call, keep, '/pair/offer', {})))).json.error, 'not-built');
});

// ---- /signin ----

test('NEGATIVE CONTROL: the right address and password answer a single-use ticket', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const res = await answer(await h.call(signInRequest(ADDRESS)));
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json), ['ticket']);
  assert.match(res.json.ticket, /^[A-Za-z0-9_-]{43}$/);
});

test('a sign-in with a wrong password or an address with no account is refused alike', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const wrong = await answer(await h.call(signInRequest(ADDRESS, `${PASSWORD} not`)));
  const none = await answer(await h.call(signInRequest('no-account@example.test')));
  assert.deepEqual(wrong, { status: 401, json: { error: 'bad-login' } });
  assert.deepEqual(none, wrong);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ticket WHERE owner = 0').get().n, 0, 'no ticket was made');
});

test('a sign-in for an address with no account hashes a password like a wrong password does', async (t) => {
  // Without this, how long the answer takes says whether the address has an account.
  const h = harness();
  await signUp(h, ADDRESS);
  const derive = t.mock.method(crypto.subtle, 'deriveBits');
  await h.call(signInRequest(ADDRESS, `${PASSWORD} not`));
  const forWrong = derive.mock.callCount();
  await h.call(signInRequest('no-account@example.test'));
  assert.ok(forWrong >= 1);
  assert.equal(derive.mock.callCount() - forWrong, forWrong);
});

// Security review M5: one password typed on two keyboards can arrive as two
// code point sequences (é as one point, or e plus a combining accent), and
// the hash must not tell them apart. Fake passwords, built from escapes.
const COMPOSED = 'café crème brûlée CANARY';
const DECOMPOSED = COMPOSED.normalize('NFD');

test('M5: a password set in NFC form signs in from its NFD form, and the other way round', async () => {
  assert.notEqual(COMPOSED, DECOMPOSED, 'the two forms differ before hashing');
  const h = harness();
  await signUp(h, ADDRESS, { password: COMPOSED });
  await signUp(h, OTHER, { password: DECOMPOSED });
  assert.equal((await h.call(signInRequest(ADDRESS, DECOMPOSED))).status, 200);
  assert.equal((await h.call(signInRequest(OTHER, COMPOSED))).status, 200);
});

test('M5: a compatibility form (a ligature) signs in as its plain letters', async () => {
  const h = harness();
  await signUp(h, ADDRESS, { password: 'ofﬁce staple CANARY' });
  assert.equal((await h.call(signInRequest(ADDRESS, 'office staple CANARY'))).status, 200);
});

test('M5 NEGATIVE CONTROL: a password that differs after normalising is still refused', async () => {
  const h = harness();
  await signUp(h, ADDRESS, { password: COMPOSED });
  const res = await answer(await h.call(signInRequest(ADDRESS, COMPOSED.replace('é', 'e'))));
  assert.deepEqual(res, { status: 401, json: { error: 'bad-login' } });
});

test('a sign-in body must be exactly an address, a password and a key digest', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const keyDigest = ANY_KEY_DIGEST;
  for (const body of [{ email: ADDRESS, keyDigest }, { password: PASSWORD, keyDigest }, { email: ADDRESS, password: PASSWORD, keyDigest, extra: 1 },
    { email: 'not-an-address', password: PASSWORD, keyDigest }, { email: ADDRESS, password: 42, keyDigest }]) {
    assert.deepEqual(await answer(await h.call(post('/signin', body))), { status: 400, json: { error: 'shape' } }, JSON.stringify(Object.keys(body)));
  }
});

test('sign-in tries are rate limited per requester, across addresses', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  for (let i = 0; i < SIGNIN_LIMITS.perRequesterHour; i += 1) {
    assert.equal((await h.call(signInRequest(`guess-${i}@example.test`, PASSWORD, '198.51.100.7'))).status, 401);
  }
  assert.deepEqual(await answer(await h.call(signInRequest(ADDRESS, PASSWORD, '198.51.100.7'))), { status: 429, json: { error: 'slow-down' } });
  assert.equal((await h.call(signInRequest(ADDRESS, PASSWORD, '198.51.100.8'))).status, 200, 'NEGATIVE CONTROL: another requester');
});

// ---- H2 (security review): strangers cannot lock the owner out of /signin ----

// Fills ADDRESS's ceiling (perAddressHour, second review, item 4) with
// strangers' wrong passwords spread over the hour, as rows, since one
// requester's pair caps it at perPairHour (third review, item 1). Leaves
// `free` places.
async function strangersFill(h, address, free = 0) {
  const bucket = `signin-address:${await (await accountKeys(h.env)).addressKey(address)}`;
  const add = h.db.sqlite.prepare('INSERT INTO throttle (bucket, at) VALUES (?, ?)');
  for (let i = 0; i < SIGNIN_LIMITS.perAddressHour - free; i += 1) add.run(bucket, h.clock.ms - 1 - i * 1000);
  return bucket;
}

// The clock moves past a pair's backoff after its nth wrong password, so a
// test can count failures up to perPairHour from one requester.
const pastBackoff = (h, failures) => { h.clock.ms += backoffMs(failures); };

const signedSignIn = (h, device, address, ip, options = {}) =>
  signed(h.call, device, '/signin', { email: address, password: PASSWORD, keyDigest: ANY_KEY_DIGEST }, { ...options, headers: { 'cf-connecting-ip': ip } });

const HELD = { status: 429, json: { error: 'slow-down' } };

test('H2: with the address at its ceiling, the owner signs in from a registered device', async () => {
  const h = harness();
  const device = await registeredDevice(h, ADDRESS);
  await strangersFill(h, ADDRESS);
  assert.deepEqual(await answer(await h.call(signInRequest(ADDRESS, PASSWORD, '203.0.113.9'))), HELD,
    'NEGATIVE CONTROL: an unsigned try is still held by the ceiling');
  const res = await answer(await h.call(await signedSignIn(h, device, ADDRESS, '203.0.113.9')));
  assert.equal(res.status, 200);
  assert.match(res.json.ticket, /^[A-Za-z0-9_-]{43}$/);
});

test('H2: a successful sign-in is not counted against the address', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const bucket = await strangersFill(h, ADDRESS, 1);
  for (let i = 0; i < 11; i += 1) {
    assert.equal((await h.call(signInRequest(ADDRESS, PASSWORD, `198.51.100.${i + 1}`))).status, 200, `success ${i + 1}`);
  }
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM throttle WHERE bucket = ?').get(bucket).n, SIGNIN_LIMITS.perAddressHour - 1, 'no success took a place');
  assert.deepEqual(await answer(await h.call(signInRequest(ADDRESS, 'a wrong password', '203.0.113.9'))), { status: 401, json: { error: 'bad-login' } });
});

test('H2: wrong passwords alone count toward the address ceiling, and a success does not clear them', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  await strangersFill(h, ADDRESS, 1);
  assert.equal((await h.call(signInRequest(ADDRESS, PASSWORD, '203.0.113.9'))).status, 200, 'not at the ceiling yet');
  assert.equal((await h.call(signInRequest(ADDRESS, 'one wrong password more', '203.0.113.10'))).status, 401, 'the success took no place');
  assert.deepEqual(await answer(await h.call(signInRequest(ADDRESS, PASSWORD, '203.0.113.11'))), HELD);
});

// ---- second review, item 4: no hard per-address lock on /signin ----

test('item 4: ten strangers\' wrong passwords from ten requesters, then the owner\'s right password from a new device signs in', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await h.call(signInRequest(ADDRESS, `wrong password ${i}!`, `198.51.100.${i + 1}`))).status, 401, `stranger ${i + 1}`);
  }
  const res = await answer(await h.call(signInRequest(ADDRESS, PASSWORD, '203.0.113.9')));
  assert.equal(res.status, 200);
  assert.match(res.json.ticket, /^[A-Za-z0-9_-]{43}$/);
});

test('item 4: a single requester hammering one address is refused', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  for (let i = 0; i < SIGNIN_LIMITS.perPairHour; i += 1) {
    assert.equal((await h.call(signInRequest(ADDRESS, `wrong password ${i}!`, '198.51.100.7'))).status, 401, `failure ${i + 1}`);
    pastBackoff(h, i + 1);
  }
  assert.deepEqual(await answer(await h.call(signInRequest(ADDRESS, PASSWORD, '198.51.100.7'))), HELD, 'even the right password');
  assert.equal((await h.call(signInRequest(ADDRESS, PASSWORD, '203.0.113.9'))).status, 200, 'NEGATIVE CONTROL: another requester');
});

test('item 4 NEGATIVE CONTROL: the owner\'s own successes from one requester take no place in the pair bucket', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  for (let i = 0; i < SIGNIN_LIMITS.perPairHour + 1; i += 1) {
    assert.equal((await h.call(signInRequest(ADDRESS, PASSWORD, '192.0.2.10'))).status, 200, `success ${i + 1}`);
  }
  assert.deepEqual(await answer(await h.call(signInRequest(ADDRESS, 'a wrong password', '192.0.2.10'))), { status: 401, json: { error: 'bad-login' } });
});

test('item 4 (R1): the per-address ceiling is 1000 failures an hour, and only failures fill it', async () => {
  assert.equal(SIGNIN_LIMITS.perAddressHour, 1000, 'R1: load only; the requester and pair caps bound guessing');
  const h = harness();
  await signUp(h, ADDRESS);
  const bucket = `signin-address:${await (await accountKeys(h.env)).addressKey(ADDRESS)}`;
  // Failures spread over the hour, from other requesters.
  const add = h.db.sqlite.prepare('INSERT INTO throttle (bucket, at) VALUES (?, ?)');
  for (let i = 0; i < SIGNIN_LIMITS.perAddressHour; i += 1) add.run(bucket, h.clock.ms - SIGNIN_LIMITS.backoffMaxMs - 1 - i * 1000);
  assert.deepEqual(await answer(await h.call(signInRequest(ADDRESS, PASSWORD, '203.0.113.9'))), HELD, 'at the ceiling');
  h.db.sqlite.prepare('DELETE FROM throttle WHERE rowid = (SELECT MIN(rowid) FROM throttle WHERE bucket = ?)').run(bucket);
  assert.equal((await h.call(signInRequest(ADDRESS, PASSWORD, '203.0.113.9'))).status, 200, 'one under the ceiling');
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM throttle WHERE bucket = ?').get(bucket).n, SIGNIN_LIMITS.perAddressHour - 1, 'the success took no place');
});

// ---- second review, item 7: a known device still pays the pair bucket ----

const signedGuess = (h, device, address, ip, password) =>
  signed(h.call, device, '/signin', { email: address, password, keyDigest: ANY_KEY_DIGEST }, { headers: { 'cf-connecting-ip': ip } });

test('item 7: a registered device guessing passwords from one requester is held by the pair bucket', async () => {
  const h = harness();
  const device = await registeredDevice(h, ADDRESS);
  assert.ok(SIGNIN_LIMITS.perPairHour < SIGNIN_LIMITS.perRequesterHour, 'the pair cap is reached before the requester cap');
  for (let i = 0; i < SIGNIN_LIMITS.perPairHour; i += 1) {
    assert.deepEqual(await answer(await h.call(await signedGuess(h, device, ADDRESS, '198.51.100.7', `wrong password ${i}!`))),
      { status: 401, json: { error: 'bad-login' } }, `failure ${i + 1}`);
    pastBackoff(h, i + 1);
  }
  assert.deepEqual(await answer(await h.call(await signedSignIn(h, device, ADDRESS, '198.51.100.7'))), HELD, 'even the right password');
  assert.equal((await h.call(await signedSignIn(h, device, ADDRESS, '203.0.113.9'))).status, 200, 'NEGATIVE CONTROL: another requester');
});

test('item 7: a known device\'s wrong passwords share the pair bucket with unsigned tries from the same requester', async () => {
  const h = harness();
  const device = await registeredDevice(h, ADDRESS);
  for (let i = 0; i < SIGNIN_LIMITS.perPairHour - 1; i += 1) {
    assert.equal((await h.call(signInRequest(ADDRESS, `wrong password ${i}!`, '198.51.100.7'))).status, 401, `unsigned failure ${i + 1}`);
    pastBackoff(h, i + 1);
  }
  assert.equal((await h.call(await signedGuess(h, device, ADDRESS, '198.51.100.7', 'one signed wrong password'))).status, 401);
  pastBackoff(h, SIGNIN_LIMITS.perPairHour);
  assert.deepEqual(await answer(await h.call(await signedSignIn(h, device, ADDRESS, '198.51.100.7'))), HELD);
});

test('item 7 NEGATIVE CONTROL: a known device\'s own successes take no place in the pair bucket and still skip the address bucket', async () => {
  const h = harness();
  const device = await registeredDevice(h, ADDRESS);
  for (let i = 0; i < SIGNIN_LIMITS.perPairHour + 1; i += 1) {
    assert.equal((await h.call(await signedSignIn(h, device, ADDRESS, '192.0.2.10'))).status, 200, `success ${i + 1}`);
  }
  assert.equal((await h.call(await signedGuess(h, device, ADDRESS, '192.0.2.10', 'a wrong password'))).status, 401, 'the pair bucket is not full');
  const addressKey = await (await accountKeys(h.env)).addressKey(ADDRESS);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM throttle WHERE bucket = ?').get(`signin-address:${addressKey}`).n, 0,
    'a known device takes no place in the address bucket');
});

// ---- third review, item 1: no address-wide quiet period on /signin ----

test('third review, item 1: six strangers polling every second never hold the owner\'s right password from a fresh connecting address', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const strangers = [1, 2, 3, 4, 5, 6].map((i) => `198.51.100.${20 + i}`);
  // The strangers push the address past 10 wrong passwords, a second apart.
  for (let i = 0; i < 11; i += 1) {
    assert.equal((await h.call(signInRequest(ADDRESS, `wrong password ${i}!`, strangers[i % strangers.length]))).status, 401, `failure ${i + 1}`);
    h.clock.ms += 1000;
  }
  // Then each polls every second, so a stranger's try lands first in the
  // second any quiet time ends, and the owner tries every 30 s for 4 hours.
  const SECONDS = 4 * 60 * 60;
  let tries = 0;
  let res = null;
  for (let s = 1; s <= SECONDS && !res; s += 1) {
    h.clock.ms += 1000;
    for (const ip of strangers) await h.call(signInRequest(ADDRESS, `wrong password at ${s}`, ip));
    if (s % 30 !== 0) continue;
    tries += 1;
    const owner = await answer(await h.call(signInRequest(ADDRESS, PASSWORD, '203.0.113.50')));
    if (owner.status === 200) res = owner;
  }
  assert.ok(res, `the owner signed in within 4 hours (tried ${tries} times)`);
  assert.match(res.json.ticket, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(tries, 1, 'the owner signed in on the first try');
});

test('third review, item 1: one requester hammering one address backs off on its own pair, then is capped at perPairHour', async () => {
  assert.ok(SIGNIN_LIMITS.backoffAfter < SIGNIN_LIMITS.perPairHour, 'the pair backs off before its cap');
  assert.ok(SIGNIN_LIMITS.backoffMaxMs <= 15 * 60 * 1000, 'backoff never exceeds 15 minutes');
  const h = harness();
  await signUp(h, ADDRESS);
  const IP = '198.51.100.7';
  const start = h.clock.ms;
  const wrong = async (label) => (await h.call(signInRequest(ADDRESS, `wrong password ${label}`, IP))).status;
  let failures = 0;
  while (failures < SIGNIN_LIMITS.backoffAfter + 1) {
    assert.equal(await wrong(failures), 401, `failure ${failures + 1}`);
    failures += 1;
  }
  while (failures < SIGNIN_LIMITS.perPairHour) {
    const delay = Math.min(SIGNIN_LIMITS.backoffBaseMs * 2 ** (failures - SIGNIN_LIMITS.backoffAfter - 1), SIGNIN_LIMITS.backoffMaxMs);
    assert.deepEqual(await answer(await h.call(signInRequest(ADDRESS, PASSWORD, IP))), HELD, `after ${failures}: the right password is held`);
    assert.deepEqual(await answer(await h.call(signInRequest(ADDRESS, 'a wrong password', IP))), HELD, `after ${failures}: a wrong one gets the same answer`);
    assert.equal((await h.call(signInRequest(ADDRESS, PASSWORD, '203.0.113.9'))).status, 200, `after ${failures}: NEGATIVE CONTROL: another requester`);
    h.clock.ms += delay - 1;
    assert.deepEqual(await answer(await h.call(signInRequest(ADDRESS, PASSWORD, IP))), HELD, `after ${failures}: still held 1 ms before ${delay} ms`);
    h.clock.ms += 1;
    assert.equal(await wrong(`after ${delay}`), 401, `after ${failures}: tried again after ${delay} ms`);
    failures += 1;
  }
  h.clock.ms += SIGNIN_LIMITS.backoffMaxMs;
  assert.deepEqual(await answer(await h.call(signInRequest(ADDRESS, PASSWORD, IP))), HELD, 'capped at perPairHour past any backoff');
  h.clock.ms = start + SIGNIN_LIMITS.windowMs + 1;
  assert.equal((await h.call(signInRequest(ADDRESS, PASSWORD, IP))).status, 200, 'its first failure has left the hour');
});

test('H2 NEGATIVE CONTROL: a device of another account does not lift the address bucket', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const stranger = await registeredDevice(h, OTHER);
  await strangersFill(h, ADDRESS);
  // Turnstile (design of 8 Oct 2026): a device of another account pays the
  // challenge like an unsigned try, so with no token it never reaches a bucket.
  assert.deepEqual(await answer(await h.call(await signedSignIn(h, stranger, ADDRESS, '203.0.113.9'))), { status: 400, json: { error: 'shape' } });
  const withToken = await signed(h.call, stranger, '/signin', { email: ADDRESS, password: PASSWORD, keyDigest: ANY_KEY_DIGEST, turnstile: passToken('signin') }, { headers: { 'cf-connecting-ip': '203.0.113.9' } });
  assert.deepEqual(await answer(await h.call(withToken)), { status: 429, json: { error: 'slow-down' } });
});

test('H2 NEGATIVE CONTROL: a signed sign-in still pays the per-requester bucket', async () => {
  const h = harness();
  const device = await registeredDevice(h, ADDRESS);
  for (let i = 0; i < SIGNIN_LIMITS.perRequesterHour; i += 1) {
    await h.call(signInRequest(`guess-${i}@example.test`, PASSWORD, '198.51.100.7'));
  }
  assert.deepEqual(await answer(await h.call(await signedSignIn(h, device, ADDRESS, '198.51.100.7'))), { status: 429, json: { error: 'slow-down' } });
  assert.equal((await h.call(await signedSignIn(h, device, ADDRESS, '198.51.100.8'))).status, 200, 'NEGATIVE CONTROL: another requester');
});

test('H2: a sign-in that names a device must carry its good signature, never falling back to unsigned', async () => {
  const h = harness();
  const device = await registeredDevice(h, ADDRESS);
  const tampered = await signedSignIn(h, device, ADDRESS, '203.0.113.9', { tamper: { path: '/device/remove' } });
  assert.deepEqual(await answer(await h.call(tampered)), { status: 401, json: { error: 'bad-signature' } });
  const unknown = post('/signin', { email: ADDRESS, password: PASSWORD, keyDigest: ANY_KEY_DIGEST }, { 'cf-connecting-ip': '203.0.113.9', 'x-hz-device': 'no-such-device' });
  assert.deepEqual(await answer(await h.call(unknown)), { status: 401, json: { error: 'no-device' } });
  h.db.sqlite.prepare('UPDATE device SET removed_at = ? WHERE id = ?').run(T0, device.id);
  assert.deepEqual(await answer(await h.call(await signedSignIn(h, { ...device }, ADDRESS, '203.0.113.9', { nonce: 'x'.repeat(43) }))),
    { status: 401, json: { error: 'no-device' } }, 'a removed device is refused');
});

test('a ticket is stored only as a keyed digest, bound to its account and its device keys', async () => {
  const h = harness();
  const account = await signUp(h, ADDRESS);
  const keys = await deviceKeys();
  const ticket = await signIn(h, ADDRESS, { keys });
  const rows = h.db.sqlite.prepare('SELECT * FROM ticket WHERE owner = 0').all().map((r) => ({ ...r }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account_id, account);
  assert.equal(rows[0].key_digest, await keyDigestOf(keys));
  assert.match(rows[0].digest, /^[0-9a-f]{64}$/);
  assert.equal(everyRow(h.db).includes(ticket), false, 'the ticket is in no table');
  assert.equal(JSON.stringify(h.db.bound.map((b) => b.values)).includes(ticket), false, 'the ticket is in no bound value');
});

// ---- /device/register (A2 open point 1) ----

test('/device/register requires the ticket from /signin', async () => {
  const h = harness();
  const account = await signUp(h, ADDRESS);
  const keys = await deviceKeys();
  assert.deepEqual(await answer(await h.call(post('/device/register', { signKey: keys.signKey, agreeKey: keys.agreeKey }))), { status: 400, json: { error: 'shape' } });
  const madeUp = 'A'.repeat(43);
  assert.deepEqual(await answer(await h.call(registerRequest(madeUp, keys))), { status: 401, json: { error: 'bad-ticket' } });
  assert.deepEqual(added(h.db), [], 'no device without the ticket');
  const ticket = await signIn(h, ADDRESS, { keys });
  const res = await answer(await h.call(registerRequest(ticket, keys)));
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json), ['device']);
  assert.match(res.json.device, /^[A-Za-z0-9_-]{22,64}$/);
  const [row] = added(h.db);
  assert.equal(row.id, res.json.device);
  assert.equal(row.account_id, account, 'the device joins the account the ticket was issued for');
  assert.equal(row.sign_key, keys.signKey);
  assert.equal(row.agree_key, keys.agreeKey);
  assert.equal(row.removed_at, null);
});

test('a ticket registers one device only', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const keys = await deviceKeys();
  const ticket = await signIn(h, ADDRESS, { keys });
  assert.equal((await h.call(registerRequest(ticket, keys))).status, 200);
  assert.deepEqual(await answer(await h.call(registerRequest(ticket, keys))), { status: 401, json: { error: 'bad-ticket' } });
  assert.equal(added(h.db).length, 1);
});

test('a ticket expires', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const keys = await deviceKeys();
  const ticket = await signIn(h, ADDRESS, { keys });
  h.clock.ms += SIGNIN_LIMITS.ticketTtlMs;
  assert.deepEqual(await answer(await h.call(registerRequest(ticket, keys))), { status: 401, json: { error: 'bad-ticket' } });
  assert.deepEqual(added(h.db), []);
});

test('NEGATIVE CONTROL: a ticket used just inside its life registers the device', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const keys = await deviceKeys();
  const ticket = await signIn(h, ADDRESS, { keys });
  h.clock.ms += SIGNIN_LIMITS.ticketTtlMs - 1;
  assert.equal((await h.call(registerRequest(ticket, keys))).status, 200);
});

test('a key that is not a P-256 public point is refused as shape, and the ticket is not spent', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const good = await deviceKeys();
  const ticket = await signIn(h, ADDRESS, { keys: good });
  const offCurve = `BA${'A'.repeat(85)}`; // 65 bytes, 0x04 prefix, not on the curve
  for (const [signKey, agreeKey] of [[offCurve, good.agreeKey], [good.signKey, offCurve], ['not base64url!', good.agreeKey],
    [good.signKey.slice(0, 40), good.agreeKey], [42, good.agreeKey], [good.signKey, null]]) {
    assert.deepEqual(await answer(await h.call(post('/device/register', { ticket, signKey, agreeKey }))), { status: 400, json: { error: 'shape' } });
  }
  assert.equal((await h.call(registerRequest(ticket, good))).status, 200, 'the ticket still works');
});

test('a register body must be exactly a ticket and two keys', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const keys = await deviceKeys();
  const ticket = await signIn(h, ADDRESS, { keys });
  for (const body of [{ ticket, signKey: keys.signKey }, { ticket, signKey: keys.signKey, agreeKey: keys.agreeKey, account: 'acct-1' },
    { ticket: 7, signKey: keys.signKey, agreeKey: keys.agreeKey }]) {
    assert.deepEqual(await answer(await h.call(post('/device/register', body))), { status: 400, json: { error: 'shape' } });
  }
  assert.equal((await h.call(registerRequest(ticket, keys))).status, 200, 'the ticket still works');
});

// ---- M3 (security review): a ticket registers only the keys it was signed in for ----

test('M3: a ticket refuses keys other than the ones it was signed in for, and is not spent by them', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const mine = await deviceKeys();
  const theirs = await deviceKeys();
  const ticket = await signIn(h, ADDRESS, { keys: mine });
  for (const keys of [theirs, { signKey: theirs.signKey, agreeKey: mine.agreeKey }, { signKey: mine.signKey, agreeKey: theirs.agreeKey }]) {
    assert.deepEqual(await answer(await h.call(registerRequest(ticket, keys))), { status: 401, json: { error: 'bad-ticket' } });
  }
  assert.deepEqual(added(h.db), [], 'no device for keys the ticket was not signed in for');
  const res = await answer(await h.call(registerRequest(ticket, mine)));
  assert.equal(res.status, 200, 'NEGATIVE CONTROL: the keys it was signed in for still register');
  assert.equal(added(h.db)[0].sign_key, mine.signKey);
});

test('M3: a sign-in without a well-formed key digest is refused as shape, before any write', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const before = h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM throttle').get().n;
  for (const keyDigest of [undefined, '', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}+`, 42, null]) {
    const body = keyDigest === undefined ? { email: ADDRESS, password: PASSWORD } : { email: ADDRESS, password: PASSWORD, keyDigest };
    assert.deepEqual(await answer(await h.call(post('/signin', body, { 'cf-connecting-ip': '203.0.113.9' }))), { status: 400, json: { error: 'shape' } },
      JSON.stringify(keyDigest));
  }
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ticket WHERE owner = 0').get().n, 0, 'no ticket was made');
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM throttle').get().n, before, 'a refused body is not counted');
});

// ---- /device/remove ----

test('a device can remove itself, and is refused at once', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  assert.deepEqual(await answer(await h.call(await removeRequest(h, dev, dev.id))), { status: 200, json: { ok: true } });
  assert.equal((await answer(await h.call(post('/nonce', {}, { 'x-hz-device': dev.id })))).json.error, 'no-device');
});

test('a device cannot remove a device of another account, and the answer does not say so', async () => {
  const h = harness();
  const mine = await confirmedDevice(h, ADDRESS);
  const theirs = await registeredDevice(h, OTHER);
  assert.deepEqual(await answer(await h.call(await removeRequest(h, mine, theirs.id))), { status: 200, json: { ok: true } });
  assert.deepEqual(await answer(await h.call(await removeRequest(h, mine, 'never-registered'))), { status: 200, json: { ok: true } });
  assert.equal((await answer(await h.call(await signed(h.call, theirs, '/pair/offer', {})))).json.error, 'not-built', 'theirs still works');
  assert.equal(devices(h.db).find((d) => d.id === theirs.id).removed_at, null);
});

test('a remove body holds only a device id and a ticket, each of its shape', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const ticket = 'a.b';
  for (const body of [{}, { ticket }, { device: 7, ticket }, { device: dev.id, ticket, also: dev.id }, { device: 'has a space', ticket },
    { device: dev.id, ticket: 7 }, { device: dev.id, ticket: '' }, { device: dev.id, ticket: null }, { device: dev.id, ticket: 'x'.repeat(1025) }]) {
    assert.deepEqual(await answer(await h.call(await signed(h.call, dev, '/device/remove', body))), { status: 400, json: { error: 'shape' } });
  }
  assert.equal(devices(h.db)[0].removed_at, null);
});

test('a removed device keeps its row, marked with when it was removed', async () => {
  const h = harness();
  const keep = await confirmedDevice(h, ADDRESS);
  const lost = await registeredDevice(h, ADDRESS, { fresh: false });
  h.clock.ms += 1000;
  await h.call(await removeRequest(h, keep, lost.id));
  const at = h.clock.ms;
  assert.equal(devices(h.db).find((d) => d.id === lost.id).removed_at, at);
  // Removing it again changes nothing.
  h.clock.ms += 1000;
  await h.call(await removeRequest(h, keep, lost.id));
  assert.equal(devices(h.db).find((d) => d.id === lost.id).removed_at, at);
});

// ---- L2 (security review): a removal landing mid-flight wins ----
// removedMidFlight, FIND_DEVICE and SPEND_NONCE are in helpers.mjs, shared
// with the A5 tests.

test('L2: a device removed after its checks passed cannot remove another device', async () => {
  const h = harness();
  const caller = await confirmedDevice(h, ADDRESS);
  const target = await registeredDevice(h, ADDRESS, { fresh: false });
  const request = await removeRequest(h, caller, target.id);
  removedMidFlight(h, caller.id, SPEND_NONCE);
  await h.call(request);
  assert.notEqual(devices(h.db).find((d) => d.id === caller.id).removed_at, null, 'the removal landed');
  assert.equal(devices(h.db).find((d) => d.id === target.id).removed_at, null, 'the target is untouched');
  // The target is pending (A5 re-review), so a nonce is what it can still get.
  await nonceFor(h.call, target);
  assert.equal(liveNonces(h.db, target.id, h.clock.ms), 1, 'NEGATIVE CONTROL: the target still works');
});

test('L2 NEGATIVE CONTROL: a live device removes another, and itself', async () => {
  const h = harness();
  const caller = await confirmedDevice(h, ADDRESS);
  const target = await registeredDevice(h, ADDRESS, { fresh: false });
  const request = await removeRequest(h, caller, target.id);
  removedMidFlight(h, 'never-registered', SPEND_NONCE);
  await h.call(request);
  assert.notEqual(devices(h.db).find((d) => d.id === target.id).removed_at, null);
  await h.call(await removeRequest(h, caller, caller.id));
  assert.notEqual(devices(h.db).find((d) => d.id === caller.id).removed_at, null);
});

test('L2: a device removed after its id was checked gets no nonce', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  removedMidFlight(h, dev.id, FIND_DEVICE);
  assert.deepEqual(await answer(await h.call(post('/nonce', {}, { 'x-hz-device': dev.id }))), { status: 401, json: { error: 'no-device' } });
  assert.equal(liveNonces(h.db, dev.id, h.clock.ms), 0, 'no nonce was made');
});

test('L2: a nonce of a device stamped removed after its id was checked is not spent', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const request = await signed(h.call, dev, '/pair/offer', {});
  removedMidFlight(h, dev.id, FIND_DEVICE, { nonces: false });
  assert.equal((await answer(await h.call(request))).status, 401);
  assert.equal(liveNonces(h.db, dev.id, h.clock.ms), 1, 'the nonce stayed unspent');
});

test('L2: a device removed after its signed sign-in passed the checks gets no ticket', async () => {
  const h = harness();
  const device = await registeredDevice(h, ADDRESS);
  const tickets = () => h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ticket').get().n;
  const before = tickets();
  const request = await signedSignIn(h, device, ADDRESS, '203.0.113.9');
  removedMidFlight(h, device.id, SPEND_NONCE);
  assert.deepEqual(await answer(await h.call(request)), { status: 401, json: { error: 'no-device' } });
  assert.equal(tickets(), before, 'no ticket was stored');
  h.env.DB = h.db;
  assert.equal((await h.call(signInRequest(ADDRESS, PASSWORD, '203.0.113.9'))).status, 200, 'NEGATIVE CONTROL: the owner still signs in unsigned');
});

// ---- the nonce cap (A2 open point 2) ----

test('a device holds at most five live nonces', async () => {
  assert.equal(LIVE_NONCES_PER_DEVICE, 5);
  const h = harness();
  const dev = await addDevice(h.db);
  const other = await addDevice(h.db, { id: 'dev-2' });
  for (let i = 0; i < LIVE_NONCES_PER_DEVICE; i += 1) assert.equal((await h.call(post('/nonce', {}, { 'x-hz-device': dev.id }))).status, 200);
  assert.deepEqual(await answer(await h.call(post('/nonce', {}, { 'x-hz-device': dev.id }))), { status: 429, json: { error: 'slow-down' } });
  assert.equal(liveNonces(h.db, dev.id, h.clock.ms), LIVE_NONCES_PER_DEVICE, 'a refused request makes no nonce');
  assert.equal((await h.call(post('/nonce', {}, { 'x-hz-device': other.id }))).status, 200, 'NEGATIVE CONTROL: the cap is per device');
});

test('a spent or expired nonce frees its place under the cap', async () => {
  const h = harness();
  const dev = await addDevice(h.db);
  const held = [];
  for (let i = 0; i < LIVE_NONCES_PER_DEVICE; i += 1) held.push(await nonceFor(h.call, dev));
  await h.call(await signed(h.call, dev, '/pair/offer', {}, { nonce: held[0] }));
  assert.equal((await h.call(post('/nonce', {}, { 'x-hz-device': dev.id }))).status, 200, 'a spent nonce frees a place');
  assert.equal((await h.call(post('/nonce', {}, { 'x-hz-device': dev.id }))).status, 429);
  h.clock.ms += NONCE_TTL_MS;
  assert.equal((await h.call(post('/nonce', {}, { 'x-hz-device': dev.id }))).status, 200, 'expired nonces free their places');
});

test('the cap holds when nonce requests arrive together', async () => {
  const h = harness();
  const dev = await addDevice(h.db);
  const answers = await Promise.all(Array.from({ length: 3 * LIVE_NONCES_PER_DEVICE }, () => h.call(post('/nonce', {}, { 'x-hz-device': dev.id }))));
  assert.equal(answers.filter((r) => r.status === 200).length, LIVE_NONCES_PER_DEVICE);
  assert.equal(liveNonces(h.db, dev.id, h.clock.ms), LIVE_NONCES_PER_DEVICE);
});

// ---- the signed-bytes move (A2 open point 4) ----

test('the service builds signed bytes with the engine function, and accepts the shared vector', async () => {
  const source = readFileSync(`${ROOT}/src/checks.js`, 'utf8');
  assert.match(source, /from "\.\.\/\.\.\/\.\.\/packages\/account-engine\/src\/signed-bytes\.mjs"/);
  assert.doesNotMatch(source, /function signedBytes/);
  const vector = JSON.parse(readFileSync(`${ROOT}/../../packages/account-engine/test/fixtures/signed-bytes-vector.json`, 'utf8'));
  for (const sig of [vector.sigRaw, vector.sigDer]) {
    const h = harness();
    h.db.sqlite.prepare('INSERT INTO device (id, account_id, sign_key, created_at, pending) VALUES (?, ?, ?, ?, 0)').run('vector-device', 'acct-v', vector.signKey, h.clock.ms);
    h.db.sqlite.prepare('INSERT INTO nonce (value, device_id, expires_at, used) VALUES (?, ?, ?, 0)').run(vector.nonce, 'vector-device', h.clock.ms + 1000);
    const res = await h.call(post(vector.path, vector.body, { 'x-hz-device': 'vector-device', 'x-hz-nonce': vector.nonce, 'x-hz-sig': sig }));
    // The vector signs /reverify with a body that route refuses as shape, an
    // answer only its handler gives once the nonce is spent and the signature
    // checked, so reaching it means the vector signature passed the checks.
    assert.equal((await res.json()).error, 'shape', 'the vector signature passed the checks');
    assert.equal(h.db.sqlite.prepare('SELECT used FROM nonce WHERE value = ?').get(vector.nonce).used, 1);
  }
});

// ---- audit ----

test('sign-in, register and remove each write one audit row of route and reason', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  const ticket = await ticketFor(h, owner);
  const before = auditRows(h.db).length;
  await h.call(signInRequest(ADDRESS, 'a wrong password here'));
  const keys = await deviceKeys();
  const signInTicket = await signIn(h, ADDRESS, { keys });
  await h.call(registerRequest('A'.repeat(43), await deviceKeys()));
  const { device } = await (await h.call(registerRequest(signInTicket, keys))).json();
  await h.call(await signed(h.call, owner, '/device/remove', { device, ticket }));
  assert.deepEqual(auditRows(h.db).slice(before), [
    { route: '/signin', reason: 'bad-login' },
    { route: '/signin', reason: 'ok' },
    { route: '/device/register', reason: 'bad-ticket' },
    { route: '/device/register', reason: 'ok' },
    { route: '/nonce', reason: 'ok' },
    { route: '/device/remove', reason: 'ok' },
  ]);
});
