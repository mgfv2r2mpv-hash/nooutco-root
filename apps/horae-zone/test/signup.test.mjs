// A3, account + email (plan §3.3 "First device", steps 1 and 2). POST /account
// takes an address and mails a single-use link whose fragment carries a
// 128-bit token (the "code"); POST
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
import { harness, post, auditRows, everyRow, ANY_KEY_DIGEST, LINK_BASE, ROOT, T0 } from './helpers.mjs';

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

// The token shape: 16 random bytes in base64url, no padding.
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

// A well-formed token that is not `code`: the first character changed.
const wrongOf = (code) => `${code[0] === 'A' ? 'B' : 'A'}${code.slice(1)}`;

// A well-formed token no start ever mailed.
const NEVER_SENT = 'A'.repeat(22);

const b64urlBytes = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

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
  assert.match(code, TOKEN);
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
  assert.deepEqual(await answer(await verify(h, { code: NEVER_SENT })), { status: 401, json: { error: 'bad-code' } });
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
  assert.match(code, TOKEN);
  // A code sent in a query string is refused before any handler, and is not
  // spent or counted.
  await keep(await verify(h, { code: wrongOf(code), query: `?code=${code}` }));
  assert.equal(JSON.parse(seen.at(-1).slice(seen.at(-1).indexOf('{'))).error, 'shape');
  assert.deepEqual(challenges(h.db).map((c) => [c.used, c.tries]), [[0, 0]]);
  await keep(await verify(h, { code: wrongOf(code) }));
  await keep(await verify(h, { code }));
  assert.equal(accounts(h.db).length, 1);
  for (const text of seen) assert.equal(text.includes(code), false, 'a response carries the code');
  assert.equal(JSON.stringify(auditRows(h.db)).includes(code), false, 'an audit row carries the code');
  assert.equal(everyRow(h.db).includes(code), false, 'a table carries the code');
  assert.equal(lines.join('\n').includes(code), false, 'console output carries the code');
});

// Second security review, root cause: a 6-digit code was guessable, so it
// needed tight per-address caps a stranger could fill. The secret is now a
// 128-bit random token carried in the link, and the mail shows no code to
// type.
test('the email secret is a 128-bit random token, and the mail shows no code to type', async () => {
  const h = harness();
  await start(h);
  h.clock.ms = T0 + SIGNUP_LIMITS.codeTtlMs;
  await start(h, ADDRESS, '192.0.2.12');
  const [first, second] = h.mail.map((m) => new URL(m.text.match(/https:\/\/\S+/)[0]).hash.slice(1));
  for (const token of [first, second]) {
    assert.match(token, TOKEN);
    assert.equal(b64urlBytes(token).length, 16, 'the token is 16 bytes');
  }
  assert.notEqual(first, second, 'each new link draws a new token');
  for (const m of h.mail) {
    assert.doesNotMatch(m.text, /\b\d{6}\b/, 'no 6-digit code in the mail');
    assert.doesNotMatch(m.text, /code:/i, 'no typed code line in the mail');
    const token = new URL(m.text.match(/https:\/\/\S+/)[0]).hash.slice(1);
    assert.equal(m.text.split(token).length, 2, 'the token appears once, in the link');
  }
});

