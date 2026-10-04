// A3, account + email (plan §3.3 "First device", steps 1 and 2). POST /account
// takes an address and mails a single-use 6-digit code; POST
// /account/email/verify takes the address, that code and the account
// password, and only then makes the account. The mail transport is the
// harness sink: no test sends mail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SIGNUP_LIMITS } from '../src/signup.js';
import { accountKeys } from '../src/account-keys.js';
import { b64url } from '../src/checks.js';
import { harness, post, auditRows, everyRow, LINK_BASE, ROOT, T0 } from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses, a TEST-NET-1 requester, and
// a password no one uses.
const ADDRESS = 'new-user@example.test';
const PASSWORD = 'correct horse battery staple CANARY';
const IP = '192.0.2.10';

const accounts = (db) => db.sqlite.prepare('SELECT * FROM account').all().map((r) => ({ ...r }));
const challenges = (db) => db.sqlite.prepare('SELECT * FROM challenge').all().map((r) => ({ ...r }));

function start(h, email = ADDRESS, ip = IP) {
  return h.call(post('/account', { email }, { 'cf-connecting-ip': ip }));
}

function verify(h, { email = ADDRESS, code, password = PASSWORD, ip = IP, query = '' } = {}) {
  return h.call(post(`/account/email/verify${query}`, { email, code, password }, { 'cf-connecting-ip': ip }));
}

// The code is read from the link in the last mail to `to`, where it rides in
// the fragment.
function codeFrom(h, to = ADDRESS) {
  const message = h.mail.filter((m) => m.to === to).at(-1);
  assert.ok(message, `no mail to ${to}`);
  const links = message.text.match(/https:\/\/\S+/g) ?? [];
  assert.equal(links.length, 1, 'one link in the mail');
  return new URL(links[0]).hash.slice(1);
}

// The code as a whole number, so it is not found inside a longer one (a
// 13-digit timestamp in a row can hold any 6 digits).
const alone = (code) => new RegExp(`(?<![0-9])${code}(?![0-9])`);

// A 6-digit code that is not `code`.
const wrongOf = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

async function answer(res) {
  return { status: res.status, json: await res.json() };
}

test('sign-up needs the email code', async () => {
  const h = harness();
  assert.deepEqual(await answer(await start(h)), { status: 200, json: { ok: true } });
  assert.equal(h.mail.length, 1);
  assert.equal(h.mail[0].to, ADDRESS);
  assert.deepEqual(accounts(h.db), [], 'no account before the code');
  const code = codeFrom(h);
  assert.match(code, /^\d{6}$/);
  assert.deepEqual(await answer(await verify(h, { code: wrongOf(code) })), { status: 401, json: { error: 'bad-code' } });
  assert.deepEqual(await answer(await h.call(post('/account/email/verify', { email: ADDRESS, password: PASSWORD }))), { status: 400, json: { error: 'shape' } });
  assert.deepEqual(accounts(h.db), [], 'no account from a wrong or missing code');
});

test('NEGATIVE CONTROL: the code from the mail, with a password, makes the account', async () => {
  const h = harness();
  await start(h);
  assert.deepEqual(await answer(await verify(h, { code: codeFrom(h) })), { status: 200, json: { ok: true } });
  assert.equal(accounts(h.db).length, 1);
});

test('a sign-up for an address that was never sent a code is refused like a wrong code', async () => {
  const h = harness();
  assert.deepEqual(await answer(await verify(h, { code: '000000' })), { status: 401, json: { error: 'bad-code' } });
  assert.deepEqual(accounts(h.db), []);
});

test('the email code rides in the fragment', async (t) => {
  const lines = [];
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) t.mock.method(console, k, (...a) => { lines.push(a.map(String).join(' ')); });
  const h = harness();
  const seen = [];
  const keep = async (res) => { seen.push(`${res.status} ${[...res.headers].flat().join(' ')} ${await res.text()}`); };
  await keep(await start(h));
  const link = new URL(h.mail[0].text.match(/https:\/\/\S+/)[0]);
  assert.equal(`${link.origin}${link.pathname}`, LINK_BASE);
  assert.equal(link.search, '', 'no query string');
  const code = link.hash.slice(1);
  assert.match(code, /^\d{6}$/);
  // A code sent in a query string is refused before any handler, and is not
  // spent or counted.
  await keep(await verify(h, { code: wrongOf(code), query: `?code=${code}` }));
  assert.equal(JSON.parse(seen.at(-1).slice(seen.at(-1).indexOf('{'))).error, 'shape');
  assert.deepEqual(challenges(h.db).map((c) => [c.used, c.tries]), [[0, 0]]);
  await keep(await verify(h, { code: wrongOf(code) }));
  await keep(await verify(h, { code }));
  assert.equal(accounts(h.db).length, 1);
  for (const text of seen) assert.equal(text.match(alone(code)) !== null, false, 'a response carries the code');
  assert.equal(JSON.stringify(auditRows(h.db)).match(alone(code)) !== null, false, 'an audit row carries the code');
  assert.equal(everyRow(h.db).match(alone(code)) !== null, false, 'a table carries the code');
  assert.equal(lines.join('\n').match(alone(code)) !== null, false, 'console output carries the code');
});

