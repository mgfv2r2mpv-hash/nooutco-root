/* Spaced review and the other side: pinned by hand. node --test.
 *
 * His ask of 2026-09-23: cycle clinical items so weak ones come back, and keep
 * him considering the other side of his opinions and knee-jerks.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { schedule, dueReviews, pickReview, lensFor, asReview, describeReviews, LENSES, INTERVALS, STRONG_WORDS } from "../web/review.js";
import { BANK } from "../web/bank.js";
import { trophyCase } from "../web/trophies.js";
import { ORACLE_SYSTEM } from "../web/oracle.js";

const DAY = 86400000;
const T0 = Date.parse("2026-09-01T09:00:00Z");
const at = (days) => new Date(T0 + days * DAY).toISOString();
const answer = (itemId, days, keptWords, extra = {}) => ({ at: at(days), itemId, mode: "answer", outline: "B.1", keptWords, gwam: 80, ...extra });

test("a full answer waits longer each time; a thin one comes back tomorrow", () => {
  const strong = STRONG_WORDS + 10;
  let s = schedule([answer("b-01", 0, strong)]);
  assert.equal(s.get("b-01").box, 1);
  assert.equal(s.get("b-01").due, T0 + INTERVALS[1] * DAY);
  s = schedule([answer("b-01", 0, strong), answer("b-01", 3, strong)]);
  assert.equal(s.get("b-01").box, 2);
  assert.equal(s.get("b-01").n, 2);
  // A thin answer resets to box 0, due one day later.
  s = schedule([answer("b-01", 0, strong), answer("b-01", 3, strong), answer("b-01", 10, 8)]);
  assert.equal(s.get("b-01").box, 0);
  assert.equal(s.get("b-01").due, T0 + 11 * DAY);
});

test("the box never runs past the last interval", () => {
  const h = Array.from({ length: 9 }, (_, i) => answer("b-01", i * 40, 90));
  assert.equal(schedule(h).get("b-01").box, INTERVALS.length - 1);
});

test("a Keep going round adds words to the same answer, not a second review", () => {
  const h = [answer("b-01", 0, 12), answer("b-01", 0.01, 25, { cont: 1 })];
  const s = schedule(h).get("b-01");
  assert.equal(s.n, 1, "still one answer");
  assert.equal(s.box, 1, "12 + 25 words is a full answer");
});

test("copy, respond and oracle rounds, and ids gone from the bank, are not scheduled", () => {
  const h = [
    { at: at(0), itemId: "p-01", mode: "copy", passage: "p-01", keptWords: 90 },
    { at: at(0), itemId: "p-01", mode: "respond", passage: "p-01", keptWords: 90 },
    { at: at(0), itemId: "oracle", mode: "oracle", keptWords: 90 },
    answer("gone-01", 0, 90),
  ];
  assert.equal(schedule(h, (id) => BANK.some((b) => b.id === id)).size, 0);
});

test("due reviews come most overdue first, and never two reviews in a row", () => {
  const h = [answer("b-01", 0, 90), answer("b-02", 2, 5), answer("c-01", 3, 90)];
  const now = T0 + 10 * DAY;
  const due = dueReviews(h, now);
  assert.deepEqual(due.map((r) => r.itemId), ["b-02", "b-01", "c-01"]);
  const pick = pickReview(h, now);
  assert.equal(pick.itemId, "b-02");
  assert.equal(pick.lens.id, "steelman", "the first return is a steelman");
  // Just answered as a review: the next one is a new question from the map.
  const after = [...h, answer("b-02", 10, 90, { review: true, lens: "steelman" })];
  assert.equal(pickReview(after, now + 1000), null);
  // One new question later, reviews resume; the one just reviewed is not due again yet.
  const later = [...after, answer("d-01", 10.01, 90)];
  assert.equal(pickReview(later, now + 2000).itemId, "b-01");
});

test("nothing is due before its time", () => {
  assert.equal(pickReview([answer("b-01", 0, 90)], T0 + 2 * DAY), null);
});

test("the lens turns with every return, so the same question never comes back the same way twice", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => lensFor(n).id), ["steelman", "kneejerk", "mind", "research", "steelman"]);
  const item = BANK[0];
  const r = asReview(item, LENSES[0]);
  assert.ok(r.question.startsWith(item.question));
  assert.ok(r.question.endsWith(LENSES[0].ask));
  assert.equal(r.review, true);
  assert.equal(r.lens, "steelman");
  assert.equal(r.tag, "review \u00b7 steelman");
  assert.notEqual(item.question, r.question, "the bank item itself is untouched");
});

test("lens asks are plain ASCII with no dashes, and each asks for the other side", () => {
  for (const l of LENSES) {
    assert.match(l.ask, /^[\x20-\x7e]+$/);
    assert.doesNotMatch(l.ask, /--| - /);
  }
  assert.match(LENSES.find((l) => l.id === "steelman").ask, /strongest case/);
});

test("the home line says how many are due, or when the next one comes back", () => {
  const h = [answer("b-01", 0, 90)];
  assert.equal(describeReviews([], T0), null);
  assert.match(describeReviews(h, T0 + DAY), /1 question in review; the next comes back in 2 days/);
  assert.match(describeReviews(h, T0 + 3 * DAY), /1 question due for another look/);
});

test("the other side has its own achievements, replayed from history", () => {
  const h = [];
  LENSES.forEach((l, i) => h.push(answer("b-01", i * 5, 90, { review: true, lens: l.id })));
  h.push(answer("b-01", 21, 20, { review: true, lens: "steelman", cont: 1 }));
  const got = Object.fromEntries(trophyCase(h).map((t) => [t.id, t]));
  for (const id of ["lens-steelman", "lens-kneejerk", "lens-mind", "lens-research", "lens-all"]) assert.ok(got[id].unlocked, id);
  assert.equal(got["lens-all"].unlocked, at(15), "earned on the fourth lens, not later");
  assert.equal(got["reviews-5"].have, 4, "a Keep going round is not a fifth review");
});

test("the oracle is told to bring the other side and dissenting research", () => {
  assert.match(ORACLE_SYSTEM, /steelman/);
  assert.match(ORACLE_SYSTEM, /change his mind/);
  assert.match(ORACLE_SYSTEM, /dissents/);
});
