// CPace over ristretto255, keyed by the 6-digit TOTP code. This file runs on
// both ends: the gatekeeper imports it in Node, and the pairing shell loads the
// same bytes in the phone's browser. It uses only the vendored @noble libraries,
// so neither end needs WebCrypto to pair.
//
// The code authenticates the exchange and is never the key. Each side picks a
// fresh random scalar, so the session key is strong even though the code is
// short, and a recorded exchange gives no way to test code guesses offline.
//
// Flow (the phone is A, the gatekeeper is B):
//   A: sid (16 random bytes), Ya = ya * G(code)                -> B
//   B: for each candidate code c (current window, previous window):
//        Yb_c = yb_c * G(c), K_c = yb_c * Ya, tagB_c           -> A
//   A: finds the one reply whose tagB checks, sends tagA        -> B
//   B: accepts only a tagA that matches one candidate
// A wrong code fails both checks, and B learns it at the tagA step.
import { ristretto255, ristretto255_hasher } from '../vendor/noble/curves/ed25519.js';
import { sha256, sha512 } from '../vendor/noble/hashes/sha2.js';
import { hkdf } from '../vendor/noble/hashes/hkdf.js';
import { hmac } from '../vendor/noble/hashes/hmac.js';
import { randomBytes, concatBytes, utf8ToBytes } from '../vendor/noble/hashes/utils.js';

const Point = ristretto255.Point;
const Fn = Point.Fn;
const DST = utf8ToBytes('JanusMirror-CPace-ristretto255-SHA512-v1');
const ISK_LABEL = utf8ToBytes('JanusMirror-CPace-ISK-v1');
export const SID_BYTES = 16;
export const POINT_BYTES = 32;
export const TAG_BYTES = 32;
export const SESSION_ID_BYTES = 16;
const CODE_RE = /^[0-9]{6}$/;

// The channel binds an exchange to one Mac's public origin, so a code typed
// for Pollux cannot pair with Castor.
export const channelFor = (origin) => `janusmirror-e2e|${String(origin).toLowerCase()}`;

// Horae Zone runs the same exchange at /unlock/start and /unlock/finish. Its
// channel names the one registered device that signs both requests, so an
// exchange cannot finish for another device, and its label keeps it apart
// from every JanusMirror channel. The device builds the same label.
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
export function unlockChannelFor(device) {
  if (typeof device !== 'string' || !DEVICE_ID.test(device)) throw new TypeError('pake: unlock channel needs a device id');
  return `horae-zone-unlock-v1|${device}`;
}

// Length-prefixed concatenation, so no two different inputs hash alike.
function lv(...parts) {
  const out = [];
  for (const part of parts) {
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, part.length);
    out.push(len, part);
  }
  return concatBytes(...out);
}

function asBytes(value, name, length) {
  if (!(value instanceof Uint8Array) || (length !== undefined && value.length !== length)) {
    throw new Error(`pake: ${name} must be ${length ?? 'some'} bytes`);
  }
  return value;
}

function checkCode(code) {
  if (typeof code !== 'string' || !CODE_RE.test(code)) throw new Error('pake: code must be 6 digits');
  return utf8ToBytes(code);
}

// The generator depends on the code, the channel (which Mac and host) and the
// session id, so an exchange cannot be moved to another Mac or replayed.
export function generatorFor({ code, channel, sid }) {
  const msg = lv(checkCode(code), utf8ToBytes(String(channel)), asBytes(sid, 'sid', SID_BYTES));
  return ristretto255_hasher.hashToCurve(msg, { DST });
}

function randomScalar() {
  for (;;) {
    const s = Fn.create(bytesToBigLE(randomBytes(64)));
    if (s !== 0n) return s;
  }
}

function bytesToBigLE(bytes) {
  let n = 0n;
  for (let i = bytes.length - 1; i >= 0; i -= 1) n = (n << 8n) + BigInt(bytes[i]);
  return n;
}

// Decodes a peer's point; refuses a bad encoding and the identity.
function peerPoint(bytes) {
  const point = Point.fromBytes(asBytes(bytes, 'point', POINT_BYTES));
  if (point.is0()) throw new Error('pake: peer point is the identity');
  return point;
}

function deriveKeys({ sid, channel, K, Ya, Yb }) {
  if (K.is0()) throw new Error('pake: shared point is the identity');
  const isk = sha512(lv(ISK_LABEL, sid, utf8ToBytes(String(channel)), K.toBytes(), Ya, Yb));
  const expand = (label, length) => hkdf(sha256, isk, sid, utf8ToBytes(`janusmirror-e2e-v1 ${label}`), length);
  const transcript = sha256(lv(sid, Ya, Yb));
  const confirmA = expand('confirm phone', 32);
  const confirmB = expand('confirm gatekeeper', 32);
  return {
    keys: {
      sessionId: expand('session id', SESSION_ID_BYTES),
      c2s: expand('phone to gatekeeper', 32),
      s2c: expand('gatekeeper to phone', 32),
    },
    tagA: hmac(sha256, confirmA, transcript),
    tagB: hmac(sha256, confirmB, transcript),
  };
}

function equalBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Phone, step 1.
export function initiatorStart({ code, channel, sid = randomBytes(SID_BYTES) }) {
  const G = generatorFor({ code, channel, sid });
  const ya = randomScalar();
  const Ya = G.multiply(ya).toBytes();
  return { message: { sid, Ya }, state: { sid, channel, ya, Ya } };
}

// Gatekeeper: answers one message for every candidate code. Returns the replies
// to send and the pending candidates to keep until the phone's tag arrives.
export function responderReply({ codes, channel, sid, Ya }) {
  asBytes(sid, 'sid', SID_BYTES);
  const YaPoint = peerPoint(Ya);
  const unique = [...new Set(codes)];
  if (unique.length === 0) throw new Error('pake: no candidate code');
  const replies = [];
  const pending = [];
  for (const code of unique) {
    const G = generatorFor({ code, channel, sid });
    const yb = randomScalar();
    const Yb = G.multiply(yb).toBytes();
    const derived = deriveKeys({ sid, channel, K: YaPoint.multiply(yb), Ya, Yb });
    replies.push({ Yb, tagB: derived.tagB });
    pending.push({ keys: derived.keys, tagA: derived.tagA });
  }
  return { replies, pending };
}

// Phone, step 2: returns the keys and tagA, or null when no reply checks
// (a wrong code, or someone in the middle without the code).
export function initiatorFinish(state, replies) {
  if (!Array.isArray(replies)) return null;
  for (const reply of replies) {
    let derived;
    try {
      const Yb = peerPoint(reply?.Yb);
      derived = deriveKeys({ sid: state.sid, channel: state.channel, K: Yb.multiply(state.ya), Ya: state.Ya, Yb: reply.Yb });
    } catch {
      continue;
    }
    if (equalBytes(derived.tagB, reply.tagB)) return { keys: derived.keys, tagA: derived.tagA };
  }
  return null;
}

// Gatekeeper, last step: the keys of the candidate the phone proved, or null.
export function responderConfirm(pending, tagA) {
  let match = null;
  for (const candidate of pending) {
    if (equalBytes(candidate.tagA, tagA)) match = candidate.keys;
  }
  return match;
}

export const _test = { lv, equalBytes };