test('an email code works once', async () => {
  const h = harness();
  await start(h);
  const code = codeFrom(h);
  assert.equal((await verify(h, { code })).status, 200);
  assert.deepEqual(await answer(await verify(h, { code })), { status: 401, json: { error: 'bad-code' } });
  assert.equal(accounts(h.db).length, 1);
});

test('an email code expires', async () => {
  const h = harness();
  await start(h);
  await start(h, 'second@example.test', '192.0.2.11');
  h.clock.ms = T0 + SIGNUP_LIMITS.codeTtlMs - 1;
  assert.equal((await verify(h, { email: 'second@example.test', code: codeFrom(h, 'second@example.test') })).status, 200, 'inside its life');
  h.clock.ms = T0 + SIGNUP_LIMITS.codeTtlMs;
  assert.deepEqual(await answer(await verify(h, { code: codeFrom(h) })), { status: 401, json: { error: 'bad-code' } });
});

// H1 (security review): a start or a wrong guess by someone else must not
// end the code the address owner was mailed. A start never deletes a live
// code, up to SIGNUP_LIMITS.liveCodes stay live together, and a try is
// compared with each of them.
test('H1: a second start leaves the first code live, so the owner\'s code still works', async () => {
  const h = harness();
  await start(h);
  const owners = codeFrom(h);
  await start(h, ADDRESS, '192.0.2.66');
  assert.equal(h.mail.length, 2, 'the second start mailed a code too');
  assert.deepEqual(await answer(await verify(h, { code: owners })), { status: 200, json: { ok: true } });
  assert.equal(accounts(h.db).length, 1);
});

test('H1: every live code for an address works, the newest included', async () => {
  const h = harness();
  for (let i = 0; i < SIGNUP_LIMITS.liveCodes; i += 1) await start(h, ADDRESS, `192.0.2.${40 + i}`);
  assert.equal(challenges(h.db).length, SIGNUP_LIMITS.liveCodes);
  assert.equal((await verify(h, { code: codeFrom(h) })).status, 200);
});

test('H1: wrong guesses from another requester do not end the owner\'s code', async () => {
  const h = harness();
  await start(h);
  const owners = codeFrom(h);
  for (let i = 0; i < SIGNUP_LIMITS.triesPerAddressRequesterHour; i += 1) {
    assert.equal((await verify(h, { code: wrongOf(owners), ip: '192.0.2.66' })).status, 401);
  }
  assert.deepEqual(await answer(await verify(h, { code: wrongOf(owners), ip: '192.0.2.66' })), { status: 429, json: { error: 'slow-down' } },
    'one requester gets its share of tries at an address, then slows down');
  assert.deepEqual(await answer(await verify(h, { code: owners })), { status: 200, json: { ok: true } });
  assert.equal(accounts(h.db).length, 1);
});

test('H1: tries at one address are still capped across requesters', async () => {
  const h = harness();
  await start(h);
  const code = codeFrom(h);
  const share = SIGNUP_LIMITS.triesPerAddressRequesterHour;
  for (let i = 0; i < SIGNUP_LIMITS.triesPerAddressHour; i += 1) {
    assert.equal((await verify(h, { code: wrongOf(code), ip: `192.0.2.${100 + Math.floor(i / share)}` })).status, 401);
  }
  assert.deepEqual(await answer(await verify(h, { code: wrongOf(code), ip: '192.0.2.200' })), { status: 429, json: { error: 'slow-down' } });
  assert.deepEqual(accounts(h.db), []);
  h.clock.ms = T0 + SIGNUP_LIMITS.windowMs;
  await start(h, ADDRESS, '192.0.2.201');
  assert.equal((await verify(h, { code: codeFrom(h), ip: '192.0.2.201' })).status, 200, 'the cap lifts after its window');
});

test('H1: the address cap stops tries before any one code reaches its own try limit', () => {
  assert.ok(SIGNUP_LIMITS.triesPerAddressHour <= SIGNUP_LIMITS.codeTries);
  assert.ok(SIGNUP_LIMITS.codeTtlMs <= SIGNUP_LIMITS.windowMs, 'a code lives inside one window');
  assert.ok(SIGNUP_LIMITS.codesPerAddressHour <= SIGNUP_LIMITS.liveCodes, 'the start limit never asks for more live codes than are kept');
});

