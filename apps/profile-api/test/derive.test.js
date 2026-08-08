import test from "node:test";
import assert from "node:assert/strict";

import { deriveRules, renderStyleBlock, cardRows } from "../src/derive.js";
import { FEATURES, MIN_EVIDENCE, MIN_CONFIDENCE, MAX_RULES } from "../src/features.js";

// A fixed clock, so recency weighting is deterministic and these never go flaky
// at a month boundary.
const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const ev = (feature, direction, opts = {}) => ({
  feature,
  direction,
  magnitude: opts.magnitude ?? 1,
  ts: opts.ts ?? NOW,
});

const many = (n, feature, direction, opts) =>
  Array.from({ length: n }, () => ev(feature, direction, opts));

test("a signal below the evidence bar produces no rule", () => {
  const rules = deriveRules(many(MIN_EVIDENCE - 1, "sentence_length", -1), NOW);
  assert.deepEqual(rules, []);
});

test("a consistent signal at the evidence bar produces the matching rule", () => {
  const rules = deriveRules(many(MIN_EVIDENCE, "sentence_length", -1), NOW);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].feature, "sentence_length");
  assert.equal(rules[0].direction, -1);
  assert.equal(rules[0].evidence, MIN_EVIDENCE);
  assert.equal(rules[0].confidence, 1);
  // The rule text is the template verbatim -- it is injected into a prompt, so
  // a drift here changes generated prose.
  assert.equal(rules[0].rule, FEATURES.sentence_length["-1"]);
});

test("a divided signal produces no rule however much evidence there is", () => {
  // 6 vs 4 is 0.6 agreement, under the 0.7 bar, on 10 events.
  const rules = deriveRules(
    [...many(6, "plain_wording", -1), ...many(4, "plain_wording", 1)],
    NOW,
  );
  assert.deepEqual(rules, []);

  // Sanity: the same count one-sided does clear it, so the bar is what rejected
  // the case above rather than some unrelated guard.
  const oneSided = deriveRules(many(10, "plain_wording", -1), NOW);
  assert.equal(oneSided.length, 1);
});

test("confidence is reported, and sits at the boundary it claims", () => {
  // 7 vs 3 == 0.7 exactly, which the >= comparison must accept.
  const rules = deriveRules(
    [...many(7, "hedging", -1), ...many(3, "hedging", 1)],
    NOW,
  );
  assert.equal(rules.length, 1);
  assert.equal(rules[0].confidence, MIN_CONFIDENCE);
  assert.equal(rules[0].direction, -1);
});

test("recent corrections outweigh old ones, so a changed style is followed", () => {
  // Ten corrections a year ago pulling one way; six from today pulling back.
  // At a 90-day half-life the old ones retain ~6% weight each, so today wins.
  const rules = deriveRules(
    [
      ...many(10, "actor_naming", -1, { ts: NOW - 365 * DAY }),
      ...many(6, "actor_naming", 1, { ts: NOW }),
    ],
    NOW,
  );
  assert.equal(rules.length, 1);
  assert.equal(rules[0].direction, 1, "the recent direction should win");
  // Evidence stays a raw count of everything seen, undecayed.
  assert.equal(rules[0].evidence, 16);
});

test("magnitude weights the pull without being able to invent evidence", () => {
  // Five decisive edits one way vs five barely-there edits the other.
  const rules = deriveRules(
    [
      ...many(5, "clause_density", 1, { magnitude: 1 }),
      ...many(5, "clause_density", -1, { magnitude: 0.05 }),
    ],
    NOW,
  );
  assert.equal(rules.length, 1);
  assert.equal(rules[0].direction, 1);

  // But magnitude alone cannot clear the evidence bar: one emphatic edit is
  // still one edit.
  assert.deepEqual(deriveRules([ev("clause_density", 1, { magnitude: 1 })], NOW), []);
});

test("unknown features and zero directions are ignored entirely", () => {
  const rules = deriveRules(
    [
      ...many(8, "not_a_real_feature", 1),
      ...many(8, "sentence_length", 0),
      ...many(8, "__proto__", 1),
    ],
    NOW,
  );
  assert.deepEqual(rules, []);
});

test("a non-finite or missing magnitude is treated as full weight, not NaN", () => {
  const rules = deriveRules(
    Array.from({ length: 6 }, () => ({ feature: "contractions", direction: 1, ts: NOW })),
    NOW,
  );
  assert.equal(rules.length, 1);
  assert.equal(rules[0].confidence, 1);
  assert.ok(Number.isFinite(rules[0].confidence));
});

test("rules come back strongest first", () => {
  const rules = deriveRules(
    [
      // Weak but qualifying: 5 events, 0.8 agreement.
      ...many(4, "contractions", 1),
      ...many(1, "contractions", -1),
      // Strong: 20 events, unanimous.
      ...many(20, "sentence_length", -1),
    ],
    NOW,
  );
  assert.equal(rules.length, 2);
  assert.equal(rules[0].feature, "sentence_length");
  assert.equal(rules[1].feature, "contractions");
});

