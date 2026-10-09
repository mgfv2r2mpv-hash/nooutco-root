// Turnstile on POST /account and an unsigned POST /signin (design of 8 Oct
// 2026, section 2): src/turnstile.js, its place in the two routes, and the
// GET /challenge page. siteverify is always a fake (helpers.mjs
// fakeSiteverify, over Cloudflare's documented test keys) or a stub here, so
// no test reaches Cloudflare.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  harness, post, signed, auditRows, everyRow, signUp, registeredDevice, passToken, fakeSiteverify,
  TURNSTILE_PASS, TURNSTILE_FAIL, TURNSTILE_HOST, ANY_KEY_DIGEST, PASSWORD, ORIGIN, T0,
} from './helpers.mjs';
import {
  verifyTurnstile, SITEVERIFY_URL, SITEVERIFY_TIMEOUT_MS, TOKEN_MAX_AGE_MS, MAX_TOKEN_LENGTH, NOT_CONFIGURED_SENTENCE,
} from '../src/turnstile.js';
import { PAGE_SCRIPT, PAGE_STYLE, FRAME_ORIGINS, TURNSTILE_SCRIPT } from '../src/challenge-page.js';
import { DAILY_BUCKET } from '../src/signup.js';
import { createHandler } from '../src/index.js';

const ADDRESS = 'turnstile-user@example.test';
const IP = '192.0.2.70';
const ENV = Object.freeze({ HZ_TURNSTILE_SECRET: TURNSTILE_PASS.secret });

const answer = async (res) => ({ status: res.status, json: await res.json() });
const refusal = async (promise) => {
  try {
    await promise;
  } catch (err) {
    return { reason: err.reason, status: err.status, sentence: err.sentence };
  }
  return null;
};

// A siteverify stub that answers `json` (or throws `error`) and records each call.
function stub(json, { status = 200, error = null, text = null } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, form: Object.fromEntries(init.body.entries()) });
    if (error) throw error;
    return new Response(text ?? JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}
const good = (over = {}) => ({ success: true, 'error-codes': [], challenge_ts: new Date(T0).toISOString(), hostname: TURNSTILE_HOST, action: 'account', ...over });
// `token` given as undefined stays undefined (a body with no token).
const verify = (siteverify, options = {}) => {
  const { env = ENV, action = 'account', ip = IP, now = T0 } = options;
  const token = Object.hasOwn(options, 'token') ? options.token : 'tok.en-1';
  return verifyTurnstile(env, token, { action, ip, now, siteverify });
};

test('a token siteverify passes for this hostname, this action and inside 300 s is accepted', async () => {
  const sv = stub(good());
  assert.equal(await refusal(verify(sv)), null);
  assert.equal(sv.calls.length, 1);
  assert.equal(sv.calls[0].url, SITEVERIFY_URL);
  assert.equal(sv.calls[0].init.method, 'POST');
  assert.ok(sv.calls[0].init.signal instanceof AbortSignal, 'the call carries a timeout signal');
  const { form } = sv.calls[0];
  assert.equal(form.secret, TURNSTILE_PASS.secret);
  assert.equal(form.response, 'tok.en-1');
  assert.equal(form.remoteip, IP);
  assert.match(form.idempotency_key, /^[0-9a-f-]{36}$/);
  assert.equal(SITEVERIFY_TIMEOUT_MS, 5000);
});

