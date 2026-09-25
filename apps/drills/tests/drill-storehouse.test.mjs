/* The storehouse: a bank question for every outline item, and oracle seeds
 * that ask for his view. node --test. */
import test from "node:test";
import assert from "node:assert/strict";
import { BANK, TAGS } from "../web/bank.js";
import { BANK_MORE } from "../web/bank-more.js";
import { ITEMS } from "../web/outline.js";
import { SEEDS, nextSeed, openWithSeed } from "../web/seeds.js";
import { PASSAGES, keyLoad, nextPassage } from "../web/passages.js";
import { PASSAGES_MORE } from "../web/passages-more.js";
import { VARIANTS_MORE } from "../web/variants-more.js";

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

/* ---- passages written for his weak keys (passages-more.js) ------------- */

// Every work the new passages cite. As with CHECKED above, a new one is added
// here on purpose, after checking that the work exists.
const PASSAGE_WORKS = [
  "Hanley, Iwata & McCord (2003), JABA",
  "Hanley, Jin, Vanselow & Hanratty (2014), JABA",
  "Vollmer, Iwata, Zarcone, Smith & Mazaleski (1993), JABA",
  "Horner & Day (1991), JABA",
  "Lovaas (1987), Journal of Consulting and Clinical Psychology",
  "Fisher, Piazza, Bowman, Hagopian, Owens & Slevin (1992), JABA",
  "Rincover (1978), Journal of Abnormal Child Psychology",
  "Michael (1982), JEAB",
  "Rosales-Ruiz & Baer (1997), JABA",
  "Parsons, Rollyson & Reid (2012), Behavior Analysis in Practice",
  "Fisher, Kelley & Lomas (2003), JABA",
  "Lalli et al. (1999), JABA",
];
const TAKE_SOURCE = /^The drill's own position, drawing on (general practice knowledge|Taylor, LeBlanc & Nosik \(2019\), Behavior Analysis in Practice|Fong, Catagnus, Brodhead, Quigley & Field \(2016\), Behavior Analysis in Practice|Skinner \(1957\), Verbal Behavior, and Cooper, Heron & Heward \(2020\), ch\. Verbal Behavior|Cooper, Heron & Heward \(2020\), ch\. Measuring Behavior|general practice knowledge and the BACB Ethics Code for Behavior Analysts \(2020\)|the BACB Ethics Code for Behavior Analysts \(2020\), 1\.11 Multiple Relationships)$/;

test("at least 20 new passages, each long enough, plain ASCII, under a real outline item, with a checked source", () => {
  assert.ok(PASSAGES_MORE.length >= 20, `${PASSAGES_MORE.length} new passages`);
  assert.equal(PASSAGES.length, 16 + PASSAGES_MORE.length, "the first sixteen stay, and the new ones follow them");
  const ids = new Set(ITEMS.map((it) => it.id));
  for (const p of PASSAGES_MORE) {
    assert.ok(ids.has(p.outline), `${p.id} -> ${p.outline}`);
    assert.match(p.text + p.title + p.respond + p.source, /^[\x20-\x7e]+$/, `${p.id} is ASCII`);
    assert.doesNotMatch(p.text + p.respond, /--| - /, `${p.id} has a dash`);
    assert.ok(p.text.split(/\s+/).length >= 140, `${p.id} runs a couple of minutes`);
    if (p.kind === "study") assert.ok(PASSAGE_WORKS.includes(p.source), `${p.id} cites an unchecked work: ${p.source}`);
    else assert.match(p.source, TAKE_SOURCE, `${p.id} take source`);
    if (p.kind === "take") assert.match(p.text, /^Here is the position\./, `${p.id} says it is a position`);
  }
});

test("every new passage has a variant, and the set works w m b u c harder than the first sixteen", () => {
  for (const p of PASSAGES_MORE) assert.ok((VARIANTS_MORE[p.id] || []).length >= 1, `${p.id} has no variant`);
  for (const id of Object.keys(VARIANTS_MORE)) assert.ok(PASSAGES_MORE.some((p) => p.id === id), `variant for unknown ${id}`);
  const weak = ["w", "m", "b", "u", "c"];
  const mean = (list) => list.reduce((s, p) => s + keyLoad(p.text, weak), 0) / list.length;
  const core = PASSAGES.slice(0, 16);
  assert.ok(mean(PASSAGES_MORE) > mean(core), `new ${mean(PASSAGES_MORE).toFixed(4)} vs first ${mean(core).toFixed(4)}`);
});

test("a w m b u c player copying round after round rotates through a dozen passages, mostly the new ones", () => {
  // Before, the last three sat out, so an aimed player looped over the same
  // four heaviest passages for good. Now a third of them sit out.
  const recent = [];
  for (let i = 0; i < 12; i++) recent.push(nextPassage(recent, ["w", "m", "b", "u", "c"]).id);
  assert.equal(new Set(recent).size, 12, recent.join(" "));
  const fresh = recent.filter((id) => PASSAGES_MORE.some((p) => p.id === id)).length;
  assert.ok(fresh >= 8, `${fresh} of 12 are new passages`);
});

test("the punishment take names the chapter by its 3rd edition title", () => {
  const p = PASSAGES.find((x) => x.id === "p-punish");
  assert.match(p.source, /ch\. Positive Punishment$/);
});
