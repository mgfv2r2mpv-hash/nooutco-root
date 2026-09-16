import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

import worker from "../src/index.js";
import { HOUSE_FEATURES } from "../src/house-prior.js";
import { MAX_COUNT_PER_NOTE, FAMILY_IDS } from "../src/diction-level.js";
import {
  VOICE_TOOLS, LEVEL_MAX, MAX_VOICE_NOTES, acceptVoice, foldVoice,
} from "../src/voice-write.js";
import { d1Sqlite } from "./helpers/d1-sqlite.js";

/* THE WRITE PATH FOR voice_level AND diction_level, on the store side.
 *
 * Two claims, and the second is the one that matters:
 *
 *   1. A note's levels and diction fold into running totals that a hand sum
 *      can check, across notes and inside one request.
 *   2. No route on this Worker writes a surface form. Every route is driven
 *      with a voice payload holding a house synonym or a sentence in every
 *      slot, and every table and every write statement is read afterwards.
 *
 * The SQL is real: d1Sqlite runs schema.sql and every statement in SQLite.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = readFileSync(path.join(HERE, "../schema.sql"), "utf8");
const KID = "k-7f3a9";

function post(route, body) {
  return new Request(`https://profile.internal${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const rows = (db, sql, ...params) => db.sqlite.prepare(sql).all(...params).map((r) => ({ ...r }));

// ───────────────────────────── what may be written

test("the tool list is the Pages worker's note tools, so the two sides cannot drift", () => {
  const src = readFileSync(path.resolve(HERE, "../../tools/_worker.js"), "utf8");
  const found = src.match(/const NOTES_TOOLS = \[([^\]]*)\]/);
  assert.ok(found, "NOTES_TOOLS is no longer declared where this test reads it");
  const theirs = found[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  assert.deepEqual([...VOICE_TOOLS], theirs);
  assert.throws(() => { "use strict"; VOICE_TOOLS.push("prompted"); });
});

test("the Pages worker's voice names are the house lists, so a word refused here is refused there first", () => {
  /* The Pages worker checks level names and family ids against its own copy of
     these lists, so a surface form never crosses to this Worker at all. A copy
     that fell behind would drop a real feature or family at the edge. */
  const src = readFileSync(path.resolve(HERE, "../../tools/_worker.js"), "utf8");
  const list = (name) => {
    const found = src.match(new RegExp(`const ${name} = Object\\.freeze\\(\\[([^\\]]*)\\]\\)`));
    assert.ok(found, `${name} is no longer declared where this test reads it`);
    return found[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  };
  assert.deepEqual(list("VOICE_FEATURES"), [...HOUSE_FEATURES]);
  assert.deepEqual(list("VOICE_FAMILIES"), [...FAMILY_IDS]);
});

test("the browser measures exactly the house features, by the names this side reads", () => {
  /* A feature renamed on one side only would be measured on every note and
     silently dropped here, and nothing would error. */
  const ctx = createContext({ window: {} });
  runInContext(readFileSync(path.resolve(HERE, "../../tools/notes/bcba/voice-note.js"), "utf8"), ctx);
  assert.deepEqual([...ctx.window.NoteVoice.FEATURES].sort(), [...HOUSE_FEATURES].sort());
});

test("levels are read by house feature name, so a key the payload made up is never visited", () => {
  const { notes } = acceptVoice([{
    tool: "bt",
    levels: { hedging: 0.02, actor_naming: 0.9, prompted: 0.5, "the technician prompted": 0.4, sentence_length: 14 },
  }]);
  assert.deepEqual(notes, [{ tool: "bt", levels: { actor_naming: 0.9, hedging: 0.02 }, diction: [] }]);
});

