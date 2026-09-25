/* The copy round, its passages and the adaptive picker, by hand. node --test. */
import test from "node:test";
import assert from "node:assert/strict";
import { copyErrors, liveMarks } from "../web/copy.js";
import { scoreDrill } from "../web/score.js";
import { PASSAGES, nextPassage, weakKeys, keyLoad, passageLoad, trickyProfile, describeProfile } from "../web/passages.js";
import { ITEMS } from "../web/outline.js";

const REF = "the cat sat on the mat today";

test("a copy lines up by common subsequence: a skipped, doubled or wrong word is one error, not the rest of the line", () => {
  assert.deepEqual(copyErrors("the cat sat", REF), { typed: 3, matched: 3, errors: 0, done: false });
  assert.equal(copyErrors("the sat on the mat", REF).errors, 1);      // skipped "cat"
  assert.equal(copyErrors("the cat cat sat on", REF).errors, 1);      // doubled "cat"
  assert.equal(copyErrors("the dog sat on", REF).errors, 1);          // "dog" for "cat"
  assert.equal(copyErrors("The cat sat", REF).errors, 1);             // a capital counts
  assert.equal(copyErrors(REF, REF).done, true);
  assert.equal(copyErrors("", REF).errors, 0);
});

test("live marks: done words ok or bad, the word under the caret current, off when it stops matching", () => {
  assert.deepEqual(liveMarks("the cat s", REF).slice(0, 4), ["ok", "ok", "cur", ""]);
  assert.deepEqual(liveMarks("the cot ", REF).slice(0, 3), ["ok", "bad", "cur"]);
  assert.deepEqual(liveMarks("the cx", REF).slice(0, 2), ["ok", "cur bad"]);
});

test("a copy round's NWAM subtracts the words that did not match, and the lexicon is not consulted", () => {
  // "the dog sat on" = 14 keys in one minute: 2.8 GWAM; one error: 1.8 NWAM.
  const events = [..."the dog sat on"].map((k, i) => ({ t: i * 100, kind: "char", key: k }));
  const s = scoreDrill({ events, text: "the dog sat on", minutes: 1, lexicon: new Set(), reference: REF });
  assert.equal(s.gwam, 2.8);
  assert.equal(s.uncorrected, 1);
  assert.equal(s.nwam, 1.8);
  assert.equal(s.netBasis, "reference");
  assert.deepEqual(s.unknownWords, []);
});

test("every passage is typeable ASCII, files under a real outline item, and has a source and a respond prompt", () => {
  const ids = new Set(ITEMS.map((i) => i.id));
  for (const p of PASSAGES) {
    assert.ok(/^[\x20-\x7e]+$/.test(p.text), p.id + " text is ASCII");
    assert.ok(/^[\x20-\x7e]+$/.test(p.respond), p.id + " respond is ASCII");
    assert.ok(ids.has(p.outline), p.id + " outline " + p.outline);
    assert.ok(p.source && p.title && ["study", "take"].includes(p.kind), p.id);
    if (p.kind === "take") assert.match(p.source, /drill's own position/);
    assert.ok(p.text.split(/\s+/).length >= 120, p.id + " long enough for a couple of minutes");
  }
  assert.equal(new Set(PASSAGES.map((p) => p.id)).size, PASSAGES.length);
});

test("weak keys are the letters with the highest miss rate over enough presses", () => {
  const rates = { w: { presses: 41, misses: 2, rate: 2 / 41 }, a: { presses: 222, misses: 5, rate: 5 / 222 }, q: { presses: 3, misses: 2, rate: 2 / 3 }, e: { presses: 300, misses: 0, rate: 0 } };
  // q is under 20 presses and e has no misses: neither is read.
  assert.deepEqual(weakKeys(rates), ["w", "a"]);
  // "wawa" is 4 letters, all on the keys; "bbbw" has one w in four.
  assert.equal(keyLoad("wawa", ["w", "a"]), 1);
  assert.equal(keyLoad("bbbw", ["w"]), 0.25);
});

test("the tricky profile is read from the recent drills, so an old problem ages out", () => {
  const drill = (extra) => ({ at: "2026-09-23T10:00:00Z", ...extra });
  const h = [
    ...Array.from({ length: 10 }, () => drill({ slowPairs: ["zq"], tips: ["punctuation"] })), // old
    drill({ slowPairs: ["br", "ck"], shift: { ok: 2, same: 2 } }),
    drill({ slowPairs: ["br"], tips: ["punctuation"], shift: { ok: 2, same: 1 } }),
    drill({ slowPairs: ["br", "ck"], tips: ["punctuation"] }),
  ];
  const p = trickyProfile(h, {});
  // The last ten: seven old drills (zq, punctuation) and the three new ones.
  assert.deepEqual(p.pairs, ["zq", "br", "ck"]);
  assert.equal(p.punctuation, true);
  assert.equal(p.capitals, true);   // 3 same of 7 capitals = 43%
  // Ten more clean drills and every one of those ages out.
  const later = h.concat(Array.from({ length: 10 }, () => drill({ slowPairs: [], shift: { ok: 5, same: 0 } })));
  assert.deepEqual(trickyProfile(later, {}), { keys: [], pairs: [], capitals: false, punctuation: false });
  assert.equal(describeProfile(p), "pairs zq, br, ck \u00b7 capitals \u00b7 punctuation");
});

test("the picker takes the passage that works the profile hardest, skipping the ones copied lately", () => {
  const p = { keys: ["w", "m", "b", "u", "c"], pairs: [], capitals: false, punctuation: false };
  const best = nextPassage([], p);
  for (const x of PASSAGES) assert.ok(passageLoad(best.text, p) >= passageLoad(x.text, p), x.id);
  const second = nextPassage([best.id], p);
  assert.notEqual(second.id, best.id);
  // A slow pair adds its occurrences: "brbr" letters 4, pair "br" twice = 2*2/4.
  assert.equal(passageLoad("brbr", { keys: [], pairs: ["br"] }), 1);
  // No profile: least recently copied, bank order.
  assert.equal(nextPassage([], null).id, PASSAGES[0].id);
  assert.equal(nextPassage([PASSAGES[0].id], null).id, PASSAGES[1].id);
});