test('a 6-digit typed code, or any other shape than the token, is refused as shape before a try is counted', async () => {
  const h = harness();
  await start(h);
  for (const code of ['482913', 'A'.repeat(21), 'A'.repeat(23), `${'A'.repeat(21)}=`, `${'A'.repeat(21)}+`]) {
    assert.deepEqual(await answer(await verify(h, { code })), { status: 400, json: { error: 'shape' } }, code);
  }
  assert.deepEqual(challenges(h.db).map((c) => [c.used, c.tries]), [[0, 0]]);
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM throttle WHERE bucket LIKE 'verify-%'").get().n, 0, 'no try was counted');
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
// end the code the address owner was mailed. A start never deletes or
// replaces the live code (third review, item 2: it mails it again), and a
// try is compared with every live code.
test('H1: a second start leaves the first code live, so the owner\'s code still works', async () => {
  const h = harness();
  await start(h);
  const owners = codeFrom(h);
  await start(h, ADDRESS, '192.0.2.66');
  assert.equal(h.mail.length, 2, 'the second start mailed a code too');
  assert.deepEqual(await answer(await verify(h, { code: owners })), { status: 200, json: { ok: true } });
  assert.equal(accounts(h.db).length, 1);
});

test('H1: starts while a link is live mail that link again, and it works', async () => {
  const h = harness();
  for (let i = 0; i < 3; i += 1) await start(h, ADDRESS, `192.0.2.${40 + i}`);
  assert.equal(challenges(h.db).length, 1, 'one live code');
  const codes = h.mail.map((m) => new URL(m.text.match(/https:\/\/\S+/)[0]).hash.slice(1));
  assert.deepEqual(codes, [codes[0], codes[0], codes[0]]);
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

// Second security review, item 2: with a 128-bit token no number of tries
// finds the code, so an address-level try cap (and a per-code try ceiling)
// only gave strangers a way to make the owner's link answer 429 or die. The
// per-requester and per-pair caps stay.
test('item 2: 15 strangers\' wrong tries from 3 requesters, then the owner\'s link still verifies', async () => {
  const h = harness();
  await start(h);
  const owners = codeFrom(h);
  for (let i = 0; i < 15; i += 1) {
    assert.equal((await verify(h, { code: wrongOf(owners), ip: `192.0.2.${100 + (i % 3)}` })).status, 401, `stranger try ${i + 1}`);
  }
  assert.deepEqual(await answer(await verify(h, { code: owners, ip: '192.0.2.200' })), { status: 200, json: { ok: true } });
  assert.equal(accounts(h.db).length, 1);
  assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM throttle WHERE bucket LIKE 'verify-address:%'").get().n, 0, 'no address-level try bucket');
});

test('item 2: many strangers\' wrong tries never end the owner\'s code', async () => {
  const h = harness();
  await start(h);
  const owners = codeFrom(h);
  for (let i = 0; i < 60; i += 1) {
    assert.equal((await verify(h, { code: wrongOf(owners), ip: `192.0.2.${100 + (i % 12)}` })).status, 401, `stranger try ${i + 1}`);
  }
  assert.equal((await verify(h, { code: owners })).status, 200);
});

test('H1: a code lives inside one window', () => {
  assert.equal(Object.hasOwn(SIGNUP_LIMITS, 'triesPerAddressHour'), false, 'no address-level try cap (item 2)');
  assert.equal(Object.hasOwn(SIGNUP_LIMITS, 'codeTries'), false, 'no per-code try ceiling (item 2)');
  assert.ok(SIGNUP_LIMITS.codeTtlMs <= SIGNUP_LIMITS.windowMs, 'a code lives inside one window');
  assert.equal(Object.hasOwn(SIGNUP_LIMITS, 'codesPerAddressHour'), false, 'no per-address mint cap (third review, item 2)');
  assert.equal(Object.hasOwn(SIGNUP_LIMITS, 'liveCodes'), false, 'one live code at a time (third review, item 2)');
  assert.equal(SIGNUP_LIMITS.windowMs / SIGNUP_LIMITS.codeTtlMs, 6, 'at most 6 links minted an hour');
  assert.ok(Number.isInteger(SIGNUP_LIMITS.resendsPerAddressHour) && SIGNUP_LIMITS.resendsPerAddressHour >= 1, 'a re-send cap (item 3)');
});

test('the code is stored only as a keyed digest', async () => {
  const h = harness();
  await start(h);
  const code = codeFrom(h);
  const rows = challenges(h.db);
  assert.equal(rows.length, 1);
  assert.match(rows[0].digest, /^[0-9a-f]{64}$/);
  assert.equal(everyRow(h.db).includes(code), false);
  assert.equal(JSON.stringify(h.db.bound.map((b) => b.values)).includes(code), false, 'a bound statement carries the code');
  assert.equal(everyRow(h.db).includes(ADDRESS), false, 'a table carries the address in the clear');
});

test('codes are compared in constant time, never with ===', () => {
  const text = readFileSync(path.join(ROOT, 'src', 'signup.js'), 'utf8');
  assert.match(text, /import \{[^}]*\bsameHex\b[^}]*\} from ['"][./]*packages\/account-engine\/src\/limits\.mjs['"]/);
  assert.match(text, /sameHex\(/);
  assert.doesNotMatch(text, /digest\s*[!=]==|[!=]==\s*\w*\.?digest/i);
});

// Second security review, item 3: at the per-address start cap a start
// answered 429, so a stranger's starts stopped the owner getting a link. A
// start at the cap now answers the same 200 and, instead of minting, mails
// the newest live link again, up to SIGNUP_LIMITS.resendsPerAddressHour
// re-sends an hour.
test('item 3: 3 strangers\' starts, then the owner\'s start still gets a working link mailed', async () => {
  const h = harness();
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await start(h, ADDRESS, `192.0.2.${20 + i}`)).status, 200, `stranger start ${i + 1}`);
  }
  const newest = codeFrom(h);
  const rows = challenges(h.db).length;
  const mailed = h.mail.length;
  assert.deepEqual(await answer(await start(h, ADDRESS, '192.0.2.99')), { status: 200, json: { ok: true } });
  assert.equal(h.mail.length, mailed + 1, 'the owner\'s start mails a link');
  assert.equal(codeFrom(h), newest, 'the newest live link is sent again');
  assert.equal(challenges(h.db).length, rows, 'no code is minted at the cap');
  assert.deepEqual(await answer(await verify(h, { code: codeFrom(h), ip: '192.0.2.99' })), { status: 200, json: { ok: true } });
  assert.equal(accounts(h.db).length, 1);
});

test('item 3: re-sends of a live link are capped each hour', async () => {
  const h = harness();
  for (let i = 0; i < 40; i += 1) {
    assert.deepEqual(await answer(await start(h, ADDRESS, `192.0.2.${20 + (i % 20)}`)), { status: 200, json: { ok: true } }, `start ${i + 1}`);
  }
  assert.equal(h.mail.filter((m) => m.to === ADDRESS).length, 1 + SIGNUP_LIMITS.resendsPerAddressHour, 'one mint plus re-sends, and no more');
  assert.equal(challenges(h.db).length, 1, 'no new link while one is live');
});

test('item 3: an expired link is never sent again, and the next start mints a new one', async () => {
  const h = harness();
  await start(h);
  const first = codeFrom(h);
  h.clock.ms = T0 + SIGNUP_LIMITS.codeTtlMs - 1;
  await start(h, ADDRESS, '192.0.2.98');
  assert.equal(codeFrom(h), first, 'inside its life the link is sent again');
  h.clock.ms = T0 + SIGNUP_LIMITS.codeTtlMs;
  assert.deepEqual(await answer(await start(h, ADDRESS, '192.0.2.99')), { status: 200, json: { ok: true } });
  assert.notEqual(codeFrom(h), first, 'a new link once the old one has expired');
  assert.equal((await verify(h, { code: first, ip: '192.0.2.99' })).status, 401);
  assert.equal((await verify(h, { code: codeFrom(h), ip: '192.0.2.99' })).status, 200);
});

test('item 3: inside a code\'s life an address with an account is sent nothing, with the same statements as one with a live link', async () => {
  const h = harness();
  await start(h);
  assert.equal((await verify(h, { code: codeFrom(h) })).status, 200);
  await start(h, 'fresh@example.test', '192.0.2.30');
  const sqlOf = async (email, ip) => {
    const from = h.db.bound.length;
    assert.deepEqual(await answer(await start(h, email, ip)), { status: 200, json: { ok: true } });
    return h.db.bound.slice(from).map((s) => s.sql);
  };
  const mailed = h.mail.length;
  const existing = await sqlOf(ADDRESS, '192.0.2.40');
  assert.equal(h.mail.length, mailed, 'no link goes to an address that has an account');
  const fresh = await sqlOf('fresh@example.test', '192.0.2.41');
  assert.deepEqual(h.mail.slice(mailed).map((m) => m.to), ['fresh@example.test']);
  assert.deepEqual(existing, fresh);
});

test('item 3: a live link is kept sealed for a re-send, and dropped once spent', async () => {
  const h = harness();
  await start(h);
  const code = codeFrom(h);
  const [live] = challenges(h.db);
  assert.equal(typeof live.link_box, 'string');
  assert.equal(live.link_box.includes(code), false, 'the box is not the token in the clear');
  const keys = await accountKeys(h.env);
  assert.equal(await keys.openLink(live.link_box, live.address_key), code);
  await assert.rejects(keys.openLink(live.link_box, 'f'.repeat(64)), 'the box is bound to its address key');
  assert.equal((await verify(h, { code })).status, 200);
  assert.equal(challenges(h.db)[0].link_box, null);
});

// Third security review, item 2: strangers' 3 starts used the per-address
// mint cap and their next 3 the re-send cap, so once those links expired the
// owner's start answered 200 and mailed nothing until the hour ended. A start
// now mints whenever no link is live for the address (one live at a time),
// and otherwise re-sends the live one inside the re-send cap.
test('third review, item 2: strangers\' 3 mints and 3 re-sends, then the owner\'s start 11 minutes later mails a working link', async () => {
  const h = harness();
  for (let i = 0; i < 6; i += 1) {
    assert.equal((await start(h, ADDRESS, `192.0.2.${20 + i}`)).status, 200, `stranger start ${i + 1}`);
  }
  h.clock.ms = T0 + 11 * 60 * 1000;
  const mailed = h.mail.length;
  assert.deepEqual(await answer(await start(h, ADDRESS, '192.0.2.99')), { status: 200, json: { ok: true } });
  assert.equal(h.mail.length, mailed + 1, 'the owner\'s start mails a link');
  assert.deepEqual(await answer(await verify(h, { code: codeFrom(h), ip: '192.0.2.99' })), { status: 200, json: { ok: true } });
  assert.equal(accounts(h.db).length, 1);
});

test('third review, item 2: strangers starting every 10 s for an hour never leave the owner without a working link', async () => {
  const h = harness();
  const step = 10_000;
  const ownerAt = 30 * 60 * 1000 + 5_000;
  for (let t = 0; t < ownerAt; t += step) {
    h.clock.ms = T0 + t;
    assert.equal((await start(h, ADDRESS, `198.51.100.${(t / step) % 40}`)).status, 200, `stranger start at ${t} ms`);
  }
  h.clock.ms = T0 + ownerAt;
  assert.deepEqual(await answer(await start(h, ADDRESS, '192.0.2.99')), { status: 200, json: { ok: true } });
  assert.deepEqual(await answer(await verify(h, { code: codeFrom(h), ip: '192.0.2.99' })), { status: 200, json: { ok: true } },
    'the newest link in the owner\'s mailbox works');
});

test('third review, item 2: one link is live at a time, and mail to one address stays bounded each hour', async () => {
  const h = harness();
  const live = () => h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM challenge WHERE used = 0 AND expires_at > ?').get(h.clock.ms).n;
  const minute = 60_000;
  for (let i = 0; i < 60; i += 1) {
    h.clock.ms = T0 + i * minute;
    assert.deepEqual(await answer(await start(h, ADDRESS, `198.51.100.${i % 20}`)), { status: 200, json: { ok: true } }, `start ${i + 1}`);
    assert.ok(live() <= 1, `at most one live link at minute ${i}`);
  }
  const mintsPerHour = SIGNUP_LIMITS.windowMs / SIGNUP_LIMITS.codeTtlMs;
  assert.equal(challenges(h.db).length, mintsPerHour, 'a new link only when none is live');
  assert.equal(h.mail.filter((m) => m.to === ADDRESS).length, mintsPerHour + SIGNUP_LIMITS.resendsPerAddressHour, 'mints plus re-sends, and no more');
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
    assert.equal((await verify(h, { email: `spray-${i}@example.test`, code: NEVER_SENT })).status, 401);
  }
  assert.deepEqual(await answer(await verify(h, { code: NEVER_SENT })), { status: 429, json: { error: 'slow-down' } });
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
  const wrongExisting = await answer(await verify(h, { code: NEVER_SENT, ip: '192.0.2.32' }));
  const wrongFresh = await answer(await verify(h, { email: 'fresh@example.test', code: wrongOf(codeFrom(h, 'fresh@example.test')), ip: '192.0.2.32' }));
  assert.deepEqual(wrongExisting, wrongFresh);
});

// M1 (security review): a start for an address with an account skipped the
// challenge write, so the time to answer said which addresses have accounts.
// Both paths now send the same statements in the same order. Third review,
// item 2: once the account's spent code is past its life, both mint (a code
// still inside its life re-sends, tested under item 3 below).
test('a start sends the same statements whether or not the address has an account', async () => {
  const h = harness();
  await start(h);
  await verify(h, { code: codeFrom(h) });
  h.clock.ms = T0 + SIGNUP_LIMITS.codeTtlMs;
  const sqlOf = async (email, ip) => {
    const from = h.db.bound.length;
    assert.equal((await start(h, email, ip)).status, 200);
    return h.db.bound.slice(from).map((s) => s.sql);
  };
  const existing = await sqlOf(ADDRESS, '192.0.2.40');
  const fresh = await sqlOf('fresh@example.test', '192.0.2.41');
  assert.ok(fresh.some((sql) => /INSERT INTO challenge/.test(sql)), 'the fresh path writes a code');
  assert.deepEqual(existing, fresh);
  const live = h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM challenge WHERE used = 0').get().n;
  assert.equal(live, 1, 'only the fresh address holds a code that can verify');
});

// L3 (security review): a request with no cf-connecting-ip was counted under
// one shared requester, so every such request filled one bucket for all of
// them. Such a request is now refused as shape on every route that counts by
// requester, before any throttle row, code, ticket or mail.
test('L3: a start, verify or sign-in without a connecting address is refused as shape and writes nothing', async () => {
  const h = harness();
  const bare = [
    ['/account', { email: ADDRESS }],
    ['/account/email/verify', { email: ADDRESS, code: NEVER_SENT, password: PASSWORD }],
    ['/signin', { email: ADDRESS, password: PASSWORD, keyDigest: ANY_KEY_DIGEST }],
  ];
  for (const [pathname, body] of bare) {
    for (const headers of [{}, { 'cf-connecting-ip': '' }, { 'cf-connecting-ip': '   ' }]) {
      assert.deepEqual(await answer(await h.call(post(pathname, body, headers))), { status: 400, json: { error: 'shape' } },
        `${pathname} ${JSON.stringify(headers)}`);
    }
  }
  for (const table of ['throttle', 'challenge', 'ticket', 'account']) {
    assert.equal(h.db.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, `no ${table} row`);
  }
  assert.equal(h.mail.length, 0, 'no mail');
  assert.ok(auditRows(h.db).every((r) => r.reason === 'shape'), 'every refusal is audited as shape');
});

test('L3 NEGATIVE CONTROL: the same start with a connecting address is admitted and counted under it', async () => {
  const h = harness();
  assert.deepEqual(await answer(await start(h)), { status: 200, json: { ok: true } });
  assert.equal(h.mail.length, 1);
  const requester = await (await accountKeys({ HZ_ACCOUNT_KEY: h.env.HZ_ACCOUNT_KEY })).requesterKey(IP);
  const buckets = h.db.sqlite.prepare('SELECT bucket FROM throttle').all().map((r) => r.bucket);
  assert.ok(buckets.includes(`start-requester:${requester}`), 'the start is counted under its own requester');
});

// M2 (security review): an invisible format character or a look-alike
// letter in the local part made a new address key for the same mailbox, so
// the per-address limits did not hold. Such addresses are refused as shape,
// at sign-up and at sign-in, before any write.
test('M2: an address with a format or zero-width character, or a non-ASCII local part, is refused as shape', async () => {
  const h = harness();
  const zw = (c) => String.fromCharCode(c);
  const bad = [
    `new${zw(0x200b)}-user@example.test`,
    `new-user${zw(0x200d)}@example.test`,
    `${zw(0xfeff)}new-user@example.test`,
    `new${zw(0x00ad)}-user@example.test`,
    `new-user@exa${zw(0x200c)}mple.test`,
    `new-user@example.test${zw(0x2060)}`,
    `n${zw(0x0435)}w-user@example.test`,
    `${zw(0xff4e)}ew-user@example.test`,
  ];
  for (const email of bad) {
    assert.deepEqual(await answer(await start(h, email)), { status: 400, json: { error: 'shape' } }, JSON.stringify(email));
    assert.deepEqual(await answer(await verify(h, { email, code: NEVER_SENT })), { status: 400, json: { error: 'shape' } }, JSON.stringify(email));
    assert.deepEqual(await answer(await h.call(post('/signin', { email, password: PASSWORD, keyDigest: ANY_KEY_DIGEST }, { 'cf-connecting-ip': IP }))), { status: 400, json: { error: 'shape' } }, JSON.stringify(email));
  }
  assert.deepEqual(h.mail, []);
  assert.deepEqual(challenges(h.db), []);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM throttle').get().n, 0, 'a refused address is not counted');
});

test('NEGATIVE CONTROL: an ASCII local part with a non-ASCII domain, a dot or a plus still starts', async () => {
  const h = harness();
  for (const [email, ip] of [['first.last@example.test', '192.0.2.50'], ['new-user+notes@example.test', '192.0.2.51'], ['new-user@bücher.example.test', '192.0.2.52']]) {
    assert.deepEqual(await answer(await start(h, email, ip)), { status: 200, json: { ok: true } }, email);
  }
  assert.equal(h.mail.length, 3);
});

// Item 6 (second security review): the domain was only lower-cased, so a
// trailing dot (the DNS root) made a new address key for the same mailbox,
// and a domain with characters no DNS name has was accepted. The address is
// now keyed by its DNS name: one trailing dot stripped, IDNA-mapped to ASCII,
// and every label letters, digits and inner hyphens.
const codeAddressKeys = (h) => h.db.sqlite.prepare("SELECT DISTINCT address_key FROM challenge").all().map((r) => r.address_key);

test('item 6: a trailing dot or another case is the same address as the plain one', async () => {
  const h = harness();
  assert.deepEqual(await answer(await start(h, 'v@example.test.')), { status: 200, json: { ok: true } });
  const code = codeFrom(h, 'v@example.test');
  assert.deepEqual(await answer(await verify(h, { email: 'V@EXAMPLE.TEST', code })), { status: 200, json: { ok: true } });
  assert.equal(accounts(h.db).length, 1);

  const k = harness();
  for (const [email, ip] of [['v@example.test.', '192.0.2.60'], ['V@EXAMPLE.TEST', '192.0.2.61'], ['v@example.test', '192.0.2.62']]) {
    assert.deepEqual(await answer(await start(k, email, ip)), { status: 200, json: { ok: true } }, email);
  }
  assert.equal(codeAddressKeys(k).length, 1, 'the three spellings share one address key, so the later starts re-send the first link');
  assert.ok(k.mail.every((m) => m.to === 'v@example.test'), 'every mail goes to the plain address');
});

test('item 6: a full-width or decomposed spelling of a domain is the same address as its DNS name', async () => {
  const pairs = [
    ['v@ｅｘａｍｐｌｅ.test', 'v@example.test'],
    ['v@bücher.example.test', 'v@bücher.example.test'],
  ];
  for (const [odd, plain] of pairs) {
    const h = harness();
    await start(h, odd, '192.0.2.70');
    await start(h, plain, '192.0.2.71');
    assert.equal(codeAddressKeys(h).length, 1, JSON.stringify(odd));
    assert.equal(new Set(h.mail.map((m) => m.to)).size, 1, JSON.stringify(odd));
  }
});

test('item 6: a domain that is not a plain DNS name is refused as shape before any write', async () => {
  const h = harness();
  const bad = [
    'v@-example.test',
    'v@example-.test',
    'v@example..test',
    'v@.example.test',
    'v@example.test..',
    'v@exa_mple.test',
    'v@exa%41mple.test',
    'v@exa!mple.test',
    'v@exa*mple.test',
    'v@example.123',
    `v@${'a'.repeat(64)}.test`,
  ];
  for (const email of bad) {
    assert.deepEqual(await answer(await start(h, email)), { status: 400, json: { error: 'shape' } }, email);
    assert.deepEqual(await answer(await verify(h, { email, code: NEVER_SENT })), { status: 400, json: { error: 'shape' } }, email);
    assert.deepEqual(await answer(await h.call(post('/signin', { email, password: PASSWORD, keyDigest: ANY_KEY_DIGEST }, { 'cf-connecting-ip': IP }))), { status: 400, json: { error: 'shape' } }, email);
  }
  assert.deepEqual(h.mail, []);
  assert.deepEqual(challenges(h.db), []);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM throttle').get().n, 0, 'a refused address is not counted');
});

// M2: every '+tag' of one mailbox was its own address, so the per-address
// start limit did not bound mail to that mailbox. Tagged starts share one
// bucket per mailbox (the address with the tag stripped). The account key
// stays the full address, and the plain address keeps its own bucket, so a
// flood of tags cannot stop the owner's own sign-up.
test('M2: starts for every +tag of one mailbox share one limit, and the plain address is not held by it', async () => {
  assert.equal(SIGNUP_LIMITS.codesPerMailboxHour, 10, 'R2: 10 mints an hour for the +tags of one mailbox');
  const h = harness();
  for (let i = 0; i < SIGNUP_LIMITS.codesPerMailboxHour; i += 1) {
    assert.equal((await start(h, `new-user+t${i}@example.test`, `192.0.2.${60 + i}`)).status, 200);
  }
  const mailed = h.mail.length;
  // Item 3: at the cap the answer is the same 200, and a tag with no live
  // link of its own is sent nothing.
  assert.deepEqual(await answer(await start(h, 'new-user+another@example.test', '192.0.2.90')), { status: 200, json: { ok: true } });
  assert.deepEqual(await answer(await start(h, 'NEW-USER+Upper@example.test', '192.0.2.91')), { status: 200, json: { ok: true } }, 'case does not make a new mailbox');
  assert.equal(h.mail.length, mailed, 'no mail once the mailbox is limited');
  assert.equal(challenges(h.db).length, SIGNUP_LIMITS.codesPerMailboxHour, 'no code is minted once the mailbox is limited');
  assert.equal((await start(h, 'other+t0@example.test', '192.0.2.92')).status, 200, 'another mailbox is not limited');
  assert.equal((await start(h, ADDRESS, '192.0.2.93')).status, 200, 'the plain address still starts');
  assert.equal((await verify(h, { code: codeFrom(h), ip: '192.0.2.93' })).status, 200);
  h.clock.ms = T0 + SIGNUP_LIMITS.windowMs;
  assert.equal((await start(h, 'new-user+late@example.test', '192.0.2.94')).status, 200, 'the limit lifts after its window');
});

test('M2 NEGATIVE CONTROL: the account key stays the full address, tag included', async () => {
  const h = harness();
  await start(h, 'new-user+notes@example.test');
  assert.equal((await verify(h, { email: 'new-user+notes@example.test', code: codeFrom(h, 'new-user+notes@example.test') })).status, 200);
  const keys = await accountKeys(h.env);
  const [row] = accounts(h.db);
  assert.equal(row.address_key, await keys.addressKey('new-user+notes@example.test'));
  assert.notEqual(row.address_key, await keys.addressKey(ADDRESS));
  await start(h, ADDRESS, '192.0.2.95');
  assert.equal((await verify(h, { code: codeFrom(h), ip: '192.0.2.95' })).status, 200, 'the plain address makes its own account');
  assert.equal(accounts(h.db).length, 2);
});

// M2: nothing bounded the codes sent in a day across every address and
// requester. A global daily cap does, from configuration (HZ_CODES_PER_DAY)
// with a safe default; a value that is set but is not a whole number of 1 or
// more stops sign-up starts instead of opening the cap.
test('M2: codes sent are capped per day across every address and requester', async () => {
  const h = harness({ env: { HZ_CODES_PER_DAY: '2' } });
  assert.equal((await start(h, 'one@example.test', '192.0.2.70')).status, 200);
  assert.equal((await start(h, 'two@example.test', '192.0.2.71')).status, 200);
  assert.deepEqual(await answer(await start(h, 'three@example.test', '192.0.2.72')), { status: 429, json: { error: 'slow-down' } });
  assert.equal(h.mail.length, 2);
  h.clock.ms = T0 + SIGNUP_LIMITS.windowMs;
  assert.deepEqual(await answer(await start(h, 'three@example.test', '192.0.2.73')), { status: 429, json: { error: 'slow-down' } }, 'an hour does not lift a daily cap');
  h.clock.ms = T0 + SIGNUP_LIMITS.dayMs;
  assert.equal((await start(h, 'three@example.test', '192.0.2.74')).status, 200, 'the cap lifts after a day');
  assert.equal(h.mail.length, 3);
});

test('M2: without configuration the daily cap is the default, and a bad value refuses starts', async () => {
  assert.ok(Number.isInteger(SIGNUP_LIMITS.codesPerDay) && SIGNUP_LIMITS.codesPerDay >= 1);
  const h = harness();
  const from = h.db.bound.length;
  assert.equal((await start(h)).status, 200);
  const throttle = h.db.bound.slice(from).find((s) => /INSERT INTO throttle/.test(s.sql));
  assert.ok(throttle.values.includes('codes-day'), 'the start pays the daily bucket');
  assert.ok(throttle.values.includes(SIGNUP_LIMITS.codesPerDay), 'at the default limit');
  for (const bad of ['0', '-1', '1.5', 'many', '']) {
    const b = harness({ env: { HZ_CODES_PER_DAY: bad } });
    assert.deepEqual(await answer(await start(b)), { status: 503, json: { error: 'unavailable' } }, JSON.stringify(bad));
    assert.deepEqual(b.mail, []);
    assert.deepEqual(challenges(b.db), []);
  }
});

// Second review, item 5: a hard cap of 500 starts a day let a stranger stop
// every sign-up. The hard cap is the mail plan's limit (HZ_CODES_PER_DAY,
// default 3000), and at half of it one alert a day goes to the operator
// address (HZ_ALERT_TO, set at deploy; here a fake).
const OPERATOR = 'operator@example.test';
const alertsIn = (h) => h.mail.filter((m) => m.to === OPERATOR);
const startsFrom = async (h, count, tag) => {
  const statuses = [];
  for (let i = 0; i < count; i += 1) {
    statuses.push((await start(h, `${tag}-${i}@example.test`, `198.51.100.${i + 1}`)).status);
  }
  return statuses;
};

test('item 5: without configuration the hard daily cap is the mail plan limit, 3000', () => {
  assert.equal(SIGNUP_LIMITS.codesPerDay, 3000);
  assert.equal(SIGNUP_LIMITS.alertAtPercent, 50);
});

test('item 5: the alert fires once at 50 percent of the daily cap and sign-ups continue below the hard cap', async () => {
  const h = harness({ env: { HZ_CODES_PER_DAY: '10', HZ_ALERT_TO: OPERATOR } });
  assert.deepEqual(await startsFrom(h, 4, 'early'), [200, 200, 200, 200]);
  assert.deepEqual(alertsIn(h), [], 'no alert below half the cap');
  assert.deepEqual(await startsFrom(h, 1, 'half'), [200]);
  assert.equal(alertsIn(h).length, 1, 'one alert at half the cap');
  assert.deepEqual(await startsFrom(h, 5, 'late'), [200, 200, 200, 200, 200], 'sign-ups continue past half');
  assert.equal(alertsIn(h).length, 1, 'still one alert');
  assert.equal(h.mail.filter((m) => m.to !== OPERATOR).length, 10, 'every start below the hard cap mailed its link');
  assert.deepEqual(await answer(await start(h, 'over@example.test', '198.51.100.99')), { status: 429, json: { error: 'slow-down' } }, 'the hard cap still holds');
  const [alert] = alertsIn(h);
  assert.match(alert.subject, /half the daily cap/);
  assert.match(alert.text, /\b5\b/);
  assert.match(alert.text, /\b10\b/);
  assert.equal(/@/.test(alert.text), false, 'the alert names no address');
  assert.equal(`${alert.subject}${alert.text}`.includes(String.fromCharCode(0x2014)), false, 'no em dash');
});

test('item 5: one alert a day, and the next day can alert again', async () => {
  const h = harness({ env: { HZ_CODES_PER_DAY: '4', HZ_ALERT_TO: OPERATOR } });
  await startsFrom(h, 3, 'one');
  assert.equal(alertsIn(h).length, 1);
  h.clock.ms = T0 + SIGNUP_LIMITS.dayMs - 1;
  await startsFrom(h, 1, 'two');
  assert.equal(alertsIn(h).length, 1, 'no second alert inside the day');
  h.clock.ms = T0 + 2 * SIGNUP_LIMITS.dayMs;
  await startsFrom(h, 2, 'three');
  assert.equal(alertsIn(h).length, 2, 'a new day at half the cap alerts again');
});

test('item 5: at half the cap without an alert address the start is audited alert-unset and the answer is unchanged', async () => {
  const h = harness({ env: { HZ_CODES_PER_DAY: '2' } });
  assert.deepEqual(await startsFrom(h, 1, 'no-alert'), [200]);
  assert.deepEqual(auditRows(h.db), [{ route: '/account', reason: 'ok' }, { route: '/account', reason: 'alert-unset' }]);
  assert.equal(h.mail.length, 1, 'only the sign-up link is mailed');
  const bad = harness({ env: { HZ_CODES_PER_DAY: '2', HZ_ALERT_TO: 'not an address' } });
  assert.deepEqual(await startsFrom(bad, 1, 'bad-alert'), [200]);
  assert.deepEqual(auditRows(bad.db).at(-1), { route: '/account', reason: 'alert-unset' });
});

test('item 5: an alert that cannot be sent is audited alert-failed and the link still goes out', async () => {
  const sent = [];
  const h = harness({
    env: { HZ_CODES_PER_DAY: '2', HZ_ALERT_TO: OPERATOR },
    mailer: async (m) => { if (m.to === OPERATOR) return false; sent.push(m); return true; },
  });
  assert.deepEqual(await startsFrom(h, 1, 'alert-down'), [200]);
  assert.equal(sent.length, 1);
  assert.deepEqual(auditRows(h.db), [{ route: '/account', reason: 'ok' }, { route: '/account', reason: 'alert-failed' }]);
});

test('item 5: the alert check sends the same statements whether or not the address has an account', async () => {
  const h = harness({ env: { HZ_CODES_PER_DAY: '6', HZ_ALERT_TO: OPERATOR } });
  await start(h);
  await verify(h, { code: codeFrom(h) });
  h.clock.ms = T0 + SIGNUP_LIMITS.codeTtlMs; // the spent code's life is over, so both starts mint
  const shape = (s) => s.sql.replace(/\s+/g, ' ');
  const from = h.db.bound.length;
  await start(h, ADDRESS, '198.51.100.50');
  const withAccount = h.db.bound.slice(from).map(shape);
  const mid = h.db.bound.length;
  await start(h, 'fresh@example.test', '198.51.100.51');
  const without = h.db.bound.slice(mid).map(shape);
  assert.deepEqual(withAccount, without);
  assert.equal(alertsIn(h).length, 1, 'the third start reached half the cap');
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
    assert.deepEqual(await answer(await verify(h, { code: NEVER_SENT })), { status: 503, json: { error: 'unavailable' } });
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

test('the sign-up mail has a plain subject, the link with the token, and no em dash', async () => {
  const h = harness();
  await start(h);
  const [m] = h.mail;
  const code = codeFrom(h);
  assert.equal(typeof m.subject, 'string');
  assert.ok(m.subject.length > 0 && !m.subject.includes(code), 'the subject carries no token');
  assert.ok(m.text.includes(`${LINK_BASE}#${code}`));
  assert.equal(`${m.subject}${m.text}`.includes(String.fromCharCode(0x2014)), false);
});
