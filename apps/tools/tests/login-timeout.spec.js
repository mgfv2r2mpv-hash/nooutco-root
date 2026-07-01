import { test, expect } from '@playwright/test';

// Regression for the "login modal hangs forever" defect.
//
// NotesGate.login() must not depend on the server ever responding: behind
// Cloudflare Super Bot Fight Mode + Pages static-asset interception the
// /api/login request can intermittently stall at the edge. Before the fix the
// fetch had no timeout, so login() never settled — the modal's submit button
// sat disabled on "Logging in…" with neither a close nor an error, and the only
// escape was a refresh (which discarded the clinician's typed note).
//
// We drive NotesGate.login() directly (rather than through the modal) to isolate
// the fetch behaviour from the Turnstile widget, which can't be solved headless.
test.describe('login request timeout', () => {
  test('login rejects with a retryable error when the request stalls', async ({ page }) => {
    // Intercept the login call and never respond → simulates an edge/network stall.
    await page.route('**/api/login**', async () => {
      await new Promise(() => {}); // hold the request open forever
    });

    // scrub-test.html loads /assets/notes-gate.js only (no React/Turnstile CDN deps).
    await page.goto('/notes/scrub-test.html');
    await page.waitForFunction(() => !!(window.NotesGate && window.NotesGate.login));

    const result = await page.evaluate(async () => {
      const start = Date.now();
      try {
        await window.NotesGate.login('any-password', 'ts-token');
        return { settled: 'resolved', ms: Date.now() - start };
      } catch (e) {
        return { settled: 'rejected', ms: Date.now() - start, msg: String((e && e.message) || e) };
      }
    });

    expect(result.settled).toBe('rejected');
    expect(result.ms).toBeLessThan(25000); // ~20s ceiling, with headroom
    expect(result.msg).toMatch(/taking too long|retry/i);
  });
});
