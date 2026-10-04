import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '../src/routes.js';
import { NONCE_TTL_MS, MAX_BODY_BYTES } from '../src/checks.js';
import { harness, addDevice, makeAdmin, post, nonceFor, signed, auditRows, ORIGIN } from './helpers.mjs';

const byCheck = (kind) => Object.entries(ROUTES).filter(([, r]) => r.checks === kind).map(([p]) => p);
const SIGNED = [...byCheck('signed'), ...byCheck('admin')];

async function reason(res) {
  return (await res.json()).error;
}

test('the route table names the plan routes and every one declares its checks', () => {
  for (const p of ['/account', '/account/email/verify', '/signin', '/device/register', '/device/remove', '/otp/enrol',
    '/unlock/start', '/unlock/finish', '/unlock/reopen', '/pin/verify', '/pin/set', '/pin/reset', '/pin/review',
    '/reverify', '/pair/offer', '/pair/take', '/recover', '/vault/switch', '/admin/unlock-pins', '/admin/unlock-account', '/nonce']) {
    assert.ok(ROUTES[p], p);
  }
  for (const [p, r] of Object.entries(ROUTES)) assert.ok(['open', 'device', 'signed', 'admin'].includes(r.checks), p);
  assert.ok(byCheck('admin').every((p) => p.startsWith('/admin/')));
  assert.ok(Object.keys(ROUTES).filter((p) => p.startsWith('/admin/')).every((p) => ROUTES[p].checks === 'admin'));
});

test('no route answers without its checks', async () => {
  const h = harness();
  const dev = await addDevice(h.db);
  for (const p of SIGNED) {
    assert.equal(await reason(await h.call(post(p))), 'no-device', `${p} unsigned`);
    const wrong = await signed(h.call, dev, p, { a: 1 }, { tamper: { body: '{"a":2}' } });
    assert.equal(await reason(await h.call(wrong)), 'bad-signature', `${p} wrong signature`);
    const n = await nonceFor(h.call, dev);
    assert.equal((await h.call(await signed(h.call, dev, p, {}, { nonce: n }))).status === 401, false, `${p} fresh`);
    assert.equal(await reason(await h.call(await signed(h.call, dev, p, {}, { nonce: n }))), 'stale-nonce', `${p} reused nonce`);
  }
  assert.equal(await reason(await h.call(post('/nonce'))), 'no-device');
});

test('NEGATIVE CONTROL: a correctly signed request with a fresh nonce passes the checks', async () => {
  const h = harness();
  const dev = await addDevice(h.db);
  const res = await h.call(await signed(h.call, dev, '/reverify', { x: 1 }));
  assert.equal(res.status, 501);
  assert.equal(await reason(res), 'not-built');
});

test('a DER signature and a raw signature verify alike', async () => {
  const h = harness();
  const dev = await addDevice(h.db);
  assert.equal(await reason(await h.call(await signed(h.call, dev, '/reverify', {}, { der: true }))), 'not-built');
  assert.equal(await reason(await h.call(await signed(h.call, dev, '/reverify', {}))), 'not-built');
});

test('a signature for another path is refused', async () => {
  const h = harness();
  const dev = await addDevice(h.db);
  const req = await signed(h.call, dev, '/reverify', {}, { tamper: { path: '/pin/verify' } });
  assert.equal(await reason(await h.call(req)), 'bad-signature');
});

test('a nonce expires, and belongs to the device it was issued to', async () => {
  const h = harness();
  const dev = await addDevice(h.db);
  const other = await addDevice(h.db, { id: 'dev-2' });
  const n = await nonceFor(h.call, dev);
  assert.equal(await reason(await h.call(await signed(h.call, other, '/reverify', {}, { nonce: n }))), 'stale-nonce');
  const late = await nonceFor(h.call, dev);
  h.clock.ms += NONCE_TTL_MS + 1;
  assert.equal(await reason(await h.call(await signed(h.call, dev, '/reverify', {}, { nonce: late }))), 'stale-nonce');
});

test('a removed device is refused', async () => {
  const h = harness();
  const dev = await addDevice(h.db, { removed: 1 });
  assert.equal(await reason(await h.call(post('/nonce', {}, { 'x-hz-device': dev.id }))), 'no-device');
});

test('admin routes refuse a device whose account is not an admin', async () => {
  const h = harness();
  const dev = await addDevice(h.db);
  assert.equal(await reason(await h.call(await signed(h.call, dev, '/admin/unlock-pins', {}))), 'not-admin');
  makeAdmin(h.db, dev.account);
  assert.equal(await reason(await h.call(await signed(h.call, dev, '/admin/unlock-pins', {}))), 'not-built');
});

test('open routes take a JSON object and answer not-built until their slice lands', async () => {
  const h = harness();
  const unbuilt = byCheck('open').filter((p) => !ROUTES[p].handler);
  assert.ok(unbuilt.length > 0);
  for (const p of unbuilt) assert.equal(await reason(await h.call(post(p, {}))), 'not-built', p);
});

test('anything but a POST of a JSON object under the size cap is refused', async () => {
  const h = harness();
  const cases = [
    [new Request(`${ORIGIN}/signin`, { method: 'GET' }), 'method', 405],
    [new Request(`${ORIGIN}/signin`, { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } }), 'shape', 400],
    [post('/signin', 'not json'), 'shape', 400],
    [post('/signin', '[1,2]'), 'shape', 400],
    [post('/signin', 'null'), 'shape', 400],
    [post('/signin', JSON.stringify({ pad: 'x'.repeat(MAX_BODY_BYTES) })), 'too-large', 413],
  ];
  for (const [req, word, status] of cases) {
    const res = await h.call(req);
    assert.equal(res.status, status, word);
    assert.equal(await reason(res), word);
  }
});

test('a request with a query string is refused as shape before any check or handler', async () => {
  const h = harness();
  const dev = await addDevice(h.db);
  for (const p of ['/signin?x=1', '/account?email=a%40example.test', '/nonce?n=1', '/reverify?code=482913']) {
    const res = await h.call(post(p, {}, { 'x-hz-device': dev.id }));
    assert.equal(res.status, 400, p);
    assert.equal(await reason(res), 'shape', p);
  }
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM nonce').get().n, 0, 'no nonce was issued');
  assert.equal(JSON.stringify(auditRows(h.db)).includes('482913'), false);
});

test('an unknown path is refused as no-route and audited as unknown', async () => {
  const h = harness();
  const res = await h.call(post('/nope/../../etc'));
  assert.equal(res.status, 404);
  assert.equal(await reason(res), 'no-route');
  assert.deepEqual(auditRows(h.db).at(-1), { route: 'unknown', reason: 'no-route' });
});

test('every request writes one audit row of route and reason', async () => {
  const h = harness();
  const dev = await addDevice(h.db);
  await h.call(post('/reverify'));
  await h.call(await signed(h.call, dev, '/reverify', {}));
  assert.deepEqual(auditRows(h.db), [
    { route: '/reverify', reason: 'no-device' },
    { route: '/nonce', reason: 'ok' },
    { route: '/reverify', reason: 'not-built' },
  ]);
});

test('with no database bound the service answers unavailable', async () => {
  const { createHandler } = await import('../src/index.js');
  const res = await createHandler({ now: () => 0 })(post('/signin'), {});
  assert.equal(res.status, 503);
  assert.equal(await reason(res), 'unavailable');
});

test('every answer is JSON and never cached', async () => {
  const h = harness();
  const res = await h.call(post('/signin'));
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});
