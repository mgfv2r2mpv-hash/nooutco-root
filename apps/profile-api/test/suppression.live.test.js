/* Removing a rule, proved against a real Worker and a real database.
 *
 * The unit tests cover deriveRules and the validators, which are pure. They
 * cannot cover the thing that actually matters here, because it is SQL: a
 * supervisor removes a rule, and it must not reach a prompt again, INCLUDING
 * after the evidence changes and rebuildCard runs.
 *
 * That distinction is not academic. rebuildCard DELETEs any style_card row that
 * falls below the evidence bar, so a suppression flag stored on that row would
 * be wiped and the rule would come back silently. The earlier mute bug in this
 * same file was found the same way, by running real SQL rather than by
 * reasoning about it.
 *
 * Skips itself when wrangler cannot start, so a machine without it still gets a
 * green unit suite rather than a mystery failure.
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

// The local D1 is a file on disk and survives between runs, so a fixed kid
// would carry the previous run's evidence into this one and the first
// assertion would fail on state nobody in this file wrote. One run, one
// technician.
const RUN = Date.now().toString(36);
const kidFor = (n) => `sup-test-${RUN}-${n}`;
const KID = kidFor("a");

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
  fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const get = (path) => fetch(BASE + path).then((r) => r.json());

/** Enough same-direction evidence to clear MIN_EVIDENCE and MIN_CONFIDENCE. */
const corrections = (feature, direction, n, now) =>
  Array.from({ length: n }, (_, i) => ({
    feature, direction, magnitude: 1, source: "revision", ts: now - i * 60_000,
  }));

const d1 = (file) =>
  execFileSync("npx", ["wrangler", "d1", "execute", "bt-profiles", "--local", "--file", file, "-y"],
    { cwd: ROOT, stdio: "ignore" });

before(async () => {
  try {
    d1("schema.sql");
  } catch { return; }

  /* The local D1 is a file on disk that survives between runs, so schema.sql
     alone leaves it on whatever shape it had the first time it was created:
     CREATE TABLE IF NOT EXISTS cannot add a column to a table that exists.
     Skipping this is not theoretical, it is how this file started failing with
     an undefined `rules` when shape_profile grew two columns.

     Each migration is expected to fail once it has already been applied, which
     is the designed behaviour rather than a problem to report. */
  let files = [];
  // Not readdirSync inline: this hook's contract is that the whole file SKIPS
  // when the environment cannot support it, and an uncaught throw here would
  // turn that into every test erroring instead.
  try { files = readdirSync(join(ROOT, "migrations")).filter((n) => n.endsWith(".sql")).sort(); }
  catch { files = []; }
  for (const f of files) {
    try { d1(join("migrations", f)); } catch { /* already applied */ }
  }

  PORT = await freePort();
  BASE = `http://127.0.0.1:${PORT}`;
  child = spawn("npx", ["wrangler", "dev", "--local", "--port", String(PORT)],
    { cwd: ROOT, stdio: "ignore" });
  live = await up(60_000);
});

after(() => {
  if (child) child.kill("SIGTERM");
});

test("a removed rule leaves the prompt and does not come back", async (t) => {
  if (!live) return t.skip("wrangler dev did not come up");

  const now = Date.now();

  // Earn a rule.
  await post("/events", {
    kid: KID, tool: "bt", now,
    corrections: corrections("sentence_length", -1, 8, now),
  });

  let card = await get(`/style-card?kid=${KID}`);
  assert.ok(
    card.rules.some((r) => r.feature === "sentence_length"),
    "the rule should exist before anyone removes it",
  );
  assert.match(card.block, /sentence/i, "and it should be in the block that reaches the prompt");

  // A supervisor removes it.
  const removed = await post("/suppress", { kid: KID, feature: "sentence_length", removed: true, now });
  assert.equal(removed.ok, true);

  card = await get(`/style-card?kid=${KID}`);
  assert.equal(
    card.rules.some((r) => r.feature === "sentence_length"), false,
    "a removed rule must not be listed",
  );
  assert.doesNotMatch(card.block, /sentence/i, "and must not reach the prompt");

  // Now change the evidence enough to force a rebuild. Twelve events the other
  // way against the original eight puts agreement at 60%, under the 0.7 bar, so
  // rebuildCard DELETEs the style_card row outright. That is precisely the case
  // a suppression flag stored on that row would not survive.
  await post("/events", {
    kid: KID, tool: "bt", now: now + 1000,
    corrections: corrections("sentence_length", 1, 12, now + 1000),
  });

  card = await get(`/style-card?kid=${KID}`);
  assert.equal(
    card.rules.some((r) => r.feature === "sentence_length"), false,
    "a rebuild must not resurrect a rule a supervisor removed",
  );

  // The supervisor view still knows the removal happened, even with no derived
  // row left to hang it off.
  const sup = await get(`/card-detail?kid=${KID}`);
  const orphan = sup.removedWithoutRule.find((r) => r.feature === "sentence_length");
  const attached = sup.rules.find((r) => r.feature === "sentence_length" && r.removed);
  assert.ok(orphan || attached, "the removal must still be visible after a rebuild");
});

