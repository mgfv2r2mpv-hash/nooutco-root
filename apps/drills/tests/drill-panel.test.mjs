/* The progress panel's arithmetic, by hand. node --test. */
import test from "node:test";
import assert from "node:assert/strict";
import { bests, streak, sitting, ladder, stars, keyTrends, keyboardRates, dayOf } from "../web/panel.js";
import { keyStats, paceSeries } from "../web/score.js";

test("bests are the highest NWAM per clock length", () => {
  const h = [{ minutes: 1, nwam: 50 }, { minutes: 1, nwam: 62.5 }, { minutes: 2, nwam: 40 }, { minutes: 1, nwam: 55 }, null, { minutes: 3 }];
  assert.deepEqual(bests(h), { "1": 62.5, "2": 40 });
});

test("the streak counts days in a row ending today, or yesterday if today is empty", () => {
  const now = new Date(2026, 8, 22, 23, 0);
  const at = (d) => new Date(2026, 8, d, 12, 0).toISOString();
  assert.equal(streak([{ at: at(20) }, { at: at(21) }, { at: at(22) }], now), 3);
  assert.equal(streak([{ at: at(20) }, { at: at(21) }], now), 2);
  assert.equal(streak([{ at: at(19) }, { at: at(21) }, { at: at(22) }], now), 2);
  assert.equal(streak([{ at: at(18) }], now), 0);
  assert.equal(dayOf(at(22)), "2026-09-22");
});

test("a sitting is drills no more than twenty minutes apart, counted back from now", () => {
  const now = Date.parse("2026-09-22T23:00:00Z");
  const at = (min) => new Date(now - min * 60000).toISOString();
  assert.equal(sitting([{ at: at(90) }, { at: at(15) }, { at: at(8) }, { at: at(2) }], now), 3);
  assert.equal(sitting([{ at: at(25) }], now), 0);
});

test("the ladder names the band, the next one, and the distance", () => {
  assert.deepEqual(ladder(52), { here: "Intermediate", next: "Fluent", toNext: 8 });
  // 2026-09-23: Professional is no longer the top, so 80 has a next band.
  assert.deepEqual(ladder(80), { here: "Professional", next: "Expert", toNext: 5 });
  assert.deepEqual(ladder(89), { here: "Expert", next: "Elite", toNext: 6 });
  assert.deepEqual(ladder(130), { here: "Stenographer", next: null, toNext: 0 });
  assert.deepEqual(ladder(10), { here: "Amateur", next: "Average", toNext: 25 });
});

test("stars: beat your last at this clock, 97% clean, a personal best", () => {
  const h = [{ minutes: 1, nwam: 60 }, { minutes: 2, nwam: 90 }, { minutes: 1, nwam: 50 }];
  assert.deepEqual(stars({ nwam: 55, gwam: 58, accuracy: 0.98 }, h, 1), { beatLast: true, clean: true, best: false });
  assert.deepEqual(stars({ nwam: 61, gwam: 63, accuracy: 0.9 }, h, 1), { beatLast: true, clean: false, best: true });
  assert.deepEqual(stars({ nwam: 10, gwam: 12, accuracy: 1 }, [], 1), { beatLast: false, clean: true, best: true });
});

test("key stats count presses per letter and add the misses the tricky-key reading found", () => {
  const ev = [..."tete"].map((k, i) => ({ t: i * 100, kind: "char", key: k }));
  assert.deepEqual(keyStats(ev, { e: 1, r: 2 }), { t: { presses: 2, misses: 0 }, e: { presses: 2, misses: 1 }, r: { presses: 0, misses: 2 } });
});

test("pace is words a minute in five-second buckets", () => {
  // 25 keys in the first five seconds = 5 words in 1/12 minute = 60 wpm.
  const ev = Array.from({ length: 25 }, (_, i) => ({ t: i * 190, kind: "char", key: "a" }));
  assert.deepEqual(paceSeries(ev, 10 / 60), [60, 0]);
});

test("key trends read each letter's miss rate per drill, early half against late half, trickiest lately first", () => {
  const drill = (e, r) => ({ keys: { e: { presses: 10, misses: e }, r: { presses: 10, misses: r }, q: { presses: 1, misses: 1 } } });
  const h = [drill(4, 0), drill(4, 1), drill(1, 2), drill(0, 3)];
  const t = keyTrends(h);
  assert.deepEqual(t.map((x) => x.key), ["r", "e"]);
  const e = t.find((x) => x.key === "e");
  assert.deepEqual(e.series, [0.4, 0.4, 0.1, 0]);
  assert.ok(Math.abs(e.early - 0.4) < 1e-12 && Math.abs(e.late - 0.05) < 1e-12);
  // q was pressed once per drill, under the minimum, so it is not read.
  assert.ok(!t.some((x) => x.key === "q"));
  const k = keyboardRates(h);
  assert.equal(k.e.presses, 40);
  assert.equal(k.e.misses, 9);
});
