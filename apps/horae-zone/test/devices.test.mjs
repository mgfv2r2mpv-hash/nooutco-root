// A4, devices (plan §3.3 "First device" step 3 and "Each further device"
// steps 1 and 2; §3.5 "Lost device"). POST /signin takes the address and the
// account password and answers a single-use ticket; POST /device/register
// takes that ticket and the device's two public keys; POST /device/remove,
// signed by a device of the same account, stops a device at once. Until A5
// no account has an authenticator code, so /signin asks only for the
// address and password; A5 adds the code, RED first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SIGNIN_LIMITS } from '../src/signin.js';
import { LIVE_NONCES_PER_DEVICE, NONCE_TTL_MS } from '../src/checks.js';
import {
  harness, post, signed, nonceFor, addDevice, auditRows, everyRow,
  signUp, signIn, signInRequest, deviceKeys, registerRequest, registeredDevice, PASSWORD, ROOT,
} from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses and TEST-NET requesters.
const ADDRESS = 'device-owner@example.test';
const OTHER = 'someone-else@example.test';

async function answer(res) {
  return { status: res.status, json: await res.json() };
}

const devices = (db) => db.sqlite.prepare('SELECT * FROM device ORDER BY created_at, rowid').all().map((r) => ({ ...r }));
const liveNonces = (db, id, now) => db.sqlite.prepare('SELECT COUNT(*) AS n FROM nonce WHERE device_id = ? AND used = 0 AND expires_at > ?').get(id, now).n;

// ---- the plan tests ----

test('a request with no registered device signature is refused', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const stranger = await deviceKeys();
  // Unsigned, under the registered id.
  assert.equal((await answer(await h.call(post('/reverify', {}, { 'x-hz-device': dev.id })))).json.error, 'stale-nonce');
  // Signed by a key that was never registered, under the registered id.
  const forged = await signed(h.call, { id: dev.id, key: stranger.key }, '/reverify', {});
  assert.deepEqual(await answer(await h.call(forged)), { status: 401, json: { error: 'bad-signature' } });
  // An id that was never registered.
  assert.deepEqual(await answer(await h.call(post('/nonce', {}, { 'x-hz-device': 'never-registered' }))), { status: 401, json: { error: 'no-device' } });
  // A sign-in ticket is not a device signature.
  const ticket = await signIn(h, ADDRESS);
  assert.equal((await answer(await h.call(post('/reverify', { ticket }, { 'x-hz-device': ticket })))).json.error, 'no-device');
});

test('NEGATIVE CONTROL: a request signed by the registered key passes the device checks', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  for (const der of [false, true]) {
    assert.deepEqual(await answer(await h.call(await signed(h.call, dev, '/reverify', {}, { der }))), { status: 501, json: { error: 'not-built' } });
  }
});

