import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover — paper-doll fidelity, measured rather than eyeballed.
 *
 * The redesign spec's §3.9 sweep ("sprite layers exactly aligned; sweep malformed
 * colorations, clipping, misplacement across all steps & models") is the one item
 * that cannot be settled by reading code: it is a claim about pixels. So every
 * assertion here diffs the real compositor's output on the real page.
 *
 * The findings each test descends from are in
 * docs/eval/glam-team-makeover-playtest.md §8 — F-10 (shirt colour drawn entirely
 * under the vanity ledge), F-11 (one fixed hitbox table shared by four
 * differently-proportioned faces), F-16 (blemish contrast) and the §8 notes on
 * target labels and "Keep painting… 100%".
 */

/** Evaluate `src` with `L` bound to the component instance (see glam-tt-game.spec.js). */
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

/** Boot into the game screen with the stage painted, collecting console errors. */
async function stage(page) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/glam-team-makeover/');
  // The refresh put the child's title screen in front; the ▶ Play this spec uses
  // is the BT's direct start, one ⚙ away.
  await page.getByTitle('Show / hide setup').click();
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.waitForFunction(() => {
    const c = document.getElementById('gtm-canvas');
    if (!c) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
    return false;
  }, undefined, { timeout: 20000 });
  return errors;
}

/* Every tool that draws on the doll, with the `ed` mutation that turns it on and
   the ZONE whose target box the child is told to work inside. Kept in one place
   so a new tool that forgets its zone shows up as an undefined-zone failure. */
const EFFECTS = `[
  { key:'wash',     zone:'face',    mech:'paint', mut:(ed)=>{ ed.cov.wash=1; } },
  { key:'moist',    zone:'face',    mech:'paint', mut:(ed)=>{ ed.cov.moist=1; } },
  { key:'contour',  zone:'contour', mech:'paint', mut:(ed)=>{ ed.cov.contour=1; } },
  { key:'blush',    zone:'cheeks',  mech:'paint', mut:(ed)=>{ ed.cov.blush=1; ed.col.blush='#f28ba0'; } },
  { key:'hl',       zone:'hl',      mech:'paint', mut:(ed)=>{ ed.cov.hl=1; } },
  { key:'shadow',   zone:'eyes',    mech:'paint', mut:(ed)=>{ ed.cov.shadow=1; ed.col.shadow='#a06cc9'; } },
  { key:'liner',    zone:'eyes',    mech:'tap',   mut:(ed)=>{ ed.cov.liner=1; } },
  { key:'mascara',  zone:'eyes',    mech:'tap',   mut:(ed)=>{ ed.cov.mascara=1; } },
  { key:'contacts', zone:'eyes',    mech:'tap',   mut:(ed)=>{ ed.col.contacts='#4a90d9'; } },
  { key:'lipliner', zone:'lips',    mech:'tap',   mut:(ed)=>{ ed.cov.lipliner=1; ed.col.lipliner='#b23a56'; } },
  { key:'lips',     zone:'lips',    mech:'paint', mut:(ed)=>{ ed.cov.lips=1; ed.col.lips='#d64b6a'; } },
  { key:'brows',    zone:'brows',   mech:'tap',   mut:(ed)=>{ ed.cov.brows=1; } },
  { key:'ear',      zone:'ears',    mech:'tap',   mut:(ed)=>{ ed.gl.ear='ring'; } },
  { key:'hair',     zone:'hair',    mech:'tap',   mut:(ed)=>{ ed.col.hair='heroblue'; } }
]`;

/* Shared browser-side helpers: settle the compositor, snapshot it, and diff two
   snapshots into a bounding box. Painting happens in componentDidUpdate and the
   masks decode asynchronously, so "settled" means the canvas stopped changing. */
const HELPERS = `
  const cv = document.getElementById('gtm-canvas');
  const ctx = cv.getContext('2d');
  const snap = () => ctx.getImageData(0,0,cv.width,cv.height);
  const hash = (d) => { let h=2166136261; for(let i=0;i<d.data.length;i+=997){ h=Math.imul(h^d.data[i],16777619)>>>0; } return h; };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const settle = async () => { let last=null, same=0;
    for (let i=0;i<80 && same<3;i++){ await frame(); const h=hash(snap()); if(h===last) same++; else { same=0; last=h; } }
    return snap(); };
  const setEd = (fn) => new Promise(r => L.setState(s => { const ed=JSON.parse(JSON.stringify(s.ed)); fn(ed); return {ed}; }, r));
  /* Switching model also has to wait for that model's hair masks to decode:
     until they do, \`_skinPool\` returns null and \`_spots\` falls back to the
     RAW pool, so a measurement taken in that window reads spot positions the
     compositor has already stopped painting at. (Latent before the refresh —
     it only surfaced once m1 left the roster and m2 became the first model
     measured, with no earlier model's cycle to cover the decode.) */
  const setModel = async (m) => {
    await new Promise(r => L.setState({ model:m, ed:L.freshEd('person') }, r));
    for (let i=0;i<80 && !L._skinPool(m);i++) await new Promise(r => setTimeout(r,100));
  };
  const diff = (a,b) => { const W=cv.width,H=cv.height; let t=1e9,bt=-1,l=1e9,r=-1,n=0;
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i=(y*W+x)*4;
      const d = Math.abs(b.data[i]-a.data[i])+Math.abs(b.data[i+1]-a.data[i+1])
              + Math.abs(b.data[i+2]-a.data[i+2])+Math.abs(b.data[i+3]-a.data[i+3]);
      if(d>18){ n++; if(y<t)t=y; if(y>bt)bt=y; if(x<l)l=x; if(x>r)r=x; } }
    return n ? { n, pct:n/(W*H)*100, t:t/H*100, b:bt/H*100, l:l/W*100, r:r/W*100 } : null; };
`;

