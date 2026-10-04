// A5 re-review, root rule: ownership comes from the email inbox, not the
// password. The sign-up link's verify hands out the ticket that registers the
// account's first device, the owner device; a password-only sign-in on an
// account with no device registers nothing and tells the owner by mail; every
// device registered after the first starts pending. Probes F1 and F2 are the
// re-review's: a password thief who registers a device of its own cannot
// remove the owner's device, enrol, or swap the unconfirmed seed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  harness, post, signed, deviceKeys, keyDigestOf, registerRequest, signIn, signInRequest,
  registeredDevice, enrolledDevice, confirmedDevice, enrolTicket, enrolRequest, tryCode, codeAt, auditRows, PASSWORD,
  landsMidFlight, nonceFor,
} from './helpers.mjs';

const OWNER = 'owner@example.test';
const IP = '192.0.2.10';
const THIEF_IP = '198.51.100.7';
const answer = async (res) => ({ status: res.status, json: await res.json() });

// Starts a sign-up and returns the code from the mailed link.
async function mailedCode(h, email) {
  await h.call(post('/account', { email }, { 'cf-connecting-ip': IP }));
  const message = h.mail.filter((m) => m.to === email).at(-1);
  return new URL(message.text.match(/https:\/\/\S+/)[0]).hash.slice(1);
}

function verifyRequest(email, code, keyDigest) {
  const body = keyDigest === undefined ? { email, code, password: PASSWORD } : { email, code, password: PASSWORD, keyDigest };
  return post('/account/email/verify', body, { 'cf-connecting-ip': IP });
}

const deviceRow = (h, id) => h.db.sqlite.prepare('SELECT owner, pending FROM device WHERE id = ?').get(id);
const deviceCount = (h) => h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM device').get().n;

// The thief knows the password and nothing else: an unsigned sign-in from its
// own connecting address, then a registration with its own keys.
async function thiefDevice(h, email) {
  const keys = await deviceKeys();
  const ticket = await signIn(h, email, { keys, ip: THIEF_IP });
  const res = await h.call(registerRequest(ticket, keys));
  assert.equal(res.status, 200);
  const { device } = await res.json();
  return { id: device, key: keys.key, signKey: keys.signKey, agreeKey: keys.agreeKey };
}

test('owner: the sign-up verify answers a ticket that registers the account\'s first device as its owner, not pending', async () => {
  const h = harness();
  const keys = await deviceKeys();
  const code = await mailedCode(h, OWNER);
  const verified = await answer(await h.call(verifyRequest(OWNER, code, await keyDigestOf(keys))));
  assert.equal(verified.status, 200);
  assert.equal(typeof verified.json.ticket, 'string');
  const registered = await answer(await h.call(registerRequest(verified.json.ticket, keys)));
  assert.equal(registered.status, 200);
  assert.deepEqual({ ...deviceRow(h, registered.json.device) }, { owner: 1, pending: 0 });
});

test('owner: the sign-up ticket registers only the keys it was verified for, once', async () => {
  const h = harness();
  const keys = await deviceKeys();
  const code = await mailedCode(h, OWNER);
  const { ticket } = await (await h.call(verifyRequest(OWNER, code, await keyDigestOf(keys)))).json();
  assert.deepEqual(await answer(await h.call(registerRequest(ticket, await deviceKeys()))), { status: 401, json: { error: 'bad-ticket' } });
  assert.equal((await h.call(registerRequest(ticket, keys))).status, 200);
  assert.deepEqual(await answer(await h.call(registerRequest(ticket, keys))), { status: 401, json: { error: 'bad-ticket' } });
  assert.equal(deviceCount(h), 1);
});

test('owner: a verify without a key digest is refused as shape and makes no account', async () => {
  const h = harness();
  const code = await mailedCode(h, OWNER);
  assert.deepEqual(await answer(await h.call(verifyRequest(OWNER, code))), { status: 400, json: { error: 'shape' } });
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM account').get().n, 0);
});

test('owner: a password-only sign-in on an account with no device yet is refused, stores no ticket, and mails the owner', async () => {
  const h = harness();
  const code = await mailedCode(h, OWNER);
  assert.equal((await h.call(verifyRequest(OWNER, code, await keyDigestOf(await deviceKeys())))).status, 200);
  const tickets = h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ticket').get().n;
  const before = h.mail.length;
  const res = await answer(await h.call(signInRequest(OWNER, PASSWORD, THIEF_IP, await keyDigestOf(await deviceKeys()))));
  assert.deepEqual(res, { status: 403, json: { error: 'no-owner-device' } });
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ticket').get().n, tickets);
  const sent = h.mail.slice(before);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, OWNER);
  assert.match(sent[0].text, /password/);
  assert.doesNotMatch(sent[0].text, new RegExp(PASSWORD));
  assert.doesNotMatch(sent[0].text, /https?:\/\//);
  assert.deepEqual(auditRows(h.db).at(-1), { route: '/signin', reason: 'no-owner-device' });
});

