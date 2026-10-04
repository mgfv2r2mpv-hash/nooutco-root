// A5b security review LOW-1: the private blocklist answers only after the
// proof. /pin/set checks the ticket, a change the current PIN, and a reset
// takes its try place and checks its factors, all before the PIN rules say
// too-easy, so a signed device holding no proof cannot read the private list
// one PIN at a time. A PIN of the wrong shape is still refused first, since
// the shape is public.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PIN_RESET_LIMITS } from '../src/pin-reset.js';
import { PINS as LISTED } from '../../../packages/account-engine/test/fixtures/pin-blocklist.mjs';
import {
  harness, confirmedDevice, ticketFor, pinCall, pinnedDevice, PASSWORD,
} from './helpers.mjs';

// Fixed, fake values: a reserved-domain address and PINs with no run of
// three that are not on the public fixture list. LISTED is that fixture list.
const ADDRESS = 'pin-blocklist-order@example.test';
const OTHER = 'pin-blocklist-other@example.test';
const FIRST = '274951';
const SECOND = '385062';
const WRONG_PIN = '496173';
const WRONG_PASSWORD = 'not the password FAKE';
const RUN = '123456';
const TOO_EASY = { status: 400, json: { error: 'too-easy', message: 'That PIN is too easy to guess.' } };
const SHAPE = { status: 400, json: { error: 'shape' } };

test('the first PIN: a junk or foreign ticket answers bad-ticket for a listed PIN, never too-easy', async () => {
  const h = harness();
  const dev = await confirmedDevice(h, ADDRESS);
  const foreign = await ticketFor(h, await confirmedDevice(h, OTHER));
  for (const pin of [...LISTED, RUN]) {
    for (const ticket of ['x.y', foreign]) {
      assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin, ticket }), { status: 401, json: { error: 'bad-ticket' } }, pin);
    }
  }
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: '12345', ticket: 'x.y' }), SHAPE, 'the shape is public and still first');
  // NEGATIVE CONTROL: with a real ticket the list still refuses, and nothing was set.
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: LISTED[0], ticket: await ticketFor(h, dev) }), TOO_EASY);
  assert.deepEqual(await pinCall(h, dev, '/pin/verify', { pin: FIRST }), { status: 409, json: { error: 'no-pin' } });
  assert.equal((await pinCall(h, dev, '/pin/set', { pin: FIRST, ticket: await ticketFor(h, dev) })).status, 200);
});

test('a change: a wrong current PIN answers bad-pin for a listed new PIN, never too-easy', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: LISTED[0], current: WRONG_PIN }), { status: 401, json: { error: 'bad-pin' } });
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: '12345', current: WRONG_PIN }), SHAPE, 'the shape is public and still first');
  // NEGATIVE CONTROL: with the right current PIN the list still refuses, and the PIN is unchanged.
  assert.deepEqual(await pinCall(h, dev, '/pin/set', { pin: LISTED[1], current: FIRST }), TOO_EASY);
  assert.equal((await pinCall(h, dev, '/pin/verify', { pin: FIRST })).status, 200);
});

test('a reset: wrong factors answer bad-reset for a listed PIN and take a try place, never too-easy', async () => {
  const h = harness();
  const dev = await pinnedDevice(h, ADDRESS, FIRST);
  for (let i = 0; i < PIN_RESET_LIMITS.triesPerHour; i += 1) {
    const pin = LISTED[i % LISTED.length];
    assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin, ticket: 'x.y', password: WRONG_PASSWORD }),
      { status: 401, json: { error: 'bad-reset' } }, pin);
  }
  assert.deepEqual(await pinCall(h, dev, '/pin/reset', { pin: LISTED[0], ticket: 'x.y', password: WRONG_PASSWORD }),
    { status: 429, json: { error: 'slow-down' } }, 'each listed-PIN try took a place');

  // NEGATIVE CONTROL: right factors and a listed PIN answer too-easy and spend nothing.
  const fresh = harness();
  const owner = await pinnedDevice(fresh, ADDRESS, FIRST);
  const ticket = await ticketFor(fresh, owner);
  assert.deepEqual(await pinCall(fresh, owner, '/pin/reset', { pin: LISTED[0], ticket, password: PASSWORD }), TOO_EASY);
  assert.deepEqual(await pinCall(fresh, owner, '/pin/reset', { pin: '12345', ticket: 'x.y', password: WRONG_PASSWORD }), SHAPE,
    'the shape is public and still first');
  assert.deepEqual(await pinCall(fresh, owner, '/pin/reset', { pin: SECOND, ticket, password: PASSWORD }), { status: 200, json: { ok: true } },
    'the same ticket still resets');
});