test("a level that is not a plausible reading is refused, not clamped", () => {
  const read = (v) => acceptVoice([{ tool: "bt", levels: { hedging: v, within_cv: 0.4 } }]).notes[0].levels;
  assert.deepEqual(read(0), { hedging: 0, within_cv: 0.4 });
  assert.deepEqual(read(LEVEL_MAX), { hedging: LEVEL_MAX, within_cv: 0.4 });
  for (const bad of [-0.001, LEVEL_MAX + 0.001, "0.5", NaN, Infinity, null, [0.5], { v: 0.5 }]) {
    assert.deepEqual(read(bad), { within_cv: 0.4 }, `hedging ${String(bad)} was folded in`);
  }
});

test("a tool outside the closed list is refused, even a single word a slug rule would take", () => {
  const { notes, refused } = acceptVoice([{ tool: "prompted", levels: { hedging: 0.02 } }]);
  assert.deepEqual(notes, []);
  assert.equal(refused, 1);
});

test("diction rows go through the house gate, and an entry left with nothing is not a note", () => {
  const { notes, refused } = acceptVoice([
    { tool: "sup", diction: [{ family_id: "prompted", variant_index: 0, count: 2 }, { family_id: "mand", variant_index: 1, count: 2 }] },
    { tool: "sup", diction: [{ family_id: "prompted", variant_index: 0, count: 2 }], levels: { tone: 1 } },
  ]);
  assert.deepEqual(notes, [{ tool: "sup", levels: {}, diction: [{ family_id: "mand", variant_index: 1, count: 2 }] }]);
  assert.equal(refused, 1);
});

test("one request reads at most MAX_VOICE_NOTES notes", () => {
  const many = Array.from({ length: MAX_VOICE_NOTES + 5 }, () => ({ tool: "bt", levels: { hedging: 0.01 } }));
  assert.equal(acceptVoice(many).notes.length, MAX_VOICE_NOTES);
});

// ───────────────────────────── the fold, against a hand sum

test("a note folds into the stored sums: n plus one, the value added, its square added", () => {
  const stored = { bt: { levels: [{ feature: "hedging", n: 2, sum: 0.03, sum_sq: 0.0005 }], diction: [] } };
  const { levels } = foldVoice(stored, [{ tool: "bt", levels: { hedging: 0.02 }, diction: [] }]);
  assert.equal(levels.length, 1);
  assert.equal(levels[0].tool, "bt");
  assert.equal(levels[0].feature, "hedging");
  assert.equal(levels[0].n, 3);
  assert.ok(Math.abs(levels[0].sum - 0.05) < 1e-12);
  assert.ok(Math.abs(levels[0].sum_sq - 0.0009) < 1e-12);
});

test("two notes for one tool in one request fold in order, so the second adds to the first", () => {
  const notes = [
    { tool: "bt", levels: { hedging: 0.02 }, diction: [{ family_id: "mand", variant_index: 0, count: 2 }] },
    { tool: "bt", levels: { hedging: 0.04 }, diction: [{ family_id: "mand", variant_index: 0, count: 3 }] },
  ];
  const stored = { bt: { levels: [], diction: [{ family_id: "mand", variant_index: 0, count: 10, notes: 4 }] } };
  const out = foldVoice(stored, notes);
  assert.equal(out.levels.length, 1);
  assert.equal(out.levels[0].n, 2);
  assert.ok(Math.abs(out.levels[0].sum - 0.06) < 1e-12);
  assert.deepEqual(out.diction, [{ tool: "bt", family_id: "mand", variant_index: 0, count: 15, notes: 6 }]);
});

test("a second note's NEW diction slot survives when the first note added a different one", () => {
  const out = foldVoice({}, [
    { tool: "bt", levels: {}, diction: [{ family_id: "mand", variant_index: 0, count: 1 }] },
    { tool: "bt", levels: {}, diction: [{ family_id: "mand", variant_index: 0, count: 1 }, { family_id: "mand", variant_index: 2, count: 4 }] },
  ]);
  assert.deepEqual(out.diction, [
    { tool: "bt", family_id: "mand", variant_index: 0, count: 2, notes: 2 },
    { tool: "bt", family_id: "mand", variant_index: 2, count: 4, notes: 1 },
  ]);
});