test('a removed device is refused at once', async () => {
  const h = harness();
  const keep = await registeredDevice(h, ADDRESS);
  const lost = await registeredDevice(h, ADDRESS, { fresh: false });
  const held = await nonceFor(h.call, lost); // a nonce the lost device already holds
  assert.deepEqual(await answer(await h.call(await signed(h.call, keep, '/device/remove', { device: lost.id }))), { status: 200, json: { ok: true } });
  assert.deepEqual(await answer(await h.call(await signed(h.call, lost, '/reverify', {}, { nonce: held }))), { status: 401, json: { error: 'no-device' } });
  assert.deepEqual(await answer(await h.call(post('/nonce', {}, { 'x-hz-device': lost.id }))), { status: 401, json: { error: 'no-device' } });
  assert.equal(liveNonces(h.db, lost.id, h.clock.ms), 0, 'its live nonces are spent with it');
  // The device that removed it carries on.
  assert.equal((await answer(await h.call(await signed(h.call, keep, '/reverify', {})))).json.error, 'not-built');
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
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ticket').get().n, 0, 'no ticket was made');
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

test('a sign-in body must be exactly an address and a password', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  for (const body of [{ email: ADDRESS }, { password: PASSWORD }, { email: ADDRESS, password: PASSWORD, extra: 1 },
    { email: 'not-an-address', password: PASSWORD }, { email: ADDRESS, password: 42 }]) {
    assert.deepEqual(await answer(await h.call(post('/signin', body))), { status: 400, json: { error: 'shape' } }, JSON.stringify(Object.keys(body)));
  }
});

test('sign-in tries are rate limited per address, from any requester', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  for (let i = 0; i < SIGNIN_LIMITS.perAddressHour; i += 1) {
    assert.equal((await h.call(signInRequest(ADDRESS, `wrong password ${i}!`, `198.51.100.${i + 1}`))).status, 401);
  }
  assert.deepEqual(await answer(await h.call(signInRequest(ADDRESS, PASSWORD, '203.0.113.9'))), { status: 429, json: { error: 'slow-down' } });
  h.clock.ms += SIGNIN_LIMITS.windowMs + 1;
  assert.equal((await h.call(signInRequest(ADDRESS, PASSWORD, '203.0.113.9'))).status, 200, 'NEGATIVE CONTROL: the window passes');
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

test('a ticket is stored only as a keyed digest, bound to its account', async () => {
  const h = harness();
  const account = await signUp(h, ADDRESS);
  const ticket = await signIn(h, ADDRESS);
  const rows = h.db.sqlite.prepare('SELECT * FROM ticket').all().map((r) => ({ ...r }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].account_id, account);
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
  assert.deepEqual(devices(h.db), [], 'no device without the ticket');
  const ticket = await signIn(h, ADDRESS);
  const res = await answer(await h.call(registerRequest(ticket, keys)));
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.json), ['device']);
  assert.match(res.json.device, /^[A-Za-z0-9_-]{22,64}$/);
  const [row] = devices(h.db);
  assert.equal(row.id, res.json.device);
  assert.equal(row.account_id, account, 'the device joins the account the ticket was issued for');
  assert.equal(row.sign_key, keys.signKey);
  assert.equal(row.agree_key, keys.agreeKey);
  assert.equal(row.removed_at, null);
});

test('a ticket registers one device only', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const ticket = await signIn(h, ADDRESS);
  assert.equal((await h.call(registerRequest(ticket, await deviceKeys()))).status, 200);
  assert.deepEqual(await answer(await h.call(registerRequest(ticket, await deviceKeys()))), { status: 401, json: { error: 'bad-ticket' } });
  assert.equal(devices(h.db).length, 1);
});

test('a ticket expires', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const ticket = await signIn(h, ADDRESS);
  h.clock.ms += SIGNIN_LIMITS.ticketTtlMs;
  assert.deepEqual(await answer(await h.call(registerRequest(ticket, await deviceKeys()))), { status: 401, json: { error: 'bad-ticket' } });
  assert.deepEqual(devices(h.db), []);
});

test('NEGATIVE CONTROL: a ticket used just inside its life registers the device', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const ticket = await signIn(h, ADDRESS);
  h.clock.ms += SIGNIN_LIMITS.ticketTtlMs - 1;
  assert.equal((await h.call(registerRequest(ticket, await deviceKeys()))).status, 200);
});

test('a key that is not a P-256 public point is refused as shape, and the ticket is not spent', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const ticket = await signIn(h, ADDRESS);
  const good = await deviceKeys();
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
  const ticket = await signIn(h, ADDRESS);
  const keys = await deviceKeys();
  for (const body of [{ ticket, signKey: keys.signKey }, { ticket, signKey: keys.signKey, agreeKey: keys.agreeKey, account: 'acct-1' },
    { ticket: 7, signKey: keys.signKey, agreeKey: keys.agreeKey }]) {
    assert.deepEqual(await answer(await h.call(post('/device/register', body))), { status: 400, json: { error: 'shape' } });
  }
  assert.equal((await h.call(registerRequest(ticket, keys))).status, 200, 'the ticket still works');
});

// ---- /device/remove ----

