import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isTriageCall } from './helpers/llm-call.js';

/* THE NOTE BENCH'S MECHANICS, with the model stubbed.
 *
 * scripts/bench drives the real page the way a user does and reads the finished
 * note back off the note card (Kaleb's goal, 2026-10-04: submission-worthy notes
 * from 100 to 125 typed words and 5 to 7 minutes). A live run costs drafts and
 * runs only with his say-so; this spec proves, for nothing, that the driver
 * fills a case, answers the page's questions from the case's truth, reads the
 * picks and narratives back, and that the checks fire on a bad note and stay
 * quiet on a good one. Every word is invented. */

const ROOT = process.cwd();
const url = (rel) => 'file://' + path.join(ROOT, rel);
const SECRET = 'playwright-local-test-secret';
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function token() {
  const payload = { role: 'user', kid: 'pw:bench', tools: ['parent', 'sup', 'assess', 'sap'], exp: Math.floor(Date.now() / 1000) + 3600 };
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${p}.${b64url(createHmac('sha256', SECRET).update(p).digest())}`;
}
const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const CASES = JSON.parse(readFileSync(path.join(ROOT, 'scripts/bench/cases/parent.json'), 'utf8')).cases;
const V1 = CASES.find((c) => c.id === 'v1-the-original-shape');

const MIDDLE = 'Parent/Family is trying to learn new strategies, but there are some small barriers to generalization.';
const GOOD = {
  individualsPresent: ['Parent/Caregiver', 'Client', 'Technician'],
  supportActivities: ['Collected data on current goals'],
  caregiverResponse: MIDDLE,
  progressStatus: 'Moderate progress towards goals',
  summary: 'BCBA met with caregivers about a staff transition the parents requested. Client completed Complete Functional One-Step Instructions on 2 of 3 trials, both with a physical prompt (criterion: gesture prompt). Climbing (Bx Reduction) occurred 2 times. Caregivers ran Prompt FCR (Antecedent) at 6/1. Caregivers implemented Prompt to Sit for Interval, Prompt to Go to Bathroom and Use Timer at 2/0.',
  followup: 'Review the missed FCR prompt with caregivers before the next session.',
  hints: [],
};
// The first option, not the third: the code moves "no barriers" down on its
// own when the notes name a barrier (#264), so only a pick the code leaves
// alone shows the check firing.
const BAD = { ...GOOD, caregiverResponse: 'Parent/Family is not responding to training due to large barriers and/or resistance.', summary: GOOD.summary + ' Caregivers met criterion on all three parent goals.' };

async function stub(page, draft) {
  const seen = { triage: 0, drafts: [] };
  await page.route('**/api/llm-call**', (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) {
      seen.triage += 1;
      return route.fulfill(reply(seen.triage === 1
        ? { sufficient: false, readiness: 60, questions: [{ field: 'sessionNotes', question: 'You wrote 0/3 on the one-step instruction. What happened on those trials?', suggestions: [] }] }
        : { sufficient: true, readiness: 90, questions: [] }));
    }
    seen.drafts.push(String((b.messages || [])[0]?.content || ''));
    return route.fulfill(reply(draft));
  });
  await page.clock.install();
  await page.goto('/notes/parent/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), token());
  return seen;
}

let drive;
let checks;
test.beforeAll(async () => {
  drive = await import(url('scripts/bench/lib/drive.mjs'));
  checks = await import(url('scripts/bench/lib/checks.mjs'));
});

test.describe('the bench drives the page', () => {
  test('answers a question from the truth, counts the typing, reads the note back', async ({ page }) => {
    const seen = await stub(page, GOOD);
    const out = await drive.runCase(page, V1, { unlockSend: (p) => p.clock.runFor(61_000), timeoutMs: 30000, settleMs: 3000 });

    // The report says which truth answered the question, so a mismatch shows.
    expect(out.asked).toEqual([{
      round: 1, question: 'You wrote 0/3 on the one-step instruction. What happened on those trials?', answered: true,
      truth: 0, matchedOn: ['0/3', 'one-step', 'trials', 'instruction'], answer: V1.truth[0].answer,
    }]);
    expect(out.typed.intake).toBe(97);
    expect(out.typed.answers).toBeGreaterThan(10);
    expect(seen.drafts.join('\n')).toContain('Tantrum behavior occurred on 1 trial');
    expect(out.note.picks.caregiverResponse).toEqual([MIDDLE]);
    expect(out.note.text.summary).toContain('Prompt FCR');
  });

  test('a good note passes the checks and a bad one names what it broke', async ({ page }) => {
    await stub(page, GOOD);
    const good = await drive.runCase(page, V1, { unlockSend: (p) => p.clock.runFor(61_000), timeoutMs: 30000, settleMs: 3000 });
    expect(checks.checkNote(V1, good.note)).toEqual([]);
  });

  test('the checks fire on a bad note', async ({ page }) => {
    await stub(page, BAD);
    const bad = await drive.runCase(page, V1, { unlockSend: (p) => p.clock.runFor(61_000), timeoutMs: 30000, settleMs: 3000 });
    const fails = checks.checkNote(V1, bad.note).join('\n');
    expect(fails).toMatch(/Caregiver Response picked/);
    expect(fails).toMatch(/goal count the list does not support: "all three"/);
  });
});

test.describe('answer matching', () => {
  test('a question takes the truth entry it shares the most words with, or none', () => {
    const truth = [{ about: ['climbing', 'respond'], answer: 'A' }, { about: ['0/3', 'trials'], answer: 'B' }];
    expect(drive.answerFor('What happened on the 0/3 trials?', truth)).toBe('B');
    expect(drive.answerFor('How did caregivers respond to climbing?', truth)).toBe('A');
    expect(drive.answerFor('What was the weather?', truth)).toBeNull();
  });

  test('the best fit wins by score, not by coming first', () => {
    const truth = [{ about: ['swing'], answer: 'A' }, { about: ['swing', 'chains'], answer: 'B' }];
    expect(drive.answerFor('Did he grab the swing chains?', truth)).toBe('B');
  });

  test('a keyword counts only at the start of a word', () => {
    const truth = [{ about: ['mark'], answer: 'A' }];
    expect(drive.answerFor('Any remarks from the teacher?', truth)).toBeNull();
    expect(drive.answerFor('Did the hits leave marks?', truth)).toBe('A');
  });

  test('a round uses each truth once, and the question that fits it best gets it', () => {
    const truth = [{ about: ['greeting', 'peers', 'wave'], answer: 'greet' }];
    const picked = drive.pickAnswers(['What prompt did you use at greeting time?', 'Which peers did he greet with a wave?'], truth);
    expect(picked.map((p) => p.answer)).toEqual([null, 'greet']);
    expect(picked[1]).toMatchObject({ truth: 0, matchedOn: ['peers', 'wave'] });
  });

  /* Kaleb's two live BT runs on 9 Oct 2026, one test per mismatch, with the
     cases as they now stand in cases/bt.json. */
  const BT = JSON.parse(readFileSync(path.join(ROOT, 'scripts/bench/cases/bt.json'), 'utf8')).cases;
  const bt = (id) => BT.find((c) => c.id === id).truth;

  test('school: the hand-raise question does not get the greeting answer a second time', () => {
    const picked = drive.pickAnswers([
      'Who did he greet at line up, and what gesture prompt did you give?',
      'What prompt did you use for raising his hand in class?',
    ], bt('bt-school-no-behaviors'));
    expect(picked[0].answer).toMatch(/wave cue/);
    expect(picked[1].answer).toBeNull();
  });

  test('clinic: a question about past sessions does not get the precursor answer', () => {
    const picked = drive.pickAnswers([
      'Before today, had he hit when the swing timer ended in past sessions?',
      'Were there any warning signs right before the hits?',
    ], bt('bt-clinic-hitting-new-med'));
    expect(picked[0].answer).toBeNull();
    expect(picked[1].answer).toMatch(/whined and grabbed the chains/);
    expect(drive.pickAnswers(['Before today, had he hit when the swing timer ended in past sessions?'], bt('bt-clinic-hitting-new-med'))[0].answer).toBeNull();
  });

  test('telehealth: what guidance dad used does not get the coaching answer', () => {
    const truth = bt('bt-telehealth-parent-coaching');
    expect(drive.answerFor('What guidance did dad use to get him to sit down?', truth)).toBeNull();
    expect(drive.answerFor('What feedback did you give dad while coaching?', truth)).toMatch(/wait 3 seconds/);
  });

  /* Kaleb's Supervision run, 9 Oct 2026. */
  const SUP = JSON.parse(readFileSync(path.join(ROOT, 'scripts/bench/cases/sup.json'), 'utf8')).cases;
  test('supervision: a question about probe trial counts does not get the split-the-chain answer', () => {
    const truth = SUP.find((c) => c.id === 'sup-no-bt-data-review').truth;
    expect(drive.answerFor('How many probe trials did you run on 3 step imitation?', truth)).toBeNull();
    expect(drive.answerFor('Has the 3 step imitation been broken down yet?', truth)).toMatch(/two 2-step chains/);
  });

  /* Review R330-H1, 9 Oct 2026. */
  test('clinic: a plain question about what came before the hits gets the precursor answer', () => {
    const truth = bt('bt-clinic-hitting-new-med');
    expect(drive.answerFor('What did he do before hitting?', truth)).toMatch(/whined and grabbed the chains/);
    expect(drive.answerFor('Were there signs he was getting upset before the hits?', truth)).toMatch(/whined and grabbed the chains/);
  });

  test('school: a gesture question about the hand raise does not get the greeting answer', () => {
    expect(drive.answerFor('What gesture did you use to cue the hand raise?', bt('bt-school-no-behaviors'))).toBeNull();
  });

  test('one word of the question counts once, however many keywords start it', () => {
    const truth = [{ about: ['med', 'medication'], answer: 'A' }, { about: ['medication', 'new'], answer: 'B' }];
    expect(drive.pickAnswers(['Did mom name the new medication?'], truth)[0]).toMatchObject({ answer: 'B', matchedOn: ['medication', 'new'] });
  });

  test('every truth keyword is one the picker counts', () => {
    for (const t of ['parent', 'sup', 'bt', 'assess', 'sap']) {
      for (const c of JSON.parse(readFileSync(path.join(ROOT, `scripts/bench/cases/${t}.json`), 'utf8')).cases) {
        for (const entry of c.truth || []) {
          const ignored = entry.about.filter((k) => drive.IGNORED_ABOUT.includes(String(k).toLowerCase()));
          expect(ignored, `${c.id}: ${entry.answer}`).toEqual([]);
        }
      }
    }
  });
});

/* A MENTION IS ONE FACT, IN ANY OF ITS PLAIN FORMS. Kaleb's BT runs on 9 Oct
   2026 failed notes that said "new action sequences" for "novel", "His father"
   for "dad" and "gestural" for "gesture". A ruling stays pinned to its words. */
test.describe('mentions', () => {
  const note = (summary) => ({ text: { summary }, picks: {}, all: summary });
  const c = (mentions) => ({ expect: { mentions } });

  test('a list of forms passes on any one of them', () => {
    expect(checks.checkNote(c([['dad', 'father', 'parent', 'caregiver']]), note('His father ran the trials.'))).toEqual([]);
    expect(checks.checkNote(c([['novel', 'new action']]), note('He needed a model on new action sequences.'))).toEqual([]);
    expect(checks.checkNote(c([['gesture', 'gestural']]), note('Moved to a gestural prompt.'))).toEqual([]);
  });

  test('supervision: "1-minute warning" and "the parent" carry the pending change', () => {
    const c2 = JSON.parse(readFileSync(path.join(ROOT, 'scripts/bench/cases/sup.json'), 'utf8')).cases.find((x) => x.id === 'sup-behavior-plan-change-pending');
    const mentions = { expect: { mentions: c2.expect.mentions } };
    expect(checks.checkNote(mentions, note('BCBA will add a 1-minute warning once the parent agrees. Fidelity was 100%.'))).toEqual([]);
    expect(checks.checkNote(mentions, note('BCBA will add a 1 minute warning after talking with mom. Fidelity was 100%.'))).toEqual([]);
  });

  test('a ruling the note dropped still fails: "errorless" stays exact', () => {
    const c1 = JSON.parse(readFileSync(path.join(ROOT, 'scripts/bench/cases/sup.json'), 'utf8')).cases.find((x) => x.id === 'sup-bt-present-fidelity');
    expect(c1.expect.mentions).toContain('errorless');
  });

  test('the page around the note never carries a mention or trips a forbid', () => {
    // Kaleb's Assessment run, 9 Oct 2026: "neuropsych" passed on the expert
    // review panel while the note said "assessment report from May".
    const shown = {
      text: { summary: 'Read the assessment report from May and the speech eval.' },
      picks: {},
      all: 'EXPERT REVIEW OF INTAKE\nneuropsych - not recognized\nwas observed\nRead the assessment report from May and the speech eval.',
    };
    expect(checks.checkNote({ expect: { mentions: ['neuropsych', 'speech'], forbid: ['was observed'] } }, shown))
      .toEqual(['missing from the note: "neuropsych"']);
  });

  test('a ticked pick and a goals table row are part of the note', () => {
    const shown = { text: { summary: '' }, picks: { antecedentStrategies: ['Visual schedule'] }, tables: { goalsAnalyzed: ['Tacting animals | Errorless, echoic at 0 sec'] }, all: '' };
    expect(checks.checkNote({ expect: { mentions: ['visual schedule', 'errorless'] } }, shown)).toEqual([]);
  });

  /* Review R330-H1, 9 Oct 2026. */
  const caseOf2 = (tool, id) => JSON.parse(readFileSync(path.join(ROOT, `scripts/bench/cases/${tool}.json`), 'utf8')).cases.find((x) => x.id === id);
  const only = (c, i) => ({ expect: { mentions: [c.expect.mentions[i]] } });

  test('telehealth: a ticked Parent/Caregiver does not stand in for dad', () => {
    const c3 = caseOf2('bt', 'bt-telehealth-parent-coaching');
    const shown = { text: { session: 'Coached the client\'s caregiver on video through each trial.' }, picks: { individualsPresent: ['Client', 'Parent/Caregiver'] }, all: '' };
    expect(checks.checkNote(only(c3, 0), shown)).toEqual(['missing from the note: "dad" or "father"']);
  });

  test('supervision: the new-sibling line alone does not carry the parents', () => {
    const c4 = caseOf2('sup', 'sup-behavior-plan-change-pending');
    expect(checks.checkNote(only(c4, 2), note('New baby sister at home; the family is adjusting.'))).toHaveLength(1);
    expect(checks.checkNote(only(c4, 2), note('BCBA will talk with mom first.'))).toEqual([]);
  });

  test('a non-breaking hyphen or space reads as a plain one', () => {
    expect(checks.checkNote(c(['first-then']), note('Showed the first\u2011then board.'))).toEqual([]);
    expect(checks.checkNote(c(['first-then']), note('Showed the first\u2010then board.'))).toEqual([]);
    expect(checks.checkNote(c(['5 sec']), note('Within 5\u00a0sec of the instruction.'))).toEqual([]);
  });

  test('shorthand forms pass where the case allows them', () => {
    const two = caseOf2('sap', 'sap-two-step-instructions');
    expect(checks.checkNote(two, note('Follow within 5s, 80 % of opportunities, with his teacher, a point paired; probes for 4 wks.'))).toEqual([]);
    const vb = caseOf2('assess', 'assess-vbmapp-and-interview');
    expect(checks.checkNote(only(vb, 1), note('Scored VB-MAPP Level I.'))).toEqual([]);
    expect(checks.checkNote(only(vb, 1), note('Level II is half done.'))).toHaveLength(1);
    const plan = caseOf2('sup', 'sup-behavior-plan-change-pending');
    expect(checks.checkNote(only(plan, 0), note('BCBA thinks a minute warning is needed.'))).toEqual([]);
  });

  test('a missing fact names every form it looked for', () => {
    expect(checks.checkNote(c([['dad', 'father']]), note('Mom ran the trials.'))).toEqual(['missing from the note: "dad" or "father"']);
  });

  test('a single string stays exact, so a ruling is still pinned', () => {
    expect(checks.checkNote(c(['full physical']), note('Step 5 needed a physical prompt.'))).toEqual(['missing from the note: "full physical"']);
    expect(checks.checkNote(c(['mastery criteria']), note('Nose and ears hit mastery criteria.'))).toEqual([]);
  });

  test('a form counts only at the start of a word', () => {
    expect(checks.checkNote(c(['turn']), note('He will return to class.'))).toEqual(['missing from the note: "turn"']);
    expect(checks.checkNote(c(['turn']), note('He waited his turn.'))).toEqual([]);
  });
});

/* THE NOTE'S TEXT, IN THE NOTE'S ORDER. Kaleb, 9 Oct 2026: the report's `all`
   put every narrative after Summary of Concerns, as if they had landed in the
   wrong field. The tool lays them out right; the bench read innerText, which
   never carries a textarea's value, and tacked the values on at the end. */
test.describe('reading the note card', () => {
  const CARD = `<div data-testid="generated-note"><h2>Generated Note</h2>
    <div data-section-key="sessionStart" data-section-title="Session Start"><span>Session Start</span><button>Copy</button>
      <textarea data-section-id="sessionStart"></textarea></div>
    <div data-section-key="antecedentStrategies" data-section-title="Antecedent Strategies"><span>Antecedent Strategies</span><button>Copy</button>
      <div data-section-id="antecedentStrategies">
        <div data-option="Offered choices" data-on="1"><span>Offered choices</span></div>
        <div data-option="Visual schedule" data-on="0"><span>Visual schedule</span></div></div></div>
    <div data-section-key="concerns" data-section-title="Summary of Concerns"><span>Summary of Concerns</span><button>Copy</button>
      <textarea data-section-id="concerns"></textarea></div>
    <div data-section-key="goalsAnalyzed" data-section-title="Goals"><span>Goals</span>
      <div><span>Suggested goal: Climbing</span></div>
      <div data-goal-row="0"><input value="Tacting animals"><input value="Errorless, echoic at 0 sec"></div></div></div>`;

  test('each narrative sits under its own heading, and an unticked option is not in the note', async ({ page }) => {
    await page.setContent(CARD);
    await page.evaluate(() => {
      document.querySelector('textarea[data-section-id="sessionStart"]').value = 'Client walked in and greeted staff.';
      document.querySelector('textarea[data-section-id="concerns"]').value = '1. Bring a new token board.';
    });
    const out = await drive.readNote(page);
    expect(out.text).toEqual({ sessionStart: 'Client walked in and greeted staff.', concerns: '1. Bring a new token board.' });
    expect(out.all).toBe([
      'Session Start', 'Client walked in and greeted staff.', '',
      'Antecedent Strategies', 'Offered choices', '',
      'Summary of Concerns', '1. Bring a new token board.', '',
      'Goals', 'Tacting animals | Errorless, echoic at 0 sec',
    ].join('\n'));
    // The goal picker above the table is page, not note.
    expect(out.tables).toEqual({ goalsAnalyzed: ['Tacting animals | Errorless, echoic at 0 sec'] });
  });
});

/* Every case can be typed into its real page: a field label that matches no
   box, or a toggle with no such button, fails here for nothing instead of in a
   live run that costs drafts. */
test.describe('every bench case fits its page', () => {
  const files = ['parent', 'sup', 'bt', 'assess', 'sap']
    .map((t) => path.join(ROOT, `scripts/bench/cases/${t}.json`))
    .filter((f) => { try { readFileSync(f); return true; } catch { return false; } });
  for (const file of files) {
    const { tool, cases } = JSON.parse(readFileSync(file, 'utf8'));
    for (const c of cases) {
      test(`${tool}/${c.id}`, async ({ page }) => {
        await page.goto(c.page);
        await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), token());
        await page.goto(c.page);
        await drive.fillCase(page, c);
        for (const [label, text] of Object.entries(c.fields || {})) {
          await expect(page.getByRole('textbox', { name: new RegExp(label, 'i') })).toHaveValue(text);
        }
        for (const [label, value] of Object.entries(c.toggles || {})) {
          const row = page.locator('p', { hasText: label }).first().locator('xpath=following-sibling::div[1]');
          await expect(row.getByRole('button', { name: value, exact: true })).toHaveAttribute('aria-pressed', 'true');
        }
      });
    }
  }
});

/* THE CONSOLE BENCH (Kaleb, 2026-10-04, bench access B): the same run, pasted
 * into the console of a page he is logged in on. Pasted here into the local
 * page with the model stubbed, the parent file runs every case, presses Clear
 * between them so no case drafts with the last one's words, and reports. */
test.describe('the console bench', () => {
  test('every generated file is current with its cases and checks', () => {
    const run = spawnSync(process.execPath, ['scripts/bench/build-console.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
    expect(run.stdout).not.toContain('stale');
    expect(run.status).toBe(0);
  });

  test('pasted on the parent page, it runs each case after a Clear and reports', async ({ page }) => {
    test.setTimeout(120000);
    const seen = await stub(page, GOOD);
    await page.goto('/notes/parent/');
    let report = null;
    let failed = null;
    page.evaluate(readFileSync(path.join(ROOT, 'scripts/bench/console/parent.js'), 'utf8'))
      .then((r) => { report = r; }, (e) => { failed = e; });
    // The page runs on a fake clock, so time is moved on until the run ends.
    for (let i = 0; i < 600 && !report && !failed; i++) await page.clock.runFor(1000);
    expect(failed).toBeNull();

    expect(report.results.map((r) => r.id)).toEqual(CASES.map((c) => c.id));
    const v1 = report.results.find((r) => r.id === V1.id);
    expect(v1.fails).toEqual([]);
    expect(v1.asked[0].answered).toBe(true);
    expect(v1.typed.intake).toBe(97);
    expect(seen.drafts.length).toBe(CASES.length);
    // Each draft carries its own case and not the one before it.
    expect(seen.drafts[1]).not.toContain('Toilet Training');
  });
});

/* THE 9 OCT LIVE RUN, ONE TEST PER FAILURE. Kaleb ran the console bench on
 * tools.nooutco.me at main 80385c4a and all four parent cases failed. Each
 * failure is held here, against the local page with every model call stubbed,
 * so the same fault cannot come back unseen:
 *
 *   v1, v2, v4  "goal not named in the summary", and Follow Up read as empty.
 *               The corrections pass rewrote the summary and Follow Up, the
 *               page drew them as marks in place of a textarea, and the bench
 *               read only textareas. The note was there; the bench missed it.
 *   v1          Progress Status picked other than Moderate beside a client goal
 *               at 0/3 and caregiver goals at 85 to 100 percent.
 *   v3          "timed out waiting for Send to open": no truth entry answered
 *               the page's question, the round was held below the readiness
 *               bar, and Send does not exist while a round is held.
 *
 * Locally the corrections pass never answers (no model key), so before this
 * every bench test drew textareas only, which is how the gap hid. */
const byId = (id) => CASES.find((c) => c.id === id);
const V2 = byId('v2-missed-prompt-and-a-teacher');
const V3 = byId('v3-generalization-stated');
const V4 = byId('v4-no-bt-today');
const THIRD = 'Parent/Family is responding to training and generalization of skills is occurring. There are no barriers with their training.';

// One right draft per case, each meeting its parentExpect.
const DRAFTS = {
  [V1.id]: GOOD,
  [V2.id]: {
    individualsPresent: ['Parent/Caregiver', 'Client', 'Technician'],
    supportActivities: ['Modeled strategies/interventions'],
    caregiverResponse: MIDDLE,
    progressStatus: 'Moderate progress towards goals',
    summary: 'Client ran Manding for Breaks at independent, 3/2, 60%; both errors were grabbing the break card without saying "break". Elopement (Bx Reduction) occurred once and Caregiver blocked it. Caregiver ran Present Token Board Before Demand at 4/1, 80%, and missed presenting the board once before a demand. BCBA modeled it and Caregiver did the next 2 on her own.',
    followup: 'Meet with the teacher and Caregiver to set up the same token board at school.',
    hints: [],
  },
  [V3.id]: {
    individualsPresent: ['Parent/Caregiver', 'Client', 'Technician'],
    supportActivities: ['Collected data on current goals'],
    caregiverResponse: THIRD,
    progressStatus: 'Substantial progress towards goals',
    summary: 'Caregivers ran Use First-Then Language at Home at 5/0, 100%, and in the Community at 4/0, 100%, including at the grocery store without a reminder. Client ran Waiting at 2 minutes, 4/0, 100%, with a visual timer in the checkout line.',
    followup: 'Make a first-then card for Caregiver to use at church.',
    hints: [],
  },
  [V4.id]: {
    individualsPresent: ['Parent/Caregiver', 'Client'],
    supportActivities: ['Collected data on current goals'],
    caregiverResponse: MIDDLE,
    progressStatus: 'Moderate progress towards goals',
    summary: 'Caregiver ran Point to Next Picture at 3/1, 75%, and gave a vocal direction only before the 4th transition. Client ran Transitions Between Activities with visual at 3/0, 100%, each under 1 min.',
    followup: 'Review fading the visual schedule with the BT when the BT is present.',
    hints: [],
  },
};

// Which case a request is about, by a phrase only that case's notes carry.
const caseOf = (text) => (text.includes('Toilet Training') ? V1.id
  : text.includes('Manding for Breaks') ? V2.id
    : text.includes('First-Then') ? V3.id : V4.id);

// The first triage round per case. v3's question is one its truth cannot
// answer, at a readiness below the bar, so the page holds the round.
const FIRST_ROUND = {
  [V1.id]: { readiness: 60, question: 'You wrote 0/3 on the one-step instruction. What happened on those trials?' },
  [V2.id]: { readiness: 70, question: 'Was the teacher at the session, or did she ask to meet?' },
  [V3.id]: { readiness: 60, question: 'Which timer setting was used in the checkout line?' },
  [V4.id]: { readiness: 70, question: 'Was a BT present for any part of the session?' },
};

/* Every call stubbed: triage by case, the draft by case, the expert quiet, and
   a corrections pass that ADDS one clause to the summary and one item to
   Follow Up, as the live pass does, so both are drawn as marks. */
async function stubLive(page, { draft = (id) => DRAFTS[id], corrected = null } = {}) {
  const seen = { triaged: {}, drafts: [] };
  await page.route('**/api/llm-call**', (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const text = JSON.stringify(b.messages || []);
    const id = caseOf(text);
    if (isTriageCall(b)) {
      const first = !seen.triaged[id];
      seen.triaged[id] = true;
      const r = FIRST_ROUND[id];
      return route.fulfill(reply(first
        ? { sufficient: false, readiness: r.readiness, questions: [{ field: 'sessionNotes', question: r.question, suggestions: [] }] }
        : { sufficient: true, readiness: 90, questions: [] }));
    }
    seen.drafts.push(text);
    return route.fulfill(reply(draft(id)));
  });
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ terms: [], register: [], hints: [] }) }));
  await page.route('**/api/corrections-pass**', (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const id = caseOf(String(body.intake || ''));
    const sections = Object.fromEntries((body.draft || []).map((d) => [d.id, d.text]));
    const fixed = corrected ? corrected(id, sections) : {
      summary: sections.summary + ' Data were collected on each goal.',
      followup: sections.followup + '\nShare the session data with Caregiver.',
    };
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        corrections: Object.entries(fixed).map(([section, text]) => ({ section, text, why: 'Your notes say so.', reasons: [] })),
        dropped: 0, usage: { input_tokens: 10, output_tokens: 5 }, model: 'test',
      }),
    });
  });
  await page.clock.install();
  await page.goto('/notes/parent/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), token());
  return seen;
}

const LIVE = { unlockSend: (p) => p.clock.runFor(61_000), timeoutMs: 30000, settleMs: 3000, lockWaitMs: 15000 };

test.describe('the 9 Oct live run: each failure is caught', () => {
  for (const c of [V1, V2, V4]) {
    test(`${c.id}: a summary and Follow Up the corrections pass rewrote are read as the note shows them`, async ({ page }) => {
      await stubLive(page);
      const out = await drive.runCase(page, c, LIVE);
      await expect(page.locator('[data-corrections-section="summary"]')).toBeVisible();
      await expect(page.locator('[data-corrections-section="followup"]')).toBeVisible();
      expect(out.note.text.summary).toContain('Data were collected on each goal.');
      expect(out.note.text.followup.split('\n')).toContain('Share the session data with Caregiver.');
      expect(checks.checkNote(c, out.note)).toEqual([]);
    });
  }

  test('a goal the corrections pass took out of the summary is named as missing', async ({ page }) => {
    await stubLive(page, {
      corrected: (id, s) => ({ summary: s.summary.replace('Caregiver ran Point to Next Picture at 3/1, 75%, and gave', 'Caregiver gave') }),
    });
    const out = await drive.runCase(page, V4, LIVE);
    expect(checks.checkNote(V4, out.note)).toEqual(['goal not named in the summary: "Point to Next Picture"']);
  });

  for (const pick of ['Substantial progress towards goals', 'Minimal progress towards goals']) {
    test(`v1: "${pick}" beside a client goal at 0/3 and caregiver goals at 85 to 100 percent becomes Moderate`, async ({ page }) => {
      await stubLive(page, { draft: (id) => ({ ...DRAFTS[id], progressStatus: pick }) });
      const out = await drive.runCase(page, V1, LIVE);
      expect(out.note.picks.progressStatus).toEqual(['Moderate progress towards goals']);
      expect(checks.checkNote(V1, out.note)).toEqual([]);
    });
  }

  test('v3: a held round no truth answers is answered as a user would, and the note drafts', async ({ page }) => {
    const seen = await stubLive(page);
    const out = await drive.runCase(page, V3, LIVE);
    expect(out.held).toEqual([1]);
    expect(out.asked).toEqual([{ round: 1, question: FIRST_ROUND[V3.id].question, answered: false, truth: null, matchedOn: [], answer: null }]);
    expect(seen.drafts.join('\n')).toContain(drive.HELD_ROUND_ANSWER);
    expect(checks.checkNote(V3, out.note)).toEqual([]);
  });

  test('pasted on the parent page, the console bench reads marked sections and answers a held round', async ({ page }) => {
    test.setTimeout(180000);
    await stubLive(page);
    await page.goto('/notes/parent/');
    let report = null;
    let failed = null;
    page.evaluate(readFileSync(path.join(ROOT, 'scripts/bench/console/parent.js'), 'utf8'))
      .then((r) => { report = r; }, (e) => { failed = e; });
    for (let i = 0; i < 900 && !report && !failed; i++) await page.clock.runFor(1000);
    expect(failed).toBeNull();
    expect(report.results.map((r) => [r.id, r.fails])).toEqual(CASES.map((c) => [c.id, []]));
    expect(report.results.find((r) => r.id === V3.id).held).toEqual([1]);
  });
});