test("restoring a rule brings it back when the evidence still supports one", async (t) => {
  if (!live) return t.skip("wrangler dev did not come up");

  const kid = kidFor("d");
  const now = Date.now();
  await post("/events", {
    kid, tool: "bt", now,
    corrections: corrections("contractions", 1, 9, now),
  });

  await post("/suppress", { kid, feature: "contractions", removed: true, now });
  let card = await get(`/style-card?kid=${kid}`);
  assert.equal(card.rules.some((r) => r.feature === "contractions"), false, "removed");

  await post("/suppress", { kid, feature: "contractions", removed: false });
  card = await get(`/style-card?kid=${kid}`);
  assert.ok(card.rules.some((r) => r.feature === "contractions"), "and back again");
});

test("the supervisor view shows what the technician view hides", async (t) => {
  if (!live) return t.skip("wrangler dev did not come up");

  const now = Date.now();
  const kid = kidFor("b");
  await post("/events", {
    kid, tool: "bt", now,
    corrections: corrections("plain_wording", 1, 8, now),
  });
  await post("/suppress", { kid, feature: "plain_wording", removed: true, now });

  const tech = await get(`/style-card?kid=${kid}`);
  assert.equal(tech.rules.length, 0, "the technician sees nothing of the removal");

  const sup = await get(`/card-detail?kid=${kid}`);
  const row = sup.rules.find((r) => r.feature === "plain_wording");
  assert.ok(row, "the supervisor still sees the rule");
  assert.equal(row.removed, true, "flagged as removed");
  assert.ok(row.removedAt > 0, "with when it happened");

  const roster = await get("/roster");
  const entry = roster.technicians.find((x) => x.kid === kid);
  assert.ok(entry, "and the technician appears on the roster");
  assert.equal(entry.removed, 1, "with the removal counted");
});

test("history replays the card rather than inventing one", async (t) => {
  if (!live) return t.skip("wrangler dev did not come up");

  const kid = kidFor("c");
  const now = Date.now();
  // Old evidence one way, recent evidence the other, so the trend has to move.
  await post("/events", {
    kid, tool: "bt", now,
    corrections: corrections("hedging", -1, 8, now - 120 * 86_400_000),
  });
  await post("/events", {
    kid, tool: "bt", now,
    corrections: corrections("hedging", 1, 10, now),
  });

  const h = await get(`/card-history?kid=${kid}&points=6`);
  assert.equal(h.points.length, 6, "asks for six points, gets six");
  assert.ok(h.features.includes("hedging"), "and names the feature it tracked");

  // Points are ordered and cumulative: a later point never saw fewer events.
  for (let i = 1; i < h.points.length; i++) {
    assert.ok(h.points[i].ts >= h.points[i - 1].ts, "points move forward in time");
    assert.ok(h.points[i].events >= h.points[i - 1].events, "and evidence only accumulates");
  }

  const last = h.points[h.points.length - 1].rules.find((r) => r.feature === "hedging");
  assert.ok(last, "the final point carries the rule");
  assert.equal(last.direction, 1, "and follows the recent evidence, not the old evidence");
});

test("a technician with no corrections has an empty history rather than an error", async (t) => {
  if (!live) return t.skip("wrangler dev did not come up");
  const h = await get("/card-history?kid=sup-test-nobody-" + RUN + "");
  assert.deepEqual(h.points, []);
  assert.deepEqual(h.features, []);
});

test("suppress refuses anything outside the closed feature list", async (t) => {
  if (!live) return t.skip("wrangler dev did not come up");
  const bad = await post("/suppress", { kid: KID, feature: "not_a_real_feature", removed: true });
  assert.equal(bad.ok, undefined);
  assert.match(bad.error, /Unknown feature/);
});
