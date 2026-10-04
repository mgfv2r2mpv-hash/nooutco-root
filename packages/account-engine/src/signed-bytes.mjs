// The bytes a device signs for Horae Zone, in one place so the service, Sass
// and JanusMirror build the same bytes (test/fixtures/signed-bytes-vector.json
// is the shared vector each of them checks against).
//
// lv(SIGNED_LABEL) | lv(nonce) | lv(path) | lv(body), each part prefixed with
// its length as a 4-byte big-endian number, so no byte can move between two
// parts without changing what is signed. The device signs these bytes with
// ECDSA P-256 over SHA-256.
//
// The body is the request body exactly as sent, as bytes. A string, an array
// or a number is refused rather than coerced: a coerced value would be text
// the device never chose to sign.

export const SIGNED_LABEL = 'horae-zone-v1';

const enc = new TextEncoder();
const LABEL_BYTES = enc.encode(SIGNED_LABEL);

export function signedBytes(nonce, path, body) {
  if (typeof nonce !== 'string') throw new TypeError('signedBytes: the nonce must be a string');
  if (typeof path !== 'string') throw new TypeError('signedBytes: the path must be a string');
  if (!(body instanceof Uint8Array)) throw new TypeError('signedBytes: the body must be a Uint8Array');
  const parts = [LABEL_BYTES, enc.encode(nonce), enc.encode(path), body];
  const out = new Uint8Array(parts.reduce((n, p) => n + 4 + p.length, 0));
  const view = new DataView(out.buffer);
  let at = 0;
  for (const p of parts) {
    view.setUint32(at, p.length);
    out.set(p, at + 4);
    at += 4 + p.length;
  }
  return out;
}
