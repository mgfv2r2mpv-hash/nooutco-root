// MEDIUM-1 of the final A5 re-review: the sign-up verify hands out the owner
// ticket, live 5 minutes. A client that crashed or was slow and did not
// register in time was left with an account nothing could reissue a ticket
// for: /device/register answered bad-ticket, /signin no-owner-device and a
// fresh sign-up start sent nothing. The root rule stays (ownership comes from
// the email inbox, not the password), so for an account that has never had a
// device, removed ones included, a fresh single-use email link is the way back
// in. Accounts with a device are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SIGNUP_LIMITS, OWNER_TICKET_TTL_MS } from '../src/signup.js';
import {
  harness, post, deviceKeys, keyDigestOf, registerRequest, signInRequest, addDevice, signUp, PASSWORD, LINK_BASE, T0,
  landsMidFlight, signIn,
} from './helpers.mjs';

const OWNER = 'owner@example.test';
const IP = '192.0.2.10';
const answer = async (res) => ({ status: res.status, json: await res.json() });

const start = (h, email, ip = IP) => h.call(post('/account', { email }, { 'cf-connecting-ip': ip }));
const mailTo = (h, email) => h.mail.filter((m) => m.to === email);
const codeOf = (message) => new URL(message.text.match(/https:\/\/\S+/)[0]).hash.slice(1);
const liveCodes = (h) => h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM challenge WHERE used = 0 AND expires_at > ?').get(h.clock.ms).n;

function verifyRequest(email, code, keyDigest, { password = PASSWORD, ip = IP } = {}) {
  return post('/account/email/verify', { email, code, password, keyDigest }, { 'cf-connecting-ip': ip });
}

// The review's sequence up to the dead end: the sign-up link verifies and
// answers the owner ticket, the client registers nothing, and 6 minutes later
// the ticket is dead and the password alone registers nothing.
async function strandedAccount(h) {
  const keys = await deviceKeys();
  await start(h, OWNER);
  const verified = await answer(await h.call(verifyRequest(OWNER, codeOf(mailTo(h, OWNER).at(-1)), await keyDigestOf(keys))));
  assert.equal(verified.status, 200);
  h.clock.ms += 6 * 60 * 1000;
  assert.ok(6 * 60 * 1000 > OWNER_TICKET_TTL_MS, 'the wait outlives the owner ticket');
  assert.deepEqual(await answer(await h.call(registerRequest(verified.json.ticket, keys))), { status: 401, json: { error: 'bad-ticket' } });
  assert.deepEqual(await answer(await h.call(signInRequest(OWNER, PASSWORD, IP, await keyDigestOf(keys)))), { status: 403, json: { error: 'no-owner-device' } });
  return { keys, ticket: verified.json.ticket };
}

// Past the life of the sign-up link, so the mint rules (one link inside its
// life at a time) let a start mint again.
const pastSignupLink = (h) => { h.clock.ms = T0 + SIGNUP_LIMITS.codeTtlMs; };

test('MEDIUM-1: a start for an account that has no device mails a fresh, live link', async () => {
  const h = harness();
  await strandedAccount(h);
  pastSignupLink(h);
  const before = mailTo(h, OWNER).length;
  assert.deepEqual(await answer(await start(h, OWNER, '192.0.2.40')), { status: 200, json: { ok: true } });
  const sent = mailTo(h, OWNER).slice(before);
  assert.equal(sent.length, 1, 'one link goes to the account\'s address');
  assert.match(codeOf(sent[0]), /^[A-Za-z0-9_-]{22}$/);
  assert.equal(`${sent[0].subject}${sent[0].text}`.includes(String.fromCharCode(0x2014)), false, 'no em dash');
  assert.doesNotMatch(sent[0].text, new RegExp(PASSWORD), 'no password');
  assert.equal(liveCodes(h), 1, 'one live link');
});

test('MEDIUM-1: a deviceless account keeps the mint rules: one live link at a time, re-sent inside the re-send cap', async () => {
  const h = harness();
  await strandedAccount(h);
  pastSignupLink(h);
  for (let i = 0; i < 6; i += 1) {
    assert.deepEqual(await answer(await start(h, OWNER, `198.51.100.${i}`)), { status: 200, json: { ok: true } });
    assert.equal(liveCodes(h), 1, `one live link after start ${i + 1}`);
  }
  // The sign-up link and the sign-in note came before; only link mails after.
  const links = mailTo(h, OWNER).slice(1).filter((m) => m.text.includes(LINK_BASE)).map(codeOf);
  assert.equal(links.length, 1 + SIGNUP_LIMITS.resendsPerAddressHour, 'one mint, then re-sends inside the cap');
  assert.equal(new Set(links).size, 1, 'every mail carries the one live link');
});

