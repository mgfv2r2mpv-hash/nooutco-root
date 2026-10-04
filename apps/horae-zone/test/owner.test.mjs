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
  registeredDevice, enrolledDevice, confirmedDevice, enrolTicket, enrolRequest, tryCode, startCode, codeAt, wrongCodeAt, auditRows, PASSWORD,
  landsMidFlight, nonceFor,
} from './helpers.mjs';
import { DAY_MS } from '../../../packages/account-engine/src/limits.mjs';

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

// A5 re-review, item 5: before the first accepted code a non-pending device's
// wrong codes count toward the account's limits. That design stays, because
// since item 1 only the owner device can be non-pending then. Probe F4 is the
// re-review's: a password thief's device registered before the first accepted
// code spent the owner's lockout and closed the owner's path.
const LOCK_SUBJECT = /code entry (paused|closed)/;
const lockNotes = (h) => h.mail.filter((m) => m.to === OWNER && LOCK_SUBJECT.test(m.subject));

test('probe F4: before the first accepted code a password thief spends none of the account\'s limits, and the owner device\'s wrongs still count', async () => {
  const h = harness();
  const owner = await enrolledDevice(h, OWNER);
  const thief = { ...(await thiefDevice(h, OWNER)), seed: owner.seed };
  const starts = [];
  for (let w = 0; w < 4; w += 1) {
    for (let i = 0; i < 3; i += 1) starts.push((await tryCode(h, thief, await wrongCodeAt(owner, h.clock.ms))).start);
    h.clock.ms += 30_000;
  }
  assert.equal(starts.filter((s) => s.status === 200).length, 0, 'the thief\'s device is admitted no try');
  for (const s of starts) assert.deepEqual(s, { status: 409, json: { error: 'not-enrolled' } });
  assert.deepEqual(lockNotes(h), [], 'the thief locked no window and closed nothing');
  assert.equal(h.db.sqlite.prepare('SELECT confirmed_by FROM otp').get().confirmed_by, null);
  // The owner device, the one non-pending device before confirmation: its
  // wrong codes lock a window, and two locked windows in a row close the path.
  for (let i = 0; i < 3; i += 1) assert.equal((await tryCode(h, owner, await wrongCodeAt(owner, h.clock.ms))).finish.status, 401);
  assert.equal(lockNotes(h).length, 1, 'three wrong codes lock the window');
  h.clock.ms += 30_000;
  for (let i = 0; i < 3; i += 1) assert.equal((await tryCode(h, owner, await wrongCodeAt(owner, h.clock.ms))).finish.status, 401);
  assert.equal(lockNotes(h).length, 2, 'the second locked window in a row closes the path');
  h.clock.ms += 30_000;
  assert.deepEqual((await tryCode(h, owner, await codeAt(owner, h.clock.ms))).start, { status: 423, json: { error: 'locked' } });
  assert.equal(h.db.sqlite.prepare('SELECT confirmed_by FROM otp').get().confirmed_by, null);
});

test('probe F4 NEGATIVE CONTROL: before the first accepted code the owner device\'s right code still confirms after the thief\'s tries', async () => {
  const h = harness();
  const owner = await enrolledDevice(h, OWNER);
  const thief = { ...(await thiefDevice(h, OWNER)), seed: owner.seed };
  for (let i = 0; i < 3; i += 1) await tryCode(h, thief, await wrongCodeAt(owner, h.clock.ms));
  h.clock.ms += 30_000;
  assert.equal((await tryCode(h, owner, await codeAt(owner, h.clock.ms))).finish.status, 200);
  assert.equal(h.db.sqlite.prepare('SELECT confirmed_by FROM otp').get().confirmed_by, owner.id);
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

// A5 re-review, item 3: the pending devices of one account share one cap, 6
// tries a day counted by account id, whatever the number of devices. Every
// wrong pending try mails the owner, at most one such note an hour, carrying
// no code. Probe F3 is the re-review's: 8 pending devices, 3 tries each.
const PENDING_LOCKED = { status: 423, json: { error: 'locked' } };
const pendingNotes = (h) => h.mail.filter((m) => m.to === OWNER && /new device/i.test(m.subject));
const withSeed = (dev, owner) => ({ ...dev, seed: owner.seed });

function assertClosedNote(message, owner) {
  assert.equal(`${message.subject}${message.text}`.includes(String.fromCharCode(0x2014)), false, 'no em dash');
  assert.equal(message.text.includes(owner.secret), false, 'no seed');
  assert.doesNotMatch(message.text, /(?<![0-9])[0-9]{6}(?![0-9])/, 'no six-digit code');
  assert.doesNotMatch(message.text, /https?:\/\//, 'no link');
  assert.doesNotMatch(message.text, new RegExp(PASSWORD), 'no password');
}

test('probe F3: 8 pending devices with 3 tries each get at most 6 tries a day between them, and the owner is mailed', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, OWNER);
  const thieves = [];
  for (let i = 0; i < 8; i += 1) thieves.push(withSeed(await thiefDevice(h, OWNER), owner));
  let admitted = 0;
  for (const thief of thieves) {
    for (let i = 0; i < 3; i += 1) {
      const tried = await tryCode(h, thief, await wrongCodeAt(owner, h.clock.ms));
      if (tried.start.status === 200) {
        admitted += 1;
        assert.deepEqual(tried.finish, { status: 401, json: { error: 'bad-code' } });
      } else {
        assert.deepEqual(tried.start, PENDING_LOCKED);
      }
    }
  }
  assert.equal(admitted, 6, 'six tries a day for the account, not three per device');
  assert.equal(pendingTries(h), 6);
  const notes = pendingNotes(h);
  assert.equal(notes.length, 1, 'the owner is mailed, once in the hour');
  assertClosedNote(notes[0], owner);
  assert.equal((await tryCode(h, owner, await codeAt(owner, h.clock.ms))).finish.status, 200, 'the owner\'s path stays open');
});

test('re-review 3: the account\'s 6 pending tries a day hold when tries from several devices arrive together', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, OWNER);
  const requests = [];
  for (let i = 0; i < 3; i += 1) {
    const thief = withSeed(await thiefDevice(h, OWNER), owner);
    for (let j = 0; j < 3; j += 1) requests.push(startCode(h, thief, await wrongCodeAt(owner, h.clock.ms)));
  }
  const answers = (await Promise.all(requests)).map((s) => s.start);
  assert.equal(answers.filter((a) => a.status === 200).length, 6);
  for (const a of answers.filter((x) => x.status !== 200)) assert.deepEqual(a, PENDING_LOCKED);
  assert.equal(pendingTries(h), 6);
});