test('owner: the refused sign-in mails the owner at most once an hour', async () => {
  const h = harness();
  const code = await mailedCode(h, OWNER);
  assert.equal((await h.call(verifyRequest(OWNER, code, await keyDigestOf(await deviceKeys())))).status, 200);
  const before = h.mail.length;
  for (const ip of ['198.51.100.7', '198.51.100.8', '198.51.100.9']) {
    assert.equal((await h.call(signInRequest(OWNER, PASSWORD, ip))).status, 403);
  }
  assert.equal(h.mail.length - before, 1);
  h.clock.ms += 60 * 60 * 1000 + 1;
  assert.equal((await h.call(signInRequest(OWNER, PASSWORD, '198.51.100.10'))).status, 403);
  assert.equal(h.mail.length - before, 2);
});

test('owner NEGATIVE CONTROL: a wrong password on an account with no device answers bad-login and mails nobody', async () => {
  const h = harness();
  const code = await mailedCode(h, OWNER);
  assert.equal((await h.call(verifyRequest(OWNER, code, await keyDigestOf(await deviceKeys())))).status, 200);
  const before = h.mail.length;
  assert.deepEqual(await answer(await h.call(signInRequest(OWNER, `${PASSWORD} wrong`, THIEF_IP))), { status: 401, json: { error: 'bad-login' } });
  assert.equal(h.mail.length, before);
});

test('owner: a device registered from a password sign-in starts pending, before any code is enrolled', async () => {
  const h = harness();
  const owner = await registeredDevice(h, OWNER);
  const thief = await thiefDevice(h, OWNER);
  assert.deepEqual({ ...deviceRow(h, owner.id) }, { owner: 1, pending: 0 });
  assert.deepEqual({ ...deviceRow(h, thief.id) }, { owner: 0, pending: 1 });
  assert.equal((await h.call(post('/nonce', {}, { 'x-hz-device': thief.id }))).status, 200);
});

test('probe F1: a password thief cannot remove the owner\'s device and enrol', async () => {
  const h = harness();
  const owner = await registeredDevice(h, OWNER);
  const thief = await thiefDevice(h, OWNER);
  const removed = await answer(await h.call(await signed(h.call, thief, '/device/remove', { device: owner.id })));
  assert.notEqual(removed.status, 200);
  assert.equal(h.db.sqlite.prepare('SELECT removed_at FROM device WHERE id = ?').get(owner.id).removed_at, null);
  const enrolled = await answer(await h.call(await enrolRequest(h.call, thief, await enrolTicket(h, OWNER, thief))));
  assert.notEqual(enrolled.status, 200);
  assert.equal(enrolled.json.secret, undefined);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM otp').get().n, 0);
});

test('probe F2: a password thief cannot swap the owner\'s unconfirmed seed', async () => {
  const h = harness();
  const owner = await enrolledDevice(h, OWNER);
  const box = h.db.sqlite.prepare('SELECT box, enrolment FROM otp').get();
  const thief = await thiefDevice(h, OWNER);
  const removed = await answer(await h.call(await signed(h.call, thief, '/device/remove', { device: owner.id })));
  assert.notEqual(removed.status, 200);
  const swapped = await answer(await h.call(await enrolRequest(h.call, thief, await enrolTicket(h, OWNER, thief))));
  assert.notEqual(swapped.status, 200);
  assert.equal(swapped.json.secret, undefined);
  assert.deepEqual({ ...h.db.sqlite.prepare('SELECT box, enrolment FROM otp').get() }, { ...box });
  const tried = await tryCode(h, owner, await codeAt(owner, h.clock.ms));
  assert.equal(tried.finish.status, 200);
});

// A5 re-review, item 2: a pending device changes nothing, and until the first
// accepted code confirms the enrolment only the owner device may enrol,
// re-enrol or remove a device. The checks are in the writes themselves, so a
// device whose standing changes mid-flight changes nothing either.
const NOT_OWNER = { status: 403, json: { error: 'not-owner' } };
const otpRow = (h) => h.db.sqlite.prepare('SELECT box, enrolment, confirmed_by FROM otp').get();
const isLive = (h, id) => h.db.sqlite.prepare('SELECT removed_at FROM device WHERE id = ?').get(id).removed_at === null;
const pendingTries = (h) => h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM pending_try').get().n;

test('re-review 2: a password thief\'s pending device does not block the owner\'s enrolment', async () => {
  const h = harness();
  const owner = await registeredDevice(h, OWNER);
  await thiefDevice(h, OWNER);
  const enrolled = await answer(await h.call(await enrolRequest(h.call, owner, await enrolTicket(h, OWNER, owner))));
  assert.equal(enrolled.status, 200, JSON.stringify(enrolled.json));
  assert.deepEqual(Object.keys(enrolled.json).sort(), ['secret', 'uri']);
});

