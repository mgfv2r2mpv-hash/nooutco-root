import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pinAllowed, PIN_TOO_EASY, PIN_LENGTH } from '../src/pin.mjs';
import { BLOCKLIST } from '../src/pin-blocklist.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const listed = (name) => readFileSync(path.join(ROOT, 'vendor', 'pins', name), 'utf8').trim().split(/\r?\n/);

test('a PIN with a run of three, or on the blocklist, is refused as too easy to guess', () => {
  const runs = ['123905', '905123', '987052', '052987', '000583', '583000', '471777', '890123', '310789'];
  const blocked = ['159753', '147258', '246810', '696969', '101010'];
  for (const pin of [...runs, ...blocked]) {
    assert.deepEqual(pinAllowed(pin), { ok: false, reason: 'too-easy', message: PIN_TOO_EASY }, pin);
  }
  assert.equal(PIN_TOO_EASY, 'That PIN is too easy to guess.');
});

test('NEGATIVE CONTROL: six digits with no run and not on the blocklist are allowed', () => {
  for (const pin of ['820374', '194826', '572940', '309158', '461903']) {
    assert.equal(BLOCKLIST.has(pin), false, pin);
    assert.deepEqual(pinAllowed(pin), { ok: true }, pin);
  }
});

test('two of a kind, or a run that wraps past 9, is not a run', () => {
  assert.deepEqual(pinAllowed('884736'), { ok: true });
  assert.deepEqual(pinAllowed('490173'), { ok: true });
});

test('anything but exactly six digits is refused as not a PIN, never as too easy', () => {
  assert.equal(PIN_LENGTH, 6);
  for (const pin of ['82037', '8203741', '82037a', ' 820374', '８２０３７４', 820374, null, undefined]) {
    assert.deepEqual(pinAllowed(pin), { ok: false, reason: 'shape' }, String(pin));
  }
});

test('every PIN on either vendored list is on the blocklist, and nothing else is', () => {
  const union = new Set([...listed('iOS-6-digit.txt'), ...listed('DD-6-digit-29.txt')]);
  assert.equal(BLOCKLIST.size, union.size);
  for (const pin of union) assert.ok(BLOCKLIST.has(pin), pin);
});

test('a refusal never echoes the PIN', () => {
  const r = pinAllowed('159753');
  assert.equal(JSON.stringify(r).includes('159753'), false);
});