test('siteverify saying no, another hostname, another action or a stale or future challenge_ts answers challenge (403)', async () => {
  const cases = {
    'success false': { success: false, 'error-codes': ['invalid-input-response'] },
    'timeout-or-duplicate': { success: false, 'error-codes': ['timeout-or-duplicate'] },
    'success missing': { ...good(), success: undefined },
    'success the string true': { ...good(), success: 'true' },
    'another hostname': good({ hostname: 'example.com' }),
    'a lookalike hostname': good({ hostname: `${TURNSTILE_HOST}.example.com` }),
    'another action': good({ action: 'signin' }),
    'no action': good({ action: '' }),
    'stale challenge_ts': good({ challenge_ts: new Date(T0 - TOKEN_MAX_AGE_MS - 1).toISOString() }),
    'future challenge_ts': good({ challenge_ts: new Date(T0 + 120_000).toISOString() }),
    'no challenge_ts': good({ challenge_ts: undefined }),
  };
  for (const [label, json] of Object.entries(cases)) {
    assert.deepEqual(await refusal(verify(stub(json))), { reason: 'challenge', status: 403, sentence: undefined }, label);
  }
  assert.equal(await refusal(verify(stub(good({ challenge_ts: new Date(T0 - TOKEN_MAX_AGE_MS + 1000).toISOString() })))), null, 'NEGATIVE CONTROL: inside the 300 s');
});

test('FAIL CLOSED: siteverify timing out, failing, answering non-JSON or its own internal-error answers unavailable (503)', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const cases = {
    timeout: stub(null, { error: timeout }),
    'network error': stub(null, { error: new TypeError('fetch failed') }),
    'HTTP 500': stub({}, { status: 500 }),
    'not JSON': stub(null, { text: '<html>busy</html>' }),
    'JSON null': stub(null, { text: 'null' }),
    'internal-error': stub({ success: false, 'error-codes': ['internal-error'] }),
  };
  for (const [label, sv] of Object.entries(cases)) {
    assert.deepEqual(await refusal(verify(sv)), { reason: 'unavailable', status: 503, sentence: undefined }, label);
  }
  assert.deepEqual(await refusal(verifyTurnstile(ENV, 'tok', { action: 'account', ip: IP, now: T0, siteverify: null })), { reason: 'unavailable', status: 503, sentence: undefined });
});

test('FAIL CLOSED: with HZ_TURNSTILE_SECRET unset or blank, or a secret siteverify rejects, the answer is not-configured and names no value', async () => {
  for (const env of [{}, { HZ_TURNSTILE_SECRET: '' }, { HZ_TURNSTILE_SECRET: '   ' }, { HZ_TURNSTILE_SECRET: 42 }]) {
    const sv = stub(good());
    assert.deepEqual(await refusal(verify(sv, { env })), { reason: 'not-configured', status: 503, sentence: NOT_CONFIGURED_SENTENCE }, JSON.stringify(env));
    assert.equal(sv.calls.length, 0, 'no subrequest without a secret');
  }
  for (const code of ['invalid-input-secret', 'missing-input-secret']) {
    assert.equal((await refusal(verify(stub({ success: false, 'error-codes': [code] })))).reason, 'not-configured', code);
  }
  assert.doesNotMatch(NOT_CONFIGURED_SENTENCE, /0x|1x|secret =|sitekey =/i);
});

test('a missing, empty, oversized or non-printable token is shape (400) before any subrequest', async () => {
  for (const token of [undefined, null, '', 42, {}, ['t'], 'x'.repeat(MAX_TOKEN_LENGTH + 1), 'has space', 'tab\there', 'line\nbreak', 'é-accent']) {
    const sv = stub(good());
    assert.deepEqual(await refusal(verify(sv, { token })), { reason: 'shape', status: 400, sentence: undefined }, JSON.stringify(token));
    assert.equal(sv.calls.length, 0, `no subrequest for ${JSON.stringify(token)}`);
  }
  assert.equal(await refusal(verify(stub(good()), { token: 'x'.repeat(MAX_TOKEN_LENGTH) })), null, 'NEGATIVE CONTROL: 2048 characters is a token');
});

test('the fake siteverify behaves as Cloudflare\'s test keys do: the 1x secret passes once, the 2x secret always fails', async () => {
  const clock = { ms: T0 };
  const sv = fakeSiteverify(clock);
  const token = passToken('account');
  assert.equal(await refusal(verify(sv, { token })), null);
  assert.equal((await refusal(verify(sv, { token }))).reason, 'challenge', 'single use: timeout-or-duplicate');
  assert.equal((await refusal(verify(sv, { env: { HZ_TURNSTILE_SECRET: TURNSTILE_FAIL.secret }, token: passToken('account') }))).reason, 'challenge');
  assert.equal((await refusal(verify(sv, { token: passToken('signin') }))).reason, 'challenge', 'a sign-in token is not an account token');
});

