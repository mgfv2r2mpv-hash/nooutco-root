// The constant-time compare the lockout rules already used for the reopen
// link, now exported so Horae Zone compares email-code digests with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameHex } from '../src/limits.mjs';

test('sameHex reads equal hex digests as the same and any one difference as not', () => {
  const a = 'ab'.repeat(32);
  assert.equal(sameHex(a, a), true);
  for (const at of [0, 31, 63]) {
    const b = `${a.slice(0, at)}${a[at] === 'a' ? 'b' : 'a'}${a.slice(at + 1)}`;
    assert.equal(sameHex(a, b), false, `difference at ${at}`);
  }
});

test('sameHex refuses digests of different lengths and anything that is not a string', () => {
  assert.equal(sameHex('ab', 'abab'), false);
  assert.equal(sameHex('', 'ab'), false);
  assert.equal(sameHex(null, 'ab'), false);
  assert.equal(sameHex('ab', undefined), false);
});

test('sameHex reads every character instead of stopping at the first difference', () => {
  // A static check: an early return inside the loop would make the time
  // depend on where the first difference is.
  const body = sameHex.toString();
  assert.match(body, /for \(/);
  assert.doesNotMatch(body.slice(body.indexOf('for (')), /return false/);
});
