import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/* CARD assess-note-accuracy, from Kaleb's Assessment bench run, 2026-10-10.
 *
 * The prompt rules are pinned in the user prompt the browser sends (the served
 * system prompt is pinned by hash in voice-module and is not touched). The
 * checks in assess-checks.js and assess-counts.js are pinned on the bench's
 * own intakes (scripts/bench/cases/assess.json): each bad draft below is the
 * error he saw, and each corrected draft must raise no hint. Every check only
 * adds a hint; none changes a pick or a sentence. Everything but the last test
 * runs the real files in a bare vm: no server, no model call. */

const ROOT = join(__dirname, '..', 'notes/bcba');
const CASES = JSON.parse(readFileSync(join(__dirname, '..', 'scripts/bench/cases/assess.json'), 'utf8')).cases;
const INTAKE = Object.fromEntries(CASES.map((c) => [c.id, c.fields['Summary Notes']]));

function load({ withChecks = true, log = console } = {}) {
  const win = {};
  const ctx = vm.createContext({ window: win, console: log });
  const files = ['note-tools-util.js', 'register-rules.js']
    .concat(withChecks ? ['tools/assess-counts.js', 'tools/assess-checks.js'] : [], ['tools/assess.js']);
  for (const f of files) {
    vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  return win.NOTE_TOOLS.find((t) => t.id === 'assess');
}

const assess = load();

const draft = (fields) => ({ activities: [], reporting: [], narrative: '', results: '', hints: [], ...fields });
const run = (caseId, fields) => assess.normalizeOutput(draft(fields), { intake: INTAKE[caseId] });
const details = (out) => out.hints.map((h) => h.section + ': ' + h.detail);

const FBA = 'assess-fba-observation-hypothesis';
const REVIEW = 'assess-results-review-with-parents';
const REPORT = 'assess-report-writing-no-client';
const VBMAPP = 'assess-vbmapp-and-interview';
const RECORDS = 'assess-records-review-answer-overturns';

// ── The drafts. Each bad one carries the error from his bench run. ─────────

const FBA_NARRATIVE = "BCBA conducted a Functional Behavior Assessment at school, observing the client for 2 hours in the classroom and at recess and collecting ABC data on hitting. BCBA reviewed the teacher's scatterplot from the past 2 weeks and interviewed the teacher for 20 minutes.";
const FBA_REST = 'Hits were open-handed to the upper arm with no injuries. Most hits were followed by the teacher removing the demand, which suggests escape in the classroom, and the recess episodes are consistent with access to a tangible. The scatterplot showed most hits between 9 and 10 am during worksheets. The teacher reported hitting is worse on Mondays.';
const FBA_COUNT = 'BCBA recorded 7 episodes of hitting. Five followed a teacher instruction to clean up or line up, and two occurred at recess when a peer took a ball.';
const FBA_PICKS = ['Functional Behavior Assessment', 'Client Observation'];
const FBA_BAD_TWO = { activities: FBA_PICKS, narrative: FBA_NARRATIVE, results: `${FBA_COUNT} Two hits had unclear antecedents. ${FBA_REST}` };
const FBA_BAD_REMAINING = { activities: FBA_PICKS, narrative: FBA_NARRATIVE, results: `${FBA_COUNT} The remaining episodes had unclear antecedents. ${FBA_REST}` };
const FBA_GOOD = { activities: FBA_PICKS, narrative: FBA_NARRATIVE, results: `${FBA_COUNT} ${FBA_REST} BCBA did not conduct a Functional Analysis, and more data are needed before a function is named.` };

const REVIEW_NARRATIVE = 'BCBA met with both parents for 1 hour to review the reassessment results. BCBA walked through 5 proposed goals and the 2 biggest barriers, prompt dependence and impaired mand, and explained why the mand goals come first.';
const REVIEW_OPEN = 'The VB-MAPP showed Level 1 now complete and Level 2 about half complete, up from Level 1 only at intake. Parents agreed to start toilet training once sitting tolerance reaches 2 minutes.';
const REVIEW_BAD = { activities: ['Review results with parent'], narrative: REVIEW_NARRATIVE, results: `${REVIEW_OPEN} A parent training goal for the bedtime routine was added at mom's request. Parents signed authorization for the goals. A copy of the graphs was sent through the portal.` };
const REVIEW_GOOD = { activities: ['Review results with parent'], narrative: REVIEW_NARRATIVE, results: `${REVIEW_OPEN} BCBA will add a parent training goal for the bedtime routine at mom's request. Parents signed off on the goals. A copy of the graphs was sent through the portal.` };

const REPORT_PICKS = ['Medical Record Review', 'Analysis of past data', 'Treatment plan / goal development', 'Report Review and Edits'];
const REPORT_BAD = {
  reporting: REPORT_PICKS,
  narrative: 'BCBA completed report writing without client contact for about 2.5 hours. BCBA pulled the prior treatment plan and the last 6 months of data from Rethink, and read the assessment report from May and the speech evaluation. BCBA graphed manding and elopement trends, wrote a baseline for each new goal from the Rethink data, edited the background and history sections, updated the diagnoses list and checked the authorization dates against the plan.',
  results: 'Manding has increased steadily and elopement has stayed flat since spring. BCBA drafted 4 new goals: 2 communication goals (requesting help and 2-word mands), 2 social goals (greeting peers and responding to peers) and 1 behavior reduction goal for elopement. The current authorization ends in 6 weeks. Parent training goals still need to be written before the report goes to the clinical director.',
};
const REPORT_GOOD = {
  reporting: REPORT_PICKS,
  narrative: 'BCBA completed report writing without client contact for about 2.5 hours. BCBA pulled the prior treatment plan and the last 6 months of data from Rethink, and read the neuropsychological evaluation from May and the speech evaluation. BCBA graphed manding and elopement trends, wrote a baseline for each new goal from the Rethink data, edited the background and history sections, updated the diagnoses list from the neuropsychological evaluation and checked the authorization dates against the plan.',
  results: 'Manding has increased steadily and elopement has stayed flat since spring. BCBA drafted 4 new goals: 2 communication goals (requesting help and 2-word mands), 1 social goal (greeting peers) and 1 behavior reduction goal for elopement. The current authorization ends in 6 weeks. BCBA still needs to write the parent training goals before sending the report to the clinical director.',
};

const VBMAPP_PICKS = ['Administration of assessment tool', 'Caregiver/Guardian interview'];
const VBMAPP_NARRATIVE = "BCBA administered the VB-MAPP Milestones Assessment, Levels 1 and 2, at home over 90 minutes to identify language repertoire gaps informing skill acquisition targets. BCBA interviewed the client's mother for 30 minutes about the daily routine, and the father joined for the last 10 minutes.";
const VBMAPP_MIDDLE = 'The client took 3 breaks and returned each time with a first-then. Level 2 testing stopped at Visual Perceptual when the client left the table. Barriers identified were prompt dependence and impaired mand.';
const VBMAPP_BAD = {
  activities: VBMAPP_PICKS,
  narrative: VBMAPP_NARRATIVE,
  results: `The client manded for 6 items and tacted 8 items, and responded to 5 Level 1 listener items. ${VBMAPP_MIDDLE} Mother reported tantrums occur mainly at bath time. Level 1 was scored, and Level 2 is partially scored.`,
};
const VBMAPP_BAD_CREDIT = {
  activities: VBMAPP_PICKS,
  narrative: VBMAPP_NARRATIVE,
  results: `The client manded for 6 items with a full echoic prompt and tacted 8 items, and responded to 5 Level 1 listener items. ${VBMAPP_MIDDLE} Mother and father confirmed the client eats 6 foods and sleeps adequately. Tantrums occur mainly at bath time.`,
};
const VBMAPP_GOOD = {
  activities: VBMAPP_PICKS,
  narrative: VBMAPP_NARRATIVE,
  results: `The client manded for 6 items with a full echoic prompt and tacted 8 items, and responded to 5 Level 1 listener items. ${VBMAPP_MIDDLE} Mother reported that sleep is okay, the client eats 6 foods, and tantrums occur mainly at bath time. Mother and father both identified bath time as the hardest part of the day. Level 1 was scored, and Level 2 is partially scored; BCBA will finish Level 2 and the transition assessment at the next visit.`,
};

const RECORDS_GOOD = {
  reporting: ['Medical Record Review', 'Analysis of past data'],
  narrative: 'BCBA reviewed FBA data from the current authorization across the reduction targets Hugging/Jumping on People, Aggression, Tantrum and Climbing. BCBA updated the background, medical history and service history sections and compared session conditions across the authorization.',
  results: 'Climbing followed the end of peer play in 3 of 4 instances. Aggression rose during summer camp in July and has stayed at zero since the regular school year began. Hugging/jumping on people was lower with BCBA present, at 3 instances in 3 sessions, than without BCBA, at 11 instances in 5 sessions. Rates look lower in telehealth sessions.',
};

// ── The prompt ──────────────────────────────────────────────────────────

test.describe('the Assessment prompt carries the nothing-added rules', () => {
  const prompt = assess.buildUserPrompt({ summaryNotes: INTAKE[FBA] });
  const RULES = [
    ['the rules override the instructions above', /NOTHING ADDED TO WHAT THE NOTES SAY\. These rules override the instructions above where they differ/],
    ['1: no count, group or category the notes do not give', /Never add a count, a group or a category the notes do not give/],
    ['1: counts add up to the notes\' counts, with the FBA example', /"7 episodes, 5 after teacher said clean up, 2 at recess" is 5 plus 2/],
    ['1: an unanswered question leaves the fact out', /A question you asked that got no answer leaves that fact out of the note\. It never becomes "unclear", "unknown" or "the remaining episodes"/],
    ['2: a document keeps its name', /A document keeps the name the BCBA gave it\. "Parents signed off on goals" is not "signed authorization" or "signed consent"/],
    ['3: the neuropsych eval stays an evaluation', /"Neuropsych eval from may" is the neuropsychological evaluation from May, never an "assessment report"/],
    ['2 and 3: name every document named, and none not named', /Name every document the notes name, and never name a document \(authorization, consent, plan, report, evaluation\) the notes do not/],
    ['2: planned stays planned', /Planned stays planned\.[^\n]*"will add", "plan to", "need to", "next visit"/],
    ['2: the bedtime goal example', /"BCBA will add a parent training goal for the bedtime routine", never "was added" or "has been added"/],
    ['3: the goal count and grouping match his', /A count of goals matches the BCBA's count and grouping\. "4 new goals: 2 communication, 1 social, 1 behavior reduction" is four goals in those groups/],
    ['3: an answer fills in his goals, never a fifth', /it never makes a fifth or moves a goal to another group/],
    ['4: an unsure detail stays as written', /A detail you are unsure of stays as the BCBA wrote it\. "Mand at 6 items w full echoic" keeps "with a full echoic prompt"\. You may ask what it means, but never drop it/],
    ['5: credit a statement only to who made it', /Credit a statement only to the person who made it\. Where dad joined only for the bath-time part/],
    ['5: a teacher interview is not a caregiver interview', /An interview with a teacher or other staff is not a caregiver interview/],
  ];
  for (const [name, re] of RULES) {
    test(name, () => {
      expect(prompt).toMatch(re);
    });
  }

  test('the notes still come first and the checkbox lists are intact', () => {
    expect(prompt.indexOf(INTAKE[FBA])).toBeLessThan(prompt.indexOf('NOTHING ADDED'));
    expect(prompt).toMatch(/- activities: /);
    expect(prompt).toMatch(/- reporting: /);
  });

  test('the logged-out copy prompt carries the rules too', () => {
    expect(assess.buildLabeledPrompt({ summaryNotes: 'x' })).toMatch(/NOTHING ADDED TO WHAT THE NOTES SAY/);
  });

  test('no em dash reaches the prompt', () => {
    expect(prompt).not.toMatch(/\u2014/);
  });

  test('the served system prompt is untouched, so voice-module parity holds', () => {
    expect(assess.buildSystem()).not.toMatch(/NOTHING ADDED/);
  });
});

// ── 1. The FBA: counts add up ──────────────────────────────────────────

test.describe('1. FBA: the counts in the note add up to the counts in the notes', () => {
  test('bench error: "Two hits had unclear antecedents" makes 9 of his 7, and is flagged', () => {
    const out = run(FBA, FBA_BAD_TWO);
    expect(details(out)).toContain('results: Counts add to 9 (5 + 2 + 2), but the notes give 7 episodes; check for an added group.');
  });

  test('bench error: "The remaining episodes" after 5 + 2 adds a group, and is flagged', () => {
    const out = run(FBA, FBA_BAD_REMAINING);
    expect(details(out)).toContain('results: "The remaining episodes" adds a group: the notes\' 7 episodes are already 5 + 2.');
  });

  test('corrected draft: 7, then 5 and 2, raises no hint', () => {
    expect(details(run(FBA, FBA_GOOD))).toEqual([]);
  });

  test('a breakdown short of the total is not flagged (the note may leave some out)', () => {
    const out = run(FBA, { results: 'BCBA recorded 7 episodes of hitting. Five followed a teacher instruction to clean up.' });
    expect(details(out)).toEqual([]);
  });

  test('the note is never rewritten by the check', () => {
    const out = run(FBA, FBA_BAD_TWO);
    expect(out.results).toBe(FBA_BAD_TWO.results);
    expect(out.activities).toEqual(FBA_PICKS);
  });
});

// ── 2. Results review: a document keeps its name, planned stays planned ─

test.describe('2. Results review: the document keeps his name, and planned stays planned', () => {
  test('bench error: "signed authorization" is flagged, since his notes say "signed off on goals"', () => {
    expect(details(run(REVIEW, REVIEW_BAD))).toContain('results: The notes never say "authorization"; check which document this was.');
  });

  test('bench error: "will add a parent training goal" written as "was added" is flagged', () => {
    expect(details(run(REVIEW, REVIEW_BAD))).toContain('results: The notes say "will add a parent training goal"; the note says it was done. Keep it planned.');
  });

  test('corrected draft: "will add" and "signed off on the goals" raise no hint', () => {
    expect(details(run(REVIEW, REVIEW_GOOD))).toEqual([]);
  });

  test('a future passive ("will be added") is still planned, and is not flagged', () => {
    const out = run(REVIEW, { results: 'A parent training goal for the bedtime routine will be added at mom\'s request.' });
    expect(details(out)).toEqual([]);
  });

  for (const [word, sentence] of [
    ['consent', 'Parents signed consent for the goals.'],
    ['treatment plan', 'Parents approved the treatment plan.'],
    ['report', 'Parents received the assessment report.'],
    ['evaluation', 'Parents reviewed the evaluation.'],
  ]) {
    test(`a document word the notes never use is flagged: "${word}"`, () => {
      expect(details(run(REVIEW, { results: sentence }))).toContain(`results: The notes never say "${word}"; check which document this was.`);
    });
  }

  test('"authorization period" is a span of time, not a document, and is not flagged', () => {
    const out = run(REVIEW, { narrative: 'BCBA reviewed the reassessment to plan targets for the upcoming authorization period.' });
    expect(details(out)).toEqual([]);
  });
});

// ── 3. Report writing: his document names and his goal count ───────────

test.describe('3. Report writing: a document he named stays named, and the goal count is his', () => {
  test('bench error: the neuropsych eval written as "assessment report from May" is flagged', () => {
    expect(details(run(REPORT, REPORT_BAD))).toContain('note: The notes name the "neuropsych eval"; the note does not.');
  });

  test('bench error: a second social goal is flagged against his 1 social', () => {
    expect(details(run(REPORT, REPORT_BAD))).toContain('results: The note says 2 social goals; the notes give 1.');
  });

  test('bench error: goal groups adding to 5 are flagged against his 4', () => {
    expect(details(run(REPORT, REPORT_BAD))).toContain('results: Goal groups add to 5; the notes give 4.');
  });

  test('a "fifth goal" is flagged against his 4', () => {
    const out = run(REPORT, { ...REPORT_GOOD, results: 'BCBA drafted 4 new goals for requesting help, 2-word mands, greeting peers and elopement. A fifth goal targets responding to peers.' });
    expect(details(out)).toContain('results: The note has a fifth goal; the notes give 4.');
  });

  test('"5 new goals" is flagged against his 4', () => {
    const out = run(REPORT, { ...REPORT_GOOD, results: 'BCBA drafted 5 new goals.' });
    expect(details(out)).toContain('results: The note says 5 goals; the notes give 4.');
  });

  test('corrected draft: 4 goals in his groups and the neuropsychological evaluation raise no hint', () => {
    expect(details(run(REPORT, REPORT_GOOD))).toEqual([]);
  });

  test('"still need to write the parent training goals" kept as still to come is not flagged', () => {
    expect(details(run(REPORT, REPORT_GOOD)).filter((d) => /Keep it planned/.test(d))).toEqual([]);
  });

  test('"wrote a baseline for each new goal" (done, in his notes) is not read as the planned goals', () => {
    expect(details(run(REPORT, REPORT_BAD)).filter((d) => /Keep it planned/.test(d))).toEqual([]);
  });
});

// ── 4. VB-MAPP: an unsure detail stays ──────────────────────────────────

test.describe('4. VB-MAPP: a detail the tool was unsure of stays as he wrote it', () => {
  test('bench error: "mand at 6 items w full echoic" losing "w full echoic" is flagged', () => {
    expect(details(run(VBMAPP, VBMAPP_BAD))).toContain('results: The notes say "full echoic"; the note dropped it. Keep the notes\' words, or ask.');
  });

  test('corrected draft: "with a full echoic prompt" raises no hint', () => {
    expect(details(run(VBMAPP, VBMAPP_GOOD))).toEqual([]);
  });
});

// ── 5. Credit only to the person who said it (hints only) ──────────────

test.describe('5. Credit a statement only to the person who made it (hints only)', () => {
  test('bench error: a teacher interview ticked as Caregiver/Guardian interview is flagged, and stays ticked', () => {
    const out = run(FBA, { ...FBA_GOOD, activities: FBA_PICKS.concat(['Caregiver/Guardian interview']) });
    expect(details(out)).toContain('activities: Caregiver/Guardian interview is ticked, but the interview in the notes was with the teacher.');
    expect(out.activities).toContain('Caregiver/Guardian interview');
  });

  test('a caregiver interview tick on notes that interviewed mom is not flagged', () => {
    expect(details(run(VBMAPP, VBMAPP_GOOD)).filter((d) => /ticked/.test(d))).toEqual([]);
  });

  test('bench error: mom\'s answers credited to "mother and father" is flagged, and the sentence stays', () => {
    const out = run(VBMAPP, VBMAPP_BAD_CREDIT);
    expect(details(out)).toContain('results: Credits both parents, but the notes give dad only this: "dad joined for the last 10 min and agreed bath..."');
    expect(out.results).toBe(VBMAPP_BAD_CREDIT.results);
  });

  test('corrected draft: mom credited with her answers, both parents with bath time, raises no hint', () => {
    expect(details(run(VBMAPP, VBMAPP_GOOD)).filter((d) => /both parents/.test(d))).toEqual([]);
  });
});

// ── Noise: correct notes stay quiet ─────────────────────────────────────

test.describe('noise: correct notes raise no hint', () => {
  // Three assessment sessions written by hand, each correct to its notes,
  // with counts, plans, documents and parents the checks read.
  const NARRATIVES = [
    {
      name: 'MSWO and an interview with both parents',
      intake: 'ran MSWO w 6 items at home, 3 trials. top 3 were bubbles, ipad and goldfish crackers. interviewed both parents 40 min about mealtimes, client throws food 3 to 4 times per meal, mostly when a new food is on the plate. dad said it started after the move in june. reviewed the speech eval from august. will run a second MSWO with edibles only next visit. plan to start a feeding baseline once parents send the food log.',
      out: {
        activities: ['Administration of assessment tool', 'Caregiver/Guardian interview'],
        reporting: ['Medical Record Review'],
        narrative: 'BCBA conducted an MSWO preference assessment with 6 items across 3 trials at home to identify reinforcers for skill acquisition programming. BCBA interviewed both parents for 40 minutes about mealtimes to identify the antecedents to food throwing, and reviewed the speech evaluation from August.',
        results: 'The top 3 items were bubbles, the iPad and goldfish crackers. Parents reported the client throws food 3 to 4 times per meal, mostly when a new food is on the plate, which suggests escape from non-preferred foods. Father reported the throwing started after the move in June. BCBA will run a second MSWO with edibles only at the next visit and plans to start a feeding baseline once the parents send the food log.',
      },
    },
    {
      name: 'school FBA with two counts in a row',
      intake: 'reviewed IEP and BIP from school, met w teacher and aide 30 min. ABC data from last 2 wks: 12 incidents of elopement, 8 during transitions, 4 during group work. teacher says aide blocks most attempts. observed 1 hr in class, 2 elopement attempts, both at transition to specials, both blocked within 5 sec. hypothesis escape from transitions, need FA to confirm. next: write FBA summary for team meeting.',
      out: {
        activities: ['Functional Behavior Assessment', 'Client Observation'],
        reporting: ['Medical Record Review', 'Analysis of past data'],
        narrative: "BCBA reviewed the client's IEP and BIP from school and met with the teacher and aide for 30 minutes to identify the conditions surrounding elopement. BCBA observed the client in class for 1 hour and collected ABC data on elopement.",
        results: 'School ABC data from the last 2 weeks showed 12 incidents of elopement: 8 occurred during transitions and 4 occurred during group work. The teacher reported that the aide blocks most attempts. During the observation the client made 2 elopement attempts, both at the transition to specials, and both were blocked within 5 seconds. The pattern is consistent with escape from transitions, and a Functional Analysis is needed to confirm the function. BCBA will write an FBA summary for the team meeting.',
      },
    },
    {
      name: 'Vineland-3 with mom, dad joining for part, and goals by domain',
      intake: 'administered Vineland-3 comprehensive interview form w mom, 75 min. adaptive behavior composite 68, communication 64, daily living 72, socialization 70. dad joined for the last 15 min and added that toileting is the main concern at home. updated treatment plan with 3 new goals: 1 toileting, 1 daily living, 1 communication. will review the goals with both parents next week. still need to score the maladaptive section.',
      out: {
        activities: ['Administration of assessment tool', 'Caregiver/Guardian interview'],
        reporting: ['Assessment Scoring / Interpretation of results', 'Treatment plan / goal development'],
        narrative: "BCBA administered the Vineland-3 Comprehensive Interview Form with the client's mother over 75 minutes to identify adaptive behavior deficits informing treatment goals. The client's father joined for the last 15 minutes. BCBA updated the treatment plan with 3 new goals.",
        results: 'The Vineland-3 Adaptive Behavior Composite was 68, with Communication 64, Daily Living Skills 72 and Socialization 70. Father added that toileting is the main concern at home. The 3 new goals are 1 toileting goal, 1 daily living goal and 1 communication goal. The maladaptive behavior section is not yet scored. BCBA will review the goals with both parents next week.',
      },
    },
  ];
  for (const n of NARRATIVES) {
    test(n.name, () => {
      const out = assess.normalizeOutput(draft(n.out), { intake: n.intake });
      expect(details(out)).toEqual([]);
    });
  }

  test('a corrected draft of every bench case raises no hint', () => {
    const corrected = { [FBA]: FBA_GOOD, [REVIEW]: REVIEW_GOOD, [REPORT]: REPORT_GOOD, [VBMAPP]: VBMAPP_GOOD, [RECORDS]: RECORDS_GOOD };
    expect(Object.keys(corrected).sort()).toEqual(Object.keys(INTAKE).sort());
    for (const [id, fields] of Object.entries(corrected)) {
      expect({ id, hints: details(run(id, fields)) }).toEqual({ id, hints: [] });
    }
  });
});

// ── Fail open, and never change anything ────────────────────────────────

test.describe('the checks run only on a real draft, and fail open', () => {
  test('without the intake (not a draft), nothing is flagged', () => {
    expect(assess.normalizeOutput(draft(REVIEW_BAD)).hints).toEqual([]);
  });

  test('a page where the check files did not load drafts as before, and says so in the console', () => {
    const warned = [];
    const bare = load({ withChecks: false, log: { ...console, warn: (...a) => warned.push(a.join(' ')) } });
    const out = bare.normalizeOutput(draft(REVIEW_BAD), { intake: INTAKE[REVIEW] });
    expect(out.hints).toEqual([]);
    expect(out.results).toBe(REVIEW_BAD.results);
    expect(warned.some((w) => /AssessChecks/.test(w))).toBe(true);
  });

  test('a loaded page does not warn', () => {
    const warned = [];
    const ok = load({ log: { ...console, warn: (...a) => warned.push(a.join(' ')) } });
    ok.normalizeOutput(draft(REVIEW_BAD), { intake: INTAKE[REVIEW] });
    expect(warned).toEqual([]);
  });

  test('no pick and no sentence is changed by any check', () => {
    for (const [id, fields] of [[FBA, FBA_BAD_TWO], [REVIEW, REVIEW_BAD], [REPORT, REPORT_BAD], [VBMAPP, VBMAPP_BAD_CREDIT]]) {
      const out = run(id, fields);
      expect(out.narrative).toBe(fields.narrative || '');
      expect(out.results).toBe(fields.results || '');
      expect(out.activities).toEqual(fields.activities || []);
      expect(out.reporting).toEqual(fields.reporting || []);
    }
  });

  test('the model output is not mutated', () => {
    const raw = draft(REVIEW_BAD);
    const before = JSON.stringify(raw);
    assess.normalizeOutput(raw, { intake: INTAKE[REVIEW] });
    expect(JSON.stringify(raw)).toBe(before);
  });

  test('the checks\' hints come before the model\'s own and keep the tool\'s codes', () => {
    const out = assess.normalizeOutput(draft({ ...REVIEW_BAD, hints: [{ section: 'results', code: 'thin_section', detail: 'x', rank: 1, kind: 'thin' }] }), { intake: INTAKE[REVIEW] });
    expect(out.hints[out.hints.length - 1].code).toBe('thin_section');
    expect(out.hints.slice(0, -1).every((h) => h.code === 'ambiguous_item')).toBe(true);
  });
});

test.describe('the Assessment page loads the checks', () => {
  // The vm tests above cannot see a missing script tag.
  test('window.AssessChecks and window.AssessCounts are on /notes/assess/ when the tool registers', async ({ page }) => {
    await page.goto('/notes/assess/');
    await page.waitForFunction(() => (window.NOTE_TOOLS || []).some((t) => t.id === 'assess'));
    expect(await page.evaluate(() => typeof (window.AssessChecks && window.AssessChecks.apply))).toBe('function');
    expect(await page.evaluate(() => typeof (window.AssessCounts && window.AssessCounts.goalFindings))).toBe('function');
  });
});
