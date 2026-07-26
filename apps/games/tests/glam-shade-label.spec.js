import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover — the paint hitbox must not claim work it has not seen.
 *
 * Reported from play: "After setting a color for blush or lips, the user can
 * change the color. However the 'done' text reappears in the hitbox when the
 * color is changed and then the user clicks once and it places the color."
 *
 * Cause, from the source. Paint coverage is stored per SLOT — `ed.cov.blush` —
 * while six blushes, six shadows and seven lipsticks each share ONE slot. The
 * target overlay read that slot straight:
 *
 *     const covPct = Math.round((s.ed.cov[t.slot] || 0) * 100);
 *     … covPct >= 100 ? 'All done ✓' : …
 *
 * so arming a DIFFERENT shade of a painted slot inherited the first shade's
 * coverage and the hitbox announced "All done ✓" over a shade that had never
 * touched the face. The trolley button next to it already got this right — it
 * tested shade identity (`ed.col[slot] === opt.color`) for its ✓. Both readings
 * now come from one predicate, `_shadeOn`.
 *
 * These tests fail against 93dab9be.
 *
 * NOT changed here, and deliberately: because `cov[slot]` is already 1, a shade
 * switch still completes in a SINGLE stroke — `Math.min(1, 1 + 0.11)` — rather
 * than a fresh drag. Whether a re-tint should be a cheap one-tap or should cost
 * a full paint again is a design question for the maintainer, so the current
 * cost is pinned below rather than quietly altered.
 *
 * The GlamTT engine and tests/glam-tt-scoring.spec.js are untouched by this work.
 */

/** Evaluate `src` with `L` bound to the component instance and `T` to its Trial. */
function logic(page, src) {
  return page.evaluate(({ src }) => {
    let f = null;
    for (const el of document.querySelectorAll('*')) {
      const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      if (k) { f = el[k]; break; }
    }
    while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
    const L = f.stateNode.logic;
    return new Function('L', 'T', src)(L, L._trial);
  }, { src });
}

/** Boot to the play surface. Free play so every shade shelf is reachable without
    first walking the whole 11-step task analysis to unlock it. */
async function stage(page, { routine = 'free', turns = '4' } = {}) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/glam-team-makeover/');
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Routine', { exact: true }).selectOption(routine);
  await page.getByLabel('Turns', { exact: true }).selectOption(turns);
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.waitForFunction(() => {
    let f = null;
    for (const el of document.querySelectorAll('*')) {
      const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      if (k) { f = el[k]; break; }
    }
    while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
    const L = f && f.stateNode.logic;
    if (!L || !L._skinPool(L.state.model)) return false;
    const c = L._imgc || {};
    const keys = Object.keys(c);
    return keys.length > 0 && keys.every((k) => c[k].ok);
  }, undefined, { timeout: 30000 });
  await page.getByRole('button', { name: /Go —/ }).click();
  return errors;
}

const target = (page) => page.locator('div[style*="gtm-target"]').first();

/** Arm a paint tool and drag its target zone to full coverage. */
async function paintTool(page, name) {
  await page.getByTitle(name, { exact: true }).first().click();
  const zone = target(page);
  await expect(zone).toBeVisible();
  const box = await zone.boundingBox();
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(box.x + 10 + (i * (box.width - 20)) / 14, box.y + box.height / 2);
  }
  await page.mouse.up();
}

/** The trolley label carries a ✓ prefix when the tool's effect IS the current
    config. `title` stays the raw name, so it is a stable handle across states. */
const toolLabel = (page, name) =>
  page.getByTitle(name, { exact: true }).first().evaluate((el) => el.innerText.trim());

/* Every shade family that shares one paint slot. `first` is painted, `second` is
   armed afterwards without being painted — the state the hitbox lied about. */
const FAMILIES = [
  { slot: 'blush', first: 'Blush rose', second: 'Blush plum' },
  { slot: 'lips', first: 'Lips red', second: 'Lips plum' },
  { slot: 'shadow', first: 'Shadow violet', second: 'Shadow ocean' },
];

