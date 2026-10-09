/**
 * Turnstile on POST /account and an unsigned POST /signin (design of 8 Oct
 * 2026, section 2, Option A), and on the POST /recover start (issue #301).
 * The per-address rate rule at the edge does not bound a stranger with many
 * connecting addresses; a solved challenge per request does, whatever the
 * address.
 *
 * The client gets its token from GET /challenge (src/challenge-page.js), a
 * page this Worker serves, and sends it in the JSON body as `turnstile`. The
 * Worker checks it with Cloudflare's siteverify and accepts only:
 *   success === true
 *   hostname === TURNSTILE_HOSTNAME (a token from another site's widget fails)
 *   action === the route's action ("account", "signin" or "recover")
 *   challenge_ts no older than TOKEN_MAX_AGE_MS (and not in the future)
 *
 * FAIL CLOSED. With no HZ_TURNSTILE_SECRET the routes answer not-configured
 * (503) and never let a request through. When siteverify does not answer in
 * SITEVERIFY_TIMEOUT_MS, answers non-JSON or reports its own internal error,
 * the route answers unavailable (503). A rejected token answers challenge
 * (403). A missing or malformed token answers shape (400) before any
 * subrequest.
 *
 * The token is never stored, logged or echoed; the audit row carries the
 * route and the reason word, as for every route.
 */
import { Refusal } from "./checks.js";

export const TURNSTILE_HOSTNAME = "horae-zone.nooutco.me";
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const SITEVERIFY_TIMEOUT_MS = 5_000;
// Cloudflare's documented token life is 300 seconds; a challenge_ts older than
// that is refused here even if siteverify were to accept it.
export const TOKEN_MAX_AGE_MS = 300_000;
// A challenge_ts this far ahead of the Worker's clock is not a real one.
export const CLOCK_SKEW_MS = 60_000;
export const MAX_TOKEN_LENGTH = 2048;
export const ACTIONS = Object.freeze(["account", "signin", "recover"]);

// The sentence a client may show as it is when the keys are not set. It names
// no value and is the same for both routes.
export const NOT_CONFIGURED_SENTENCE = "Horae Zone cannot check new sign-ups or new devices yet: its Turnstile keys are not set.";

// Error codes siteverify reports for its own side or for the widget's keys:
// neither is the visitor's fault, so neither answers challenge.
const SERVICE_SIDE = new Set(["internal-error"]);
const KEY_SIDE = new Set(["missing-input-secret", "invalid-input-secret"]);

const notConfigured = () => new Refusal("not-configured", 503, undefined, NOT_CONFIGURED_SENTENCE);

// The Worker secret, or null when it is unset or blank.
export function turnstileSecret(env) {
  const value = env?.HZ_TURNSTILE_SECRET;
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function tokenOf(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_TOKEN_LENGTH) throw new Refusal("shape", 400);
  // Printable ASCII with no space: anything else is not a token Cloudflare issued.
  if (!/^[\x21-\x7e]+$/.test(value)) throw new Refusal("shape", 400);
  return value;
}

async function askSiteverify(siteverify, form) {
  let res;
  try {
    res = await siteverify(SITEVERIFY_URL, { method: "POST", body: form, signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS) });
  } catch {
    throw new Refusal("unavailable", 503);
  }
  if (!res || !res.ok) throw new Refusal("unavailable", 503);
  try {
    const json = await res.json();
    if (json === null || typeof json !== "object") throw new Error("not an object");
    return json;
  } catch {
    throw new Refusal("unavailable", 503);
  }
}

function judge(result, action, now) {
  const codes = Array.isArray(result["error-codes"]) ? result["error-codes"] : [];
  if (codes.some((c) => KEY_SIDE.has(c))) throw notConfigured();
  if (result.success !== true) {
    if (codes.some((c) => SERVICE_SIDE.has(c))) throw new Refusal("unavailable", 503);
    throw new Refusal("challenge", 403);
  }
  if (result.hostname !== TURNSTILE_HOSTNAME) throw new Refusal("challenge", 403);
  if (result.action !== action) throw new Refusal("challenge", 403);
  const issued = typeof result.challenge_ts === "string" ? Date.parse(result.challenge_ts) : NaN;
  if (!Number.isFinite(issued)) throw new Refusal("challenge", 403);
  if (now - issued > TOKEN_MAX_AGE_MS || issued - now > CLOCK_SKEW_MS) throw new Refusal("challenge", 403);
}

/**
 * Resolves when the token passes; throws a Refusal otherwise. `siteverify` is
 * a fetch-shaped function (tests inject a fake; the Worker passes fetch).
 * `ip` is the connecting address siteverify gets as remoteip.
 */
export async function verifyTurnstile(env, token, { action, ip, now, siteverify }) {
  if (!ACTIONS.includes(action)) throw new Error(`turnstile: unknown action ${action}`);
  const secret = turnstileSecret(env);
  if (!secret) throw notConfigured();
  const value = tokenOf(token);
  if (typeof siteverify !== "function") throw new Refusal("unavailable", 503);
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", value);
  if (ip) form.append("remoteip", ip);
  form.append("idempotency_key", crypto.randomUUID());
  judge(await askSiteverify(siteverify, form), action, now);
}
