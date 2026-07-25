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

    // Rendered buttons, grouped by the station heading they sit under. Walked up
    // from each tool button (button → its row → the heading before it) rather than
    // matched on the heading's style, which the browser re-serialises.
    const stocked = await page.evaluate(() => {
      const out = {};
      for (const btn of document.querySelectorAll('button[title]')) {
        const row = btn.parentElement;
        const head = row && row.previousElementSibling;
        if (!head || !/^\s*\S+\s+\S/.test(head.textContent || '')) continue;
        const label = head.textContent.replace(/^\s*\S+\s*/, '').trim();
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
