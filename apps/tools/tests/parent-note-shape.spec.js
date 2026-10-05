import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

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
    ['a poor client response is a barrier too', /So does a poor client response, such as a client goal with no trial correct/],
    ['moderate names both sides', /not Minimal, because the caregiver goals carry it, and not Substantial, because a client goal with no trial correct holds it back/],
    ['every goal named, answers included', /A goal the author adds in an answer to a follow-up question is a goal of this note/],
    ['no unsupported goal count', /Never state a count of goals/],
    ['prompt level beside the count', /PROMPT LEVEL GOES WITH THE COUNT/],
    ['the author\'s a/b notation', /a trials correct at or above the intended prompt level and b trials that were not/],
    ['technician and client present by default', /Parent\/Caregiver, Client and Technician are present by default/],
    ['someone who only reported is not present', /someone who reported something, sent a message or asked for a meeting \(a teacher reporting from school, say\) is not present unless the notes say they were there/],
    ['the present rule never strips a name from the summary', /This governs the checkboxes only\. The summary still names them and what they reported\./],
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

  /* Kaleb's first live run, rescored. Two of its failures were the checker's:
     v1 wrote the count as "2 trials completed with physical prompt" and v4
     wrote "behavior technician", both right. The rest were the draft's. */
  test('it scores the first live run: real faults fail, right wording passes', () => {
    const run = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/parent-live-run-2026-10-04.json'), 'utf8')).drafts;
    const score = (id) => check(fixture.cases.find((c) => c.id === id), run[id]).join('\n');

    const v1 = score('v1-the-original-shape');
    expect(v1).not.toMatch(/trial count/);
    expect(v1).toMatch(/missing "Technician"/);
    expect(v1).toMatch(/Caregiver Response picked "Parent\/Family is responding/);

    const v2 = score('v2-missed-prompt-and-a-teacher');
    expect(v2).toMatch(/lists "Teacher"/);
    expect(v2).toMatch(/goal not named in the summary: "Present Token Board Before Demand"/);

    expect(score('v3-generalization-stated')).toBe('');

    const v4 = score('v4-no-bt-today');
    expect(v4).not.toMatch(/mentions/);
    expect(v4).toMatch(/"3 of 1"/);
    expect(v4).toMatch(/Caregiver Response picked ""/);
  });

  test('every case in the fixture is checkable', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(4);
    for (const c of fixture.cases) {
      expect(c.intake.length, c.id).toBeGreaterThan(40);
      expect(Object.keys(c.expect).length, c.id).toBeGreaterThan(2);
    }
  });
});

/* THE PASTE SCRIPT, run on the real page with the model call stubbed. Kaleb
 * runs scripts/parent-shape-live.js from his console, where a broken call
 * would cost him a run and say little, so this proves the file is current with
 * the fixture and the checker, reaches every page function it names, and
 * scores what comes back. Nothing here leaves the browser. */
