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
  const setModel = (m) => new Promise(r => L.setState({ model:m, ed:L.freshEd('person') }, r));
  const diff = (a,b) => { const W=cv.width,H=cv.height; let t=1e9,bt=-1,l=1e9,r=-1,n=0;
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i=(y*W+x)*4;
      const d = Math.abs(b.data[i]-a.data[i])+Math.abs(b.data[i+1]-a.data[i+1])
              + Math.abs(b.data[i+2]-a.data[i+2])+Math.abs(b.data[i+3]-a.data[i+3]);
      if(d>18){ n++; if(y<t)t=y; if(y>bt)bt=y; if(x<l)l=x; if(x>r)r=x; } }
    return n ? { n, pct:n/(W*H)*100, t:t/H*100, b:bt/H*100, l:l/W*100, r:r/W*100 } : null; };
`;

test.describe('Glam Team Makeover — paper-doll fidelity', () => {
  test('F-11 · every tool paints inside its own target box, on all four models', async ({ page }) => {
    test.setTimeout(180000); // 56 model×tool composites, each diffed pixel by pixel
    const errors = await stage(page);

    const rows = await logic(page, `return (async () => {
      ${HELPERS}
      const EFFECTS = ${EFFECTS};
      const out = [];
      for (const m of ['m1','m2','m3','m4']) {
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

    expect(rows.length).toBe(56);
    for (const r of rows) {
      const where = `${r.model}/${r.key}`;
      // A tool that paints nothing is its own defect — a charged action with no result.
      expect(r.painted, `${where} should change pixels at all`).not.toBeNull();
      expect(r.box, `${where} should have a target box`).not.toBeNull();
      // The whole point: the box the child is told to work in must contain the
      // pixels the tool actually changes. The pre-redesign fixed table failed
      // this on 32 of these 56 combinations.
      const p = r.painted, b = r.box;
      expect(p.t, `${where} paints above its box (${p.t.toFixed(1)} < ${b.t})`).toBeGreaterThanOrEqual(b.t - 0.01);
      expect(p.b, `${where} paints below its box (${p.b.toFixed(1)} > ${b.b})`).toBeLessThanOrEqual(b.b + 0.01);
      expect(p.l, `${where} paints left of its box (${p.l.toFixed(1)} < ${b.l})`).toBeGreaterThanOrEqual(b.l - 0.01);
      expect(p.r, `${where} paints right of its box (${p.r.toFixed(1)} > ${b.r})`).toBeLessThanOrEqual(b.r + 0.01);
    }

    // …and the boxes have to track the model, not be one table for all four. The
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
      for (const m of ['m1','m2','m3','m4']) {
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
      for (const m of ['m1','m2','m3','m4']) {
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

    // Baseline before the fix: 1.06–1.67 : 1 on all twelve spots, across all four
    // models — the eval flagged m3/m4 but the numbers indicted every model.
    for (const [m, ratios] of Object.entries(res)) {
      expect(ratios.length, `${m} should seed three spots`).toBe(3);
      for (const r of ratios) {
        expect(r, `${m}: a blemish at ${r}:1 is not findable`).toBeGreaterThanOrEqual(3);
      }
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
      for (const m of ['m1','m2','m3','m4']) {
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

    expect(rows.length).toBe(28);
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
});
