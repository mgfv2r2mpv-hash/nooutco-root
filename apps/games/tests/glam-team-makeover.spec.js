import { test, expect } from '@playwright/test';

// Smoke coverage for Glam Team Makeover — a bespoke turn-taking game that boots a
// vendored React + design-canvas runtime and composites its paper-doll art.
// Proves the runtime mounts, all 4 models' art loads and decodes, the model
// picker repoints, and the hub card links to it.
//
// UPDATED (Tier-1 redesign) — two of these tests asserted a layered-`<img>` art
// pipeline that the build had already replaced with a single <canvas> compositor
// (`paintAvatar`), so they had been failing against the committed game before
// this branch touched anything: there are no `img[src*="assets/art/person/…"]`
// elements in the DOM any more, and a third test tripped on load-time console
// errors that the redesign has since cleaned. The assertions below keep the
// original intent — every model's art really loads, and applying a step really
// changes the stage — expressed against the compositor, which means reading
// pixels instead of matching element `src`s. The tool-choice change is also
// deliberate: the staged self-care task analysis (a locked spec decision) hides
// Hair until skincare and makeup are done, so the step this test applies has to
// be one the current phase actually offers.
// See docs/eval/glam-team-makeover-build-report.md for the full rationale.

/** Pixel fingerprint of the stage canvas: opaque-pixel count + a cheap FNV hash. */
async function stageFingerprint(page) {
  return page.evaluate(() => {
    const c = document.getElementById('gtm-canvas');
    if (!c) return null;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] > 8) opaque++;
      h = Math.imul(h ^ d[i], 16777619) >>> 0;
      h = Math.imul(h ^ d[i + 3], 16777619) >>> 0;
    }
    return { opaque, hash: h };
  });
}

/** The compositor paints on image `onload`, so wait for real pixels. */
async function waitForPaintedStage(page) {
  await page.waitForFunction(() => {
    const c = document.getElementById('gtm-canvas');
    if (!c) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) { if (d[i] > 8 && ++n > 20000) return true; }
    return false;
  }, undefined, { timeout: 15000 });
}

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

  test('all four models load their base art and each paints a distinct stage', async ({ page }) => {
    await page.goto('/glam-team-makeover/');
    await page.getByRole('button', { name: /Play/ }).click(); // enter the game screen
    await waitForPaintedStage(page);

    // The compositor loads its source art through `new Image()`, so the sprites
    // never appear in the DOM. Check the files are actually served…
    for (const m of ['m1', 'm2', 'm3', 'm4']) {
      const res = await page.request.get(`/glam-team-makeover/assets/art/person/${m}/base.png`);
      expect(res.status(), `${m}/base.png should be served`).toBe(200);
    }

    // …and that selecting each model repaints the stage with that model's art.
    // A model whose base failed to decode would leave `paintAvatar` bailing early
    // and the canvas unchanged, so distinct fingerprints prove all four decoded.
    const seen = new Map();
    for (const m of ['M1', 'M2', 'M3', 'M4']) {
      await page.getByRole('button', { name: m, exact: true }).click();
      await expect
        .poll(async () => {
          const fp = await stageFingerprint(page);
          return fp && !seen.has(fp.hash) ? fp.hash : null;
        }, { timeout: 15000, message: `${m} should paint a stage of its own` })
        .not.toBeNull();
      const fp = await stageFingerprint(page);
      expect(fp.opaque, `${m} should paint a non-blank stage`).toBeGreaterThan(20000);
      seen.set(fp.hash, m);
    }
    expect(seen.size, 'all four models should render differently').toBe(4);
  });

  test('applying a step composites onto the stage', async ({ page }) => {
    await page.goto('/glam-team-makeover/');
    await page.getByRole('button', { name: /Play/ }).click();
    await page.getByRole('button', { name: /Go —/ }).click(); // start my turn
    await waitForPaintedStage(page);
    const before = await stageFingerprint(page);

    // "Shape brows" is a one-tap step that the staged routine offers in the
    // opening skincare phase (Hair is hidden until skincare + makeup are done).
    await page.getByRole('button', { name: /Shape brows/ }).click();
    const target = page.locator('div[style*="gtm-target"]').first();
    await expect(target).toBeVisible();
    await target.click(); // center of the brows target zone

    await expect
      .poll(async () => (await stageFingerprint(page)).hash, { timeout: 10000 })
      .not.toBe(before.hash);
    const after = await stageFingerprint(page);
    expect(after.opaque).toBeGreaterThan(20000); // changed, not wiped
  });

  test('hub card links to the game', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a.card[href="./glam-team-makeover/"]')).toBeVisible();
  });
});
