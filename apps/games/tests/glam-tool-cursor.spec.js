import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover — per-tool cursor: the SEAM only. Art is issue #40.
 *
 * Reported: "the drag animation style is boring because the cursor doesn't look
 * different. It would look best if the cursor looked like the tool being used in
 * that step, but we would need small generated art for each required tool so stub
 * in for the cursor replacement but defer that until we have art (make a ticket)".
 *
 * So this is a mechanism with no art behind it. `TOOL_CURSOR_ART` is empty and
 * `_toolCursor(opt)` resolves every tool to the keyword the build already used —
 * `grab` over a paint target, `pointer` over a tap target and over the spot
 * rings. One resolver now feeds all three surfaces, so issue #40 has a single
 * place to land.
 *
 * The load-bearing claim of a stub is that NOTHING CHANGES for the child, and it
 * is the one asserted hardest here: every option in the shipped catalogue is put
 * through the resolver and compared against the literal pre-change expression
 * `t.mech === 'paint' ? 'grab' : 'pointer'`, and the three rendered surfaces are
 * read back out of the DOM.
 *
 * The last test proves the seam actually works by putting a fake entry in the
 * table at runtime — nothing in the build writes to it — and taking it out again.
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
  await page.getByRole('button', { name: /Go —/ }).click();
  return errors;
}

const target = (page) => page.locator('div[style*="gtm-target"]').first();
const spots = (page) => page.locator('div[style*="gtm-pim"]');
const cursorOf = (loc) => loc.evaluate((el) => getComputedStyle(el).cursor);

