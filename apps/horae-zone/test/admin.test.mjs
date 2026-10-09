// A5c, the administrator's routes (plan §3.4 "Admin", §3.6 "/admin/*").
//
//   /admin/status         {email} -> {locked, lockedAt, codeClosed, pinClosed, devices}
//   /admin/unlock-pins    {email} -> {ok: true}
//   /admin/unlock-account {email} -> {unlocked: true|false}
//
// Every admin route is signed by a confirmed device whose account holds the
// admin role. The account acted on is the one the address names; the address
// is never stored, echoed, bound or audited, only its keyed hash looked up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROUTES } from '../src/routes.js';
import { REVERIFY_LIMITS } from '../src/reverify.js';
import {
  harness, addDevice, makeAdmin, post, signed, auditRows, everyRow, registeredDevice, pinCall, pinnedDevice, wrongCodeAt, tryCode,
} from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses and PINs with no run of
// three that are not on the public fixture list.
const ADDRESS = 'admin-target@example.test';
const OTHER = 'admin-other@example.test';
const FIRST = '274951';
const SECOND = '385062';
const THIRD = '496173';
const ADMIN_ROUTES = Object.keys(ROUTES).filter((p) => p.startsWith('/admin/'));
const LOCKED = { status: 423, json: { error: 'account-locked' } };

async function answerOf(res) {
  return { status: res.status, json: await res.json() };
}

// A confirmed device of an account that holds the admin role, written
// straight into the tables, as test/checks.test.mjs does.
async function adminDevice(h, { id = 'admin-dev', account = 'admin-acct' } = {}) {
  const dev = await addDevice(h.db, { id, account });
  makeAdmin(h.db, account);
  return dev;
}

const adminCall = async (h, dev, pathname, body) => answerOf(await h.call(await signed(h.call, dev, pathname, body)));
const lockRows = (h, account) => h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM pin_lock WHERE account_id = ?').get(account).n;
const accountLockRow = (h, account) => h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM account_lock WHERE account_id = ?').get(account).n;

// A target account with its PIN changed twice, so two replaced PINs are
// locked for reuse.
async function twiceChanged(h, email = ADDRESS) {
  const dev = await pinnedDevice(h, email, FIRST);
  assert.equal((await pinCall(h, dev, '/pin/set', { pin: SECOND, current: FIRST })).status, 200);
  assert.equal((await pinCall(h, dev, '/pin/set', { pin: THIRD, current: SECOND })).status, 200);
  assert.equal(lockRows(h, dev.account), 2, 'two replaced PINs are locked');
  return dev;
}

// ---- the plan tests ----

test('admin routes refuse a non-admin', async () => {
  const h = harness();
  const target = await twiceChanged(h);
  assert.deepEqual(await pinCall(h, target, '/pin/blocked', {}), LOCKED);
  const outsider = await addDevice(h.db, { id: 'outsider-dev', account: 'outsider-acct' });
  assert.deepEqual(ADMIN_ROUTES.sort(), ['/admin/status', '/admin/unlock-account', '/admin/unlock-pins']);

  for (const p of ADMIN_ROUTES) {
    const refused = await adminCall(h, outsider, p, { email: ADDRESS });
    assert.deepEqual(refused, { status: 403, json: { error: 'not-admin' } }, `${p} from a device of an account with no role`);
    assert.equal((await h.call(post(p, { email: ADDRESS }))).status, 401, `${p} unsigned`);
  }
  assert.equal(lockRows(h, target.account), 2, 'no PIN lock was cleared');
  assert.equal(accountLockRow(h, target.account), 1, 'the account is still locked');

  // A pending device of an admin account is no admin yet.
  const admin = await adminDevice(h);
  const pending = await addDevice(h.db, { id: 'admin-pending', account: 'admin-acct', pending: 1 });
  assert.deepEqual(await adminCall(h, pending, '/admin/unlock-account', { email: ADDRESS }), { status: 401, json: { error: 'no-device' } });
  assert.equal(accountLockRow(h, target.account), 1);

  // A role for another word is not the admin role.
  h.db.sqlite.prepare('INSERT INTO role (account_id, role) VALUES (?, ?)').run('outsider-acct', 'viewer');
  assert.deepEqual(await adminCall(h, outsider, '/admin/unlock-account', { email: ADDRESS }), { status: 403, json: { error: 'not-admin' } });

  // NEGATIVE CONTROL: the same request from an admin's device is answered.
  assert.deepEqual(await adminCall(h, admin, '/admin/unlock-account', { email: ADDRESS }), { status: 200, json: { unlocked: true } });
});

