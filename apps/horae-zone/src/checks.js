/**
 * The checks every Horae Zone request passes before a handler runs, and the
 * device-signature format devices must match.
 *
 * SIGNED BYTES. A device signs lv("horae-zone-v1") | lv(nonce) | lv(path) |
 * lv(body), each part length-prefixed (4-byte big-endian), with ECDSA P-256
 * over SHA-256. The bytes are built by the engine's signedBytes (A4 moved it
 * there, with a shared test vector, so Sass and JanusMirror build the same
 * bytes). The Secure Enclave's DER signature and WebCrypto's raw r||s are
 * both accepted. The nonce is single use, bound to the device it was issued
 * to, and lives NONCE_TTL_MS. A device holds at most LIVE_NONCES_PER_DEVICE
 * live nonces, so a stolen device id cannot fill the nonce table.
 *
 * Every refusal is a closed reason word. Nothing a request carries is echoed,
 * stored or logged.
 */

import { signedBytes } from "../../../packages/account-engine/src/signed-bytes.mjs";

export { signedBytes };

export const MAX_BODY_BYTES = 16 * 1024;
export const NONCE_TTL_MS = 60_000;
// A device signs one request per nonce and a nonce lives NONCE_TTL_MS, so
// five covers a few requests in flight at once and stays far below anything
// that could fill the table.
export const LIVE_NONCES_PER_DEVICE = 5;

export class Refusal extends Error {
  constructor(reason, status) {
    super(reason);
    this.reason = reason;
    this.status = status;
  }
}

export function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

// DER ECDSA-Sig-Value to raw r||s (32 bytes each). Returns null for anything
// that is not a well-formed P-256 DER signature.
export function derToRaw(der) {
  if (der.length < 8 || der[0] !== 0x30 || der[1] !== der.length - 2) return null;
  const out = new Uint8Array(64);
  let at = 2;
  for (let i = 0; i < 2; i += 1) {
    if (der[at] !== 0x02) return null;
    const len = der[at + 1];
    let int = der.subarray(at + 2, at + 2 + len);
    if (int.length !== len) return null;
    while (int.length > 32 && int[0] === 0) int = int.subarray(1);
    if (int.length > 32) return null;
    out.set(int, i * 32 + (32 - int.length));
    at += 2 + len;
  }
  return at === der.length ? out : null;
}

// A POST of a JSON object no larger than MAX_BODY_BYTES. Returns the raw bytes
// (what a signature covers) and the parsed object.
export async function readBody(request) {
  if (request.method !== "POST") throw new Refusal("method", 405);
  if ((request.headers.get("content-type") || "").split(";")[0].trim() !== "application/json") throw new Refusal("shape", 400);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Refusal("too-large", 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BODY_BYTES) throw new Refusal("too-large", 413);
  let body;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Refusal("shape", 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new Refusal("shape", 400);
  return { bytes, body };
}

export async function findDevice(db, id) {
  // Ids are opaque base64url-style tokens; anything else is refused before it
  // reaches a query.
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Refusal("no-device", 401);
  const row = await db.prepare("SELECT id, account_id, sign_key FROM device WHERE id = ? AND removed_at IS NULL").bind(id).first();
  if (!row) throw new Refusal("no-device", 401);
  return row;
}

// Spends the nonce (only once, only for its own device, only before expiry),
// then checks the signature. The nonce is spent even when the signature
// fails, so a guesser cannot retry one nonce.
export async function checkSignature(db, device, request, path, bytes, now) {
  const nonce = request.headers.get("x-hz-nonce");
  const sig = fromB64url(request.headers.get("x-hz-sig"));
  if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) throw new Refusal("stale-nonce", 401);
  const spent = await db.prepare("UPDATE nonce SET used = 1 WHERE value = ? AND device_id = ? AND used = 0 AND expires_at > ? RETURNING value")
    .bind(nonce, device.id, now).first();
  if (!spent) throw new Refusal("stale-nonce", 401);
  const raw = !sig ? null : sig.length === 64 ? sig : derToRaw(sig);
  const keyBytes = fromB64url(device.sign_key);
  if (!raw || !keyBytes) throw new Refusal("bad-signature", 401);
  let ok = false;
  try {
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw, signedBytes(nonce, path, bytes));
  } catch {
    ok = false;
  }
  if (!ok) throw new Refusal("bad-signature", 401);
}

export async function isAdmin(db, accountId) {
  const row = await db.prepare("SELECT 1 AS yes FROM role WHERE account_id = ? AND role = 'admin'").bind(accountId).first();
  return Boolean(row);
}

// POST /nonce: a fresh challenge for a registered device, refused once the
// device already holds LIVE_NONCES_PER_DEVICE live ones. The count and the
// insert are one statement, so requests arriving together cannot pass the cap.
export async function issueNonce({ db, device, now }) {
  const value = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const made = await db.prepare(
    "INSERT INTO nonce (value, device_id, expires_at, used) SELECT ?, ?, ?, 0 WHERE (SELECT COUNT(*) FROM nonce WHERE device_id = ? AND used = 0 AND expires_at > ?) < ? RETURNING value",
  ).bind(value, device.id, now + NONCE_TTL_MS, device.id, now, LIVE_NONCES_PER_DEVICE).first();
  if (!made) throw new Refusal("slow-down", 429);
  return { status: 200, json: { nonce: value } };
}
