// Shared by the Horae Zone tests: a real-SQLite D1 over schema.sql (the
// profile-api helper, reused), a device with a P-256 key made by WebCrypto,
// a signer that builds requests the way a device will, and a mail sink in
// place of the transport, so no test sends mail.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { d1Sqlite } from '../../profile-api/test/helpers/d1-sqlite.js';
import { createHandler } from '../src/index.js';
import { signedBytes, b64url, fromB64url } from '../src/checks.js';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCHEMA = readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
export const T0 = Date.UTC(2026, 8, 30, 12);
export const ORIGIN = 'https://horae-zone.example.test';

// Obviously fake: 32 bytes of 7. The deployed key is a Worker secret.
export const ACCOUNT_KEY = b64url(new Uint8Array(32).fill(7));
export const LINK_BASE = 'https://horae-zone.example.test/verify';

// A5. Obviously fake: 32 bytes of 9. The deployed seed key is a Worker secret.
export const SEED_KEY = b64url(new Uint8Array(32).fill(9));
export const REOPEN_BASE = 'https://horae-zone.example.test/reopen';
// The unlock-ticket signing key is made fresh for each run and never written
// down; tests verify a ticket with its public half.
const ticketPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
export const TICKET_PUBLIC_KEY = ticketPair.publicKey;
export const TICKET_KEY = JSON.stringify(await crypto.subtle.exportKey('jwk', ticketPair.privateKey));

// `mailer` replaces the sink (a test of a failing send). `env` adds to or
// overrides the bindings. Deferred work (ctx.waitUntil) is awaited before
// `call` returns, so a test sees the mail a request sent.
export function harness({ mailer = null, env = {} } = {}) {
  const db = d1Sqlite(SCHEMA);
  const clock = { ms: T0 };
  const mail = [];
  const send = mailer ?? (async (message) => { mail.push(message); return true; });
  const handler = createHandler({ now: () => clock.ms, mailer: send });
  const bindings = {
    DB: db, HZ_ACCOUNT_KEY: ACCOUNT_KEY, HZ_LINK_BASE: LINK_BASE,
    HZ_SEED_KEY: SEED_KEY, HZ_TICKET_KEY: TICKET_KEY, HZ_REOPEN_BASE: REOPEN_BASE, ...env,
  };
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
  return { id: device, account, key: keys.key, signKey: keys.signKey, agreeKey: keys.agreeKey };
}

// The database the handler sees, with a removal of device `id` landing the
// moment a statement starting with `after` has run: past the device checks,
// before the handler's own writes (security review L2). `nonces: false`
// stamps the row only, so the nonce spend is what has to notice.
export function removedMidFlight(h, id, after, { nonces = true } = {}) {
  landsMidFlight(h, after, (db) => {
    if (nonces) db.sqlite.prepare('UPDATE nonce SET used = 1 WHERE device_id = ?').run(id);
    db.sqlite.prepare('UPDATE device SET removed_at = ? WHERE id = ?').run(h.clock.ms, id);
  });
}

// The database the handler sees, with `change(db)` run once, the moment a
// statement starting with `after` has run (a removal, a registration).
export function landsMidFlight(h, after, change) {
  const db = h.db;
  let landed = false;
  const land = () => {
    if (landed) return;
    landed = true;
    change(db);
  };
  const wrap = (s) => ({
    ...s,
    bind: (...values) => wrap(s.bind(...values)),
    first: async () => { const r = await s.first(); land(); return r; },
    all: async () => { const r = await s.all(); land(); return r; },
    run: async () => { const r = await s.run(); land(); return r; },
  });
  h.env.DB = { ...db, prepare: (sql) => (sql.startsWith(after) ? wrap(db.prepare(sql)) : db.prepare(sql)) };
}

// The first statements of a signed request, for removedMidFlight.
export const FIND_DEVICE = 'SELECT id, account_id, sign_key, pending FROM device';
export const SPEND_NONCE = 'UPDATE nonce SET used = 1 WHERE value';

// A5 flow helpers. The engine is imported when a helper first runs, so the
// A2 to A4 tests load this file even where the engine lacks an A5 export.
const engine = async () => ({
  ...(await import('../../../packages/account-engine/src/pake.mjs')),
  ...(await import('../../../packages/account-engine/src/totp.mjs')),
});

const answerOf = async (res) => ({ status: res.status, json: await res.json() });

export async function enrolRequest(call, device, ticket) {
  return signed(call, device, '/otp/enrol', { ticket });
}

// A sign-in ticket bound to an already registered device's own keys, the one
// kind /otp/enrol spends (security review M3).
export function enrolTicket(h, email, device) {
  return signIn(h, email, { keys: device });
}

// Signs up, registers a device and enrols the account's code with a second
// sign-in ticket bound to its keys; the device comes back holding the seed,
// as its authenticator app would.
export async function enrolledDevice(h, email) {
  const dev = await registeredDevice(h, email);
  const res = await h.call(await enrolRequest(h.call, dev, await enrolTicket(h, email, dev)));
  if (res.status !== 200) throw new Error(`enrol answered ${res.status}`);
  const { secret, uri } = await res.json();
  const { base32Decode } = await engine();
  return { ...dev, email, secret, uri, seed: base32Decode(secret) };
}

// The code an authenticator holding `device.seed` shows at `ms`.
export async function codeAt(device, ms) {
  const { totpAt } = await engine();
  return totpAt(device.seed, ms);
}

// A code that neither the current nor the previous step accepts at `ms`.
export async function wrongCodeAt(device, ms) {
  const { candidateCodes } = await engine();
  const right = candidateCodes(device.seed, ms);
  for (let n = 0; ; n += 1) {
    const code = String(n).padStart(6, '0');
    if (!right.includes(code)) return code;
  }
}

// One code try at /unlock/start and /unlock/finish, run as a device runs it:
// the code goes into CPace on the device and never into a request. When no
// reply checks (a wrong code, or a step the service did not offer) the device
// has no tagA, and a random one is sent so the try is settled at once.
// `finish: false` stops after the start.
export async function tryCode(h, device, code, { clock = h.clock.ms, finish = true } = {}) {
  const { initiatorStart, initiatorFinish, unlockChannelFor } = await engine();
  const { message, state } = initiatorStart({ code, channel: unlockChannelFor(device.id) });
  const body = { sid: b64url(message.sid), Ya: b64url(message.Ya), clock };
  const start = await answerOf(await h.call(await signed(h.call, device, '/unlock/start', body)));
  if (start.status !== 200 || !finish) return { start };
  const replies = start.json.replies.map((r) => ({ Yb: fromB64url(r.Yb), tagB: fromB64url(r.tagB) }));
  const proved = initiatorFinish(state, replies);
  const tagA = b64url(proved ? proved.tagA : crypto.getRandomValues(new Uint8Array(32)));
  const done = await answerOf(await h.call(await signed(h.call, device, '/unlock/finish', { exchange: start.json.exchange, tagA })));
  return { start, proved: Boolean(proved), tagA, finish: done };
}

// The reopen token from the newest lock mail to `email` that carries a link.
export function reopenTokenFrom(h, email) {
  const message = h.mail.filter((m) => m.to === email && m.text.includes(REOPEN_BASE)).at(-1);
  if (!message) return null;
  return new URL(message.text.match(/https:\/\/\S+/)[0]).hash.slice(1);
}
