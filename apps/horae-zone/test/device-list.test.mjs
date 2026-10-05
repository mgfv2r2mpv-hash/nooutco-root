// The signed device list (Sass PR #159 section 1, read through sharedPeerKey).
//
//   POST /devices {}  -> {list}
//
// Signed by a confirmed device (not pending, not removed, its account not
// locked). `list` is the service's ECDSA P-256 signature (HZ_TICKET_KEY, the
// key Sass pins) over `horae-zone-device-list-v1.${payload}`, the payload
// base64url JSON {v, typ, account, at, exp, kid, devices}: one entry per
// confirmed device of the account, {device, signKey, agreeKey, confirmedAt}.
// The label and the typ both differ from an unlock ticket's, so neither kind
// verifies as the other. The checks run through verifyDeviceList in
// test/helpers.mjs, the check Sass mirrors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromB64url, NONCE_TTL_MS, LIVE_NONCES_PER_DEVICE } from '../src/checks.js';
import { readTicket } from '../src/pin.js';
import {
  harness, post, signed, nonceFor, registeredDevice, confirmedDevice, codeAt, wrongCodeAt, tryCode, ticketFor, PASSWORD,
  verifyDeviceList, verifyUnlockTicket, signWithTicketKey, jwkThumbprint,
  TICKET_PUBLIC_JWK, DEVICE_LIST_LABEL_TEXT, UNLOCK_TICKET_LABEL_TEXT, DEVICE_LIST_TYP_TEXT, T0,
} from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses.
const ADDRESS = 'device-list-owner@example.test';
const OTHER = 'device-list-other@example.test';
const STEP_MS = 30_000;
const LIST_TTL_MS = 10 * 60 * 1000;

async function answer(res) {
  return { status: res.status, json: await res.json() };
}

async function listFor(h, device, body = {}) {
  return answer(await h.call(await signed(h.call, device, '/devices', body)));
}

const claimsOf = (list) => JSON.parse(new TextDecoder().decode(fromB64url(list.split('.')[0])));

// A further device of the owner's account that proves the account's code, so
// it is confirmed; the clock moves one step on after. Returns it with the
// account's seed (one code per account) and the moment its code was accepted.
async function secondConfirmed(h, owner) {
  const dev = await registeredDevice(h, owner.email, { fresh: false });
  const at = h.clock.ms;
  const tried = await tryCode(h, dev, await codeAt(owner, at));
  assert.equal(tried.finish?.status, 200, 'the second device proved the code');
  h.clock.ms += STEP_MS;
  return { ...dev, account: owner.account, seed: owner.seed, confirmedAt: at };
}

const entry = (dev, confirmedAt) => ({ device: dev.id, signKey: dev.signKey, agreeKey: dev.agreeKey, confirmedAt });

test('a confirmed device gets a signed list of every confirmed device of its account, with both public keys', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  const second = await secondConfirmed(h, owner);
  const pending = await registeredDevice(h, ADDRESS, { fresh: false });
  const gone = await secondConfirmed(h, owner);
  assert.equal((await answer(await h.call(await signed(h.call, owner, '/device/remove', { device: gone.id })))).status, 200);

  const got = await listFor(h, owner);
  assert.equal(got.status, 200, JSON.stringify(got.json));
  assert.deepEqual(Object.keys(got.json), ['list']);
  const claims = await verifyDeviceList(got.json.list, { account: owner.account, now: h.clock.ms });
  assert.ok(claims, 'the list verifies with the pinned key');
  assert.deepEqual(claims, {
    v: 1, typ: DEVICE_LIST_TYP_TEXT, account: owner.account, at: h.clock.ms, exp: h.clock.ms + LIST_TTL_MS,
    kid: await jwkThumbprint(TICKET_PUBLIC_JWK),
    devices: [entry(owner, T0), entry(second, second.confirmedAt)],
  });
  const listed = claims.devices.map((d) => d.device);
  assert.ok(!listed.includes(pending.id), 'a pending device is never listed');
  assert.ok(!listed.includes(gone.id), 'a removed device is never listed');

  const fromSecond = await listFor(h, second);
  assert.equal(fromSecond.status, 200);
  const again = await verifyDeviceList(fromSecond.json.list, { account: owner.account, now: h.clock.ms });
  assert.deepEqual(again.devices, claims.devices, 'every confirmed device gets the same list');
});

test('an unlock does not move a confirmed device\'s confirmedAt', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  const second = await secondConfirmed(h, owner);
  await ticketFor(h, second);
  const got = await listFor(h, owner);
  const claims = await verifyDeviceList(got.json.list, { account: owner.account, now: h.clock.ms });
  assert.deepEqual(claims.devices, [entry(owner, T0), entry(second, second.confirmedAt)]);
});

test('a pending device is refused', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  const pending = await registeredDevice(h, ADDRESS, { fresh: false });
  assert.deepEqual(await listFor(h, { ...pending, account: owner.account }), { status: 401, json: { error: 'no-device' } });
});

