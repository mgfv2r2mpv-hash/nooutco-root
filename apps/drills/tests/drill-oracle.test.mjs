/* The oracle's prompts and the proposal checks, by hand. node --test. */
import test from "node:test";
import assert from "node:assert/strict";
import { ORACLE_SYSTEM, oraclePrompt, readOracle, DRAFT_SYSTEM, toProposal, sharesRun, slugify, BODY, SCOPE } from "../web/oracle.js";

test("the oracle's instructions forbid invented citations, em dashes and client particulars", () => {
  assert.match(ORACLE_SYSTEM, /Never invent a citation/);
  assert.match(ORACLE_SYSTEM, /general practice knowledge/);
  assert.match(ORACLE_SYSTEM, /No em dashes/);
  assert.match(ORACLE_SYSTEM, /No client names/);
  assert.ok(!/\u2014/.test(ORACLE_SYSTEM + DRAFT_SYSTEM), "no em dash in the prompts themselves");
  assert.match(DRAFT_SYSTEM, /Never quote his answer/);
});

test("a follow-up prompt carries every turn, his answers included", () => {
  const first = oraclePrompt({ topic: "Behavioral momentum", outline: "B.22" });
  assert.match(first, /Topic: Behavioral momentum \(BACB outline B\.22\)/);
  assert.match(first, /first turn/);
  const next = oraclePrompt({ topic: "Behavioral momentum", turns: [{ question: "Why high-p first?", answer: "It builds a run of reinforced compliance" }] });
  assert.match(next, /You asked: Why high-p first\?/);
  assert.match(next, /He answered: It builds a run of reinforced compliance/);
  assert.match(next, /reflection on his last answer/);
});

test("an oracle reply is read only with a question and at least one thought; a missing source says so plainly", () => {
  assert.equal(readOracle(null), null);
  assert.equal(readOracle({ question: "", thoughts: [{ text: "x", source: "y" }] }), null);
  assert.equal(readOracle({ question: "Q?", thoughts: [] }), null);
  const r = readOracle({ question: " Q? ", thoughts: [{ text: "a", source: "" }, { text: "b", source: "Nevin (1992)" }, { text: "c", source: "s" }, { text: "d", source: "s" }] });
  assert.equal(r.question, "Q?");
  assert.equal(r.thoughts.length, 3);
  assert.equal(r.thoughts[0].source, "general practice knowledge");
});

test("a draft becomes a topic proposal the store accepts, and the answer itself never travels", () => {
  const entry = { at: "2026-09-23T15:00:00Z", question: "Q", answer: "my own words about momentum", outline: "B.22", mode: "oracle", register: "spoken",
    oracle: { thoughts: [{ text: "t", source: "Nevin (1992)" }] } };
  const p = toProposal({ title: "High-p before low-p", rule: "Deliver the low-p request right after the high-p run.", applies: "when a note describes a high-p sequence",
    rationale: "Momentum fades with a gap.", topic: "Behavioral Momentum!", keywords: ["Momentum", "high-p", "momentum"] }, entry);
  assert.ok(p.record, p.error);
  assert.equal(p.record.tier, "topic");
  assert.equal(p.record.scope, SCOPE);
  assert.equal(p.record.body, BODY);
  assert.equal(p.record.topic, "behavioral-momentum");
  assert.deepEqual(p.record.keywords, ["momentum", "high-p"]);
  assert.deepEqual(p.record.provenance.sources, ["Nevin (1992)"]);
  assert.equal(p.record.provenance.register, "spoken");
  assert.ok(!JSON.stringify(p.record).includes(entry.answer), "the answer is not in the proposal");
});

test("a draft that quotes eight words of his answer is dropped before it can be proposed", () => {
  const answer = "I always pair the break card with a visual timer so the kid can see when it ends";
  assert.equal(sharesRun("pair the break card with a visual timer so the kid", answer), true);
  assert.equal(sharesRun("pair a break card with a timer", answer), false);
  const p = toProposal({ title: "Breaks", rule: "Staff should pair the break card with a visual timer so the kid can see it.", applies: "when breaks are requested", topic: "breaks" }, { answer });
  assert.equal(p.error, "quotes the answer (a run of eight words or more)");
});

test("the store's own limits are checked here: title, rule, applies and a slug topic", () => {
  const ok = { title: "T", rule: "R", applies: "A", topic: "t" };
  assert.ok(toProposal(ok, {}).record);
  assert.match(toProposal({ ...ok, title: "x".repeat(121) }, {}).error, /title/);
  assert.match(toProposal({ ...ok, applies: "" }, {}).error, /applies/);
  assert.match(toProposal({ ...ok, topic: "!!!" }, {}).error, /slug/);
  assert.equal(slugify("  Prompt Fading: most-to-least "), "prompt-fading-most-to-least");
});

test("the eight-word guard covers the topic slug and the keywords too, not only the prose fields", () => {
  const answer = "I always fade the prompt within three sessions when the learner responds independently";
  const ok = { title: "Prompt fading", rule: "Fade on a schedule set in advance.", applies: "when prompts are faded" };
  const viaTopic = toProposal({ ...ok, topic: "i always fade the prompt within three sessions when the" }, { answer });
  assert.equal(viaTopic.error, "quotes the answer (a run of eight words or more)");
  const viaKeywords = toProposal({ ...ok, topic: "prompt-fading", keywords: ["i always fade the prompt", "within three sessions when"] }, { answer });
  assert.equal(viaKeywords.error, "quotes the answer (a run of eight words or more)");
  assert.ok(toProposal({ ...ok, topic: "prompt-fading", keywords: ["prompt fading", "schedule"] }, { answer }).record);
});
