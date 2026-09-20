import { test, expect } from '@playwright/test';

// Pages a clinician opens on a phone must not scroll sideways. A page that is
// even a few pixels too wide drifts under a thumb and hides its right edge.
//
// Measured 2026-09-17 at 390px: graphVA was 575px wide because the ten-column
// metrics table had nothing containing it, and session flow was 445px wide
// because hidden citation popovers near the right edge still took up width.

test.use({ viewport: { width: 390, height: 664 } });

/* Polled rather than sampled once, for the reason written out in
   question-inline.spec.js: webkit can report a wider document for about a tenth
   of a second while a page is still settling, with no box anywhere near the
   wrong place. These two pages are static and have not flaked, but the defect
   is in the shape of the assertion rather than in the page it was pointed at,
   so both siblings get the same fix rather than waiting their turn to go red.

   A page that really is too wide never settles, so it still fails here. */
const expectNotWide = (page) => expect
  .poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth),
  { timeout: 5000, intervals: [100, 200, 400, 1000] })
  .toBe(false);

test.describe('graph visual analysis on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/graphVA/');
    await expect(page.locator('#metrics tbody tr')).toHaveCount(7);
  });

  test('the page does not scroll sideways', async ({ page }) => {
    await expectNotWide(page);
  });

  test('the metrics table scrolls inside its card and keeps the phase column in view', async ({ page }) => {
    const box = page.locator('#metrics').locator('xpath=..');
    const widths = await box.evaluate((n) => ({ scroll: n.scrollWidth, client: n.clientWidth }));
    expect(widths.scroll, 'every column is still there, reachable by scrolling').toBeGreaterThan(widths.client);
    await expect(page.locator('#metrics thead th')).toHaveCount(10);

    // Only a real scroll container accepts scrollLeft; content spilling out of a
    // plain box leaves it at 0, which would make the check below meaningless.
    const scrolled = await box.evaluate((n) => { n.scrollLeft = n.scrollWidth; return n.scrollLeft; });
    expect(scrolled, 'the card itself scrolls').toBeGreaterThan(0);
    const pinned = await page.evaluate(() => {
      const card = document.querySelector('#metrics').parentElement.getBoundingClientRect();
      const phase = document.querySelector('#metrics tbody tr td:first-child').getBoundingClientRect();
      return Math.round(phase.left) >= Math.round(card.left);
    });
    expect(pinned, 'the phase name stays visible at the far right of the table').toBe(true);
  });
});

test.describe('session flow on a phone', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/session-flow/');
    await expect(page.locator('.cite').first()).toBeAttached();
  });

  test('the page does not scroll sideways', async ({ page }) => {
    await expectNotWide(page);
  });

  test('every citation opens fully on screen', async ({ page }) => {
    const count = await page.locator('.cite').count();
    expect(count).toBeGreaterThan(5);
    const offscreen = [];
    for (let i = 0; i < count; i++) {
      const cite = page.locator('.cite').nth(i);
      if (!(await cite.isVisible())) continue;
      await cite.scrollIntoViewIfNeeded();
      await cite.focus();
      const pop = cite.locator('.cite-pop');
      await expect(pop).toBeVisible();
      const r = await pop.boundingBox();
      if (r.x < 0 || r.x + r.width > 390) offscreen.push(`#${i}: ${Math.round(r.x)}..${Math.round(r.x + r.width)}`);
      await cite.blur();
    }
    expect(offscreen, 'citations cut off at the screen edge').toEqual([]);
    await expectNotWide(page);
  });
});
