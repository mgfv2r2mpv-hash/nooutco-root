import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover — the salon's station kit (refresh R4).
 *
 * The refresh deepens the ACTIVITY: each station carries a generous FIXED stock
 * of shades so a turn has real creative range, in the Toca-Boca spirit where no
 * choice is the wrong one. There is no per-learner storage and nothing unlocks,
 * so "depth" has to be breadth-at-once, and that makes it a property two things
 * must hold for at the same time:
 *
 *   1. the stock is actually THERE and every shade in it actually PAINTS — a
 *      swatch whose recolour ramp was never shipped, or a tint read off the
 *      garment CUT rather than the chosen shade, renders a button that does
 *      nothing or a shade indistinguishable from its neighbour; and
 *   2. the deeper stock changes NOTHING the measurement engine can see — more
 *      shades of one article is not more articles, so the per-turn action
 *      economy and the staged TA order have to come out bit-identical.
 *
 * (2) is why these assertions matter clinically: `REQUIRED_ACTIONS` scales the
 * engine's per-turn budget (D-D / AC-7), so a station kit that quietly added a
 * charge key would have re-scaled every trial's budget.
 *
 * The GlamTT engine and tests/glam-tt-scoring.spec.js are untouched by this work.
 */

/** Evaluate `src` with `L` bound to the component instance (fiber walk documented
    in docs/eval/glam-team-makeover-playtest.md). */
function logic(page, src) {
  return page.evaluate(({ src }) => {
    let f = null;
    for (const el of document.querySelectorAll('*')) {
      const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      if (k) { f = el[k]; break; }
    }
    while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
    const L = f.stateNode.logic;
    return new Function('L', src)(L);
  }, { src });
}

/** Boot to the play surface via the BT's ▶ Play (the child's route in has its own
    spec), with the doll painted and console errors collected. */
async function stage(page, { routine = 'free' } = {}) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/glam-team-makeover/');
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Routine', { exact: true }).selectOption(routine);
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  /* Painted = EVERY image the compositor asked for decoded AND this model's hair
     masks resolved. A "the canvas has lots of opaque pixels" check is not enough:
     the base face clears it while the shirt mask is still decoding, and a shade
     measured in that window paints nothing through `_shirtCanvas`. */
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
  return errors;
}

/* Browser-side helpers shared by the pixel tests. `sig` is a hash over every
   fourth pixel's RGB: two shades of one article differ across thousands of
   pixels, so distinct shades give distinct signatures, while an unpainted shade
   collides with the bare doll. */
const HELPERS = `
  const cv = document.getElementById('gtm-canvas');
  const ctx = cv.getContext('2d');
  const snap = () => ctx.getImageData(0,0,cv.width,cv.height);
  const sig = (d) => { let h=2166136261;
    for(let i=0;i<d.data.length;i+=16){ h=Math.imul(h^d.data[i],16777619)>>>0; h=Math.imul(h^d.data[i+1],16777619)>>>0; h=Math.imul(h^d.data[i+2],16777619)>>>0; }
    return h>>>0; };
  const changed = (a,b) => { let n=0;
    for(let i=0;i<a.data.length;i+=4){
      if(Math.abs(b.data[i]-a.data[i])+Math.abs(b.data[i+1]-a.data[i+1])
        +Math.abs(b.data[i+2]-a.data[i+2])+Math.abs(b.data[i+3]-a.data[i+3])>18) n++; }
    return n; };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  /* \`_img\` is LAZY: the shirt mask, the hair luma and the lip mask only enter
     \`_imgc\` the first time a shade asks for them, and \`_shirtCanvas\`/\`_hairCanvas\`
     return null until that decode lands. So the FIRST shade of an article can
     measure a canvas the article has not been painted on yet — which reads
     exactly like a dead swatch. Wait for every requested image to be decoded
     before believing the canvas.

     After that, paintAvatar runs SYNCHRONOUSLY inside componentDidUpdate, so one
     frame after setState resolves the canvas is final; the stability loop is a
     cheap safety net, not the mechanism. (A settle that re-snapshots dozens of
     times per shade costs enough CPU to starve other specs' polls in the
     fullyParallel run — that is not hypothetical, it timed out
     glam-team-makeover's model sweep.) */
  const decoded = () => { const c = L._imgc || {}; return Object.keys(c).every(k => c[k].ok); };
  const settle = async () => {
    for (let i=0;i<150 && !decoded();i++) await frame();
    let prev = snap();
    for (let i=0;i<6;i++){ await frame(); const next=snap(); if(sig(next)===sig(prev)) return next; prev=next; }
    return prev; };
  /* ONE frozen baseline, not a fresh \`freshEd\` per shade: \`freshEd\` re-seeds
     \`spotSeed\` from Math.random(), so re-cutting it between shades moves the
     blemishes and every canvas comes out different no matter what the shade did.
     That is enough to make BOTH assertions below pass vacuously — verified: with
     a per-shade freshEd, reverting the shirt fix (two cuts, one tint) still went
     green. */
  const BASE = JSON.parse(JSON.stringify(L.freshEd('person')));
  // One render per shade: cut a fresh copy of the baseline and apply the shade to
  // it in the SAME setState, rather than resetting and then editing.
  const applyTo = (fn) => new Promise(r => L.setState(() => {
    const ed = JSON.parse(JSON.stringify(BASE)); if (fn) fn(ed); return { ed }; }, r));
  const reset = () => applyTo(null);
  const station = (label) => L.cfg().cats.find(c => c.label === label);
`;

