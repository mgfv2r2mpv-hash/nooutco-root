// A5, the code check (plan §3.1, §3.6 /unlock/start and /unlock/finish).
// The device proves the code with CPace (the engine's pake.mjs), keyed by the
// code under the channel unlockChannelFor(device), so the code never crosses
// the wire. Both requests are signed by the same registered device.
//
//   /unlock/start  {sid, Ya, clock}    -> {exchange, replies: [{Yb, tagB}] x2}
//   /unlock/finish {exchange, tagA}    -> {ticket}
//
// The service offers the current step and the previous one, never the next
// (the engine's candidateCodes), and never a step at or before the last
// accepted one, so a code is accepted once. An offer it withholds is still
// answered, with a reply no code checks against, so the answer looks the
// same. Every refusal at finish is the one word bad-code: a wrong code, an
// unknown, spent or expired exchange, and another device's exchange alike.
//
// The ticket is the service's ECDSA P-256 signature (HZ_TICKET_KEY) over
// `${TICKET_LABEL}.${payload}`, where the payload is base64url JSON naming the
// account and the device, when, and until when.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UNLOCK_LIMITS, TICKET_LABEL } from '../src/unlock.js';
import { initiatorStart, initiatorFinish, unlockChannelFor } from '../../../packages/account-engine/src/pake.mjs';
import { CONFIRM_MS } from '../../../packages/account-engine/src/limits.mjs';
import { b64url, fromB64url } from '../src/checks.js';
import {
  harness, signed, auditRows, everyRow, registeredDevice, enrolledDevice, codeAt, wrongCodeAt, tryCode,
  TICKET_PUBLIC_KEY, ROOT, T0,
} from './helpers.mjs';

// Fixed, fake values: reserved-domain addresses.
const ADDRESS = 'unlock-owner@example.test';
const OTHER = 'someone-else@example.test';
const STEP_MS = 30_000;
const BAD_CODE = { status: 401, json: { error: 'bad-code' } };

async function answer(res) {
  return { status: res.status, json: await res.json() };
}

// A start the test can finish later, from this device or another.
async function startOnly(h, device, code) {
  const { message, state } = initiatorStart({ code, channel: unlockChannelFor(device.id) });
  const start = await answer(await h.call(await signed(h.call, device, '/unlock/start', { sid: b64url(message.sid), Ya: b64url(message.Ya), clock: h.clock.ms })));
  assert.equal(start.status, 200, JSON.stringify(start.json));
  const proved = initiatorFinish(state, start.json.replies.map((r) => ({ Yb: fromB64url(r.Yb), tagB: fromB64url(r.tagB) })));
  return { exchange: start.json.exchange, replies: start.json.replies, tagA: proved ? b64url(proved.tagA) : null };
}

async function finish(h, device, exchange, tagA) {
  return answer(await h.call(await signed(h.call, device, '/unlock/finish', { exchange, tagA })));
}

async function readTicket(ticket) {
  const [payload, sig, ...rest] = ticket.split('.');
  if (rest.length > 0) return null;
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, TICKET_PUBLIC_KEY, fromB64url(sig), new TextEncoder().encode(`${TICKET_LABEL}.${payload}`));
  return ok ? JSON.parse(new TextDecoder().decode(fromB64url(payload))) : null;
}

// A device of the same account that has not proved a code yet; the unlock
// routes are the ones it may use.
async function secondDevice(h, first) {
  const next = await registeredDevice(h, first.email, { fresh: false });
  return { ...next, email: first.email, seed: first.seed };
}

// ---- the plan test ----

test('NEGATIVE CONTROL: a correct code, account and device returns a ticket', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const tried = await tryCode(h, dev, await codeAt(dev, h.clock.ms));
  assert.equal(tried.start.status, 200);
  assert.deepEqual(Object.keys(tried.start.json).sort(), ['exchange', 'replies']);
  assert.match(tried.start.json.exchange, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(tried.proved, true, 'the device checked the service\'s reply');
  assert.equal(tried.finish.status, 200);
  assert.deepEqual(Object.keys(tried.finish.json), ['ticket']);
  assert.deepEqual(await readTicket(tried.finish.json.ticket), {
    v: 1, account: dev.account, device: dev.id, at: h.clock.ms, exp: h.clock.ms + UNLOCK_LIMITS.ticketTtlMs,
  });
});

test('a ticket does not verify once its payload is changed', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const { ticket } = (await tryCode(h, dev, await codeAt(dev, h.clock.ms))).finish.json;
  const [payload, sig] = ticket.split('.');
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  const forged = b64url(new TextEncoder().encode(JSON.stringify({ ...claims, device: 'another-device' })));
  assert.equal(await readTicket(`${forged}.${sig}`), null);
});

// ---- the refusal says nothing about which part was wrong ----