test('MEDIUM-1 NEGATIVE CONTROL: a start for an account with a device, a removed one included, mails nothing', async () => {
  for (const removed of [null, T0]) {
    const h = harness();
    await strandedAccount(h);
    const account = h.db.sqlite.prepare('SELECT id FROM account').get().id;
    await addDevice(h.db, { id: 'dev-owner', account, removed });
    pastSignupLink(h);
    const before = h.mail.length;
    assert.deepEqual(await answer(await start(h, OWNER, '192.0.2.40')), { status: 200, json: { ok: true } });
    assert.equal(h.mail.length, before, `nothing mailed (removed_at ${removed})`);
    assert.equal(liveCodes(h), 0, 'no live link');
  }
});

// The answer, and the statements behind it, are the same for an account with
// no device, an account with a device and no account (M1, security review),
// so an outsider learns nothing about whether the address has an account.
test('MEDIUM-1: a start answers and runs the same statements for a deviceless account, a deviced account and no account', async () => {
  const h = harness();
  await start(h, 'deviced@example.test', '192.0.2.20');
  const message = mailTo(h, 'deviced@example.test').at(-1);
  assert.equal((await h.call(verifyRequest('deviced@example.test', codeOf(message), await keyDigestOf(await deviceKeys()), { ip: '192.0.2.20' }))).status, 200);
  await addDevice(h.db, { id: 'dev-deviced', account: h.db.sqlite.prepare('SELECT id FROM account').get().id });
  await strandedAccount(h);
  pastSignupLink(h);
  const run = async (email, ip) => {
    const from = h.db.bound.length;
    const res = await answer(await start(h, email, ip));
    return { res, sql: h.db.bound.slice(from).map((s) => s.sql) };
  };
  const deviceless = await run(OWNER, '192.0.2.41');
  const withDevice = await run('deviced@example.test', '192.0.2.42');
  const none = await run('nobody@example.test', '192.0.2.43');
  assert.deepEqual(deviceless.res, { status: 200, json: { ok: true } });
  assert.deepEqual(withDevice.res, deviceless.res);
  assert.deepEqual(none.res, deviceless.res);
  assert.deepEqual(withDevice.sql, deviceless.sql);
  assert.deepEqual(none.sql, deviceless.sql);
});

// Item 2: the fresh link's verify, with the account's password, answers a new
// owner ticket bound to the presented key digest, as the sign-up verify does.
const ownerTickets = (h) => h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ticket WHERE owner = 1 AND used = 0 AND expires_at > ?').get(h.clock.ms).n;
const devices = (h) => h.db.sqlite.prepare('SELECT owner, pending FROM device').all().map((d) => ({ ...d }));

// A stranded account, then a start past the sign-up link's life: the fresh link.
async function freshLink(h, ip = '192.0.2.40') {
  const stranded = await strandedAccount(h);
  pastSignupLink(h);
  const before = mailTo(h, OWNER).length;
  await start(h, OWNER, ip);
  const sent = mailTo(h, OWNER).slice(before).filter((m) => m.text.includes(LINK_BASE));
  assert.equal(sent.length, 1, 'the start mailed a fresh link');
  return { ...stranded, code: codeOf(sent[0]) };
}

