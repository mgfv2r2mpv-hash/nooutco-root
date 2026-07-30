import { test, expect } from '@playwright/test';

/**
 * Behavioural cover for the shared VR schedule in token-board.js.
 *
 * The schedule shipped broken and the existing token-board spec did not notice,
 * because it only asserted that the settings controls render. The defect: the
 * generated schedule was 0-based while `trialsCompleted` was 1-based, and the
 * two were compared with `===`. When the first generated index was 0 — odds
 * exactly 1/value — the pointer never advanced and the board never paid out
 * again for the whole session. At VR2 that was half of all sessions delivering
 * literally nothing.
 *
 * These tests drive the real controller in the page rather than a copy of the
 * maths, so they fail if the wiring drifts as well as if the arithmetic does.
 */

/** Run `trials` awards against a real controller and report the delivery gaps.
 *  Config is seeded into the controller's own localStorage key and read by its
 *  `load()`, so this drives the shared module without touching the host game's
 *  controls or its namespace. */
async function runSchedule(page, { scheduleValue, trials, scheduleType = 'VR' }) {
  return page.evaluate(
    ({ scheduleValue, trials, scheduleType }) => {
      const ns = 'vrspec';
      localStorage.setItem(
        'noaba.tokens.' + ns + '.v1',
        JSON.stringify({
          enabled: true,
          scheduleType,
          scheduleValue,
          startingTokens: 0,
          goalTokens: 999999,
          tokenEmoji: '⭐',
        }),
      );

      const gaps = [];
      let delivered = 0;
      let last = 0;
      let t = 0;

      const ctl = window.NooutcoTokens.create({
        namespace: ns,
        onAward: () => {
          delivered++;
          gaps.push(t - last);
          last = t;
        },
      });
      ctl.startSession();

      for (let i = 0; i < trials; i++) {
        t++;
        ctl.award();
      }
      return { delivered, gaps, trials };
    },
    { scheduleValue, trials, scheduleType },
  );
}

test.describe('Shared VR schedule', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/clock/');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  for (const value of [2, 3, 5]) {
    test(`VR${value} always delivers, and the first token lands within ${value} trials`, async ({ page }) => {
      // Repeat: the old defect was probabilistic (1/value), so a single run
      // would have passed against the broken code better than half the time.
      for (let attempt = 0; attempt < 12; attempt++) {
        const r = await runSchedule(page, { scheduleValue: value, trials: 40 });
        expect(r.delivered, `attempt ${attempt}: a VR schedule must never run a whole session dry`).toBeGreaterThan(0);
        expect(r.gaps[0], `attempt ${attempt}: first token must not take longer than the ratio`).toBeLessThanOrEqual(value);
        expect(Math.max(...r.gaps), `attempt ${attempt}: no gap may exceed 2n-1`).toBeLessThanOrEqual(2 * value - 1);
      }
    });

    test(`VR${value} converges on its target ratio over a long session`, async ({ page }) => {
      const r = await runSchedule(page, { scheduleValue: value, trials: 400 });
      const realised = r.trials / r.delivered;
      // Individual gaps vary — that is the point of a VR — but the running
      // average has to track the configured value or it is not a VR at all.
      expect(realised).toBeGreaterThan(value * 0.85);
      expect(realised).toBeLessThan(value * 1.15);
    });
  }

  test('FR is unaffected and still delivers on exactly every nth trial', async ({ page }) => {
    const r = await runSchedule(page, { scheduleValue: 3, trials: 30, scheduleType: 'FR' });
    expect(r.delivered).toBe(10);
    expect(new Set(r.gaps)).toEqual(new Set([3]));
  });
});
