/**
 * Horae Zone, the nooutco account service (plan: sass-assistant
 * docs/ios-plan.md §3). The route table and the checks every route passes
 * (A2), sign-up by email code (A3), sign-in, device registration and removal
 * and the live-nonce cap (A4); later handlers arrive with their slices.
 *
 * What it holds and never holds is in schema.sql. Every request ends in one
 * audit row of route and closed reason word, and work a handler leaves for
 * after the answer (a mail) adds a second row only when it fails. There is no
 * console output: a log line is one more place a value could land.
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

// Runs a handler's after-work and audits a failure reason it names.
async function runAfter(db, at, route, after) {
  let reason;
  try {
    reason = await after();
  } catch {
    reason = "after-failed";
  }
  if (reason) await audit(db, at, route, reason);
}

async function run(request, env, ctx, { routes, now, mailer }) {
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
      if (checks === "signed" || checks === "admin") await checkSignature(db, device, request, url.pathname, bytes, now);
      if (checks === "admin" && !(await isAdmin(db, device.account_id))) throw new Refusal("not-admin", 403);
    }
    if (!route.handler) throw new Refusal("not-built", 501);
    const out = await route.handler({ db, device, body, now, env, request, mailer: mailer ?? mailerFrom(env) });
    await audit(db, now, name, "ok");
    if (typeof out.after === "function") {
      const work = runAfter(db, now, name, out.after);
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
      else await work;
    }
    return answer(out.status, out.json);
  } catch (err) {
    const refusal = err instanceof Refusal ? err : new Refusal("failed", 500);
    await audit(db, now, name, refusal.reason);
    return answer(refusal.status, { error: refusal.reason });
  }
}

// `mailer` replaces the Resend transport (tests inject a sink, so no test
// sends mail).
export function createHandler({ now = () => Date.now(), routes = ROUTES, mailer = null } = {}) {
  return async (request, env, ctx) => {
    if (!env || !env.DB) return answer(503, { error: "unavailable" });
    return run(request, env, ctx, { routes, now: now(), mailer });
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
