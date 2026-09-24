/* The cross-purpose he flagged, 2026-09-23: in a composed round, deleting a
 * thought he does not want the expert to see must never cost speed, accuracy,
 * the band or the star. Thinking is never punished; only typos are. A copy
 * round keeps strict reference scoring. node --test, every number by hand. */
import test from "node:test";
import assert from "node:assert/strict";
import { scoreDrill, deleteRuns, runKinds, nearWord, trickyKeys, keptOf } from "../web/score.js";
import { personalLadder } from "../web/panel.js";

/** "<" is a plain Backspace; everything else is typed, 100 ms apart. */
function typed(s, gapMs = 100) {
  const events = [];
  const buf = [];
  let t = 0;
  for (const ch of s) {
    if (ch === "<") { events.push({ t, kind: "backspace" }); buf.pop(); }
    else { events.push({ t, kind: "char", key: ch }); buf.push(ch); }
    t += gapMs;
  }
  return { events, text: buf.join("") };
}

test("a whole word taken back by hand and replaced with a different word is a revision, not a correction", () => {
  // "the dog ran fast" then four Backspaces take "fast", then "slow".
  const { events } = typed("the dog ran fast<<<<slow");
  assert.deepEqual(deleteRuns(events, { compose: true }), { corrections: 0, revisions: 1, revisedKeys: 4 });
  // The same keys without compose (the old rule, and a copy round) are one correction.
  assert.deepEqual(deleteRuns(events), { corrections: 1, revisions: 0, revisedKeys: 0 });
});

test("a run that reaches back over a space into an earlier word is a revision", () => {
  // "i think it is bad" then 9 Backspaces take " it is bad", leaving "i think".
  const { events } = typed("i think it is bad<<<<<<<<<<");
  const kinds = runKinds(events, { compose: true });
  assert.equal(kinds.length, 1);
  assert.equal(kinds[0].removed, " it is bad");
  assert.equal(kinds[0].revised, true);
});

test("a typo fixed, inside the word or just after its space, is still a correction and still a tricky key", () => {
  // Mid-word: "wrnog", three back, "ong".
  assert.deepEqual(deleteRuns(typed("go wrnog<<<ong").events, { compose: true }), { corrections: 1, revisions: 0, revisedKeys: 0 });
  // Just past the space: "teh " taken back whole and retyped "the" is a transposition, not a changed mind.
  const teh = typed("teh <<<<the ").events;
  assert.deepEqual(deleteRuns(teh, { compose: true }), { corrections: 1, revisions: 0, revisedKeys: 0 });
  assert.deepEqual(trickyKeys(teh, { compose: true }).confusions.map((c) => c.hit + ">" + c.meant), ["e>h"]);
  // A changed mind is not a miss: "fast" -> "slow" reads no tricky key under compose.
  assert.deepEqual(trickyKeys(typed("the dog ran fast<<<<slow").events, { compose: true }).all, {});
});

test("nearWord: a slip or a transposition is the same word, a different word is not", () => {
  assert.equal(nearWord("teh", "the"), true);
  assert.equal(nearWord("reinforcment", "reinforcement"), true);
  assert.equal(nearWord("fast", "slow"), false);
  assert.equal(nearWord("wrong", "right"), false);
  assert.equal(nearWord("cat", "cats"), true);
});

test("deleting a whole thought costs no speed, no accuracy and no band in a composed round", () => {
  // 55 keys kept, a 21-key thought typed and taken back by hand, then 35 more kept.
  const thought = " and I am not so sure";            // 21 keys, taken back whole
  const keep1 = "reinforcement works when it is contingent and immediate";
  const keep2 = " so the plan stays as written today";
  const s = typed(keep1 + thought + "<".repeat(thought.length) + keep2);
  const score = scoreDrill({ events: s.events, text: s.text, minutes: 1 });
  assert.equal(s.text, keep1 + keep2);
  // Every produced character counts toward GWAM: 55 + 21 + 35 = 111 keys = 22.2 words.
  assert.equal(score.keystrokes, keep1.length + thought.length + keep2.length);
  assert.equal(score.gwam, 22.2);
  assert.equal(score.corrections, 0);
  assert.equal(score.revisions, 1);
  assert.equal(score.revisedKeys, thought.length);
  assert.equal(score.accuracy, 1);
  assert.equal(score.rating.accuracyGated, false);
  // The kept text is reported apart: 15 words, 90 characters.
  assert.deepEqual(score.kept, keptOf(keep1 + keep2));
  assert.equal(score.kept.words, 15);
});

test("an uncorrected unknown word in the final text still costs NWAM in a composed round", () => {
  const s = typed("the dog ran fast<<<<slwo");
  const lex = new Set(["the", "dog", "ran", "slow"]);
  const score = scoreDrill({ events: s.events, text: s.text, minutes: 1, lexicon: lex });
  // "slwo" is not "fast" retyped, so the delete was a revision; "slwo" itself is a typo left in.
  assert.equal(score.corrections, 0);
  assert.equal(score.uncorrected, 1);
  assert.equal(score.nwam, Math.round((score.gwam - 1) * 10) / 10);
});

test("a copy round keeps strict scoring: the same whole-word delete is a correction", () => {
  const s = typed("the dog ran fast<<<<slow");
  const score = scoreDrill({ events: s.events, text: s.text, minutes: 1, reference: "the dog ran slow" });
  assert.equal(score.corrections, 1);
  assert.equal(score.revisions, 0);
});

test("the personal ladder: his usual at this clock, his best, and the next milestone of five", () => {
  const h = [88, 91, 90, 100, 86].map((nwam) => ({ minutes: 1, nwam })).concat([{ minutes: 2, nwam: 120 }]);
  // Usual is the median of the 1-minute drills (86 88 90 91 100 -> 90); best 100; milestone 105.
  assert.deepEqual(personalLadder(92, h, 1), { usual: 90, best: 100, milestone: 105, toMilestone: 13, n: 5 });
  // Beating the best moves the milestone past the new number.
  assert.equal(personalLadder(103.4, h, 1).milestone, 105);
  assert.equal(personalLadder(105, h, 1).milestone, 110);
  // Under three drills there is no usual yet; with none there is no best.
  assert.deepEqual(personalLadder(40, [], 3), { usual: null, best: null, milestone: 45, toMilestone: 5, n: 0 });
});
