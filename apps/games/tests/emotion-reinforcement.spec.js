import { test, expect } from '@playwright/test';

/*
 * Emotion ID — token board + "Finish & SR" reinforcement.
 * Exercises the shared NooutcoTokens + NooutcoReward modules end to end:
 * star toggle enables the board, reaching the goal pops "Finish & SR", and the
 * button opens the shared SR timer screen (5:00) with a go-back control.
 */
test.describe('Emotion ID reinforcement', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/emotions/index.html');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test('shared reinforcement modules load', async ({ page }) => {
    const globals = await page.evaluate(() => ({
      reward: typeof window.NooutcoReward,
      tokens: typeof window.NooutcoTokens,
      results: typeof window.NooutcoResults,
    }));
    expect(globals.reward).toBe('object');
    expect(globals.tokens).toBe('object');
    expect(globals.results).toBe('object');
  });

  test('star toggle enables the token board and reveals FR/VR settings', async ({ page }) => {
    await page.click('#btn-extra-toggle');
    await expect(page.locator('#token-board')).toBeHidden();
    await page.click('#chk-token-board-btn');
    await expect(page.locator('#chk-token-board-btn')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#sel-schedule-type')).toBeVisible();
    await expect(page.locator('#inp-goal-tokens')).toBeVisible();
    await expect(page.locator('#token-board')).toBeVisible();
  });

  test('reaching the goal pops Finish & SR, which opens the 5:00 SR timer', async ({ page }) => {
    await page.click('#btn-extra-toggle');
    await page.click('#chk-token-board-btn');
    await page.fill('#inp-goal-tokens', '2');
    await page.dispatchEvent('#inp-goal-tokens', 'change');
    await page.click('#btn-extra-close');

    // Answer two correct receptive trials (FR1 → 1 token each).
    async function clickCorrect() {
      const sd = (await page.textContent('#sdText')).trim();      // "Touch <label>"
      const label = sd.split(' ').slice(1).join(' ');
      const cap = label.charAt(0).toUpperCase() + label.slice(1);
      await page.click(`.face[title="${cap}"]`);
    }
    await clickCorrect();
    await page.waitForTimeout(750);
    await clickCorrect();
    await page.waitForTimeout(750);

    await expect(page.locator('#token-progress-text')).toContainText('2 / 2');
    await expect(page.locator('#token-board')).toHaveClass(/goal-reached/);
    await expect(page.locator('#btn-finish-sr')).toBeVisible();

    await page.click('#btn-finish-sr');
    await expect(page.locator('#noaba-sr-overlay')).toHaveClass(/open/);
    await expect(page.locator('#noaba-timer-display')).toHaveText('5:00');

    // Stop reveals the done state with a go-back control that closes the screen.
    await page.click('#noaba-stop');
    await expect(page.locator('#noaba-timer-done')).toBeVisible();
    await page.click('#noaba-back');
    await expect(page.locator('#noaba-sr-overlay')).not.toHaveClass(/open/);
  });
});
