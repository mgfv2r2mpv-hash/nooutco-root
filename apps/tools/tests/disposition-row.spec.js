import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The four answers, in words, with nothing sitting in the reading path.
 *
 * The row this replaces put a tick beside every accepted sentence and a cross
 * beside every dropped one, and opened an arrow and a pencil when you clicked.
 * The maintainer's verdict on it: "not the thing with the inline check and exes
 * that I had requested. I hate it and it looks stupid and makes it hard to read
 * and use. but indicate the changes and have them default accepted (low weight
 * for style) or staff can edit (strongest signal), approve (stronger weight for
 * style), or reject/revert (also a signal for style in its manner)".
 *
 * So there are two separate things to hold here and the tests split on them.
 *
 * WHAT IS GONE: no glyph in the resting row. A technician reading the note reads
 * sentences, and the majority case, which is agreeing, costs nothing at all.
 *
 * WHAT IS NEW: approve. The old contract could tell reverting, rewording and
 * doing nothing apart, and doing nothing is the weakest evidence there is,
 * because a technician who never read the sentence and one who read it and
 * agreed leave the same trace. Approve separates them, which is the entire
 * reason it is worth a tap.
 */

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
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

const ONE = {
  sufficient: false, readiness: 70,
  questions: [{
    field: 'fAntecedent', bar: '',
    question: 'You wrote that you moved to the floor. Was that in the plan?',
    suggestions: ['Moving to the floor settled him faster than the break did.'],
  }],
};

const TWO = {
  sufficient: false, readiness: 70,
  questions: [{
    field: 'fAntecedent', bar: '',
    question: 'You wrote that you moved to the floor. Was that in the plan?',
    suggestions: [
      'Moving to the floor settled him faster than the break did.',
      'The first-then board worked better once we were down there.',
    ],
  }],
};

async function ask(page, triage, { aid = true } = {}) {
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const last = (b.messages && b.messages.length) ? String(b.messages[b.messages.length - 1].content || '') : '';
    if (/look at your own draft again/i.test(last)) return route.fulfill(reply(note()));
    if (isTriageCall(b)) {
      if (/ALREADY ANSWERED/.test(last)) return route.fulfill(reply({ sufficient: true, readiness: 90, questions: [] }));
      return route.fulfill(reply(triage));
    }
    return route.fulfill(reply(note()));
  });

  const url = aid ? '/notes/bt/?aid=1' : '/notes/bt/';
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto(url);
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
}

const row = (page, id) => page.locator(`[data-disposition="${id}"]`);