test.describe('the live paste script', () => {
  test('the committed file is what the builder writes', () => {
    const run = spawnSync(process.execPath, ['scripts/build-parent-shape-live.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(run.status, run.stdout + run.stderr).toBe(0);
  });

  test('it drafts every case through the page and scores each one', async ({ page }) => {
    await page.goto('/notes/bcba/index.html');
    await page.evaluate(() => {
      const payload = { role: 'user', kid: 'pw:bcba-1', tools: ['parent'], exp: Math.floor(Date.now() / 1000) + 3600 };
      const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      localStorage.setItem('notes_auth_token', `${b64}.local-test`);
    });
    await page.reload();
    await page.waitForFunction(() => (window.NOTE_TOOLS || []).some((t) => t.id === 'parent'));

    const GOOD_V1 = {
      individualsPresent: ['Parent/Caregiver', 'Client', 'Technician'],
      caregiverResponse: 'Parent/Family is trying to learn new strategies, but there are some small barriers to generalization.',
      progressStatus: 'Moderate progress towards goals',
      summary: 'BCBA met with caregivers to review a staff transition the parents requested. Client completed Complete Functional One-Step Instructions on 2 of 3 trials, both with a physical prompt (criterion: gesture prompt), and tantrum behavior occurred on the third. Climbing occurred 2 times during the parent training portion. Caregivers ran Prompt FCR (Antecedent) at 6/1, 85%. Caregivers implemented Prompt to Sit for Interval, Prompt to Go to Bathroom and Use Timer at 2/0, 100% each.',
      followup: 'Review the missed FCR prompt with caregivers and model prompting before climbing precursors.\nMonitor new technician onboarding over the next 2 weeks for fidelity with the BIP.',
      hints: [],
    };
    await page.evaluate((good) => {
      window.__sent = [];
      window.NotesGate.styleCard = { get: async () => ({ block: 'STYLE CARD', shapeBlock: 'SHAPE' }) };
      window.NotesGate.generateConversation = async (opts) => {
        window.__sent.push(opts);
        if (window.__sent.length === 1) return { parsed: good };
        if (window.__sent.length === 2) throw new Error('the model was unreachable');
        return { parsed: { summary: 'A short summary.', followup: 'Clarify whether the BT attended?', hints: [] } };
      };
    }, GOOD_V1);

    const script = readFileSync(path.join(ROOT, 'scripts/parent-shape-live.js'), 'utf8');
    const report = await page.evaluate(script);
    const sent = await page.evaluate(() => window.__sent.map((o) => ({
      user: o.messages[0].content, suffix: o.systemSuffix, tool: o.tool, keys: o.expectKeys, schema: !!o.responseSchema,
    })));

    expect(report.results.map((r) => r.case)).toEqual(fixture.cases.map((c) => c.id));
    expect(report.results[0]).toMatchObject({ case: 'v1-the-original-shape', pass: true, voice: true });
    expect(report.results[1].fails).toMatch(/draft failed: the model was unreachable/);
    expect(report.results[2].pass).toBe(false);
    expect(report.results[3].fails).toMatch(/goal not named/);

    expect(await page.evaluate(() => window.parentShapeReport.results.length)).toBe(4);
    expect(sent).toHaveLength(4);
    expect(sent.every((s) => s.tool === 'parent' && s.schema && s.keys.includes('summary'))).toBe(true);
    expect(sent[0].suffix).toMatch(/^STYLE CARD[\s\S]*SHAPE$/);
    // Program words may leave as tokens until the scrubber's word list covers
    // them, so these hold to words the scrubber never takes.
    expect(sent[0].user).toContain('\nQ: You wrote 0/3 on the');
    expect(sent[0].user).toContain('\nA: ');
    expect(sent[0].user).toContain('behavior occurred on 1 trial');
    expect(sent[2].user).not.toContain('THE TECHNICIAN ADDED');
  });
});

/* TWO DEFAULTS HELD BY CODE, approved 2026-10-04 (Q7, "accepted"). They run
 * when the engine hands normalizeOutput the draft's intake, and only ever add
 * a checkbox or fill a blank pick: nothing a person or the notes named is
 * removed. The intakes are invented, and "[BT]" is how the scrub leaves a BT. */
test.describe('the defaults hold in code', () => {
  const norm = (page, raw, ctx) => page.evaluate(({ raw, ctx }) =>
    window.NOTE_TOOLS.find((t) => t.id === 'parent').normalizeOutput(raw, ctx), { raw, ctx });
  const MIDDLE = 'Parent/Family is trying to learn new strategies, but there are some small barriers to generalization.';
  const THIRD = 'Parent/Family is responding to training and generalization of skills is occurring. There are no barriers with their training.';

  test('Technician is added when the notes do not say the BT was away', async ({ page }) => {
    await parentTool(page);
    const out = await norm(page, { individualsPresent: ['Client', 'Parent/Caregiver'], caregiverResponse: THIRD }, { intake: 'Parent training. The [BT] ran the session earlier.' });
    expect(out.individualsPresent).toEqual(['Parent/Caregiver', 'Client', 'Technician']);
  });

  for (const intake of [
    'Parent training, caregiver and client only.',
    'Follow up when the [BT] is present on fading the visual schedule.',
    'No [BT] this session.',
    'Technician was absent.',
  ]) {
    test(`Technician is not added when the notes say: ${intake}`, async ({ page }) => {
      await parentTool(page);
      const out = await norm(page, { individualsPresent: ['Parent/Caregiver', 'Client'], caregiverResponse: THIRD }, { intake });
      expect(out.individualsPresent).toEqual(['Parent/Caregiver', 'Client']);
    });
  }

  test('a blank Caregiver Response becomes the middle option, with a hint saying so', async ({ page }) => {
    await parentTool(page);
    const out = await norm(page, { individualsPresent: ['Parent/Caregiver', 'Client'], caregiverResponse: '' }, { intake: 'Parent training.' });
    expect(out.caregiverResponse).toBe(MIDDLE);
    expect(out.hints.some((h) => h.section === 'caregiverResponse' && /middle option/.test(h.detail))).toBe(true);
  });

  test('a Caregiver Response the draft chose is kept when the notes name no barrier', async ({ page }) => {
    await parentTool(page);
    const out = await norm(page, { individualsPresent: [], caregiverResponse: THIRD }, { intake: 'Parent training.' });
    expect(out.caregiverResponse).toBe(THIRD);
    expect(out.hints.some((h) => h.section === 'caregiverResponse')).toBe(false);
  });

  test('nothing is removed: a person the draft listed stays listed', async ({ page }) => {
    await parentTool(page);
    const out = await norm(page, { individualsPresent: ['Parent/Caregiver', 'Client', 'Teacher'], caregiverResponse: MIDDLE }, { intake: 'Parent training, caregiver and client only.' });
    expect(out.individualsPresent).toEqual(['Parent/Caregiver', 'Client', 'Teacher']);
  });

  test('without the intake (not a draft) both are left as they came', async ({ page }) => {
    await parentTool(page);
    const out = await norm(page, { individualsPresent: ['Parent/Caregiver'], caregiverResponse: '' });
    expect(out.individualsPresent).toEqual(['Parent/Caregiver']);
    expect(out.caregiverResponse).toBe('');
  });

  test('on his first live run they fix v1\'s Technician and v4\'s blank pick, and leave v2\'s teacher to the prompt', async ({ page }) => {
    await parentTool(page);
    const run = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/parent-live-run-2026-10-04.json'), 'utf8')).drafts;
    const caseOf = (id) => fixture.cases.find((c) => c.id === id);
    const held = async (id) => {
      const c = caseOf(id);
      const intake = `${c.intake}\n${(c.answers || []).map((a) => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n')}`;
      return check(c, await norm(page, run[id], { intake })).join('\n');
    };
    expect(await held('v1-the-original-shape')).not.toMatch(/missing "Technician"/);
    expect(await held('v4-no-bt-today')).not.toMatch(/Caregiver Response picked/);
    expect(await held('v4-no-bt-today')).not.toMatch(/lists "Technician"/);
    expect(await held('v2-missed-prompt-and-a-teacher')).toMatch(/lists "Teacher"/);
  });

  /* Kaleb, 2026-10-04 (Caregiver Response, A): "no barriers" never stands
   * beside a missed caregiver step or a poor client response. */
  const BARRIERS = [
    ['a parent goal count with a miss', 'Parent Goals:\n1. Parent Goal: Deliver Token Board|Present Token Board Before Demand|4/1|80%', /caregiver step was missed \(4\/1/],
    ['a caregiver who forgot', 'Parent training. Caregiver forgot the timer once.', /caregiver missed a step/],
    ['a late prompt from mom', 'Mom gave the prompt late twice.', /caregiver missed a step/],
    ['a correct-out-of-total count under 100 percent', 'Parent Goals:\n1. Parent Goal: Timer|4/5|80%', /caregiver step was missed \(4\/5/],
    ['a client goal with no trial correct', 'Client Goals:\nOne-Step Instructions|Stand up|0/3\nParent Goals:\n1. Parent Goal: Prompt to Sit|2/0|100%', /client got no trial correct/],
  ];
  for (const [name, intake, why] of BARRIERS) {
    test(`"no barriers" moves to the middle option on ${name}, with a hint saying why`, async ({ page }) => {
      await parentTool(page);
      const out = await norm(page, { individualsPresent: [], caregiverResponse: THIRD }, { intake });
      expect(out.caregiverResponse).toBe(MIDDLE);
      expect(out.hints.some((h) => h.section === 'caregiverResponse' && why.test(h.detail))).toBe(true);
    });
  }

  for (const intake of [
    'Parent Goals:\n1. Parent Goal: First-Then|At Home|5/0|100%\nCaregiver used it without a reminder. Client Goals:\nWaiting|2 minutes|4/0|100%',
    'Parent Goals:\n1. Parent Goal: Timer|5/5|100%',
    'Caregiver never forgot the timer.',
    'Client missed 2 trials of matching.',
  ]) {
    test(`"no barriers" stands when the notes name none: ${intake.split("\n").pop()}`, async ({ page }) => {
      await parentTool(page);
      const out = await norm(page, { individualsPresent: [], caregiverResponse: THIRD }, { intake });
      expect(out.caregiverResponse).toBe(THIRD);
    });
  }

  test('the barrier rule only moves down: a first or second pick is left alone', async ({ page }) => {
    await parentTool(page);
    const first = 'Parent/Family is not responding to training due to large barriers and/or resistance.';
    const out = await norm(page, { individualsPresent: [], caregiverResponse: first }, { intake: 'Parent Goal: Timer|1/3' });
    expect(out.caregiverResponse).toBe(first);
  });

  test('each fixture case lands on the Caregiver Response its truth names', async ({ page }) => {
    await parentTool(page);
    for (const c of fixture.cases.filter((x) => x.expect && x.expect.caregiverResponse)) {
      const out = await norm(page, { individualsPresent: [], caregiverResponse: THIRD }, { intake: c.intake });
      expect(out.caregiverResponse, c.id).toBe(c.expect.caregiverResponse);
    }
  });
});