test("only the rows a request changed are written, not every row the author holds", () => {
  const stored = { bt: { levels: [], diction: [
    { family_id: "mand", variant_index: 0, count: 10, notes: 4 },
    { family_id: "prompting", variant_index: 3, count: 7, notes: 3 },
  ] } };
  const out = foldVoice(stored, [{ tool: "bt", levels: {}, diction: [{ family_id: "mand", variant_index: 0, count: 1 }] }]);
  assert.deepEqual(out.diction, [{ tool: "bt", family_id: "mand", variant_index: 0, count: 11, notes: 5 }]);
});

test("foldVoice does not touch the stored rows or the notes it was given", () => {
  const stored = { bt: { levels: [{ feature: "hedging", n: 1, sum: 0.01, sum_sq: 0.0001 }], diction: [{ family_id: "mand", variant_index: 0, count: 1, notes: 1 }] } };
  const notes = [{ tool: "bt", levels: { hedging: 0.02 }, diction: [{ family_id: "mand", variant_index: 0, count: 1 }] }];
  const before = JSON.stringify({ stored, notes });
  foldVoice(stored, notes);
  assert.equal(JSON.stringify({ stored, notes }), before);
});

// ───────────────────────────── through the route, into SQLite

test("/events writes a note's levels and diction, and a second request accumulates onto them", async () => {
  const DB = d1Sqlite(SCHEMA);
  const note = (hedging, count) => ({
    kid: KID,
    tool: "bt",
    voice: [{ tool: "bt", levels: { hedging, actor_naming: 1 }, diction: [{ family_id: "prompting", variant_index: 1, count }] }],
  });

  const first = await worker.fetch(post("/events", note(0.02, 2)), { DB });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).stored.voice, 1);
  const second = await worker.fetch(post("/events", note(0.04, MAX_COUNT_PER_NOTE)), { DB });
  assert.equal(second.status, 200);

  const levels = rows(DB, `SELECT feature, n, sum, sum_sq FROM voice_level WHERE kid = ? AND tool = 'bt' ORDER BY feature`, KID);
  assert.deepEqual(levels.map((r) => [r.feature, r.n]), [["actor_naming", 2], ["hedging", 2]]);
  const hedging = levels.find((r) => r.feature === "hedging");
  assert.ok(Math.abs(hedging.sum - 0.06) < 1e-12);
  assert.ok(Math.abs(hedging.sum_sq - 0.002) < 1e-12);

  assert.deepEqual(
    rows(DB, `SELECT family, variant, count, notes FROM diction_level WHERE kid = ?`, KID),
    [{ family: "prompting", variant: 1, count: 2 + MAX_COUNT_PER_NOTE, notes: 2 }],
  );
});

test("a request with no voice entry writes no voice row", async () => {
  const DB = d1Sqlite(SCHEMA);
  const res = await worker.fetch(post("/events", { kid: KID, tool: "bt", metrics: [{ type: "note_copied", data: { seconds: 4 } }] }), { DB });
  assert.equal(res.status, 200);
  assert.deepEqual(rows(DB, `SELECT * FROM voice_level`), []);
  assert.deepEqual(rows(DB, `SELECT * FROM diction_level`), []);
});

// ───────────────────────────── no route accepts a surface form

function houseForms() {
  const ctx = createContext({ window: {} });
  runInContext(readFileSync(path.resolve(HERE, "../../tools/notes/bcba/diction.js"), "utf8"), ctx);
  const forms = new Set();
  for (const family of ctx.window.NoteDiction.FAMILIES) {
    for (const variant of family.variants) for (const form of variant) forms.add(form.toLowerCase());
  }
  return [...forms];
}

function routesOf() {
  const src = readFileSync(path.resolve(HERE, "../src/index.js"), "utf8");
  const found = [...src.matchAll(/url\.pathname === "([^"]+)"(?: && request\.method === "([A-Z]+)")?/g)];
  return found.map((m) => ({ route: m[1], method: m[2] || "GET" }));
}

const SENTENCE = "Marisol Quintero prompted the client to request a break and then eloped from the table";

