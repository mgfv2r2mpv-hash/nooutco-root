/* THIRD PASS · Finding A2 — the two "overdone" calls, turned into numbers.
 *
 * V2 measured every tool's share of the face and left two things stated rather
 * than judged, because both were called taste: the eyeshadow carrying past the
 * outer socket onto the temple, and the brow pencil reading as a flat dark plum
 * heavier than the hair it is supposed to match. Neither is purely taste — each
 * has a stated design intent it can be measured against:
 *
 *   · EYESHADOW REACH. The eye sprite's own drawn box (`_irisBox().dw`) is where
 *     the eye IS. Shadow that lands beyond ±0.5 dw outward is past the drawn
 *     socket by construction, whatever anyone thinks of the colour. Reported as
 *     the outward reach in units of dw, the share of shadow pixels beyond the
 *     box, and how far the wash rises over the brow zone.
 *
 *   · BROW vs HAIR. index.html says brows "default-MATCH the hair colour". So
 *     compare the pencilled brow's ink to the hair's own pixels in the SAME
 *     frame: mean L*, mean chroma, and the gap. A brow 60 L below the hair is
 *     not matching it, and that is a measurement, not an opinion.
 *
 * Two confounds this probe pins, both learned the hard way earlier in the pass:
 *   · `freshEd` seeds the blemishes with Math.random(), so every frame pins
 *     spotSeed to 0.371 (the layout `_pickSpots` itself falls back to).
 *   · the brow frame keeps each model's NATIVE hair shape. `hair-blonde` drops a
 *     fringe across m3's brow, and hair over a brow is hair, not pencil.
 *
 * The brow ink mask is a FIXED FRACTION (darkest 10 % of the brow zone), not a
 * luminance threshold, so it cannot shrink when the tint is lightened — which is
 * exactly the change this probe exists to grade.
 *
 * Run against a hash-verified server on :8788:
 *   node tests/_probe-glam-tune3-a2.mjs [pathPrefix]
 * `pathPrefix` defaults to /glam-team-makeover/, so a copy of the pre-change file
 * served from the same directory can be graded with the same instrument.
 */
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';

const PATH = process.argv[2] || '/glam-team-makeover/';
const JSON_OUT = process.argv[3] || '';

const logic = (page, src) => page.evaluate(({ src }) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  return new Function('L', src)(f.stateNode.logic);
}, { src });

