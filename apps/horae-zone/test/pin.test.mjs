// A5b, the PIN (plan §3.3 "Every app open", §3.4, §3.6 /pin/*). The server
// side of every open: a device signature (Face ID releases the signing key)
// and the PIN, every time, and the code only when the last code this device
// had accepted is 12 hours old.
//
//   /pin/set    {pin, ticket}          -> {ok: true, grant}  the first PIN
//   /pin/verify {pin}                  -> {ok: true, grant}  under 12 hours
//   /pin/verify {pin, ticket}          -> {ok: true, grant}  at 12 hours or more
//
// The ticket is /unlock/finish's. The verifier follows the rules the A5
// security review (item 4) set for it: the kid picks the key, a jti is spent
// once in the same write that accepts the ticket, and only on a request the
// ticket's own device signed. The code's time is the ticket's `at`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { b64url, fromB64url } from '../src/checks.js';
import { PIN_LIMITS, GRANT_LABEL } from '../src/pin.js';
import { TICKET_LABEL } from '../src/unlock.js';
import { accountKeys } from '../src/account-keys.js';
import {
  TICKET_KEY, harness, post, signed, everyRow, confirmedDevice, registeredDevice, ticketFor, pinCall, pinnedDevice,
} from './helpers.mjs';

// Fixed, fake values: a reserved-domain address and PINs with no run of
// three that are not on the public fixture list.
const ADDRESS = 'pin-owner@example.test';
const PIN = '274951';
const WRONG_PIN = '385062';
const HOUR_MS = 60 * 60 * 1000;
const OK = { status: 200 };

// The time of the code the ticket proves, read from its payload.
function ticketAt(ticket) {
  return JSON.parse(new TextDecoder().decode(fromB64url(ticket.split('.')[0]))).at;
}

// A ticket whose payload is changed and whose signature is kept.
function forged(ticket, change) {
  const [payload, sig] = ticket.split('.');
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  return `${b64url(new TextEncoder().encode(JSON.stringify({ ...claims, ...change })))}.${sig}`;
}

// ---- the plan test ----

test('every open asks for Face ID and the PIN; the code only when the last accepted code is 12 hours old', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const first = await ticketFor(h, dev);
  const provedAt = ticketAt(first);
  assert.equal((await pinCall(h, dev, '/pin/set', { pin: PIN, ticket: first })).status, 200, 'the first PIN is set with a fresh code');
  assert.equal(PIN_LIMITS.codeEveryMs, 12 * HOUR_MS);

  // Face ID: no open without the device's signature.
  const unsigned = await h.call(post('/pin/verify', { pin: PIN }, { 'x-hz-device': dev.id }));
  assert.equal(unsigned.status, 401, 'an unsigned open is refused');
  // The PIN, every time: a ticket is never enough on its own.
  h.clock.ms = provedAt + HOUR_MS;
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', {}), { status: 400, json: { error: 'shape' } });
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { ticket: await ticketFor(h, dev) }), { status: 400, json: { error: 'shape' } });
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: WRONG_PIN }), { status: 401, json: { error: 'bad-pin' } });

  // Under 12 hours since the last accepted code: Face ID and the PIN alone.
  h.clock.ms = provedAt + HOUR_MS * 2;
  const opened = await pinCall(h, dev, '/pin/verify', { pin: PIN });
  assert.equal(opened.status, OK.status, JSON.stringify(opened.json));
  assert.equal(opened.json.ok, true);
  h.clock.ms = provedAt + PIN_LIMITS.codeEveryMs - 1;
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: PIN })).status, 200, 'a millisecond short of 12 hours');
});

test('at 12 hours the open needs the code too, and a fresh code restarts the 12 hours', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const provedAt = Number(h.db.sqlite.prepare('SELECT proved_at FROM device_check WHERE device_id = ?').get(dev.id).proved_at);
  h.clock.ms = provedAt + PIN_LIMITS.codeEveryMs;
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: PIN }), { status: 401, json: { error: 'code-needed' } });
  // The code is asked before the PIN is checked, so a wrong PIN learns nothing.
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: WRONG_PIN }), { status: 401, json: { error: 'code-needed' } });
  const fresh = await ticketFor(h, dev);
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: PIN, ticket: fresh })).status, 200);
  h.clock.ms = ticketAt(fresh) + PIN_LIMITS.codeEveryMs - 1;
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: PIN })).status, 200, 'the 12 hours run from the new code');
});