test('unlocking PINs clears the rows and its response names no PIN', async () => {
  const h = harness();
  const target = await twiceChanged(h);
  const bystander = await twiceChanged(h, OTHER);
  const admin = await adminDevice(h);
  assert.deepEqual(await pinCall(h, target, '/pin/set', { pin: FIRST, current: THIRD }), { status: 409, json: { error: 'pin-reused', message: 'That PIN is locked for reuse.' } },
    'NEGATIVE CONTROL: before the unlock the first PIN is locked for reuse');

  const res = await h.call(await signed(h.call, admin, '/admin/unlock-pins', { email: ADDRESS }));
  const text = await res.clone().text();
  assert.deepEqual(await answerOf(res), { status: 200, json: { ok: true } });
  assert.equal(lockRows(h, target.account), 0, 'every lock row of the account is gone');
  assert.equal(lockRows(h, bystander.account), 2, 'another account keeps its locks');

  // The answer names no PIN, verifier, salt, count, date or duration.
  for (const pin of [FIRST, SECOND, THIRD]) assert.equal(text.includes(pin), false, 'the answer carries a PIN');
  const pin = h.db.sqlite.prepare('SELECT verifier, salt, set_at FROM pin WHERE account_id = ?').get(target.account);
  for (const value of [pin.verifier, pin.salt, String(pin.set_at)]) assert.equal(text.includes(value), false, 'the answer carries a PIN value');
  assert.doesNotMatch(text, /\d/, 'no number of any kind: no count, date or duration');

  // A replaced PIN may be chosen again, and the PIN in use is untouched.
  assert.equal((await pinCall(h, target, '/pin/verify', { pin: THIRD })).status, 200, 'the PIN in use still opens');
  assert.equal((await pinCall(h, target, '/pin/set', { pin: FIRST, current: THIRD })).status, 200, 'the first PIN is free again');
});

// ---- what else the admin routes do ----

test('unlocking PINs answers the same whether any PIN was locked, and reads no lock row', async () => {
  const h = harness();
  const target = await pinnedDevice(h, ADDRESS, FIRST);
  const admin = await adminDevice(h);
  assert.equal(lockRows(h, target.account), 0);
  assert.deepEqual(await adminCall(h, admin, '/admin/unlock-pins', { email: ADDRESS }), { status: 200, json: { ok: true } }, 'double blind: no locks, the same answer');
  const reads = h.db.bound.filter((b) => /pin_lock/.test(b.sql) && !/^\s*DELETE/i.test(b.sql) && /SELECT/i.test(b.sql) && !/INSERT/i.test(b.sql));
  assert.deepEqual(reads, [], 'no statement read a lock row');
  const deletes = h.db.bound.filter((b) => /DELETE FROM pin_lock/.test(b.sql));
  assert.equal(deletes.length, 1);
  assert.doesNotMatch(deletes[0].sql, /RETURNING/, 'the delete hands back nothing');
});

test('unlocking an account clears the offline block, and says whether it was locked', async () => {
  const h = harness();
  const target = await pinnedDevice(h, ADDRESS, FIRST);
  const admin = await adminDevice(h);
  assert.deepEqual(await adminCall(h, admin, '/admin/unlock-account', { email: ADDRESS }), { status: 200, json: { unlocked: false } }, 'an account not locked');

  assert.deepEqual(await pinCall(h, target, '/pin/blocked', {}), LOCKED);
  assert.deepEqual(await pinCall(h, target, '/pin/verify', { pin: FIRST }), LOCKED);
  assert.deepEqual(await adminCall(h, admin, '/admin/unlock-account', { email: ADDRESS }), { status: 200, json: { unlocked: true } });
  assert.equal((await pinCall(h, target, '/pin/verify', { pin: FIRST })).status, 200, 'unlocked, the PIN opens again');
  assert.deepEqual(await adminCall(h, admin, '/admin/unlock-account', { email: ADDRESS }), { status: 200, json: { unlocked: false } }, 'a second unlock finds nothing to do');
});

test('an admin of a locked account cannot use the admin routes: another admin unlocks it', async () => {
  const h = harness();
  const target = await pinnedDevice(h, ADDRESS, FIRST);
  makeAdmin(h.db, target.account);
  assert.deepEqual(await pinCall(h, target, '/pin/blocked', {}), LOCKED);
  for (const p of ADMIN_ROUTES) assert.deepEqual(await adminCall(h, target, p, { email: ADDRESS }), LOCKED, p);
  const other = await adminDevice(h);
  assert.deepEqual(await adminCall(h, other, '/admin/unlock-account', { email: ADDRESS }), { status: 200, json: { unlocked: true } });
  assert.equal((await adminCall(h, target, '/admin/status', { email: ADDRESS })).status, 200);
});