/* Every slot of a voice entry holds the form, and a second entry holds it in
   every slot but a real tool, so the tool check cannot be the only thing that
   stops it. Each entry also carries one row that IS legal, which is what makes
   an empty diction table a reading rather than a route that wrote nothing at
   all: the positive control below proves the same shape writes. */
function hostile(form) {
  const text = { word: form, text: SENTENCE, before: SENTENCE, after: form, offered: SENTENCE, kept: form };
  return [
    { ...text, tool: form, levels: { hedging: 0.02 }, diction: [{ family_id: "mand", variant_index: 0, count: 1 }] },
    {
      ...text,
      tool: "bt",
      levels: { [form]: 0.5, [SENTENCE]: 0.5, within_cv: form, hedging: SENTENCE, actor_naming: [form] },
      diction: [
        { family_id: form, variant_index: 0, count: 1 },
        { family_id: "prompting", variant_index: form, count: 1 },
        { family_id: "prompting", variant_index: 0, count: form },
        { family_id: SENTENCE, variant_index: 0, count: 1 },
        { ...text, family_id: "mand", variant_index: 0, count: 1 },
      ],
    },
  ];
}

test("every route in the source is driven, so a route added later is covered without editing this test", () => {
  const routes = routesOf();
  assert.ok(routes.length >= 10, "the route scan found too few routes to trust");
  assert.ok(routes.some((r) => r.route === "/events" && r.method === "POST"));
});

test("no route on the profile Worker writes a surface form from a voice payload, in any slot", async () => {
  const forms = houseForms();
  assert.ok(forms.length > 300, "the house dictionary did not load");
  const DB = d1Sqlite(SCHEMA);
  const matchers = [...forms, SENTENCE.toLowerCase()].map((f) =>
    new RegExp(`(^|[^a-z])${f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`, "i"));
  /* A family id is a word too: "mand" and "prompting" name a meaning and are
     also forms inside it. A value that IS one of the house's own closed-list ids
     was held by the store before any request arrived, so it is not a form the
     payload carried in. Anything else that matches a form is. */
  const own = new Set([...FAMILY_IDS, ...HOUSE_FEATURES, ...VOICE_TOOLS, KID]);
  const carries = (v) => typeof v === "string" && !own.has(v) && matchers.some((m) => m.test(v));

  for (const { route, method } of routesOf()) {
    for (const form of forms) {
      const body = { kid: KID, tool: "bt", feature: "hedging", voice: hostile(form) };
      const query = `?kid=${KID}&tool=bt&points=3`;
      const req = method === "GET"
        ? new Request(`https://profile.internal${route}${query}`)
        : post(route, body);
      const res = await worker.fetch(req, { DB });
      assert.ok(res.status < 500, `${method} ${route} failed on "${form}"`);
    }
  }

  const writes = DB.bound.filter((b) => /^\s*(INSERT|UPDATE|DELETE)/i.test(b.sql));
  const leaked = writes.flatMap((b) => b.values.filter(carries).map((v) => `${b.sql.trim().split("\n")[0]} <- ${v}`));
  assert.deepEqual(leaked, [], "a write statement was handed a surface form");

  for (const { name } of DB.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all()) {
    if (name.startsWith("sqlite_")) continue;
    const cells = DB.sqlite.prepare(`SELECT * FROM ${name}`).all().flatMap((r) => Object.values(r));
    assert.deepEqual(cells.filter(carries), [], `table ${name} holds a surface form`);
  }

  // The positive control: the legal row in each hostile entry did land, so the
  // empty checks above read a route that writes, not one that refused it all.
  // A form that is itself a family id ("prompting") is a legal family and
  // lands as one, which is the exemption above working rather than a leak.
  const stored = rows(DB, `SELECT family, variant, count FROM diction_level WHERE kid = ?`, KID);
  const mand = stored.find((r) => r.family === "mand" && r.variant === 0);
  assert.ok(mand && mand.count >= forms.length, "the legal row in each hostile entry never landed");
  assert.deepEqual(stored.filter((r) => r.family !== "mand" && !forms.includes(r.family)), []);
});
