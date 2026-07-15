import { test, expect } from '@playwright/test';

// Smoke coverage for Glam Team Makeover — a bespoke turn-taking game that boots a
// vendored React + design-canvas runtime and composites layered PNG art. Proves
// the runtime mounts, all 4 models' art loads (no broken images), the model
// picker repoints, and the hub card links to it.

test.describe('Glam Team Makeover', () => {
  test('intro screen mounts (runtime boots)', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/glam-team-makeover/');
    // header title + the routine chips render once dc-runtime mounts the <x-dc> doc
    await expect(page.getByText('Glam Team Makeover').first()).toBeVisible();
    await expect(page.getByText(/take turns, together/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Play/ })).toBeVisible();
    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('all four models load their base art with no broken images', async ({ page }) => {
    await page.goto('/glam-team-makeover/');
    await page.getByRole('button', { name: /Play/ }).click(); // enter the game screen

    for (const m of ['M1', 'M2', 'M3', 'M4']) {
      await page.getByRole('button', { name: m, exact: true }).click();
      const base = page.locator(`img[src*="assets/art/person/${m.toLowerCase()}/base.png"]`);
      await expect(base).toBeVisible();
      const loaded = await base.evaluate((img) => img.complete && img.naturalWidth > 0);
      expect(loaded, `${m} base.png should decode`).toBe(true);
    }

    // no broken art anywhere on the stage
    const broken = await page.evaluate(() =>
      [...document.images]
        .filter((i) => (i.getAttribute('src') || '').includes('assets/art/person/'))
        .filter((i) => !(i.complete && i.naturalWidth > 0))
        .map((i) => i.getAttribute('src')));
    expect(broken).toEqual([]);
  });

  test('applying a step composites a delivered layer onto the stage', async ({ page }) => {
    await page.goto('/glam-team-makeover/');
    await page.getByRole('button', { name: /Play/ }).click();
    await page.getByRole('button', { name: /Go —/ }).click(); // start my turn

    // arm the Brunette hair tool, then tap its target zone on the stage
    await page.getByRole('button', { name: /Brunette/ }).click();
    const target = page.locator('div[style*="gtm-target"]').first();
    await expect(target).toBeVisible();
    await target.click(); // center of the hair target zone

    await expect(page.locator('img[src*="assets/art/person/m1/hair-brunette.png"]')).toBeVisible();
  });

  test('hub card links to the game', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a.card[href="./glam-team-makeover/"]')).toBeVisible();
  });
});
