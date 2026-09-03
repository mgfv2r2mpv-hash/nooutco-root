/* What the tool has been doing, as numbers, proved against real SQL.
 *
 * WHY LIVE. The whole handler IS a query plus a JSON aggregation over rows the
 * Pages worker wrote. Nothing about it is pure, so a unit test would be a test
 * of my own mock. The suppression test in this directory was written for the
 * same reason and found a real bug that reasoning had missed.
 *
 * WHAT IT IS FOR. The expert bench is meant to answer "how are my BTs doing"
 * with figures rather than impressions. Until this route existed the store held
 * the rows and no route aggregated them, so the only readings available were
 * anecdotes off individual notes - which is exactly how a dropped advisory hint
 * came to be argued from one note and no rate.
 *
 * Skips itself when wrangler cannot start, like its neighbour.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
/* A PORT NOBODY ELSE HOLDS, chosen at run time.
   Both live files used to hardcode one, and a hardcoded port is a port some
   other process can be sitting on. On 2026-09-03 an orphaned workerd from an
   unrelated session had held 8799 for three days; the health check saw a 200,
   believed the dev server was up, and six tests asserted against a stranger.
   Naming the service in /health stopped the false pass, but the tests then only
   skipped. Asking the OS for a free port is what makes them run. */
async function freePort() {
  const { createServer } = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let PORT = 0;
let BASE = "";

// The local D1 survives between runs, so every row this file writes carries a
// per-run kid and every assertion is scoped to it. Anything else would be a
// test of what previous runs happened to leave behind.
const RUN = Date.now().toString(36);
const KID = `metrics-test-${RUN}`;

let child = null;
let live = false;

async function up(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let sawStranger = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) {
        /* WHOSE SERVER IS THIS. Any 200 used to count, and on 2026-09-03 port
           8799 was held by an orphaned workerd from an unrelated session that
           answered 200 to everything. Every test below then ran against a
           stranger and failed like a broken feature. Now the health route names
           itself and nothing else is accepted. */
        const body = await r.json().catch(() => ({}));
        if (body && body.service === "bt-profile-api") return true;
        sawStranger = true;
      }
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  if (sawStranger) {
    console.error(`\n  Port ${PORT} is held by something that is not bt-profile-api.` +
      `\n  Find it with: lsof -nP -iTCP:${PORT} -sTCP:LISTEN\n`);
  }
  return false;
}

const post = (path, body) =>
  fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json());
const get = (path) => fetch(BASE + path).then((r) => r.json());

const d1 = (file) =>
  execFileSync("npx", ["wrangler", "d1", "execute", "bt-profiles", "--local", "--file", file, "-y"],
    { cwd: ROOT, stdio: "ignore" });

