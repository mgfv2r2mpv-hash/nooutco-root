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
import { UNLOCK_LIMITS } from '../src/unlock.js';
import { createPinRules } from '../../../packages/account-engine/src/pin.mjs';
import { PINS as PIN_FIXTURE } from '../../../packages/account-engine/test/fixtures/pin-blocklist.mjs';

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
// A5b. The page a forgotten-PIN reset mail links to; the code rides after #.
export const RESET_BASE = 'https://horae-zone.example.test/pin-reset';
// The unlock-ticket signing key is made fresh for each run and never written
// down; tests verify a ticket with its public half.
const ticketPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
export const TICKET_PUBLIC_KEY = ticketPair.publicKey;
export const TICKET_KEY = JSON.stringify(await crypto.subtle.exportKey('jwk', ticketPair.privateKey));

// A5b. The PIN rules over the engine's five-PIN public fixture: the real
// blocklist is the private package, never in this repository.
export const PIN_RULES = createPinRules(PIN_FIXTURE);

// `mailer` replaces the sink (a test of a failing send). `env` adds to or
// overrides the bindings. `pinRules` replaces the PIN rules (null: none
// injected, as in a Worker built without the private list). Deferred work
// (ctx.waitUntil) is awaited before `call` returns, so a test sees the mail
// a request sent.
export function harness({ mailer = null, env = {}, pinRules = PIN_RULES } = {}) {
  const db = d1Sqlite(SCHEMA);
  const clock = { ms: T0 };
  const mail = [];
  const send = mailer ?? (async (message) => { mail.push(message); return true; });
  const handler = createHandler({ now: () => clock.ms, mailer: send, pinRules });
  const bindings = {
    DB: db, HZ_ACCOUNT_KEY: ACCOUNT_KEY, HZ_LINK_BASE: LINK_BASE,
    HZ_SEED_KEY: SEED_KEY, HZ_TICKET_KEY: TICKET_KEY, HZ_REOPEN_BASE: REOPEN_BASE,
    HZ_RESET_BASE: RESET_BASE, ...env,
  };
  const call = async (req) => {
    const waits = [];
    const res = await handler(req, bindings, { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    return res;
  };
  return { db, clock, call, mail, env: bindings };
}

// A device row written straight into the table, not pending unless asked.
export async function addDevice(db, { id = 'dev-1', account = 'acct-1', removed = null, pending = 0 } = {}) {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  db.sqlite.prepare('INSERT INTO device (id, account_id, sign_key, created_at, removed_at, pending) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, account, b64url(raw), T0, removed, pending);
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

// Signs up and, as the app does next, registers the owner device from the
// sign-up ticket (A5 re-review), so a password sign-in can follow. `owner:
// false` stops after the verify, an account with no device yet.
export async function signUp(h, email, { owner = true, ...options } = {}) {
  const keys = await deviceKeys();
  const made = await signUpOwner(h, email, { ...options, keys });
  if (owner) {
    const res = await h.call(registerRequest(made.ticket, keys));
    if (res.status !== 200) throw new Error(`owner register answered ${res.status}`);
  }
  return made.account;
}

// Signs up by the emailed link; the verify hands back the owner ticket (A5
// re-review), bound to `keys` when given.
export async function signUpOwner(h, email, { password = PASSWORD, ip = '192.0.2.10', keys = null } = {}) {
  await h.call(post('/account', { email }, { 'cf-connecting-ip': ip }));
  const message = h.mail.filter((m) => m.to === email).at(-1);
  const code = new URL(message.text.match(/https:\/\/\S+/)[0]).hash.slice(1);
  const keyDigest = keys ? await keyDigestOf(keys) : ANY_KEY_DIGEST;
  const res = await h.call(post('/account/email/verify', { email, code, password, keyDigest }, { 'cf-connecting-ip': ip }));
  if (res.status !== 200) throw new Error(`sign-up answered ${res.status}`);
  const { ticket } = await res.json();
  const account = h.db.sqlite.prepare('SELECT id FROM account ORDER BY created_at DESC, rowid DESC LIMIT 1').get().id;
  return { account, ticket };
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

// With `fresh`, signs up and registers the owner device from the sign-up
// ticket; otherwise signs in and registers a further device, which starts
// pending (A5 re-review). Returns it in the shape signed() takes.
export async function registeredDevice(h, email, { fresh = true, ip } = {}) {
  const keys = await deviceKeys();
  const owner = fresh ? await signUpOwner(h, email, { keys }) : null;
  const ticket = owner ? owner.ticket : await signIn(h, email, { keys, ip });
  const account = owner ? owner.account : null;
  const res = await h.call(registerRequest(ticket, keys));
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

// The 30-second step of a code (and of a lockout window).
const STEP_MS = 30_000;

// An enrolled device that has proved its first code, which confirms the
// enrolment (A5 security review item 3): only then does a device registered
// later start pending. The clock moves on one step, so the step that code
// used is behind it and the next code is fresh.
export async function confirmedDevice(h, email) {
  const dev = await enrolledDevice(h, email);
  const tried = await tryCode(h, dev, await codeAt(dev, h.clock.ms));
  if (tried.finish?.status !== 200) throw new Error(`the first code answered ${tried.finish?.status ?? tried.start.status}`);
  h.clock.ms += STEP_MS;
  return dev;
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
  const started = await startCode(h, device, code, { clock });
  if (started.start.status !== 200 || !finish) return { start: started.start };
  return { start: started.start, ...(await started.finish()) };
}

// The start of one code try, and its finish to send later, so a test can
// change the account between the two.
export async function startCode(h, device, code, { clock = h.clock.ms } = {}) {
  const { initiatorStart, initiatorFinish, unlockChannelFor } = await engine();
  const { message, state } = initiatorStart({ code, channel: unlockChannelFor(device.id) });
  const body = { sid: b64url(message.sid), Ya: b64url(message.Ya), clock };
  const start = await answerOf(await h.call(await signed(h.call, device, '/unlock/start', body)));
  const finish = async () => {
    const replies = start.json.replies.map((r) => ({ Yb: fromB64url(r.Yb), tagB: fromB64url(r.tagB) }));
    const proved = initiatorFinish(state, replies);
    const tagA = b64url(proved ? proved.tagA : crypto.getRandomValues(new Uint8Array(32)));
    const done = await answerOf(await h.call(await signed(h.call, device, '/unlock/finish', { exchange: start.json.exchange, tagA })));
    return { proved: Boolean(proved), tagA, finish: done };
  };
  return { start, finish };
}

// The reopen token from the newest lock mail to `email` that carries a link.
export function reopenTokenFrom(h, email) {
  const message = h.mail.filter((m) => m.to === email && m.text.includes(REOPEN_BASE)).at(-1);
  if (!message) return null;
  return new URL(message.text.match(/https:\/\/\S+/)[0]).hash.slice(1);
}

// ---- A5b flow helpers ----

// A fresh unlock ticket for `device`: a right code at the current step, then
// the clock one step on, so the next code is fresh.
export async function ticketFor(h, device) {
  const tried = await tryCode(h, device, await codeAt(device, h.clock.ms));
  if (tried.finish?.status !== 200) throw new Error(`the code answered ${tried.finish?.status ?? tried.start.status}`);
  h.clock.ms += STEP_MS;
  return tried.finish.json.ticket;
}

// A signed removal of `target` by `caller`, with a fresh unlock ticket of the
// caller's own (Kaleb's 8 Oct 2026 ruling: a removal takes a fresh code). The
// caller holds the account's seed, as a confirmed device does.
export async function removeRequest(h, caller, target) {
  return signed(h.call, caller, '/device/remove', { device: target, ticket: await ticketFor(h, caller) });
}

// One signed PIN request, answered as {status, json}.
export async function pinCall(h, device, pathname, body) {
  return answerOf(await h.call(await signed(h.call, device, pathname, body)));
}

// A confirmed device whose account has `pin` set, through /pin/set with a
// fresh ticket, as the app does at step 5 of the first device's enrolment.
export async function pinnedDevice(h, email, pin) {
  const dev = await confirmedDevice(h, email);
  const set = await pinCall(h, dev, '/pin/set', { pin, ticket: await ticketFor(h, dev) });
  if (set.status !== 200) throw new Error(`the first PIN answered ${set.status} ${JSON.stringify(set.json)}`);
  return dev;
}

// ---- The device list (Sass sharedPeerKey) ----

// The public half of the fresh ticket key as a JWK, the form Sass pins.
export const TICKET_PUBLIC_JWK = await crypto.subtle.exportKey('jwk', ticketPair.publicKey);

// The labels each signed kind is signed under, and the list's typ. Written
// here apart from src/, so the tests pin the form Sass checks.
export const DEVICE_LIST_LABEL_TEXT = 'horae-zone-device-list-v1';
export const UNLOCK_TICKET_LABEL_TEXT = 'horae-zone-unlock-ticket-v1';
export const DEVICE_LIST_TYP_TEXT = 'horae-zone-device-list';

// The RFC 7638 thumbprint of a P-256 public JWK: base64url SHA-256 over
// {crv, kty, x, y} in that order, no spaces.
export async function jwkThumbprint({ crv, kty, x, y }) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ crv, kty, x, y })));
  return b64url(new Uint8Array(digest));
}

// `payload.sig`, the sig ECDSA P-256 raw r||s over `${label}.${payload}`, by
// the pinned key, with the payload's kid that key's thumbprint. The claims,
// or null.
async function openSigned(text, label, jwk) {
  if (typeof text !== 'string') return null;
  const [payload, sigText, ...rest] = text.split('.');
  if (rest.length > 0 || !payload || !sigText) return null;
  let claims;
  let sig;
  try {
    claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromB64url(payload)));
    sig = fromB64url(sigText);
  } catch {
    return null;
  }
  if (claims === null || typeof claims !== 'object' || Array.isArray(claims)) return null;
  if (!sig || sig.length !== 64 || claims.kid !== await jwkThumbprint(jwk)) return null;
  const { crv, kty, x, y } = jwk;
  const key = await crypto.subtle.importKey('jwk', { crv, kty, x, y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, new TextEncoder().encode(`${label}.${payload}`));
  return ok ? claims : null;
}