test('the 12 hours are per device: another device\'s code does not spare this one the code', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const other = { ...(await registeredDevice(h, ADDRESS, { fresh: false })), email: ADDRESS, seed: dev.seed };
  const otherTicket = await ticketFor(h, other);
  assert.equal((await pinCall(h, other, '/pin/verify', { pin: PIN, ticket: otherTicket })).status, 200, 'the second device opens with its code and the PIN');
  h.clock.ms = Number(h.db.sqlite.prepare('SELECT proved_at FROM device_check WHERE device_id = ?').get(dev.id).proved_at) + PIN_LIMITS.codeEveryMs;
  assert.ok(h.clock.ms < ticketAt(otherTicket) + PIN_LIMITS.codeEveryMs);
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: PIN }), { status: 401, json: { error: 'code-needed' } });
  assert.equal((await pinCall(h, other, '/pin/verify', { pin: PIN })).status, 200, 'NEGATIVE CONTROL: the other device is still inside its 12 hours');
});

test('a device whose code was never proved with the PIN needs the code at its first open', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const other = { ...(await registeredDevice(h, ADDRESS, { fresh: false })), email: ADDRESS, seed: dev.seed };
  await ticketFor(h, other); // proves the code, clears pending; the ticket is dropped
  assert.deepEqual(await pinCall(h, other, '/pin/verify', { pin: PIN }), { status: 401, json: { error: 'code-needed' } });
});

// ---- offline (plan §3.3 "Offline and revocation") ----

// The grant's claims when its signature verifies under the public half of
// the test's HZ_TICKET_KEY with the grant label; otherwise null.
async function grantClaims(grant) {
  const [payload, sig, ...rest] = String(grant).split('.');
  if (rest.length > 0 || !payload || !sig) return null;
  const { crv, kty, x, y } = JSON.parse(TICKET_KEY);
  const key = await crypto.subtle.importKey('jwk', { crv, kty, x, y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromB64url(sig), new TextEncoder().encode(`${GRANT_LABEL}.${payload}`));
  return ok ? JSON.parse(new TextDecoder().decode(fromB64url(payload))) : null;
}

test('offline, the PIN alone opens only while the last accepted code is under 12 hours old', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const first = await ticketFor(h, dev);
  const provedAt = ticketAt(first);
  const set = await pinCall(h, dev, '/pin/set', { pin: PIN, ticket: first });
  assert.equal(set.status, 200);
  assert.notEqual(GRANT_LABEL, TICKET_LABEL, 'a grant is signed under its own label');

  // Every accepted open hands the device a signed grant; the device checks
  // the PIN itself offline, and only until the grant's end.
  for (const answer of [set, await pinCall(h, dev, '/pin/verify', { pin: PIN })]) {
    assert.deepEqual(Object.keys(answer.json).sort(), ['grant', 'ok'], 'nothing beside the grant: no date, no duration');
    const claims = await grantClaims(answer.json.grant);
    assert.ok(claims, 'the grant verifies under the service key and the grant label');
    assert.equal(claims.until, provedAt + PIN_LIMITS.codeEveryMs, 'the grant ends 12 hours after the last accepted code');
    assert.equal(claims.device, dev.id);
    assert.equal(claims.account, dev.account);
  }

  // An open without the code never extends the 12 hours.
  h.clock.ms = provedAt + PIN_LIMITS.codeEveryMs - 1;
  const late = await pinCall(h, dev, '/pin/verify', { pin: PIN });
  assert.equal((await grantClaims(late.json.grant)).until, provedAt + PIN_LIMITS.codeEveryMs, 'a PIN-only open hands the same end');
  // The grant's end is where the service itself starts asking the code.
  h.clock.ms = provedAt + PIN_LIMITS.codeEveryMs;
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: PIN }), { status: 401, json: { error: 'code-needed' } });
  // A fresh code moves the end.
  const fresh = await ticketFor(h, dev);
  const renewed = await pinCall(h, dev, '/pin/verify', { pin: PIN, ticket: fresh });
  assert.equal((await grantClaims(renewed.json.grant)).until, ticketAt(fresh) + PIN_LIMITS.codeEveryMs);
});

test('a grant is not a ticket, and a ticket is not a grant', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const opened = await pinCall(h, dev, '/pin/verify', { pin: PIN });
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: PIN, ticket: opened.json.grant }), { status: 401, json: { error: 'bad-ticket' } });
  assert.equal(await grantClaims(await ticketFor(h, dev)), null, 'NEGATIVE CONTROL: a ticket does not verify as a grant');
});

// ---- the ticket verifier (A5 security review, item 4) ----

test('a ticket is accepted once: its jti is spent by the open that accepts it', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const ticket = await ticketFor(h, dev);
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: PIN, ticket })).status, 200);
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: PIN, ticket }), { status: 401, json: { error: 'bad-ticket' } });
});

