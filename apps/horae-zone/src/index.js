/**
 * Horae Zone, the nooutco account service (plan: sass-assistant
 * docs/ios-plan.md §3). The route table and the checks every route passes
 * (A2), sign-up by email code (A3), sign-in, device registration and removal
 * and the live-nonce cap (A4), the one authenticator code: enrolment, the
 * CPace code check, its lockout and the reopen link (A5); later handlers
 * arrive with their slices.
 *
 * A pending device (A5: any device but the owner device the sign-up link
 * registered, until it proves the account's code) reaches only the routes
 * marked pendingOk, and every other route answers no-device, as for an
 * unknown device. A device of an account the offline block locked (A5b)
 * reaches only the routes marked lockedOk; every other device route answers
 * account-locked, read after the device checks.
 *
 * What it holds and never holds is in schema.sql. Every request ends in one
 * audit row of route and closed reason word, and work a handler or a refusal
 * leaves for after the answer (a mail) adds a second row only when it fails. There is no
 * console output: a log line is one more place a value could land.
 *
 * GET /challenge (src/challenge-page.js) is the one exception to POST only:
 * the fixed page where the Turnstile widget runs. POST /account, an
 * unsigned POST /signin and the POST /recover start carry its token in the
 * body (src/turnstile.js).
 *
 * A request with a query string is refused as shape before anything else:
 * every value travels in a body (or a link fragment), never in a URL a proxy
 * or an access log keeps.
 *
 * The scheduled handler (wrangler.toml [triggers]) purges spent and expired
 * nonces and email codes, rate-limit rows past their window and audit rows
 * past their retention (src/retention.js). A failed purge throws, so
 * Cloudflare records the cron run as failed.
 */
import { createMailer } from "../../../packages/account-engine/src/mailer.mjs";
import { ROUTES } from "./routes.js";
import { Refusal, readBody, findDevice, checkSignature, isAdmin } from "./checks.js";
import { purgeExpired } from "./retention.js";
import { accountLocked } from "./account-lock.js";
import { challengePage } from "./challenge-page.js";
import { budgetedMailer } from "./mail-budget.js";

const HEADERS = { "content-type": "application/json", "cache-control": "no-store" };

function answer(status, json) {
  return new Response(JSON.stringify(json), { status, headers: HEADERS });
}

async function audit(db, at, route, reason) {
  try {
    await db.prepare("INSERT INTO audit (at, route, reason) VALUES (?, ?, ?)").bind(at, route, reason).run();
  } catch {
    // The answer still goes out; an audit write that fails carries no value to report.
  }
}

// The production mail transport: Resend, with the key read from the Worker
// secret at send time. Null when either binding is missing, and the routes
// that mail then answer unavailable.
function mailerFrom(env) {
  if (!env.HZ_MAIL_FROM || !env.RESEND_KEY) return null;
  return createMailer({ from: env.HZ_MAIL_FROM, readKey: async () => env.RESEND_KEY });
}

// The transport a handler gets: every send takes a place in the shared daily
// mail budget first (src/mail-budget.js), whoever sends it. Null when there
// is no transport, so the routes that mail answer unavailable.
function budgeted(db, env, now, mailer) {
  const base = mailer ?? mailerFrom(env);
  return base ? budgetedMailer({ db, env, now, mailer: base }) : null;
}

// Runs a handler's after-work and audits each failure reason it names (one
// reason word, or a list of them).
async function runAfter(db, at, route, after) {
  let reasons;
  try {
    reasons = await after();
  } catch {
    reasons = "after-failed";
  }
  for (const reason of [reasons].flat()) {
    if (reason) await audit(db, at, route, reason);
  }
}

// Hands after-work to the runtime to finish once the answer is out.
async function later(db, at, route, ctx, after) {
  if (typeof after !== "function") return;
  const work = runAfter(db, at, route, after);
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
  else await work;
}

async function run(request, env, ctx, { routes, now, mailer, pinRules, siteverify }) {
  const db = env.DB;
  const url = new URL(request.url);
  const route = Object.hasOwn(routes, url.pathname) ? routes[url.pathname] : null;
  const name = route ? url.pathname : "unknown";
  try {
    if (url.search !== "") throw new Refusal("shape", 400);
    if (!route) throw new Refusal("no-route", 404);
    const { bytes, body } = await readBody(request);
    let device = null;
    const checks = route.checks !== "signable" ? route.checks : request.headers.has("x-hz-device") ? "signed" : "open";
    if (checks !== "open") {
      device = await findDevice(db, request.headers.get("x-hz-device"));
      if (device.pending && !route.pendingOk) throw new Refusal("no-device", 401);
      if (checks === "signed" || checks === "admin") await checkSignature(db, device, request, url.pathname, bytes, now);
      if (checks === "admin" && !(await isAdmin(db, device.account_id))) throw new Refusal("not-admin", 403);
      if (!route.lockedOk && (await accountLocked(db, device.account_id))) throw new Refusal("account-locked", 423);
    }
    if (!route.handler) throw new Refusal("not-built", 501);
    const out = await route.handler({ db, device, body, now, env, request, mailer: budgeted(db, env, now, mailer), pinRules, siteverify });
    // A handler may name its outcome word in place of "ok" (A5c: an admin
    // unlock says whether it unlocked); always a fixed word, never a value.
    await audit(db, now, name, out.audit ?? "ok");
    await later(db, now, name, ctx, out.after);
    return answer(out.status, out.json);
  } catch (err) {
    const refusal = err instanceof Refusal ? err : new Refusal("failed", 500);
    await audit(db, now, name, refusal.reason);
    await later(db, now, name, ctx, refusal.after);
    return answer(refusal.status, refusal.sentence ? { error: refusal.reason, message: refusal.sentence } : { error: refusal.reason });
  }
}

// `mailer` replaces the Resend transport (tests inject a sink, so no test
// sends mail). `pinRules` is the engine's createPinRules over the private
// blocklist (A5b); without it no PIN can be set (src/pin.js), and none is
// built in here, since the list never enters this public repository.
// `siteverify` replaces fetch for Turnstile's siteverify call (tests inject a
// fake, so no test reaches Cloudflare).
export function createHandler({ now = () => Date.now(), routes = ROUTES, mailer = null, pinRules = null, siteverify = (url, init) => fetch(url, init) } = {}) {
  return async (request, env, ctx) => {
    // The challenge page is the one GET (src/challenge-page.js); it needs no
    // database and runs before run(), so every other route stays POST only.
    if (request.method === "GET") {
      const { pathname, search } = new URL(request.url);
      if (pathname === "/challenge" && search === "") return challengePage(env);
    }
    if (!env || !env.DB) return answer(503, { error: "unavailable" });
    return run(request, env, ctx, { routes, now: now(), mailer, pinRules, siteverify });
  };
}

export function createScheduled({ retention = {} } = {}) {
  return (controller, env, ctx) => {
    if (!env || !env.DB) throw new Error("scheduled purge: no database bound");
    ctx.waitUntil(purgeExpired(env.DB, controller.scheduledTime, retention));
  };
}

const handle = createHandler();
const purge = createScheduled();

export default {
  fetch: (request, env, ctx) => handle(request, env, ctx),
  scheduled: (controller, env, ctx) => purge(controller, env, ctx),
};
