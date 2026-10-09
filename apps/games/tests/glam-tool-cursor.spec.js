import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover - per-tool cursor art (issue #40).
 *
 * Reported: "the drag animation style is boring because the cursor doesn't look
 * different. It would look best if the cursor looked like the tool being used in
 * that step".
 *
 * The seam landed first with an empty `TOOL_CURSOR_ART`. This build fills it from
 * `tools/glam-art/build_cursors.mjs`: a 32x32 sprite per tool, cut from the shelf
 * icon, with a hotspot on the tool's tip (or its centre for a bottle, compact,
 * patch or earring). The keyword the build always used stays behind every sprite
 * as the UA fallback - `grab` over a paint target, `pointer` over a tap target.
 *
 * What is pinned here:
 *   1. every tool in the catalogue that has art resolves to ITS sprite, with a
 *      hotspot inside the sprite, and the keyword it used to show after the comma;
 *      every tool without art still resolves to that bare keyword;
 *   2. every sprite in the table is a real 32x32 PNG the server serves;
 *   3. the three surfaces (paint box, tap box, spot rings) render the sprite;
 *   4. a shade tool's sprite is tinted to the shade (a `blob:` URL);
 *   5. a `;base64,` URL still silently produces NO cursor - the constraint any
 *      future art has to honour (the style runtime splits on `;`).
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

/** Boot to the play surface. Free play so every tool is armable without first
    walking the task analysis to unlock it. */
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
  await page.getByRole('button', { name: /Go - / }).click();
  return errors;
}

const target = (page) => page.locator('div[style*="gtm-target"]').first();
const spots = (page) => page.locator('div[style*="gtm-pim"]');
const cursorOf = (loc) => loc.evaluate((el) => getComputedStyle(el).cursor);

const SPRITE = 32;

