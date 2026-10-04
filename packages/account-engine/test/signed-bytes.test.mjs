// A4: the bytes a device signs for Horae Zone, moved out of the service so
// Sass, JanusMirror and the service build the same bytes from one function.
// test/fixtures/signed-bytes-vector.json is the shared vector: its key pair
// was made for the file and the private half discarded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signedBytes, SIGNED_LABEL } from '../src/signed-bytes.mjs';

const VECTOR = JSON.parse(readFileSync(new URL('./fixtures/signed-bytes-vector.json', import.meta.url), 'utf8'));
const enc = new TextEncoder();
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromB64url = (text) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)), (c) => c.charCodeAt(0));

async function verifies(sig, bytes) {
  const key = await crypto.subtle.importKey('raw', fromB64url(VECTOR.signKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, bytes);
}

test('signedBytes builds the shared vector bytes', () => {
  assert.equal(SIGNED_LABEL, VECTOR.label);
  assert.equal(hex(signedBytes(VECTOR.nonce, VECTOR.path, enc.encode(VECTOR.body))), VECTOR.bytesHex);
});

test('the vector signature verifies over those bytes with the vector key', async () => {
  const bytes = signedBytes(VECTOR.nonce, VECTOR.path, enc.encode(VECTOR.body));
  assert.equal(await verifies(fromB64url(VECTOR.sigRaw), bytes), true);
});

test('NEGATIVE CONTROL: the vector signature does not verify for another path or body', async () => {
  const sig = fromB64url(VECTOR.sigRaw);
  assert.equal(await verifies(sig, signedBytes(VECTOR.nonce, '/pin/verify', enc.encode(VECTOR.body))), false);
  assert.equal(await verifies(sig, signedBytes(VECTOR.nonce, VECTOR.path, enc.encode(`${VECTOR.body} `))), false);
});

test('each part is length-prefixed, so a byte moved between path and body changes what is signed', () => {
  const a = signedBytes(VECTOR.nonce, '/ab', enc.encode('c'));
  const b = signedBytes(VECTOR.nonce, '/a', enc.encode('bc'));
  assert.notEqual(hex(a), hex(b));
});

test('signedBytes refuses a body that is not bytes, and a nonce or path that is not a string', () => {
  // A string body would otherwise be copied as zeros, and a coerced number or
  // object would sign text the device never chose.
  for (const body of ['{"a":1}', null, undefined, [123, 34], { length: 2 }]) {
    assert.throws(() => signedBytes(VECTOR.nonce, VECTOR.path, body), TypeError, String(body));
  }
  for (const [nonce, path] of [[42, VECTOR.path], [VECTOR.nonce, null], [undefined, VECTOR.path], [VECTOR.nonce, { toString: () => '/x' }]]) {
    assert.throws(() => signedBytes(nonce, path, enc.encode('{}')), TypeError);
  }
});

test('signedBytes does not keep or change the body it is given', () => {
  const body = enc.encode(VECTOR.body);
  const copy = body.slice();
  const out = signedBytes(VECTOR.nonce, VECTOR.path, body);
  out.fill(0);
  assert.deepEqual(body, copy);
});
