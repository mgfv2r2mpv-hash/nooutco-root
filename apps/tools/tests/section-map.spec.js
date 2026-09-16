import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The section map answers one question and guards one promise.
 *
 * THE QUESTION is the one a technician carries the whole way down a note on a
 * phone: what have I not pasted into the EHR yet. Nothing on the page answered
 * it, because the per-section Copy button flashed a tick for 1800ms and forgot.
 *
 * THE PROMISE is the harder half. A section already in the EHR can legitimately
 * change afterwards, because a behaviour datum entered late belongs in the
 * picture of how the client showed up. The first design locked a copied section
 * to stop that, and the maintainer overruled it: "lock on copy isn't a
 * solution". So the tool has to let the change happen and then keep saying so
 * until the technician has dealt with it. That is the copied to changed
 * transition, and it is the test that matters most here.
 *
 * The flag is the control. Everything in this file is gated on ?aid=1, and the
 * first test proves the page without the flag is the page that shipped.
 */

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const NOTE = {
  individualsPresent: ['Client'],
  clinicalStatus: ['Presented Calm'],
  clinicalStatusNarrative: 'The client met the technician at the door and settled quickly.',
  purpose: ['Worked on goals as stated in the treatment plan'],
  servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'Eight of ten trials came back correct with a gestural prompt. The prompt was faded by the sixth trial.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'A two minute warning preceded each transition and the client moved without protest.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions and the technician blocked the door and redirected.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
};

async function draft(page, { aid = true } = {}) {
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(NOTE));
  });

  const url = aid ? '/notes/bt/?aid=1' : '/notes/bt/';
  await page.goto(url);
  await page.evaluate(() => localStorage.clear());
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto(url);

  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, 8 of 10 gestural');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('two minute warning before transitions');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();

  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
}

const tile = (page, id) => page.locator(`[data-section-tile="${id}"]`);
const SECTION = 'behaviorPlanNarrative';

test.describe('the section map', () => {
  /* THE CONTROL. Remove ?aid=1 and the page is the one the technicians use
     today. If this ever fails, the flag has stopped being a flag. */
  test('without the flag the page renders no strip at all', async ({ page }) => {
    await draft(page, { aid: false });
    await expect(page.locator('.section-map')).toHaveCount(0);
    await expect(page.locator('[data-section-tile]')).toHaveCount(0);
  });

  test('every section starts as not copied, and the summary says so in words', async ({ page }) => {
    await draft(page);
    const tiles = page.locator('[data-section-tile]');
    await expect(tiles.first()).toBeVisible();
    const total = await tiles.count();
    expect(total).toBeGreaterThan(3);
    await expect(page.locator('[data-section-tile][data-state="pending"]')).toHaveCount(total);
    await expect(page.locator('.section-map-head')).toContainText('nothing copied yet');
  });

  /* Every tile carries its state as a word. A technician who does not see the
     orange reads the same strip as one who does, so the word is not decoration
     and a change that drops it is a regression. */
  test('each tile states its condition in words, not only in colour', async ({ page }) => {
    await draft(page);
    await expect(tile(page, SECTION).locator('.section-tile-state')).toHaveText('not copied');
    await page.locator(`[data-section-key="${SECTION}"] button`, { hasText: 'Copy' }).first().click();
    await expect(tile(page, SECTION).locator('.section-tile-state')).toHaveText('copied');
  });

  test('copying a section marks that section and no other', async ({ page }) => {
    await draft(page);
    await page.locator(`[data-section-key="${SECTION}"] button`, { hasText: 'Copy' }).first().click();
    await expect(tile(page, SECTION)).toHaveAttribute('data-state', 'copied');
    await expect(page.locator('[data-section-tile][data-state="copied"]')).toHaveCount(1);
    await expect(page.locator('.section-map-head')).toContainText('1 copied');
  });

  /* THE ONE THAT MATTERS. This is the behaviour the lock was invented to
     prevent and the maintainer overruled. The edit must be allowed, and the
     strip must report that the EHR is now behind. */
  test('a section that changes after it was copied says so, and keeps saying so', async ({ page }) => {
    await draft(page);
    await page.locator(`[data-section-key="${SECTION}"] button`, { hasText: 'Copy' }).first().click();
    await expect(tile(page, SECTION)).toHaveAttribute('data-state', 'copied');

    const field = page.locator(`textarea[data-section-id="${SECTION}"]`);
    await field.fill(await field.inputValue() + ' The client engaged in aggression when staff arrived.');

    await expect(tile(page, SECTION)).toHaveAttribute('data-state', 'changed');
    await expect(tile(page, SECTION).locator('.section-tile-state')).toHaveText('changed');
    await expect(page.locator('.section-map-head')).toContainText('changed since you copied it');

    // It persists. A toast would have died here; the strip is still saying it.
    await page.locator(`textarea[data-section-id="lessonProgressNarrative"]`).click();
    await expect(tile(page, SECTION)).toHaveAttribute('data-state', 'changed');
  });

  test('tapping the changed tile re-copies it and clears the state', async ({ page }) => {
    await draft(page);
    await page.locator(`[data-section-key="${SECTION}"] button`, { hasText: 'Copy' }).first().click();
    const field = page.locator(`textarea[data-section-id="${SECTION}"]`);
    await field.fill(await field.inputValue() + ' Aggression occurred on arrival.');
    await expect(tile(page, SECTION)).toHaveAttribute('data-state', 'changed');

    await tile(page, SECTION).click();
    await expect(tile(page, SECTION)).toHaveAttribute('data-state', 'copied');
  });

  /* PRIVACY. A mark records a hash and a timestamp. If the note's prose ever
     gets stored here it is a second copy of the note on the device, which is
     exactly the thing the encrypted draft exists to avoid. */
  test('a copy mark stores a number and a time, never the words', async ({ page }) => {
    await draft(page);
    const text = await page.locator(`textarea[data-section-id="${SECTION}"]`).inputValue();
    await page.locator(`[data-section-key="${SECTION}"] button`, { hasText: 'Copy' }).first().click();
    await expect(tile(page, SECTION)).toHaveAttribute('data-state', 'copied');

    const marks = await page.evaluate(() => window.NotesGate.draft.load('bt::copied'));
    const mark = marks[SECTION];
    expect(Object.keys(mark).sort()).toEqual(['at', 'h']);
    expect(typeof mark.h).toBe('number');
    expect(JSON.stringify(marks)).not.toContain('Elopement');
    expect(JSON.stringify(marks)).not.toContain(text.slice(0, 20));
  });

  test('clearing the note forgets what was pasted', async ({ page }) => {
    await draft(page);
    await page.locator(`[data-section-key="${SECTION}"] button`, { hasText: 'Copy' }).first().click();
    await expect(tile(page, SECTION)).toHaveAttribute('data-state', 'copied');

    await page.evaluate(() => { window.confirm = () => true; });
    const clear = page.getByRole('button', { name: /^Clear/ });
    if (await clear.isVisible().catch(() => false)) {
      await clear.click();
      const confirmBtn = page.getByRole('button', { name: /Clear everything|Yes|Confirm/i });
      if (await confirmBtn.isVisible({ timeout: 1500 }).catch(() => false)) await confirmBtn.click();
      const stored = await page.evaluate(() => window.NotesGate.draft.load('bt::copied'));
      expect(stored === null || Object.keys(stored || {}).length === 0).toBe(true);
    }
  });
});