const HELPERS = `
  const cv = document.getElementById('gtm-canvas');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const snap = () => ctx.getImageData(0,0,W,H);
  const hash = (d) => { let h=2166136261; for(let i=0;i<d.data.length;i+=997){ h=Math.imul(h^d.data[i],16777619)>>>0; } return h; };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const settle = async () => { let last=null, same=0;
    for (let i=0;i<80 && same<3;i++){ await frame(); const h=hash(snap()); if(h===last) same++; else { same=0; last=h; } }
    return snap(); };
  const FRESH = () => Object.assign(L.freshEd('person'), { spotSeed: 0.371 });
  const setEd = (fn) => new Promise(r => L.setState(s => { const ed=JSON.parse(JSON.stringify(s.ed)); fn(ed); return {ed}; }, r));
  const reset = () => new Promise(r => L.setState({ ed: FRESH() }, r));
  const setModel = async (m) => {
    await new Promise(r => L.setState({ model:m, ed:FRESH() }, r));
    for (let i=0;i<80 && !L._skinPool(m);i++) await new Promise(r => setTimeout(r,100));
    await settle(); };
  const lum = (d,i) => 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
  const f_ = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787*t + 16/116);
  const lab = (r,g,b) => {
    const s = (c)=>{ c/=255; return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
    const R=s(r),G=s(g),B=s(b);
    const X=(0.4124*R+0.3576*G+0.1805*B)/0.95047,
          Y=(0.2126*R+0.7152*G+0.0722*B),
          Z=(0.0193*R+0.1192*G+0.9505*B)/1.08883;
    const fx=f_(X),fy=f_(Y),fz=f_(Z);
    return [116*fy-16, 500*(fx-fy), 200*(fy-fz)]; };
  const dE = (a,b,i) => { const A=lab(a[i],a[i+1],a[i+2]), B=lab(b[i],b[i+1],b[i+2]);
    return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2]); };
  const meanLab = (img, idx) => { let l=0,a=0,b=0;
    for(const i of idx){ const p=lab(img.data[i],img.data[i+1],img.data[i+2]); l+=p[0]; a+=p[1]; b+=p[2]; }
    const n=idx.length||1; return { L:+(l/n).toFixed(1), a:+(a/n).toFixed(1), bb:+(b/n).toFixed(1),
      C:+(Math.hypot(a/n,b/n)).toFixed(1) }; };
  /* The full catalogue, minus whatever the caller wants held out. */
  const COMPLETE = (ed, skip) => { skip = skip || {};
    ed.cov.wash=1; ed.cov.moist=1; ed.pimples=(ed.pimples||[]).map(()=>2);
    ed.cov.brows=1; if(!skip.pencil) ed.cov.pencil=1;
    ed.cov.contour=1; ed.cov.blush=1; ed.col.blush='#f28ba0'; ed.cov.hl=1;
    if(!skip.shadow){ ed.cov.shadow=1; ed.col.shadow='#a06cc9'; }
    ed.cov.liner=1; ed.cov.mascara=1; ed.col.contacts='#4a90d9';
    ed.cov.lipliner=1; ed.col.lipliner='#b23a56'; ed.cov.lips=1; ed.col.lips='#d64b6a';
    ed.col.hair='berry'; ed.gl.ear='ring'; ed.outfit='dress'; ed.col.garment='#d6608a'; };
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://localhost:8788' + PATH);
await page.getByTitle('Show / hide setup').click();
await page.getByRole('button', { name: /^▶ Play/ }).click();
await page.waitForFunction(() => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
}, undefined, { timeout: 30000 });

const out = { path: PATH, models: {} };

for (const m of ['m2', 'm3', 'm4']) {
  const row = await logic(page, `return (async () => {
    ${HELPERS}
    await setModel(${JSON.stringify(m)});
    const bare = await settle();

    // ── EYESHADOW REACH ──────────────────────────────────────────────────
    // The wash alone from bare, so nothing else can be mistaken for it.
    await reset(); await settle();
    await setEd((ed)=>{ ed.cov.shadow=1; ed.col.shadow='#a06cc9'; });
    const sh = await settle();
    const boxes = (L._irisBoxes(W,H) || []).filter(Boolean);
    const bz = L._artZones().brows;
    const browTop = bz.t/100*H, browBot = (bz.t+bz.h)/100*H;

    let shPx=0, beyond=0, uMax=-9, vMax=-9, sumU=0;
    const far=[], shTop={};                        // topmost shadow pixel per eye
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i=(y*W+x)*4;
      if(sh.data[i+3]<8) continue;
      if(dE(bare.data,sh.data,i) <= 2) continue;
      shPx++;
      // nearest eye box, and the OUTWARD direction for that eye
      let b=boxes[0], bi=0, best=1e9;
      for(let k=0;k<boxes.length;k++){ const d=Math.abs(x-boxes[k].cx); if(d<best){ best=d; b=boxes[k]; bi=k; } }
      const outward = (b.cx <= (boxes[0].cx+boxes[1].cx)/2) ? -1 : 1;
      const u = (x - b.cx)/b.dw * outward;         // +ve = away from the nose
      const v = (b.cy - y)/b.dh;                   // +ve = above the eye centre
      sumU += u;
      if(u > uMax){ uMax=u; }
      if(v > vMax){ vMax=v; }
      if(u > 0.5){ beyond++; far.push({x,y,u:+u.toFixed(2),dE:+dE(bare.data,sh.data,i).toFixed(1)}); }
      if(shTop[bi]===undefined || y < shTop[bi]) shTop[bi]=y;
    }
    far.sort((p,q)=>q.u-p.u);

    // ── BROW vs HAIR ─────────────────────────────────────────────────────
    // NATIVE hair shape: hair-blonde drops a fringe over m3's brow and hair over
    // a brow is hair, not pencil.
    await reset(); await settle(); await setEd((ed)=>COMPLETE(ed));
    const doneP = await settle();
    await reset(); await settle(); await setEd((ed)=>COMPLETE(ed,{pencil:1}));
    const doneN = await settle();
    const bx0=Math.max(0,Math.round(bz.l/100*W)), bx1=Math.min(W,Math.round((bz.l+bz.w)/100*W)),
          by0=Math.max(0,Math.round(browTop)),   by1=Math.min(H,Math.round(browBot));
    /* The pencil FOOTPRINT: every pixel inside the brow sprite's own box that the
       pencil moves. Not a luminance threshold and not a darkest-decile — either
       would move the moment the ink is lightened, which is the change this probe
       exists to grade. The footprint is dominated by the cleaned→shaped SHAPE
       change, so it holds still under a recolour; its pixel count is printed so
       that can be checked rather than assumed. */
    const ink=[];
    for(let y=by0;y<by1;y++) for(let x=bx0;x<bx1;x++){ const i=(y*W+x)*4;
      if(doneP.data[i+3]<200) continue;
      if(dE(doneN.data,doneP.data,i) > 2) ink.push(i); }
    const pct = (idx, img, p) => { if(!idx.length) return 0;
      const v=idx.map(i=>lum(img.data,i)).sort((a,b)=>a-b);
      return +v[Math.min(v.length-1, Math.floor(p*v.length))].toFixed(1); };

    // hair proper: pixels the hair-colour tool moves, outside the brow band
    await reset(); await settle(); await setEd((ed)=>{ ed.col.hair='berry'; });
    const hairOnly = await settle();
    const hair=[];
    for(let y=0;y<H;y++){ if(y>=by0 && y<=by1) continue;
      for(let x=0;x<W;x++){ const i=(y*W+x)*4;
        if(hairOnly.data[i+3]<200) continue;
        if(dE(bare.data,hairOnly.data,i) > 2) hair.push(i); } }

    const inkLab = meanLab(doneP, ink), hairLab = meanLab(doneP, hair);
    /* "Flat" made countable: the share of the brow footprint sitting within 4
       luminance of its own darkest 5 %. A sprite whose fill is one solid colour
       comes out with the tint's FLOOR repeated over most of the brow; a sprite
       with its own shading spreads out. */
    const inkFloor = pct(ink,doneP,0.05);
    let flat=0; for(const i of ink) if(lum(doneP.data,i) <= inkFloor+4) flat++;

    /* Does the wash actually touch the brow? The brow ZONE is the sprite's
       bounding box and carries a lot of transparent margin, so "shadow pixels
       inside the brow zone" measures the box, not the art. This measures the
       INK: the bottom of the drawn brow against the top of the wash, per eye,
       in that eye box's own dh. Positive = clear skin between them. */
    let clearance = 1e9;
    for(let k=0;k<boxes.length;k++){ const b=boxes[k];
      const lo=Math.round(b.cx-0.5*b.dw), hi=Math.round(b.cx+0.5*b.dw);
      let browBottom=-1;
      for(const i of ink){ const p=i/4, x=p%W, y=Math.floor(p/W);
        if(x>=lo && x<=hi && y>browBottom) browBottom=y; }
      if(browBottom>=0 && shTop[k]!==undefined)
        clearance = Math.min(clearance, (shTop[k]-browBottom)/b.dh); }

    return { model:L.state.model,
      shadow:{ px:shPx, beyond, beyondPct:+(shPx?beyond/shPx*100:0).toFixed(2),
               uMax:+uMax.toFixed(2), uMean:+(shPx?sumU/shPx:0).toFixed(2),
               vMax:+vMax.toFixed(2),
               browClearance:+(clearance===1e9?0:clearance).toFixed(3),
               farthest: far.slice(0,5) },
      brow:{ inkPx:ink.length,
             inkL:inkLab.L, inkC:inkLab.C,
             inkP05:inkFloor, inkP50:pct(ink,doneP,0.50),
             flatPct:+(ink.length?flat/ink.length*100:0).toFixed(1),
             hairPx:hair.length, hairL:hairLab.L, hairC:hairLab.C,
             hairP05:pct(hair,doneP,0.05), hairP50:pct(hair,doneP,0.50),
             gapL:+(hairLab.L-inkLab.L).toFixed(1), gapC:+(hairLab.C-inkLab.C).toFixed(1) } };
  })();`);
  out.models[m] = row;
  const s = row.shadow, b = row.brow;
  console.log(`\n══ ${m} ══`);
  console.log(`  eyeshadow  ${s.px} px · outward reach max ${s.uMax} dw (box edge = 0.50) · mean ${s.uMean}`);
  console.log(`             beyond the drawn eye box: ${s.beyond} px (${s.beyondPct}%) · rise max ${s.vMax} dh`);
  console.log(`             clear skin between the brow ink and the wash: ${s.browClearance} dh`);
  if (s.farthest.length) console.log('             farthest:', s.farthest.map((f) => `(${f.x},${f.y}) u=${f.u} ΔE${f.dE}`).join('  '));
  console.log(`  brow ink   ${b.inkPx} px · L* ${b.inkL} · C* ${b.inkC} · lum p05 ${b.inkP05} / p50 ${b.inkP50} · at the floor ${b.flatPct}%`);
  console.log(`  hair       ${b.hairPx} px · L* ${b.hairL} · C* ${b.hairC} · lum p05 ${b.hairP05} / p50 ${b.hairP50}`);
  console.log(`  GAP        brow is ${b.gapL} L* below the hair it claims to match · chroma ${b.gapC}`);
}

if (JSON_OUT) { writeFileSync(JSON_OUT, JSON.stringify(out, null, 2)); console.log('\nwrote ' + JSON_OUT); }
await browser.close();
if (errors.length) { console.error('\nCONSOLE ERRORS:\n' + errors.join('\n')); process.exit(1); }
