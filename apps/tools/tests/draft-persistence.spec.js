import { test, expect } from '@playwright/test';

// Regression for the "typed note lost on refresh" defect.
//
// The note pages are in-browser React; before the fix the clinician's free-text
// note lived only in React state and was never persisted, so any refresh (the
// only escape from the hung login modal) threw the draft away. The note must now
// survive a reload via localStorage. Every note tool is covered so a JSX/wiring
// regression on any one page is caught.
const PAGES = [
  { tool: 'bt', path: '/notes/bt/index.html' },
  { tool: 'sap', path: '/notes/sap/index.html' },
  { tool: 'sup', path: '/notes/sup/index.html' },
  { tool: 'assess', path: '/notes/assess/index.html' },
  { tool: 'parent', path: '/notes/parent/index.html' },
];

test.describe('note draft persistence', () => {
  for (const { tool, path } of PAGES) {
    test(`typed note survives a page reload — ${tool}`, async ({ page }) => {
      const NOTE = `Client worked on tacting for 20 minutes; 8/10 correct. [${tool}]`;

      await page.goto(path);
      await page.evaluate(() => localStorage.clear());
      await page.reload();

      const field = page.locator('textarea').first();
      await field.waitFor();
      await field.fill(NOTE);
      // Allow the persistence effect to flush to localStorage.
      await page.waitForFunction(
        ({ key, v }) => (localStorage.getItem('notes_draft_' + key) || '').includes(v),
        { key: tool, v: NOTE },
      );

      await page.reload();

      const reloaded = page.locator('textarea').first();
      await reloaded.waitFor();
      await expect(reloaded).toHaveValue(NOTE);
    });
  }

  // Security regression: clinician free-text may contain pre-scrub PHI, so drafts
  // must not outlive the session on a shared machine. Logout wipes every draft.
  test('logout clears all saved drafts', async ({ page }) => {
    await page.goto('/notes/bt/index.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const field = page.locator('textarea').first();
    await field.waitFor();
    await field.fill('Jacob tacted 8/10 — draft that must not linger.');
    await page.waitForFunction(() => !!localStorage.getItem('notes_draft_bt'));

    // A second tool's draft is present too, to prove logout clears across tools.
    await page.evaluate(() => localStorage.setItem('notes_draft_sap', '{"goal":"x"}'));

    await page.evaluate(() => window.NotesGate.logout());

    const remaining = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.indexOf('notes_draft_') === 0),
    );
    expect(remaining).toEqual([]);
  });
});
