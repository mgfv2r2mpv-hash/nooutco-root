import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FAMILY_VARIANTS, FAMILY_IDS, MAX_COUNT_PER_NOTE, accept, applyNote, familyShares,
} from "../src/diction-level.js";

/* Three things are guarded here, and the first one is the whole reason this
 * file exists.
 *
 * THE TWO SIDES AGREE. The dictionary is in the browser and the store is here,
 * and `variant_index` is a POSITION in that dictionary. A synonym inserted in
 * the middle of a family over there silently rewrites every row already stored
 * over here, and nothing would error. So this test loads the real browser file
 * and pins the mirror against it, which is the only moment the two are ever in
 * the same process.
 *
 * THE GATE RUNS ON THE UNTRUSTED SIDE OF THE HOP. The browser refuses a family
 * it does not hold, and the browser is the side somebody else controls. accept()
 * is the gate that decides what gets written, so it is tested as though the
 * browser's gate were not there at all.
 *
 * NO WORD CAN BE IN A ROW. Every value a row can carry is a slug from the closed
 * list or an integer, including in a refusal, which is where a rejected string
 * would otherwise land verbatim in a log.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DICTION_JS = path.resolve(HERE, "../../tools/notes/bcba/diction.js");

function loadBrowserDiction() {
  const ctx = createContext({ window: {} });
  runInContext(readFileSync(DICTION_JS, "utf8"), ctx);
  return ctx.window.NoteDiction;
}

test("the mirror matches the browser dictionary, family for family", () => {
  const browser = loadBrowserDiction();
  assert.deepEqual(
    Object.keys(FAMILY_VARIANTS).sort(),
    [...browser.FAMILY_IDS].sort(),
    "a family was added, removed or renamed on one side only",
  );
  for (const id of browser.FAMILY_IDS) {
    assert.equal(
      FAMILY_VARIANTS[id],
      browser.VARIANT_COUNTS[id],
      `family ${id} holds a different number of variants on each side, so a stored index may now mean a different word`,
    );
  }
});

test("the store side holds no surface form at all", () => {
  /* The property the schema comment claims. Every value in the mirror is a
     count, and every key is a slug. A synonym added here would be a word living
     in the store's own source, which is the habit this shape exists to break. */
  const browser = loadBrowserDiction();
  const words = new Set();
  for (const family of browser.FAMILIES) {
    for (const variant of family.variants) {
      for (const form of variant) words.add(form.toLowerCase());
    }
  }
  const src = readFileSync(path.resolve(HERE, "../src/diction-level.js"), "utf8").toLowerCase();
  const found = [...words].filter((w) => new RegExp(`["'\`]${w}["'\`]`).test(src));
  assert.deepEqual(found, [], "a surface form is quoted in the store module");

  for (const [id, n] of Object.entries(FAMILY_VARIANTS)) {
    assert.match(id, /^[a-z][a-z_]{1,23}$/);
    assert.equal(Number.isInteger(n) && n >= 2, true);
  }
});

test("FAMILY_VARIANTS is frozen, so a caller cannot widen the closed list", () => {
  assert.throws(() => {
    "use strict";
    FAMILY_VARIANTS.grace = 1;
  });
  assert.equal(FAMILY_VARIANTS.grace, undefined);
  assert.equal(FAMILY_IDS.includes("grace"), false);
});

test("accept refuses a family the house does not hold, without quoting it", () => {
  const { counts, refused } = accept([
    { family_id: "grace", variant_index: 0, count: 3 },
    { family_id: "prompting", variant_index: 0, count: 3 },
  ]);
  assert.deepEqual(counts, [{ family_id: "prompting", variant_index: 0, count: 3 }]);
  assert.equal(refused.length, 1);
  assert.equal(JSON.stringify(refused).includes("grace"), false);
});

test("accept refuses an inherited property masquerading as a family", () => {
  // `FAMILY_VARIANTS.constructor` is not undefined, so a membership test written
  // as a truthiness check would let this through and store a row keyed on it.
  const { counts, refused } = accept([
    { family_id: "constructor", variant_index: 0, count: 1 },
    { family_id: "toString", variant_index: 0, count: 1 },
  ]);
  assert.deepEqual(counts, []);
  assert.equal(refused.length, 2);
});

test("accept refuses a variant index outside the family it names", () => {
  const last = FAMILY_VARIANTS.prompting - 1;
  const { counts, refused } = accept([
    { family_id: "prompting", variant_index: FAMILY_VARIANTS.prompting, count: 1 },
    { family_id: "prompting", variant_index: -1, count: 1 },
    { family_id: "prompting", variant_index: 1.5, count: 1 },
    { family_id: "prompting", variant_index: last, count: 1 },
  ]);
  assert.deepEqual(counts, [{ family_id: "prompting", variant_index: last, count: 1 }]);
  assert.equal(refused.length, 3);
  for (const r of refused) assert.match(r.reason, /variant index/);
});

test("accept refuses a count that is not a positive whole number", () => {
  const { counts, refused } = accept([
    { family_id: "mand", variant_index: 0, count: 0 },
    { family_id: "mand", variant_index: 1, count: -2 },
    { family_id: "mand", variant_index: 2, count: 1.5 },
    { family_id: "mand", variant_index: 3, count: "4" },
  ]);
  assert.deepEqual(counts, []);
  assert.equal(refused.length, 4);
});

test("one note's vote is capped, folding a repeated key first", () => {
  const { counts } = accept([
    { family_id: "mand", variant_index: 0, count: MAX_COUNT_PER_NOTE },
    { family_id: "mand", variant_index: 0, count: 20 },
    { family_id: "calming", variant_index: 0, count: MAX_COUNT_PER_NOTE + 40 },
  ]);
  assert.deepEqual(counts, [
    { family_id: "calming", variant_index: 0, count: MAX_COUNT_PER_NOTE },
    { family_id: "mand", variant_index: 0, count: MAX_COUNT_PER_NOTE },
  ]);
});

