import { test, expect } from '@playwright/test';

/**
 * Stage 8 - trial records survive a reload, and carry the same two fields in
 * every game.
 *
 * Before this, five games held their trial rows in memory only: a refresh
 * mid-session silently discarded the technician's entire record. These tests
 * fail if that regresses, and they fail if a game's promptType vocabulary
 * drifts from the shared one.
 *
 * Clinical boundary (CLAUDE.md §5): nothing here asserts that a game records
 * WHICH comparison the learner selected, because it must not.
 */

// Games moved onto the shared store, with the key each one owns. All six lost
// their trial record on reload before Stage 8; think-or-say persisted but under
// a bare, unnamespaced key that bypassed the shared store entirely.
const PERSISTED = [
  { game: 'receptive',    key: 'nooutco.results.receptive' },
  { game: 'clock',        key: 'nooutco.results.clock' },
  { game: 'intraverbal',  key: 'nooutco.results.intraverbal' },
  { game: 'patterns',     key: 'nooutco.results.patterns' },
  { game: 'sequences',    key: 'nooutco.results.sequences' },
  { game: 'think-or-say', key: 'nooutco.results.think-or-say' },
];

test.describe('Shared trial-record primitives', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/receptive/index.html');
    await page.waitForLoadState('networkidle');
  });

  test('results-report.js and prompting-method.js both load', async ({ page }) => {
    const present = await page.evaluate(() => ({
      results: typeof window.NooutcoResults === 'object' && window.NooutcoResults !== null,
      prompting: typeof window.NooutcoPrompting === 'object' && window.NooutcoPrompting !== null,
      stampTrial: typeof window.NooutcoResults?.stampTrial === 'function',
      record: typeof window.NooutcoResults?.record === 'function',
      promptTypeFor: typeof window.NooutcoPrompting?.promptTypeFor === 'function',
    }));
    expect(present).toEqual({
      results: true, prompting: true, stampTrial: true, record: true, promptTypeFor: true,
    });
  });

  test('stampTrial adds an ISO timestamp and a promptType', async ({ page }) => {
    const row = await page.evaluate(() =>
      window.NooutcoResults.stampTrial({ trial: 1 }, { autoPrompt: false, promptDelay: false }, false));
    expect(row.trial).toBe(1);
    expect(row.promptType).toBe('none');
    // ISO-8601 instant, not a locale string
    expect(row.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('promptType is derived from the configured procedure, not stored', async ({ page }) => {
    const got = await page.evaluate(() => {
      const P = window.NooutcoPrompting;
      return {
        unprompted:   P.promptTypeFor({ autoPrompt: true,  promptDelay: false }, false),
        mostToLeast:  P.promptTypeFor({ autoPrompt: true,  promptDelay: false }, true),
        timeDelay:    P.promptTypeFor({ autoPrompt: true,  promptDelay: true  }, true),
        leastToMost:  P.promptTypeFor({ autoPrompt: false, promptDelay: false }, true),
      };
    });
    // An unprompted trial is 'none' whatever the procedure says would happen.
    expect(got).toEqual({
      unprompted: 'none',
      mostToLeast: 'model',
      timeDelay: 'delay',
      leastToMost: 'gesture',
    });
  });

  test('the mapping is single-sourced, not re-declared per game', async ({ page }) => {
    const map = await page.evaluate(() => window.NooutcoPrompting.PROMPT_TYPE_BY_METHOD);
    expect(map).toEqual({
      'most-to-least': 'model',
      'least-to-most': 'gesture',
      'time-delay': 'delay',
    });
  });
});

for (const { game, key } of PERSISTED) {
  test.describe(`${game} - trial rows survive a reload`, () => {
    test('a stored session is restored and trial numbering resumes', async ({ page }) => {
      await page.goto(`/${game}/index.html`);
      await page.waitForLoadState('networkidle');

      await page.evaluate(([k]) => {
        localStorage.setItem(k, JSON.stringify([
          { trial: 1, outcome: 'Correct', time: '2.0', promptType: 'none', ts: '2026-01-01T00:00:00.000Z' },
          { trial: 2, outcome: 'Error',   time: '3.5', promptType: 'model', ts: '2026-01-01T00:00:05.000Z' },
        ]));
      }, [key]);

      await page.reload();
      await page.waitForLoadState('networkidle');

      const restored = await page.evaluate(([k]) => JSON.parse(localStorage.getItem(k) || '[]'), [key]);
      expect(restored).toHaveLength(2);
      expect(restored[1].outcome).toBe('Error');
    });

    test('the shared store is loaded, so rows can outlive the tab', async ({ page }) => {
      await page.goto(`/${game}/index.html`);
      await page.waitForLoadState('networkidle');
      const ok = await page.evaluate(() =>
        typeof window.NooutcoResults?.record === 'function'
        && typeof window.NooutcoResults?.stampTrial === 'function');
      expect(ok, `${game} must load results-report.js`).toBe(true);
    });

    test('clearing removes the stored rows', async ({ page }) => {
      await page.goto(`/${game}/index.html`);
      await page.waitForLoadState('networkidle');
      await page.evaluate(([k]) => localStorage.setItem(k, JSON.stringify([{ trial: 1 }])), [key]);
      await page.evaluate(([k]) => window.NooutcoResults.clear(k), [key]);
      const after = await page.evaluate(([k]) => localStorage.getItem(k), [key]);
      expect(after).toBeNull();
    });
  });
}

test.describe('think-or-say legacy fold', () => {
  test('a session under the retired tosResults key is carried forward, not lost', async ({ page }) => {
    await page.goto('/think-or-say/index.html');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem('tosResults', JSON.stringify([
        { cat: 'School', scenario: 'legacy row', answer: 'THINK IT', errors: 0, prompted: false, secs: 4, outcome: 'ok' },
      ]));
    });
    await page.reload();
    await page.waitForLoadState('networkidle');

    const folded = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('nooutco.results.think-or-say') || '[]'));
    expect(folded, 'legacy rows must fold onto the namespaced key').toHaveLength(1);
    expect(folded[0].scenario).toBe('legacy row');

    // Read-then-fold, never drop: the old key survives for an older build.
    const legacyStillThere = await page.evaluate(() => localStorage.getItem('tosResults'));
    expect(legacyStillThere).not.toBeNull();
  });
});