test('a removed device is refused', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  const second = await secondConfirmed(h, owner);
  const n = await nonceFor(h.call, second);
  assert.equal((await answer(await h.call(await signed(h.call, owner, '/device/remove', { device: second.id })))).status, 200);
  const res = await answer(await h.call(await signed(h.call, second, '/devices', {}, { nonce: n })));
  assert.deepEqual(res, { status: 401, json: { error: 'no-device' } });
});

test('another account\'s device never gets this account\'s devices, and cannot name an account', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  await secondConfirmed(h, owner);
  const stranger = await confirmedDevice(h, OTHER);
  const got = await listFor(h, stranger);
  assert.equal(got.status, 200);
  assert.equal(await verifyDeviceList(got.json.list, { account: owner.account, now: h.clock.ms }), null, 'it does not verify for the owner\'s account');
  const claims = await verifyDeviceList(got.json.list, { account: stranger.account, now: h.clock.ms });
  assert.deepEqual(claims.devices.map((d) => d.device), [stranger.id]);
  assert.deepEqual(await listFor(h, stranger, { account: owner.account }), { status: 400, json: { error: 'shape' } });
});

test('an unsigned or badly signed request is refused', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  assert.deepEqual(await answer(await h.call(post('/devices', {}))), { status: 401, json: { error: 'no-device' } });
  assert.deepEqual(await answer(await h.call(post('/devices', {}, { 'x-hz-device': owner.id }))), { status: 401, json: { error: 'stale-nonce' } });
  const req = await signed(h.call, owner, '/devices', {}, { tamper: { path: '/nonce' } });
  assert.deepEqual(await answer(await h.call(req)), { status: 401, json: { error: 'bad-signature' } });
});

test('a device of a locked account is refused', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  h.db.sqlite.prepare('INSERT INTO account_lock (account_id, locked_at) VALUES (?, ?)').run(owner.account, h.clock.ms);
  assert.deepEqual(await listFor(h, owner), { status: 423, json: { error: 'account-locked' } });
});

test('a list never verifies as an unlock ticket, and a ticket never verifies as a list', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  const ticket = await ticketFor(h, owner);
  const { list } = (await listFor(h, owner)).json;
  const now = h.clock.ms;
  const ids = { account: owner.account, device: owner.id, now };

  assert.ok(await verifyDeviceList(list, { account: owner.account, now }), 'NEGATIVE CONTROL: the list verifies as a list');
  assert.ok(await verifyUnlockTicket(ticket, ids), 'NEGATIVE CONTROL: the ticket verifies as a ticket');
  assert.notEqual(claimsOf(list).typ, claimsOf(ticket).typ, 'the purpose claims differ');
  assert.equal(await verifyDeviceList(ticket, { account: owner.account, now }), null);
  assert.equal(await verifyUnlockTicket(list, ids), null);
  assert.equal(await readTicket(h.env, list, { id: owner.id, account_id: owner.account }, now), null, 'the service\'s own ticket check refuses a list');
});

test('the label and the typ each keep the kinds apart, so a signer\'s slip in one is still caught', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  const now = h.clock.ms;
  const listClaims = { v: 1, typ: DEVICE_LIST_TYP_TEXT, account: owner.account, at: now, exp: now + LIST_TTL_MS, devices: [] };
  const ticketClaims = { v: 1, account: owner.account, device: owner.id, at: now, exp: now + LIST_TTL_MS, jti: 'A'.repeat(22) };
  const ids = { account: owner.account, device: owner.id, now };

  assert.ok(await verifyDeviceList(await signWithTicketKey(listClaims, DEVICE_LIST_LABEL_TEXT), { account: owner.account, now }), 'NEGATIVE CONTROL');
  // Ticket claims under the list label: the typ is missing.
  assert.equal(await verifyDeviceList(await signWithTicketKey(ticketClaims, DEVICE_LIST_LABEL_TEXT), { account: owner.account, now }), null);
  // List claims under the ticket label: the label is wrong for a list, and a ticket carries no typ.
  assert.equal(await verifyDeviceList(await signWithTicketKey(listClaims, UNLOCK_TICKET_LABEL_TEXT), { account: owner.account, now }), null);
  assert.equal(await verifyUnlockTicket(await signWithTicketKey({ ...ticketClaims, typ: DEVICE_LIST_TYP_TEXT }, UNLOCK_TICKET_LABEL_TEXT), ids), null);
});

test('a list is refused from its expiry on, and before it was issued', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  const issued = h.clock.ms;
  const { list } = (await listFor(h, owner)).json;
  const at = (now) => verifyDeviceList(list, { account: owner.account, now });
  assert.ok(await at(issued + LIST_TTL_MS - 1), 'NEGATIVE CONTROL: good until its last millisecond');
  assert.equal(await at(issued + LIST_TTL_MS), null);
  assert.equal(await at(issued - 1), null);
  assert.equal(claimsOf(list).exp - claimsOf(list).at, LIST_TTL_MS, 'it lives ten minutes');
});