test('a device can remove itself, and is refused at once', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  assert.deepEqual(await answer(await h.call(await signed(h.call, dev, '/device/remove', { device: dev.id }))), { status: 200, json: { ok: true } });
  assert.equal((await answer(await h.call(post('/nonce', {}, { 'x-hz-device': dev.id })))).json.error, 'no-device');
});

test('a device cannot remove a device of another account, and the answer does not say so', async () => {
  const h = harness();
  const mine = await registeredDevice(h, ADDRESS);
  const theirs = await registeredDevice(h, OTHER);
  assert.deepEqual(await answer(await h.call(await signed(h.call, mine, '/device/remove', { device: theirs.id }))), { status: 200, json: { ok: true } });
  assert.deepEqual(await answer(await h.call(await signed(h.call, mine, '/device/remove', { device: 'never-registered' }))), { status: 200, json: { ok: true } });
  assert.equal((await answer(await h.call(await signed(h.call, theirs, '/reverify', {})))).json.error, 'not-built', 'theirs still works');
  assert.equal(devices(h.db).find((d) => d.id === theirs.id).removed_at, null);
});

test('a remove body must be exactly one device id', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  for (const body of [{}, { device: 7 }, { device: dev.id, also: dev.id }, { device: 'has a space' }]) {
    assert.deepEqual(await answer(await h.call(await signed(h.call, dev, '/device/remove', body))), { status: 400, json: { error: 'shape' } });
  }
  assert.equal(devices(h.db)[0].removed_at, null);
});

test('a removed device keeps its row, marked with when it was removed', async () => {
  const h = harness();
  const keep = await registeredDevice(h, ADDRESS);
  const lost = await registeredDevice(h, ADDRESS, { fresh: false });
  h.clock.ms += 1000;
  await h.call(await signed(h.call, keep, '/device/remove', { device: lost.id }));
  assert.equal(devices(h.db).find((d) => d.id === lost.id).removed_at, h.clock.ms);
  // Removing it again changes nothing.
  h.clock.ms += 1000;
  await h.call(await signed(h.call, keep, '/device/remove', { device: lost.id }));
  assert.equal(devices(h.db).find((d) => d.id === lost.id).removed_at, h.clock.ms - 1000);
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
  await h.call(await signed(h.call, dev, '/reverify', {}, { nonce: held[0] }));
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
    h.db.sqlite.prepare('INSERT INTO device (id, account_id, sign_key, created_at) VALUES (?, ?, ?, ?)').run('vector-device', 'acct-v', vector.signKey, h.clock.ms);
    h.db.sqlite.prepare('INSERT INTO nonce (value, device_id, expires_at, used) VALUES (?, ?, ?, 0)').run(vector.nonce, 'vector-device', h.clock.ms + 1000);
    const res = await h.call(post(vector.path, vector.body, { 'x-hz-device': 'vector-device', 'x-hz-nonce': vector.nonce, 'x-hz-sig': sig }));
    assert.equal((await res.json()).error, 'not-built', 'the vector signature passed the checks');
  }
});

// ---- audit ----

test('sign-in, register and remove each write one audit row of route and reason', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const before = auditRows(h.db).length;
  await h.call(signInRequest(ADDRESS, 'a wrong password here'));
  const ticket = await signIn(h, ADDRESS);
  await h.call(registerRequest('A'.repeat(43), await deviceKeys()));
  const keys = await deviceKeys();
  const { device } = await (await h.call(registerRequest(ticket, keys))).json();
  await h.call(await signed(h.call, { id: device, key: keys.key }, '/device/remove', { device }));
  assert.deepEqual(auditRows(h.db).slice(before), [
    { route: '/signin', reason: 'bad-login' },
    { route: '/signin', reason: 'ok' },
    { route: '/device/register', reason: 'bad-ticket' },
    { route: '/device/register', reason: 'ok' },
    { route: '/nonce', reason: 'ok' },
    { route: '/device/remove', reason: 'ok' },
  ]);
});