test.describe('Glam Team Makeover - per-tool cursor art (issue #40)', () => {
  test('every tool with art resolves to its own sprite and hotspot, with the old keyword as fallback', async ({ page }) => {
    const errors = await stage(page);

    const audit = await logic(page, `
      const opts = L.cfg().cats.flatMap((g) => g.options);
      const art = L._cursorArt();
      const legacy = (o) => (o.mech === 'paint' ? 'grab' : 'pointer');
      const rows = opts.map((o) => ({ id: o.id, key: L._cursorKey(o), got: L._toolCursor(o), want: legacy(o),
        art: art[L._cursorKey(o)] || null }));
      return { rows, keys: Object.keys(art) };`);

    expect(audit.rows.length, 'the audit actually looked at the catalogue').toBeGreaterThan(30);

    const withArt = audit.rows.filter((r) => r.art);
    const without = audit.rows.filter((r) => !r.art);

    // Every tool the issue lists has art: the paint tools, the tap tools, earrings.
    const mustHave = ['wash', 'moist', 'patch', 'conceal', 'brows', 'pencil', 'contour', 'bl1', 'bl6',
      'hl', 'es1', 'es6', 'liner', 'mascara', 'lipliner', 'lp1', 'lp7', 'ear1', 'ear2', 'ear3'];
    for (const id of mustHave) {
      expect(withArt.map((r) => r.id), `${id} has cursor art`).toContain(id);
    }

    for (const r of withArt) {
      expect(r.got, `${r.id} points at a sprite`).toMatch(/^url\("[^";]+"\) \d+ \d+, (grab|pointer)$/);
      expect(r.got.endsWith(', ' + r.want), `${r.id} keeps "${r.want}" as its fallback`).toBe(true);
      expect(r.art.x, `${r.id} hotspot x is inside the sprite`).toBeGreaterThanOrEqual(0);
      expect(r.art.x).toBeLessThan(SPRITE);
      expect(r.art.y, `${r.id} hotspot y is inside the sprite`).toBeGreaterThanOrEqual(0);
      expect(r.art.y).toBeLessThan(SPRITE);
    }
    // No art (hair colour) = exactly the keyword this build always showed.
    for (const r of without) expect(r.got, `${r.id} without art is unchanged`).toBe(r.want);

    // A null/undefined tool is not a crash - the resolver is called from render.
    expect(await logic(page, 'return L._toolCursor(null)')).toBe('pointer');

    expect(errors).toEqual([]);
  });

  test('every sprite in the table is served and is a 32x32 image', async ({ page }) => {
    const errors = await stage(page);
    const sizes = await logic(page, `
      const art = L._cursorArt();
      return Promise.all(Object.entries(art).map(([k, a]) => new Promise((res) => {
        const im = new Image();
        im.onload = () => res({ k, w: im.naturalWidth, h: im.naturalHeight });
        im.onerror = () => res({ k, w: 0, h: 0 });
        im.src = a.url;
      })));`);
    expect(sizes.length).toBeGreaterThanOrEqual(18);
    for (const s of sizes) expect([s.k, s.w, s.h]).toEqual([s.k, SPRITE, SPRITE]);
    expect(errors).toEqual([]);
  });

  test('the three rendered surfaces show the tool sprite over the old keyword', async ({ page }) => {
    const errors = await stage(page);

    // 1 - paint target.
    await page.getByTitle('Wash', { exact: true }).first().click();
    await expect(target(page)).toBeVisible();
    const paint = await cursorOf(target(page));
    expect(paint, 'the wash bottle is under the pointer').toContain('assets/art/cursors/wash.png');
    expect(paint, 'with grab behind it').toMatch(/,\s*grab$/);

    // 2 - tap target, hotspot on the pen tip.
    await page.getByTitle('Eyeliner', { exact: true }).first().click();
    await expect(target(page)).toBeVisible();
    const tap = await cursorOf(target(page));
    expect(tap).toContain('assets/art/cursors/eyeliner.png');
    expect(tap, 'the eyeliner hotspot is its tip, not the centre').toMatch(/\)\s*7\s+3\s*,\s*pointer$/);

    // 3 - the spot rings, which are their own tap surface.
    await page.getByTitle('Treat spots', { exact: true }).first().click();
    await expect(spots(page).first()).toBeVisible();
    const ring = await cursorOf(spots(page).first());
    expect(ring, 'the patch is under the pointer over a spot').toContain('assets/art/cursors/treat.png');
    expect(ring).toMatch(/,\s*pointer$/);

    expect(errors).toEqual([]);
  });

  test('a shade tool shows its sprite tinted to the shade', async ({ page }) => {
    const errors = await stage(page);
    await page.getByTitle('Blush rose', { exact: true }).first().click();
    await expect(target(page)).toBeVisible();
    // The neutral sprite decodes, then the tint repaints as a blob: URL.
    await expect.poll(() => cursorOf(target(page)), { timeout: 10000 }).toMatch(/^url\("blob:[^"]+"\) 16 16, grab$/);

    // Two shades are two different tinted sprites.
    const rose = await logic(page, "return L._toolCursor({id:'bl1',mech:'paint',color:'#f28ba0'})");
    const plum = await logic(page, "return L._toolCursor({id:'bl6',mech:'paint',color:'#a75a86'})");
    expect(rose).not.toBe(plum);
    expect(errors).toEqual([]);
  });

  test('a `;base64,` sprite URL would silently produce NO cursor - the constraint new art has to honour', async ({ page }) => {
    /* Measured, not assumed. Every style in this build is a STRING; the runtime
       turns it into a React style object with `cssToObj` (vendor/support.js),
       which is `css.split(";")` with no awareness of quoting. A
       `data:image/png;base64,…` URL is torn in half at the `;` inside its own media
       type, React receives the invalid fragment `url("data:image/png`, and the
       browser drops the whole declaration - so the target renders with no cursor
       rather than falling back to the keyword. */
    const errors = await stage(page);
    const B64 = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    const original = await logic(page, 'return Object.assign({}, L._cursorArt().wash)');
    await logic(page, `L._cursorArt().wash = { url: ${JSON.stringify(B64)}, x: 6, y: 27 }; return 1;`);
    expect(await logic(page, "return L._toolCursor({id:'wash',mech:'paint'})"),
      'the resolver itself is fine - it hands over a valid CSS value').toContain('base64');

    await page.getByTitle('Wash', { exact: true }).first().click();
    await expect(target(page)).toBeVisible();
    expect(await cursorOf(target(page)),
      'first render: the declaration is dropped outright - no cursor at all, not even the fallback')
      .toBe('auto');

    // Put the shipped sprite back and prove the target recovers it.
    await logic(page, `L._cursorArt().wash = ${JSON.stringify(original)};
      return new Promise((r) => L.setState((s) => ({ iv: (s.iv || 0) + 1 }), r));`);
    await page.getByTitle('Moisturize', { exact: true }).first().click();
    await page.getByTitle('Wash', { exact: true }).first().click();
    expect(await cursorOf(target(page))).toContain('assets/art/cursors/wash.png');

    expect(errors).toEqual([]);
  });
});
