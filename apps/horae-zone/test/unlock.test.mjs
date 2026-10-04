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
import { CONFIRM_MS, WINDOW_MS } from '../../../packages/account-engine/src/limits.mjs';
import { b64url, fromB64url } from '../src/checks.js';
import {
  harness, signed, auditRows, everyRow, registeredDevice, enrolledDevice, confirmedDevice, codeAt, wrongCodeAt, tryCode,
  TICKET_PUBLIC_KEY, ROOT, T0, removedMidFlight, SPEND_NONCE,
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

async function readTicket(ticket, publicKey = TICKET_PUBLIC_KEY) {
  const [payload, sig, ...rest] = ticket.split('.');
  if (rest.length > 0) return null;
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, fromB64url(sig), new TextEncoder().encode(`${TICKET_LABEL}.${payload}`));
  return ok ? JSON.parse(new TextDecoder().decode(fromB64url(payload))) : null;
}

// The RFC 7638 JWK thumbprint of a P-256 public key: base64url SHA-256 of
// the required members in lexical order, no spaces. Worked out here from the
// public key alone, not from the service's code.
async function thumbprint(publicKey) {
  const { crv, kty, x, y } = await crypto.subtle.exportKey('jwk', publicKey);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ crv, kty, x, y })));
  return b64url(new Uint8Array(digest));
}

// What a verifier does (the A5b side): read the kid without trusting the
// payload, pick that key from its ring, and only then check the signature.
async function readTicketByKid(ticket, ring) {
  const [payload] = ticket.split('.');
  const { kid } = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  const publicKey = ring.get(kid);
  return publicKey ? readTicket(ticket, publicKey) : null;
}

// A device of the same account that has not proved a code yet. Once the
// account's enrolment is confirmed (confirmedDevice) it starts pending, and
// the unlock routes are the ones it may use.
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
  const claims = await readTicket(tried.finish.json.ticket);
  assert.deepEqual(claims, {
    v: 1, account: dev.account, device: dev.id, at: h.clock.ms, exp: h.clock.ms + UNLOCK_LIMITS.ticketTtlMs,
    jti: claims.jti, kid: await thumbprint(TICKET_PUBLIC_KEY),
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

// ---- A5 security review item 4: jti and kid ----
// The A5b verifier records each jti as spent (one ticket, one use) and finds
// the verification key by kid, so a rotated key does not strand a ticket
// already issued.

test('A5 review 4: the ticket claims carry a random 128-bit jti, new on every ticket, and the kid of the key that signed it', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const first = await readTicket((await tryCode(h, dev, await codeAt(dev, h.clock.ms))).finish.json.ticket);
  h.clock.ms += STEP_MS;
  const second = await readTicket((await tryCode(h, dev, await codeAt(dev, h.clock.ms))).finish.json.ticket);
  for (const claims of [first, second]) {
    assert.ok(claims, 'the ticket verifies');
    assert.match(claims.jti ?? '', /^[A-Za-z0-9_-]{22}$/);
    assert.equal(fromB64url(claims.jti).length, 16, '128 bits');
    assert.equal(claims.kid, await thumbprint(TICKET_PUBLIC_KEY));
  }
  assert.notEqual(first.jti, second.jti);
});

test('A5 review 4: the kid selects the verification key, and a ticket does not verify under the other key', async () => {
  const otherPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const otherKey = JSON.stringify(await crypto.subtle.exportKey('jwk', otherPair.privateKey));
  const ring = new Map([
    [await thumbprint(TICKET_PUBLIC_KEY), TICKET_PUBLIC_KEY],
    [await thumbprint(otherPair.publicKey), otherPair.publicKey],
  ]);
  for (const [env, signer, notSigner] of [[{}, TICKET_PUBLIC_KEY, otherPair.publicKey], [{ HZ_TICKET_KEY: otherKey }, otherPair.publicKey, TICKET_PUBLIC_KEY]]) {
    const h = harness({ env });
    const dev = await enrolledDevice(h, ADDRESS);
    const { ticket } = (await tryCode(h, dev, await codeAt(dev, h.clock.ms))).finish.json;
    const claims = await readTicketByKid(ticket, ring);
    assert.ok(claims, 'the key the kid names verifies the ticket');
    assert.equal(claims.kid, await thumbprint(signer));
    assert.equal(await readTicket(ticket, notSigner), null, 'the other key does not');
  }
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

// ---- security review L2, carried to A5 (open point 8) ----
// A removal of the device that lands after its request passed the checks
// wins: no exchange, no accepted code, no ticket.

const NO_DEVICE = { status: 401, json: { error: 'no-device' } };
const SPEND_EXCHANGE = 'UPDATE exchange SET used = 1';
const MOVE_STEP = 'UPDATE otp SET last_step';
const lastStep = (h) => h.db.sqlite.prepare('SELECT last_step FROM otp').get().last_step;
const exchangeUsed = (h, id) => h.db.sqlite.prepare('SELECT used FROM exchange WHERE id = ?').get(id).used;

async function signedFinish(h, device, exchange, tagA) {
  return signed(h.call, device, '/unlock/finish', { exchange, tagA });
}

test('L2: a device removed after its signed start passed the checks gets no exchange', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const { message } = initiatorStart({ code: await codeAt(dev, h.clock.ms), channel: unlockChannelFor(dev.id) });
  const request = await signed(h.call, dev, '/unlock/start', { sid: b64url(message.sid), Ya: b64url(message.Ya), clock: h.clock.ms });
  removedMidFlight(h, dev.id, SPEND_NONCE);
  assert.deepEqual(await answer(await h.call(request)), NO_DEVICE);
  assert.equal(h.db.sqlite.prepare('SELECT COUNT(*) AS n FROM exchange').get().n, 0, 'no exchange was stored');
});

test('L2: a device removed after its signed finish passed the checks gets no ticket, and the code is not used up', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const other = await secondDevice(h, dev);
  const code = await codeAt(dev, h.clock.ms);
  const { exchange, tagA } = await startOnly(h, dev, code);
  const request = await signedFinish(h, dev, exchange, tagA);
  removedMidFlight(h, dev.id, SPEND_NONCE);
  assert.deepEqual(await answer(await h.call(request)), NO_DEVICE);
  assert.equal(exchangeUsed(h, exchange), 0, 'the exchange was not spent');
  assert.equal(lastStep(h), 0, 'the code was not accepted');
  h.env.DB = h.db;
  assert.equal((await tryCode(h, other, code)).finish.status, 200, 'NEGATIVE CONTROL: the same code still unlocks a live device');
});

test('L2: a device removed after its exchange was spent does not use up the code', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  const other = await secondDevice(h, dev);
  const code = await codeAt(dev, h.clock.ms);
  const { exchange, tagA } = await startOnly(h, dev, code);
  const request = await signedFinish(h, dev, exchange, tagA);
  removedMidFlight(h, dev.id, SPEND_EXCHANGE);
  assert.deepEqual(await answer(await h.call(request)), NO_DEVICE);
  assert.equal(lastStep(h), 0, 'the code was not accepted');
  h.env.DB = h.db;
  assert.equal((await tryCode(h, other, code)).finish.status, 200, 'the same code still unlocks a live device');
});

