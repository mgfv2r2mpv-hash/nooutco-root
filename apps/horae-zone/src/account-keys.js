/**
 * The keys Horae Zone derives from its one account secret, HZ_ACCOUNT_KEY
 * (a Worker secret, base64url, at least 32 bytes). HKDF-SHA256 gives each use
 * its own key, so no derived key can stand in for another:
 *   address key   - HMAC of the lowercased address: the lookup id an account,
 *                   an email code and a rate-limit bucket are filed under
 *   address box   - AES-GCM sealing of the address, bound to its address key,
 *                   so the address is never stored in the clear
 *   code digest   - HMAC of an email code under its address key: the form a
 *                   code is checked against
 *   link box      - AES-GCM sealing of a live email code, bound to its address
 *                   key, so a start at the per-address cap can mail the newest
 *                   live link again (second security review, item 3); the box
 *                   is dropped when the code is spent
 *   requester key - HMAC of the connecting address, the per-device rate-limit
 *                   bucket before a device has a registered key
 *   login pepper  - HMAC over the PBKDF2 output of the account password (NFKC
 *                   normalised first), so a copied table cannot be guessed
 *                   against without the secret
 *   ticket digest - HMAC of a sign-in ticket: the only form of a ticket that
 *                   is stored (A4)
 *   tag digest    - HMAC of a CPace confirmation tag the service expects, bound
 *                   to its exchange: the only form of a tag that is stored (A5)
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

// AES-GCM under `key` with a random nonce, bound to `bound` (an address key)
// as additional data: nonce then ciphertext, base64url.
async function seal(key, text, bound) {
  const iv = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const sealed = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(bound) }, key, enc.encode(text));
  const out = new Uint8Array(NONCE_BYTES + sealed.byteLength);
  out.set(iv);
  out.set(new Uint8Array(sealed), NONCE_BYTES);
  return b64url(out);
}

async function open(key, box, bound) {
  const bytes = fromB64url(box);
  if (!bytes || bytes.length <= NONCE_BYTES) throw new Error("box: unexpected shape");
  const iv = bytes.subarray(0, NONCE_BYTES);
  const plain = await subtle().decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(bound) }, key, bytes.subarray(NONCE_BYTES));
  return new TextDecoder().decode(plain);
}

export async function accountKeys(env) {
  const secret = readSecret(env?.HZ_ACCOUNT_KEY);
  if (!secret || secret.length < MIN_SECRET_BYTES) return null;
  const base = await subtle().importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  secret.fill(0);
  const hmac = { name: "HMAC", hash: "SHA-256", length: 256 };
  const aes = { name: "AES-GCM", length: 256 };
  const [addressMac, boxKey, linkKey, codeMac, requesterMac, pepper, ticketMac, tagMac] = await Promise.all([
    derive(base, "address key", hmac, ["sign"]),
    derive(base, "address box", aes, ["encrypt", "decrypt"]),
    derive(base, "link box", aes, ["encrypt", "decrypt"]),
    derive(base, "code digest", hmac, ["sign"]),
    derive(base, "requester key", hmac, ["sign"]),
    derive(base, "login pepper", hmac, ["sign"]),
    derive(base, "ticket digest", hmac, ["sign"]),
    derive(base, "tag digest", hmac, ["sign"]),
  ]);
  const mac = async (key, text) => hex(await subtle().sign("HMAC", key, enc.encode(text)));

  return Object.freeze({
    addressKey: (address) => mac(addressMac, address),
    requesterKey: (requester) => mac(requesterMac, requester),
    codeDigest: (addressKey, code) => mac(codeMac, `${addressKey}:${code}`),
    ticketDigest: (ticket) => mac(ticketMac, ticket),
    tagDigest: (exchange, tag) => mac(tagMac, `${exchange}:${tag}`),

    sealAddress: (address, addressKey) => seal(boxKey, address, addressKey),
    // Throws when the box was sealed under another secret or another address key.
    openAddress: (box, addressKey) => open(boxKey, box, addressKey),
    sealLink: (code, addressKey) => seal(linkKey, code, addressKey),
    // Throws when the box was sealed under another secret or another address key.
    openLink: (box, addressKey) => open(linkKey, box, addressKey),

    // The stored login hash: "pbkdf2-sha256$<iterations>$<hex>", with its own
    // random salt per account. The password is NFKC-normalised first, so the
    // same password typed as composed or decomposed code points, or with a
    // compatibility form (a ligature, a full-width letter), hashes alike.
    async hashLogin(password, salt = b64url(crypto.getRandomValues(new Uint8Array(SALT_BYTES)))) {
      const material = await subtle().importKey("raw", enc.encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
      const bits = await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64url(salt), iterations: LOGIN_ITERATIONS }, material, 256);
      const peppered = hex(await subtle().sign("HMAC", pepper, bits));
      return { hash: `pbkdf2-sha256$${LOGIN_ITERATIONS}$${peppered}`, salt };
    },
  });
}