test('re-review 2: a pending device cannot confirm the enrolment, so the owner device is never held back', async () => {
  const h = harness();
  const owner = await enrolledDevice(h, OWNER);
  // The owner's own second phone, holding the seed: still pending.
  const second = await registeredDevice(h, OWNER, { fresh: false, ip: IP });
  const early = await tryCode(h, { ...second, seed: owner.seed }, await codeAt(owner, h.clock.ms));
  assert.deepEqual(early.start, { status: 409, json: { error: 'not-enrolled' } });
  assert.deepEqual({ ...deviceRow(h, owner.id) }, { owner: 1, pending: 0 });
  assert.equal(otpRow(h).confirmed_by, null);
  assert.equal(pendingTries(h), 0, 'the refused start spent none of the account\'s pending tries');
  assert.equal((await tryCode(h, owner, await codeAt(owner, h.clock.ms))).finish.status, 200, 'the owner confirms');
  assert.equal(otpRow(h).confirmed_by, owner.id);
  h.clock.ms += 30_000;
  assert.equal((await tryCode(h, { ...second, seed: owner.seed }, await codeAt(owner, h.clock.ms))).finish.status, 200, 'then the second phone proves it');
  assert.deepEqual({ ...deviceRow(h, second.id) }, { owner: 0, pending: 0 });
  assert.deepEqual({ ...deviceRow(h, owner.id) }, { owner: 1, pending: 0 });
});

test('re-review 2: before the first accepted code, a device that is not the owner cannot enrol or remove, even when not pending', async () => {
  const h = harness();
  const owner = await enrolledDevice(h, OWNER);
  const before = { ...otpRow(h) };
  const other = await registeredDevice(h, OWNER, { fresh: false, ip: IP });
  h.db.sqlite.prepare('UPDATE device SET pending = 0 WHERE id = ?').run(other.id); // a row changed by hand
  assert.deepEqual(await answer(await h.call(await signed(h.call, other, '/device/remove', { device: owner.id }))), NOT_OWNER);
  assert.ok(isLive(h, owner.id), 'the owner device stays');
  assert.deepEqual(await answer(await h.call(await enrolRequest(h.call, other, await enrolTicket(h, OWNER, other)))), NOT_OWNER);
  assert.deepEqual({ ...otpRow(h) }, before, 'the unconfirmed seed stays');
  assert.deepEqual(auditRows(h.db).at(-1), { route: '/otp/enrol', reason: 'not-owner' });
});

test('re-review 2: the enrolment re-checks the owner flag in its own writes', async () => {
  const h = harness();
  const owner = await registeredDevice(h, OWNER);
  const request = await enrolRequest(h.call, owner, await enrolTicket(h, OWNER, owner));
  landsMidFlight(h, 'UPDATE ticket SET used = 1', (db) => db.sqlite.prepare('UPDATE device SET owner = 0 WHERE id = ?').run(owner.id));
  assert.deepEqual(await answer(await h.call(request)), NOT_OWNER);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM otp').get().n, 0, 'no seed was stored');
});

test('re-review 2: a removal re-checks the caller\'s standing in its own writes', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, OWNER);
  const other = await registeredDevice(h, OWNER, { fresh: false, ip: IP });
  assert.equal((await tryCode(h, { ...other, seed: owner.seed }, await codeAt(owner, h.clock.ms))).finish.status, 200);
  await nonceFor(h.call, owner); // a live nonce of the owner device
  const request = await signed(h.call, other, '/device/remove', { device: owner.id });
  // Held back between the device checks and the removal's writes.
  landsMidFlight(h, 'SELECT 1 AS may_change', (db) => db.sqlite.prepare('UPDATE device SET pending = 1 WHERE id = ?').run(other.id));
  await h.call(request);
  assert.ok(isLive(h, owner.id), 'the owner device stays');
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM nonce WHERE device_id = ? AND used = 0').get(owner.id).n, 1, 'its nonce stays live');
});

test('re-review 2 NEGATIVE CONTROL: after the first accepted code, a device that proved a code may remove another, the owner\'s included', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, OWNER);
  const other = await registeredDevice(h, OWNER, { fresh: false, ip: IP });
  assert.equal((await tryCode(h, { ...other, seed: owner.seed }, await codeAt(owner, h.clock.ms))).finish.status, 200);
  assert.deepEqual(await answer(await h.call(await signed(h.call, other, '/device/remove', { device: owner.id }))), { status: 200, json: { ok: true } });
  assert.equal(isLive(h, owner.id), false);
});