// The routes.
const startBody = (turnstile) => ({ email: ADDRESS, ...(turnstile === undefined ? {} : { turnstile }) });
const start = (h, turnstile, ip = IP) => h.call(post('/account', startBody(turnstile), { 'cf-connecting-ip': ip }));
const throttleRows = (h, bucket) => h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM throttle WHERE bucket = ?').get(bucket).n;
const allThrottle = (h) => h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM throttle').get().n;

test('/account with a passing token starts the sign-up and spends one daily place', async () => {
  const h = harness();
  assert.equal((await start(h, passToken('account'))).status, 200);
  assert.equal(throttleRows(h, DAILY_BUCKET), 1);
  assert.equal(h.mail.length, 1);
  assert.equal(h.siteverify.calls.at(-1).form.remoteip, IP, 'siteverify gets the connecting address');
});

test('NEGATIVE CONTROL: a failed challenge on /account leaves the daily bucket and every other bucket unchanged, and sends no mail', async () => {
  const h = harness({ env: { HZ_TURNSTILE_SECRET: TURNSTILE_FAIL.secret } });
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(await answer(await start(h, passToken('account'))), { status: 403, json: { error: 'challenge' } });
  }
  assert.equal(throttleRows(h, DAILY_BUCKET), 0, 'no daily place spent');
  assert.equal(allThrottle(h), 0, 'no bucket row at all');
  assert.equal(h.mail.length, 0);
  assert.deepEqual(auditRows(h.db).at(-1), { route: '/account', reason: 'challenge' });
});

test('/account with no token, a reused token or a sign-in token is refused before any bucket', async () => {
  const h = harness();
  assert.deepEqual(await answer(await start(h)), { status: 400, json: { error: 'shape' } });
  const token = passToken('account');
  assert.equal((await start(h, token)).status, 200);
  const spent = allThrottle(h);
  assert.deepEqual(await answer(await start(h, token)), { status: 403, json: { error: 'challenge' } }, 'single use');
  assert.deepEqual(await answer(await start(h, passToken('signin'))), { status: 403, json: { error: 'challenge' } }, 'action is checked');
  assert.equal(allThrottle(h), spent, 'neither refusal counted');
  assert.deepEqual(await answer(await h.call(post('/account', { email: ADDRESS, turnstile: passToken('account'), extra: 1 }, { 'cf-connecting-ip': IP }))), { status: 400, json: { error: 'shape' } });
});

test('FAIL CLOSED: with the keys unset, /account answers not-configured with its sentence, whatever the body carries, and writes no bucket', async () => {
  const h = harness({ env: { HZ_TURNSTILE_SECRET: undefined, HZ_TURNSTILE_SITEKEY: undefined } });
  for (const turnstile of [undefined, passToken('account')]) {
    assert.deepEqual(await answer(await start(h, turnstile)), { status: 503, json: { error: 'not-configured', message: NOT_CONFIGURED_SENTENCE } });
  }
  assert.equal(allThrottle(h), 0);
  assert.equal(h.mail.length, 0);
  assert.equal(h.siteverify.calls.length, 0, 'no siteverify call without a secret');
});

test('FAIL CLOSED: siteverify timing out on /account answers unavailable and spends no daily place', async () => {
  const h = harness({ siteverify: stub(null, { error: new TypeError('fetch failed') }) });
  assert.deepEqual(await answer(await start(h, passToken('account'))), { status: 503, json: { error: 'unavailable' } });
  assert.equal(throttleRows(h, DAILY_BUCKET), 0);
});

