/* Achievements, by hand: the names, the edge cases, the improvement ones and
 * the secrets. node --test. Every history is built here so each expected
 * unlock can be read off beside it. */
import test from "node:test";
import assert from "node:assert/strict";
import { trophyCase, TROPHIES, WEAK_KEYS } from "../web/trophies.js";

/** Local time, September 2026 unless a month is given. */
const at = (d, hh = 12, mm = 0, month = 8, year = 2026) => new Date(year, month, d, hh, mm).toISOString();
/** A plain one-minute drill; `extra` overrides any field. */
const rec = (d, hh, mm, extra = {}) => ({ at: at(d, hh, mm), minutes: 1, nwam: 60, gwam: 64, words: 64, accuracy: 0.95, ...extra });
const unlockedIds = (h) => new Set(trophyCase(h).filter((t) => t.unlocked).map((t) => t.id));
const find = (h, id) => trophyCase(h).find((t) => t.id === id);
/** Ten drills, one every two minutes on the 10th, built by `f(i)`. */
const ten = (f, n = 10) => Array.from({ length: n }, (_, i) => rec(10, 9, i * 2, f(i)));

test("every achievement has a name, a plain condition, a group, and no em dash", () => {
  for (const t of TROPHIES) {
    assert.ok(t.name && t.condition && t.group, t.id);
    assert.ok(!/\u2014/.test(t.name + t.condition + (t.hint || "")), `${t.id} has an em dash`);
    if (t.secret) assert.ok(t.hint, `${t.id} is secret and needs a hint`);
  }
  assert.equal(new Set(TROPHIES.map((t) => t.id)).size, TROPHIES.length, "ids are unique");
});

test("ids from before the rename are all still there, so old unlock dates line up", () => {
  const ids = new Set(TROPHIES.map((t) => t.id));
  for (const id of ["streak-3", "streak-100", "days-5", "sessions-1", "sessions-1000", "len1-10", "len5-150", "every-clock",
    "words-1000", "kept-250", "band-average", "band-professional", "gwam-100", "pb-5", "clean-97", "flawless", "combo-25",
    "shift-drill", "shift-100", "revise-25", "domains-9", "items-104", "lexicon-10", "sitting-3", "big-day", "early", "late", "comeback"]) {
    assert.ok(ids.has(id), id);
  }
  assert.equal(find([rec(1, 9, 0)], "streak-3").name, "Warming Up");
  assert.equal(find([rec(1, 9, 0)], "streak-3").condition, "Drill 3 days in a row.");
});

/* ---- edge cases ------------------------------------------------------- */

test("the clock and the calendar: weekend, full spectrum, marathon day", () => {
  // September 26 2026 is a Saturday; the 23rd is a Wednesday.
  assert.ok(unlockedIds([rec(26, 12, 0)]).has("weekend"));
  assert.ok(!unlockedIds([rec(23, 12, 0)]).has("weekend"));
  const spectrum = [1, 2, 3, 4, 5].map((m, i) => rec(23, 9, i * 10, { minutes: m }));
  assert.equal(find(spectrum, "full-spectrum").unlocked, at(23, 9, 40));
  // Same five clocks across two days: every-clock yes, full spectrum no.
  const split = spectrum.map((r, i) => ({ ...r, at: at(i < 3 ? 23 : 24, 9, i * 10) }));
  assert.ok(unlockedIds(split).has("every-clock"));
  assert.ok(!unlockedIds(split).has("full-spectrum"));
  // 5 + 5 + 5 + 5 + 5 + 5 = 30 clock minutes in one day.
  const marathon = Array.from({ length: 6 }, (_, i) => rec(23, 9, i * 6, { minutes: 5 }));
  assert.equal(find(marathon, "marathon-day").unlocked, at(23, 9, 30));
  assert.ok(!unlockedIds(marathon.slice(0, 5)).has("marathon-day"));
});

