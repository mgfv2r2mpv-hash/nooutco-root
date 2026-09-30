import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotp, totpAt, candidateCodes, base32Encode, base32Decode, otpauthUri } from '../src/totp.mjs';

// RFC 4226 appendix D, secret "12345678901234567890".
const RFC_KEY = new TextEncoder().encode('12345678901234567890');
const RFC_CODES = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];

test('HOTP matches the RFC 4226 vectors', () => {
  RFC_CODES.forEach((code, counter) => assert.equal(hotp(RFC_KEY, counter), code));
});

test('TOTP matches the RFC 6238 SHA-1 vectors, last 6 digits', () => {
  assert.equal(totpAt(RFC_KEY, 59 * 1000), '287082');
  assert.equal(totpAt(RFC_KEY, 1111111109 * 1000), '081804');
  assert.equal(totpAt(RFC_KEY, 1234567890 * 1000), '005924');
  assert.equal(totpAt(RFC_KEY, 2000000000 * 1000), '279037');
});

test('candidates are the current window then the previous, never the next', () => {
  const t = 1234567890 * 1000;
  assert.deepEqual(candidateCodes(RFC_KEY, t), [totpAt(RFC_KEY, t), totpAt(RFC_KEY, t - 30_000)]);
  assert.equal(candidateCodes(RFC_KEY, t).includes(totpAt(RFC_KEY, t + 30_000)), false);
});

test('base32 round-trips and matches the RFC 4648 vector', () => {
  assert.equal(base32Encode(new TextEncoder().encode('foobar')), 'MZXW6YTBOI');
  assert.deepEqual(base32Decode('MZXW6YTBOI'), new TextEncoder().encode('foobar'));
  assert.throws(() => base32Decode('not base32!'));
});

test('the otpauth URI names SHA1, 6 digits and 30 seconds', () => {
  const uri = otpauthUri({ key: new TextEncoder().encode('foobar'), account: 'pollux', issuer: 'JanusMirror' });
  assert.match(uri, /^otpauth:\/\/totp\/JanusMirror%3Apollux\?/);
  const params = new URL(uri).searchParams;
  assert.equal(params.get('secret'), 'MZXW6YTBOI');
  assert.equal(params.get('algorithm'), 'SHA1');
  assert.equal(params.get('digits'), '6');
  assert.equal(params.get('period'), '30');
});

test('the code takes Uint8Array keys and needs no Buffer', () => {
  assert.equal(hotp(new Uint8Array(RFC_KEY), 0), '755224');
  assert.ok(base32Decode('MZXW6YTBOI') instanceof Uint8Array);
});
