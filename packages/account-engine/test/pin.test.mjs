import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPinRules, PIN_TOO_EASY, PIN_LENGTH } from '../src/pin.mjs';
import { PINS as FIXTURE } from './fixtures/pin-blocklist.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { pinAllowed } = createPinRules(FIXTURE);
const TOO_EASY = { ok: false, reason: 'too-easy', message: PIN_TOO_EASY };

test('a PIN with a run of three, or on the blocklist, is refused as too easy to guess', () => {
  const runs = ['123905', '905123', '987052', '052987', '000583', '583000', '471777', '890123', '310789'];
  for (const pin of [...runs, ...FIXTURE]) assert.deepEqual(pinAllowed(pin), TOO_EASY, pin);
  assert.equal(PIN_TOO_EASY, 'That PIN is too easy to guess.');
});

test('NEGATIVE CONTROL: six digits with no run and not on the blocklist are allowed', () => {
  for (const pin of ['820374', '194826', '572940', '309158', '461903']) {
    assert.equal(FIXTURE.includes(pin), false, pin);
    assert.deepEqual(pinAllowed(pin), { ok: true }, pin);
  }
});

test('a run wraps: 0 follows 9 and precedes 1, so 890, 901, 098 and 109 are runs', () => {
  // Only the wrap makes each of these a run; no other three digits step by 1 or 0.
  for (const pin of ['890472', '901475', '409837', '510953', '490173']) assert.deepEqual(pinAllowed(pin), TOO_EASY, pin);
  // The owner's own examples: ascending 7890, 8901, 9012; descending 1098, 0987, 2109.
  for (const run of ['7890', '8901', '9012', '1098', '0987', '2109']) assert.deepEqual(pinAllowed(`46${run}`), TOO_EASY, run);
});

test('NEGATIVE CONTROL: two of a kind, or a jump across the wrap that is not one step, is not a run', () => {
  for (const pin of ['884736', '902468', '190827', '930571']) assert.deepEqual(pinAllowed(pin), { ok: true }, pin);
});

test('anything but exactly six digits is refused as not a PIN, never as too easy', () => {
  assert.equal(PIN_LENGTH, 6);
  for (const pin of ['82037', '8203741', '82037a', ' 820374', '８２０３７４', 820374, null, undefined]) {
    assert.deepEqual(pinAllowed(pin), { ok: false, reason: 'shape' }, String(pin));
  }
});

test('a refusal never echoes the PIN', () => {
  const r = pinAllowed('159753');
  assert.equal(JSON.stringify(r).includes('159753'), false);
});

test('the rules cannot be built without a blocklist, or from one with an entry that is not six digits', () => {
  for (const bad of [undefined, null, 'nope', [], new Set()]) assert.throws(() => createPinRules(bad), /pin blocklist/, String(bad));
  assert.throws(() => createPinRules(['159753', '12345x']), (err) => /pin blocklist/.test(err.message) && !err.message.includes('12345x'));
});

test('the rules keep their own copy, so changing the list afterwards changes nothing', () => {
  const list = ['159753'];
  const rules = createPinRules(list);
  list.push('820374');
  assert.deepEqual(rules.pinAllowed('820374'), { ok: true });
  assert.ok(Object.isFrozen(rules));
});

test('the engine carries no blocklist of its own: the list lives in the private package', () => {
  assert.equal(existsSync(path.join(ROOT, 'vendor', 'pins')), false);
  for (const file of readdirSync(path.join(ROOT, 'src'))) {
    const sixDigitTokens = readFileSync(path.join(ROOT, 'src', file), 'utf8').match(/\b[0-9]{6}\b/g) ?? [];
    assert.ok(sixDigitTokens.length < 20, `${file} holds ${sixDigitTokens.length} six-digit tokens`);
  }
});