test('the code is stored only as a keyed digest', async () => {
  const h = harness();
  await start(h);
  const code = codeFrom(h);
  const rows = challenges(h.db);
  assert.equal(rows.length, 1);
  assert.match(rows[0].digest, /^[0-9a-f]{64}$/);
  assert.equal(everyRow(h.db).match(alone(code)) !== null, false);
  assert.equal(JSON.stringify(h.db.bound.map((b) => b.values)).match(alone(code)) !== null, false, 'a bound statement carries the code');
  assert.equal(everyRow(h.db).includes(ADDRESS), false, 'a table carries the address in the clear');
});

test('codes are compared in constant time, never with ===', () => {
  const text = readFileSync(path.join(ROOT, 'src', 'signup.js'), 'utf8');
  assert.match(text, /import \{[^}]*\bsameHex\b[^}]*\} from ['"][./]*packages\/account-engine\/src\/limits\.mjs['"]/);
  assert.match(text, /sameHex\(/);
  assert.doesNotMatch(text, /digest\s*[!=]==|[!=]==\s*\w*\.?digest/i);
});

test('sign-up starts are rate limited per address', async () => {
  const h = harness();
  for (let i = 0; i < SIGNUP_LIMITS.codesPerAddressHour; i += 1) {
    assert.equal((await start(h, ADDRESS, `192.0.2.${20 + i}`)).status, 200);
  }
  const mailed = h.mail.length;
  assert.deepEqual(await answer(await start(h, ADDRESS, '192.0.2.99')), { status: 429, json: { error: 'slow-down' } });
  assert.equal(h.mail.length, mailed, 'no mail once limited');
  h.clock.ms = T0 + SIGNUP_LIMITS.windowMs;
  assert.equal((await start(h, ADDRESS, '192.0.2.99')).status, 200, 'the limit lifts after its window');
});

test('sign-up starts are rate limited per device', async () => {
  const h = harness();
  for (let i = 0; i < SIGNUP_LIMITS.startsPerRequesterHour; i += 1) {
    assert.equal((await start(h, `user-${i}@example.test`, IP)).status, 200);
  }
  assert.deepEqual(await answer(await start(h, 'one-more@example.test', IP)), { status: 429, json: { error: 'slow-down' } });
  assert.equal((await start(h, 'one-more@example.test', '192.0.2.77')).status, 200, 'another requester is not limited');
});

test('code tries are rate limited per device', async () => {
  const h = harness();
  for (let i = 0; i < SIGNUP_LIMITS.verifiesPerRequesterHour; i += 1) {
    assert.equal((await verify(h, { email: `spray-${i}@example.test`, code: '000000' })).status, 401);
  }
  assert.deepEqual(await answer(await verify(h, { code: '000000' })), { status: 429, json: { error: 'slow-down' } });
});

test('no answer says whether an address already has an account', async () => {
  const h = harness();
  await start(h);
  await verify(h, { code: codeFrom(h) });
  const mailed = h.mail.length;
  const existing = await answer(await start(h, 'New-User@Example.TEST', '192.0.2.30'));
  const fresh = await answer(await start(h, 'fresh@example.test', '192.0.2.31'));
  assert.deepEqual(existing, fresh);
  assert.deepEqual(h.mail.slice(mailed).map((m) => m.to), ['fresh@example.test'], 'no code goes to an address that has an account');
  const wrongExisting = await answer(await verify(h, { code: '000000', ip: '192.0.2.32' }));
  const wrongFresh = await answer(await verify(h, { email: 'fresh@example.test', code: wrongOf(codeFrom(h, 'fresh@example.test')), ip: '192.0.2.32' }));
  assert.deepEqual(wrongExisting, wrongFresh);
});

test('an address that is not an address, extra fields, or a password outside the length rule are refused as shape', async () => {
  const h = harness();
  for (const email of ['', 'no-at-sign', 'two@@example.test', 'a b@example.test', `${'x'.repeat(250)}@example.test`, 7, null]) {
    assert.deepEqual(await answer(await h.call(post('/account', { email }))), { status: 400, json: { error: 'shape' } }, String(email));
  }
  assert.deepEqual(await answer(await h.call(post('/account', { email: ADDRESS, extra: 1 }))), { status: 400, json: { error: 'shape' } });
  await start(h);
  const code = codeFrom(h);
  for (const password of ['x'.repeat(SIGNUP_LIMITS.passwordMin - 1), 'x'.repeat(SIGNUP_LIMITS.passwordMax + 1), 12345678901234]) {
    assert.deepEqual(await answer(await verify(h, { code, password })), { status: 400, json: { error: 'shape' } });
  }
  assert.deepEqual(challenges(h.db).map((c) => [c.used, c.tries]), [[0, 0]], 'a shape refusal neither spends nor counts the code');
  assert.equal(h.mail.length, 1);
  assert.equal((await verify(h, { code, password: 'x'.repeat(SIGNUP_LIMITS.passwordMin) })).status, 200);
});

test('the password is stored only as a salted slow hash', async () => {
  const h = harness();
  for (const [email, ip] of [[ADDRESS, IP], ['other@example.test', '192.0.2.40']]) {
    await start(h, email, ip);
    assert.equal((await verify(h, { email, code: codeFrom(h, email), ip })).status, 200);
  }
  const [a, b] = accounts(h.db);
  assert.equal(everyRow(h.db).includes(PASSWORD), false);
  assert.equal(JSON.stringify(h.db.bound.map((x) => x.values)).includes(PASSWORD), false);
  assert.match(a.login_hash, /^pbkdf2-sha256\$\d+\$/);
  assert.notEqual(a.login_salt, b.login_salt);
  assert.notEqual(a.login_hash, b.login_hash, 'the same password hashes differently for two accounts');
});

test('the address is stored sealed and opens only with the service key', async () => {
  const h = harness();
  await start(h, 'Mixed.Case@Example.TEST');
  await verify(h, { email: 'mixed.case@example.test', code: codeFrom(h, 'mixed.case@example.test') });
  const [row] = accounts(h.db);
  assert.equal(everyRow(h.db).toLowerCase().includes('mixed.case@example.test'), false);
  const keys = await accountKeys(h.env);
  assert.equal(await keys.openAddress(row.address_box, row.address_key), 'mixed.case@example.test');
  const other = await accountKeys({ HZ_ACCOUNT_KEY: b64url(new Uint8Array(32).fill(9)) });
  await assert.rejects(other.openAddress(row.address_box, row.address_key));
  // The box is bound to its address key.
  await assert.rejects(keys.openAddress(row.address_box, 'f'.repeat(64)));
});

test('a mail that cannot be sent is audited and the answer is unchanged', async (t) => {
  const lines = [];
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) t.mock.method(console, k, (...a) => { lines.push(a.map(String).join(' ')); });
  const h = harness({ mailer: async () => false });
  assert.deepEqual(await answer(await start(h)), { status: 200, json: { ok: true } });
  assert.deepEqual(auditRows(h.db), [{ route: '/account', reason: 'ok' }, { route: '/account', reason: 'mail-failed' }]);
  const thrown = harness({ mailer: async () => { throw new Error(`down ${ADDRESS}`); } });
  assert.deepEqual(await answer(await start(thrown)), { status: 200, json: { ok: true } });
  assert.deepEqual(auditRows(thrown.db).at(-1), { route: '/account', reason: 'mail-failed' });
  assert.deepEqual(lines, []);
});

