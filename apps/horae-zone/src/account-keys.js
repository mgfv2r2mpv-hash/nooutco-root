/**
 * The keys Horae Zone derives from its one account secret, HZ_ACCOUNT_KEY
 * (a Worker secret, base64url, at least 32 bytes). HKDF-SHA256 gives each use
 * its own key, so no derived key can stand in for another:
 *   address key   - HMAC of the lowercased address: the lookup id an account,
 *                   an email code and a rate-limit bucket are filed under
 *   address box   - AES-GCM sealing of the address, bound to its address key,
 *                   so the address is never stored in the clear
 *   code digest   - HMAC of an email code under its address key: the only form
 *                   of a code that is stored
 *   requester key - HMAC of the connecting address, the per-device rate-limit
 *                   bucket before a device has a registered key
 *   login pepper  - HMAC over the PBKDF2 output of the account password, so a
 *                   copied table cannot be guessed against without the secret
 * A missing or short secret gives null, and the account routes then answer
 * unavailable without writing anything.
 */
import { b64url, fromB64url } from "./checks.js";

export const LOGIN_ITERATIONS = 100_000; // the Workers runtime refuses more for PBKDF2
const MIN_SECRET_BYTES = 32;
const NONCE_BYTES = 12;
const SALT_BYTES = 16;
const enc = new TextEncoder();
const subtle = () => crypto.subtle;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function derive(base, info, algorithm, usages) {
  const params = { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(`horae-zone ${info} v1`) };
  return subtle().deriveKey(params, base, algorithm, false, usages);
}

function readSecret(text) {
  try {
    return fromB64url(text);
  } catch {
    return null; // a base64url length atob cannot decode
  }
}

export async function accountKeys(env) {
  const secret = readSecret(env?.HZ_ACCOUNT_KEY);
  if (!secret || secret.length < MIN_SECRET_BYTES) return null;
  const base = await subtle().importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  secret.fill(0);
  const hmac = { name: "HMAC", hash: "SHA-256", length: 256 };
  const [addressMac, boxKey, codeMac, requesterMac, pepper] = await Promise.all([
    derive(base, "address key", hmac, ["sign"]),
    derive(base, "address box", { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]),
    derive(base, "code digest", hmac, ["sign"]),
    derive(base, "requester key", hmac, ["sign"]),
    derive(base, "login pepper", hmac, ["sign"]),
  ]);
  const mac = async (key, text) => hex(await subtle().sign("HMAC", key, enc.encode(text)));

  return Object.freeze({
    addressKey: (address) => mac(addressMac, address),
    requesterKey: (requester) => mac(requesterMac, requester),
    codeDigest: (addressKey, code) => mac(codeMac, `${addressKey}:${code}`),

    async sealAddress(address, addressKey) {
      const iv = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
      const sealed = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(addressKey) }, boxKey, enc.encode(address));
      const out = new Uint8Array(NONCE_BYTES + sealed.byteLength);
      out.set(iv);
      out.set(new Uint8Array(sealed), NONCE_BYTES);
      return b64url(out);
    },

    // Throws when the box was sealed under another secret or another address key.
    async openAddress(box, addressKey) {
      const bytes = fromB64url(box);
      if (!bytes || bytes.length <= NONCE_BYTES) throw new Error("address box: unexpected shape");
      const iv = bytes.subarray(0, NONCE_BYTES);
      const plain = await subtle().decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(addressKey) }, boxKey, bytes.subarray(NONCE_BYTES));
      return new TextDecoder().decode(plain);
    },

    // The stored login hash: "pbkdf2-sha256$<iterations>$<hex>", with its own
    // random salt per account.
    async hashLogin(password, salt = b64url(crypto.getRandomValues(new Uint8Array(SALT_BYTES)))) {
      const material = await subtle().importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
      const bits = await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64url(salt), iterations: LOGIN_ITERATIONS }, material, 256);
      const peppered = hex(await subtle().sign("HMAC", pepper, bits));
      return { hash: `pbkdf2-sha256$${LOGIN_ITERATIONS}$${peppered}`, salt };
    },
  });
}
