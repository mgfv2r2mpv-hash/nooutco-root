import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* EACH ANSWER TRAVELS WITH THE QUESTION IT ANSWERS.
 *
 * Approved 2 Oct 2026, from the diagnosis of one bad production Supervision
 * note. The kept suggestions and the own-words rows were appended to the
 * model's input as bare lines, with nothing saying which question each one
 * answered. The model could not attach an answer to a goal, so it tacked the
 * answers on at the end of the note. Answers typed in place already carried
 * their question; the picks and the own words did not.
 *
 * The pairing must not open a hole in the scrub. The question on screen has
 * been restored, so it holds words the scrub took out of the intake. It goes
 * through the same gate as the answer, and it goes out under the note's
 * carried map, so a word the intake sent as a token goes out as THAT token
 * again and not as a fresh one the model cannot match to the intake.
 */

function tokenFor(tools = ['bt']) {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const note = () => ({
  individualsPresent: ['Client'], clinicalStatus: ['Presented Tired'],
  clinicalStatusNarrative: 'The client presented as tired on arrival today.',
  purpose: ['Worked on goals as stated in the treatment plan'], servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'Choices were offered before each demand presented.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions during the session.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
});

const Q_FLOOR = 'You wrote that you moved to the floor. Was that in the plan?';
const Q_ELOPE = 'How did the two elopements end?';
const PICK_A = 'Moving to the floor settled him faster than the break did.';
const PICK_B = 'The first-then board worked better once we were down there.';
const ELOPE_PICK = 'Both ended with a block and a redirect to the table.';

const ROUND = {
  sufficient: false, readiness: 70,
  questions: [
    { field: 'fAntecedent', question: Q_FLOOR, suggestions: [PICK_A, PICK_B] },
    { field: 'fBehavior', question: Q_ELOPE, suggestions: [ELOPE_PICK] },
  ],
};

async function ask(page, triage, { skill = 'DTT money 3 item array, needed full physical most of it', aid = false } = {}) {
  const seen = { notes: [], triage: [] };
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const last = (b.messages && b.messages.length) ? String(b.messages[b.messages.length - 1].content || '') : '';
    if (/look at your own draft again/i.test(last)) return route.fulfill(reply(note()));
    if (isTriageCall(b)) {
      seen.triage.push(last);
      if (/ALREADY ANSWERED/.test(last)) return route.fulfill(reply({ sufficient: true, readiness: 90, questions: [] }));
      return route.fulfill(reply(typeof triage === 'function' ? triage(last) : triage));
    }
    seen.notes.push(String(b.messages[0].content));
    return route.fulfill(reply(note()));
  });
  await page.clock.install();
  const url = aid ? '/notes/bt/?aid=1' : '/notes/bt/';
  await page.goto(url);
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto(url);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill(skill);
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board, also moved to the floor and he settled');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  return seen;
}

const sendEmpty = async (page) => {
  await page.clock.runFor(61_000);
  const send = page.locator('.revision-send');
  await expect(send).toBeEnabled();
  await send.click();
};

test.describe('an answer goes out with its question', () => {
  test('a kept pick reaches the note request directly under the question it answers', async ({ page }) => {
    const seen = await ask(page, ROUND);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await page.locator('[data-suggestion-tick="0:1"]').click();

    await sendEmpty(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    expect(seen.notes).toHaveLength(1);
    const content = seen.notes[0];
    expect(content).toContain(`Q: ${Q_FLOOR}\nA: ${PICK_B}`);
    expect(content).toContain(`Q: ${Q_ELOPE}\nA: ${ELOPE_PICK}`);
    // The struck alternative goes nowhere, paired or not.
    expect(content).not.toContain(PICK_A);
  });

  test('the own-words row is paired with its question too', async ({ page }) => {
    const seen = await ask(page, ROUND);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    const own = page.locator('[data-suggestion-own="1:own"]');
    await own.fill('He walked back to the table on his own the second time.');
    await own.press('Enter');

    await sendEmpty(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    const content = seen.notes[0];
    expect(content).toContain(`Q: ${Q_ELOPE}\nA: He walked back to the table on his own the second time.`);
    expect(content).not.toContain(ELOPE_PICK);
  });

  test('a typed Send keeps the picks paired and adds the typed line after them', async ({ page }) => {
    const seen = await ask(page, ROUND);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });

    const box = page.locator('.revision-input');
    await box.fill('He also asked for the tablet twice.');
    await box.press('Enter');
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });

    // The typed line triggers a second triage round; it reads the pairs too.
    const second = seen.triage.find((t) => /ALREADY ANSWERED/.test(t));
    expect(second).toContain(`Q: ${Q_FLOOR}\nA: ${PICK_A}`);

    const content = seen.notes[0];
    expect(content).toContain(`Q: ${Q_FLOOR}\nA: ${PICK_A}`);
    expect(content).toContain(`Q: ${Q_ELOPE}\nA: ${ELOPE_PICK}`);
    expect(content).toContain('He also asked for the tablet twice.');
    expect(content.indexOf('He also asked for the tablet twice.'))
      .toBeGreaterThan(content.indexOf(`A: ${ELOPE_PICK}`));
  });

  test('an answer typed in place and a pick on the same question both sit under it', async ({ page }) => {
    const seen = await ask(page, ROUND, { aid: true });
    await expect(page.locator('[data-question-answer="1"]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-question-answer="1"]').fill('Both were shorter than last week.');
    await page.locator('.revision-send').click();
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });

    const content = seen.notes[0];
    expect(content).toContain(`Q: ${Q_ELOPE}\nA: ${ELOPE_PICK}\nA: Both were shorter than last week.`);
    // One question, one block: the question is not repeated for the typed answer.
    expect(content.split(`Q: ${Q_ELOPE}`)).toHaveLength(2);
  });
});

test.describe('the pairing keeps the scrub whole', () => {
  /* "Kite Puzzle" stands in for a program title the scrub takes as an opaque
     token. The model echoes the token in its question, the page restores it on
     screen, and the pair goes back out. It has to go back out as the SAME
     token, or the model reads an answer about a goal it was never told about. */
  const ROUND_WITH_TOKEN = (intake) => {
    const token = (intake.match(/\[\[T\d+\]\]/) || [''])[0];
    return {
      sufficient: false, readiness: 70,
      questions: [{
        field: 'fSkill',
        question: `How many trials of ${token} were run?`,
        suggestions: [],
      }],
    };
  };

  test('a restored word in the question goes out as the token the intake used, and a name in the answer is masked', async ({ page }) => {
    const seen = await ask(page, ROUND_WITH_TOKEN, { skill: 'DTT on the Kite Puzzle program, needed full physical most of it' });
    await expect(page.getByText(/How many trials of Kite Puzzle were run/i)).toBeVisible({ timeout: 20000 });
    const intakeToken = (seen.triage[0].match(/\[\[T\d+\]\]/) || [''])[0];
    expect(intakeToken, 'the intake sent the program title as an opaque token').not.toBe('');
    expect(seen.triage[0]).not.toContain('Kite Puzzle');

    const box = page.locator('.revision-input');
    await box.fill('Ten trials, and it went well with Jacob.');
    await box.press('Enter');
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });

    const content = seen.notes[0];
    expect(content).toContain(`Q: How many trials of ${intakeToken} were run?`);
    expect(content).not.toContain('Kite Puzzle');
    expect(content).not.toMatch(/jacob/i);
    for (const body of seen.triage) {
      expect(body).not.toContain('Kite Puzzle');
      expect(body).not.toMatch(/jacob/i);
    }
  });
});