test("empty input is safe", () => {
  assert.deepEqual(deriveRules([], NOW), []);
  assert.deepEqual(deriveRules(null, NOW), []);
  assert.deepEqual(deriveRules(undefined, NOW), []);
});

test("renderStyleBlock returns nothing when there is nothing learned", () => {
  // This is what makes the whole feature fail-open: no card, no injection, and
  // the prompt is byte-identical to the one that shipped without any of this.
  assert.equal(renderStyleBlock([]), "");
  assert.equal(renderStyleBlock(null), "");
});

test("a fully muted card injects nothing", () => {
  const rules = deriveRules(many(9, "sentence_length", -1), NOW).map((r) => ({ ...r, muted: true }));
  assert.equal(renderStyleBlock(rules), "");
});

test("a muted rule is dropped while its siblings survive", () => {
  const rules = [
    ...deriveRules(many(9, "sentence_length", -1), NOW),
    ...deriveRules(many(9, "hedging", -1), NOW).map((r) => ({ ...r, muted: true })),
  ];
  const block = renderStyleBlock(rules);
  assert.ok(block.includes(FEATURES.sentence_length["-1"]));
  assert.ok(!block.includes(FEATURES.hedging["-1"]));
});

test("the injected block subordinates learned style to the house rules", () => {
  const block = renderStyleBlock(deriveRules(many(9, "plain_wording", -1), NOW));
  // If this instruction is ever lost, a learned style could start overriding a
  // clinical documentation requirement.
  assert.match(block, /the rules above win/i);
  // And it must not tell the model to announce what it is doing.
  assert.match(block, /Never mention this section/i);
});

test("the injected block is capped, so a prompt cannot grow without bound", () => {
  const rules = Object.keys(FEATURES).map((feature, i) => ({
    feature,
    direction: 1,
    rule: `RULE_${i}`,
    evidence: 10,
    confidence: 1,
  }));
  assert.ok(rules.length > MAX_RULES, "fixture must exceed the cap to test it");

  const block = renderStyleBlock(rules);
  const listed = block.split("\n").filter((l) => l.startsWith("- "));
  assert.equal(listed.length, MAX_RULES);
});

test("cardRows carries only the columns the schema declares", () => {
  const rules = deriveRules(many(6, "quantification", 1), NOW);
  const rows = cardRows("pw:abc-123", "clinical-narrative", rules, NOW);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), [
    "confidence",
    "direction",
    "evidence",
    "feature",
    "kid",
    "register",
    "rule",
    "updated_at",
  ]);
  assert.equal(rows[0].kid, "pw:abc-123");
  assert.equal(rows[0].register, "clinical-narrative");
  assert.equal(rows[0].updated_at, NOW);
});

test("opener_variety derives a rule in each direction", () => {
  const up = deriveRules(many(MIN_EVIDENCE, "opener_variety", 1), NOW);
  assert.equal(up.length, 1);
  assert.equal(up[0].direction, 1);
  assert.equal(up[0].rule, FEATURES.opener_variety["1"]);

  const down = deriveRules(many(MIN_EVIDENCE, "opener_variety", -1), NOW);
  assert.equal(down.length, 1);
  assert.equal(down[0].direction, -1);
  assert.equal(down[0].rule, FEATURES.opener_variety["-1"]);

  assert.notEqual(up[0].rule, down[0].rule);
});

test("the two opener_variety rules are not swapped", () => {
  // The browser emits +1 when the technician pushed openings apart. If the two
  // strings were transposed here, every assertion above would still pass and
  // the prompt would be told the exact opposite of the person's habit. These
  // anchors are load-bearing: reword the rules and move the anchor with them.
  assert.match(FEATURES.opener_variety["1"], /^Vary where each sentence enters\./);
  assert.match(FEATURES.opener_variety["-1"], /^Do not manufacture a fresh opening\./);
  assert.doesNotMatch(FEATURES.opener_variety["-1"], /\bvary\b/i);
});

test("an opener_variety rule reaches the injected block", () => {
  const block = renderStyleBlock(deriveRules(many(6, "opener_variety", 1), NOW));
  assert.ok(block.includes(FEATURES.opener_variety["1"]));

  const muted = renderStyleBlock(deriveRules(many(6, "opener_variety", -1), NOW));
  assert.ok(muted.includes(FEATURES.opener_variety["-1"]));
});

test("every feature has rule text in both directions", () => {
  // A missing template would silently drop a learned signal on the floor:
  // deriveRules skips a feature whose ruleText() comes back null.
  for (const [name, spec] of Object.entries(FEATURES)) {
    assert.equal(typeof spec["1"], "string", `${name} is missing a +1 rule`);
    assert.equal(typeof spec["-1"], "string", `${name} is missing a -1 rule`);
    assert.ok(spec["1"].length > 20, `${name} +1 rule is too terse to be an instruction`);
    assert.ok(spec["-1"].length > 20, `${name} -1 rule is too terse to be an instruction`);
  }
});
