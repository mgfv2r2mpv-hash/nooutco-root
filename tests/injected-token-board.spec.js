import { test, expect } from '@playwright/test';

/*
 * token-board-ui.js injects a working token board + Finish & SR into games that
 * ship none. Verify on a representative token-less game (clock).
 */
test.describe('Injected token board (clock)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/clock/index.html');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test('injects the star toggle, settings, board and controller', async ({ page }) => {
    const has = await page.evaluate(() => ({
      controller: typeof window.__nooutcoTokens,
      star: !!document.getElementById('chk-token-board-btn'),
      board: !!document.getElementById('token-board'),
      finish: !!document.getElementById('btn-finish-sr'),
      schedule: !!document.getElementById('sel-schedule-type'),
    }));
    expect(has.controller).toBe('object');
    expect(has.star).toBeTruthy();
    expect(has.board).toBeTruthy();
    expect(has.finish).toBeTruthy();
    expect(has.schedule).toBeTruthy();
  });

  test('reaching the goal pops Finish & SR → 5:00 SR timer', async ({ page }) => {
    await page.click('#btn-extra-toggle');
    await page.click('#chk-token-board-btn');
    await page.fill('#inp-goal-tokens', '2');
    await page.dispatchEvent('#inp-goal-tokens', 'change');
    await expect(page.locator('#token-board')).toBeVisible();

    // Drive token awards through the public controller (clock gameplay needs a target match).
    await page.evaluate(() => { window.__nooutcoTokens.award(); window.__nooutcoTokens.award(); });

    await expect(page.locator('#token-progress-text')).toContainText('2 / 2');
    await expect(page.locator('#btn-finish-sr')).toBeVisible();
    await page.click('#btn-finish-sr');
    await expect(page.locator('#noaba-sr-overlay')).toHaveClass(/open/);
    await expect(page.locator('#noaba-timer-display')).toHaveText('5:00');
  });

  test('disabling the token board after goal hides Finish & SR', async ({ page }) => {
    await page.click('#btn-extra-toggle');
    await page.click('#chk-token-board-btn');
    await page.fill('#inp-goal-tokens', '2');
    await page.dispatchEvent('#inp-goal-tokens', 'change');
    await page.evaluate(() => { window.__nooutcoTokens.award(); window.__nooutcoTokens.award(); });
    await expect(page.locator('#btn-finish-sr')).toBeVisible();

    // Turn the board back off — the goal-reached state and the button must clear.
    await page.click('#chk-token-board-btn');
    await expect(page.locator('#token-board')).toBeHidden();
    await expect(page.locator('#token-board')).not.toHaveClass(/goal-reached/);
    await expect(page.locator('#btn-finish-sr')).toBeHidden();
  });
});
