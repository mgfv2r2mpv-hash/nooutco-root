import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';

/* ONE PARENT NOTE THAT CAME OUT WRONG, KEPT AS A TEST.
 *
 * Approved 2026-10-03 as step 9 of the parent note plan. A production parent
 * note turned 2 physically prompted trials into "physical prompt was required
 * on the other", said "all three parent goals" when an answer had added a
 * fourth, wrote "BCBA met with Parent Goals", picked "no barriers" over a
 * missed caregiver prompt, left the technician out of Individuals Present,
 * and filled Behavior Analyst Follow Up with its own questions to the author.
 *
 * This file holds the static half: the prompt carries each ruling, the follow
 * up backstop moves questions to hints and keeps real tasks, and the checker
 * in scripts/lib/parent-shape-checks.mjs catches every one of those failures
 * on a made-up draft of the same shape while passing a right one.
 *
 * THE LIVE HALF. The same checker scores a real draft of each case in
 * tests/fixtures/parent-note-shape.json. Kaleb asked for that run to use his
 * voice profile, which lives only in his browser, so it is run from his
 * browser and is not part of CI. */

const ROOT = process.cwd();
const url = (rel) => 'file://' + path.join(ROOT, rel);
const fixture = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/parent-note-shape.json'), 'utf8'));

let check;
test.beforeAll(async () => {
  ({ checkParentDraft: check } = await import(url('scripts/lib/parent-shape-checks.mjs')));
});

async function parentTool(page) {
  await page.goto('/notes/bcba/index.html');
  await page.waitForFunction(() => (window.NOTE_TOOLS || []).some((t) => t.id === 'parent'));
}

test.describe('the parent prompt carries each ruling', () => {
  const RULES = [
    ['follow up is a task list', /1 to 3 items, rarely more, that the BCBA could put on a task list/],
    ['follow up is never a question', /NEVER a question to the author/],
    ['caregiver response: a missed prompt means option two', /A missed step, a missed or late prompt, prompting the caregiver needed, or any resistance means the second option/],
    ['progress weighs caregiver goals more', /caregivers' goal progress weighs more than the client's goal progress/],
    ['every goal named, answers included', /A goal the author adds in an answer to a follow-up question is a goal of this note/],
    ['no unsupported goal count', /Never state a count of goals/],
    ['prompt level beside the count', /PROMPT LEVEL GOES WITH THE COUNT/],
    ['the author\'s a/b notation', /a trials correct at or above the intended prompt level and b trials that were not/],
    ['technician and client present by default', /Parent\/Caregiver, Client and Technician are present by default/],
  ];
  for (const [name, re] of RULES) {
    test(name, async ({ page }) => {
      await parentTool(page);
      const system = await page.evaluate(() => window.NOTE_TOOLS.find((t) => t.id === 'parent').buildSystem());
      expect(system).toMatch(re);
    });
  }

  test('the old ready-made feedback phrase is gone, so it cannot be copied in', async ({ page }) => {
    await parentTool(page);
    const system = await page.evaluate(() => window.NOTE_TOOLS.find((t) => t.id === 'parent').buildSystem());
    expect(system).not.toContain('"performance feedback was delivered."');
    expect(system).toContain('Never add feedback the notes do not report');
  });

  test('the triage prompt asks about data it cannot read', async ({ page }) => {
    await parentTool(page);
    const triage = await page.evaluate(() => window.NoteTriagePrompt.full);
    expect(triage).toMatch(/Ask about data you cannot read/);
  });
});

test.describe('follow up backstop: questions to hints, tasks stay', () => {
  const QUESTIONS = [
    'Clarify baseline climbing rate and whether 2 instances represent change.',
    'Specify topography and duration of tantrum behavior across trials.',
    'Confirm whether the current program stage is gesture prompt.',
    'Determine if the caregiver practiced at home.',
    'Is the timer still in use?',
  ];
  const TASKS = [
    'Monitor new technician onboarding for fidelity with current interventions.',
    'Confirm onboarding date with the new technician by Friday.',
    'Provide caregivers a written FCR prompting visual before next session.',
    'Meet with the teacher to align the token board across settings.',
  ];

  test('every question line moves to hints, every task line stays', async ({ page }) => {
    await parentTool(page);
    const out = await page.evaluate(({ q, t }) => window.NOTE_TOOLS.find((x) => x.id === 'parent')
      .normalizeOutput({ followup: [...q, ...t].join('\n'), hints: [] }), { q: QUESTIONS, t: TASKS });
    expect(out.followup.split('\n')).toEqual(TASKS);
    expect(out.hints.length).toBeGreaterThan(0);
    expect(out.hints.every((h) => h.section === 'followup')).toBe(true);
  });
});

test.describe('the checker', () => {
  const v1 = fixture.cases.find((c) => c.id === 'v1-the-original-shape');

  // Made up, in the shape of what the real note said.
  const BAD = {
    individualsPresent: ['Parent/Caregiver', 'Client'],
    caregiverResponse: 'Parent/Family is responding to training and generalization of skills is occurring. There are no barriers with their training.',
    progressStatus: 'Moderate progress towards goals',
    summary: 'BCBA met with Parent Goals to review data on current Client. Client completed the one-step instruction on 2/3 trials. Tantrum behavior occurred on 1 trial; physical prompt was required on the other. Climbing occurred 2 times. Parent Goals demonstrated competence across all three parent goals, with performance feedback delivered for each.',
    followup: 'Clarify baseline climbing rate.\nSpecify topography of tantrum behavior.\nConfirm whether the current stage is gesture prompt.\nMonitor new technician onboarding.',
  };

  const GOOD = {
    individualsPresent: ['Parent/Caregiver', 'Client', 'Technician'],
    caregiverResponse: 'Parent/Family is trying to learn new strategies, but there are some small barriers to generalization.',
    progressStatus: 'Moderate progress towards goals',
    summary: 'BCBA met with caregivers to review a staff transition the parents requested. Client completed Complete Functional One-Step Instructions on 2 of 3 trials, both with a physical prompt (criterion: gesture prompt), and tantrum behavior occurred on the third. Climbing occurred 2 times during the parent training portion. Caregivers ran Prompt FCR (Antecedent) at 6/1, 85%. Caregivers implemented Prompt to Sit for Interval, Prompt to Go to Bathroom and Use Timer at 2/0, 100% each.',
    followup: 'Review the missed FCR prompt with caregivers and model prompting before climbing precursors.\nMonitor new technician onboarding over the next 2 weeks for fidelity with the BIP.',
  };

  test('it catches every failure the real note had', () => {
    const fails = check(v1, BAD).join('\n');
    expect(fails).toMatch(/all three/);
    expect(fails).toMatch(/met with Parent Goals/);
    expect(fails).toMatch(/performance feedback delivered/);
    expect(fails).toMatch(/physical prompt was required on the other/);
    expect(fails).toMatch(/missing "Technician"/);
    expect(fails).toMatch(/Caregiver Response picked/);
    expect(fails).toMatch(/question to the author/);
    expect(fails).toMatch(/goal not named in the summary: "Prompt FCR"/);
  });

  test('it passes a draft that follows every ruling', () => {
    expect(check(v1, GOOD)).toEqual([]);
  });

  test('every case in the fixture is checkable', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(4);
    for (const c of fixture.cases) {
      expect(c.intake.length, c.id).toBeGreaterThan(40);
      expect(Object.keys(c.expect).length, c.id).toBeGreaterThan(2);
    }
  });
});