test.describe('Glam Team Makeover — paper-doll fidelity', () => {
  test('F-11 · every tool paints inside its own target box, on every roster model', async ({ page }) => {
    test.setTimeout(180000); // every roster model × tool composite, diffed pixel by pixel
    const errors = await stage(page);

    const rows = await logic(page, `return (async () => {
      ${HELPERS}
      const EFFECTS = ${EFFECTS};
      const out = [];
      for (const m of window.GlamStory.MODELS) {
        await setModel(m); await settle();
        for (const e of EFFECTS) {
          await new Promise(r => L.setState({ ed: L.freshEd('person') }, r));
          const before = await settle();
          await setEd(e.mut);
          const after = await settle();
          const d = diff(before, after);
          const z = L._targetZone('person', e.zone, e.mech);
          out.push({ model:m, key:e.key, zone:e.zone, painted:d,
            box: z ? { t:z.t, b:z.t+z.h, l:z.l, r:z.l+z.w, label:z.label } : null });
        }
      }
      return out;
    })();`);

    const roster = await page.evaluate(() => window.GlamStory.MODELS);
    expect(rows.length).toBe(roster.length * 14);
    for (const r of rows) {
      const where = `${r.model}/${r.key}`;
      // A tool that paints nothing is its own defect — a charged action with no result.
      expect(r.painted, `${where} should change pixels at all`).not.toBeNull();
      expect(r.box, `${where} should have a target box`).not.toBeNull();
      // The whole point: the box the child is told to work in must contain the
      // pixels the tool actually changes. The pre-redesign fixed table failed
      // this on 32 of the 56 combinations it was measured over.
      const p = r.painted, b = r.box;
      expect(p.t, `${where} paints above its box (${p.t.toFixed(1)} < ${b.t})`).toBeGreaterThanOrEqual(b.t - 0.01);
      expect(p.b, `${where} paints below its box (${p.b.toFixed(1)} > ${b.b})`).toBeLessThanOrEqual(b.b + 0.01);
      expect(p.l, `${where} paints left of its box (${p.l.toFixed(1)} < ${b.l})`).toBeGreaterThanOrEqual(b.l - 0.01);
      expect(p.r, `${where} paints right of its box (${p.r.toFixed(1)} > ${b.r})`).toBeLessThanOrEqual(b.r + 0.01);
    }

    // …and the boxes have to track the model, not be one shared table. The
    // face is registered identically across models, so it is the eye SIZE that
    // differs; a per-model box therefore differs in size between models.
    const faceBoxes = new Set(rows.filter((r) => r.key === 'wash').map((r) => JSON.stringify(r.box)));
    expect(faceBoxes.size, 'the face box should differ between models').toBeGreaterThan(1);

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('F-10 · a shirt colour is visible above the vanity ledge on every model', async ({ page }) => {
    test.setTimeout(120000);
    await stage(page);

    const res = await logic(page, `return (async () => {
      ${HELPERS}
      const ledge = [...document.querySelectorAll('div')].find(d => {
        const st = d.getAttribute('style') || '';
        return st.includes('linear-gradient') && st.includes('210, 190, 156'); });
      if (!ledge) return { error: 'vanity ledge not found' };
      const out = { models:{} };
      for (const m of window.GlamStory.MODELS) {
        await setModel(m); const before = await settle();
        await setEd((ed) => { ed.outfit = 'sparkle'; });
        const after = await settle();
        const d = diff(before, after);
        const cr = cv.getBoundingClientRect(), lr = ledge.getBoundingClientRect();
        // the ledge gradient is clear to 14% of its height and effectively opaque
        // from 22% down; above that line the shirt is on screen.
        const opaqueTop = lr.top + lr.height * 0.22;
        let visible = 0;
        const W = cv.width, H = cv.height;
        const a = before, b = after;
        for (let y=0;y<H;y++) { const pageY = cr.top + (y+0.5)/H*cr.height;
          if (pageY >= opaqueTop) break;
          for (let x=0;x<W;x++){ const i=(y*W+x)*4;
            const dd = Math.abs(b.data[i]-a.data[i])+Math.abs(b.data[i+1]-a.data[i+1])+Math.abs(b.data[i+2]-a.data[i+2]);
            if (dd>18) visible++; } }
        out.models[m] = { total:d ? d.n : 0, visible, pct: d ? visible/d.n*100 : 0,
          cutEdgeCovered: cr.bottom > opaqueTop };
      }
      return out;
    })();`);

    expect(res.error).toBeUndefined();
    for (const [m, v] of Object.entries(res.models)) {
      expect(v.total, `${m}: the shirt tool should repaint the tee`).toBeGreaterThan(500);
      // Before the fix this was 0 on m1/m3/m4 — the ledge's opaque body began at
      // page-Y 689 and the shirt art paints at 728–752.
      expect(v.visible, `${m}: shirt pixels should land above the ledge`).toBeGreaterThan(200);
      expect(v.pct, `${m}: only ${v.pct.toFixed(1)}% of the shirt is on screen`).toBeGreaterThan(15);
      // …while the ledge still does its job of burying the doll's hard bottom cut.
      expect(v.cutEdgeCovered, `${m}: the ledge must still cover the canvas bottom edge`).toBe(true);
    }
  });

  test('F-16 · every blemish clears 3:1 contrast against the skin around it', async ({ page }) => {
    test.setTimeout(120000);
    await stage(page);

    const res = await logic(page, `return (async () => {
      ${HELPERS}
      const lum = (r,g,b) => { const f=c=>{ c/=255; return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4); };
        return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
      const out = {};
      for (const m of window.GlamStory.MODELS) {
        await setModel(m); await settle();
        const E = L.genEntry(), spots = L._spots(E), fr = L.gen().frame;
        const d = snap();
        const px = (x,y) => { const i=((y|0)*cv.width+(x|0))*4; return [d.data[i],d.data[i+1],d.data[i+2]]; };
        out[m] = spots.map(s => {
          const cx=s.x/fr.w*cv.width, cy=s.y/fr.h*cv.height, r=s.r/fr.w*cv.width;
          const c = px(cx,cy);
          let sr=0,sg=0,sb=0;
          for (let a=0;a<8;a++){ const th=a*Math.PI/4; const p=px(cx+Math.cos(th)*r*2.6, cy+Math.sin(th)*r*2.6); sr+=p[0];sg+=p[1];sb+=p[2]; }
          const l1=lum(c[0],c[1],c[2]), l2=lum(sr/8,sg/8,sb/8);
          return +(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05))).toFixed(2);
        });
      }
      return out;
    })();`);

    // Baseline before the fix: 1.06–1.67 : 1 on every spot, across every
    // model — the eval flagged m3/m4 but the numbers indicted every model.
    for (const [m, ratios] of Object.entries(res)) {
      expect(ratios.length, `${m} should seed three spots`).toBe(3);
      for (const r of ratios) {
        expect(r, `${m}: a blemish at ${r}:1 is not findable`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  /* Refresh fix 2 — the blemishes read as gentle, not clinical.
     F-16 above pins the VALUE and cannot move: at skin L≈0.20 a 3:1 dark target
     has to sit near L≈0.02, so "softer" could never have meant "paler". It means
     a softer FORM, and the form is what this measures. The harsh version drew a
     crisp filled disc, a near-black rim STROKE around it and a specular gloss dot
     offset up-left — the three cues that made it read as a pustule rather than a
     bit of skin to take care of. Each leaves its own signature in the radial
     profile of the paint, and the profile is what the assertions below read:

       harsh, measured  rel [1, 1, 1, .96, .95, 1.0, 1.05, .90, .12, .08, …]
       soft,  measured  rel [1, .96, .90, .83, .73, .56, .36, .08, .02, .01, …]

       · filled disc → holds full strength, then falls off a cliff in one step
       · rim stroke  → a ring STRONGER than the ones inside it
       · gloss       → one sector of a ring far off the rest (radial asymmetry)

     Measured against a blemish-FREE render of the SAME face (pimples set to
     `clear`, same seed, so the spots stay put), which isolates the paint from
     whatever the skin underneath was already doing. A raw against-the-skin
     profile is far too noisy to assert on: the face's own shading swings ±0.09
     across a single spot, which swamps everything above. */
  test('refresh · blemishes are soft — the paint decays, with no rim, cliff or gloss', async ({ page }) => {
    test.setTimeout(120000);
    const errors = await stage(page);

    const res = await logic(page, `return (async () => {
      ${HELPERS}
      const lum = (r,g,b) => { const f=c=>{ c/=255; return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4); };
        return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
      // dense enough that a hard edge cannot hide between two samples
      const RADII = []; for (let f=0; f<=1.6001; f+=0.05) RADII.push(+f.toFixed(2));
      const out = {};
      for (const m of window.GlamStory.MODELS) {
        await setModel(m);
        await setEd((ed) => { ed.pimples = [2,2,2]; });   // 2 = cleared: nothing drawn
        const clean = await settle();
        await setEd((ed) => { ed.pimples = [0,0,0]; });
        const dirty = await settle();
        const E = L.genEntry(), spots = L._spots(E), fr = L.gen().frame;
        const at = (d,x,y) => { const i=((y|0)*cv.width+(x|0))*4; return lum(d.data[i],d.data[i+1],d.data[i+2]); };
        out[m] = spots.map(s => {
          const cx=s.x/fr.w*cv.width, cy=s.y/fr.h*cv.height, r=s.r/fr.w*cv.width;
          const ink = L._spotInk(E, s), h = ink.core.slice(1);
          const inkLum = lum(parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16));
          /* COVERAGE, not raw luminance delta. A paint of alpha a over skin s
             lands at s + a·(ink − s), so the raw delta scales with how far the
             skin under THAT pixel already is from the ink — and the face's own
             shading moves that by ±10% inside a single spot, which is enough to
             fake a rim. Dividing it back out leaves the compositor's actual
             alpha, which is a property of the brush alone. Pixels whose skin is
             already near the ink are dropped: there the divisor collapses and
             the coverage is unrecoverable, not merely noisy. */
          const alpha = (x,y) => { const c=at(clean,x,y), d=inkLum-c;
            return Math.abs(d) < 0.06 ? null : (at(dirty,x,y)-c)/d; };
          const rings = RADII.map(f => {
            const vs=[];
            if (!f) { const v=alpha(cx,cy); if(v!=null) vs.push(v); }
            else for (let a=0;a<12;a++){ const th=a*Math.PI/6;
              const v=alpha(cx+Math.cos(th)*r*f, cy+Math.sin(th)*r*f); if(v!=null) vs.push(v); }
            if (!vs.length) return null;
            return { n:vs.length, mean:vs.reduce((p,q)=>p+q,0)/vs.length,
                     lo:Math.min(...vs), hi:Math.max(...vs) };
          });
          return { rings };
        });
      }
      return { out, radii: RADII };
    })();`);

    expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);

    const R = res.radii;
    const atR = (f) => R.findIndex((x) => Math.abs(x - f) < 1e-6);
    for (const [m, spots] of Object.entries(res.out)) {
      expect(spots.length, `${m} should seed three spots`).toBe(3);
      spots.forEach((s, i) => {
        const where = `${m}/spot${i}`;
        // coverage per ring, in order. A ring with too few usable samples is
        // dropped rather than guessed at — an unmeasurable ring is not a defect.
        const prof = s.rings
          .map((r, k) => (r && r.n >= (k ? 8 : 1) ? { f: R[k], a: r.mean, lo: r.lo } : null))
          .filter(Boolean);
        expect(prof.length, `${where}: too little of the spot is measurable`)
          .toBeGreaterThan(R.length * 0.7);
        const peak = Math.max(...prof.map((x) => x.a));

        // painted at all — a target nobody can see is not a target
        expect(peak, `${where}: the blemish barely paints anything`).toBeGreaterThan(0.5);

        // NO CLIFF — a soft falloff never sheds most of itself in one twentieth of
        // a radius. The filled disc did exactly that: .90 → .12 in a single step.
        for (let k = 1; k < prof.length; k++) {
          const drop = prof[k - 1].a - prof[k].a;
          expect(drop, `${where}: coverage falls ${(drop * 100).toFixed(0)} points between `
            + `r×${prof[k - 1].f} and r×${prof[k].f} — that is a hard edge, not a falloff`)
            .toBeLessThan(0.35);
        }

        // NO RIM — nothing further out is more covered than everything inside it.
        // The stroked outline was drawn in a darker ink than the core it ringed,
        // so it reads as coverage above 1: impossible for a single soft brush.
        let strongestInside = Infinity;
        for (const x of prof) {
          if (x.f < 0.15) { strongestInside = Math.min(strongestInside, x.a); continue; }
          expect(x.a, `${where}: r×${x.f} (${x.a.toFixed(3)}) is more covered than the paint `
            + `inside it (${strongestInside.toFixed(3)}) — that is a stroked outline`)
            .toBeLessThanOrEqual(strongestInside + 0.08);
          strongestInside = Math.min(strongestInside, Math.max(x.a, 0));
        }

        // nothing anywhere swings back past the bare skin
        for (const x of prof) {
          expect(x.lo, `${where}: negative coverage at r×${x.f} — paint going the wrong way`)
            .toBeGreaterThan(-0.1);
        }

        // and it dissolves into the face rather than ending somewhere the eye can
        // trace: essentially gone by its own radius, entirely gone past it
        const cov = (f) => (s.rings[atR(f)] || {}).mean;
        expect(cov(1), `${where}: still ${cov(1).toFixed(3)} covered at r×1.0`).toBeLessThan(0.1);
        expect(Math.abs(cov(1.5)), `${where}: not faded out by r×1.5`).toBeLessThan(0.05);
      });
    }
  });

  test('F-16b · no seeded blemish lands under the hair, in any model × hairstyle', async ({ page }) => {
    test.setTimeout(180000);
    await stage(page);

    // The blemish pool is per model; the hair mask is per hairstyle. Measured
    // before the fix: 10 of the 28 model×style combinations had at least one pool
    // point under hair, so a run could seed a target with nothing beneath the ring.
    const rows = await logic(page, `return (async () => {
      ${HELPERS}
      const wait = async (fn) => { for (let i=0;i<60;i++){ const v=fn(); if(v) return v; await new Promise(r=>setTimeout(r,150)); } return null; };
      const out = [];
      for (const m of window.GlamStory.MODELS) {
        await setModel(m);
        const pool = await wait(() => L._skinPool(m));
        await settle();
        const spots = L._spots(L.genEntry()), fr = L.gen().frame;
        for (const st of Object.keys(L.gen().models[m].styles)) {
          await setEd((ed) => { ed.hairShape = st; });
          const md = await wait(() => L._data(L.genEntry().mask));
          const onHair = spots.filter(s => {
            const x = Math.round(s.x/fr.w*md.width), y = Math.round(s.y/fr.h*md.height);
            return md.data[(y*md.width+x)*4]/255 > 0.3; }).length;
          out.push({ model:m, style:st, poolSize:(pool||[]).length, spots:spots.length, onHair });
        }
      }
      return out;
    })();`);

    // every roster model × every hairstyle it ships (7 apiece)
    const roster = await page.evaluate(() => window.GlamStory.MODELS);
    expect(rows.length).toBe(roster.length * 7);
    for (const r of rows) {
      expect(r.spots, `${r.model} should always offer three targets`).toBe(3);
      expect(r.poolSize, `${r.model} should keep enough pool points to seed from`).toBeGreaterThanOrEqual(3);
      expect(r.onHair, `${r.model}/${r.style}: ${r.onHair} blemish(es) drawn under the hair`).toBe(0);
    }
  });

  test('target labels name the tool\'s mechanic, and a finished step stops nagging', async ({ page }) => {
    await stage(page);
    await page.getByRole('button', { name: /Go —/ }).click();

    // Eyeliner/mascara/lip liner are single-tap tools that share the eyes and lips
    // zones with drag tools; the old zone-owned label told the child to "Drag
    // across the eyes" for all of them (eval §8).
    const labels = await logic(page, `
      const out = {};
      for (const [zone, mech] of [['eyes','tap'],['eyes','paint'],['lips','tap'],['lips','paint'],['brows','tap'],['face','paint']]) {
        out[zone + ':' + mech] = L._targetZone('person', zone, mech).label;
      }
      return out;`);
    expect(labels['eyes:tap']).toBe('Tap the eyes');
    expect(labels['eyes:paint']).toBe('Drag over the eyes');
    expect(labels['lips:tap']).toBe('Tap the lips');
    expect(labels['lips:paint']).toBe('Drag over the lips');
    expect(labels['brows:tap']).toBe('Tap the brows');
    expect(labels['face:paint']).toBe('Drag over the face');

    // "Keep painting… 100%" told the child to keep going on a finished step.
    await page.getByRole('button', { name: /^Wash/ }).click();
    const target = page.locator('div[style*="gtm-target"]').first();
    await expect(target).toContainText('Drag over the face');
    await logic(page, `return new Promise(r => L.setState(s => { const ed=JSON.parse(JSON.stringify(s.ed)); ed.cov.wash=1; return {ed}; }, r));`);
    await expect(target).toContainText('All done ✓');
    await expect(target).not.toContainText('Keep painting');
  });

  /* ── TUNING pass, fix 4a ────────────────────────────────────────────────────
     The maintainer found the lip liner speckled with little squares along the
     seam where the top and bottom lip meet, bunched toward one corner. The cause
     was in the mask, not the brush: the lip region is not simply connected — the
     seam is drawn as a thin low-green gap — so "is a neighbour outside the lip?"
     answered YES in the middle of the mouth. A liner traces the OUTER silhouette
     and nothing else, which is what this test states. */
  test('T4a · the lip liner traces the silhouette, never the seam inside the mouth', async ({ page }) => {
    test.setTimeout(120000);
    const errors = await stage(page);

    const rows = await logic(page, `return (async () => {
      const out = [];
      for (const m of window.GlamStory.MODELS) {
        await new Promise(r => L.setState({ model:m, ed:L.freshEd('person') }, r));
        for (let i=0;i<80 && !L._skinPool(m);i++) await new Promise(r => setTimeout(r,100));
        const E = L.genEntry();
        const md = L._data(E.mask);
        const W = md.width, H = md.height, mk = md.data;
        const G = (i) => mk[i*4+1]/255;
        /* INTERIOR = lip mask on all four sides at 3..5 px, i.e. nowhere near the
           silhouette. Any ink there is a seam artifact by construction. */
        const interior = (i) => { for (let k=3;k<=5;k++){
            if(!(G(i-k)>0.4)||!(G(i+k)>0.4)||!(G(i-k*W)>0.4)||!(G(i+k*W)>0.4)) return false; }
          return true; };
        const cv = L._lipLinerCanvas(E, '#b23a56');
        const px = cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data;
        let ink=0, inside=0, x0=W, x1=0, y0=H, y1=0;
        for (let y=2;y<H-2;y++) for (let x=2;x<W-2;x++){ const i=y*W+x;
          if (px[i*4+3] <= 8) continue;
          ink++; if (interior(i)) inside++;
          if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
        // the lip mask's own bbox, so "did the liner go all the way round?" is
        // measured against the mouth rather than against a magic number
        let lx0=W, lx1=0, ly0=H, ly1=0;
        for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if(G(y*W+x)>0.4){
          if(x<lx0)lx0=x; if(x>lx1)lx1=x; if(y<ly0)ly0=y; if(y>ly1)ly1=y; } }
        out.push({ model:m, ink, inside, box:[x0,y0,x1,y1], lip:[lx0,ly0,lx1,ly1] });
      }
      return out;
    })();`);

    const roster = await page.evaluate(() => window.GlamStory.MODELS);
    expect(rows.length).toBe(roster.length);
    for (const r of rows) {
      // A liner that draws nothing would pass the artifact check vacuously.
      expect(r.ink, `${r.model}: the liner should draw`).toBeGreaterThan(120);
      expect(r.inside, `${r.model}: ${r.inside} liner px inside the lip interior`).toBe(0);
      // and it must still ring the whole mouth, within the 2 px the trace is wide
      const [x0, y0, x1, y1] = r.box, [lx0, ly0, lx1, ly1] = r.lip;
      expect(x0 - lx0, `${r.model}: liner misses the left corner`).toBeLessThanOrEqual(2);
      expect(lx1 - x1, `${r.model}: liner misses the right corner`).toBeLessThanOrEqual(2);
      expect(y0 - ly0, `${r.model}: liner misses the top edge`).toBeLessThanOrEqual(2);
      expect(ly1 - y1, `${r.model}: liner misses the bottom edge`).toBeLessThanOrEqual(2);
    }
    expect(errors).toEqual([]);
  });

  /* ── TUNING pass, fix 4b ────────────────────────────────────────────────────
     Colored contacts used to fill a disc sized off the FACE anchor
     (`min(eyeW,eyeH)·0.58`) rather than off the art, so the colour ran past the
     iris onto the sclera and down over the lower lid margin. The recolour is now
     built in the sprite's own frame and clipped to `_irisBox` — the iris circle
     intersected with the lid line. Note the assertions are taken against
     `_irisBox` itself, not against a copy of IRISCFG: a bound the test re-derives
     by hand is a bound that drifts the first time the table moves. */
  test('T4b · a coloured contact stays inside the iris and under the lid', async ({ page }) => {
    test.setTimeout(120000);
    const errors = await stage(page);

    const rows = await logic(page, `return (async () => {
      ${HELPERS}
      const out = [];
      for (const m of window.GlamStory.MODELS) {
        await setModel(m);
        const before = await settle();
        await setEd((ed) => { ed.col.contacts = '#4a90d9'; });
        const after = await settle();
        const W = cv.width, H = cv.height;
        const boxes = L._irisBoxes(W, H);
        const f = L.genEntry().face;
        const eyes = [[f.eyeL.w*W, f.eyeL.h*H],[f.eyeR.w*W, f.eyeR.h*H]];
        let changed=0, out1=0, worst=0;
        for (let y=0;y<H;y++) for (let x=0;x<W;x++){ const i=(y*W+x)*4;
          const d = Math.abs(after.data[i]-before.data[i]) + Math.abs(after.data[i+1]-before.data[i+1])
                  + Math.abs(after.data[i+2]-before.data[i+2]);
          if (d <= 18) continue; changed++;
          // in bounds = inside SOME eye's iris circle and at or below its lid
          // line; near is how far outside the nearest bound a stray pixel fell
          let ok=false, near=1e9;
          for (const b of boxes){ const dist=Math.hypot(x-b.cx, y-b.cy);
            if (dist <= b.r+1.5 && y >= b.top-1.5) ok=true;
            near = Math.min(near, Math.max(dist-b.r, b.top-y)); }
          if (!ok){ out1++; worst=Math.max(worst,near); } }
        out.push({ model:m, changed, outOfBound:out1, worst:+worst.toFixed(2),
          radius: boxes.map((b,k) => ({ shipped:+b.r.toFixed(2), retired:+(Math.min(eyes[k][0],eyes[k][1])*0.58).toFixed(2) })) });
      }
      return out;
    })();`);

    const roster = await page.evaluate(() => window.GlamStory.MODELS);
    expect(rows.length).toBe(roster.length);
    for (const r of rows) {
      // A recolour that draws nothing would pass the bound vacuously.
      expect(r.changed, `${r.model}: contacts should recolour the iris`).toBeGreaterThan(400);
      expect(r.outOfBound,
        `${r.model}: ${r.outOfBound} contact px outside the iris/lid bound (worst ${r.worst} px)`).toBe(0);
      // An UPPER bound as well as an in-bounds one: the retired face-anchor disc
      // passed "is it on the eye?" too. It must not come back.
      for (const q of r.radius) {
        expect(q.shipped, `${r.model}: iris radius ${q.shipped} is not smaller than the retired ${q.retired}`)
          .toBeLessThan(q.retired);
      }
    }
    expect(errors).toEqual([]);
  });

  /* ── T4c / T4d / T4e — the three procedural cosmetics ──────────────────────
     These three tools are not sprites and not mask recolours: each is a filled
     ellipse with a gradient in it, so "is it malformed?" is a question about the
     SHAPE OF ITS FOOTPRINT, measured against the same face without the tool.
     `FOOT` below returns that shape per side of the face:
       · ecc   — anisotropy of the delta-weighted second-moment tensor. 0 for a
                 circle, → 1 for a line. This is the "is the blush a disc?"
                 number, and unlike a bbox ratio it does not depend on where the
                 ellipse happens to land on the pixel grid.
       · theta — that tensor's principal angle in degrees, +y down, so a sweep
                 whose OUTER end lifts toward the temple has theta·side < 0.
       · maxComp — the most connected components the smoothed footprint splits
                 into anywhere in a sweep of level sets. One blob can never
                 exceed 1; two overlapping blobs with different cores separate at
                 some level, which is exactly the patchiness of the retired
                 eyeshadow pair. Smoothing first (5×5 box) stops single-pixel
                 noise from splitting a blob on its own. */
  const FOOT = `
    const foot = (a, b, side) => {
      const W = cv.width, H = cv.height;
      const D = new Float64Array(W*H);
      const lo = side<0 ? 0 : W>>1, hi = side<0 ? W>>1 : W;
      let n=0, peak=0, x0=1e9, y0=1e9, x1=-1, y1=-1;
      for (let y=0;y<H;y++) for (let x=lo;x<hi;x++){ const i=(y*W+x)*4;
        const d = Math.max(Math.abs(a.data[i]-b.data[i]), Math.abs(a.data[i+1]-b.data[i+1]),
                           Math.abs(a.data[i+2]-b.data[i+2]));
        D[y*W+x]=d; if (d<=2) continue;
        n++; if (d>peak) peak=d;
        if (x<x0)x0=x; if (x>x1)x1=x; if (y<y0)y0=y; if (y>y1)y1=y; }
      if (!n) return { n:0 };
      let sw=0,sx=0,sy=0;
      for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){ const d=D[y*W+x]; if(d<=2) continue;
        sw+=d; sx+=d*x; sy+=d*y; }
      const mx=sx/sw, my=sy/sw; let uxx=0,uyy=0,uxy=0;
      for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){ const d=D[y*W+x]; if(d<=2) continue;
        uxx+=d*(x-mx)*(x-mx); uyy+=d*(y-my)*(y-my); uxy+=d*(x-mx)*(y-my); }
      uxx/=sw; uyy/=sw; uxy/=sw;
      const theta = 0.5*Math.atan2(2*uxy, uxx-uyy)*180/Math.PI;
      const ecc = Math.sqrt((uxx-uyy)*(uxx-uyy) + 4*uxy*uxy) / (uxx+uyy);
      const S = new Float64Array(W*H);
      for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){ let s=0,c=0;
        for (let dy=-2;dy<=2;dy++) for (let dx=-2;dx<=2;dx++){ const yy=y+dy, xx=x+dx;
          if (yy<0||yy>=H||xx<lo||xx>=hi) continue; s+=D[yy*W+xx]; c++; }
        S[y*W+x]=s/c; }
      let spk=0;
      for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) if (S[y*W+x]>spk) spk=S[y*W+x];
      /* A blotch is a REGION, not a pixel: only components worth 2% of the
         footprint count. Without that floor the eye sprite drawn over the lid
         pinches the level set apart by a pixel or two at one level on some
         model × side, which is an occlusion, not a second blob. */
      const MINPX = Math.max(20, n*0.02);
      const comps = (lvl) => { const seen=new Set(); let k=0;
        for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){ const id=y*W+x;
          if (S[id]<lvl || seen.has(id)) continue;
          let sz=0; const st=[id]; seen.add(id);
          while (st.length){ const p=st.pop(), py=(p/W)|0, px=p%W; sz++;
            for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){ const yy=py+dy, xx=px+dx;
              if (yy<y0||yy>y1||xx<x0||xx>x1) continue; const q=yy*W+xx;
              if (seen.has(q)||S[q]<lvl) continue; seen.add(q); st.push(q); } }
          if (sz>=MINPX) k++; }
        return k; };
      let maxComp=0;
      for (let i=0;i<12;i++) maxComp = Math.max(maxComp, comps(spk*(0.35+i*0.05)));
      const f = L.genEntry().face;
      const ew = (f.eyeL.w+f.eyeR.w)/2*W, eh = (f.eyeL.h+f.eyeR.h)/2*H;
      return { n, peak, maxComp, theta:+theta.toFixed(1), ecc:+ecc.toFixed(3),
               area:+(n/(ew*eh)).toFixed(2) };
    };`;

  test('T4c · the eyeshadow is ONE lid gradient — never two blobs meeting in a blotch', async ({ page }) => {
    test.setTimeout(120000);
    const errors = await stage(page);

    const rows = await logic(page, `return (async () => {
      ${HELPERS}
      ${FOOT}
      const out = [];
      for (const m of window.GlamStory.MODELS) {
        await setModel(m);
        const before = await settle();
        await setEd((ed) => { ed.cov.shadow = 1; ed.col.shadow = '#a06cc9'; });
        const after = await settle();
        for (const side of [-1, 1]) out.push({ model:m, side, ...foot(before, after, side) });
      }
      return out;
    })();`);

    const roster = await page.evaluate(() => window.GlamStory.MODELS);
    expect(rows.length).toBe(roster.length * 2);
    for (const r of rows) {
      const where = `${r.model}/${r.side < 0 ? 'left' : 'right'} lid`;
      // A wash that paints nothing would satisfy "one hot spot" vacuously.
      expect(r.n, `${where}: the eyeshadow should paint the lid`).toBeGreaterThan(400);
      /* The whole fix. The retired pair — a lid blob in the chosen shade plus a
         twice-shaded crease rotated across its outer half — split into two hot
         spots on every model and both sides (measured: at 4–8 of these 12
         levels). One gradient, however deep its core, cannot. */
      expect(r.maxComp,
        `${where}: the footprint splits into ${r.maxComp} hot spots at some level — that is the blotch`)
        .toBe(1);
    }
    expect(errors).toEqual([]);
  });

  test('T4d · the blush is a soft angled sweep, not a disc stamped on the cheek', async ({ page }) => {
    test.setTimeout(120000);
    const errors = await stage(page);

    const rows = await logic(page, `return (async () => {
      ${HELPERS}
      ${FOOT}
      const out = [];
      for (const m of window.GlamStory.MODELS) {
        await setModel(m);
        const before = await settle();
        await setEd((ed) => { ed.cov.blush = 1; ed.col.blush = '#f28ba0'; });
        const after = await settle();
        for (const side of [-1, 1]) out.push({ model:m, side, ...foot(before, after, side) });
      }
      return out;
    })();`);

    const roster = await page.evaluate(() => window.GlamStory.MODELS);
    expect(rows.length).toBe(roster.length * 2);
    for (const r of rows) {
      const where = `${r.model}/${r.side < 0 ? 'left' : 'right'} cheek`;
      expect(r.n, `${where}: the blush should paint the cheek`).toBeGreaterThan(500);
      // The retired blob was 0.95ew × 0.9eh on landmarks that are near square,
      // and measured ecc 0.009–0.051 — a circle to three decimal places.
      expect(r.ecc, `${where}: ecc ${r.ecc} — the blush is still a disc`).toBeGreaterThan(0.32);
      // …but a sweep, not a slash: an upper bound as well.
      expect(r.ecc, `${where}: ecc ${r.ecc} — the blush has become a stripe`).toBeLessThan(0.80);
      // Angled up toward the temple, so the OUTER end lifts. theta is measured
      // with +y down, which makes that sign negative once multiplied by the side.
      expect(r.theta * r.side, `${where}: theta ${r.theta}° does not lift toward the temple`)
        .toBeLessThan(-10);
      // Softer, not louder: the peak must not creep back up.
      expect(r.peak, `${where}: peak delta ${r.peak} — the blush got stronger, not softer`)
        .toBeLessThanOrEqual(34);
    }
    expect(errors).toEqual([]);
  });

  /* SECOND PASS — this test now HEALS the blemishes before it measures, and the
     bounds below are untouched. `peak` is a delta, and a screen lift is
     `alpha × (255 − substrate)`: over skin at ~174 that is 81 to play with, over
     a blemish core at ~126 it is 129. So the same highlight, at the same
     strength, measures half again as high wherever it happens to cross a spot —
     and `freshEd` seeds where the spots go off `Math.random`.
     U2's sweep is longer than the ellipse it replaced and does now reach one on
     m3's right cheek, which read as peak 59 against a bound of 56. Measured at
     that pixel the implied alpha is 0.457, and at the sweep's own skin peak
     0.506 — against 0.59–0.60 for the ellipse this replaced. The highlight got
     GENTLER, which is the direction this test asks for; what moved was the
     substrate under it. Healing first measures the tool instead of the spot. */
  test('T4e · the highlight is smaller and gentler — and still reads as light', async ({ page }) => {
    test.setTimeout(120000);
    const errors = await stage(page);

    const rows = await logic(page, `return (async () => {
      ${HELPERS}
      ${FOOT}
      const out = [];
      for (const m of window.GlamStory.MODELS) {
        await setModel(m);
        await setEd((ed) => { ed.pimples = (ed.pimples||[]).map(() => 2); });
        const before = await settle();
        await setEd((ed) => { ed.cov.hl = 1; });
        const after = await settle();
        for (const side of [-1, 1]) out.push({ model:m, side, ...foot(before, after, side) });
      }
      return out;
    })();`);

    const roster = await page.evaluate(() => window.GlamStory.MODELS);
    expect(rows.length).toBe(roster.length * 2);
    for (const r of rows) {
      const where = `${r.model}/${r.side < 0 ? 'left' : 'right'} cheekbone`;
      /* Footprint in units of one eye's area, so the bound is the same number on
         every model. The retired pair of plates measured 1.97–2.02 eye-areas per
         side; the shipped glow measures 0.58–0.59. */
      expect(r.area, `${where}: the highlight covers ${r.area} eye-areas — still a plate`)
        .toBeLessThan(1.15);
      // Both bounds matter (T5's lesson): "it glows" passes at the strength that
      // was rejected unless the test also says how much is too much.
      expect(r.area, `${where}: the highlight covers only ${r.area} eye-areas — it has lost its impact`)
        .toBeGreaterThan(0.25);
      expect(r.peak, `${where}: peak lift ${r.peak} — the highlight is still harsh`).toBeLessThan(56);
      expect(r.peak, `${where}: peak lift ${r.peak} — the highlight no longer reads as light`)
        .toBeGreaterThan(26);
    }
    expect(errors).toEqual([]);
  });

  /* ── U1 / U2 — the highlight's falloff and its silhouette ───────────────────
     T4e settled how BIG the highlight is and how HARD it hits, and the
     maintainer accepted both. What came back after it shipped was two things
     T4e never measured:

       U1 · "the fade-off needs to start closer to center". The raised cosine is
            still ~85 % of peak a quarter of the way out, so a bright plateau
            sits inside the shape and the plateau's own edge is what reads as a
            rim. Neither `area` nor `peak` can see that — a plateau and a glow of
            the same footprint and the same peak score identically on both.
       U2 · "the shape should be like two mirrord kidney beans, almost, tracking
            the 'turn' of the outer convergence of the eye socket and the
            cheekbone". One ellipse per cheek is a lozenge at every rotation.

     `SWEEP` measures the CHEEK sweep alone — the `hl` tool also lays a stripe
     down the nose bridge, and the W/2 side split drops half that stripe into
     each side's footprint, which would bend the spine of anything measured
     there. A band of ±0.8 eye-widths around the eye midpoint is excluded: wider
     than the stripe (±0.20 ew), clear of the sweep (inner edge ~1.5 ew out).

       bowR  answers U2. The spine — the delta-weighted mean cross-offset per bin
             along the footprint's own principal axis — is fitted with a
             quadratic, and bowR is the arc's mid-point deviation from its chord
             over that chord. An ellipse has a straight spine at EVERY rotation
             and EVERY aspect, so no ellipse can score here however it is tilted;
             only a genuinely curved silhouette can.
       bowS  is that bow's direction. Mirroring a shape flips the principal axis
             and leaves the cross-axis alone, so two true mirrors agree on it —
             which is the assertion that the sweeps are mirrored and not merely
             both present.
       core  and r50 answer U1: the share of the footprint at ≥70 % of peak, and
             sqrt(A50/A10), the equivalent radius of the ≥50 % region over the
             ≥10 % one. Both read 1.0 for a top hat and fall as the fade moves
             inward. Blemishes are HEALED first — `freshEd` seeds them off
             `Math.random`, and screening cream over a near-opaque dark dot lifts
             it ~3.5× as far as it lifts skin, so an unlucky seed under the sweep
             moves `peak` by a third and drags every peak-relative ratio with it.

     Measured over 3 models × 2 sides × 3 engines, before and after:
       bowR  0.0002–0.0022  →  0.1065–0.1144
       bowS  mixed (noise)  →  −1 on all 18
       core  0.1746–0.1896  →  0.0788–0.1235
       r50   0.6162–0.6344  →  0.5021–0.5614
     Every bound below is two-sided, per T5's lesson: a one-sided "it curves"
     passes just as well for a hook, and a one-sided "it fades" passes for a
     shape that has faded away to nothing. */
  const SWEEP = `
    const sweep = (a, b, side, cxm, ew) => {
      const W = cv.width, H = cv.height;
      const lo = side<0 ? 0 : Math.ceil(cxm + 0.8*ew), hi = side<0 ? Math.floor(cxm - 0.8*ew) : W;
      const D = new Float64Array(W*H);
      let n=0, peak=0, x0=1e9, y0=1e9, x1=-1, y1=-1;
      for (let y=0;y<H;y++) for (let x=Math.max(0,lo);x<Math.min(W,hi);x++){ const i=(y*W+x)*4;
        const d = Math.max(Math.abs(a.data[i]-b.data[i]), Math.abs(a.data[i+1]-b.data[i+1]),
                           Math.abs(a.data[i+2]-b.data[i+2]));
        D[y*W+x]=d; if (d<=2) continue;
        n++; if (d>peak) peak=d;
        if (x<x0)x0=x; if (x>x1)x1=x; if (y<y0)y0=y; if (y>y1)y1=y; }
      if (n < 40) return { n };

      let core=0, a50=0, a10=0;
      for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){ const d=D[y*W+x]; if(d<=2) continue;
        if (d>=peak*0.70) core++; if (d>=peak*0.50) a50++; if (d>=peak*0.10) a10++; }

      let sw=0,sx=0,sy=0;
      for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){ const d=D[y*W+x]; if(d<=2) continue;
        sw+=d; sx+=d*x; sy+=d*y; }
      const mx=sx/sw, my=sy/sw; let uxx=0,uyy=0,uxy=0;
      for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){ const d=D[y*W+x]; if(d<=2) continue;
        uxx+=d*(x-mx)*(x-mx); uyy+=d*(y-my)*(y-my); uxy+=d*(x-mx)*(y-my); }
      uxx/=sw; uyy/=sw; uxy/=sw;
      const th=0.5*Math.atan2(2*uxy, uxx-uyy), ct=Math.cos(th), st=Math.sin(th);

      const NB=24; let u0=1e9, uH=-1e9;
      for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){ const d=D[y*W+x]; if(d<=2) continue;
        const u=(x-mx)*ct+(y-my)*st; if(u<u0)u0=u; if(u>uH)uH=u; }
      const span=uH-u0; if (!(span>4)) return { n, peak };
      const U=new Float64Array(NB), V=new Float64Array(NB), Wt=new Float64Array(NB);
      for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){ const d=D[y*W+x]; if(d<=2) continue;
        const u=(x-mx)*ct+(y-my)*st, v=-(x-mx)*st+(y-my)*ct;
        const bi=Math.min(NB-1, Math.max(0, Math.floor((u-u0)/span*NB)));
        U[bi]+=d*u; V[bi]+=d*v; Wt[bi]+=d; }
      /* Drop the two outermost bins at each end: a handful of stray pixels at a
         tip makes that bin's mean wander, and a quadratic fit is most sensitive
         exactly there. */
      const pts=[];
      for (let i=2;i<NB-2;i++) if (Wt[i] > sw/NB*0.06) pts.push([U[i]/Wt[i], V[i]/Wt[i], Wt[i]]);
      if (pts.length < 8) return { n, peak };

      let S0=0,S1=0,S2=0,S3=0,S4=0,T0=0,T1=0,T2=0;                 // v = A u² + B u + C
      for (const [u,v,wt] of pts){ const u2=u*u;
        S0+=wt; S1+=wt*u; S2+=wt*u2; S3+=wt*u2*u; S4+=wt*u2*u2;
        T0+=wt*v; T1+=wt*u*v; T2+=wt*u2*v; }
      const M=[[S4,S3,S2],[S3,S2,S1],[S2,S1,S0]], R=[T2,T1,T0];
      for (let c=0;c<3;c++){
        let p=c; for (let r2=c+1;r2<3;r2++) if (Math.abs(M[r2][c])>Math.abs(M[p][c])) p=r2;
        const tm=M[c]; M[c]=M[p]; M[p]=tm; const tr=R[c]; R[c]=R[p]; R[p]=tr;
        if (!M[c][c]) return { n, peak };
        for (let r2=0;r2<3;r2++){ if(r2===c) continue; const k=M[r2][c]/M[c][c];
          for (let c2=c;c2<3;c2++) M[r2][c2]-=k*M[c][c2]; R[r2]-=k*R[c]; } }
      const A=R[0]/M[0][0];
      const L=pts[pts.length-1][0]-pts[0][0], sag=A*(L/2)*(L/2);
      const f=L2.genEntry().face, ewp=(f.eyeL.w+f.eyeR.w)/2*W, ehp=(f.eyeL.h+f.eyeR.h)/2*H;
      return { n, peak, len:+L.toFixed(1), area:+(n/(ewp*ehp)).toFixed(3),
               bowR:+(Math.abs(sag)/L).toFixed(4), bowS: sag===0 ? 0 : (sag>0 ? 1 : -1),
               core:+(core/n).toFixed(4), r50:+Math.sqrt(a50/Math.max(1,a10)).toFixed(4) };
    };`;

  test('U1/U2 · the highlight is two mirrored kidney-bean sweeps that fade from their centres', async ({ page }) => {
    test.setTimeout(120000);
    const errors = await stage(page);

    const rows = await logic(page, `return (async () => {
      const L2 = L;
      ${HELPERS}
      ${SWEEP}
      /* Blemishes healed on BOTH frames — see the note above. */
      const heal = () => setEd((ed) => { ed.pimples = (ed.pimples||[]).map(() => 2); });
      const out = [];
      for (const m of window.GlamStory.MODELS) {
        await setModel(m);
        await heal();
        const before = await settle();
        const f = L.genEntry().face;
        const cxm = (f.eyeL.x+f.eyeR.x)/2*cv.width, ew = (f.eyeL.w+f.eyeR.w)/2*cv.width;
        await setEd((ed) => { ed.cov.hl = 1; });
        const after = await settle();
        for (const side of [-1, 1]) out.push({ model:m, side, ...sweep(before, after, side, cxm, ew) });
      }
      return out;
    })();`);

    const roster = await page.evaluate(() => window.GlamStory.MODELS);
    expect(rows.length).toBe(roster.length * 2);

    for (const r of rows) {
      const where = `${r.model}/${r.side < 0 ? 'left' : 'right'} cheekbone`;
      // A sweep that paints nothing would satisfy every shape bound vacuously.
      expect(r.n, `${where}: the highlight should paint the cheekbone`).toBeGreaterThan(200);

      // U2 — the silhouette curves. The retired ellipse measured 0.0002–0.0022
      // on every model, side and engine; no ellipse can do better, at any tilt.
      expect(r.bowR, `${where}: bowR ${r.bowR} — the sweep's spine is straight, so it is still an ellipse`)
        .toBeGreaterThan(0.055);
      // …a bean, not a fish hook.
      expect(r.bowR, `${where}: bowR ${r.bowR} — the sweep has curled into a hook`)
        .toBeLessThan(0.20);

      // U1 — the fade starts near the centre. The retired plateau measured
      // core 0.1746–0.1896 and r50 0.6162–0.6344 across all 18 samples.
      expect(r.core, `${where}: ${(r.core*100).toFixed(1)}% of the footprint sits at ≥70% of peak — that is the plateau`)
        .toBeLessThan(0.150);
      expect(r.r50, `${where}: r50 ${r.r50} — the brightness still holds flat before it falls`)
        .toBeLessThan(0.590);
      // …but it is still a highlight, not a wisp: a core that keeps fading all
      // the way in would pass both of those and light nothing.
      expect(r.core, `${where}: only ${(r.core*100).toFixed(1)}% of the footprint is near peak — the glow has no centre left`)
        .toBeGreaterThan(0.030);
      expect(r.r50, `${where}: r50 ${r.r50} — the highlight has collapsed to a spike`)
        .toBeGreaterThan(0.400);
    }

    /* MIRRORED. Every number above is invariant under a mirror — the principal
       axis flips, the cross-axis does not — so the two cheeks must agree on all
       of them. This is what separates "both cheeks have a curved sweep" from
       "the two sweeps are reflections of each other". */
    for (const m of roster) {
      const [l, r] = [-1, 1].map((s) => rows.find((x) => x.model === m && x.side === s));
      expect(l.bowS, `${m}: the two cheekbone sweeps bow in opposite directions — they are not mirrored`)
        .toBe(r.bowS);
      expect(Math.abs(l.bowR - r.bowR), `${m}: bowR ${l.bowR} vs ${r.bowR} — the two sweeps curve differently`)
        .toBeLessThan(0.02);
      expect(Math.abs(l.area - r.area) / ((l.area + r.area) / 2),
        `${m}: the two sweeps cover ${l.area} vs ${r.area} eye-areas — they are not the same shape`)
        .toBeLessThan(0.10);
    }

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});