test('without the account key the account routes answer unavailable and write nothing', async () => {
  for (const bad of [undefined, '', 'too-short', '!!!!']) {
    const h = harness({ env: { HZ_ACCOUNT_KEY: bad } });
    assert.deepEqual(await answer(await start(h)), { status: 503, json: { error: 'unavailable' } }, String(bad));
    assert.deepEqual(await answer(await verify(h, { code: '000000' })), { status: 503, json: { error: 'unavailable' } });
    assert.deepEqual(h.mail, []);
    assert.deepEqual(challenges(h.db), []);
  }
});

test('without a link base no code is issued', async () => {
  for (const bad of [undefined, 'http://horae-zone.example.test/verify', 'https://horae-zone.example.test/verify?x=1']) {
    const h = harness({ env: { HZ_LINK_BASE: bad } });
    assert.deepEqual(await answer(await start(h)), { status: 503, json: { error: 'unavailable' } }, String(bad));
    assert.deepEqual(h.mail, []);
    assert.deepEqual(challenges(h.db), []);
  }
});

test('the sign-up mail has a plain subject, the code, the link, and no em dash', async () => {
  const h = harness();
  await start(h);
  const [m] = h.mail;
  const code = codeFrom(h);
  assert.equal(typeof m.subject, 'string');
  assert.ok(m.subject.length > 0 && !m.subject.includes(code), 'the subject carries no code');
  assert.ok(m.text.includes(`${LINK_BASE}#${code}`));
  assert.equal(`${m.subject}${m.text}`.includes(String.fromCharCode(0x2014)), false);
});
