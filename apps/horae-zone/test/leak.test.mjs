// The service may hold identities and sealed values, but nothing a request
// carries may come back out, land in the audit table, or be logged. Canaries
// ride in bodies, headers and paths to every route, signed and unsigned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROUTES } from '../src/routes.js';
import { createHandler } from '../src/index.js';
import { harness, addDevice, makeAdmin, post, signed, everyRow, signUp, signInRequest, deviceKeys, registerRequest, ROOT } from './helpers.mjs';

// Fixed, fake test values: a body marker, a 6-digit code, a base32 seed, a
// PIN and an address on a reserved domain.
const CANARIES = ['CANARY-body-7f3e', '482913', 'JBSWY3DPEHPK3PXPCANARY', '820374', 'canary@example.test'];
const BODY = { note: CANARIES[0], code: CANARIES[1], seed: CANARIES[2], pin: CANARIES[3], email: CANARIES[4] };

function captureConsole(t) {
  const lines = [];
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) t.mock.method(console, k, (...a) => { lines.push(a.map(String).join(' ')); });
  return lines;
}

async function everything(res) {
  return `${res.status} ${[...res.headers].flat().join(' ')} ${await res.text()}`;
}

function assertClean(text, where) {
  for (const c of CANARIES) assert.equal(String(text).includes(c), false, `${where} carries a canary`);
}

async function sweep(h, dev) {
  const seen = [];
  for (const p of Object.keys(ROUTES)) {
    seen.push(await everything(await h.call(post(p, BODY, { 'x-hz-device': CANARIES[4], 'x-hz-nonce': CANARIES[1], 'x-hz-sig': CANARIES[2] }))));
    seen.push(await everything(await h.call(await signed(h.call, dev, p, BODY))));
  }
  seen.push(await everything(await h.call(post(`/${CANARIES[0]}/${CANARIES[4]}`, BODY))));
  seen.push(await everything(await h.call(post('/signin', `{"pin":"${CANARIES[3]}"`))));
  return seen;
}

test('no route or audit row carries a body, code, seed, PIN or email text', async (t) => {
  const logs = captureConsole(t);
  const h = harness();
  const dev = await addDevice(h.db);
  makeAdmin(h.db, dev.account);
  for (const text of await sweep(h, dev)) assertClean(text, 'a response');
  assertClean(JSON.stringify(h.db.sqlite.prepare('SELECT * FROM audit').all()), 'the audit table');
  assertClean(JSON.stringify(h.db.bound.map((b) => b.values)), 'a bound statement');
  assertClean(logs.join('\n'), 'console output');
});

// A3: a real sign-up, so the address, the code and the password reach the
// code paths that hash, seal and mail them. The mail sink is the one place
// the address and code may appear.
test('a sign-up leaves no address, email code or password in any answer, table, bound value or log', async (t) => {
  const logs = captureConsole(t);
  const h = harness();
  const address = 'leak-canary@example.test';
  const password = 'CANARY-password-9c1d-long';
  const seen = [];
  const send = async (p, body) => { seen.push(await everything(await h.call(post(p, body, { 'cf-connecting-ip': '192.0.2.50' })))); };
  await send('/account', { email: address });
  const code = new URL(h.mail[0].text.match(/https:\/\/\S+/)[0]).hash.slice(1);
  await send('/account/email/verify', { email: address, code: code === '000000' ? '000001' : '000000', password });
  await send('/account/email/verify', { email: address, code, password });
  await send('/account', { email: address });
  await send('/account/email/verify', { email: address, code, password });
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM account').get().n, 1, 'the sign-up went through');
  const dump = `${JSON.stringify(h.db.sqlite.prepare('SELECT * FROM audit').all())}${JSON.stringify(h.db.bound.map((b) => b.values))}`;
  // The code is matched as a whole number, so it is not found inside a
  // 13-digit timestamp that happens to hold the same 6 digits.
  for (const value of [address, new RegExp(`(?<![0-9])${code}(?![0-9])`), password]) {
    const carries = (text) => (typeof value === 'string' ? text.includes(value) : value.test(text));
    for (const text of seen) assert.equal(carries(text), false, 'a response carries a sign-up value');
    assert.equal(carries(dump), false, 'the audit table or a bound statement carries a sign-up value');
    assert.equal(carries(logs.join('\n')), false, 'console output carries a sign-up value');
  }
});

// A4: a real sign-in, registration and removal, so the address, the
// password and the ticket reach the code paths that check, hash and spend
// them. The ticket may appear in the one answer that hands it out, and
// nowhere else.
test('sign-in, register and remove leave no address, password or ticket in any answer, table, bound value or log', async (t) => {
  const logs = captureConsole(t);
  const h = harness();
  const address = 'leak-canary-device@example.test';
  const password = 'CANARY-password-a4-long-enough';
  await signUp(h, address, { password });
  const seen = [];
  const keep = async (req) => {
    const res = await h.call(req);
    seen.push(await everything(res.clone()));
    return res;
  };
  await keep(signInRequest(address, `${password}-wrong`));
  await keep(signInRequest('no-account-canary@example.test', password));
  const handed = await keep(signInRequest(address, password));
  const handout = seen.pop();
  const { ticket } = await handed.json();
  assert.ok(handout.includes(ticket), 'NEGATIVE CONTROL: the sign-in answer carries the ticket');
  const keys = await deviceKeys();
  await keep(post('/device/register', { ticket, signKey: 'off', agreeKey: keys.agreeKey }));
  const { device } = await (await keep(registerRequest(ticket, keys))).json();
  await keep(registerRequest(ticket, keys));
  await keep(await signed(h.call, { id: device, key: keys.key }, '/device/remove', { device }));
  const stored = `${everyRow(h.db)}${JSON.stringify(h.db.bound.map((b) => b.values))}`;
  for (const value of [address, password, ticket]) {
    for (const text of seen) assert.equal(text.includes(value), false, 'an answer carries a sign-in value');
    assert.equal(stored.includes(value), false, 'a table or a bound statement carries a sign-in value');
    assert.equal(logs.join('\n').includes(value), false, 'console output carries a sign-in value');
  }
});

test('NEGATIVE CONTROL: the canary check catches a planted echo', async () => {
  const routes = { ...ROUTES, '/echo': { checks: 'open', handler: async ({ body }) => ({ status: 200, json: body }) } };
  const h = harness();
  const res = await createHandler({ now: () => 0, routes })(post('/echo', BODY), { DB: h.db });
  const text = await everything(res);
  assert.throws(() => assertClean(text, 'echo'), /carries a canary/);
});

test('src/ has no console call', () => {
  for (const f of readdirSync(path.join(ROOT, 'src'))) {
    assert.doesNotMatch(readFileSync(path.join(ROOT, 'src', f), 'utf8'), /\bconsole\./, f);
  }
});