test("perfectionist needs 100% on a clock of two minutes or more", () => {
  assert.ok(unlockedIds([rec(1, 9, 0, { minutes: 2, words: 120, accuracy: 1 })]).has("flawless-long"));
  assert.ok(!unlockedIds([rec(1, 9, 0, { minutes: 1, words: 90, accuracy: 1 })]).has("flawless-long"));
  assert.ok(!unlockedIds([rec(1, 9, 0, { minutes: 2, words: 120, accuracy: 0.99 })]).has("flawless-long"));
});

test("quantum leap is a personal best by ten NWAM or more at the same clock", () => {
  const h = [rec(1, 9, 0, { nwam: 70 }), rec(1, 9, 5, { nwam: 79.9 }), rec(1, 9, 10, { nwam: 90 })];
  // 79.9 beats 70 by 9.9: no. 90 beats 79.9 by 10.1: yes.
  assert.equal(find(h, "leap").unlocked, at(1, 9, 10));
  // The first drill at a clock is not a leap over nothing.
  assert.ok(!unlockedIds([rec(1, 9, 0, { nwam: 90 })]).has("leap"));
  // A best at another clock does not count.
  assert.ok(!unlockedIds([rec(1, 9, 0, { nwam: 70 }), rec(1, 9, 5, { minutes: 2, nwam: 90 })]).has("leap"));
});

test("modes: first copy, first respond, first spoken, first oracle, and a Keep going chain of three", () => {
  const h = [
    rec(1, 9, 0, { mode: "copy" }), rec(1, 9, 2, { mode: "respond" }), rec(1, 9, 4, { mode: "respond", cont: 1 }),
    rec(1, 9, 6, { mode: "respond", cont: 2 }), rec(1, 9, 8, { mode: "oracle", spoken: true, spokenWords: 90, gwam: 0 }),
  ];
  assert.equal(find(h, "copycat").unlocked, at(1, 9, 0));
  assert.equal(find(h, "talk-back").unlocked, at(1, 9, 2));
  assert.equal(find(h, "on-a-roll").unlocked, at(1, 9, 6)); // cont 2 = the third round
  assert.equal(find(h, "oracle").unlocked, at(1, 9, 8));
  assert.equal(find(h, "voice").unlocked, at(1, 9, 8));
  assert.ok(!unlockedIds(h.slice(0, 3)).has("on-a-roll"));
});

/* ---- secrets ---------------------------------------------------------- */

test("secrets: midnight oil, Friday the 13th, photo finish, deja vu, fresh start", () => {
  assert.ok(unlockedIds([rec(2, 1, 30)]).has("midnight"));
  assert.ok(!unlockedIds([rec(2, 5, 30)]).has("midnight"));
  // November 13 2026 is a Friday; November 12 is not.
  assert.ok(unlockedIds([{ ...rec(1, 12, 0), at: at(13, 12, 0, 10) }]).has("friday-13"));
  assert.ok(!unlockedIds([{ ...rec(1, 12, 0), at: at(12, 12, 0, 10) }]).has("friday-13"));
  assert.ok(unlockedIds([{ ...rec(1, 12, 0), at: at(1, 10, 0, 0, 2027) }]).has("new-year"));
  // Photo finish: ties the best at that clock to the tenth, without beating it.
  const photo = [rec(1, 9, 0, { nwam: 80.4 }), rec(1, 9, 5, { nwam: 70 }), rec(1, 9, 10, { nwam: 80.4 })];
  assert.equal(find(photo, "photo-finish").unlocked, at(1, 9, 10));
  // Deja vu: two drills in a row with the same NWAM.
  assert.ok(!unlockedIds(photo).has("deja-vu"));
  assert.equal(find([rec(1, 9, 0, { nwam: 66.6 }), rec(1, 9, 5, { nwam: 66.6 })], "deja-vu").unlocked, at(1, 9, 5));
  const secrets = TROPHIES.filter((t) => t.secret).map((t) => t.id).sort();
  assert.deepEqual(secrets, ["deja-vu", "friday-13", "midnight", "new-year", "photo-finish"]);
  const locked = find([rec(1, 12, 0)], "midnight");
  assert.equal(locked.secret, true);
  assert.ok(locked.hint);
});

/* ---- getting better: earned by change against his own start ----------- */