test('a wrong code, an unknown, spent or expired exchange and another device\'s exchange are refused alike', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const other = await secondDevice(h, dev);
  const wrong = await tryCode(h, dev, await wrongCodeAt(dev, h.clock.ms));
  assert.equal(wrong.proved, false);
  assert.deepEqual(wrong.finish, BAD_CODE, 'a wrong code');
  assert.deepEqual(await finish(h, dev, b64url(new Uint8Array(16).fill(1)), b64url(new Uint8Array(32))), BAD_CODE, 'an unknown exchange');
  const mine = await startOnly(h, dev, await codeAt(dev, h.clock.ms));
  assert.ok(mine.tagA);
  assert.deepEqual(await finish(h, other, mine.exchange, mine.tagA), BAD_CODE, 'another device\'s exchange');
  assert.equal((await finish(h, dev, mine.exchange, mine.tagA)).status, 200, 'NEGATIVE CONTROL: its own device finishes it');
  assert.deepEqual(await finish(h, dev, mine.exchange, mine.tagA), BAD_CODE, 'a spent exchange');
  h.clock.ms += STEP_MS;
  const late = await startOnly(h, dev, await codeAt(dev, h.clock.ms));
  h.clock.ms += CONFIRM_MS;
  assert.deepEqual(await finish(h, dev, late.exchange, late.tagA), BAD_CODE, 'an expired exchange');
});

// ---- replay and drift ----

test('a code accepted once is refused again in the same step, on any device', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const other = await secondDevice(h, dev);
  const code = await codeAt(dev, h.clock.ms);
  assert.equal((await tryCode(h, dev, code)).finish.status, 200);
  for (const device of [dev, other]) {
    const again = await tryCode(h, device, code);
    assert.equal(again.start.json.replies.length, 2, 'the answer looks the same');
    assert.equal(again.proved, false, 'the used step was not offered');
    assert.deepEqual(again.finish, BAD_CODE);
  }
  h.clock.ms += STEP_MS;
  assert.equal((await tryCode(h, dev, await codeAt(dev, h.clock.ms))).finish.status, 200, 'NEGATIVE CONTROL: the next step\'s code');
});

test('of two exchanges proving the same code, only the first finished is accepted', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const code = await codeAt(dev, h.clock.ms);
  const one = await startOnly(h, dev, code);
  const two = await startOnly(h, dev, code);
  assert.ok(one.tagA && two.tagA, 'both were offered the step');
  assert.equal((await finish(h, dev, two.exchange, two.tagA)).status, 200);
  assert.deepEqual(await finish(h, dev, one.exchange, one.tagA), BAD_CODE);
});

test('the previous step\'s code is accepted', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  h.clock.ms += STEP_MS + STEP_MS / 2;
  const tried = await tryCode(h, dev, await codeAt(dev, h.clock.ms - STEP_MS));
  assert.equal(tried.proved, true);
  assert.equal(tried.finish.status, 200);
});

test('a code two steps old, or the next step\'s, is refused', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  h.clock.ms += 3 * STEP_MS + STEP_MS / 2;
  for (const at of [h.clock.ms - 2 * STEP_MS, h.clock.ms + STEP_MS]) {
    const code = await codeAt(dev, at);
    if ([await codeAt(dev, h.clock.ms), await codeAt(dev, h.clock.ms - STEP_MS)].includes(code)) continue; // a one-in-a-million repeat
    const tried = await tryCode(h, dev, code);
    assert.equal(tried.proved, false);
    assert.deepEqual(tried.finish, BAD_CODE);
  }
  assert.equal((await tryCode(h, dev, await codeAt(dev, h.clock.ms))).finish.status, 200, 'NEGATIVE CONTROL: the current step\'s code');
});

// ---- the window cap, when tries arrive together ----

test('three tries in one window are admitted even when more arrive together', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const other = await secondDevice(h, dev);
  const requests = [];
  for (const device of [dev, other, dev, other, dev, other]) {
    const { message } = initiatorStart({ code: await wrongCodeAt(dev, h.clock.ms), channel: unlockChannelFor(device.id) });
    requests.push(await signed(h.call, device, '/unlock/start', { sid: b64url(message.sid), Ya: b64url(message.Ya), clock: h.clock.ms }));
  }
  const answers = await Promise.all(requests.map(async (r) => answer(await h.call(r))));
  assert.equal(answers.filter((a) => a.status === 200).length, 3);
  for (const a of answers.filter((x) => x.status !== 200)) assert.deepEqual(a, { status: 423, json: { error: 'locked' } });
});

// ---- bodies, configuration and custody ----

test('a start body must be exactly sid, Ya and clock, with a valid point', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const { message } = initiatorStart({ code: '123456', channel: unlockChannelFor(dev.id) });
  const good = { sid: b64url(message.sid), Ya: b64url(message.Ya), clock: h.clock.ms };
  for (const body of [{}, { sid: good.sid, Ya: good.Ya }, { ...good, clock: String(good.clock) }, { ...good, sid: b64url(new Uint8Array(15)) },
    { ...good, Ya: b64url(new Uint8Array(31)) }, { ...good, code: '123456' }, { ...good, Ya: b64url(new Uint8Array(32)) }]) {
    assert.deepEqual(await answer(await h.call(await signed(h.call, dev, '/unlock/start', body))), { status: 400, json: { error: 'shape' } }, JSON.stringify(Object.keys(body)));
  }
});

