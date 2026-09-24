/* Item 6 of OVERNIGHT.md: the kept entry carries the research that was in
   front of him and a stance read locally, and the drafting prompt uses both
   to propose consensus and dissent records, never quoting him. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { researchContext, toneOf, stanceFrom } from "../web/stance.js";
import { DRAFT_SYSTEM, DRAFT_SCHEMA, KINDS, draftPrompt, toProposal } from "../web/oracle.js";
import { PASSAGES } from "../web/passages.js";
import { BANK } from "../web/bank.js";

const ok = { title: "Rate builds persistence", rule: "Reinforcement rate during the high-p run sets how persistent compliance is.", applies: "when a note describes high-p requests", topic: "behavioral-momentum" };

test("tone counts hedges, boosters, first person and questions, locally", () => {
  const t = toneOf("I think it might depend on the kid. It always depends on the function? Maybe (?)");
  assert.equal(t.hedges, 5, "i think, might, depends on, maybe, (?)");
  assert.equal(t.boosters, 1);
  assert.equal(t.firstPerson, 1);
  assert.equal(t.questions, 1, "a bare (?) is a hedge, not a question");
  assert.equal(t.sentences, 3);
  assert.equal(t.words, 15);
});

test("stance reads pushback and agreement markers, and says unclear when there are none", () => {
  assert.equal(toneOf("I agree, and that matches what I see in clinic.").stance, "agrees");
  assert.equal(toneOf("I'm not convinced. The study overstates it, however you read it.").stance, "pushes back");
  assert.equal(toneOf("I agree with the order, however the rate is what matters.").stance, "mixed");
  assert.equal(toneOf("Pair the break card with a timer.").stance, "unclear");
  assert.equal(toneOf("I don\u2019t buy it").stance, "pushes back", "a curly apostrophe reads like a straight one");
  assert.equal(stanceFrom(4, 1), "pushes back");
  assert.equal(stanceFrom(1, 3), "agrees");
});

test("research context: bank bullets, a passage and its source, baton claims, oracle thoughts without the reflection", () => {
  const item = BANK[0];
  const bank = researchContext({ mode: "answer", item });
  assert.equal(bank.kind, "bank");
  assert.deepEqual(bank.claims.map((c) => c.source), item.bullets.map((b) => b.source));

  const p = PASSAGES[0];
  const pass = researchContext({ mode: "respond", item: { bullets: [] }, passage: p });
  assert.equal(pass.kind, "passage");
  assert.equal(pass.passage, p.id);
  assert.deepEqual(pass.sources, [p.source]);
  assert.ok(pass.claims[0].text.startsWith(p.title));
  assert.ok(pass.claims[0].text.length <= 300);

  const baton = researchContext({ mode: "respond", passage: { id: "baton-1", kind: "baton", title: "t", text: "x", sources: [{ claim: "Rate drives persistence", source: "Nevin (1992)" }] } });
  assert.deepEqual(baton.claims, [{ text: "Rate drives persistence", source: "Nevin (1992)" }]);
  assert.equal(baton.kind, "baton");

  const oracle = { seed: "s-hours", reply: { reflection: "You said the kid matters.", thoughts: [{ text: "Dose studies disagree.", source: "" }] } };
  const o = researchContext({ mode: "oracle", item: { bullets: [{ text: "You said the kid matters.", source: "the oracle" }] }, oracle });
  assert.equal(o.kind, "seed");
  assert.equal(o.seed, "s-hours");
  assert.deepEqual(o.claims, [{ text: "Dose studies disagree.", source: "general practice knowledge" }]);
  assert.ok(!JSON.stringify(o).includes("kid matters"), "the reflection paraphrases him and is left out");

  const lens = researchContext({ mode: "answer", item: { ...item, lens: "steelman" } });
  assert.equal(lens.lens, "steelman");
  assert.equal(researchContext({ mode: "answer", item: { bullets: [] } }), null);
});

test("the drafting prompt carries the question, the lens, the research and only the stance label", () => {
  const entry = {
    question: "Why does the high-p sequence work?", outline: "G.9", lens: "steelman", answer: "I am not convinced order matters as much as rate.",
    research: { kind: "baton", claims: [{ text: "Rate drives persistence", source: "Nevin (1992)" }], sources: ["Nevin (1992)"] },
    tone: { stance: "pushes back", hedges: 7, boosters: 3 },
  };
  const p = draftPrompt(entry);
  assert.match(p, /Question: Why does the high-p/);
  assert.match(p, /"steelman" lens/);
  assert.match(p, /- Rate drives persistence \(Nevin \(1992\)\)/);
  assert.match(p, /Stance markers in his answer: pushes back\./);
  assert.ok(!/hedges|boosters|\b7\b/.test(p), "the tone counts stay in the sidecar");
  const bare = draftPrompt({ question: "Q", answer: "A", tone: { stance: "agrees" } });
  assert.ok(!/research|Stance/.test(bare), "no research, no stance line");
});

test("DRAFT_SYSTEM asks for consensus and dissent, bans invented citations, keeps the never-quote rule", () => {
  assert.match(DRAFT_SYSTEM, /consensus/);
  assert.match(DRAFT_SYSTEM, /dissent/);
  assert.match(DRAFT_SYSTEM, /never invent a citation/);
  assert.match(DRAFT_SYSTEM, /Never quote his answer/);
  assert.deepEqual(DRAFT_SCHEMA.properties.records.items.properties.kind.enum, [...KINDS]);
  assert.ok(!/[\u2013\u2014]/.test(DRAFT_SYSTEM));
});

test("a dissent record keeps its kind as a keyword and names the research sources; without research it is practice", () => {
  const entry = { answer: "rate matters more than order to me", research: { claims: [{ text: "c", source: "Nevin (1992)" }], sources: ["Nevin (1992)"] } };
  const p = toProposal({ ...ok, kind: "dissent", keywords: ["momentum"] }, entry);
  assert.deepEqual(p.record.keywords, ["dissent", "momentum"]);
  assert.deepEqual(p.record.provenance.sources, ["Nevin (1992)"]);
  const bare = toProposal({ ...ok, kind: "dissent" }, { answer: "x" });
  assert.equal(bare.record.keywords, undefined, "no research: the kind falls back to practice and adds nothing");
  const odd = toProposal({ ...ok, kind: "gossip" }, entry);
  assert.equal(odd.record.keywords, undefined, "an unknown kind is practice");
});

test("the eight-word guard still drops a record that quotes him, research or not", () => {
  const answer = "the high p run builds reinforced compliance before the hard ask every time";
  const entry = { answer, research: { claims: [{ text: "c", source: "s" }], sources: ["s"] } };
  const p = toProposal({ ...ok, kind: "consensus", rule: `As he said, ${answer}.` }, entry);
  assert.match(p.error, /quotes the answer/);
});

test("an overlapping phrase counts once", () => {
  assert.equal(toneOf("It depends on the kid.").hedges, 1, "it depends on, not it depends plus depends on");
  assert.equal(toneOf("I agree.").agree, 1);
});
