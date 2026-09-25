/* Strict Shift, by hand: a refused capital is counted apart and never scored
 * as typing; the tracker judges the retry on the same Shift press; the weekly
 * trend compares only rounds that ran with strict on. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreDrill, refusedStats } from "../web/score.js";
import { createShiftTracker } from "../web/shift.js";
import { refusedWeeks, refusedText } from "../web/panel.js";

const typed = (s, t0 = 0) => [...s].map((key, i) => ({ t: t0 + i * 150, kind: "char", key }));

test("a refused capital places nothing: speed, accuracy and corrections never see it", () => {
  const plain = typed("The cat sat. ");
  const withRefusal = [{ t: 0, kind: "refused", key: "T", shift: "L", hand: "L" }, ...typed("The cat sat. ", 100)];
  const a = scoreDrill({ events: plain, text: "The cat sat. ", minutes: 1 });
  const b = scoreDrill({ events: withRefusal, text: "The cat sat. ", minutes: 1 });
  assert.equal(b.keystrokes, a.keystrokes);
  assert.equal(b.gwam, a.gwam);
  assert.equal(b.corrections, 0);
  assert.equal(b.accuracy, a.accuracy);
  assert.deepEqual(b.refused, { count: 1, left: 1, right: 0, keys: [{ key: "T", count: 1 }] });
  assert.equal(a.refused.count, 0);
});

test("refusedStats counts by hand and ranks the keys, most often first", () => {
  const r = refusedStats([
    { t: 0, kind: "refused", key: "T", hand: "L" },
    { t: 1, kind: "refused", key: "J", hand: "R" },
    { t: 2, kind: "refused", key: "t", hand: "L" },
    { t: 3, kind: "char", key: "a" },
    null,
  ]);
  assert.deepEqual(r, { count: 3, left: 2, right: 1, keys: [{ key: "T", count: 2 }, { key: "J", count: 1 }] });
});

test("rejudge: after a refusal, the next capital on the SAME held Shift is judged again", () => {
  const t = createShiftTracker();
  t.key({ type: "keydown", code: "ShiftLeft" });
  assert.equal(t.firstInHold(), true);  // the refused T
  t.rejudge();
  assert.equal(t.firstInHold(), true);  // the retry, still on the wrong Shift, is judged
  assert.equal(t.firstInHold(), false); // an accepted capital: the rest of the hold rides
});

test("refusedWeeks sums the last seven days against the seven before, and skips rounds without a count", () => {
  const now = Date.parse("2026-09-24T12:00:00Z");
  const day = 86400000;
  const at = (d) => new Date(now - d * day).toISOString();
  const w = refusedWeeks([
    { at: at(1), refused: 2 }, { at: at(3), refused: 1 },
    { at: at(8), refused: 5 }, { at: at(12), refused: 4 },
    { at: at(2) }, // strict was off, or before strict existed: not a clean week
    { at: at(20), refused: 30 },
  ], now);
  assert.deepEqual(w, { thisWeek: 3, lastWeek: 9, roundsThis: 2, roundsLast: 2 });
});

test("refusedText says the round and the trend, his words: down from last week", () => {
  const round = { count: 3, keys: [{ key: "T", count: 2 }, { key: "B", count: 1 }] };
  assert.equal(refusedText(round, { thisWeek: 3, lastWeek: 9, roundsThis: 2, roundsLast: 4 }, true),
    "3 capitals refused for a same-side Shift (T 2\u00d7, B); 3 capitals refused this week, down from 9 last week");
  assert.equal(refusedText({ count: 0, keys: [] }, { thisWeek: 0, lastWeek: 0, roundsThis: 1, roundsLast: 0 }, true),
    "No capitals refused this week");
  assert.equal(refusedText({ count: 0, keys: [] }, { thisWeek: 0, lastWeek: 0, roundsThis: 0, roundsLast: 0 }, false), "");
});
