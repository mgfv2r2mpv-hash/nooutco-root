// RFC 6238 TOTP as the standard Authenticator apps do it: SHA-1, 6 digits,
// 30-second steps. Also the base32 and otpauth:// helpers enrollment needs.
// Uses only the vendored @noble hashes, so Node, a browser and a Worker run
// the same bytes; keys and decoded secrets are Uint8Array.
import { hmac } from '../vendor/noble/hashes/hmac.js';
import { sha1 } from '../vendor/noble/hashes/legacy.js';

export const STEP_SECONDS = 30;
export const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[\s=]/g, '');
  if (!/^[A-Z2-7]+$/.test(clean)) throw new Error('totp: not base32');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function hotp(key, counter) {
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setBigUint64(0, BigInt(counter));
  const mac = hmac(sha1, key, msg);
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = (new DataView(mac.buffer, mac.byteOffset).getUint32(offset) & 0x7fffffff) % 10 ** DIGITS;
  return String(bin).padStart(DIGITS, '0');
}

export function windowOf(ms) {
  return Math.floor(ms / 1000 / STEP_SECONDS);
}

export function totpAt(key, ms) {
  return hotp(key, windowOf(ms));
}

// The codes accepted at time ms: the current window, then the previous one
// for clock skew. Never the next window.
export function candidateCodes(key, ms) {
  const w = windowOf(ms);
  return [hotp(key, w), hotp(key, w - 1)];
}

// The device's clock minus the service's, in whole ms, when the device's own
// clock puts its Authenticator in a window candidateCodes() does not accept;
// null when the two clocks agree well enough for a code to match, or when the
// device sent no usable time. Only the stated time goes in, never a code, so
// the answer says nothing about the secret.
export function clockOffset(deviceMs, serviceMs) {
  if (!Number.isSafeInteger(deviceMs) || deviceMs <= 0) return null;
  const service = windowOf(serviceMs);
  const device = windowOf(deviceMs);
  if (device === service || device === service - 1) return null;
  return Math.round(deviceMs - serviceMs);
}

export function otpauthUri({ key, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Encode(key),
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params}`;
}
