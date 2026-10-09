import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import worker from "../src/index.js";
import { housePrior } from "../src/house-prior.js";
import { MOVES_PER_NOTE, accumulateLevel } from "../src/voice-shrink.js";
import { FAMILY_IDS } from "../src/diction-level.js";
import {
  READ_FEATURES, DICTION_MIN_NOTES, DICTION_MIN_SHARE, DICTION_MAX_FAMILIES,
  levelMoves, dictionPicks, voiceReading,
} from "../src/voice-read.js";
import { d1Sqlite } from "./helpers/d1-sqlite.js";

/* SLICE 6: a draft reads its author's stored voice back. Every kid and reading
 * below is invented. */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(path.join(HERE, "../schema.sql"), "utf8");

/** Running sums for `n` notes all reading `value`, as voice_level stores them. */
function rowOf(feature, value, n) {
  let row = null;
  for (let i = 0; i < n; i += 1) row = accumulateLevel(row, value);
  return { feature, ...row };
}

test("a technician with no stored voice gets an empty reading, so the prompt is unchanged", () => {
  assert.deepEqual(voiceReading([], []), { levels: [], diction: [] });
  assert.deepEqual(voiceReading(null, undefined), { levels: [], diction: [] });
});

test("an author who already writes like the house earns no move", () => {
  const moves = levelMoves([
    rowOf("actor_naming", housePrior("actor_naming").mean, 30),
    rowOf("hedging", housePrior("hedging").mean, 30),
  ]);
  assert.deepEqual(moves, []);
});

test("an author far from the house earns a move toward their own target, inside the envelope", () => {
  const moves = levelMoves([rowOf("hedging", 0.044, 40)]);
  assert.equal(moves.length, 1);
  const [m] = moves;
  assert.equal(m.feature, "hedging");
  assert.equal(m.direction, "more");
  assert.equal(m.n, 40);
  const { floor, ceiling } = housePrior("hedging");
  assert.ok(m.target > housePrior("hedging").mean && m.target >= floor && m.target <= ceiling, `target ${m.target}`);
});

test("an author who strips the actor out is told less, but never below the house floor", () => {
  const moves = levelMoves([rowOf("actor_naming", 0.1, 200)]);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].direction, "less");
  assert.equal(moves[0].target, housePrior("actor_naming").floor);
});

test("the shape features are never read here, however far out they sit", () => {
  const moves = levelMoves([rowOf("within_cv", 3.9, 100), rowOf("step_rel", 3.9, 100)]);
  assert.deepEqual(moves, []);
  assert.deepEqual([...READ_FEATURES].sort(), ["actor_naming", "hedging"]);
});

test("the moves never exceed Kaleb's budget of two", () => {
  const moves = levelMoves([rowOf("actor_naming", 0.1, 200), rowOf("hedging", 0.044, 200)]);
  assert.ok(moves.length <= MOVES_PER_NOTE);
  assert.equal(MOVES_PER_NOTE, 2);
});

test("one note buys less than forty: the target moves with evidence", () => {
  const one = levelMoves([rowOf("actor_naming", 0.1, 1)]);
  const many = levelMoves([rowOf("actor_naming", 0.1, 40)]);
  // One note at k = 1 buys half the distance from the house; forty buy nearly
  // all of it, down to the floor.
  assert.equal(one.length, 1);
  assert.equal(many.length, 1);
  assert.ok(one[0].target > many[0].target, `one note ${one[0].target}, forty ${many[0].target}`);
  assert.ok(one[0].target < housePrior("actor_naming").mean);
});

const dictionRow = (family, variant, count, notes) => ({ family, variant, count, notes });

test("a word choice is read only once it clears both bars", () => {
  assert.deepEqual(dictionPicks([dictionRow("prompting", 1, 9, DICTION_MIN_NOTES - 1)]), []);
  assert.deepEqual(dictionPicks([
    dictionRow("prompting", 1, 5, 6),
    dictionRow("prompting", 0, 5, 6),
  ]), [], `a 50 percent share is under the ${DICTION_MIN_SHARE} bar`);
  assert.deepEqual(dictionPicks([
    dictionRow("prompting", 1, 8, 6),
    dictionRow("prompting", 0, 2, 6),
  ]), [{ family_id: "prompting", variant_index: 1, share: 0.8, notes: 6 }]);
});

test("a family the house does not hold is never read, and the picks are capped", () => {
  assert.deepEqual(dictionPicks([dictionRow("coached", 0, 20, 20)]), []);
  const all = FAMILY_IDS.map((f, i) => dictionRow(f, 0, 10, 3 + i));
  const picks = dictionPicks(all);
  assert.equal(picks.length, DICTION_MAX_FAMILIES);
  // The most evidenced first.
  assert.deepEqual(picks.map((p) => p.notes), [...picks.map((p) => p.notes)].sort((a, b) => b - a));
});

test("the reading holds ids and numbers and no other string", () => {
  const reading = voiceReading(
    [rowOf("actor_naming", 0.1, 200), rowOf("hedging", 0.044, 200)],
    [dictionRow("mand", 1, 9, 9), dictionRow("prompting", 2, 9, 9)],
  );
  const strings = [];
  const walk = (v) => {
    if (typeof v === "string") strings.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(reading);
  const allowed = new Set([...READ_FEATURES, "more", "less", ...FAMILY_IDS]);
  for (const s of strings) assert.ok(allowed.has(s), `a string outside the closed lists: ${s}`);
  assert.ok(reading.levels.length > 0 && reading.diction.length > 0, "positive control: the reading is not empty");
});

test("/style-card carries the reading for this kid and tool only, through real SQL", async () => {
  const DB = d1Sqlite(SCHEMA);
  const now = Date.now();
  const insertLevel = DB.sqlite.prepare(
    "INSERT INTO voice_level (kid, tool, feature, n, sum, sum_sq, w_n, w_sum, w_sum_sq, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const r = rowOf("hedging", 0.044, 40);
  insertLevel.run("kid-a", "bt", "hedging", r.n, r.sum, r.sum_sq, r.w_n, r.w_sum, r.w_sum_sq, now);
  insertLevel.run("kid-b", "bt", "hedging", r.n, r.sum, r.sum_sq, r.w_n, r.w_sum, r.w_sum_sq, now);
  const insertDiction = DB.sqlite.prepare(
    "INSERT INTO diction_level (kid, tool, family, variant, count, notes, updated) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  insertDiction.run("kid-a", "bt", "mand", 1, 12, 5, now);
  insertDiction.run("kid-a", "sup", "prompting", 2, 12, 5, now);

  const get = async (kid, tool) => (await (await worker.fetch(
    new Request(`https://profile.internal/style-card?kid=${kid}&tool=${tool}&seed=s1`), { DB },
  )).json()).voice;

  const a = await get("kid-a", "bt");
  assert.deepEqual(a.levels.map((m) => m.feature), ["hedging"]);
  assert.deepEqual(a.diction, [{ family_id: "mand", variant_index: 1, share: 1, notes: 5 }]);
  // Another tool's diction stays with that tool.
  assert.deepEqual((await get("kid-a", "sup")).levels, []);
  assert.deepEqual((await get("kid-a", "sup")).diction.map((d) => d.family_id), ["prompting"]);
  // Another kid's rows never cross.
  assert.deepEqual((await get("kid-c", "bt")), { levels: [], diction: [] });
});
