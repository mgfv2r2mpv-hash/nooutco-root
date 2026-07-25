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

/** Which model the stage is currently showing, read off the component through the
    React fiber (the walk documented in docs/eval/glam-team-makeover-playtest.md).
    The client is drawn at random, so this is the only way to know whether a model
    button is a swap or a no-op. */
function activeModel(page) {
  return page.evaluate(() => {
    let f = null;
    for (const el of document.querySelectorAll('*')) {
      const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      if (k) { f = el[k]; break; }
    }
    while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
    return f && f.stateNode.logic.state.model;
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

/** Open the BT setup strip, which the refresh collapsed behind the header ⚙ so
    the child's title screen is the first thing on the page. Every test below
    starts the trial the clinician's way (▶ Play), bypassing the texting intro;
    the child's route in is covered by tests/glam-open-flow.spec.js. */
async function openSetup(page) {
  await page.getByTitle('Show / hide setup').click();
  await expect(page.getByRole('button', { name: /^▶ Play/ })).toBeVisible();
}

test.describe('Glam Team Makeover', () => {
  test('title screen mounts (runtime boots)', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/glam-team-makeover/');
    // header title + the child's Start affordance render once dc-runtime mounts <x-dc>
    await expect(page.getByText('Glam Team Makeover').first()).toBeVisible();
    await expect(page.getByText(/take turns, together/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Start/ })).toBeVisible();
    await openSetup(page);
    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('every roster model loads its base art and paints a distinct stage', async ({ page }) => {
    /* This sweeps EVERY roster model, and a model swap decodes a whole art set —
       base, eye/brow sprites and seven hair masks — before the repaint the poll
       below is waiting for. Under the default 30s test budget the per-model polls
       could add up past it on a loaded machine, and the run then reported "test
       timeout" from inside the last model's poll, which reads like a stuck
       assertion but is just the budget. The assertion itself has never failed:
       the fingerprints have always come out distinct when they arrived. */
    test.setTimeout(120000);
    await page.goto('/glam-team-makeover/');

    // The roster is `GlamStory.MODELS` — the one list the story draw and the BT's
    // character lock both read. M1 was retired from it in the refresh, so this
    // sweep follows the roster rather than a hardcoded four.
    const roster = await page.evaluate(() => window.GlamStory.MODELS);
    expect(roster.length, 'the roster should still offer a choice of clients').toBeGreaterThan(1);

    // The compositor loads its source art through `new Image()`, so the sprites
    // never appear in the DOM. Check the files are actually served…
    for (const m of roster) {
      const res = await page.request.get(`/glam-team-makeover/assets/art/person/${m}/base.png`);
      expect(res.status(), `${m}/base.png should be served`).toBe(200);
    }

    /* …and that each model, once it is the drawn client, paints its own art. A
       model whose base failed to decode would leave `paintAvatar` bailing early and
       the canvas blank/unchanged, so distinct fingerprints prove each one decoded.

       ROUTE (TUNING fix 1): this used to click the stage's M2/M3/M4 chips, which no
       longer exist — the child may not choose a client. The only surface that still
       picks one is the BT's Character lock, so the sweep now goes the way a BT
       actually pins a client: fresh load → lock → ▶ Play. That is a full reload per
       model rather than an in-place swap, which is why the budget above is generous;
       it also means each model's art set is decoded from cold, which is a stronger
       claim about "loads its base art" than a warm swap was. */
    const seen = new Map();
    for (const m of roster) {
      await page.goto('/glam-team-makeover/');
      await openSetup(page);
      await page.getByLabel('Character', { exact: true }).selectOption(m);
      await page.getByRole('button', { name: /^▶ Play/ }).click();
      await waitForPaintedStage(page);
      expect(await activeModel(page), 'the lock must pin the painted client').toBe(m);

      /* WAIT and JUDGE are separate steps, deliberately. An earlier form polled for
         "a fingerprint I have not seen yet", which returns null both while the art
         is still decoding AND when the model genuinely painted the same stage as
         another — so a real duplicate burned the whole timeout and surfaced as
         "timed out", the least informative failure available. The poll waits only
         for the canvas to stop moving; distinctness is a plain assertion that names
         the collision if it ever happens. */
      let fp = null;
      await expect
        .poll(async () => {
          const a = await stageFingerprint(page);
          const b = await stageFingerprint(page);
          fp = b;
          return a && b && a.hash === b.hash ? b.hash : null;
        }, { timeout: 20000, message: `${m} should paint the stage and settle` })
        .not.toBeNull();
      expect(fp.opaque, `${m} should paint a non-blank stage`).toBeGreaterThan(20000);
      expect(seen.get(fp.hash), `${m} painted the same stage as ${seen.get(fp.hash)}`).toBeUndefined();
      seen.set(fp.hash, m);
    }
    expect(seen.size, 'every roster model should render differently').toBe(roster.length);
  });

  // Refresh fix 1 — M1 is retired. "Not selectable and not in the random pool"
  // has to hold on every route into a model: the random draw and the BT's
  // character lock (both the <option> list and a hand-forced value). The stage's
  // own M2/M3/M4 picker was the third route; TUNING fix 1 deleted it outright, so
  // the assertion at the bottom is now that the child surface offers no model
  // button AT ALL — not that it offers the roster and nothing else.
  test('M1 is retired — absent from the roster, the random pool and the character lock', async ({ page }) => {
    await page.goto('/glam-team-makeover/');
    await openSetup(page);

    const out = await page.evaluate(() => {
      const S = window.GlamStory;
      // a long deterministic-ish sweep of the pool — 500 draws would surface a
      // 1-in-4 leak with overwhelming probability
      const drawn = new Set();
      for (let i = 0; i < 500; i++) drawn.add(S.draw({}).model);
      return {
        roster: S.MODELS,
        drawn: [...drawn],
        // a stale/forced lock must fall back to the roster, not seed the retired face
        forcedLock: S.draw({ model: 'm1' }).model,
        lockOptions: [...document.querySelectorAll('select[aria-label="Character"] option')]
          .map((o) => o.value),
      };
    });

    expect(out.roster).not.toContain('m1');
    expect(out.roster.length).toBeGreaterThan(1);
    expect(out.drawn).not.toContain('m1');
    expect(out.drawn.sort()).toEqual([...out.roster].sort());   // the pool is exactly the roster
    expect(out.forcedLock).not.toBe('m1');
    expect(out.lockOptions).toEqual(['random', ...out.roster]);

    // …and the play surface offers no model button at all — not M1, not the roster.
    await page.getByRole('button', { name: /^▶ Play/ }).click();
    await waitForPaintedStage(page);
    for (const m of ['m1', ...out.roster]) {
      await expect(page.getByRole('button', { name: m.toUpperCase(), exact: true })).toHaveCount(0);
    }
  });

  test('applying a step composites onto the stage', async ({ page }) => {
    await page.goto('/glam-team-makeover/');
    await openSetup(page);
    await page.getByRole('button', { name: /^▶ Play/ }).click();
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