test('L2: a device removed after its code was accepted gets no ticket and stays held back', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const other = await secondDevice(h, dev);
  const { exchange, tagA } = await startOnly(h, other, await codeAt(dev, h.clock.ms));
  const request = await signedFinish(h, other, exchange, tagA);
  removedMidFlight(h, other.id, MOVE_STEP);
  const res = await answer(await h.call(request));
  assert.deepEqual(res, NO_DEVICE);
  assert.equal(h.db.sqlite.prepare('SELECT pending FROM device WHERE id = ?').get(other.id).pending, 1, 'the removed device was not cleared');
});

test('L2 NEGATIVE CONTROL: a removal of some other device mid-flight does not stop a start or a finish', async () => {
  const h = harness();
  const dev = await enrolledDevice(h, ADDRESS);
  removedMidFlight(h, 'never-registered', SPEND_NONCE);
  const tried = await tryCode(h, dev, await codeAt(dev, h.clock.ms));
  assert.equal(tried.start.status, 200);
  assert.equal(tried.finish.status, 200);
  assert.ok(await readTicket(tried.finish.json.ticket));
});

// ---- the window cap, when tries arrive together ----

test('three tries in one window are admitted even when more arrive together', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  // Two devices, so six nonces can be live at once; the second proves the
  // code first, so its tries count in the account's windows (security review
  // item 2: a pending device's do not).
  const other = await secondDevice(h, dev);
  assert.equal((await tryCode(h, other, await codeAt(dev, h.clock.ms))).finish.status, 200);
  h.clock.ms += WINDOW_MS;
  const requests = [];
  for (const device of [dev, other, dev, other, dev, other]) {
    const { message } = initiatorStart({ code: await wrongCodeAt(dev, h.clock.ms), channel: unlockChannelFor(device.id) });
    requests.push(await signed(h.call, device, '/unlock/start', { sid: b64url(message.sid), Ya: b64url(message.Ya), clock: h.clock.ms }));
  }
  const answers = await Promise.all(requests.map(async (r) => answer(await h.call(r))));
  assert.equal(answers.filter((a) => a.status === 200).length, 3);
  for (const a of answers.filter((x) => x.status !== 200)) assert.deepEqual(a, { status: 423, json: { error: 'locked' } });
});

test('A5 review 2: a pending device\'s 3 tries a day hold when more arrive together', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const other = await secondDevice(h, dev);
  // The owner's two wrong codes fill most of the account's window; the
  // pending device's cap is its own, so it still gets exactly 3.
  for (let i = 0; i < 2; i += 1) assert.equal((await tryCode(h, dev, await wrongCodeAt(dev, h.clock.ms))).finish.status, 401);
  const requests = [];
  for (let i = 0; i < 5; i += 1) {
    const { message } = initiatorStart({ code: await wrongCodeAt(dev, h.clock.ms), channel: unlockChannelFor(other.id) });
    requests.push(await signed(h.call, other, '/unlock/start', { sid: b64url(message.sid), Ya: b64url(message.Ya), clock: h.clock.ms }));
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
