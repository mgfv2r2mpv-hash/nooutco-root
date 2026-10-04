import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* THE EARLIER ROUNDS STAY IN REACH.
 *
 * Approved 3 Oct 2026 (Q6 on his Parent Note Review). Once a second round of
 * questions opens, the first round's questions and the answers he gave leave
 * the panel. One chip above the new questions, "N answered earlier", opens to
 * show them, round by round, in the words he saw, and folds back. It is
 * display only: what the model reads is still the Q:/A: block, once. */

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
const Q_NEXT = 'How long did the session run after the second elopement?';
const TYPED = 'Both times he walked back to the table on his own.';
const PICK_B ='The first-then board worked better once we were down there.';

const ROUND_1 = {
  sufficient: false, readiness: 60,
  questions: [
    { field: 'fAntecedent', question: Q_FLOOR, suggestions: ['Moving to the floor settled him faster.', PICK_B] },
    { field: 'fBehavior', question: Q_ELOPE, suggestions: ['Both ended with a block and a redirect.'] },
  ],
};
const ROUND_2 = {
  sufficient: false, readiness: 75,
  questions: [{ field: 'fBehavior', question: Q_NEXT, suggestions: [] }],
};

/* Triage answers ROUND_1, then ROUND_2 on the first call that carries answers,
   then says it has enough. */
async function openFirstRound(page) {
  const seen = { notes: [], triage: [] };
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const last = (b.messages && b.messages.length) ? String(b.messages[b.messages.length - 1].content || '') : '';
    if (/look at your own draft again/i.test(last)) return route.fulfill(reply(note()));
    if (isTriageCall(b)) {
      seen.triage.push(last);
      if (!/ALREADY ANSWERED/.test(last)) return route.fulfill(reply(ROUND_1));
      if (!seen.servedSecond) { seen.servedSecond = true; return route.fulfill(reply(ROUND_2)); }
      return route.fulfill(reply({ sufficient: true, readiness: 90, questions: [] }));
    }
    seen.notes.push(String(b.messages[0].content));
    return route.fulfill(reply(note()));
  });
  await page.clock.install();
  await page.goto('/notes/bt/');
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto('/notes/bt/');
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, needed full physical most of it');
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

  await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
  return seen;
}

async function openSecondRound(page) {
  const seen = await openFirstRound(page);
  await page.locator('[data-suggestion-tick="0:1"]').click();
  // A typed line asks for another round; an empty Send skips to the draft.
  const box = page.locator('.revision-input');
  await box.fill(TYPED);
  await box.press('Enter');
  await expect(page.getByText(Q_NEXT)).toBeVisible({ timeout: 20000 });
  return seen;
}

test.describe('the earlier-rounds chip', () => {
  test('is not there on the first round', async ({ page }) => {
    await openFirstRound(page);
    await expect(page.locator('.earlier-rounds')).toHaveCount(0);
  });

  test('reads "2 answered earlier" on round two, closed, with the new question leading', async ({ page }) => {
    await openSecondRound(page);
    const chip = page.locator('.earlier-rounds-chip');
    await expect(chip).toHaveText(/2 answered earlier/);
    await expect(chip).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.earlier-q')).toHaveCount(0);
  });

  test('opens to each earlier question with what was answered, and folds back', async ({ page }) => {
    await openSecondRound(page);
    const chip = page.locator('.earlier-rounds-chip');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-expanded', 'true');

    const pairs = page.locator('.earlier-pair');
    await expect(pairs).toHaveCount(2);
    await expect(pairs.nth(0).locator('.earlier-q')).toHaveText(Q_FLOOR);
    await expect(pairs.nth(0).locator('.earlier-a')).toHaveText(PICK_B);
    await expect(pairs.nth(1).locator('.earlier-q')).toHaveText(Q_ELOPE);
    // The panel box answers the question left open, as it does in what is sent.
    await expect(pairs.nth(1).locator('.earlier-a')).toHaveText(TYPED);
    // One earlier round, so no round label.
    await expect(page.locator('.earlier-round-label')).toHaveCount(0);

    // Opened, it scrolls on its own rather than growing past 40% of the screen.
    const cap = await page.locator('.earlier-rounds-list').evaluate((el) => el.getBoundingClientRect().height / window.innerHeight);
    expect(cap).toBeLessThanOrEqual(0.41);

    await chip.click();
    await expect(page.locator('.earlier-q')).toHaveCount(0);
  });

  test('adds nothing to what is sent: each earlier answer reaches the note once', async ({ page }) => {
    const seen = await openSecondRound(page);
    await page.locator('.earlier-rounds-chip').click();
    await page.locator('.revision-send').click();
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });

    expect(seen.notes).toHaveLength(1);
    const content = seen.notes[0];
    expect(content.split(`Q: ${Q_FLOOR}\nA: ${PICK_B}`)).toHaveLength(2);
    expect(content.split(`Q: ${Q_ELOPE}\nA: ${TYPED}`)).toHaveLength(2);
    expect(content).not.toContain('answered earlier');
    expect(content).not.toContain('Not refined');
  });

  test('is gone once the note is drafted', async ({ page }) => {
    await openSecondRound(page);
    await page.locator('.revision-send').click();
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.earlier-rounds')).toHaveCount(0);
  });
});