test("switch hitter: the same-side Shift share halves from the first five drills to the last five", () => {
  // First five: 2 of 5 capitals same-side each (40%). Last five: 0 or 1 of 5.
  const h = ten((i) => ({ shift: i < 5 ? { ok: 3, same: 2 } : { ok: i % 2 ? 4 : 5, same: i % 2 ? 1 : 0 } }));
  // Last five at i = 5..9: same 1,0,1,0,1 = 3 of 25 = 12%, under half of 40%.
  assert.equal(find(h, "shift-better").unlocked, at(10, 9, 18));
  // Not enough drills: nine is one short of two windows of five.
  assert.ok(!unlockedIds(h.slice(0, 9)).has("shift-better"));
  // No change: 40% throughout.
  assert.ok(!unlockedIds(ten(() => ({ shift: { ok: 3, same: 2 } }))).has("shift-better"));
  // Already fine from the start (under 15%): there is nothing to improve on.
  assert.ok(!unlockedIds(ten((i) => ({ shift: { ok: 10, same: i < 5 ? 1 : 0 } }))).has("shift-better"));
});

test("clean crossings: five drills in a row, three capitals or more each, every one on the opposite Shift", () => {
  const five = Array.from({ length: 5 }, (_, i) => rec(1, 9, i * 2, { shift: { ok: 3, same: 0 } }));
  assert.equal(find(five, "shift-run-5").unlocked, at(1, 9, 8));
  // One slip in the middle resets the run.
  const slip = five.map((r, i) => (i === 2 ? { ...r, shift: { ok: 3, same: 1 } } : r));
  assert.ok(!unlockedIds(slip).has("shift-run-5"));
  // Drills with too few capitals do not count toward the run, nor break it.
  const thin = [...five.slice(0, 2), rec(1, 9, 5, { shift: { ok: 1, same: 0 } }), ...five.slice(2)];
  assert.ok(!unlockedIds(thin.slice(0, 5)).has("shift-run-5"));
  assert.ok(unlockedIds(thin).has("shift-run-5"));
});

test("option reflex: most word changes go to Option+Backspace, where at the start they went letter by letter", () => {
  // First five: 2 by hand, 0 with Option each. Last five: 1 Option each, none by hand.
  const h = ten((i) => ({ habits: i < 5 ? { wordByHand: 2, wordDeletes: 0 } : { wordByHand: 0, wordDeletes: 1 } }));
  assert.equal(find(h, "option-reflex").unlocked, at(10, 9, 18));
  assert.ok(!unlockedIds(h.slice(0, 9)).has("option-reflex"));
  // Too few changes of mind at the end to say anything (3 of the needed 4).
  const quiet = ten((i) => ({ habits: i < 5 ? { wordByHand: 2, wordDeletes: 0 } : { wordByHand: 0, wordDeletes: i < 8 ? 1 : 0 } }));
  assert.ok(!unlockedIds(quiet).has("option-reflex"));
  // Always used Option: no change, so no reflex earned.
  assert.ok(!unlockedIds(ten(() => ({ habits: { wordByHand: 0, wordDeletes: 1 } }))).has("option-reflex"));
});

test("weak link no more: the miss rate on w m b u c halves, over a hundred presses each window", () => {
  assert.deepEqual(WEAK_KEYS, ["w", "m", "b", "u", "c"]);
  const keys = (misses) => Object.fromEntries(WEAK_KEYS.map((k, j) => [k, { presses: 5, misses: j < misses ? 1 : 0 }]));
  // 25 weak presses a drill, 125 a window. First: 2 misses a drill, 10 of 125 (8%). Last: 1, 0, 1, 0, 1, 3 of 125 (2.4%).
  const h = ten((i) => ({ keys: keys(i < 5 ? 2 : i % 2) }));
  assert.equal(find(h, "weak-better").unlocked, at(10, 9, 18));
  assert.ok(!unlockedIds(ten(() => ({ keys: keys(2) }))).has("weak-better"));
  // Too few presses: 5 a drill is 25 a window, under 100.
  const few = ten((i) => ({ keys: { w: { presses: 5, misses: i < 5 ? 1 : 0 } } }));
  assert.ok(!unlockedIds(few).has("weak-better"));
});

