import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover - the outro photo booth (the refresh's before → after
 * reveal).
 *
 * The celebration screen now opens with two polaroid frames: the doll as the
 * client arrived, and the doll the child and the partner finished together.
 * Both are grabbed off the SAME compositor canvas the game paints - the before
 * frame at Go (or at the last repaint before the first edit, whichever is
 * later), the after frame the instant the engine ends the trial and one render
 * before the game surface unmounts.
 *
 * What these tests pin:
 *   · the booth appears at the outro, on the child's route and the BT's;
 *   · the before frame really is the pre-edit doll, byte for byte;
 *   · the after frame really is the finished doll - the frames DIFFER once the
 *     look has been worked on, so the reveal cannot be the same picture twice;
 *   · the booth adds no number and nothing to type (§8);
 *   · "Play again" clears it, so the next run's booth is that run's.
 *
 * The clinical engine is untouched by all of this: the booth reads pixels, and
 * never asks window.GlamTT anything.
 */

/** Evaluate `src` with `L` bound to the component and `T` to its live Trial. */
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

async function boot(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/glam-team-makeover/');
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await expect(page.getByRole('button', { name: /^Start/ })).toBeVisible();
  return errors;
}

/** The BT's route in: open the collapsed setup strip, configure, ▶ Play. */
async function btStart(page, cfg = {}) {
  const turns = page.getByLabel('Turns', { exact: true });
  if (!(await turns.isVisible())) await page.getByTitle('Show / hide setup').click();
  await expect(turns).toBeVisible();
  const all = { Routine: 'free', Turns: '10', 'Their turn': 'count', Wait: '2', ...cfg };
  for (const [label, value] of Object.entries(all)) {
    await page.getByLabel(label, { exact: true }).selectOption(value);
  }
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await expect(page.getByRole('button', { name: /Go - / })).toBeVisible();
}

/** Wait until the compositor's output has actually settled.
 *
 *  The doll is assembled from a dozen independently-decoding PNGs - the base
 *  render, the seven hair masks, the eye and brow sprites - and every `onload`
 *  repaints. Two things therefore have to be true before a frame is comparable
 *  to a later one: every image the compositor has ASKED for is decoded (the
 *  `_imgc` cache is the request list, and a repaint can add to it, so the poll
 *  re-checks until a pass adds nothing), and `_skinPool()` has resolved - *  before it does it returns null and `_spots()` falls back to the UNFILTERED
 *  pool, putting the blemishes at different coordinates.
 *
 *  Skipping this is what made the before frame and the ready-phase face differ
 *  on WebKit: not a capture bug, a photograph taken across a decode. */
async function artSettled(page) {
  await expect.poll(() => logic(page, `
    if (!L._skinPool(L.state.model) || !L._shot()) return false;
    const c = L._imgc || {};
    const keys = Object.keys(c);
    return keys.length > 0 && keys.every((k) => c[k].ok);
  `), { timeout: 20000 }).toBe(true);
}

async function goMyTurn(page) {
  await page.getByRole('button', { name: /Go - / }).click();
  await expect(page.getByRole('button', { name: /Done - their turn/ })).toBeVisible();
}

/** Tap a palette tool and, if it arms a target zone, apply it - one charged action. */
async function useTool(page, name) {
  await page.getByTitle(name, { exact: true }).first().click();
  const target = page.locator('div[style*="gtm-target"]').first();
  if (await target.count()) await target.click();
}

/** A cheap content hash of a canvas, computed in the page. */
const HASH = `
  const hash = (cv) => {
    if (!cv) return null;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
`;

/** Fraction of pixels that visibly differ between the two mounted frames. */
function frameDelta(page) {
  return logic(page, `
    const px = (id) => {
      const cv = document.getElementById(id);
      return cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    };
    const a = px('gtm-shot-before'), b = px('gtm-shot-after');
    let diff = 0;
    for (let i = 0; i < a.length; i += 4) {
      const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1])
              + Math.abs(a[i + 2] - b[i + 2]) + Math.abs(a[i + 3] - b[i + 3]);
      if (d > 12) diff++;
    }
    return { total: a.length / 4, diff };
  `);
}

/** Anything the compositor paints must land inside the polaroid, not around it. */
function frameInk(page, id) {
  return logic(page, `
    const cv = document.getElementById('${id}');
    if (!cv) return null;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let lit = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) lit++;
    return lit / (d.length / 4);
  `);
}

