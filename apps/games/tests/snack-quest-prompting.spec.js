import { test, expect } from '@playwright/test';
import { bootstrap, chooseTask, choosePlace, waitIdle, peek } from './lib/snack-quest.js';

/**
 * Prompting has two jobs that pull against each other: the prompt level has to
 * be recorded, and for a learner working at a prompted level it must not cost
 * them the snack. The setting decides the second; the first is never optional.
 */
test.describe('Snack Quest - prompting', () => {
  test('the Prompt button is offered on the tap-scored tasks, not on expressive', async ({ page }) => {
    await bootstrap(page);
    await chooseTask(page, 'matching');
    await choosePlace(page, 'countryside');
    await expect(page.locator('#prompt-row')).toBeVisible();
    await expect(page.locator('#score-row')).toBeHidden();
  });

  test('expressive scores the prompt in its own row instead', async ({ page }) => {
    await bootstrap(page);
    await chooseTask(page, 'expressive');
    await choosePlace(page, 'countryside');
    // Expressive is scored after the fact by the technician, so a
    // declare-first button would be redundant with its Prompted button.
    await expect(page.locator('#prompt-row')).toBeHidden();
    await expect(page.locator('.score-btn[data-score="prompted"]')).toBeVisible();
  });

  test('using the Prompt button marks the trial and shows the answer', async ({ page }) => {
    await bootstrap(page);
    await chooseTask(page, 'matching');
    await choosePlace(page, 'countryside');

    await page.click('#btn-prompt');
    await expect(page.locator('#prompt-flag')).toBeVisible();
    await expect(page.locator('#trial-grid .pick.is-prompted')).toHaveCount(1);

    const idx = (await peek(page)).correctIndex;
    await expect(page.locator(`#trial-grid .pick[data-index="${idx}"]`)).toHaveClass(/is-prompted/);

    await page.click(`#trial-grid .pick[data-index="${idx}"]`);
    await waitIdle(page);
    const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('nooutco.results.snackQuest') || '[]'));
    expect(rows[0].prompted).toBe(true);
  });

  test('prompts do not advance the ratio by default', async ({ page }) => {
    await bootstrap(page, { scheduleValue: 1, goalTokens: 3, promptsEarn: false });
    await chooseTask(page, 'expressive');
    await choosePlace(page, 'sky');

    // FR1 would deliver on any earning response, so a prompted one delivering
    // nothing is unambiguous evidence the setting is off.
    await page.click('.score-btn[data-score="prompted"]');
    await waitIdle(page);
    expect((await peek(page)).collected).toHaveLength(0);
  });

  test('prompts earn when the technician allows it, and stay recorded as prompted', async ({ page }) => {
    await bootstrap(page, { scheduleValue: 1, goalTokens: 3, promptsEarn: true });
    await chooseTask(page, 'expressive');
    await choosePlace(page, 'sky');

    await page.click('.score-btn[data-score="prompted"]');
    await waitIdle(page);
    expect((await peek(page)).collected).toHaveLength(1);

    // Earning must not launder the prompt out of the data - that would trade a
    // clinical record for a kindness, which is not the trade being made.
    const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('nooutco.results.snackQuest') || '[]'));
    expect(rows[0].outcome).toBe('Prompted');
    expect(rows[0].prompted).toBe(true);
  });
});
