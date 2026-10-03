// Retention (owner left it to the agent, 2026-10-03: "Whatever is the balance
// of best but not overdone"): audit rows are kept 6 years, the HIPAA
// documentation retention period; spent or expired nonces are purged hourly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import worker from '../src/index.js';
import { RETENTION, auditCutoff, purgeExpired } from '../src/retention.js';
import { NONCE_TTL_MS } from '../src/checks.js';
import { harness, addDevice, nonceFor, signed, ROOT, T0 } from './helpers.mjs';

const TOML = readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
const nonces = (db) => db.sqlite.prepare('SELECT value, used FROM nonce ORDER BY value').all().map((r) => ({ ...r }));
const auditTimes = (db) => db.sqlite.prepare('SELECT at FROM audit ORDER BY at').all().map((r) => r.at);
const addAudit = (db, at) => db.sqlite.prepare("INSERT INTO audit (at, route, reason) VALUES (?, '/signin', 'ok')").run(at);
const addNonce = (db, value, expiresAt, used = 0) => db.sqlite.prepare('INSERT INTO nonce (value, device_id, expires_at, used) VALUES (?, ?, ?, ?)').run(value, 'dev-1', expiresAt, used);

test('the defaults: audit rows kept 6 years, nonces purged every hour', () => {
  assert.equal(RETENTION.auditYears, 6);
  assert.equal(RETENTION.purgeCron, '0 * * * *');
  assert.ok(Object.isFrozen(RETENTION));
});

test('wrangler.toml schedules the purge on the configured cron, and only that', () => {
  const crons = [...TOML.matchAll(/^crons\s*=\s*\[([^\]]*)\]/gm)].map((m) => m[1]);
  assert.equal(crons.length, 1);
  assert.deepEqual(crons[0].split(',').map((s) => s.trim().replace(/^"|"$/g, '')), [RETENTION.purgeCron]);
});

test('the audit cutoff is the same moment 6 calendar years back, and a leap day falls back to 28 February', () => {
  assert.equal(auditCutoff(Date.UTC(2026, 8, 30, 12), 6), Date.UTC(2020, 8, 30, 12));
  assert.equal(auditCutoff(Date.UTC(2028, 1, 29, 12, 30), 6), Date.UTC(2022, 1, 28, 12, 30));
});

test('a purge removes spent and expired nonces and audit rows older than the cutoff', async () => {
  const { db } = harness();
  const cutoff = auditCutoff(T0, RETENTION.auditYears);
  addNonce(db, 'expired', T0 - 1);
  addNonce(db, 'expiring-now', T0);
  addNonce(db, 'spent', T0 + NONCE_TTL_MS, 1);
  addNonce(db, 'fresh', T0 + NONCE_TTL_MS);
  for (const at of [cutoff - 86_400_000, cutoff - 1, cutoff, cutoff + 1, T0]) addAudit(db, at);
  await purgeExpired(db, T0);
  assert.deepEqual(nonces(db), [{ value: 'fresh', used: 0 }]);
  assert.deepEqual(auditTimes(db), [cutoff, cutoff + 1, T0]);
});

test('NEGATIVE CONTROL: a purge keeps a fresh nonce working and every audit row inside 6 years', async () => {
  const h = harness();
  const dev = await addDevice(h.db);
  addAudit(h.db, auditCutoff(T0, 6) + 1);
  const n = await nonceFor(h.call, dev);
  await purgeExpired(h.db, T0);
  const res = await h.call(await signed(h.call, dev, '/reverify', {}, { nonce: n }));
  assert.equal((await res.json()).error, 'not-built');
  assert.ok(auditTimes(h.db).includes(auditCutoff(T0, 6) + 1));
});

test('the retention is configuration: another number of years moves the cutoff', async () => {
  const { db } = harness();
  addAudit(db, auditCutoff(T0, 1) - 1);
  addAudit(db, auditCutoff(T0, 1) + 1);
  await purgeExpired(db, T0, { auditYears: 1 });
  assert.deepEqual(auditTimes(db), [auditCutoff(T0, 1) + 1]);
});

test('a retention that is not a whole number of years from 1 up is refused, so a slip cannot empty the audit table', async () => {
  const { db } = harness();
  addAudit(db, T0 - 1);
  for (const auditYears of [0, -6, 1.5, '6', NaN, null]) {
    await assert.rejects(purgeExpired(db, T0, { auditYears }), /audit retention/, String(auditYears));
  }
  assert.deepEqual(auditTimes(db), [T0 - 1]);
});

test('the Worker runs the purge on its schedule, at the scheduled time', async () => {
  const { db } = harness();
  addNonce(db, 'expired', T0 - 1);
  addNonce(db, 'fresh', T0 + 1);
  addAudit(db, auditCutoff(T0, 6) - 1);
  const waits = [];
  await worker.scheduled({ scheduledTime: T0, cron: RETENTION.purgeCron }, { DB: db }, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.deepEqual(nonces(db), [{ value: 'fresh', used: 0 }]);
  assert.deepEqual(auditTimes(db), []);
});

test('with no database bound the scheduled purge fails loudly rather than reporting success', async () => {
  const waits = [];
  await assert.rejects(async () => {
    await worker.scheduled({ scheduledTime: T0, cron: RETENTION.purgeCron }, {}, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  }, /no database/);
});