test('a wrong PIN does not spend the ticket', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const ticket = await ticketFor(h, dev);
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: WRONG_PIN, ticket }), { status: 401, json: { error: 'bad-pin' } });
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: PIN, ticket })).status, 200);
});

test('a ticket is accepted only on a request its own device signed', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const other = { ...(await registeredDevice(h, ADDRESS, { fresh: false })), email: ADDRESS, seed: dev.seed };
  await ticketFor(h, other);
  const mine = await ticketFor(h, dev);
  assert.deepEqual(await pinCall(h, other, '/pin/verify', { pin: PIN, ticket: mine }), { status: 401, json: { error: 'bad-ticket' } });
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: PIN, ticket: mine })).status, 200, 'NEGATIVE CONTROL: the ticket still works for its own device');
});

test('a changed, expired, unknown-kid or malformed ticket is refused alike and spends nothing', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  const ticket = await ticketFor(h, dev);
  const refused = { status: 401, json: { error: 'bad-ticket' } };
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: PIN, ticket: forged(ticket, { at: ticketAt(ticket) + HOUR_MS }) }), refused, 'a changed payload');
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: PIN, ticket: forged(ticket, { kid: b64url(new Uint8Array(32)) }) }), refused, 'an unknown kid');
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: PIN, ticket: 'x.y' }), refused, 'not a ticket');
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: PIN, ticket: 7 }), { status: 400, json: { error: 'shape' } });
  const saved = h.clock.ms;
  h.clock.ms = JSON.parse(new TextDecoder().decode(fromB64url(ticket.split('.')[0]))).exp;
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: PIN, ticket }), refused, 'an expired ticket');
  h.clock.ms = saved;
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: PIN, ticket })).status, 200, 'NEGATIVE CONTROL: the ticket itself was never spent');
});

// ---- the first PIN ----

test('the first PIN needs a fresh code, and a pending device cannot set one', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: PIN }), { status: 400, json: { error: 'shape' } });
  const pending = await registeredDevice(h, ADDRESS, { fresh: false });
  assert.deepEqual(await pinCall(h, pending, '/pin/set', { pin: PIN, ticket: await ticketFor(h, dev) }), { status: 401, json: { error: 'no-device' } });
  assert.equal((await pinCall(h, dev, '/pin/set', { pin: PIN, ticket: await ticketFor(h, dev) })).status, 200);
});

test('a PIN too easy to guess is refused with the one sentence, and an open with no PIN set answers no-pin', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: PIN }), { status: 409, json: { error: 'no-pin' } });
  for (const easy of ['123456', '147258']) {
    assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: easy, ticket: await ticketFor(h, dev) }),
      { status: 400, json: { error: 'too-easy', message: 'That PIN is too easy to guess.' } }, easy);
  }
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: '12345', ticket: await ticketFor(h, dev) }), { status: 400, json: { error: 'shape' } });
});

test('without the PIN rules injected, a PIN cannot be set', async () => {
  const h = harness({ pinRules: null });
  const dev = await confirmedDevice(h, ADDRESS);
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: PIN, ticket: await ticketFor(h, dev) }), { status: 503, json: { error: 'unavailable' } });
});

test('the PIN is stored only as a slow, peppered verifier: never in a row or a bound value', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, PIN);
  await pinCall(h, dev, '/pin/verify', { pin: PIN });
  const row = h.db.sqlite.prepare('SELECT verifier, salt FROM pin WHERE account_id = ?').get(dev.account);
  assert.match(row.verifier, /^pbkdf2-sha256\$100000\$[0-9a-f]{64}$/);
  assert.equal(everyRow(h.db).includes(PIN), false, 'no table holds the PIN');
  assert.equal(JSON.stringify(h.db.bound.map((b) => b.values)).includes(PIN), false, 'no statement was bound with the PIN');
  // Peppered: the same PIN and salt under another HZ_ACCOUNT_KEY give another verifier.
  const here = await accountKeys(h.env);
  const elsewhere = await accountKeys({ HZ_ACCOUNT_KEY: b64url(new Uint8Array(32).fill(3)) });
  assert.equal(await here.pinVerifier(PIN, row.salt), row.verifier, 'NEGATIVE CONTROL: the stored verifier is this PIN under this key');
  assert.notEqual(await elsewhere.pinVerifier(PIN, row.salt), row.verifier);
  assert.notEqual(await here.pinVerifier(PIN, row.salt), (await here.hashLogin(PIN, row.salt)).hash, 'its own pepper, not the login one');
});
