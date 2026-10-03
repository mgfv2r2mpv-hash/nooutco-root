import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { importKey, seal, open, counterNonces, nonceHex, DIRECTION } from '../src/envelope.mjs';

const enc = new TextEncoder();
const dec = new TextDecoder();
const SESSION = new Uint8Array(16).fill(7);
const P2G = DIRECTION.PHONE_TO_GATEKEEPER;
const G2P = DIRECTION.GATEKEEPER_TO_PHONE;

async function freshKey() {
  return importKey(new Uint8Array(crypto.randomBytes(32)));
}

test('a sealed message opens with the same key, direction, session and context', async () => {
  const key = await freshKey();
  const ctx = enc.encode('rid-1');
  const sealed = await seal(key, { direction: G2P, sessionId: SESSION, context: ctx, plaintext: enc.encode('MARKER-plain') });
  assert.equal(Buffer.from(sealed).includes('MARKER'), false);
  const { plaintext } = await open(key, { direction: G2P, sessionId: SESSION, context: ctx }, sealed);
  assert.equal(dec.decode(plaintext), 'MARKER-plain');
});

test('the imported key cannot be exported and the raw bytes are wiped', async () => {
  const raw = new Uint8Array(crypto.randomBytes(32));
  const key = await importKey(raw);
  assert.equal(key.extractable, false);
  assert.ok(raw.every((b) => b === 0));
  await assert.rejects(crypto.webcrypto.subtle.exportKey('raw', key));
});

test('tampering, a wrong direction, session, context or key are all refused', async () => {
  const key = await freshKey();
  const other = await freshKey();
  const ctx = enc.encode('rid-1');
  const sealed = await seal(key, { direction: P2G, sessionId: SESSION, context: ctx, plaintext: enc.encode('hello') });
  const flipped = sealed.slice();
  flipped[flipped.length - 20] ^= 1;
  const cases = [
    [key, { direction: P2G, sessionId: SESSION, context: ctx }, flipped],
    [key, { direction: G2P, sessionId: SESSION, context: ctx }, sealed],
    [key, { direction: P2G, sessionId: new Uint8Array(16), context: ctx }, sealed],
    [key, { direction: P2G, sessionId: SESSION, context: enc.encode('rid-2') }, sealed],
    [other, { direction: P2G, sessionId: SESSION, context: ctx }, sealed],
    [key, { direction: P2G, sessionId: SESSION, context: ctx }, sealed.subarray(0, 20)],
  ];
  for (const [k, meta, bytes] of cases) {
    await assert.rejects(open(k, meta, bytes), /envelope/);
  }
});

test('the counter nonce source never repeats', () => {
  const next = counterNonces();
  const seen = new Set();
  for (let i = 0; i < 10_000; i += 1) seen.add(nonceHex(next()));
  assert.equal(seen.size, 10_000);
});
