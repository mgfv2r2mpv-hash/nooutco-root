/* The mini games' sentences, revs, progress and trophies, by hand. node --test. */
import test from "node:test";
import assert from "node:assert/strict";
import { buildShifty, rpmOf, SHIFTY_WORDS, SHIFTY_CAPS } from "../web/shifty.js";
import { addRun, progressOf, progressLine, gameTrophies, RUNS_KEPT } from "../web/minigames.js";

const POOL = "behavior reinforcement function extinction schedule response stimulus control prompt fading chain shaping mand tact echoic intraverbal baseline treatment session target mastery probe trial learner parent teacher program graph data trend level variability latency duration frequency rate interval momentum escape attention tangible sensory automatic social".split(" ");
const LEFT = new Set("qwertasdfgzxcvb");

test("twenty words, thirteen capitals, six and seven to the two Shifts, some capitals inside the word", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 20; k++) {
    const b = buildShifty(POOL, rand);
    assert.equal(b.words.length, SHIFTY_WORDS);
    assert.equal(b.caps.length, SHIFTY_CAPS);
    assert.equal(new Set(b.words.map((w) => w.toLowerCase())).size, SHIFTY_WORDS);
    const L = b.caps.filter((c) => c.shift === "L").length;
    assert.ok(L === 6 || L === 7, `left ${L}`);
    for (const c of b.caps) {
      const w = b.words[c.word];
      const ch = w[c.index];
      assert.match(ch, /[A-Z]/);
      assert.equal((w.match(/[A-Z]/g) || []).length, 1);
      // The Shift is on the other hand from the letter.
      assert.equal(c.shift, LEFT.has(ch.toLowerCase()) ? "R" : "L");
    }
    assert.ok(b.caps.some((c) => c.where === "inside"));
  }
  assert.equal(buildShifty(["short"]), null);
});

test("revs: a quick clean shift redlines, a slow one idles, a wrong-side one stalls", () => {
  assert.equal(rpmOf(90), 8000);
  assert.equal(rpmOf(350), 4000);
  assert.equal(rpmOf(2000), 800);
  assert.equal(rpmOf(90, true), 800);
});

test("runs are kept per pair and per game, capped, and progress reads first, last and best", () => {
  let g = {};
  for (let i = 0; i < RUNS_KEPT + 5; i++) g = addRun(g, "pair", { at: `2026-09-24T0${i % 10}`, ms: 200 - i }, "br");
  assert.equal(g.pairs.br.length, RUNS_KEPT);
  g = addRun(g, "shifty", { secs: 30 });
  assert.equal(g.shifty.length, 1);
  assert.deepEqual(progressOf([{ secs: 30 }, { secs: 25 }, { secs: 27 }]), { runs: 3, first: 30, last: 27, best: 25 });
  assert.match(progressLine([{ secs: 30 }], "secs", "s"), /First run: 30 s/);
  assert.match(progressLine([{ secs: 30 }, { secs: 24 }], "secs", "s"), /New best, run 2\. 20% faster than your first\./);
  assert.match(progressLine([{ secs: 20 }, { secs: 24 }], "secs", "s"), /Best 20 s, run 2\./);
});

test("the mini-game trophies: first runs are easy, the rest are earned", () => {
  const at = (d) => `2026-09-${String(d).padStart(2, "0")}T12:00:00Z`;
  const none = gameTrophies({});
  assert.ok(none.length >= 12 && none.every((t) => !t.unlocked && t.family === "Mini games"));
  const pairs = {};
  for (const [i, p] of ["br", "mu", "wn", "ck", "bu"].entries()) pairs[p] = [{ at: at(1 + i), ms: 200, roundMs: 210, wpm: 70 }, { at: at(10 + i), ms: 140, roundMs: 210, wpm: 80 }];
  const shifty = [{ at: at(2), secs: 40, wpm: 60, wrong: 2, downToKey: 180, upToNext: 150 }, { at: at(3), secs: 30, wpm: 92, wrong: 0, downToKey: 105, upToNext: 95 }];
  const won = Object.fromEntries(gameTrophies({ pairs, shifty }).map((t) => [t.id, t.at]));
  assert.equal(won["g-hare-today"], at(1));
  assert.equal(won["g-menagerie"], at(14)); // the fifth pair tamed
  assert.equal(won["g-tortoise-tamer"], at(10)); // 140 <= 210 * 0.67
  assert.equal(won["g-pair-surgeon"], null);
  assert.equal(won["g-clutch"], at(2));
  assert.equal(won["g-heel-toe"], at(3));
  assert.equal(won["g-redline"], at(3));
  assert.equal(won["g-quick-clutch"], at(3));
  assert.equal(won["g-silk"], at(3));
  assert.equal(won["g-lap-record"], null);
});

test("River Rhythm reads the last eight gaps: an even beat is calm water, an uneven one drifts to the bank", async () => {
  const { steadiness, driftOf, EVEN_CV } = await import("../web/river.js");
  assert.equal(steadiness([100, 100, 100]), null);
  const even = steadiness([100, 104, 98, 101, 99, 102, 100, 97]);
  assert.ok(even < 0.05);
  assert.equal(driftOf(even), 0);
  const rough = steadiness([60, 240, 80, 300, 70, 260, 90, 280]);
  assert.ok(rough > EVEN_CV);
  assert.ok(driftOf(rough) > 0.5);
  assert.equal(driftOf(5), 1);
  const won = Object.fromEntries(gameTrophies({ river: [{ at: "2026-09-24T10:00:00Z", secs: 24, bestStreak: 21 }] }).map((t) => [t.id, t.at]));
  assert.equal(won["g-flat-water"], "2026-09-24T10:00:00Z");
  assert.equal(won["g-glassy"], "2026-09-24T10:00:00Z");
  assert.equal(won["g-rapids"], "2026-09-24T10:00:00Z");
  assert.equal(won["g-paddler"], null);
});
