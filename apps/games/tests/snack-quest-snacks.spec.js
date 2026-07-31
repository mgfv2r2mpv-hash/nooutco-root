import { test, expect } from '@playwright/test';
import {
  bootstrap, peek, chooseTask, choosePlace,
  respondCorrect, respondError, waitIdle, waitForQuestion,
} from './lib/snack-quest.js';

/**
 * The snacks ARE the tokens.
 *
 * The quest is over when our friend has as many snacks as the token goal asks
 * for. That number is set by the goal and nothing else — in particular not by
 * how many different fruit sprites happen to exist.
 *
 * The defect these pin: the plan was dealt as a no-repeat hand out of a
 * six-fruit pool (`shuffle(FRUIT).slice(0, n - 1)` plus the honey), so any goal
 * above seven silently collapsed to seven. An eight-token target ended the
 * quest one snack early, and by the last rounds a field of one was giving the
 * answer away because the pool had been exhausted.
 */

/** Play a whole quest and report what was collected. */
async function playQuest(page, { task = 'matching', place = 'playroom' } = {}) {
  await chooseTask(page, task);
  await choosePlace(page, place);

  const total = (await peek(page)).foodTotal;
  for (let i = 0; i < total; i++) {
    await respondCorrect(page);
    await waitIdle(page);
  }
  return { total, collected: (await peek(page)).collected };
}

test.describe('Snack Quest — the snacks are the tokens', () => {
  for (const goal of [8, 10]) {
    test(`a goal of ${goal} collects ${goal} snacks, not the size of the fruit pool`, async ({ page }) => {
      test.setTimeout(120_000);
      await bootstrap(page, { goalTokens: goal, scheduleType: 'FR', scheduleValue: 1 });
      const { total, collected } = await playQuest(page);

      expect(total, 'the quest lays out one snack per token asked for').toBe(goal);
      expect(collected.length, 'and the learner collects every one of them').toBe(goal);
    });
  }

  test('a goal larger than the fruit pool must repeat fruit rather than run short', async ({ page }) => {
    test.setTimeout(120_000);
    // Ten snacks out of six distinct fruits (plus the honey) cannot be done
    // without repeats. Repeating was never forbidden; running short was the bug.
    await bootstrap(page, { goalTokens: 10, scheduleType: 'FR', scheduleValue: 1 });
    const { collected } = await playQuest(page);

    expect(collected.length).toBe(10);
    expect(new Set(collected).size, 'so some snack has to appear more than once').toBeLessThan(collected.length);
  });

  test('the honey is the last snack and only the last snack', async ({ page }) => {
    test.setTimeout(120_000);
    await bootstrap(page, { goalTokens: 8, scheduleType: 'FR', scheduleValue: 1 });
    const { collected } = await playQuest(page);

    expect(collected[collected.length - 1], 'the quest ends on the honey').toBe('honey');
    expect(
      collected.slice(0, -1).filter((k) => k === 'honey'),
      'and the honey never turns up early',
    ).toEqual([]);
  });

  test('the strip draws one slot per snack the goal asks for', async ({ page }) => {
    await bootstrap(page, { goalTokens: 9, scheduleType: 'FR', scheduleValue: 1 });
    await chooseTask(page, 'matching');
    await choosePlace(page, 'playroom');

    await expect(page.locator('#snack-strip .snack-slot')).toHaveCount(9);
    // The token board's generic emoji tally must not run alongside it — in this
    // game the snacks are the tokens, so a star count would be a second,
    // competing tally of the same thing.
    await expect(page.locator('#token-emoji-display')).toBeHidden();
  });

  test('a filled slot shows the snack actually collected', async ({ page }) => {
    await bootstrap(page, { goalTokens: 4, scheduleType: 'FR', scheduleValue: 1 });
    await chooseTask(page, 'matching');
    await choosePlace(page, 'playroom');

    const first = (await peek(page)).foodKey;
    await respondCorrect(page);
    await waitIdle(page);

    const src = await page.locator('#snack-strip .snack-slot.is-got img').first().getAttribute('src');
    expect(src, 'the board shows the snack he really got').toContain(`${first}.webp`);
  });
});

test.describe('Snack Quest — a wrong answer costs the snack', () => {
  test('an error drops the snack and a fresh one is drawn', async ({ page }) => {
    test.setTimeout(60_000);
    await bootstrap(page, { goalTokens: 6, scheduleType: 'FR', scheduleValue: 1 });
    await chooseTask(page, 'matching');
    await choosePlace(page, 'playroom');

    const before = await peek(page);
    await respondError(page);
    await waitIdle(page);
    await waitForQuestion(page);

    const after = await peek(page);
    expect(after.collected, 'an error collects nothing').toEqual([]);
    // The snack he failed to reach is gone: either a different fruit is on the
    // stage, or the same kind landed somewhere else. Both are a fresh draw.
    const moved = Math.abs(after.foodCentreX - before.foodCentreX) > 1;
    expect(moved || after.foodKey !== before.foodKey, 'that snack got away').toBe(true);
  });

  test('errors never shorten the board — the goal still stands', async ({ page }) => {
    test.setTimeout(90_000);
    await bootstrap(page, { goalTokens: 5, scheduleType: 'FR', scheduleValue: 1 });
    await chooseTask(page, 'matching');
    await choosePlace(page, 'playroom');

    for (let i = 0; i < 4; i++) {
      await respondError(page);
      await waitIdle(page);
      await waitForQuestion(page);
    }

    expect((await peek(page)).foodTotal, 'still five snacks to get').toBe(5);
    await expect(page.locator('#snack-strip .snack-slot')).toHaveCount(5);
    expect((await peek(page)).collected).toEqual([]);
  });
});