test('a finish body must be exactly an exchange and a tag', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const { exchange, tagA } = await startOnly(h, dev, await codeAt(dev, h.clock.ms));
  for (const body of [{}, { exchange }, { exchange, tagA, code: '123456' }, { exchange: 7, tagA }, { exchange, tagA: b64url(new Uint8Array(31)) }]) {
    assert.deepEqual(await answer(await h.call(await signed(h.call, dev, '/unlock/finish', body))), { status: 400, json: { error: 'shape' } }, JSON.stringify(Object.keys(body)));
  }
  assert.equal((await finish(h, dev, exchange, tagA)).status, 200, 'the exchange is still live');
});

test('an account with no code answers not-enrolled, and nothing is counted', async () => {
  const h = harness();
  const dev = await registeredDevice(h, ADDRESS);
  const { message } = initiatorStart({ code: '123456', channel: unlockChannelFor(dev.id) });
  for (let i = 0; i < 4; i += 1) {
    const res = await answer(await h.call(await signed(h.call, dev, '/unlock/start', { sid: b64url(message.sid), Ya: b64url(message.Ya), clock: h.clock.ms })));
    assert.deepEqual(res, { status: 409, json: { error: 'not-enrolled' } });
  }
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM exchange').get().n, 0);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM limits').get().n, 0);
});

test('without the ticket key or a reopen link base, unlock answers unavailable and admits nothing', async () => {
  for (const env of [{ HZ_TICKET_KEY: undefined }, { HZ_TICKET_KEY: 'not a key' }, { HZ_REOPEN_BASE: undefined }, { HZ_REOPEN_BASE: 'http://horae-zone.example.test/reopen' }]) {
    const h = harness({ env });
    const dev = await enrolledDevice(h, OTHER);
    assert.deepEqual((await tryCode(h, dev, await codeAt(dev, h.clock.ms))).start, { status: 503, json: { error: 'unavailable' } }, Object.keys(env)[0]);
    assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM exchange').get().n, 0);
    assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM limits').get().n, 0);
  }
});

test('an exchange is stored as keyed digests of the tags it expects, never a tag, a code or a key', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const code = await codeAt(dev, h.clock.ms);
  const { exchange, tagA } = await startOnly(h, dev, code);
  const [row] = h.db.sqlite.prepare('SELECT * FROM exchange').all().map((r) => ({ ...r }));
  assert.equal(row.id, exchange);
  assert.equal(row.device_id, dev.id);
  assert.equal(row.account_id, dev.account);
  assert.equal(row.expires_at, h.clock.ms + CONFIRM_MS);
  const hexTag = [...fromB64url(tagA)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // The code is matched as a whole token, not inside a digest or a timestamp.
  for (const value of [tagA, hexTag, new RegExp(`(?<![0-9A-Za-z_-])${code}(?![0-9A-Za-z_-])`)]) {
    const carries = (text) => (typeof value === 'string' ? text.includes(value) : value.test(text));
    assert.equal(carries(everyRow(h.db)), false, 'a table carries a tag or the code');
    assert.equal(carries(JSON.stringify(h.db.bound.map((b) => b.values))), false, 'a bound value carries a tag or the code');
  }
});

test('the expected tags are compared in constant time', () => {
  const source = readFileSync(`${ROOT}/src/unlock.js`, 'utf8');
  assert.match(source, /import \{[^}]*\bsameHex\b[^}]*\} from "\.\.\/\.\.\/\.\.\/packages\/account-engine\/src\/limits\.mjs"/);
  assert.match(source, /sameHex\(/);
  assert.doesNotMatch(source, /digest\s*[!=]==|[!=]==\s*\w*digest/i, 'no digest is compared with ===');
});

test('start and finish each write one audit row of route and reason', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const before = auditRows(h.db).length;
  await tryCode(h, dev, await wrongCodeAt(dev, h.clock.ms));
  await tryCode(h, dev, await codeAt(dev, h.clock.ms));
  assert.deepEqual(auditRows(h.db).slice(before), [
    { route: '/nonce', reason: 'ok' }, { route: '/unlock/start', reason: 'ok' },
    { route: '/nonce', reason: 'ok' }, { route: '/unlock/finish', reason: 'bad-code' },
    { route: '/nonce', reason: 'ok' }, { route: '/unlock/start', reason: 'ok' },
    { route: '/nonce', reason: 'ok' }, { route: '/unlock/finish', reason: 'ok' },
  ]);
  assert.equal(T0 % STEP_MS, 0, 'the tests start on a step boundary');
});
