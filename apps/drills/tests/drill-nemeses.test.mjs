/* Achievements, item 4 of the overnight plan: well over 150 in all, the
 * conversation ones, and the nemesis engine that writes achievements from his
 * own drills. node --test. Every history is built here by hand. */
import test from "node:test";
import assert from "node:assert/strict";
import { trophyCase, TROPHIES } from "../web/trophies.js";
import { nemeses, newlySpotted } from "../web/nemeses.js";

/** Local time, September 2026: day d, drill i of the day, one every two minutes from 9. */
const at = (d, i = 0) => new Date(2026, 8, d, 9, i * 2).toISOString();
const rec = (d, i, extra = {}) => ({ at: at(d, i), minutes: 1, nwam: 80, gwam: 84, words: 84, accuracy: 0.96, ...extra });
const find = (h, id) => trophyCase(h).find((t) => t.id === id);
const run = (n, f, day = 10, from = 0) => Array.from({ length: n }, (_, i) => rec(day, from + i, f(i)));

test("well over 150 achievements, unique ids, plain ASCII names with no dashes", () => {
  assert.ok(TROPHIES.length >= 180, `only ${TROPHIES.length}`);
  assert.equal(new Set(TROPHIES.map((t) => t.id)).size, TROPHIES.length);
  for (const t of TROPHIES) {
    assert.ok(/^[\x20-\x7e]+$/.test(t.name + t.condition + (t.hint || "")), `${t.id} is not plain ASCII`);
    assert.ok(!/\s-\s|--/.test(t.name), `${t.id} has a dash in its name`);
  }
  // Every BACB domain has its own pair.
  for (const d of "ABCDEFGHI") assert.ok(TROPHIES.some((t) => t.id === `domain-${d}-3`), d);
});

test("baton chains: the longest pass reached, read from the baton passage ids", () => {
  const h = [
    rec(10, 0, { mode: "respond", passage: "p-reinforcement" }),
    rec(10, 1, { mode: "copy", passage: "baton-1" }), rec(10, 2, { mode: "respond", passage: "baton-1" }),
    rec(10, 3, { mode: "copy", passage: "baton-2" }), rec(10, 4, { mode: "respond", passage: "baton-2" }),
    rec(10, 5, { mode: "copy", passage: "baton-3" }),
  ];
  assert.equal(find(h, "baton-1").unlocked, at(10, 1));
  assert.equal(find(h, "baton-2").unlocked, at(10, 3));
  assert.equal(find(h, "baton-3").unlocked, at(10, 5));
  assert.equal(find(h, "baton-5").unlocked, null);
  assert.equal(find(h, "baton-5").have, 3);
  assert.equal(find(h, "baton-total-10").have, 3, "each baton passage copied counts once");
});

test("keep going, carried across days, the shelf, variants and taking back a thought", () => {
  const h = [
    rec(10, 0, { mode: "respond", passage: "p-x", cont: 1, revisions: 4 }),
    rec(10, 1, { mode: "respond", passage: "p-x", cont: 4, revisions: 6, kept: true }),
    rec(11, 0, { mode: "respond", passage: "p-x" }),
    rec(11, 1, { mode: "copy", passage: "p-y", fromShelf: true, variant: 1, shelfEmpty: true }),
    // Baton ids restart every chain: two days of "baton-1" are not one conversation.
    rec(12, 0, { mode: "respond", passage: "baton-1" }), rec(13, 0, { mode: "respond", passage: "baton-1" }),
  ];
  assert.equal(find(h, "keep-going-1").unlocked, at(10, 0));
  assert.equal(find(h, "keep-going-4").unlocked, at(10, 1));
  assert.equal(find(h, "carried-2").unlocked, at(11, 0));
  assert.equal(find(h, "carried-3").unlocked, null, "p-x was answered on two days, baton-1 does not count");
  assert.equal(find(h, "shelf-back-1").unlocked, at(11, 1));
  assert.equal(find(h, "shelf-clear-1").unlocked, at(11, 1));
  assert.equal(find(h, "variant-1").unlocked, at(11, 1));
  assert.equal(find(h, "revisions-10").unlocked, at(10, 1));
  assert.equal(find(h, "kept-n-1").unlocked, at(10, 1));
});

test("strict Shift clean drills count only strict rounds with 10 capitals and none refused", () => {
  const h = [
    rec(10, 0, { shift: { ok: 12, same: 0 } }), // lenient round: no refused field
    rec(10, 1, { refused: 1, refusedKeys: ["t"], shift: { ok: 12, same: 0 } }),
    rec(10, 2, { refused: 0, refusedKeys: [], shift: { ok: 9, same: 0 } }),
    rec(10, 3, { refused: 0, refusedKeys: [], shift: { ok: 10, same: 0 } }),
  ];
  assert.equal(find(h, "strict-clean-1").unlocked, at(10, 3));
});

test("domain trophies file answers by the outline letter", () => {
  const h = run(3, () => ({ mode: "answer", outline: "E.4", itemId: "q" }));
  assert.equal(find(h, "domain-E-3").unlocked, at(10, 2));
  assert.equal(find(h, "domain-E-3").name, "Ethics Initiate");
  assert.equal(find(h, "domain-A-3").have, 0);
});

