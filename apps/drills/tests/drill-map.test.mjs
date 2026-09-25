/* The knowledge map, counted by hand. node --test. */
import test from "node:test";
import assert from "node:assert/strict";
import { density, emptiestCell, render } from "../web/map.js";
import { OUTLINE, ITEMS } from "../web/outline.js";
import { BANK, nextItem } from "../web/bank.js";

test("the outline is the BACB 6th edition: nine domains, 104 items, 175 questions, shares that sum to 100", () => {
  assert.equal(OUTLINE.length, 9);
  assert.equal(ITEMS.length, 104);
  assert.equal(OUTLINE.reduce((s, d) => s + d.questions, 0), 175);
  assert.equal(OUTLINE.reduce((s, d) => s + d.share, 0), 100);
  assert.deepEqual(OUTLINE.map((d) => d.letter), ["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
});

test("every bank item files under a real outline item", () => {
  for (const b of BANK) assert.ok(ITEMS.some((it) => it.id === b.outline), b.id + " -> " + b.outline);
});

test("density counts kept drills under their cell and expert records beside them, and the fullest cell sets the scale", () => {
  const hist = [{ outline: "F.6" }, { outline: "F.6" }, { outline: "A.5" }, { outline: "nope" }, null];
  const d = density(hist, { "F.6": 1, "C.9": 4, "zz": 9 });
  assert.deepEqual(d.cells["F.6"], { mine: 2, expert: 1, total: 3 });
  assert.deepEqual(d.cells["A.5"], { mine: 1, expert: 0, total: 1 });
  assert.deepEqual(d.cells["C.9"], { mine: 0, expert: 4, total: 4 });
  assert.equal(d.max, 4);
  assert.equal(d.domains.find((x) => x.letter === "F").mine, 2);
});

test("the emptiest cell is the least said-about askable item, ties to the heaviest domain, skipping the last five", () => {
  // Nothing kept: every askable cell is at 0; the tie breaks to the heaviest
  // domain (B and G, 14% each), then outline order. Since bank-more.js the
  // bank asks about every outline item, so the first B item, B.1, wins (it
  // was B.4 while B.1 to B.3 had no question).
  assert.equal(emptiestCell({ bank: BANK, history: [] }), "B.1");
  // B.1 asked last: skipped, so the next askable B item wins.
  assert.equal(emptiestCell({ bank: BANK, history: [{ outline: "B.1" }] }), "B.2");
  // Everything askable has been kept once except A.5: it is the gap.
  const all = BANK.map((b) => ({ outline: b.outline })).filter((h) => h.outline !== "A.5");
  assert.equal(emptiestCell({ bank: BANK, history: all, recent: 0 }), "A.5");
  // Expert records count too: A.5 covered by the expert three times is no longer the gap.
  assert.notEqual(emptiestCell({ bank: BANK, history: all, expert: { "A.5": 3 }, recent: 0 }), "A.5");
  assert.equal(emptiestCell({ bank: [], history: [] }), null);
});

test("nextItem with a cell draws from that cell's questions", () => {
  const it = nextItem([], () => 0, "F.6");
  assert.equal(it.outline, "F.6");
});

test("render gives a shade in 0..1 and marks the cells the bank can ask about", () => {
  const cols = render([{ outline: "F.6" }], {}, BANK);
  const f = cols.find((c) => c.letter === "F");
  const f6 = f.cells.find((c) => c.id === "F.6");
  assert.equal(f6.shade, 1);
  assert.equal(f6.askable, true);
  assert.equal(f.cells.find((c) => c.id === "F.1").shade, 0);
  assert.equal(cols.reduce((s, c) => s + c.cells.length, 0), 104);
});