test('the status shows access, reverification and revocations, and nothing of the PIN locks', async () => {
  const h = harness();
  const target = await twiceChanged(h);
  const second = await registeredDevice(h, ADDRESS, { fresh: false });
  const admin = await adminDevice(h);
  const createdOwner = h.db.sqlite.prepare('SELECT created_at, confirmed_at FROM device WHERE id = ?').get(target.id);
  const createdSecond = h.db.sqlite.prepare('SELECT created_at FROM device WHERE id = ?').get(second.id).created_at;

  assert.deepEqual(await pinCall(h, target, '/reverify', {}), { status: 200, json: { ok: true } });
  const reverifiedAt = h.clock.ms;
  // A removal stamped straight into the row, so this test does not depend on
  // what proof /device/remove asks for.
  h.clock.ms += REVERIFY_LIMITS.everyMs;
  const removedAt = h.clock.ms;
  h.db.sqlite.prepare('UPDATE device SET removed_at = ? WHERE id = ?').run(removedAt, second.id);

  const first = await adminCall(h, admin, '/admin/status', { email: ADDRESS });
  assert.equal(first.status, 200);
  assert.deepEqual(first.json, {
    locked: false,
    lockedAt: null,
    codeClosed: false,
    pinClosed: false,
    devices: [
      { device: target.id, owner: true, pending: false, createdAt: createdOwner.created_at, confirmedAt: createdOwner.confirmed_at, removedAt: null, reverifiedAt },
      { device: second.id, owner: false, pending: true, createdAt: createdSecond, confirmedAt: null, removedAt, reverifiedAt: null },
    ],
  });

  // The offline block and a closed code path show; no PIN lock ever does.
  for (let w = 0; w < 2; w += 1) {
    h.clock.ms += 30_000;
    for (let i = 0; i < 3; i += 1) await tryCode(h, target, await wrongCodeAt(target, h.clock.ms));
  }
  assert.deepEqual(await pinCall(h, target, '/pin/blocked', {}), LOCKED);
  const lockedAt = h.clock.ms;
  const later = await adminCall(h, admin, '/admin/status', { email: ADDRESS });
  assert.equal(later.json.locked, true);
  assert.equal(later.json.lockedAt, lockedAt);
  assert.equal(later.json.codeClosed, true);
  assert.equal(later.json.pinClosed, false);
  const text = JSON.stringify(later.json);
  for (const word of ['pin_lock', 'locked_until', 'verifier', 'salt', 'reuse']) assert.equal(text.includes(word), false, `the status carries ${word}`);
  for (const pin of [FIRST, SECOND, THIRD]) assert.equal(text.includes(pin), false, 'the status carries a PIN');
});

test('the account acted on is the one the address names: another address, a bad shape or an unknown address', async () => {
  const h = harness();
  const target = await pinnedDevice(h, ADDRESS, FIRST);
  const bystander = await pinnedDevice(h, OTHER, FIRST);
  const admin = await adminDevice(h);
  for (const d of [target, bystander]) assert.deepEqual(await pinCall(h, d, '/pin/blocked', {}), LOCKED);

  assert.deepEqual(await adminCall(h, admin, '/admin/unlock-account', { email: 'ADMIN-Target@Example.TEST' }), { status: 200, json: { unlocked: true } },
    'the address is matched as sign-up files it, case aside');
  assert.equal(accountLockRow(h, target.account), 0);
  assert.equal(accountLockRow(h, bystander.account), 1, 'another account stays locked');

  for (const p of ADMIN_ROUTES) {
    for (const body of [{}, { email: 'not an address' }, { email: ADDRESS, account: bystander.account }, { account: bystander.account }]) {
      assert.deepEqual(await adminCall(h, admin, p, body), { status: 400, json: { error: 'shape' } }, `${p} ${JSON.stringify(body)}`);
    }
    assert.deepEqual(await adminCall(h, admin, p, { email: 'nobody@example.test' }), { status: 404, json: { error: 'no-account' } }, `${p} unknown address`);
  }
  assert.equal(accountLockRow(h, bystander.account), 1, 'no refused request touched it');
});

test('without the account key the admin routes answer unavailable and change nothing', async () => {
  const h = harness({ env: { HZ_ACCOUNT_KEY: undefined } });
  const admin = await adminDevice(h);
  for (const p of ADMIN_ROUTES) assert.deepEqual(await adminCall(h, admin, p, { email: ADDRESS }), { status: 503, json: { error: 'unavailable' } }, p);
});

test('every admin act writes one audit row of route and outcome word, and no address', async () => {
  const h = harness();
  const target = await pinnedDevice(h, ADDRESS, FIRST);
  const admin = await adminDevice(h);
  assert.deepEqual(await pinCall(h, target, '/pin/blocked', {}), LOCKED);
  const before = auditRows(h.db).length;
  await adminCall(h, admin, '/admin/status', { email: ADDRESS });
  await adminCall(h, admin, '/admin/unlock-pins', { email: ADDRESS });
  await adminCall(h, admin, '/admin/unlock-account', { email: ADDRESS });
  await adminCall(h, admin, '/admin/unlock-account', { email: ADDRESS });
  await adminCall(h, admin, '/admin/unlock-account', { email: 'nobody@example.test' });
  const rows = auditRows(h.db).slice(before).filter((r) => r.route !== '/nonce');
  assert.deepEqual(rows, [
    { route: '/admin/status', reason: 'ok' },
    { route: '/admin/unlock-pins', reason: 'ok' },
    { route: '/admin/unlock-account', reason: 'unlocked' },
    { route: '/admin/unlock-account', reason: 'not-locked' },
    { route: '/admin/unlock-account', reason: 'no-account' },
  ]);
  const dump = `${everyRow(h.db)}${JSON.stringify(h.db.bound.map((b) => b.values))}`;
  for (const value of [ADDRESS, 'nobody@example.test']) assert.equal(dump.includes(value), false, 'a table or a bound statement carries an address');
});
