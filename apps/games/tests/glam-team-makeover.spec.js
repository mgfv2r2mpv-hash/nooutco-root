import { test, expect } from '@playwright/test';

// Smoke coverage for Glam Team Makeover — a bespoke turn-taking game that boots a
// vendored React + design-canvas runtime and composites the model onto a <canvas>.
// Proves the runtime mounts, all 4 models' base art decodes, a turn starts and
// painting composites onto the canvas, the model is randomized (no in-game picker),
// the recombinant pre-story dialog renders, and the hub card links to it.

const MODELS = ['m1', 'm2', 'm3', 'm4'];

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

  test('all four models base art decodes (no broken art)', async ({ page }) => {
    await page.goto('/glam-team-makeover/');
    // The compositor draws the model on a <canvas> from per-model PNGs; verify every
    // model's base decodes (paths resolve, no broken art) independent of which one is live.
    const ok = await page.evaluate(async (models) => {
      const out = {};
      for (const m of models) {
        out[m] = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve(img.naturalWidth > 0);
          img.onerror = () => resolve(false);
          img.src = `assets/art/person/${m}/base.png`;
        });
      }
      return out;
    }, MODELS);
    for (const m of MODELS) expect(ok[m], `${m} base.png should decode`).toBe(true);
  });

  test('starting a turn shows the canvas and painting composites onto it', async ({ page }) => {
    await page.goto('/glam-team-makeover/');
    await page.getByRole('button', { name: /Play/ }).click(); // → ready
    await page.getByRole('button', { name: /Go —/ }).click(); // → my turn

    const canvas = page.locator('#gtm-canvas');
    await expect(canvas).toBeVisible();
    const before = await canvas.evaluate((c) => c.toDataURL());

    // arm the first skincare step (Wash is unlocked at the skincare stage) and paint its zone
    await page.getByRole('button', { name: /Wash/ }).click();
    const target = page.locator('div[style*="gtm-target"]').first();
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 0; i < 8; i++) {
      await page.mouse.move(cx + (i % 2 ? 8 : -8), cy + i * 2, { steps: 2 });
    }
    await page.mouse.up();

    // the composited canvas should have changed after the paint step
    await expect
      .poll(async () => await canvas.evaluate((c) => c.toDataURL()), { timeout: 4000 })
      .not.toBe(before);
  });

  test('model is random & locked — no in-game picker, and the pre-story dialog renders', async ({ page }) => {
    await page.goto('/glam-team-makeover/');

    // the recombinant pre-story is a dialog; the technician speaker label is stable
    await expect(page.getByText('Technician').first()).toBeVisible();

    await page.getByRole('button', { name: /Play/ }).click(); // → stage is shown
    // the old M1–M4 model picker is gone (model is chosen at random and locked)
    for (const m of ['M1', 'M2', 'M3', 'M4']) {
      await expect(page.getByRole('button', { name: m, exact: true })).toHaveCount(0);
    }
  });

  test('hub card links to the game', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a.card[href="./glam-team-makeover/"]')).toBeVisible();
  });
});
