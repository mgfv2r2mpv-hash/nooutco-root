/* The baton pass: the expert's reply made typable, sized and checked. node --test. */
import test from "node:test";
import assert from "node:assert/strict";
import { BATON_SYSTEM, BATON_SCHEMA, batonPrompt, readBaton, batonWords, relevantRecords, typable, trimToWords } from "../web/oracle.js";

test("the baton instructions ask for gentle push back, typable text and real sources", () => {
  assert.match(BATON_SYSTEM, /gently name one or two things he has not considered/);
  assert.match(BATON_SYSTEM, /Never invent a citation/);
  assert.match(BATON_SYSTEM, /spaced hyphen instead of any dash/);
  assert.deepEqual(BATON_SCHEMA.required, ["stance", "title", "passage", "sources", "respond"]);
});

test("typable turns curly quotes, dashes and ellipses into keys he has, and drops the rest", () => {
  assert.equal(typable("It\u2019s \u201Cfine\u201D \u2014 really\u2026 caf\u00E9 \u2192 ok"), "It's \"fine\" - really... cafe ok");
  assert.equal(typable("one\n\n\n two"), "one\n\ntwo");
});

test("a long reply is cut near a sentence end", () => {
  assert.equal(trimToWords("One two three. Four five six seven. Eight nine ten.", 7), "One two three. Four five six seven.");
  assert.equal(trimToWords("short", 7), "short");
});

test("the passage is sized to his copy speed at this clock, held between 40 and 350 words", () => {
  const h = [60, 70, 80].map((g) => ({ mode: "copy", minutes: 2, gwam: g }));
  assert.equal(batonWords(h, 2), 140);
  assert.equal(batonWords([], 1), 50);
  assert.equal(batonWords([{ mode: "copy", minutes: 5, gwam: 100 }], 5), 350);
  assert.equal(batonWords([{ mode: "respond", minutes: 1, gwam: 20 }], 1), 50);
});

test("only the expert's records that share terms with his answer ride along, best first", () => {
  const recs = [
    { title: "Momentum before the hard ask", rule: "High-probability requests build behavioral momentum.", topic: "behavioral-momentum" },
    { title: "Graph scaling", rule: "Keep the y axis honest.", topic: "graphs" },
    { title: "Extinction burst", rule: "Expect a burst when reinforcement stops for problem behavior.", keywords: ["extinction", "burst"] },
  ];
  const out = relevantRecords(recs, "The high-probability requests build momentum before the demand", 6);
  assert.deepEqual(out.map((r) => r.title), ["Momentum before the hard ask"]);
  assert.deepEqual(relevantRecords(null, "x"), []);
});

test("the prompt carries the passage, his answer, the records, the size and the weak keys", () => {
  const p = batonPrompt({ passage: { title: "Momentum", text: "High-p first." }, question: "Why?", answer: "Because.", records: [{ title: "R", rule: "Do it." }], words: 90, weak: ["w", "m"], turn: 2 });
  assert.match(p, /Baton pass 2/);
  assert.match(p, /High-p first/);
  assert.match(p, /His answer, in his own words: Because\./);
  assert.match(p, /- R: Do it\./);
  assert.match(p, /about 90 words/);
  assert.match(p, /w m/);
  assert.match(batonPrompt({ answer: "x" }), /holds no records on this yet/);
});

test("a reply becomes a passage only with enough words and a next question", () => {
  const long = "You are right that the sequence matters, and the research adds a second point worth weighing on reinforcement rate.";
  const r = readBaton({ stance: "agrees and adds", title: "Rate \u2014 not order", passage: long, sources: [{ claim: "Rate drives persistence", source: "Nevin (1992)" }, { claim: "" }], respond: "What would you change?" }, 100);
  assert.equal(r.title, "Rate - not order");
  assert.equal(r.sources.length, 1);
  assert.equal(r.respond, "What would you change?");
  assert.equal(readBaton({ passage: "Too short.", respond: "Q?" }), null);
  assert.equal(readBaton({ passage: long, respond: "" }), null);
  assert.equal(readBaton(null), null);
});
