/**
 * Horae Zone, the nooutco account service (plan: sass-assistant
 * docs/ios-plan.md §3). A2 skeleton: the route table and the checks every
 * route passes; handlers arrive with their slices.
 *
 * What it holds and never holds is in schema.sql. Every request ends in one
 * audit row of route and closed reason word. There is no console output: a
 * log line is one more place a value could land.
 */
import { ROUTES } from "./routes.js";
import { Refusal, readBody, findDevice, checkSignature, isAdmin } from "./checks.js";

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

async function run(request, db, routes, now) {
  const path = new URL(request.url).pathname;
  const route = Object.hasOwn(routes, path) ? routes[path] : null;
  const name = route ? path : "unknown";
  try {
    if (!route) throw new Refusal("no-route", 404);
    const { bytes, body } = await readBody(request);
    let device = null;
    if (route.checks !== "open") {
      device = await findDevice(db, request.headers.get("x-hz-device"));
      if (route.checks === "signed" || route.checks === "admin") await checkSignature(db, device, request, path, bytes, now);
      if (route.checks === "admin" && !(await isAdmin(db, device.account_id))) throw new Refusal("not-admin", 403);
    }
    if (!route.handler) throw new Refusal("not-built", 501);
    const out = await route.handler({ db, device, body, now });
    await audit(db, now, name, "ok");
    return answer(out.status, out.json);
  } catch (err) {
    const refusal = err instanceof Refusal ? err : new Refusal("failed", 500);
    await audit(db, now, name, refusal.reason);
    return answer(refusal.status, { error: refusal.reason });
  }
}

export function createHandler({ now = () => Date.now(), routes = ROUTES } = {}) {
  return async (request, env) => {
    if (!env || !env.DB) return answer(503, { error: "unavailable" });
    return run(request, env.DB, routes, now());
  };
}

const handle = createHandler();

export default {
  fetch: (request, env) => handle(request, env),
};