const signinBody = (turnstile) => ({ email: ADDRESS, password: PASSWORD, keyDigest: ANY_KEY_DIGEST, ...(turnstile === undefined ? {} : { turnstile }) });
const unsignedSignIn = (h, turnstile, ip = IP) => h.call(post('/signin', signinBody(turnstile), { 'cf-connecting-ip': ip }));
const signedSignIn = async (h, device, turnstile) => h.call(await signed(h.call, device, '/signin', signinBody(turnstile), { headers: { 'cf-connecting-ip': IP } }));
const signinRows = (h) => h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM throttle WHERE bucket LIKE 'signin-%'").get().n;

test('an unsigned /signin needs a passing sign-in token; a failed one counts in no sign-in bucket', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  assert.deepEqual(await answer(await unsignedSignIn(h)), { status: 400, json: { error: 'shape' } });
  assert.deepEqual(await answer(await unsignedSignIn(h, passToken('account'))), { status: 403, json: { error: 'challenge' } });
  assert.equal(signinRows(h), 0, 'no sign-in bucket row for a refused challenge');
  assert.equal((await unsignedSignIn(h, passToken('signin'))).status, 200, 'NEGATIVE CONTROL: a passing token signs in');
});

test('a signed /signin from a registered device of the account skips the challenge: no token, no siteverify call, keys set or not', async () => {
  for (const env of [{}, { HZ_TURNSTILE_SECRET: undefined, HZ_TURNSTILE_SITEKEY: undefined }]) {
    const h = harness({ env });
    // The account's owner device registers from the sign-up link, which needs a token only to start.
    const device = await registeredDevice(harnessFor(h), ADDRESS);
    const before = h.siteverify.calls.length;
    const res = await signedSignIn(h, device);
    assert.equal(res.status, 200, JSON.stringify(env));
    assert.equal(h.siteverify.calls.length, before, 'no siteverify call');
  }
});

// With the keys unset, sign-up itself is refused, so the device is seeded
// with the keys on and the harness's bindings then switched back.
function harnessFor(h) {
  const saved = { secret: h.env.HZ_TURNSTILE_SECRET, sitekey: h.env.HZ_TURNSTILE_SITEKEY };
  return {
    ...h,
    call: async (req) => {
      h.env.HZ_TURNSTILE_SECRET = TURNSTILE_PASS.secret;
      try {
        return await h.call(req);
      } finally {
        h.env.HZ_TURNSTILE_SECRET = saved.secret;
        h.env.HZ_TURNSTILE_SITEKEY = saved.sitekey;
      }
    },
  };
}

test('FAIL CLOSED: with the keys unset, an unsigned /signin answers not-configured and counts nothing', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  h.env.HZ_TURNSTILE_SECRET = undefined;
  const rows = signinRows(h);
  for (const turnstile of [undefined, passToken('signin')]) {
    assert.deepEqual(await answer(await unsignedSignIn(h, turnstile)), { status: 503, json: { error: 'not-configured', message: NOT_CONFIGURED_SENTENCE } });
  }
  assert.equal(signinRows(h), rows);
});

test('a device of another account signing a sign-in pays the challenge like an unsigned try', async () => {
  const h = harness();
  await signUp(h, ADDRESS);
  const stranger = await registeredDevice(h, 'stranger@example.test');
  assert.deepEqual(await answer(await signedSignIn(h, stranger)), { status: 400, json: { error: 'shape' } });
  h.env.HZ_TURNSTILE_SECRET = TURNSTILE_FAIL.secret;
  assert.deepEqual(await answer(await signedSignIn(h, stranger, passToken('signin'))), { status: 403, json: { error: 'challenge' } });
});

test('the token is never stored, audited or echoed', async () => {
  const h = harness();
  const token = passToken('account');
  const res = await start(h, token);
  const text = await res.text();
  const refused = await (await start(h, token)).text();
  for (const where of [text, refused, everyRow(h.db), JSON.stringify(auditRows(h.db)), JSON.stringify(h.db.bound.map((b) => b.values))]) {
    assert.equal(where.includes(token), false);
  }
});

// GET /challenge.
const get = (h, pathname) => h.call(new Request(`${ORIGIN}${pathname}`, { method: 'GET' }));
const sha256 = async (text) => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...digest));
};

