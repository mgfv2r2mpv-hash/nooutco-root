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
  registeredDevice, enrolledDevice, enrolTicket, enrolRequest, tryCode, codeAt, auditRows, PASSWORD,
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
