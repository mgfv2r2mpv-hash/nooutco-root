// The service may hold identities and sealed values, but nothing a request
// carries may come back out, land in the audit table, or be logged. Canaries
// ride in bodies, headers and paths to every route, signed and unsigned.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROUTES } from '../src/routes.js';
import { createHandler } from '../src/index.js';
import { harness, addDevice, makeAdmin, post, signed, ROOT } from './helpers.mjs';

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
