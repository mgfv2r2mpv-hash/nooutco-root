import test from "node:test";
import assert from "node:assert/strict";

import { summarise, render, isSendHour, HUMAN } from "../src/weekly.js";

/* The two things most likely to go wrong here are the ones nobody would notice:
 * the email arriving an hour late for half the year, and a register number
 * being reported without the human band that makes it mean anything. Both are
 * pinned. */

/* Every value here sits INSIDE its human band on purpose, so any test that
   asserts a flag is asserting about the override it passed rather than about
   the fixture. actorRate moved from 0.2 to 0.05 when that measure gained a band
   of 0 to 0.12; a default that quietly sits outside a band makes "a healthy
   week" mean nothing. */
const reg = (over = {}) => ({
  tool: "sap", type: "note_register", ts: 1,
  data: {
    sentences: 40, words: 800, meanLen: 20, burstiness: 0.7, openerVariety: 0.95,
    sectionCv: 0.46, sectionStep: 0.30,
    repeatRate: 0.02, actorRate: 0.05, clientRate: 0.18, imperativeRate: 0.12,
    topOpener: 2, flaggedPer100: 0,
    emptyAdverbs: 0, participialCausals: 0, abstractStates: 0, vagueVerbs: 0,
    score: 18, ...over,
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
  assert.match(body, /inside a section/);
  assert.match(body, /between sections/);
});

test("the week where burstiness looks fine and every section reads flat is caught", () => {
  /* THE CASE THIS REPORT WAS MISSING, and the reason the section measures were
     added before the first Friday send rather than after it.

     burstiness sits at 0.70, comfortably inside its human band of 0.55 to 0.82.
     It gets there entirely by swinging the average from one section to the
     next: 0.28 inside a section, well under the human floor of 0.383, and 0.62
     between them, well over the human ceiling of 0.434. Reporting the mixture
     alone would call this week healthy. */
  const flat = [gen(), gen(), reg({ burstiness: 0.70, sectionCv: 0.28, sectionStep: 0.62 })];
  const body = render(summarise(flat), summarise([]), "2026-08-01");

  assert.match(body, /burstiness\s+0\.70.*ok/, "the mixed number really does look healthy");
  assert.match(body, /inside a section\s+0\.28.*OUTSIDE HUMAN BAND/);
  assert.match(body, /between sections\s+0\.62.*OUTSIDE HUMAN BAND/);
  assert.match(body, /Sections are reading flat inside themselves/);
});

test("a measure that leaves the band upward reads as worse, not as an improvement", () => {
  /* The bug this pins was found by reading a rendered email rather than by
     reasoning: "between sections" went from 0.30, comfortably inside the band,
     to 0.62, well above its ceiling, and the report called it BETTER, because
     the number had gone up and up was the declared good direction.

     Every measure here is a band with two bad ends. Direction cannot judge
     that, and getting it wrong announces the exact failure the measure exists
     to catch as progress. */
  const worse = render(
    summarise([gen(), reg({ sectionStep: 0.62 })]),
    summarise([gen(), reg({ sectionStep: 0.30 })]),
    "2026-08-01");
  assert.match(worse, /between sections\s+0\.62.*OUTSIDE HUMAN BAND\s+\(\+0\.32 vs prior 4wk, worse\)/);

  // And the reverse, so the fix is not simply "always say worse".
  const better = render(
    summarise([gen(), reg({ sectionStep: 0.30 })]),
    summarise([gen(), reg({ sectionStep: 0.62 })]),
    "2026-08-01");
  assert.match(better, /between sections\s+0\.30.*ok\s+\(-0\.32 vs prior 4wk, better\)/);
});

test("two weeks that both sit inside the band are not ranked against each other", () => {
  // 0.40 and 0.50 are both ordinary human values for variability inside a
  // section. Calling one an improvement over the other reads as a signal where
  // there is only noise.
  const body = render(
    summarise([gen(), reg({ sectionCv: 0.50 })]),
    summarise([gen(), reg({ sectionCv: 0.40 })]),
    "2026-08-01");
  assert.match(body, /inside a section\s+0\.50.*ok\s+\(\+0\.10 vs prior 4wk, both in band\)/);
});

test("a week of notes too short to measure sections says so rather than reporting zero", () => {
  // note-metrics.js omits the two keys when no section had enough sentences.
  // Averaging a missing measure as zero would print a flat-sections alarm on a
  // week where nothing was measured at all.
  const short = [gen(), reg({ sectionCv: undefined, sectionStep: undefined })];
  const s = summarise(short);
  assert.equal(s.register.sectionCv, null);
  assert.equal(s.register.sectionStep, null);

  const body = render(s, summarise([]), "2026-08-01");
  assert.match(body, /inside a section\s+n\/a/);
  assert.doesNotMatch(body, /Sections are reading flat/);
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
  assert.doesNotMatch(body, /Actor naming is above the human band/);
  assert.match(body, /None of the four banned constructions appeared/);
});

test("the register remediation is trended, not assumed", () => {
  /* The four constructions have been counted in the browser since the bans
     shipped and the counts never left it, so this email could not have told
     him whether the change that took a real note from 53% to 0% was holding.
     Density for the trend, and the four separately so a return can be
     attributed to which one rather than only noticed. */
  const s = summarise([gen(), reg(), reg({ vagueVerbs: 3, emptyAdverbs: 1, flaggedPer100: 0.5 })]);
  const body = render(s, summarise([gen(), reg()]), "2026-08-01");

  assert.match(body, /flagged per 100 wd\s+0\.25/);
  assert.match(body, /Which construction fired/);
  assert.match(body, /vagueVerbs\s+3/);
  assert.match(body, /emptyAdverbs\s+1/);
  // Ordered worst first, so the lead is the first line rather than an alphabet.
  assert.ok(body.indexOf("vagueVerbs") < body.indexOf("emptyAdverbs"));
  assert.doesNotMatch(body, /abstractStates/, "a construction that never fired is noise");
});

test("a construction returning after a clean week is not reported as flat", () => {
  /* The trend used to go silent whenever the PRIOR value was exactly zero, and
     zero is the good value for this measure. So the single most reportable
     thing the register block can say, "these were gone last week and they are
     back", was the one case with no arrow on it. */
  const body = render(
    summarise([gen(), reg({ flaggedPer100: 0.5, vagueVerbs: 3 })]),
    summarise([gen(), reg({ flaggedPer100: 0 })]),
    "2026-08-01");
  assert.match(body, /flagged per 100 wd\s+0\.50.*\(\+0\.50 vs prior 4wk/);
});

test("actor naming above the band is raised as an open question, not as a fault", () => {
  /* The register work deliberately pushed actor naming up, because the flagged
     sections were the actorless ones, and the seven human plans sit at a median
     of 0.03 while both archived generated SAPs sit above 0.32. Which of those is
     right is not settled, so the email must not assert that it is. */
  const body = render(
    summarise([gen(), reg({ actorRate: 0.33 })]), summarise([]), "2026-08-01");
  assert.match(body, /actor named\s+0\.33.*OUTSIDE HUMAN BAND/);
  assert.match(body, /OPEN QUESTION/);
  assert.match(body, /may have\n\s+overshot/);
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
