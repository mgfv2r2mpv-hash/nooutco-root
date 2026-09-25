/* Read and consider, and the shelf: pinned by hand. node --test.
 *
 * His ask of 2026-09-23: after the copy round he reads the passage and
 * responds, or shelves it; a shelved passage comes back later with DIFFERENT
 * words to type for the same idea.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { PASSAGES, nextPassage, passageById } from "../web/passages.js";
import { VARIANTS, textsFor } from "../web/variants.js";
import { shelve, unshelve, isDue, dueEntry, returned, describeShelf, copyRounds, SHELF_ROUNDS } from "../web/shelf.js";
import { paragraphs, scoreLine } from "../web/read.js";

const words = (s) => s.trim().split(/\s+/).length;

test("every passage has at least one variant: ASCII, no dashes, same length band, not a copy", () => {
  for (const p of PASSAGES) {
    const vs = VARIANTS[p.id];
    assert.ok(Array.isArray(vs) && vs.length >= 1, `${p.id} has no variant`);
    for (const v of vs) {
      assert.match(v, /^[\x20-\x7e]+$/, `${p.id} variant is not plain ASCII`);
      assert.doesNotMatch(v, /--/, `${p.id} variant has a double hyphen`);
      assert.notEqual(v, p.text);
      const ratio = words(v) / words(p.text);
      assert.ok(ratio > 0.75 && ratio < 1.3, `${p.id} variant length ratio ${ratio.toFixed(2)}`);
      // New words to type: most sentences must differ from the original's.
      const orig = new Set(p.text.split(/(?<=[.!?])\s+/));
      const same = v.split(/(?<=[.!?])\s+/).filter((x) => orig.has(x)).length;
      assert.ok(same <= 2, `${p.id} variant repeats ${same} sentences verbatim`);
    }
  }
  // No variant for a passage that does not exist.
  for (const id of Object.keys(VARIANTS)) assert.ok(passageById(id), `variant for unknown ${id}`);
});

test("textsFor lists the original first, then the variants", () => {
  const p = passageById("p-carr");
  assert.deepEqual(textsFor(p), [p.text, ...VARIANTS["p-carr"]]);
  assert.deepEqual(textsFor(null), []);
});

test("shelving adds one entry per passage, and unshelving takes it off; neither changes the old shelf", () => {
  const p = passageById("p-wolf");
  const s0 = Object.freeze([]);
  const s1 = shelve(s0, p, { at: "2026-09-23T22:00:00.000Z", round: 4 });
  assert.equal(s0.length, 0);
  assert.deepEqual(s1, [{ id: "p-wolf", at: "2026-09-23T22:00:00.000Z", round: 4, shown: 0 }]);
  const s2 = shelve(s1, { ...p, variant: 1 }, { at: "2026-09-23T23:00:00.000Z", round: 6 });
  assert.equal(s2.length, 1, "shelving again replaces, never doubles");
  assert.equal(s2[0].shown, 1);
  assert.deepEqual(unshelve(s2, "p-wolf"), []);
});

test("an entry is due after three more copy rounds, or on a later day, not before", () => {
  const e = { id: "p-wolf", at: new Date(2026, 8, 23, 22).toISOString(), round: 4, shown: 0 };
  assert.equal(SHELF_ROUNDS, 3);
  assert.equal(isDue(e, { round: 6, today: "2026-09-23" }), false);
  assert.equal(isDue(e, { round: 7, today: "2026-09-23" }), true);
  assert.equal(isDue(e, { round: 4, today: "2026-09-24" }), true);
  assert.equal(dueEntry([e], { round: 5, today: "2026-09-23" }), null);
  assert.equal(dueEntry([e], { round: 7, today: "2026-09-23" }), e);
});

test("a shelved passage comes back as the next text in turn: the same idea in new words", () => {
  const p = passageById("p-lerman");
  const first = returned({ id: p.id, shown: 0 });
  assert.equal(first.text, VARIANTS["p-lerman"][0]);
  assert.equal(first.variant, 1);
  assert.equal(first.fromShelf, true);
  assert.equal(first.respond, p.respond, "the question is the passage's own");
  assert.equal(first.source, p.source);
  // Shelved again after typing the variant: it comes back as the original.
  const again = returned({ id: p.id, shown: 1 });
  assert.equal(again.text, p.text);
  assert.equal(again.variant, 0);
  assert.equal(returned({ id: "p-gone", shown: 0 }), null);
});

test("a baton passage is shelved with the expert's text and comes back as it was", () => {
  const baton = { id: "baton-2", kind: "baton", outline: "B.22", title: "Rate, not order", text: "Rate builds persistence.", respond: "How would you raise the rate?", sources: [{ claim: "c", source: "s" }], source: "The expert" };
  const s = shelve([], baton, { at: "2026-09-23T22:00:00.000Z", round: 1 });
  assert.equal(s[0].baton.text, "Rate builds persistence.");
  const back = returned(s[0]);
  assert.equal(back.kind, "baton");
  assert.equal(back.text, "Rate builds persistence.");
  assert.equal(back.respond, "How would you raise the rate?");
});

test("the copy picker leaves shelved passages for the shelf, and never runs dry", () => {
  const all = PASSAGES.map((p) => p.id);
  const pick = nextPassage([], null, all.slice(0, -1));
  assert.equal(pick.id, all.at(-1));
  assert.ok(nextPassage(all.slice(-3), null, all), "every passage shelved still returns one");
});

test("copyRounds counts copy rounds only, and describeShelf says when each comes back", () => {
  assert.equal(copyRounds([{ mode: "copy" }, { mode: "respond" }, { mode: "copy" }, null]), 2);
  const rows = describeShelf([{ id: "p-wolf", at: new Date(2026, 8, 23, 22).toISOString(), round: 2 }], { round: 3, today: "2026-09-23" });
  assert.equal(rows[0].title, passageById("p-wolf").title);
  assert.equal(rows[0].when, "back in 2 copy rounds, or tomorrow");
  assert.equal(rows[0].due, false);
});

test("the read screen splits a passage into paragraphs and reports the copy in one line", () => {
  const ps = paragraphs("One. Two. Three. Four. Five. Six.", 4);
  assert.deepEqual(ps, ["One. Two. Three. Four.", "Five. Six."]);
  assert.equal(paragraphs(passageById("p-iwata").text).join(" ").split(/\s+/).length, words(passageById("p-iwata").text));
  assert.equal(scoreLine({ gwam: 80, nwam: 78.44, accuracy: 0.981, rating: { name: "Professional" } }), "Copied at 78.4 NWAM, 98% accurate \u00b7 Professional");
  assert.equal(scoreLine({ gwam: 0 }), "Nothing typed in that round.");
});