test.describe('what the tool added', () => {
  /* THE CONTROL. Without the flag the technicians get the row they have today,
     ticks and all. If this fails, the flag has stopped being a flag. */
  test('without the flag the pencil-and-checkmark row is still what renders', async ({ page }) => {
    await ask(page, ONE, { aid: false });
    // The chosen row carries the pencil and no drop control: declining is done
    // by keying your own words. His rulings, 2026-09-21 and 2026-09-22.
    await expect(page.locator('[data-suggestion-pencil="0:0"]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-suggestion-tick="0:0"]')).toHaveCount(0);
    await expect(page.locator('[data-disposition="0:0"]')).toHaveCount(0);
  });

  test('with the flag there is no tick and no cross anywhere on the row', async ({ page }) => {
    await ask(page, ONE);
    await expect(row(page, '0:0')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-suggestion-tick]')).toHaveCount(0);
    await expect(page.locator('[data-suggestion-pencil]')).toHaveCount(0);
    await expect(page.locator('[data-suggestion-revert]')).toHaveCount(0);
    await expect(row(page, '0:0')).not.toContainText('✓');
    await expect(row(page, '0:0')).not.toContainText('✗');
  });

  test('a heading says in words that the tool added this and it is already in', async ({ page }) => {
    await ask(page, ONE);
    await expect(row(page, '0:0')).toBeVisible({ timeout: 20000 });
    const head = page.locator('.dz-head');
    await expect(head).toContainText('Added to the note by NoMe');
  });

  /* The resting state is agreement, so it says nothing. */
  test('the resting row is the sentence and no state word', async ({ page }) => {
    await ask(page, ONE);
    const r = row(page, '0:0');
    await expect(r).toBeVisible({ timeout: 20000 });
    await expect(r).toHaveAttribute('data-disposition-state', 'default');
    await expect(r).toContainText('Moving to the floor settled him faster');
    await expect(r.locator('.dz-mark')).toHaveCount(0);
  });

  test('tapping the sentence offers three answers, each of them a word', async ({ page }) => {
    await ask(page, ONE);
    await row(page, '0:0').click({ timeout: 20000 });
    await expect(page.locator('[data-disposition-approve="0:0"]')).toHaveText('Approve');
    await expect(page.locator('[data-disposition-editbtn="0:0"]')).toHaveText('Edit');
    await expect(page.locator('[data-disposition-revert="0:0"]')).toHaveText('Remove it');
  });

  test('approve records the stronger signal and says so quietly', async ({ page }) => {
    await ask(page, ONE);
    await row(page, '0:0').click({ timeout: 20000 });
    await page.locator('[data-disposition-approve="0:0"]').click();
    await expect(row(page, '0:0')).toHaveAttribute('data-disposition-state', 'approved');
    await expect(row(page, '0:0').locator('.dz-mark')).toHaveText('approved');
    // Approving changes nothing in the note. The sentence was already in.
    await expect(row(page, '0:0')).toContainText('Moving to the floor settled him faster');
  });

  test('editing keeps the technician wording and marks it the strongest answer', async ({ page }) => {
    await ask(page, ONE);
    await row(page, '0:0').click({ timeout: 20000 });
    await page.locator('[data-disposition-editbtn="0:0"]').click();
    const box = page.locator('[data-disposition-edit="0:0"]');
    await box.fill('He settled faster on the floor than he did with a break.');
    await page.locator('[data-disposition-save="0:0"]').click();
    await expect(row(page, '0:0')).toHaveAttribute('data-disposition-state', 'edited');
    await expect(row(page, '0:0')).toContainText('He settled faster on the floor');
    await expect(row(page, '0:0').locator('.dz-mark')).toHaveText('edited');
  });

  test('removing it says removed and leaves the sentence readable', async ({ page }) => {
    await ask(page, ONE);
    await row(page, '0:0').click({ timeout: 20000 });
    await page.locator('[data-disposition-revert="0:0"]').click();
    await expect(row(page, '0:0')).toHaveAttribute('data-disposition-state', 'reverted');
    await expect(row(page, '0:0').locator('.dz-mark')).toHaveText('removed');
    // Not struck through: a technician has to be able to read the thing they
    // are deciding about.
    const deco = await row(page, '0:0').evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(deco).not.toContain('line-through');
  });

  /* Alternatives change what the words MEAN without changing that they are
     words. One of two answers is not rejected, it is simply not the one they
     picked, and saying "removed" would misreport what they did. */
  test('one of several answers reads as not chosen, never as removed', async ({ page }) => {
    await ask(page, TWO);
    await expect(row(page, '0:1')).toBeVisible({ timeout: 20000 });
    await expect(row(page, '0:1')).toHaveAttribute('data-disposition-state', 'reverted');
    await expect(row(page, '0:1').locator('.dz-mark')).toHaveText('not chosen');

    await row(page, '0:1').click();
    await expect(page.locator('[data-disposition-revert="0:1"]')).toHaveText('Use this one');
    await page.locator('[data-disposition-revert="0:1"]').click();
    await expect(row(page, '0:1')).toHaveAttribute('data-disposition-state', 'default');
    await expect(row(page, '0:0')).toHaveAttribute('data-disposition-state', 'reverted');
    await expect(row(page, '0:0').locator('.dz-mark')).toHaveText('not chosen');
  });
});
