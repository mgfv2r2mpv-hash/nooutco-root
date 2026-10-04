// The mail transport moved from JanusMirror's gatekeeper/src/mailer.mjs (the
// two transport tests are ported from its pairing-limits.test.mjs). The engine
// copy holds no address and reads no Keychain: the caller names the sender,
// the recipient and how the key is read, and the fetch is injected so no test
// sends mail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMailer, fragmentLink, RESEND_URL } from '../src/mailer.mjs';

// Fixed, fake values on reserved domains.
const FROM = 'Test Sender <sender@example.test>';
const TO = 'someone@example.test';
const KEY = 'fake-key-CANARY';
const MESSAGE = { to: TO, subject: 'Test subject', text: 'Test text CANARY-text' };

function recorder(answer = { ok: true, status: 200 }) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return answer; };
  return { calls, fetchImpl };
}

test('the mailer sends through Resend with the key in the header only', async () => {
  const { calls, fetchImpl } = recorder();
  const send = createMailer({ from: FROM, readKey: async () => KEY, fetchImpl });
  assert.equal(await send(MESSAGE), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, RESEND_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { from: FROM, to: [TO], subject: MESSAGE.subject, text: MESSAGE.text });
  assert.equal(calls[0].init.body.includes(KEY), false);
});

test('a failed send is logged without the key, the address or the text and does not throw', async () => {
  const logs = [];
  const log = (m) => logs.push(m);
  const refused = createMailer({ from: FROM, readKey: async () => KEY, fetchImpl: recorder({ ok: false, status: 401 }).fetchImpl, log });
  assert.equal(await refused(MESSAGE), false);
  const noKey = createMailer({ from: FROM, readKey: async () => { throw new Error(`no key ${KEY}`); }, fetchImpl: recorder().fetchImpl, log });
  assert.equal(await noKey(MESSAGE), false);
  const thrown = createMailer({ from: FROM, readKey: async () => KEY, fetchImpl: async () => { throw new Error(`down ${TO}`); }, log });
  assert.equal(await thrown(MESSAGE), false);
  assert.equal(logs.length, 3);
  for (const line of logs) {
    for (const value of [KEY, TO, 'CANARY-text', 'sender@example.test']) assert.equal(line.includes(value), false, `a log line carries ${value}`);
  }
});

test('NEGATIVE CONTROL: a send that succeeds logs nothing', async () => {
  const logs = [];
  const send = createMailer({ from: FROM, readKey: async () => KEY, fetchImpl: recorder().fetchImpl, log: (m) => logs.push(m) });
  assert.equal(await send(MESSAGE), true);
  assert.deepEqual(logs, []);
});

test('a message without a recipient, subject or text is not sent', async () => {
  const { calls, fetchImpl } = recorder();
  const send = createMailer({ from: FROM, readKey: async () => KEY, fetchImpl });
  for (const bad of [{ ...MESSAGE, to: '' }, { ...MESSAGE, subject: undefined }, { ...MESSAGE, text: 7 }, null]) {
    assert.equal(await send(bad), false);
  }
  assert.equal(calls.length, 0);
});

test('the mailer cannot be built without a sender or a way to read the key', () => {
  assert.throws(() => createMailer({ readKey: async () => KEY }), /mailer: from/);
  assert.throws(() => createMailer({ from: FROM }), /mailer: readKey/);
});

test('a link carries its token only in the fragment', () => {
  const link = fragmentLink('https://service.example.test/verify', 'TOKEN-CANARY');
  const url = new URL(link);
  assert.equal(url.search, '');
  assert.equal(url.hash, '#TOKEN-CANARY');
  assert.equal(`${url.origin}${url.pathname}`.includes('TOKEN-CANARY'), false);
});

test('a link base that already has a query or a fragment, or is not https, is refused', () => {
  for (const base of ['https://service.example.test/verify?x=1', 'https://service.example.test/verify#x', 'http://service.example.test/verify', 'not a url']) {
    assert.throws(() => fragmentLink(base, 'TOKEN'), /link base/, base);
  }
  assert.throws(() => fragmentLink('https://service.example.test/verify', 'has space'), /link token/);
});