test.describe('Glam Team Makeover — the per-tool cursor seam ships without art (issue #40)', () => {
  test('no art is present, and every tool in the catalogue resolves to the cursor that already shipped', async ({ page }) => {
    const errors = await stage(page);

    // The stub's precondition. If this ever fails, art landed and the
    // no-visual-change claim below stops being the thing to assert.
    expect(await logic(page, 'return Object.keys(L._cursorArt())'),
      'TOOL_CURSOR_ART is empty until issue #40 delivers art').toEqual([]);

    /* Every option the catalogue can arm, put through the resolver and compared
       against the literal expression this build used before the seam existed. */
    const audit = await logic(page, `
      const opts = L.cfg().cats.flatMap((g) => g.options);
      const legacy = (o) => (o.mech === 'paint' ? 'grab' : 'pointer');
      const drift = opts
        .filter((o) => L._toolCursor(o) !== legacy(o))
        .map((o) => ({ id: o.id, got: L._toolCursor(o), want: legacy(o) }));
      return { count: opts.length, drift };`);

    expect(audit.count, 'the audit actually looked at the catalogue').toBeGreaterThan(30);
    expect(audit.drift, 'not one tool renders a different cursor than it did').toEqual([]);

    // A null/undefined tool is not a crash — the resolver is called from render.
    expect(await logic(page, 'return L._toolCursor(null)')).toBe('pointer');

    expect(errors).toEqual([]);
  });

  test('the three rendered surfaces show exactly the cursors they showed before', async ({ page }) => {
    const errors = await stage(page);

    // 1 — paint target: grab.
    await page.getByTitle('Wash', { exact: true }).first().click();
    await expect(target(page)).toBeVisible();
    expect(await cursorOf(target(page)), 'a paint target is still grab').toBe('grab');

    // 2 — tap target: pointer.
    await page.getByTitle('Eyeliner', { exact: true }).first().click();
    await expect(target(page)).toBeVisible();
    expect(await cursorOf(target(page)), 'a tap target is still pointer').toBe('pointer');

    // 3 — the spot rings, which are their own tap surface.
    await page.getByTitle('Treat spots', { exact: true }).first().click();
    await expect(spots(page).first()).toBeVisible();
    expect(await cursorOf(spots(page).first()), 'a spot ring is still pointer').toBe('pointer');

    expect(errors).toEqual([]);
  });

  test('the seam works: art in the table reaches the target, and the keyword stays as fallback', async ({ page }) => {
    /* Nothing in the build writes to `TOOL_CURSOR_ART`; this test does, to prove
       the wiring is real and not decorative, then puts it back. A url-encoded
       SVG stands in for the sprite issue #40 will produce — no art ships here. */
    const errors = await stage(page);
    const SVG = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22'
      + '%20width%3D%2216%22%20height%3D%2216%22%3E%3Ccircle%20cx%3D%228%22%20cy%3D%228%22'
      + '%20r%3D%227%22%20fill%3D%22%236a7659%22/%3E%3C/svg%3E';

    await page.getByTitle('Wash', { exact: true }).first().click();
    await expect(target(page)).toBeVisible();
    // The engine normalises the style attribute, so it is compared to itself
    // rather than to a hand-written string; the cursor value is read computed.
    const before = await target(page).getAttribute('style');
    expect(await cursorOf(target(page)), 'baseline is the bare keyword').toBe('grab');

    const withArt = await logic(page, `
      L._cursorArt().wash = { url: ${JSON.stringify(SVG)}, x: 6, y: 27 };
      return new Promise((r) => L.setState((s) => ({ iv: (s.iv || 0) + 1 }),
        () => r(getComputedStyle(document.querySelector('div[style*="gtm-target"]')).cursor)));`);

    expect(withArt, 'the sprite reaches the target').toContain(SVG);
    expect(withArt, 'with its hotspot').toMatch(/\)\s*6\s+27\s*,/);
    expect(withArt, 'and the keyword survives as the UA fallback').toMatch(/,\s*grab$/);

    // Only this tool changes — its neighbours are untouched by one entry.
    expect(await logic(page, "return L._toolCursor({id:'moist',mech:'paint'})")).toBe('grab');

    const after = await logic(page, `
      delete L._cursorArt().wash;
      return new Promise((r) => L.setState((s) => ({ iv: (s.iv || 0) + 1 }),
        () => r(document.querySelector('div[style*="gtm-target"]').getAttribute('style'))));`);
    expect(after, 'removing the entry restores the shipped style exactly').toBe(before);
    expect(await logic(page, 'return Object.keys(L._cursorArt())')).toEqual([]);

    expect(errors).toEqual([]);
  });

  test('a `;base64,` sprite URL would silently produce NO cursor — the constraint issue #40 has to honour', async ({ page }) => {
    /* Measured, not assumed, and pinned so #40 cannot walk into it. Every style
       in this build is a STRING; the runtime turns it into a React style object
       with `cssToObj` (vendor/support.js), which is `css.split(";")` with no
       awareness of quoting. A `data:image/png;base64,…` URL is torn in half at
       the `;` inside its own media type, React receives the invalid fragment
       `url("data:image/png`, and the browser drops the whole declaration — so the
       target renders with no cursor rather than falling back to the keyword. */
    const errors = await stage(page);
    const B64 = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    // Seeded BEFORE the target has ever rendered — the shape issue #40 would ship.
    await logic(page, `L._cursorArt().wash = { url: ${JSON.stringify(B64)}, x: 6, y: 27 }; return 1;`);
    expect(await logic(page, "return L._toolCursor({id:'wash',mech:'paint'})"),
      'the resolver itself is fine — it hands over a valid CSS value').toContain('base64');

    await page.getByTitle('Wash', { exact: true }).first().click();
    await expect(target(page)).toBeVisible();
    expect(await cursorOf(target(page)),
      'first render: the declaration is dropped outright — no cursor at all, not even the fallback')
      .toBe('auto');

    /* On a RE-render the same broken value fails differently and just as quietly:
       React assigns `el.style.cursor = 'url("data:image/gif'`, the browser
       ignores an invalid assignment, and whatever was there before survives. */
    await page.getByTitle('Moisturize', { exact: true }).first().click();
    const reRender = await cursorOf(target(page));
    expect(reRender, 'the sprite never reaches the cursor either way').not.toContain('base64');

    // Put the table back, and prove the target recovers the shipped cursor.
    await logic(page, `delete L._cursorArt().wash;
      return new Promise((r) => L.setState((s) => ({ iv: (s.iv || 0) + 1 }), r));`);
    expect(await logic(page, 'return Object.keys(L._cursorArt())'), 'and the table is left empty').toEqual([]);
    await page.getByTitle('Wash', { exact: true }).first().click();
    expect(await cursorOf(target(page))).toBe('grab');

    expect(errors).toEqual([]);
  });
});
