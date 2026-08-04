import { test, expect } from '@playwright/test';

// Regression for the "typed note lost on refresh" defect.
//
// The note pages are in-browser React; before the fix the clinician's free-text
// note lived only in React state and was never persisted, so any refresh (the
// only escape from the hung login modal) threw the draft away. The note must now
// survive a reload via localStorage. Every note tool is covered so a JSX/wiring
// regression on any one page is caught. The four BCBA tools share the unified
// /notes/bcba/ page (selected via ?tool=); bt keeps its own page.
const PAGES = [
  { tool: 'bt', path: '/notes/bt/index.html' },
  { tool: 'sap', path: '/notes/bcba/index.html?tool=sap' },
  { tool: 'sup', path: '/notes/bcba/index.html?tool=sup' },
  { tool: 'assess', path: '/notes/bcba/index.html?tool=assess' },
  { tool: 'parent', path: '/notes/bcba/index.html?tool=parent' },
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
      // Allow the persistence effect to flush. The stored record is now an
      // AES-GCM envelope, so wait for the envelope rather than for the text.
      await page.waitForFunction(
        ({ key }) => {
          const raw = localStorage.getItem('notes_draft_' + key);
          if (!raw) return false;
          try { const r = JSON.parse(raw); return r.v === 1 && !!r.ct && !!r.iv; } catch { return false; }
        },
        { key: tool },
      );

      await page.reload();

      const reloaded = page.locator('textarea').first();
      await reloaded.waitFor();
      await expect(reloaded).toHaveValue(NOTE);
    });

    // A draft is the clinician's own typing, BEFORE the scrub gate — the one
    // place unredacted PHI legitimately exists in this system. It used to sit in
    // localStorage as readable text until logout, which on a shared clinic
    // laptop meant "until someone else opens devtools".
    test(`draft is not readable in storage — ${tool}`, async ({ page }) => {
      const NOTE = `Jacob eloped 3x and tacted 8/10. [${tool}]`;

      await page.goto(path);
      await page.evaluate(() => localStorage.clear());
      await page.reload();

      const field = page.locator('textarea').first();
      await field.waitFor();
      await field.fill(NOTE);
      await page.waitForFunction(
        ({ key }) => !!localStorage.getItem('notes_draft_' + key),
        { key: tool },
      );

      const raw = await page.evaluate(({ key }) => localStorage.getItem('notes_draft_' + key), { key: tool });
      expect(raw).not.toContain('Jacob');
      expect(raw).not.toContain('eloped');
      expect(raw).not.toContain('tacted');

      const rec = JSON.parse(raw);
      expect(rec.v).toBe(1);
      expect(rec.iv).toBeTruthy();
      expect(rec.ct).toBeTruthy();
      expect(typeof rec.savedAt).toBe('number');

      // The key itself must not be exportable — a dump of IndexedDB has to be
      // useless, not merely inconvenient.
      const extractable = await page.evaluate(() => new Promise((resolve) => {
        const req = indexedDB.open('noaba-notes', 1);
        req.onsuccess = () => {
          const g = req.result.transaction('keys', 'readonly').objectStore('keys').get('draft-key-v1');
          g.onsuccess = () => resolve(g.result ? g.result.extractable : 'no-key');
          g.onerror = () => resolve('err');
        };
        req.onerror = () => resolve('err');
      }));
      expect(extractable).toBe(false);
    });
  }

  // A draft must not outlive the working day even if nobody logs out.
  test('a draft older than the TTL is dropped, not restored', async ({ page }) => {
    await page.goto('/notes/bt/index.html');
    await page.evaluate(() => localStorage.clear());
    await page.reload();

    const field = page.locator('textarea').first();
    await field.waitFor();
    await field.fill('Draft from a previous shift.');
    await page.waitForFunction(() => !!localStorage.getItem('notes_draft_bt'));

    // Backdate the envelope past the 12h hard expiry.
    await page.evaluate(() => {
      const rec = JSON.parse(localStorage.getItem('notes_draft_bt'));
      rec.savedAt = Date.now() - 13 * 60 * 60 * 1000;
      localStorage.setItem('notes_draft_bt', JSON.stringify(rec));
    });

    await page.reload();
    const reloaded = page.locator('textarea').first();
    await reloaded.waitFor();
    await expect(reloaded).toHaveValue('');

    // The stale envelope is dropped on hydrate rather than left to rot. What is
    // in storage afterwards is the fresh empty draft this page just saved, so
    // assert on its age — a record still carrying the old timestamp would mean
    // the expiry never ran.
    const savedAt = await page.evaluate(() => {
      const raw = localStorage.getItem('notes_draft_bt');
      return raw ? JSON.parse(raw).savedAt : null;
    });
    if (savedAt !== null) expect(Date.now() - savedAt).toBeLessThan(60 * 1000);
  });

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
