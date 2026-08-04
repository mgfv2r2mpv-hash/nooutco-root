import { test, expect } from '@playwright/test';
import { bootstrap, chooseTask, choosePlace, peek, respondCorrect, waitIdle } from './lib/snack-quest.js';

test.describe('Snack Quest - keyboard operation', () => {
  test('the whole flow is reachable from the keyboard', async ({ page }) => {
    await bootstrap(page, { goalTokens: 2 });

    // Task tiles are real buttons in source order.
    await page.locator('#task-tiles .choice-tile').first().focus();
    await expect(page.locator('#task-tiles .choice-tile[data-task="matching"]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#task-tiles .choice-tile[data-task="receptive"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#screen-place')).toBeVisible();

    await page.locator('#place-tiles .choice-tile').first().focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.__sq.peek().screen === 'quest');

    // A trial hands focus straight to the first choice, so a keyboard user
    // never has to hunt for the array.
    await expect(page.locator('#trial-grid .pick').first()).toBeFocused();
    const { correctIndex } = await peek(page);
    for (let i = 0; i < correctIndex; i++) await page.keyboard.press('Tab');
    await expect(page.locator(`#trial-grid .pick[data-index="${correctIndex}"]`)).toBeFocused();
    await page.keyboard.press('Enter');
    await waitIdle(page);
    expect((await peek(page)).round).toBe(2);
  });

  test('an expressive trial focuses the scoring row, not the picture', async ({ page }) => {
    await bootstrap(page, { goalTokens: 2 });
    await chooseTask(page, 'expressive');
    await choosePlace(page, 'sky');
    await expect(page.locator('.score-btn[data-score="correct"]')).toBeFocused();
    await page.keyboard.press('Enter');
    await waitIdle(page);
    expect((await peek(page)).round).toBe(2);
  });

  test('round and snack changes are announced', async ({ page }) => {
    await bootstrap(page, { goalTokens: 2 });
    await chooseTask(page, 'matching');
    await choosePlace(page, 'playroom');

    const live = page.locator('#quest-live');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await expect(live).toHaveText(/Round 1/);

    await respondCorrect(page);
    await waitIdle(page);
    await expect(live).toHaveText(/Round 2/);
  });
});

test.describe('Snack Quest - reduced motion', () => {
  test('a quest still plays through with animation suppressed', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await bootstrap(page, { goalTokens: 2, scheduleValue: 2 });
    await chooseTask(page, 'matching');
    await choosePlace(page, 'countryside');

    const before = await peek(page);
    await respondCorrect(page);
    await waitIdle(page);
    const after = await peek(page);

    // Position still changes - reduced motion removes the waddle, not the walk.
    expect(Math.abs(after.friendCentreX - before.friendCentreX)).toBeGreaterThan(4);
    await expect(page.locator('.walker')).not.toHaveClass(/is-walking/);

    for (let i = 0; i < 10; i++) {
      if (await page.locator('#screen-done').isVisible()) break;
      await respondCorrect(page);
      await waitIdle(page);
    }
    await expect(page.locator('#screen-done')).toBeVisible();
    await expect(page.locator('#done-food img')).toHaveCount(2);
  });
});
