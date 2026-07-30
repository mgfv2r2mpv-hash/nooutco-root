import { expect } from '@playwright/test';

/**
 * Shared driving helpers for the Snack Quest specs.
 *
 * The quest is deliberately animated, so every helper waits on observable game
 * state (`window.__sq.peek()`) rather than on a timeout. `__sq` is a read-only
 * test seam: it reports positions and the current target, and writes nothing to
 * the page — which is what lets the expressive spec assert the target word is
 * absent from the DOM while still knowing what that word is.
 */

export const SETTINGS_KEY = 'nooutco.settings.snackQuest';
export const RESULTS_KEY = 'nooutco.results.snackQuest';
export const TOKENS_KEY = 'noaba.tokens.snackQuest.v1';

/**
 * Load the game with a deterministic configuration seeded before boot.
 * Topic defaults to T_animals: its labels cannot collide with a food sprite
 * filename, which keeps the "no target word in the DOM" assertion honest.
 */
export async function bootstrap(page, opts = {}) {
  const cfg = {
    topic: 'T_animals',
    arraySize: 3,
    scheduleType: 'FR',
    scheduleValue: 1,
    startingTokens: 0,
    goalTokens: 3,
    promptsEarn: false,
    ...opts,
  };

  await page.addInitScript(
    ({ cfg, SETTINGS_KEY, RESULTS_KEY, TOKENS_KEY }) => {
      // addInitScript runs on every navigation, so the trial store is wiped
      // only on the first one — otherwise a reload-persistence test would be
      // clearing the very data it is checking survived.
      if (!sessionStorage.getItem('__sq_seeded')) {
        sessionStorage.setItem('__sq_seeded', '1');
        localStorage.removeItem(RESULTS_KEY);
      }
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        working: {
          topic: cfg.topic,
          arraySize: cfg.arraySize,
          speak: false,
          promptsEarn: cfg.promptsEarn,
          targetFilters: {},
          tokensSeeded: true,
        },
      }));
      localStorage.setItem(TOKENS_KEY, JSON.stringify({
        enabled: true,
        scheduleType: cfg.scheduleType,
        scheduleValue: cfg.scheduleValue,
        startingTokens: cfg.startingTokens,
        goalTokens: cfg.goalTokens,
        tokenEmoji: '⭐',
      }));
    },
    { cfg, SETTINGS_KEY, RESULTS_KEY, TOKENS_KEY }
  );

  await page.goto('/snack-quest/');
  await page.waitForFunction(() => !!window.__sq && window.__sq.peek().screen === 'task');
  return cfg;
}

export function peek(page) {
  return page.evaluate(() => window.__sq.peek());
}

export async function chooseTask(page, taskId) {
  await page.click(`#task-tiles .choice-tile[data-task="${taskId}"]`);
  await expect(page.locator('#screen-place')).toBeVisible();
}

export async function choosePlace(page, placeId) {
  await page.click(`#place-tiles .choice-tile[data-place="${placeId}"]`);
  await page.waitForFunction(() => window.__sq.peek().screen === 'quest');
  await expect(page.locator('#trial-card')).toBeVisible();
}

/** Answer the current trial correctly, whichever task is running. */
export async function respondCorrect(page) {
  const scoreVisible = await page.locator('#score-row').isVisible();
  if (scoreVisible) {
    await page.click('.score-btn[data-score="correct"]');
    return;
  }
  const idx = (await peek(page)).correctIndex;
  await page.click(`#trial-grid .pick[data-index="${idx}"]`);
}

/** Wait until the walk / collect sequence has settled and the game is idle. */
export async function waitIdle(page) {
  await page.waitForFunction(() => !window.__sq.peek().busy, null, { timeout: 20000 });
}