const fresh = (claims, now) => Number.isSafeInteger(claims.at) && claims.at <= now && Number.isSafeInteger(claims.exp) && claims.exp > now;

// The check Sass's sharedPeerKey mirrors: the pinned key and its kid, the
// device-list label, v 1, the device-list typ, the account Sass signed in
// to, and at <= now < exp. The claims, or null.
export async function verifyDeviceList(text, { jwk = TICKET_PUBLIC_JWK, account, now }) {
  const claims = await openSigned(text, DEVICE_LIST_LABEL_TEXT, jwk);
  if (!claims || claims.v !== 1 || claims.typ !== DEVICE_LIST_TYP_TEXT || claims.account !== account) return null;
  if (!fresh(claims, now) || !Array.isArray(claims.devices)) return null;
  return claims;
}

// The same check for an unlock ticket: the ticket label, v 1, no typ, the
// account and device it names, and at <= now < exp. The claims, or null.
export async function verifyUnlockTicket(text, { jwk = TICKET_PUBLIC_JWK, account, device, now }) {
  const claims = await openSigned(text, UNLOCK_TICKET_LABEL_TEXT, jwk);
  if (!claims || claims.v !== 1 || Object.hasOwn(claims, 'typ') || claims.account !== account || claims.device !== device) return null;
  return fresh(claims, now) ? claims : null;
}

// `claims` signed with the test ticket key under `label`, kid added: what a
// signer holding HZ_TICKET_KEY could make, for the tests that cross kinds.
export async function signWithTicketKey(claims, label) {
  const jwk = JSON.parse(TICKET_KEY);
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ ...claims, kid: await jwkThumbprint(jwk) })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${label}.${payload}`));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

// A fresh unlock ticket for `device`, signed with the test ticket key in the
// form /unlock/finish signs (pinned by test/device-remove.test.mjs). For the
// older A4 and A5 tests whose account has no code to prove, yet whose
// removal now takes one (Kaleb's 8 Oct 2026 ruling): those tests are about
// who may remove, not about the code. A test about the code uses ticketFor.
export async function freshCode(h, device) {
  const { account_id: account } = h.db.sqlite.prepare('SELECT account_id FROM device WHERE id = ?').get(device.id);
  const jti = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const claims = { v: 1, account, device: device.id, at: h.clock.ms, exp: h.clock.ms + UNLOCK_LIMITS.ticketTtlMs, jti };
  return signWithTicketKey(claims, UNLOCK_TICKET_LABEL_TEXT);
}
