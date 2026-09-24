/* The storehouse: a bank question for every outline item, and oracle seeds
 * that ask for his view. node --test. */
import test from "node:test";
import assert from "node:assert/strict";
import { BANK, TAGS } from "../web/bank.js";
import { BANK_MORE } from "../web/bank-more.js";
import { ITEMS } from "../web/outline.js";
import { SEEDS, nextSeed, openWithSeed } from "../web/seeds.js";

test("the bank asks about every one of the outline's 104 items", () => {
  const asked = new Set(BANK.map((b) => b.outline));
  const missing = ITEMS.filter((it) => !asked.has(it.id)).map((it) => it.id);
  assert.deepEqual(missing, []);
  assert.equal(new Set(BANK.map((b) => b.id)).size, BANK.length, "bank ids are unique");
  assert.ok(BANK.length >= 108);
});

test("every new bank question is plain ASCII, one question with two sourced bullets, under a known tag", () => {
  for (const b of BANK_MORE) {
    assert.ok(TAGS.includes(b.tag), `${b.id} tag ${b.tag}`);
    assert.match(b.question, /^[\x20-\x7e]+$/, `${b.id} question is ASCII`);
    assert.doesNotMatch(b.question, /--| - /, `${b.id} question has a dash`);
    assert.equal(b.bullets.length, 2, b.id);
    for (const x of b.bullets) {
      assert.match(x.text + x.source, /^[\x20-\x7e]+$/, `${b.id} bullet is ASCII`);
      assert.doesNotMatch(x.text, /--| - /, `${b.id} bullet has a dash`);
      assert.ok(x.source.trim(), `${b.id} bullet has no source`);
    }
  }
});

// Every paper or book the new questions cite by author and year. A new
// citation has to be added here on purpose, after checking the work exists.
const CHECKED = [
  "Skinner (1938), The Behavior of Organisms", "Skinner (1957), Verbal Behavior", "Skinner (1969), Contingencies of Reinforcement",
  "Hayes (Ed.) (1989), Rule-Governed Behavior", "Sidman & Tailby (1982), JEAB", "Stokes & Baer (1977), JABA",
  "Fisher, Kelley & Lomas (2003), JABA", "Hartmann & Hall (1976), JABA", "Taylor, LeBlanc & Nosik (2019), Behavior Analysis in Practice",
  "Fong, Catagnus, Brodhead, Quigley & Field (2016), Behavior Analysis in Practice", "Rosales-Ruiz & Baer (1997), JABA",
  "Lalli et al. (1999), JABA", "Michael (1982), JEAB", "Hart & Risley (1975), JABA", "Lerman, Iwata & Wallace (1999), JABA",
  "Parsons, Rollyson & Reid (2012), Behavior Analysis in Practice",
];

test("the new questions cite only checked works, the textbook by chapter, the Code, the outline, or general practice", () => {
  for (const b of BANK_MORE) for (const { source } of b.bullets) {
    const ok = CHECKED.includes(source) || source === "general practice knowledge"
      || /^Cooper, Heron & Heward \(2020\), Applied Behavior Analysis, 3rd ed\., ch\. [A-Z]/.test(source)
      || /^BACB Ethics Code for Behavior Analysts \(2020\), /.test(source)
      || /^BACB BCBA Test Content Outline, 6th ed\., [A-I]\.\d+$/.test(source);
    assert.ok(ok, `${b.id} cites an unchecked source: ${source}`);
    const m = source.match(/^BACB BCBA Test Content Outline, 6th ed\., ([A-I]\.\d+)$/);
    if (m) assert.equal(m[1], b.outline, `${b.id} cites the outline item it files under`);
  }
});

test("oracle seeds are unique, plain ASCII, file under real outline items, and take no side", () => {
  assert.ok(SEEDS.length >= 30);
  assert.equal(new Set(SEEDS.map((s) => s.id)).size, SEEDS.length);
  const ids = new Set(ITEMS.map((it) => it.id));
  for (const s of SEEDS) {
    assert.ok(ids.has(s.outline), `${s.id} -> ${s.outline}`);
    assert.match(s.topic, /^[\x20-\x7e]+$/, `${s.id} is ASCII`);
    assert.doesNotMatch(s.topic, /--| - /, `${s.id} has a dash`);
    // A topic, never a verdict: no "should always" or "never works".
    assert.doesNotMatch(s.topic, /\b(always|never works|is wrong|is right)\b/i, `${s.id} takes a side`);
  }
});

test("the next seed is the least talked-about one, in list order on a tie", () => {
  assert.equal(nextSeed([]).id, SEEDS[0].id);
  const h = [{ mode: "oracle", seed: SEEDS[0].id }, { mode: "oracle", seed: SEEDS[0].id }, { mode: "oracle", seed: SEEDS[1].id }];
  assert.equal(nextSeed(h).id, SEEDS[2].id);
  const all = SEEDS.map((s) => ({ mode: "oracle", seed: s.id })).concat([{ mode: "oracle", seed: SEEDS[0].id }]);
  assert.equal(nextSeed(all).id, SEEDS[1].id, "everything once, the first twice: the second is next");
});

test("seeds and the map take turns: a first conversation opens on a seed, then the map, then a seed", () => {
  assert.equal(openWithSeed([]), true);
  assert.equal(openWithSeed([{ mode: "answer" }]), true);
  assert.equal(openWithSeed([{ mode: "oracle", seed: "s-hours" }, { mode: "copy" }]), false);
  assert.equal(openWithSeed([{ mode: "oracle", seed: "s-hours" }, { mode: "oracle" }]), true);
});
