// AES-256-GCM sealing for everything that crosses the tunnel once a phone is
// paired. Runs on both ends through WebCrypto (Node's globalThis.crypto and the
// phone's browser and service worker), so the bytes are sealed the same way.
//
// Wire format: 1 version byte, 12 nonce bytes, then ciphertext with its tag.
// The additional data binds every message to its direction, its session and a
// caller context (a request id for a response, a frame number for WebSocket),
// so a sealed message cannot be moved to another direction, session or slot.
const VERSION = 1;
const NONCE_BYTES = 12;
const LABEL = new TextEncoder().encode('janusmirror-e2e-v1');
export const DIRECTION = Object.freeze({ PHONE_TO_GATEKEEPER: 1, GATEKEEPER_TO_PHONE: 2 });

const subtle = () => globalThis.crypto.subtle;

// Imports raw key bytes as a non-extractable AES-GCM key, then wipes the bytes.
export async function importKey(raw) {
  if (!(raw instanceof Uint8Array) || raw.length !== 32) throw new Error('envelope: key must be 32 bytes');
  try {
    return await subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  } finally {
    raw.fill(0);
  }
}

function additionalData(direction, sessionId, context) {
  if (direction !== DIRECTION.PHONE_TO_GATEKEEPER && direction !== DIRECTION.GATEKEEPER_TO_PHONE) {
    throw new Error('envelope: unknown direction');
  }
  const ctx = context ?? new Uint8Array(0);
  const out = new Uint8Array(LABEL.length + 1 + 1 + sessionId.length + 4 + ctx.length);
  let at = 0;
  out.set(LABEL, at); at += LABEL.length;
  out[at] = VERSION; at += 1;
  out[at] = direction; at += 1;
  out.set(sessionId, at); at += sessionId.length;
  new DataView(out.buffer).setUint32(at, ctx.length); at += 4;
  out.set(ctx, at);
  return out;
}

// Random nonces: the phone's page and its service worker both seal with the
// same key and share no counter, so a counter could repeat across them. The
// gatekeeper passes its own counter-based nonce instead (nonceSource below).
export function randomNonce() {
  return globalThis.crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
}

// A per-session nonce source that never repeats: 4 random bytes fixed at
// creation, then an 8-byte counter.
export function counterNonces() {
  const prefix = globalThis.crypto.getRandomValues(new Uint8Array(4));
  let counter = 0n;
  return () => {
    counter += 1n;
    const nonce = new Uint8Array(NONCE_BYTES);
    nonce.set(prefix, 0);
    new DataView(nonce.buffer).setBigUint64(4, counter);
    return nonce;
  };
}

export async function seal(key, { direction, sessionId, context, plaintext, nonce = randomNonce() }) {
  if (!(nonce instanceof Uint8Array) || nonce.length !== NONCE_BYTES) throw new Error('envelope: bad nonce');
  const ct = new Uint8Array(await subtle().encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: additionalData(direction, sessionId, context), tagLength: 128 },
    key,
    plaintext,
  ));
  const out = new Uint8Array(1 + NONCE_BYTES + ct.length);
  out[0] = VERSION;
  out.set(nonce, 1);
  out.set(ct, 1 + NONCE_BYTES);
  return out;
}

// Returns { plaintext, nonce }, or throws on any tamper or mismatch.
export async function open(key, { direction, sessionId, context }, sealed) {
  if (!(sealed instanceof Uint8Array) || sealed.length < 1 + NONCE_BYTES + 16 || sealed[0] !== VERSION) {
    throw new Error('envelope: not a sealed message');
  }
  const nonce = sealed.slice(1, 1 + NONCE_BYTES);
  let plain;
  try {
    plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: additionalData(direction, sessionId, context), tagLength: 128 },
      key,
      sealed.subarray(1 + NONCE_BYTES),
    );
  } catch {
    throw new Error('envelope: refused');
  }
  return { plaintext: new Uint8Array(plain), nonce };
}

export function nonceHex(nonce) {
  let s = '';
  for (const b of nonce) s += b.toString(16).padStart(2, '0');
  return s;
}
