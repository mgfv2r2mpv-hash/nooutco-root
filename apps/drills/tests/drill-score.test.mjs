/* The drill scorer, against hand-computed cases. node --test, no browser.
 *
 * Every expected number here is worked out in the comment beside it, so a
 * change that moves one is a change to the arithmetic and not to a fixture.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  scoreDrill, countRuns, unknownWords, isKnown, rate, trickyKeys, timingProfile, formTips,
  BANDS, ACCURACY_GATE,
} from "../web/score.js";

/** Type a string at a fixed cadence; "<" is Backspace. Returns events + text. */
function typed(s, gapMs = 100) {
  const events = [];
  const buf = [];
  let t = 0;
  for (const ch of s) {
    if (ch === "<") { events.push({ t, kind: "backspace" }); buf.pop(); }
    else if (ch === "\n") { events.push({ t, kind: "enter" }); buf.push("\n"); }
    else { events.push({ t, kind: "char", key: ch }); buf.push(ch); }
    t += gapMs;
  }
  return { events, text: buf.join("") };
}

test("GWAM is placed keystrokes over five over minutes, and Backspace places nothing", () => {
  // 50 characters placed in one minute = 10 gross words = 10 GWAM.
  const { events, text } = typed("a".repeat(50));
  const s = scoreDrill({ events, text, minutes: 1 });
  assert.equal(s.keystrokes, 50);
  assert.equal(s.grossWords, 10);
  assert.equal(s.gwam, 10);
  // Two backspaces add nothing to the count.
  const b = typed("a".repeat(52) + "<<");
  assert.equal(scoreDrill({ events: b.events, text: b.text, minutes: 1 }).keystrokes, 52);
  // Two minutes halves it.
  assert.equal(scoreDrill({ events, text, minutes: 2 }).gwam, 5);
});

test("a run of Backspaces is one correction, however many characters it eats", () => {
  const { events } = typed("abc<<<def<g");
  assert.equal(countRuns(events, "backspace"), 2);
});

test("without a lexicon NWAM subtracts corrections per minute and says so; with one it subtracts unknown words", () => {
  // 100 placed chars = 20 gross words; 3 corrections; one minute.
  const { events, text } = typed("a".repeat(100) + "<a<a<a");
  const noLex = scoreDrill({ events, text, minutes: 1 });
  assert.equal(noLex.netBasis, "corrections");
  // placed: 100 + 3 (the a's after each backspace) = 103 -> 20.6 gross words.
  assert.equal(noLex.grossWords, 20.6);
  assert.equal(noLex.nwam, 20.6 - 3);
  // With a lexicon that knows nothing, every token is unknown. The text is one
  // token ("aaaa...a"), so uncorrected = 1 and NWAM = 20.6 - 1.
  const lex = scoreDrill({ events, text, minutes: 1, lexicon: new Set() });
  assert.equal(lex.netBasis, "uncorrected");
  assert.equal(lex.uncorrected, 1);
  assert.equal(lex.nwam, 19.6);
});

test("unknown words skip proper nouns and brackets, strip apostrophes, and read case-insensitively", () => {
  const lex = new Set(["the", "bcba", "modeled", "it's"]);
  const out = unknownWords("The BCBA modeled it's [unknown] Rethink prompt-fading", lex);
  // "The" -> the (known); "BCBA" starts upper (skipped); "modeled" known;
  // "it's" known; "unknown" unknown; "Rethink" upper (skipped);
  // "prompt-fading" unknown.
  assert.deepEqual(out, ["unknown", "prompt-fading"]);
});

test("a base-form word list still knows the inflections a clinician types", () => {
  const lex = new Set(["model", "name", "parent", "run", "watch", "family", "quick", "stop", "prompt", "the", "then", "teh"]);
  for (const w of ["modeled", "named", "parents", "running", "watched", "families", "quickly", "stopped", "prompting", "prompted", "prompts", "quicker"]) {
    assert.equal(isKnown(w, lex), true, w);
  }
  for (const w of ["teg", "dysregulatn", "xyzzy", "modeling"]) assert.equal(isKnown(w, lex), w === "modeling", w);
  // "modelling" is known too: the doubled consonant rule reaches "model". Both spellings count.
  // "teh" is in this lexicon and is known; the rule only widens, never narrows.
  assert.equal(isKnown("teh", lex), true);
  assert.deepEqual(unknownWords("The parents watched the modeled prompt, then teg", lex), ["teg"]);
});

test("accuracy is one minus all errors over gross words, clamped", () => {
  const { events, text } = typed("a".repeat(100) + "<a<a<a<a<a"); // 105 placed = 21 words, 5 corrections
  const s = scoreDrill({ events, text, minutes: 1 });
  assert.equal(s.accuracy, Math.round((1 - 5 / 21) * 1000) / 1000);
});