test('re-review 3: the account\'s pending tries are counted for a day from each try, and removing a device gives none back', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, OWNER);
  const first = withSeed(await thiefDevice(h, OWNER), owner);
  const second = withSeed(await thiefDevice(h, OWNER), owner);
  const at = h.clock.ms;
  for (const dev of [first, second]) for (let i = 0; i < 3; i += 1) assert.equal((await tryCode(h, dev, await wrongCodeAt(owner, h.clock.ms))).start.status, 200);
  assert.deepEqual(await answer(await h.call(await signed(h.call, owner, '/device/remove', { device: first.id }))), { status: 200, json: { ok: true } });
  const third = withSeed(await thiefDevice(h, OWNER), owner);
  assert.deepEqual((await tryCode(h, third, await codeAt(owner, h.clock.ms))).start, PENDING_LOCKED, 'a right code is refused past the account\'s cap');
  h.clock.ms = at + DAY_MS + 30_000;
  assert.equal((await tryCode(h, third, await codeAt(owner, h.clock.ms))).finish.status, 200, 'a day later a pending device proves the code');
});

test('re-review 3: each wrong pending try mails the owner, at most one note an hour, and a right one mails nothing', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, OWNER);
  const mine = withSeed(await registeredDevice(h, OWNER, { fresh: false, ip: IP }), owner);
  const before = h.mail.length;
  assert.equal((await tryCode(h, mine, await codeAt(owner, h.clock.ms))).finish.status, 200);
  assert.equal(h.mail.length, before, 'a right pending try mails nothing');
  const thief = withSeed(await thiefDevice(h, OWNER), owner);
  assert.equal((await tryCode(h, thief, await wrongCodeAt(owner, h.clock.ms))).finish.status, 401);
  assert.equal(pendingNotes(h).length, 1, 'the first wrong pending try mails the owner');
  assertClosedNote(pendingNotes(h)[0], owner);
  h.clock.ms += 30 * 60 * 1000;
  assert.equal((await tryCode(h, thief, await wrongCodeAt(owner, h.clock.ms))).finish.status, 401);
  assert.equal(pendingNotes(h).length, 1, 'no second note within the hour');
  h.clock.ms += 30 * 60 * 1000 + 1;
  assert.equal((await tryCode(h, thief, await wrongCodeAt(owner, h.clock.ms))).finish.status, 401);
  assert.equal(pendingNotes(h).length, 2, 'a wrong try an hour later mails again');
});

test('re-review 3: pending tries started and never finished mail the owner once the account\'s cap refuses one', async () => {
  const h = harness();
  const owner = await confirmedDevice(h, OWNER);
  const thieves = [withSeed(await thiefDevice(h, OWNER), owner), withSeed(await thiefDevice(h, OWNER), owner)];
  for (const thief of thieves) for (let i = 0; i < 3; i += 1) assert.equal((await tryCode(h, thief, await wrongCodeAt(owner, h.clock.ms), { finish: false })).start.status, 200);
  assert.equal(pendingNotes(h).length, 0, 'an unfinished start has no answer yet');
  const late = withSeed(await thiefDevice(h, OWNER), owner);
  assert.deepEqual((await tryCode(h, late, await wrongCodeAt(owner, h.clock.ms))).start, PENDING_LOCKED);
  assert.equal(pendingNotes(h).length, 1, 'the refusal at the cap mails the owner');
  assertClosedNote(pendingNotes(h)[0], owner);
});
