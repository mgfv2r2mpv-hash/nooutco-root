// Shared by the Horae Zone tests: a real-SQLite D1 over schema.sql (the
// profile-api helper, reused), a device with a P-256 key made by WebCrypto,
// a signer that builds requests the way a device will, and a mail sink in
// place of the transport, so no test sends mail.
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

// Obviously fake: 32 bytes of 7. The deployed key is a Worker secret.
export const ACCOUNT_KEY = b64url(new Uint8Array(32).fill(7));
export const LINK_BASE = 'https://horae-zone.example.test/verify';

// `mailer` replaces the sink (a test of a failing send). `env` adds to or
// overrides the bindings. Deferred work (ctx.waitUntil) is awaited before
// `call` returns, so a test sees the mail a request sent.
export function harness({ mailer = null, env = {} } = {}) {
  const db = d1Sqlite(SCHEMA);
  const clock = { ms: T0 };
  const mail = [];
  const send = mailer ?? (async (message) => { mail.push(message); return true; });
  const handler = createHandler({ now: () => clock.ms, mailer: send });
  const bindings = { DB: db, HZ_ACCOUNT_KEY: ACCOUNT_KEY, HZ_LINK_BASE: LINK_BASE, ...env };
  const call = async (req) => {
    const waits = [];
    const res = await handler(req, bindings, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    return res;
  };
  return { db, clock, call, mail, env: bindings };
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
// change what is signed without changing what is sent; `headers` adds to the
// request's headers (a connecting address).
export async function signed(call, device, pathname, body = {}, { nonce, der = false, tamper = null, headers = {} } = {}) {
  const n = nonce ?? await nonceFor(call, device);
  const text = JSON.stringify(body);
  const bytes = signedBytes(n, tamper?.path ?? pathname, new TextEncoder().encode(tamper?.body ?? text));
  let sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, device.key, bytes));
  if (der) sig = rawToDer(sig);
  return post(pathname, text, { ...headers, 'x-hz-device': device.id, 'x-hz-nonce': n, 'x-hz-sig': b64url(sig) });
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

// Every value in every table, as one text, for a leak check.
export function everyRow(db) {
  const tables = db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  return JSON.stringify(tables.map((t) => db.sqlite.prepare(`SELECT * FROM ${t}`).all()));
}

export function auditRows(db) {
  return db.sqlite.prepare('SELECT route, reason FROM audit ORDER BY id').all().map((r) => ({ ...r }));
}

// A4 flow helpers. Each goes through the routes as a device will: sign-up by
// the emailed code, sign-in for a ticket, then registration with fresh keys.
export const PASSWORD = 'correct horse battery staple CANARY';

export async function signUp(h, email, { password = PASSWORD, ip = '192.0.2.10' } = {}) {
  await h.call(post('/account', { email }, { 'cf-connecting-ip': ip }));
  const message = h.mail.filter((m) => m.to === email).at(-1);
  const code = new URL(message.text.match(/https:\/\/\S+/)[0]).hash.slice(1);
  const res = await h.call(post('/account/email/verify', { email, code, password }, { 'cf-connecting-ip': ip }));
  if (res.status !== 200) throw new Error(`sign-up answered ${res.status}`);
  return h.db.sqlite.prepare('SELECT id FROM account ORDER BY created_at DESC, rowid DESC LIMIT 1').get().id;
}

// The key digest /signin binds a ticket to (security review M3): SHA-256 of
// the raw sign point then the raw agree point, base64url. Written here apart
// from src/devices.js, so the tests pin the form a device computes.
export async function keyDigestOf({ signKey, agreeKey }) {
  const bytes = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const both = new Uint8Array([...bytes(signKey), ...bytes(agreeKey)]);
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', both)));
}

// Obviously fake: the digest shape over 32 bytes of 9, for a sign-in whose
// ticket no test registers.
export const ANY_KEY_DIGEST = b64url(new Uint8Array(32).fill(9));

export function signInRequest(email, password = PASSWORD, ip = '192.0.2.10', keyDigest = ANY_KEY_DIGEST) {
  return post('/signin', { email, password, keyDigest }, { 'cf-connecting-ip': ip });
}

// `keys` (from deviceKeys) binds the ticket to the device that will register it.
export async function signIn(h, email, options = {}) {
  const keyDigest = options.keys ? await keyDigestOf(options.keys) : ANY_KEY_DIGEST;
  const res = await h.call(signInRequest(email, options.password, options.ip, keyDigest));
  if (res.status !== 200) throw new Error(`sign-in answered ${res.status}`);
  return (await res.json()).ticket;
}

// A device's two P-256 key pairs, the public halves as raw points in base64url.
export async function deviceKeys() {
  const sign = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const agree = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const raw = async (k) => b64url(new Uint8Array(await crypto.subtle.exportKey('raw', k)));
  return { key: sign.privateKey, signKey: await raw(sign.publicKey), agreeKey: await raw(agree.publicKey) };
}

export function registerRequest(ticket, keys) {
  return post('/device/register', { ticket, signKey: keys.signKey, agreeKey: keys.agreeKey });
}

// Signs up (when `email` has no account yet), signs in and registers a new
// device; returns it in the shape signed() takes.
export async function registeredDevice(h, email, { fresh = true } = {}) {
  const account = fresh ? await signUp(h, email) : null;
  const keys = await deviceKeys();
  const res = await h.call(registerRequest(await signIn(h, email, { keys }), keys));
  if (res.status !== 200) throw new Error(`register answered ${res.status}`);
  const { device } = await res.json();
  return { id: device, account, key: keys.key, signKey: keys.signKey };
}
