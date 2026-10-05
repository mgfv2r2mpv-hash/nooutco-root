/**
 * The signed device list (Sass PR #159 section 1: Sass's shared store reads
 * it through sharedPeerKey, to confirm the other Mac's agreement key without
 * a manual step).
 *
 *   POST /devices {}  -> {list}
 *
 * The route is /devices, not a /pair route: the design review keeps
 * /pair/offer and /pair/take for bringing a vault to a new device, and names
 * no list route, so this one does not take a name from that flow.
 *
 * WHO. Signed by a confirmed device of the account: a pending device answers
 * no-device and a device of a locked account answers account-locked, as on
 * every route not marked pendingOk or lockedOk (src/index.js). The body is
 * exactly {}: the account is always the signing device's, never one a
 * request names.
 *
 * WHAT. `list` is the service's ECDSA P-256 signature (Worker secret
 * HZ_TICKET_KEY, the key Sass pins, the same key and format as the unlock
 * ticket) over `${DEVICE_LIST_LABEL}.${payload}`, the payload base64url JSON
 * {v, typ, account, at, exp, kid, devices}. Each entry of devices is a live,
 * not pending device of the account: {device, signKey, agreeKey,
 * confirmedAt}, both keys raw P-256 points in base64url, as registered. A
 * device registers with no label, so an entry carries none. The label and
 * the typ both differ from an unlock ticket's (which has no typ), so a list
 * never verifies as a ticket, and a ticket never as a list. Public keys
 * only: no address, no code state, no count.
 */
import { Refusal, b64url } from "./checks.js";
import { hasOnly } from "./signup.js";
import { ticketKey } from "./unlock.js";

export const DEVICE_LIST_LABEL = "horae-zone-device-list-v1";
export const DEVICE_LIST_TYP = "horae-zone-device-list";
export const DEVICE_LIST_LIMITS = Object.freeze({
  // Short, since a removal must reach Sass soon: a list Sass holds goes stale
  // within ten minutes of being issued.
  ttlMs: 10 * 60 * 1000,
});

const enc = new TextEncoder();

async function signList(signKey, claims) {
  const payload = b64url(enc.encode(JSON.stringify({ ...claims, kid: signKey.kid })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signKey.key, enc.encode(`${DEVICE_LIST_LABEL}.${payload}`));
  return `${payload}.${b64url(new Uint8Array(sig))}`;
}

export async function listDevices({ db, device, body, now, env }) {
  if (!hasOnly(body, [])) throw new Refusal("shape", 400);
  const signKey = await ticketKey(env);
  if (!signKey) throw new Refusal("unavailable", 503);
  // One read, so the list is one moment of the account. The signing device
  // is confirmed, so it is always in its own list; when it is not, a removal
  // or a hold landed after its checks (security review L2), and it gets none.
  const { results } = await db.prepare(
    "SELECT id, sign_key, agree_key, confirmed_at FROM device WHERE account_id = ? AND pending = 0 AND removed_at IS NULL ORDER BY confirmed_at, id",
  ).bind(device.account_id).all();
  if (!results.some((row) => row.id === device.id)) throw new Refusal("no-device", 401);
  const devices = results.map((row) => ({ device: row.id, signKey: row.sign_key, agreeKey: row.agree_key, confirmedAt: row.confirmed_at }));
  const list = await signList(signKey, {
    v: 1, typ: DEVICE_LIST_TYP, account: device.account_id, at: now, exp: now + DEVICE_LIST_LIMITS.ttlMs, devices,
  });
  return { status: 200, json: { list } };
}