/* ---- the nemesis engine ------------------------------------------------ */

const keys = (u, misses) => ({ keys: { u: { presses: u, misses }, e: { presses: 40, misses: 0 } } });

test("a key missed on 3% or more over 8 drills is spotted once, with its baseline in the condition", () => {
  const bad = run(8, () => keys(10, 1)); // 10% on u over 80 presses
  const [n, ...rest] = nemeses(bad);
  assert.equal(rest.length, 0, "e was never missed");
  assert.equal(n.id, "nem-key-u");
  assert.equal(n.spotted, at(10, 7));
  assert.equal(n.unlocked, null);
  assert.match(n.condition, /U missed on 10% of presses over 8 drills/);
  assert.match(n.condition, /5% or less over 12 drills since/);
  // Seven drills are not enough to spot anything, however bad.
  assert.equal(nemeses(bad.slice(0, 7)).length, 0);
  // It shows first in the case, in its own group.
  assert.equal(trophyCase(bad)[0].group, "Your nemeses");
});

test("a key is tamed by halving its rate over 12 drills since the spotting, and not by a lucky few", () => {
  const bad = run(8, () => keys(10, 1));
  const better = run(12, () => keys(10, 0), 10, 8);
  const partial = nemeses([...bad, ...better.slice(0, 11)]).find((n) => n.id === "nem-key-u");
  assert.equal(partial.unlocked, null, "eleven clean drills are one short");
  const tamed = find([...bad, ...better], "nem-key-u");
  assert.equal(tamed.unlocked, at(10, 19));
  assert.equal(tamed.have, tamed.need);
  // Still missing it at the old rate: never tamed, and the bar stops one short of full.
  const same = find([...bad, ...run(20, () => keys(10, 1), 10, 8)], "nem-key-u");
  assert.equal(same.unlocked, null);
  assert.equal(same.have, same.need - 1);
});

test("a key needs enough presses: a rare letter is never spotted on a handful of misses", () => {
  assert.equal(nemeses(run(8, () => keys(5, 1))).length, 0, "40 presses is under the 60 needed");
});

test("a slow pair is spotted at 3 of 10 drills and tamed by 15 quiet drills in a row", () => {
  const flagged = run(3, () => ({ slowPairs: ["br"] }));
  const [n] = nemeses(flagged);
  assert.equal(n.id, "nem-pair-br");
  assert.equal(n.spotted, at(10, 2));
  const quiet = run(15, () => ({ slowPairs: [] }), 10, 3);
  assert.equal(nemeses([...flagged, ...quiet.slice(0, 7), { ...quiet[7], slowPairs: ["br"] }, ...quiet.slice(8)])[0].unlocked, null,
    "a relapse restarts the quiet run");
  assert.equal(nemeses([...flagged, ...quiet])[0].unlocked, at(10, 17));
  // Short drills never count toward a pair either way.
  assert.equal(nemeses(run(3, () => ({ slowPairs: ["br"], words: 30 }))).length, 0);
});

test("a letter confusion is spotted in 3 drills and tamed only when the meant letter was really typed", () => {
  const typo = run(3, () => ({ confusions: ["b>v"] }));
  assert.equal(nemeses(typo)[0].name, "B Is Not V");
  const quietNoB = run(8, () => ({ confusions: [], keys: { b: { presses: 2, misses: 0 } } }), 10, 3);
  assert.equal(nemeses([...typo, ...quietNoB])[0].unlocked, null, "16 presses of b is too few to call it tamed");
  const quietB = run(8, () => ({ confusions: [], keys: { b: { presses: 6, misses: 0 } } }), 10, 3);
  assert.equal(nemeses([...typo, ...quietB])[0].unlocked, at(10, 10));
});

test("a refused same-side capital is spotted after 3 refusals and put on extinction by 5 clean strict drills", () => {
  const refused = run(3, () => ({ refused: 1, refusedKeys: ["T"], shift: { ok: 3, same: 0 } }));
  const [n] = nemeses(refused);
  assert.equal(n.id, "nem-refused-t");
  assert.equal(n.name, "Extinction: Same-Side T");
  const clean = run(5, () => ({ refused: 0, refusedKeys: [], shift: { ok: 3, same: 0 } }), 10, 3);
  assert.equal(nemeses([...refused, ...clean])[0].unlocked, at(10, 7));
  // Lenient rounds (no refused field) neither spot nor tame.
  assert.equal(nemeses(run(5, () => ({ shift: { ok: 3, same: 3 } }))).length, 0);
});

test("dates are replayed, never moved: the same history gives the same nemeses, and newlySpotted names the new one", () => {
  const h = run(8, () => keys(10, 1));
  assert.deepEqual(trophyCase(h.slice().reverse()), trophyCase(h));
  const before = trophyCase(h.slice(0, 7)), after = trophyCase(h);
  assert.deepEqual(newlySpotted(before, after).map((t) => t.id), ["nem-key-u"]);
  assert.deepEqual(newlySpotted(after, after), []);
});
