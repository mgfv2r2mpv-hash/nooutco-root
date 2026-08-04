import test from "node:test";
import assert from "node:assert/strict";

import { summarise, render, isSendHour, HUMAN } from "../src/weekly.js";

/* The two things most likely to go wrong here are the ones nobody would notice:
 * the email arriving an hour late for half the year, and a register number
 * being reported without the human band that makes it mean anything. Both are
 * pinned. */

const reg = (over = {}) => ({
  tool: "sap", type: "note_register", ts: 1,
  data: {
    sentences: 40, words: 800, meanLen: 20, burstiness: 0.7, openerVariety: 0.95,
    repeatRate: 0.02, actorRate: 0.2, clientRate: 0.18, topOpener: 2, score: 18, ...over,
  },
});
const gen = (tool = "sap") => ({ tool, type: "note_generated", ts: 1, data: { answered: 0 } });

test("Friday 20:00 New York is found in summer, when it is 00:00 UTC Saturday", () => {
  // 2026-08-08T00:00Z is Friday 2026-08-07 20:00 EDT.
  assert.equal(isSendHour(new Date("2026-08-08T00:00:00Z")), true);
  assert.equal(isSendHour(new Date("2026-08-08T01:00:00Z")), false);
});

test("Friday 20:00 New York is found in winter, when it is 01:00 UTC Saturday", () => {
  // 2026-01-10T01:00Z is Friday 2026-01-09 20:00 EST. This is the case a single
  // fixed UTC cron gets wrong for half the year.
  assert.equal(isSendHour(new Date("2026-01-10T01:00:00Z")), true);
  assert.equal(isSendHour(new Date("2026-01-10T00:00:00Z")), false);
});

test("no other day or hour triggers a send", () => {
  assert.equal(isSendHour(new Date("2026-08-07T00:00:00Z")), false); // Thursday 20:00
  assert.equal(isSendHour(new Date("2026-08-08T12:00:00Z")), false); // Saturday morning
});

test("a week with no notes says so rather than printing empty measures", () => {
  const s = summarise([]);
  assert.equal(s.notes, 0);
  const body = render(s, s, "2026-08-01");
  assert.match(body, /No notes were generated this week/);
  assert.doesNotMatch(body, /median score/);
});

test("register measures are always printed next to the human band", () => {
  const rows = [gen(), reg()];
  const body = render(summarise(rows), summarise([]), "2026-08-01");
  assert.match(body, /median score/);
  assert.match(body, new RegExp(`human ${HUMAN.score[0]} to ${HUMAN.score[1]}`));
  assert.match(body, /human 0.92 to 1/);
});

test("a note above the human ceiling is called out, not averaged away", () => {
  // One bad note among four good ones. A mean would hide it; this must not.
  const rows = [gen(), gen(), gen(), gen(), reg(), reg(), reg(), reg({ score: 47 })];
  const s = summarise(rows);
  assert.equal(s.register.outsideHumanBand, 1);
  assert.equal(s.register.worstScore, 47);
  const body = render(s, summarise([]), "2026-08-01");
  assert.match(body, /1 of 4 notes scored above the human ceiling/);
  assert.match(body, /Worst single note: 47/);
});

test("a healthy week reports ok and raises nothing", () => {
  const s = summarise([gen(), reg(), reg()]);
  const body = render(s, summarise([]), "2026-08-01");
  assert.doesNotMatch(body, /OUTSIDE HUMAN BAND/);
  assert.doesNotMatch(body, /scored above the human ceiling/);
});

test("gap questions mostly skipped is surfaced as a problem", () => {
  const rows = [
    gen(),
    { tool: "sap", type: "gap_questions", ts: 1, data: { asked: 10 } },
    { tool: "sap", type: "gap_questions", ts: 1, data: { skipped: 9 } },
  ];
  const body = render(summarise(rows), summarise([]), "2026-08-01");
  assert.match(body, /Most are being skipped/);
});

test("the trend compares against the prior four weeks and names the direction", () => {
  const now = summarise([gen(), reg({ score: 30 })]);
  const before = summarise([gen(), reg({ score: 15 })]);
  const body = render(now, before, "2026-08-01");
  assert.match(body, /vs prior 4wk, worse/);

  const improved = render(before, now, "2026-08-01");
  assert.match(improved, /vs prior 4wk, better/);
});

test("counts split by tool so a regression can be attributed", () => {
  const s = summarise([gen("sap"), gen("sap"), gen("bt")]);
  assert.equal(s.notes, 3);
  assert.equal(s.byTool.sap, 2);
  assert.equal(s.byTool.bt, 1);
});

test("the median is used for score, so one outlier cannot set the headline", () => {
  const s = summarise([gen(), reg({ score: 12 }), reg({ score: 14 }), reg({ score: 90 })]);
  assert.equal(s.register.score, 14);
  assert.equal(s.register.worstScore, 90);
});