test('GET /challenge answers the fixed page with the exact CSP, no-store and no referrer', async () => {
  const h = harness();
  const res = await get(h, '/challenge');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(res.headers.get('content-security-policy'), [
    "default-src 'none'",
    `script-src https://challenges.cloudflare.com 'sha256-${await sha256(PAGE_SCRIPT)}'`,
    `style-src 'sha256-${await sha256(PAGE_STYLE)}'`,
    'frame-src https://challenges.cloudflare.com',
    "connect-src 'none'",
    'frame-ancestors https://lc.nooutco.me https://lp.nooutco.me',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '));
  const html = await res.text();
  assert.ok(html.includes(`<script src="${TURNSTILE_SCRIPT}"></script>`));
  assert.ok(html.includes(`<script>${PAGE_SCRIPT}</script>`), 'the inline script is exactly the hashed one');
  assert.ok(html.includes(`data-sitekey="${TURNSTILE_PASS.sitekey}"`));
  assert.ok(html.includes(`<style>${PAGE_STYLE}</style>`), 'the style is exactly the hashed one');
  assert.equal((html.match(/<script/g) ?? []).length, 2, 'Cloudflare\'s script and the hashed one, nothing else');
  assert.deepEqual(auditRows(h.db), [], 'the page writes no row');
});

test('the page script hands the token only to Sass\'s turnstile handler or the two phone origins, and reads the action from the fragment', () => {
  assert.deepEqual(FRAME_ORIGINS, ['https://lc.nooutco.me', 'https://lp.nooutco.me']);
  assert.match(PAGE_SCRIPT, /window\.webkit\.messageHandlers\.turnstile/);
  assert.match(PAGE_SCRIPT, /window\.parent\.postMessage\(\{ turnstile: token \}, origin\)/);
  assert.doesNotMatch(PAGE_SCRIPT, /postMessage\([^)]*["']\*["']/, 'never to any origin');
  assert.match(PAGE_SCRIPT, /location\.hash\.slice\(1\)/);
  assert.match(PAGE_SCRIPT, /action !== "account" && action !== "signin"/);
  assert.doesNotMatch(PAGE_SCRIPT, /location\.search|fetch\(|XMLHttpRequest|innerHTML/);
});

test('FAIL CLOSED: GET /challenge with either key unset, or a malformed site key, answers 503 with the sentence and loads no script', async () => {
  for (const env of [{ HZ_TURNSTILE_SITEKEY: undefined }, { HZ_TURNSTILE_SECRET: undefined }, { HZ_TURNSTILE_SITEKEY: '"><script>' }]) {
    const res = await get(harness({ env }), '/challenge');
    assert.equal(res.status, 503, JSON.stringify(env));
    const html = await res.text();
    assert.ok(html.includes(NOT_CONFIGURED_SENTENCE));
    assert.doesNotMatch(html, /<script/);
    assert.doesNotMatch(res.headers.get('content-security-policy'), /script-src/);
    assert.match(res.headers.get('content-security-policy'), /^default-src 'none'/);
  }
});

test('GET /challenge needs no database binding', async () => {
  const res = await createHandler()(new Request(`${ORIGIN}/challenge`), { HZ_TURNSTILE_SECRET: TURNSTILE_PASS.secret, HZ_TURNSTILE_SITEKEY: TURNSTILE_PASS.sitekey });
  assert.equal(res.status, 200);
});

test('every other GET is still refused, a query string on /challenge is shape, and POST /challenge is no route', async () => {
  const h = harness();
  assert.deepEqual(await answer(await get(h, '/account')), { status: 405, json: { error: 'method' } });
  assert.deepEqual(await answer(await get(h, '/signin')), { status: 405, json: { error: 'method' } });
  assert.deepEqual(await answer(await get(h, '/challenge?action=signin')), { status: 400, json: { error: 'shape' } });
  assert.deepEqual(await answer(await h.call(post('/challenge', {}))), { status: 404, json: { error: 'no-route' } });
  assert.deepEqual(await answer(await get(h, '/challenge/')), { status: 404, json: { error: 'no-route' } });
});
