// Shared by the Horae Zone tests: a real-SQLite D1 over schema.sql (the
// profile-api helper, reused), a device with a P-256 key made by WebCrypto,
// and a signer that builds requests the way a device will.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { d1Sqlite } from '../../profile-api/test/helpers/d1-sqlite.js';
import { createHandler } from '../src/index.js';
import { signedBytes, b64url } from '../src/checks.js';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA = readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
export const T0 = Date.UTC(2026, 8, 30, 12);
export const ORIGIN = 'https://horae-zone.example.test';

export function harness() {
  const db = d1Sqlite(SCHEMA);
  const clock = { ms: T0 };
  const handler = createHandler({ now: () => clock.ms });
  const call = (req) => handler(req, { DB: db });
  return { db, clock, call };
}

export async function addDevice(db, { id = 'dev-1', account = 'acct-1', removed = null } = {}) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  db.sqlite.prepare('INSERT INTO device (id, account_id, sign_key, created_at, removed_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, account, b64url(raw), T0, removed);
  return { id, account, key: pair.privateKey };
}

export function makeAdmin(db, account) {
  db.sqlite.prepare('INSERT INTO role (account_id, role) VALUES (?, ?)').run(account, 'admin');
}

export function post(pathname, body = {}, headers = {}) {
  return new Request(`${ORIGIN}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export async function nonceFor(call, device) {
  const res = await call(post('/nonce', {}, { 'x-hz-device': device.id }));
  const { nonce } = await res.json();
  return nonce;
}

// A request signed by the device over a fresh nonce. `tamper` lets a test
// change what is signed without changing what is sent.
export async function signed(call, device, pathname, body = {}, { nonce, der = false, tamper = null } = {}) {
  const n = nonce ?? await nonceFor(call, device);
  const text = JSON.stringify(body);
  const bytes = signedBytes(n, tamper?.path ?? pathname, new TextEncoder().encode(tamper?.body ?? text));
  let sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, device.key, bytes));
  if (der) sig = rawToDer(sig);
  return post(pathname, text, { 'x-hz-device': device.id, 'x-hz-nonce': n, 'x-hz-sig': b64url(sig) });
}

// DER, the form the Secure Enclave gives, from WebCrypto's raw r||s.
export function rawToDer(raw) {
  const int = (bytes) => {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i += 1;
    let b = bytes.slice(i);
    if (b[0] & 0x80) b = Uint8Array.of(0, ...b);
    return Uint8Array.of(0x02, b.length, ...b);
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  return Uint8Array.of(0x30, r.length + s.length, ...r, ...s);
}

export function auditRows(db) {
  return db.sqlite.prepare('SELECT route, reason FROM audit ORDER BY id').all().map((r) => ({ ...r }));
}