test.describe('outro - the before → after photo booth', () => {
  test('the celebration opens with two frames, labelled Before and After', async ({ page }) => {
    const errors = await boot(page);
    await btStart(page, { Turns: '2' });
    await artSettled(page);
    await goMyTurn(page);
    await useTool(page, 'Berry');
    await logic(page, 'L.endTrial(); return null;');

    await expect(page.getByRole('button', { name: /Print report/ })).toBeVisible();
    await expect(page.getByText('Glam team photo booth')).toBeVisible();
    await expect(page.getByText('Before', { exact: true })).toBeVisible();
    await expect(page.getByText('After', { exact: true })).toBeVisible();
    await expect(page.locator('#gtm-shot-before')).toBeVisible();
    await expect(page.locator('#gtm-shot-after')).toBeVisible();

    // Both polaroids carry a real picture, not an empty rectangle.
    expect(await frameInk(page, 'gtm-shot-before')).toBeGreaterThan(0.1);
    expect(await frameInk(page, 'gtm-shot-after')).toBeGreaterThan(0.1);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('the two frames are different pictures - the after frame is the finished look', async ({ page }) => {
    await boot(page);
    await btStart(page, { Turns: '4' });
    await artSettled(page);
    await goMyTurn(page);

    // Four visibly different edits across three stations.
    await useTool(page, 'Silver');        // hair colour - the largest repaint
    await useTool(page, 'Purple');        // shirt colour
    await useTool(page, 'Lips red');
    await useTool(page, 'Shadow violet');

    await logic(page, 'L.endTrial(); return null;');
    await expect(page.locator('#gtm-shot-after')).toBeVisible();

    const { total, diff } = await frameDelta(page);
    // The hair recolour alone repaints several percent of the frame; requiring
    // 1 % keeps the assertion about "these are two different pictures" rather
    // than about any one tool's footprint.
    expect(diff / total, `${diff}/${total} pixels differ`).toBeGreaterThan(0.01);
  });

  test('the before frame is the doll exactly as it was before the first edit', async ({ page }) => {
    await boot(page);
    await btStart(page, { Turns: '4' });
    await artSettled(page);

    // Hash the live compositor while the doll is untouched.
    const atReady = await logic(page, `${HASH} return hash(L._shot());`);
    expect(atReady).not.toBeNull();

    await goMyTurn(page);
    await useTool(page, 'Flame');
    await useTool(page, 'Lips coral');
    // The live compositor has moved on...
    const afterEdits = await logic(page, `${HASH} return hash(L._shot());`);
    expect(afterEdits).not.toBe(atReady);
    // ...but the stored before frame has not.
    expect(await logic(page, `${HASH} return hash(L._shotBefore);`)).toBe(atReady);

    await logic(page, 'L.endTrial(); return null;');
    await expect(page.locator('#gtm-shot-before')).toBeVisible();
    expect(await logic(page, `${HASH} return hash(document.getElementById('gtm-shot-before'));`))
      .toBe(atReady);
    expect(await logic(page, `${HASH} return hash(document.getElementById('gtm-shot-after'));`))
      .toBe(afterEdits);
  });

  test('the booth appears on the child’s route too, and shows the client who texted in', async ({ page }) => {
    const errors = await boot(page);
    await page.getByRole('button', { name: /^Start/ }).click();
    await expect(page.getByText('Booking the glam team')).toBeVisible();
    await page.getByRole('button', { name: 'Skip ahead' }).click();
    const client = await logic(page, 'return L.state.sel.model;');
    await page.getByRole('button', { name: /Open the salon/ }).click();
    await expect(page.getByRole('button', { name: /Go - / })).toBeVisible();
    await artSettled(page);
    await goMyTurn(page);
    await useTool(page, 'Wash');

    await logic(page, 'L.endTrial(); return null;');
    await expect(page.getByText('Glam team photo booth')).toBeVisible();
    expect(await logic(page, 'return L.state.sel.model;')).toBe(client);
    expect(await frameInk(page, 'gtm-shot-after')).toBeGreaterThan(0.1);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('§8 · the booth puts no number on screen and offers nowhere to type', async ({ page }) => {
    await boot(page);
    await btStart(page, { Turns: '2' });
    await artSettled(page);
    await goMyTurn(page);
    await useTool(page, 'Berry');
    await logic(page, 'L.endTrial(); return null;');

    const booth = page.locator('div', { hasText: /^Glam team photo booth/ }).last();
    await expect(booth).toBeVisible();
    expect(await booth.innerText(), 'the booth carries no numbers').not.toMatch(/\d/);
    expect(await booth.locator('input, textarea, [contenteditable="true"]').count()).toBe(0);
    // AC-10 / §3.7.1 - the booth's own copy makes no checkable claim about the
    // client; the only thing it shows of them is the picture the child made.
    const copy = await booth.innerText();
    const violations = await page.evaluate(
      (s) => window.GlamStory.BANNED.filter((re) => re.test(s)).map(String),
      copy,
    );
    expect(violations, copy).toEqual([]);
  });

  test('“Play again” clears the booth so the next run photographs its own client', async ({ page }) => {
    await boot(page);
    await btStart(page, { Turns: '2' });
    await artSettled(page);
    await goMyTurn(page);
    await useTool(page, 'Berry');
    await logic(page, 'L.endTrial(); return null;');
    await expect(page.locator('#gtm-shot-before')).toBeVisible();

    await page.getByRole('button', { name: /Play again/ }).click();
    await expect(page.getByRole('button', { name: /^Start/ })).toBeVisible();
    expect(await logic(page, 'return {ready:L.state.revealReady, before:!!L._shotBefore, after:!!L._shotAfter};'))
      .toEqual({ ready: false, before: false, after: false });
    await expect(page.locator('#gtm-shot-before')).toHaveCount(0);
  });
});