/* The stations whose stock is a set of SHADES, with the `ed` write each shade
   makes and the floor the refresh commits to. The floor is a floor, not the
   count — a later slice may stock more. */
const SHADE_STATIONS = [
  { station: 'Cheeks & glow', slot: 'blush',    min: 6, write: `(ed,o)=>{ ed.cov.blush=1;  ed.col.blush=o.color; }` },
  { station: 'Eyes',          slot: 'shadow',   min: 6, write: `(ed,o)=>{ ed.cov.shadow=1; ed.col.shadow=o.color; }` },
  { station: 'Lips',          slot: 'lips',     min: 7, write: `(ed,o)=>{ ed.cov.lips=1;   ed.col.lips=o.color; }` },
  { station: 'Hair color',    slot: 'hair',     min: 12, write: `(ed,o)=>{ ed.col.hair=o.value; }` },
  { station: 'Colored contacts', slot: 'contacts', min: 8, write: `(ed,o)=>{ ed.col.contacts=o.value; }` },
  { station: 'Shirt color',   slot: 'outfit',   min: 9, write: `(ed,o)=>{ ed.outfit=o.value; ed.col.garment=o.color; }` },
];

test.describe('Glam Team Makeover — station kit (refresh)', () => {
  test('every station stocks its shades on the real palette, not just in the data', async ({ page }) => {
    const errors = await stage(page);

    /* Rendered buttons, grouped by the shelf they sit on. The tuning pass turned
       each shelf heading into a fold/unfold <button>, so the old walk (button →
       its row → the heading element before it, sliced out of `textContent`) no
       longer names a station; every shelf now carries its own `data-shelf`, which
       is both stable across that markup and self-filtering — a tool button
       anywhere else on the page has no shelf ancestor. */
    const stocked = await page.evaluate(() => {
      const out = {};
      for (const btn of document.querySelectorAll('button[title]')) {
        const shelf = btn.closest('[data-shelf]');
        if (!shelf) continue;
        const label = shelf.getAttribute('data-shelf');
        (out[label] = out[label] || []).push(btn.getAttribute('title'));
      }
      return out;
    });

    for (const { station, min } of SHADE_STATIONS) {
      expect(stocked[station], `station "${station}" should be on the palette`).toBeTruthy();
      expect(stocked[station].length, `${station} stocks ${stocked[station]?.length} shades`)
        .toBeGreaterThanOrEqual(min);
      // Every button addressable by a distinct name — the specs, and the child,
      // tell shades apart by label.
      expect(new Set(stocked[station]).size).toBe(stocked[station].length);
    }

    // The skincare TA and the brow bar are still their own shelves.
    expect(Object.keys(stocked)).toEqual(expect.arrayContaining(['Skincare', 'Brow bar', 'Hair style', 'Earrings']));

    // One tool, one name, across the WHOLE palette — every spec here addresses a
    // tool by `title` and takes `.first()`, so a repeated name silently reroutes
    // a click to a different station's shade.
    const all = Object.values(stocked).flat();
    const dupes = all.filter((n, i) => all.indexOf(n) !== i);
    expect(dupes, `repeated tool names: ${dupes.join(', ')}`).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('every stocked shade paints, and no two shades of one article paint alike', async ({ page }) => {
    test.setTimeout(240000);   // ~50 shades, each a full compositor pass diffed twice
    const errors = await stage(page);

    const rows = await logic(page, `return (async () => {
      ${HELPERS}
      const STATIONS = ${JSON.stringify(SHADE_STATIONS.map(({ station, slot, write }) => ({ station, slot, write })))};
      const out = [];
      // The one shade that legitimately repaints nothing: the client's OWN hair
      // colour. The compositor skips the recolour when the pick equals the base
      // render's native shade, because the doll is already wearing it.
      const nativeHair = (L.genEntry()||{}).native;
      for (const st of STATIONS) {
        const write = eval('(' + st.write + ')');
        await reset();
        const bare = await settle();
        // Seeding \`seen\` with the untouched doll turns "this shade drew nothing"
        // into a twin collision too, so a dead swatch fails on both counts.
        const seen = {}; seen[sig(bare)] = '(the untouched doll)';
        // Only the SHADES of this station's article — a shelf also holds tools
        // that carry no swatch (Contour, Highlight, the liners).
        const shades = station(st.station).options.filter(o => o.slot === st.slot && o.color);
        for (const opt of shades) {
          await applyTo((ed) => write(ed, opt));
          const painted = await settle();
          out.push({ station: st.station, label: opt.label, n: changed(bare, painted),
                     twin: seen[sig(painted)] || null,
                     native: st.slot === 'hair' && opt.value === nativeHair });
          seen[sig(painted)] = opt.label;
        }
        await reset();
      }
      return out;
    })();`);

    /* The floor is RELATIVE to what this article's other shades move, not an
       absolute pixel count. A hair shade with no recolour ramp still repaints the
       BROWS (they take the same swatch), which clears any small absolute floor —
       verified: with a fixed floor of 150, deleting the synthesised-ramp fallback
       went green. Measured on m3: a whole head of hair moves ~42,000px and
       brows-only moves ~6,100, so a quarter of the station's median (~10,500)
       sits cleanly between them where no fixed constant does. */
    const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const floors = {};
    for (const { station } of SHADE_STATIONS) {
      floors[station] = median(rows.filter((r) => r.station === station && !r.native).map((r) => r.n)) * 0.25;
    }

    for (const r of rows) {
      if (r.native) continue;   // the client's own hair colour — already on the doll
      // A shade whose recolour ramp or tint is missing barely moves the doll.
      expect(r.n, `${r.station} · "${r.label}" moved ${r.n}px, under a quarter of the station's usual — is its ramp/tint wired?`)
        .toBeGreaterThan(Math.max(150, floors[r.station]));
      // …and a shade whose tint is read off something other than its own swatch
      // comes out byte-identical to whichever shade shares that something.
      expect(r.twin, `${r.station} · "${r.label}" paints identically to "${r.twin}"`).toBeNull();
    }
    // Exactly one native no-op, and only in the hair station.
    expect(rows.filter((r) => r.native)).toHaveLength(1);
    expect(rows.length).toBeGreaterThanOrEqual(48);
    expect(errors).toEqual([]);
  });

  test('AC-7 · the deeper stock spends no extra actions — one article, one charge key', async ({ page }) => {
    const errors = await stage(page);

    // Every option in the person palette, with the slot it edits and the charge
    // key it would spend. A station can hold more than one article (Lips holds the
    // liner and the shades), so the invariant is per ARTICLE, not per shelf.
    const opts = await logic(page, `
      return L.cfg().cats.flatMap(c => c.options.map(o => ({ station:c.label, label:o.label, slot:o.slot, key:L._optKey(o) })));`);

    for (const { station, slot } of SHADE_STATIONS) {
      const shades = opts.filter((o) => o.station === station && o.slot === slot);
      expect(shades.length, `${station}/${slot} should have shades`).toBeGreaterThan(1);
      const distinct = new Set(shades.map((o) => o.key));
      expect([...distinct], `${station}: every ${slot} shade must charge the same key`).toHaveLength(1);
    }

    // Guard the guard: across articles the keys ARE distinct, so the assertion
    // above is not passing because every key in the game collapsed to one value.
    const across = new Set(SHADE_STATIONS.map(({ station, slot }) =>
      opts.find((o) => o.station === station && o.slot === slot).key));
    expect(across.size).toBe(SHADE_STATIONS.length);
    expect(errors).toEqual([]);
  });

  test('the staged routine still hides a station until its phase opens', async ({ page }) => {
    const errors = await stage(page, { routine: 'on' });
    await page.getByRole('button', { name: /Go —/ }).click();

    // Skincare and the (untracked) brow bar are open on the first turn…
    await expect(page.getByTitle('Wash', { exact: true })).toBeVisible();
    await expect(page.getByTitle('Brow pencil', { exact: true })).toBeVisible();

    // …and every later station is ABSENT from the DOM, not present-and-dimmed.
    for (const later of ['Lips red', 'Shadow violet', 'Blush plum', 'Mint', 'Lavender', 'Sea green']) {
      await expect(page.getByTitle(later, { exact: true })).toHaveCount(0);
    }

    // The stage tracker still reports the four phases it always did.
    const chips = await page.evaluate(() =>
      [...document.querySelectorAll('span')].map((s) => s.textContent).filter((t) => /Skincare|Makeup|Hair|Accessories/.test(t)));
    expect(chips.join(' ')).toMatch(/Skincare[\s\S]*Makeup[\s\S]*Hair[\s\S]*Accessories/);
    expect(errors).toEqual([]);
  });

  test('two shirt shades cut the same way are still told apart on the button', async ({ page }) => {
    const errors = await stage(page);

    // Teal and Lavender share the `gown` cut — before the refresh the tee's tint
    // was looked up from the cut, so the two were the same shirt.
    const cuts = await logic(page, `
      const st = L.cfg().cats.find(c => c.label === 'Shirt color');
      return st.options.map(o => ({ label:o.label, value:o.value, color:o.color }));`);
    const byCut = {};
    for (const o of cuts) (byCut[o.value] = byCut[o.value] || []).push(o);
    const shared = Object.values(byCut).find((g) => g.length > 1);
    expect(shared, 'the refresh should stock more shades than there are cuts').toBeTruthy();

    await page.getByTitle(shared[0].label, { exact: true }).click();
    await expect(page.getByRole('button', { name: new RegExp(`✓ ${shared[0].label}$`) })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(`✓ ${shared[1].label}$`) })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

/* ── TUNING fix 3 — the trolley as a working surface ─────────────────────────
   The maintainer's report: the cart accumulates. Steps that can never be taken
   again (Wash, Moisturize) stay on the shelf forever, shades the child has long
   since moved past stay fully expanded, and the option they actually need next
   ends up scrolled below a wall of dead buttons.

   The staged routine now flows: a shelf whose every step is taken folds to its
   header, one-shot tools that are already on the client are not rendered at all,
   and unsettled shelves sort above settled ones so the next step opens at the
   top of the cart. Free play is deliberately exempt — "all steps open" is what
   that routine IS, and a BT reaching for an out-of-order station needs every
   station reachable. That exemption is pinned by the last test here so it stays
   a decision rather than an oversight. */

/** The shelves as the child sees them, in DOM order. A settled shelf that has
    lost its last tool keeps its header — that is where a finished step goes on
    reading as finished — but drops `aria-expanded`, because there is nothing
    behind it to expand. A missing attribute therefore reads as closed. */
const shelves = (page) => page.evaluate(() => [...document.querySelectorAll('[data-shelf]')].map((box) => ({
  label: box.getAttribute('data-shelf'),
  open: box.querySelector('button').getAttribute('aria-expanded') === 'true',
  tools: [...box.querySelectorAll('button[title]')].map((b) => b.getAttribute('title')),
})));

/** Arm a paint tool and drag it to full coverage — the real pointer path, since
    what is under test is what the child's own drag leaves behind on the cart. */
async function paintTool(page, name) {
  await page.getByTitle(name, { exact: true }).first().click();
  const zone = page.locator('div[style*="gtm-target"]').first();
  await expect(zone).toBeVisible();
  const box = await zone.boundingBox();
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(box.x + 10 + (i * (box.width - 20)) / 14, box.y + box.height / 2);
  }
  await page.mouse.up();
}

/** Fast-forward the client's state to a mid-appointment point: skincare done and
    all of makeup except the lips. Written straight to `ed` because what is under
    test is the CART's response to a state, not the route that reached it — the
    steps themselves are driven for real in the first test below. */
const throughMakeup = `
  return new Promise((r) => L.setState((s) => {
    const ed = JSON.parse(JSON.stringify(s.ed));
    ed.pimples = [2, 2, 2];
    for (const k of ['wash','moist','contour','blush','hl','shadow','liner','mascara']) ed.done[k] = true;
    ed.cov.blush = 1; ed.col.blush = '#f28ba0';
    ed.cov.shadow = 1; ed.col.shadow = '#a06cc9';
    return { ed };
  }, r));`;

test.describe('Glam Team Makeover — the trolley flows (tuning fix 3)', () => {
  test('a step that cannot be taken twice leaves the cart once it is taken', async ({ page }) => {
    const errors = await stage(page, { routine: 'on' });
    await page.getByRole('button', { name: /Go —/ }).click();

    // Opening cart: Wash is the first step of the TA and the only tool on the
    // skincare shelf that is reachable yet.
    expect((await shelves(page)).find((s) => s.label === 'Skincare').tools).toEqual(['Wash']);

    await paintTool(page, 'Wash');
    const afterWash = (await shelves(page)).find((s) => s.label === 'Skincare');
    expect(afterWash.tools, 'a washed face cannot be washed again — Wash is spent').not.toContain('Wash');
    expect(afterWash.tools, 'and the next step of the TA is what is offered instead').toContain('Moisturize');
    await expect(page.getByTitle('Wash', { exact: true })).toHaveCount(0);

    await paintTool(page, 'Moisturize');
    const afterMoist = (await shelves(page)).find((s) => s.label === 'Skincare');
    expect(afterMoist.tools).not.toContain('Moisturize');
    expect(afterMoist.tools, 'the spot steps are what is left of skincare').toEqual(['Treat spots', 'Conceal']);
    expect(errors).toEqual([]);
  });

  test('a shelf the child has moved on from folds to a header, and unfolds on a tap', async ({ page }) => {
    const errors = await stage(page, { routine: 'on' });
    await page.getByRole('button', { name: /Go —/ }).click();
    await logic(page, throughMakeup);

    const folded = await shelves(page);
    const byLabel = Object.fromEntries(folded.map((s) => [s.label, s]));

    // Settled shelves are folded — and folded means GONE from the surface, not
    // merely dimmed: the shades are not in the DOM to be tapped by accident.
    for (const label of ['Cheeks & glow', 'Eyes']) {
      expect(byLabel[label], `${label} should still have a header`).toBeTruthy();
      expect(byLabel[label].open, `${label} is settled, so it folds`).toBe(false);
      expect(byLabel[label].tools).toEqual([]);
    }
    await expect(page.getByTitle('Shadow violet', { exact: true })).toHaveCount(0);

    // A shelf with work left stays open, and the one-shot tools that ARE spent
    // (eyeliner, mascara) never come back with it.
    expect(byLabel['Lips'].open).toBe(true);

    await page.locator('[data-shelf="Eyes"] button[aria-expanded]').click();
    const opened = (await shelves(page)).find((s) => s.label === 'Eyes');
    expect(opened.open, 'the header is a re-expander, not a tombstone').toBe(true);
    expect(opened.tools, 'the shades the child can still switch between come back')
      .toEqual(['Shadow violet', 'Shadow bronze', 'Shadow rose gold', 'Shadow ocean', 'Shadow moss', 'Shadow midnight']);
    expect(opened.tools, 'the spent one-shot tools do not').not.toContain('Eyeliner');

    // …and it folds again on a second tap, so the child owns the state.
    await page.locator('[data-shelf="Eyes"] button[aria-expanded]').click();
    expect((await shelves(page)).find((s) => s.label === 'Eyes').open).toBe(false);
    expect(errors).toEqual([]);
  });

  test('the cart flows top-down — what is still to do sits above what is done', async ({ page }) => {
    const errors = await stage(page, { routine: 'on' });
    await page.getByRole('button', { name: /Go —/ }).click();
    await logic(page, throughMakeup);

    const order = await shelves(page);
    expect(order.length, 'the cart should be holding both kinds of shelf').toBeGreaterThan(2);

    // No settled shelf may sit above an unsettled one: once a settled shelf is
    // seen, everything after it is settled too.
    const settled = order.map((s) => s.tools.length === 0 || !s.open);
    const firstSettled = settled.indexOf(true);
    expect(firstSettled, 'something should have settled by mid-appointment').toBeGreaterThan(-1);
    expect(settled.slice(firstSettled).every(Boolean),
      `unsettled shelf below a settled one: ${order.map((s) => s.label).join(' → ')}`).toBe(true);

    // The top of the cart is always something the child can act on.
    expect(order[0].open).toBe(true);
    expect(order[0].tools.length).toBeGreaterThan(0);

    /* And the cart is pinned back to its top, so the shelf that just opened is
       not below the fold of a scroller the last step left scrolled down. */
    expect(await page.evaluate(() => document.getElementById('gtm-trolley').scrollTop)).toBe(0);
    expect(errors).toEqual([]);
  });

  test('free play keeps the flat catalogue its own chip promises', async ({ page }) => {
    const errors = await stage(page, { routine: 'free' });
    await page.getByRole('button', { name: /Go —/ }).click();

    await paintTool(page, 'Wash');
    await expect(page.getByTitle('Wash', { exact: true }),
      'free play is "all steps open" — nothing is out of sequence to move on from').toHaveCount(1);

    await logic(page, throughMakeup);
    const after = (await shelves(page)).find((s) => s.label === 'Eyes');
    expect(after.open, 'and no shelf folds itself in free play').toBe(true);
    expect(after.tools).toContain('Eyeliner');
    expect(errors).toEqual([]);
  });
});
