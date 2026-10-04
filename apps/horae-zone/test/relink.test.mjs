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
  harness, post, deviceKeys, keyDigestOf, registerRequest, signInRequest, addDevice, PASSWORD, LINK_BASE, T0,
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