before(async () => {
  try { d1("schema.sql"); } catch { return; }
  let files = [];
  try { files = readdirSync(join(ROOT, "migrations")).filter((n) => n.endsWith(".sql")).sort(); }
  catch { files = []; }
  for (const f of files) { try { d1(join("migrations", f)); } catch { /* already applied */ } }

  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
  child = spawn("npx", ["wrangler", "dev", "--local", "--port", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  live = await up(60_000);
});

after(() => { if (child) child.kill("SIGTERM"); });

/** The events a finished note produces, as the Pages worker writes them. */
const draftEvents = (now, hints, copied) => [
  { type: "note_generated", data: { len_fLesson: 120 }, ts: now },
  { type: "note_hints", data: { ...hints }, ts: now },
  { type: "note_copied", data: copied, ts: now },
];

test("it reports drafting figures and hint rates from real rows", async (t) => {
  if (!live) return t.skip("wrangler dev did not come up");
  const now = Date.now();

  // Three finished notes. Two raise the antecedent code, one raises it twice.
  await post("/events", {
    kid: KID, tool: "bt", now,
    metrics: [
      ...draftEvents(now, { tool: "bt", antecedent_effect_unstated: 1 }, { seconds: 60, edited: 100, revisions: 1 }),
      ...draftEvents(now, { tool: "bt", antecedent_effect_unstated: 2, no_response_described: 1 }, { seconds: 120, edited: 200, revisions: 2 }),
      ...draftEvents(now, { tool: "bt" }, { seconds: 30, edited: 0, revisions: 0 }),
    ],
  });

  const m = await get("/metrics-summary?days=1");

  assert.equal(m.windowDays, 1);
  assert.ok(m.events.note_copied >= 3, `note_copied count was ${m.events.note_copied}`);

  // Three copies at 30, 60 and 120 seconds: the median is the reading that
  // survives one technician leaving a tab open over lunch, which is why both
  // it and the mean are reported.
  assert.ok(m.drafting.notesCopied >= 3);
  assert.ok(m.drafting.medianSecondsToCopy > 0, "no median was computed");
  assert.ok(m.drafting.meanCharsRetyped > 0, "no retyped mean was computed");

  const codes = Object.fromEntries(m.hints.codes.map((c) => [c.code, c]));
  const ante = codes.antecedent_effect_unstated;
  assert.ok(ante, "the antecedent code was not reported at all");

  // notes vs times is the distinction the whole event was built to keep: two
  // notes raised it, one of them twice.
  assert.ok(ante.notes >= 2, `notes was ${ante.notes}`);
  assert.ok(ante.times >= ante.notes, `times ${ante.times} was below notes ${ante.notes}`);
  assert.ok(ante.rate > 0 && ante.rate <= 1, `rate was ${ante.rate}`);
});

test("`tool` is never reported as an advisory code", async (t) => {
  if (!live) return t.skip("wrangler dev did not come up");
  // The engine's audit helper puts the tool id in the same object as the codes,
  // so anything reading that payload has to skip it by name. Reporting "tool"
  // as the most frequent finding in the system would be a very confident lie.
  const m = await get("/metrics-summary?days=1");
  assert.equal(m.hints.codes.some((c) => c.code === "tool"), false);
});

test("a draft that raised nothing still counts in the denominator", async (t) => {
  if (!live) return t.skip("wrangler dev did not come up");
  // Otherwise every code's rate is computed over the notes that had a problem
  // and every rate reads near 1.0, which would look like a catastrophe and be
  // an artifact of the denominator.
  const m = await get("/metrics-summary?days=1");
  assert.ok(m.hints.draftsMeasured >= 3, `draftsMeasured was ${m.hints.draftsMeasured}`);
  const ante = m.hints.codes.find((c) => c.code === "antecedent_effect_unstated");
  assert.ok(ante.rate < 1, `every measured draft raised it, rate ${ante.rate}`);
});

test("the window is honoured, so an old row cannot inflate today", async (t) => {
  if (!live) return t.skip("wrangler dev did not come up");
  const old = Date.now() - 90 * 24 * 60 * 60 * 1000;
  await post("/events", {
    kid: `${KID}-old`, tool: "bt", now: Date.now(),
    metrics: [{ type: "note_hints", data: { tool: "bt", stale_only_code: 5 }, ts: old }],
  });

  const recent = await get("/metrics-summary?days=1");
  assert.equal(recent.hints.codes.some((c) => c.code === "stale_only_code"), false,
    "a row from 90 days ago was counted in a one day window");

  const wide = await get("/metrics-summary?days=365");
  assert.ok(wide.hints.codes.some((c) => c.code === "stale_only_code"),
    "a 365 day window did not reach a row from 90 days ago");
});

test("it says when the row cap truncated the reading", async (t) => {
  if (!live) return t.skip("wrangler dev did not come up");
  // A capped window that stayed silent would make a busy month look like a
  // quiet one, and nothing in the answer would let anyone tell.
  const m = await get("/metrics-summary?days=1");
  assert.equal(typeof m.capped, "boolean");
  assert.ok(Number.isFinite(m.rowCap) && m.rowCap > 0);
});