test("accept returns rows in one stable order however they arrived", () => {
  const rows = [
    { family_id: "mand", variant_index: 1, count: 1 },
    { family_id: "calming", variant_index: 0, count: 1 },
    { family_id: "mand", variant_index: 0, count: 1 },
  ];
  const forward = accept(rows).counts.map((c) => `${c.family_id}:${c.variant_index}`);
  const backward = accept([...rows].reverse()).counts.map((c) => `${c.family_id}:${c.variant_index}`);
  assert.deepEqual(forward, ["calming:0", "mand:0", "mand:1"]);
  assert.deepEqual(backward, forward);
});

test("accept survives rubbish without throwing", () => {
  assert.deepEqual(accept(null), { counts: [], refused: [] });
  assert.deepEqual(accept("prompting").counts, []);
  const { counts, refused } = accept([null, undefined, 7, { family_id: 12 }]);
  assert.deepEqual(counts, []);
  assert.equal(refused.length, 4);
});

/* ---- the running total ---------------------------------------------------- */

test("applyNote adds this note to the stored total and counts the note once", () => {
  const stored = [
    { family_id: "prompting", variant_index: 0, count: 10, notes: 4 },
    { family_id: "prompting", variant_index: 1, count: 2, notes: 4 },
  ];
  const next = accept([
    { family_id: "prompting", variant_index: 0, count: 3 },
    { family_id: "mand", variant_index: 2, count: 1 },
  ]).counts;

  assert.deepEqual(applyNote(stored, next), [
    { family_id: "mand", variant_index: 2, count: 1, notes: 1 },
    { family_id: "prompting", variant_index: 0, count: 13, notes: 5 },
    { family_id: "prompting", variant_index: 1, count: 2, notes: 4 },
  ]);
});

test("applyNote does not touch what it was given", () => {
  const stored = [{ family_id: "mand", variant_index: 0, count: 5, notes: 2 }];
  const next = [{ family_id: "mand", variant_index: 0, count: 1 }];
  const out = applyNote(stored, next);
  assert.deepEqual(stored, [{ family_id: "mand", variant_index: 0, count: 5, notes: 2 }]);
  assert.deepEqual(next, [{ family_id: "mand", variant_index: 0, count: 1 }]);
  assert.equal(out[0].count, 6);
  assert.notEqual(out[0], stored[0]);
});

test("a stored row the house no longer holds is dropped rather than carried", () => {
  // The case a renamed family leaves behind. It cannot be read, so it cannot be
  // written forward either.
  const out = applyNote(
    [
      { family_id: "grace", variant_index: 0, count: 99, notes: 30 },
      { family_id: "mand", variant_index: 0, count: 1, notes: 1 },
    ],
    [],
  );
  assert.deepEqual(out, [{ family_id: "mand", variant_index: 0, count: 1, notes: 1 }]);
});

test("a first note starts the total from nothing", () => {
  const next = accept([{ family_id: "calming", variant_index: 2, count: 2 }]).counts;
  assert.deepEqual(applyNote(null, next), [
    { family_id: "calming", variant_index: 2, count: 2, notes: 1 },
  ]);
  assert.deepEqual(applyNote(null, null), []);
});

/* ---- the reading a style move would be made from -------------------------- */

test("familyShares reports a share per variant, with the notes behind it", () => {
  const stored = [
    { family_id: "prompting", variant_index: 0, count: 30, notes: 12 },
    { family_id: "prompting", variant_index: 1, count: 10, notes: 12 },
    { family_id: "mand", variant_index: 0, count: 5, notes: 12 },
  ];
  const got = familyShares(stored, "prompting");
  assert.equal(got.total, 40);
  assert.equal(got.notes, 12);
  assert.deepEqual(got.shares, [
    { variant_index: 0, count: 30, share: 0.75 },
    { variant_index: 1, count: 10, share: 0.25 },
  ]);
});

test("familyShares refuses a family the house does not hold, and reports nothing on no evidence", () => {
  assert.equal(familyShares([{ family_id: "grace", variant_index: 0, count: 9 }], "grace"), null);
  assert.equal(familyShares([], "prompting"), null);
  assert.equal(familyShares(null, "prompting"), null);
});

/* ---- end to end, the browser's own output through the store's gate --------- */

test("a real tally from the browser module passes the store gate unchanged", () => {
  const browser = loadBrowserDiction();
  const note = [
    "Grace Okonkwo prompted Tobias through the greeting, and Tobias asked for",
    "the bubbles. He ran off toward the hallway at Willowbrook and was",
    "redirected. BT reinforced each independent response.",
  ].join(" ");
  /* Across the VM boundary and back. JSON is not decoration here: an object
     built inside the VM has a different Object prototype, so a strict compare
     fails on the realm rather than on the values, and JSON is also exactly what
     would cross the wire. */
  const payload = JSON.parse(JSON.stringify(browser.record(browser.tally(note))));
  assert.equal(payload.refused.length, 0);

  const { counts, refused } = accept(payload.counts);
  assert.deepEqual(refused, []);
  assert.deepEqual(counts, payload.counts);
  // And the note itself left nothing behind but numbers.
  assert.equal(
    JSON.stringify(counts).toLowerCase().includes("grace") ||
      JSON.stringify(counts).toLowerCase().includes("tobias") ||
      JSON.stringify(counts).toLowerCase().includes("willowbrook"),
    false,
  );
  assert.equal(payload.unknown > 0, true);
});