test("the rating reads NWAM against the bands, and accuracy under the gate drops one band", () => {
  assert.equal(rate(80, 1).name, "Professional");
  assert.equal(rate(75, 1).name, "Professional");
  assert.equal(rate(74.9, 1).name, "Fluent");
  assert.equal(rate(45, 1).name, "Intermediate");
  assert.equal(rate(35, 1).name, "Average");
  assert.equal(rate(34.9, 1).name, "Amateur");
  assert.equal(rate(80, ACCURACY_GATE - 0.01).name, "Fluent");
  assert.equal(rate(80, ACCURACY_GATE - 0.01).accuracyGated, true);
  // The bottom band cannot drop further.
  assert.equal(rate(10, 0.5).name, "Amateur");
  // 2026-09-23: five bands above Professional, set from his own numbers
  // (median 89 NWAM, best 100), so a typical drill is no longer the top band.
  assert.deepEqual(BANDS.map((b) => b.name), ["Stenographer", "Virtuoso", "Master", "Elite", "Expert", "Professional", "Fluent", "Intermediate", "Average", "Amateur"]);
  assert.equal(rate(89, 1).name, "Expert");
  assert.equal(rate(100, 1).name, "Elite");
  assert.equal(rate(100, ACCURACY_GATE - 0.01).name, "Expert");
  assert.equal(rate(130, 1).name, "Stenographer");
});

test("tricky keys record what was hit and what was meant, once per correction run", () => {
  // Type "ther", backspace, "e" (hit r, meant e); then "wprd", two backspaces, "rd" (hit p, meant o).
  const { events } = typed("ther<e wprd<<<ord");
  const t = trickyKeys(events);
  assert.deepEqual(t.keys.map((k) => k.key).sort(), ["p", "r"]);
  assert.deepEqual(t.confusions.map((c) => c.hit + ">" + c.meant).sort(), ["p>o", "r>e"]);
});

test("a transposition reads as the first differing key: teh corrected to the is e for h", () => {
  const { events } = typed("teh <<<<the ");
  const t = trickyKeys(events);
  assert.deepEqual(t.confusions.map((c) => c.hit + ">" + c.meant), ["e>h"]);
  // Retyping the same thing is not an error.
  const same = trickyKeys(typed("abc<<<abc").events);
  assert.deepEqual(same.keys, []);
});

test("timing reads the median interval, flags pairs over twice it, and counts pauses separately", () => {
  const events = [];
  let t = 0;
  const push = (key, dt) => { t += dt; events.push({ t, kind: "char", key }); };
  events.push({ t: 0, kind: "char", key: "a" });
  // Fast pairs at 100ms, then "qz" twice at 400ms, then a 3s pause.
  for (const k of "bcdefghij") push(k, 100);
  push("q", 100); push("z", 400); push("q", 100); push("z", 400);
  push("k", 3000); push("l", 100);
  const p = timingProfile(events);
  assert.equal(p.pauses, 1);
  assert.equal(p.medianMs, 100);
  assert.deepEqual(p.slowPairs.map((s) => s.pair), ["qz"]);
});

test("a tip appears only when its trigger fired", () => {
  const quiet = formTips({ grossWords: 50, corrections: 1, tricky: { keys: [], confusions: [] },
    timing: { medianMs: 120, cv: 0.3, pauses: 0, afterShiftMs: 130, punctuationMs: 140, intervals: 200, slowPairs: [] } });
  assert.deepEqual(quiet, []);
  const loud = formTips({ grossWords: 50, corrections: 8, tricky: { keys: [], confusions: [{ hit: "r", meant: "e", count: 2 }] },
    timing: { medianMs: 120, cv: 0.8, pauses: 4, afterShiftMs: 300, punctuationMs: 400, intervals: 200, wordIntervals: 150, wordCv: 0.7, slowPairs: [] },
    habits: { wordByHand: 2, keysSpent: 11 }, shift: { ok: 6, same: 4, sameLeft: 3, sameRight: 1 } });
  assert.deepEqual(loud.map((x) => x.id), ["pace", "shift", "punctuation", "drift", "shiftSide", "optionDelete", "cadence"]);
  // Pauses no longer earn a tip (they are thinking), and a wide spread BETWEEN
  // words with even fingers inside them is not a cadence problem.
  const thinker = formTips({ grossWords: 50, corrections: 1, tricky: { keys: [], confusions: [] },
    timing: { medianMs: 120, cv: 0.9, pauses: 9, intervals: 200, wordIntervals: 150, wordCv: 0.3, slowPairs: [] } });
  assert.deepEqual(thinker, []);
});

test("garbage in the event list is ignored rather than counted", () => {
  const s = scoreDrill({ events: [null, { t: "x", kind: "char" }, { t: 1, kind: "char", key: "a" }, { kind: "char" }], text: "a", minutes: 1 });
  assert.equal(s.keystrokes, 1);
  assert.equal(scoreDrill({}).keystrokes, 0);
  assert.equal(scoreDrill({ events: [], text: "", minutes: 0 }).minutes, 1);
});