// Item 2: nothing secret. The claims hold exactly these keys, each key in a
// device entry is a raw uncompressed P-256 point (65 bytes, first byte 4,
// so a public key and never a 32-byte private scalar), and no value carries
// the account's address, password or authenticator secret. Returns what it
// finds, so the negative control can plant each kind.
const CLAIM_KEYS = ['account', 'at', 'devices', 'exp', 'kid', 'typ', 'v'];
const ENTRY_KEYS = ['agreeKey', 'confirmedAt', 'device', 'signKey'];

function isPublicPoint(text) {
  const raw = fromB64url(text);
  return raw.length === 65 && raw[0] === 4;
}

function secretsIn(claims, forbidden) {
  const found = [];
  if (JSON.stringify(Object.keys(claims).sort()) !== JSON.stringify(CLAIM_KEYS)) found.push('claim keys');
  for (const d of claims.devices ?? []) {
    if (JSON.stringify(Object.keys(d).sort()) !== JSON.stringify(ENTRY_KEYS)) found.push('entry keys');
    if (!isPublicPoint(d.signKey) || !isPublicPoint(d.agreeKey)) found.push('a key that is not a public point');
  }
  const text = JSON.stringify(claims);
  for (const value of forbidden) if (text.includes(value)) found.push('a forbidden value');
  return found;
}

test('the list carries public keys only: no address, no code state, no count', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  await secondConfirmed(h, owner);
  const forbidden = [ADDRESS, PASSWORD, owner.secret];

  const before = await listFor(h, owner);
  const claims = await verifyDeviceList(before.json.list, { account: owner.account, now: h.clock.ms });
  assert.deepEqual(secretsIn(claims, forbidden), []);
  for (const value of forbidden) assert.equal(JSON.stringify(before.json).includes(value), false, 'the answer carries a forbidden value');

  // A wrong code leaves the account's code state changed; the list must not show it.
  const wrong = await tryCode(h, owner, await wrongCodeAt(owner, h.clock.ms));
  assert.equal(wrong.proved, false, 'NEGATIVE CONTROL: the code try was wrong');
  const after = await listFor(h, owner);
  assert.deepEqual(await verifyDeviceList(after.json.list, { account: owner.account, now: h.clock.ms }), claims, 'a wrong code changes nothing in the list');
});

test('NEGATIVE CONTROL: the secrets check catches a planted address, count, extra field or private key', () => {
  const pub = b64Point(65, 4);
  const clean = { v: 1, typ: DEVICE_LIST_TYP_TEXT, account: 'a', at: 1, exp: 2, kid: 'k', devices: [{ device: 'd', signKey: pub, agreeKey: pub, confirmedAt: 1 }] };
  assert.deepEqual(secretsIn(clean, [ADDRESS]), []);
  assert.notDeepEqual(secretsIn({ ...clean, account: ADDRESS }, [ADDRESS]), []);
  assert.notDeepEqual(secretsIn({ ...clean, count: 1 }, [ADDRESS]), []);
  assert.notDeepEqual(secretsIn({ ...clean, devices: [{ ...clean.devices[0], email: 'x' }] }, [ADDRESS]), []);
  assert.notDeepEqual(secretsIn({ ...clean, devices: [{ ...clean.devices[0], agreeKey: b64Point(32, 4) }] }, [ADDRESS]), []);
});

function b64Point(length, first) {
  const raw = new Uint8Array(length).fill(1);
  raw[0] = first;
  return Buffer.from(raw).toString('base64url');
}

// Item 2: rate limited like the other signed routes. A signed route has no
// throttle of its own; each request spends one single-use nonce, and a device
// holds at most LIVE_NONCES_PER_DEVICE live ones, each for NONCE_TTL_MS.
test('the list is bounded like every signed route: one single-use nonce per request, five live nonces per device', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, ADDRESS);
  assert.equal(LIVE_NONCES_PER_DEVICE, 5);
  const nonces = [];
  for (let i = 0; i < LIVE_NONCES_PER_DEVICE; i += 1) nonces.push(await nonceFor(h.call, owner));
  const sixth = await answer(await h.call(post('/nonce', {}, { 'x-hz-device': owner.id })));
  assert.deepEqual(sixth, { status: 429, json: { error: 'slow-down' } });

  for (const n of nonces) assert.equal((await answer(await h.call(await signed(h.call, owner, '/devices', {}, { nonce: n })))).status, 200);
  const again = await answer(await h.call(await signed(h.call, owner, '/devices', {}, { nonce: nonces[0] })));
  assert.deepEqual(again, { status: 401, json: { error: 'stale-nonce' } }, 'a nonce lists once');

  const late = await nonceFor(h.call, owner);
  h.clock.ms += NONCE_TTL_MS;
  const expired = await answer(await h.call(await signed(h.call, owner, '/devices', {}, { nonce: late })));
  assert.deepEqual(expired, { status: 401, json: { error: 'stale-nonce' } }, 'a nonce lives a minute');
});
