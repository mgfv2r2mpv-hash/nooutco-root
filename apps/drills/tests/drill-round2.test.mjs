/* Round two, by hand: contractions, revisions, Option+Backspace, shift side,
 * thinking stops, days, streaks, the calendar grid and the trophy replay.
 * node --test. Every expected number is worked out beside it. */
import test from "node:test";
import assert from "node:assert/strict";
import { isKnown, unknownWords, scoreDrill, deleteRuns, deleteHabits, shiftStats, thinkProfile, trickyKeys } from "../web/score.js";
import { handOf, judge } from "../web/shift.js";
import { createHeat } from "../web/ornament.js";
import { dayStats, streakRuns, monthGrid, bannersForWeek, trophyCase, newlyUnlocked, daysBetween, TROPHIES } from "../web/trophies.js";

/** "<" is Backspace, "{" one character of an Option+Backspace. */
function typed(s, gapMs = 100) {
  const events = [];
  let t = 0;
  for (const ch of s) {
    if (ch === "<") events.push({ t, kind: "backspace" });
    else if (ch === "{") events.push({ t, kind: "backspace", via: "word" });
    else if (ch === "\n") events.push({ t, kind: "enter" });
    else events.push({ t, kind: "char", key: ch });
    t += gapMs;
  }
  return events;
}

test("possessives, contractions and hyphenated compounds are words, not typos", () => {
  const lex = new Set(["gambler", "do", "they", "client", "can", "will", "follow", "up", "the", "fallacy"]);
  for (const w of ["gambler's", "gambler’s", "clients'", "don't", "they're", "can't", "won't", "follow-up"]) assert.ok(isKnown(w, lex), w);
  for (const w of ["dont", "xqz's", "follow-upp"]) assert.ok(!isKnown(w, lex), w);
  assert.deepEqual(unknownWords("the gambler's fallacy, don't follow-up", lex), []);
});

test("an Option+Backspace run is a revision: not a correction, not a tricky key", () => {
  // "cat" then a word delete of 3, then "dog": one revision, no corrections.
  const ev = typed("cat{{{dog");
  assert.deepEqual(deleteRuns(ev), { corrections: 0, revisions: 1 });
  assert.deepEqual(trickyKeys(ev).all, {});
  // The same with plain Backspace is a correction, and c for d is read as a miss.
  const plain = typed("cat<<<dog");
  assert.deepEqual(deleteRuns(plain), { corrections: 1, revisions: 0 });
  assert.deepEqual(trickyKeys(plain).all, { c: 1 });
  const s = scoreDrill({ events: ev, text: "dog", minutes: 1 });
  assert.equal(s.revisions, 1);
  assert.equal(s.corrections, 0);
});

test("a whole word backspaced letter by letter back to a space is the Option+Backspace case", () => {
  // "go wrong" -> backspace 5 back to the space: one word by hand, 5 keys.
  assert.deepEqual(deleteHabits(typed("go wrong<<<<<right")), { wordByHand: 1, keysSpent: 5, wordDeletes: 0, lineDeletes: 0 });
  // Two letters fixed mid-word is an ordinary correction, not this habit.
  assert.equal(deleteHabits(typed("go wrnog<<<ong")).wordByHand, 0);
  // Done with Option, it is counted as a word delete instead.
  assert.deepEqual(deleteHabits(typed("go wrong{{{{{right")), { wordByHand: 0, keysSpent: 0, wordDeletes: 1, lineDeletes: 0 });
});

test("shift side: the opposite hand is right, the key's own side is not, Digit6 and both-shifts are never judged", () => {
  assert.equal(handOf("KeyT"), "L");
  assert.equal(handOf("KeyJ"), "R");
  assert.equal(handOf("Slash"), "R");
  assert.equal(handOf("Digit6"), null);
  assert.equal(judge("R", "L"), "ok");   // capital T with right Shift
  assert.equal(judge("L", "L"), "same"); // capital T with left Shift
  assert.equal(judge("B", "L"), null);
  const ev = [
    { t: 0, kind: "char", key: "T", shift: "R", hand: "L" },
    { t: 1, kind: "char", key: "T", shift: "L", hand: "L" },
    { t: 2, kind: "char", key: "J", shift: "R", hand: "R" },
    { t: 3, kind: "char", key: "J", shift: "L", hand: "R" },
    { t: 4, kind: "char", key: "A", shift: "B", hand: "L" },
    { t: 5, kind: "char", key: "a" },
  ];
  assert.deepEqual(shiftStats(ev), { ok: 2, same: 2, sameLeft: 1, sameRight: 1 });
});

test("thinking stops are filed by what came before them, and flow speed takes them out", () => {
  // "Hi. So" then a 3s stop mid-word, "me", end at 10s of a 1-minute clock.
  const ev = [];
  let t = 0;
  const put = (s, gap = 100) => { for (const ch of s) { ev.push({ t, kind: "char", key: ch }); t += gap; } t -= gap; };
  put("Hi.");            // t ends at 200
  t += 4000; put(" So"); // 4000ms after "." : a sentence stop
  t += 3000; put("me");  // 3000ms after "o": a mid-word stop
  const k = thinkProfile(ev, 1);
  // Last key at 200+4000+200+3000+100 = 7500; the idle tail to 60000 is 52500,
  // kept apart: he may just be done.
  assert.equal(k.count, 2);
  assert.equal(k.sentence, 1);
  assert.equal(k.mid, 1);
  assert.equal(k.ms, 4000 + 3000);
  assert.equal(k.tailMs, 52500);
  // 8 keys over 60000-7000-52500 = 500ms, floored to 1000ms: 8/5 / (1/60) = 96.
  assert.equal(k.flowWpm, 96);
  assert.deepEqual(k.stops[0], { at: 3, ms: 4000, kind: "sentence" });
});