test.describe('Glam Team Makeover — the hitbox only claims the shade that was painted', () => {
  for (const fam of FAMILIES) {
    test(`${fam.slot}: arming an unpainted shade of a painted slot does not say "All done"`, async ({ page }) => {
      const errors = await stage(page);

      await paintTool(page, fam.first);
      expect(await logic(page, `return L.state.ed.cov['${fam.slot}']`), 'the slot is fully painted').toBe(1);

      // Re-arming the SAME shade must still say "All done ✓" — that is the
      // accepted eval §8 fix ("Keep painting… 100%" on a finished step) and this
      // change must not walk it back.
      await page.getByTitle(fam.first, { exact: true }).first().click();
      await expect(target(page), 'the painted shade still reads as finished').toContainText('All done ✓');

      // The defect: a different shade of the same slot, never applied.
      await page.getByTitle(fam.second, { exact: true }).first().click();
      const lbl = await target(page).innerText();
      expect(lbl, 'an unapplied shade must not be called done').not.toContain('All done');
      expect(lbl, 'nor part-way through a drag it never had').not.toContain('Keep painting');
      expect(lbl, 'it asks for the work, like any unpainted tool').toMatch(/Drag over|Cheeks|Lips|Eyes/i);

      // And the trolley agrees with the hitbox, both ways round.
      expect(await toolLabel(page, fam.first), 'the painted shade keeps its ✓').toContain('✓');
      expect(await toolLabel(page, fam.second), 'the unpainted shade has none').not.toContain('✓');

      expect(errors).toEqual([]);
    });
  }

  test('the shade actually swaps, and the current one-stroke cost is what ships', async ({ page }) => {
    /* Pinned, not chosen. `cov.blush` is already 1, so `paintStep` completes on
       the first stroke and the re-tint costs one tap rather than a fresh drag.
       Recording it here means the maintainer's ruling — cheap re-tint, or paint
       it again — flips one assertion instead of being discovered in play. */
    const errors = await stage(page);

    await paintTool(page, 'Blush rose');
    const rose = await logic(page, 'return L.state.ed.col.blush');

    await page.getByTitle('Blush plum', { exact: true }).first().click();
    const box = await target(page).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();

    const plum = await logic(page, 'return L.state.ed.col.blush');
    expect(plum, 'one stroke re-tints the slot').not.toBe(rose);
    expect(await logic(page, "return L.state.ed.cov.blush")).toBe(1);
    expect(await logic(page, 'return L.state.armed'), 'and disarms, because coverage completed').toBe(null);
    expect(await toolLabel(page, 'Blush plum'), 'the ✓ has moved to the shade that is on').toContain('✓');
    expect(await toolLabel(page, 'Blush rose')).not.toContain('✓');

    expect(errors).toEqual([]);
  });

  test('the predicate reads the shade, not a slot list — including slots no shipped surface reaches', async ({ page }) => {
    /* Found by the sweep, not reported. `mk1`/`mk2` are `mech:'paint'` with a
       colour on slot `mask` — the same shape of tool as blush/lips/shadow — and
       the trolley's old hard-coded `blush|lips|shadow` list did not cover them.
       That base is unreachable today (AC-13 took the theme selector out), so this
       is latent, not live; it is asserted against the predicate directly rather
       than through a surface that cannot be opened. Writing the rule instead of
       the catalogue is what closes it. */
    const errors = await stage(page);

    const answers = await logic(page, `
      const q = (o) => L._shadeOn(o);
      return new Promise((r) => L.setState((s) => {
        const ed = JSON.parse(JSON.stringify(s.ed));
        ed.col.mask = '#2a6fdb';
        return { ed };
      }, () => r({
        onShade:   q({ mech:'paint', color:'#2a6fdb', slot:'mask' }),
        offShade:  q({ mech:'paint', color:'#7c3aed', slot:'mask' }),
        noColour:  q({ mech:'paint', slot:'wash' }),
        notPaint:  q({ mech:'tap', apply:'recolor', color:'#7c3aed', slot:'hair' }),
      })));`);

    expect(answers.onShade, 'the shade that is on the slot').toBe(true);
    expect(answers.offShade, 'a sibling shade of the same slot is NOT on').toBe(false);
    expect(answers.noColour, 'a colourless paint tool has no shade to disagree about').toBe(true);
    expect(answers.notPaint, 'and non-paint mechanisms are untouched by this rule').toBe(true);

    expect(errors).toEqual([]);
  });
});