test('MEDIUM-1: the review\'s sequence ends with a fresh link, verify, a new owner ticket, register 200 and one owner device', async () => {
  const h = harness();
  const { code } = await freshLink(h);
  const keys = await deviceKeys();
  const verified = await answer(await h.call(verifyRequest(OWNER, code, await keyDigestOf(keys), { ip: '192.0.2.40' })));
  assert.equal(verified.status, 200);
  assert.match(verified.json.ticket, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(Object.keys(verified.json).sort(), ['ok', 'ticket']);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM account').get().n, 1, 'no second account');
  // Bound to the presented keys: other keys answer bad-ticket and leave it unspent.
  assert.deepEqual(await answer(await h.call(registerRequest(verified.json.ticket, await deviceKeys()))), { status: 401, json: { error: 'bad-ticket' } });
  const registered = await answer(await h.call(registerRequest(verified.json.ticket, keys)));
  assert.equal(registered.status, 200);
  assert.deepEqual(devices(h), [{ owner: 1, pending: 0 }], 'one owner device');
  assert.equal(liveCodes(h), 0, 'the link is spent');
});

test('MEDIUM-1: a wrong password spends the fresh link and issues nothing', async () => {
  const h = harness();
  const { code } = await freshLink(h);
  const hash = h.db.sqlite.prepare('SELECT login_hash FROM account').get().login_hash;
  const digest = await keyDigestOf(await deviceKeys());
  assert.deepEqual(await answer(await h.call(verifyRequest(OWNER, code, digest, { password: 'not the owner password', ip: '192.0.2.40' }))),
    { status: 401, json: { error: 'bad-login' } });
  assert.equal(ownerTickets(h), 0, 'no owner ticket');
  assert.equal(liveCodes(h), 0, 'the link is spent');
  assert.deepEqual(await answer(await h.call(verifyRequest(OWNER, code, digest, { ip: '192.0.2.41' }))), { status: 401, json: { error: 'bad-code' } });
  assert.equal(ownerTickets(h), 0, 'the right password on the spent link issues nothing');
  assert.equal(h.db.sqlite.prepare('SELECT login_hash FROM account').get().login_hash, hash, 'the password is unchanged');
});

test('MEDIUM-1: a new owner ticket voids an older one still unspent', async () => {
  const h = harness();
  const first = await freshLink(h);
  // Verified late in the link's life, so its ticket outlives the link.
  h.clock.ms += SIGNUP_LIMITS.codeTtlMs - 60 * 1000;
  const oldKeys = await deviceKeys();
  const old = await answer(await h.call(verifyRequest(OWNER, first.code, await keyDigestOf(oldKeys), { ip: '192.0.2.40' })));
  assert.equal(old.status, 200);
  h.clock.ms += 60 * 1000; // the first fresh link has expired, its ticket has not
  const before = mailTo(h, OWNER).length;
  await start(h, OWNER, '192.0.2.50');
  const code = codeOf(mailTo(h, OWNER).slice(before).find((m) => m.text.includes(LINK_BASE)));
  const keys = await deviceKeys();
  const fresh = await answer(await h.call(verifyRequest(OWNER, code, await keyDigestOf(keys), { ip: '192.0.2.50' })));
  assert.equal(fresh.status, 200);
  assert.equal(ownerTickets(h), 1, 'one live owner ticket');
  assert.deepEqual(await answer(await h.call(registerRequest(old.json.ticket, oldKeys))), { status: 401, json: { error: 'bad-ticket' } });
  assert.equal((await h.call(registerRequest(fresh.json.ticket, keys))).status, 200);
  assert.deepEqual(devices(h), [{ owner: 1, pending: 0 }]);
});

test('MEDIUM-1 NEGATIVE CONTROL: the password alone still gets no ticket', async () => {
  const h = harness();
  const { keys } = await strandedAccount(h);
  pastSignupLink(h);
  const digest = await keyDigestOf(keys);
  assert.deepEqual(await answer(await h.call(signInRequest(OWNER, PASSWORD, '192.0.2.60', digest))), { status: 403, json: { error: 'no-owner-device' } });
  assert.deepEqual(await answer(await h.call(verifyRequest(OWNER, 'A'.repeat(22), digest, { ip: '192.0.2.61' }))), { status: 401, json: { error: 'bad-code' } });
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM ticket WHERE used = 0 AND expires_at > ?').get(h.clock.ms).n, 0, 'no live ticket of any kind');
  assert.deepEqual(devices(h), []);
});

test('MEDIUM-1 NEGATIVE CONTROL: a link for an account that has a device, a removed one included, issues nothing', async () => {
  for (const removed of [null, T0]) {
    const h = harness();
    const { code } = await freshLink(h);
    const account = h.db.sqlite.prepare('SELECT id FROM account').get().id;
    await addDevice(h.db, { id: 'dev-owner', account, removed });
    const res = await answer(await h.call(verifyRequest(OWNER, code, await keyDigestOf(await deviceKeys()), { ip: '192.0.2.40' })));
    assert.deepEqual(res, { status: 401, json: { error: 'bad-code' } }, `removed_at ${removed}`);
    assert.equal(ownerTickets(h), 0, 'no owner ticket');
    assert.equal(liveCodes(h), 0, 'the link is spent');
  }
});

test('MEDIUM-1 NEGATIVE CONTROL: two verifies of one fresh link together issue one ticket', async () => {
  const h = harness();
  const { code } = await freshLink(h);
  const [a, b] = await Promise.all([
    h.call(verifyRequest(OWNER, code, await keyDigestOf(await deviceKeys()), { ip: '192.0.2.70' })),
    h.call(verifyRequest(OWNER, code, await keyDigestOf(await deviceKeys()), { ip: '192.0.2.71' })),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 401]);
  assert.equal(ownerTickets(h), 1, 'one owner ticket');
});

// Item 3: an account whose owner registered the usual way, inside the
// ticket's life, meets this path exactly as before MEDIUM-1: the start answers
// ok and mails nothing, the owner's password with any code answers bad-code,
// no owner ticket is made and the password sign-in answers as it did.
test('MEDIUM-1 NEGATIVE CONTROL: an account with a registered owner device gets the same refusals as before', async () => {
  const h = harness();
  const account = await signUp(h, OWNER);
  assert.deepEqual(devices(h), [{ owner: 1, pending: 0 }]);
  pastSignupLink(h);
  const digest = await keyDigestOf(await deviceKeys());
  const signinBefore = await answer(await h.call(signInRequest(OWNER, PASSWORD, '192.0.2.80', digest)));
  const before = h.mail.length;
  assert.deepEqual(await answer(await start(h, OWNER, '192.0.2.81')), { status: 200, json: { ok: true } });
  assert.equal(h.mail.length, before, 'nothing mailed');
  assert.equal(liveCodes(h), 0, 'no live link');
  assert.deepEqual(await answer(await h.call(verifyRequest(OWNER, 'A'.repeat(22), digest, { ip: '192.0.2.82' }))), { status: 401, json: { error: 'bad-code' } });
  assert.equal(ownerTickets(h), 0, 'no owner ticket');
  const signinAfter = await answer(await h.call(signInRequest(OWNER, PASSWORD, '192.0.2.83', digest)));
  assert.equal(signinAfter.status, signinBefore.status);
  assert.deepEqual(Object.keys(signinAfter.json).sort(), Object.keys(signinBefore.json).sort());
  assert.deepEqual(devices(h), [{ owner: 1, pending: 0 }], 'the owner device is unchanged');
  assert.equal(h.db.sqlite.prepare('SELECT id FROM account').get().id, account);
});

// The #248 LOW race, closed in A6. An owner ticket was spent by one statement
// and its device written by the next, so a second owner ticket (a relink's,
// voiding nothing the first had already spent) could register between the
// two: both spends saw an account with no device, and the account ended with
// two owner devices. The owner device's row is now written only while the
// account still has no device, in the insert itself.
const SPEND_TICKET = 'UPDATE ticket SET used = 1 WHERE digest';
const ownerCount = (h) => h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM device WHERE owner = 1').get().n;

test('#248 LOW: an owner device that lands while another owner ticket is being spent leaves one owner device', async () => {
  const h = harness();
  const keys = await deviceKeys();
  await start(h, OWNER);
  const verified = await answer(await h.call(verifyRequest(OWNER, codeOf(mailTo(h, OWNER).at(-1)), await keyDigestOf(keys))));
  assert.equal(verified.status, 200);
  const account = h.db.sqlite.prepare('SELECT id FROM account').get().id;
  landsMidFlight(h, SPEND_TICKET, (db) => {
    db.sqlite.prepare('INSERT INTO device (id, account_id, sign_key, created_at, pending, owner, confirmed_at) VALUES (?, ?, ?, ?, 0, 1, ?)')
      .run('dev-other-owner', account, 'AAAA', h.clock.ms, h.clock.ms);
  });
  assert.deepEqual(await answer(await h.call(registerRequest(verified.json.ticket, keys))), { status: 401, json: { error: 'bad-ticket' } });
  assert.equal(ownerCount(h), 1, 'one owner device');
});

test('#248 LOW NEGATIVE CONTROL: a further device registers while another device lands', async () => {
  const h = harness();
  await signUp(h, OWNER);
  const keys = await deviceKeys();
  const ticket = await signIn(h, OWNER, { keys, ip: '192.0.2.41' });
  const account = h.db.sqlite.prepare('SELECT id FROM account').get().id;
  landsMidFlight(h, SPEND_TICKET, (db) => {
    db.sqlite.prepare('INSERT INTO device (id, account_id, sign_key, created_at, pending, owner) VALUES (?, ?, ?, ?, 1, 0)').run('dev-landed', account, 'AAAA', h.clock.ms);
  });
  assert.equal((await h.call(registerRequest(ticket, keys))).status, 200);
  assert.equal(ownerCount(h), 1);
});