test("the garden holds its warmth through a stop at a full stop, and cools through one mid-sentence", () => {
  const warm = (lastCh) => {
    const h = createHeat({ usual: 30, best: 60 });
    for (let t = 0; t < 6000; t += 60) { h.press(t, "a"); h.read(t); }
    h.press(6000, lastCh);
    const at = h.read(6000).heat;
    let r;
    for (let t = 6100; t <= 13500; t += 100) r = h.read(t);
    return { at, after: r.heat, holding: !!r.holding };
  };
  // 7.5 seconds without a key, inside the 8-second grace.
  const stop = warm(".");
  const mid = warm("a");
  assert.ok(stop.holding && stop.after >= stop.at * 0.95, "held at a full stop");
  assert.ok(!mid.holding && mid.after < mid.at * 0.5, "cooled mid-sentence");
});

const at = (d, hh = 12, mm = 0) => new Date(2026, 8, d, hh, mm).toISOString();

test("days: averages per day, and streak runs with today still alive until midnight", () => {
  const h = [
    { at: at(20), nwam: 40, gwam: 50, accuracy: 1, words: 50 },
    { at: at(20, 13), nwam: 50, gwam: 60, accuracy: 0.9, words: 60 },
    { at: at(21), nwam: 55, gwam: 58, accuracy: 0.95, words: 58 },
    { at: at(23), nwam: 60, gwam: 62, accuracy: 0.97, words: 62 },
  ];
  const d = dayStats(h);
  assert.deepEqual(d[0], { day: "2026-09-20", count: 2, nwam: 45, gwam: 55, accuracy: 0.95, bestNwam: 50, bestGwam: 60, words: 110 });
  const s = streakRuns(d.map((x) => x.day), "2026-09-24");
  assert.deepEqual(s.runs.map((r) => r.days), [2, 1]);
  assert.equal(s.longest, 2);
  assert.equal(s.current, 1);      // the 23rd, yesterday: not broken yet
  assert.equal(s.alive, false);    // but not drilled today
  assert.equal(streakRuns(["2026-09-20"], "2026-09-24").current, 0);
  assert.equal(daysBetween("2026-10-31", "2026-11-02"), 2); // across the DST change
});

test("the calendar month starts on a Sunday and banners wrap weeks without a rounded end", () => {
  const g = monthGrid(2026, 8); // September 2026: the 1st is a Tuesday
  assert.equal(g.length, 5);
  assert.deepEqual(g[0].slice(0, 3).map((c) => [c.date, c.inMonth]), [[30, false], [31, false], [1, true]]);
  // A run from Fri 4th to Mon 7th crosses the week line.
  const runs = [{ start: "2026-09-04", end: "2026-09-07", days: 4 }, { start: "2026-09-10", end: "2026-09-10", days: 1 }];
  assert.deepEqual(bannersForWeek(g[0], runs), [{ from: 5, to: 6, starts: true, ends: false, days: 4 }]);
  assert.deepEqual(bannersForWeek(g[1], runs), [{ from: 0, to: 1, starts: false, ends: true, days: 4 }]);
});

test("trophies unlock on the drill that first met the condition, and never twice", () => {
  const h = [];
  // Three days in a row, two 1-minute drills a day, the second one faster.
  for (const d of [1, 2, 3]) {
    h.push({ at: at(d, 9), minutes: 1, nwam: 30 + d, gwam: 40, words: 40, accuracy: 0.98, outline: "A.1" });
    h.push({ at: at(d, 9, 10), minutes: 1, nwam: 40 + d, gwam: 50, words: 50, accuracy: 0.9, outline: "B.2", kept: true });
  }
  const c = trophyCase(h);
  const got = (id) => c.find((t) => t.id === id);
  assert.equal(got("streak-3").unlocked, at(3, 9));
  assert.equal(got("sessions-1").unlocked, at(1, 9));
  assert.equal(got("clean-97").unlocked, at(1, 9));
  assert.equal(got("band-average").unlocked, at(1, 9, 10)); // 41 NWAM
  assert.equal(got("band-intermediate").unlocked, null);    // best is 43
  // Bests at 1 min: 31, 41 (pb), 32, 42 (pb), 33, 43 (pb) = 3 personal bests.
  assert.equal(got("pb-5").have, 3);
  // Kept words: the three kept drills of 50.
  assert.equal(got("kept-250").have, 150);
  assert.equal(got("sitting-3").have, 2);
  assert.equal(got("len1-10").have, 6);
  // Adding a drill unlocks only what that drill earned.
  const next = h.concat([{ at: at(4, 9), minutes: 2, nwam: 50, gwam: 52, words: 104, accuracy: 0.99 }]);
  assert.deepEqual(newlyUnlocked(c, trophyCase(next)).map((t) => t.id).sort(), ["band-intermediate"].sort());
  assert.equal(new Set(TROPHIES.map((t) => t.id)).size, TROPHIES.length, "ids are unique");
});