test("five clean fingers: one drill with w m b u c each pressed three times or more and never missed", () => {
  const all = (p, m) => Object.fromEntries(WEAK_KEYS.map((k) => [k, { presses: p, misses: m }]));
  assert.ok(unlockedIds([rec(1, 9, 0, { keys: all(3, 0) })]).has("weak-clean"));
  assert.ok(!unlockedIds([rec(1, 9, 0, { keys: all(2, 0) })]).has("weak-clean"));
  assert.ok(!unlockedIds([rec(1, 9, 0, { keys: { ...all(5, 0), u: { presses: 5, misses: 1 } } })]).has("weak-clean"));
});

test("a coached tip is retired: it fired in three drills or more, then stayed quiet five drills in a row", () => {
  const h = [
    ...[0, 1, 2].map((i) => rec(1, 9, i * 2, { tips: ["punctuation", "cadence"] })),
    ...[3, 4, 5, 6, 7].map((i) => rec(1, 9, i * 2, { tips: ["cadence"] })),
  ];
  assert.equal(find(h, "retire-punctuation").unlocked, at(1, 9, 14));
  assert.ok(!unlockedIds(h).has("retire-cadence"));
  // Four quiet drills are one short.
  assert.ok(!unlockedIds(h.slice(0, 7)).has("retire-punctuation"));
  // A tip that fired only twice was never a habit to break.
  assert.ok(!unlockedIds(h.slice(1)).has("retire-punctuation"));
  // Short drills (under 40 words) cannot prove it: the tips need words to fire.
  const short = h.map((r, i) => (i >= 3 ? { ...r, words: 30 } : r));
  assert.ok(!unlockedIds(short).has("retire-punctuation"));
  // Drills from before tips were recorded are neither a firing nor a quiet one.
  const old = [...h.slice(0, 3), rec(1, 10, 0), ...h.slice(3, 7)];
  assert.ok(!unlockedIds(old).has("retire-punctuation"));
});

test("unhesitating, cleaning up and level up compare the last five drills with the first five", () => {
  const mid = ten((i) => ({ think: { mid: i < 5 ? 2 : i % 2 } }));
  // First 10 mid-word stops, last 3: under half.
  assert.ok(unlockedIds(mid).has("mid-better"));
  assert.ok(!unlockedIds(ten(() => ({ think: { mid: 2 } }))).has("mid-better"));
  // Too few stops at the start (4, under 5) to call it a habit.
  assert.ok(!unlockedIds(ten((i) => ({ think: { mid: i < 4 ? 1 : 0 } }))).has("mid-better"));

  const acc = ten((i) => ({ accuracy: i < 5 ? 0.9 : 0.94 }));
  assert.ok(unlockedIds(acc).has("accuracy-better"));
  assert.ok(!unlockedIds(ten((i) => ({ accuracy: i < 5 ? 0.9 : 0.92 }))).has("accuracy-better"));

  const speed = ten((i) => ({ nwam: i < 5 ? 80 : 85 }));
  assert.ok(unlockedIds(speed).has("speed-better"));
  assert.ok(!unlockedIds(ten((i) => ({ nwam: i < 5 ? 80 : 84.9 }))).has("speed-better"));
  // Mixed clocks do not pool: five at 1 minute and five at 2 minutes are one window each.
  assert.ok(!unlockedIds(ten((i) => ({ minutes: i < 5 ? 1 : 2, nwam: i < 5 ? 80 : 90 }))).has("speed-better"));
});

test("an improvement once earned stays earned even if the habit slips back", () => {
  const good = ten((i) => ({ shift: i < 5 ? { ok: 3, same: 2 } : { ok: 5, same: 0 } }));
  const slipped = good.concat(Array.from({ length: 5 }, (_, i) => rec(11, 9, i * 2, { shift: { ok: 3, same: 2 } })));
  assert.equal(find(slipped, "shift-better").unlocked, find(good, "shift-better").unlocked);
});
