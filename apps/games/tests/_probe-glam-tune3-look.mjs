/* THIRD PASS · Finding A — the COMPLETED look, measured rather than eyeballed.
 *
 * No prior pass ever photographed the finished face: every screenshot in the
 * evidence set is mid-appointment. This probe drives the real compositor to a
 * completed look on every roster model and reports
 *   · per tool: the share of face pixels it changes and its mean ΔE76,
 *   · the completed look as a whole against the bare face,
 *   · and the lash geometry's luminance, bare vs completed, so "white pixels in
 *     the eyelashes" becomes a number instead of an impression.
 *
 * The lash mask is derived from the renderer itself — every pixel the mascara
 * sprite CHANGES, in either direction — rather than from a restated sprite
 * transform, so it cannot drift from the art. Taking only the pixels it DARKENS
 * would quietly drop the white ones, which are the defect. The eyeball comes out
 * (an ellipse over `_irisBox`): the sclera is legitimately brighter than the
 * skin it replaces, and a catchlight or a coloured contact is not a lash.
 *
 * Run against a hash-verified server on :8788:
 *   node tests/_probe-glam-tune3-look.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../../docs/eval/shots/glam-tune3');
mkdirSync(OUT, { recursive: true });

const logic = (page, src) => page.evaluate(({ src }) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  return new Function('L', src)(f.stateNode.logic);
}, { src });

/* Every tool that draws on the doll, applied ALONE from the bare face. Ordered
   as the staged flow presents them. `full` is the same list rolled together. */
const TOOLS = `[
  { key:'wash',     label:'Wash',          mut:(ed)=>{ ed.cov.wash=1; } },
  { key:'moist',    label:'Moisturize',    mut:(ed)=>{ ed.cov.moist=1; } },
  { key:'spots',    label:'Treat+conceal', mut:(ed)=>{ ed.pimples=(ed.pimples||[]).map(()=>2); } },
  { key:'brows',    label:'Shape brows',   mut:(ed)=>{ ed.cov.brows=1; } },
  { key:'pencil',   label:'Brow pencil',   mut:(ed)=>{ ed.cov.pencil=1; } },
  { key:'contour',  label:'Contour',       mut:(ed)=>{ ed.cov.contour=1; } },
  { key:'blush',    label:'Blush',         mut:(ed)=>{ ed.cov.blush=1; ed.col.blush='#f28ba0'; } },
  { key:'hl',       label:'Highlight',     mut:(ed)=>{ ed.cov.hl=1; } },
  { key:'shadow',   label:'Eyeshadow',     mut:(ed)=>{ ed.cov.shadow=1; ed.col.shadow='#a06cc9'; } },
  { key:'liner',    label:'Eyeliner',      mut:(ed)=>{ ed.cov.liner=1; } },
  { key:'mascara',  label:'Mascara',       mut:(ed)=>{ ed.cov.mascara=1; } },
  { key:'contacts', label:'Contacts',      mut:(ed)=>{ ed.col.contacts='#4a90d9'; } },
  { key:'lipliner', label:'Lip liner',     mut:(ed)=>{ ed.cov.lipliner=1; ed.col.lipliner='#b23a56'; } },
  { key:'lips',     label:'Lipstick',      mut:(ed)=>{ ed.cov.lips=1; ed.col.lips='#d64b6a'; } },
  { key:'hair',     label:'Hair colour',   mut:(ed)=>{ ed.col.hair='berry'; } },
  { key:'ear',      label:'Earrings',      mut:(ed)=>{ ed.gl.ear='ring'; } },
  { key:'outfit',   label:'Shirt',         mut:(ed)=>{ ed.outfit='dress'; ed.col.garment='#d6608a'; } }
]`;

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
  /* freshEd seeds the three blemishes with Math.random(), so two frames taken
     from two resets have the spots in DIFFERENT places — and a spot that moved
     reads as a tool brightening pixels it never touched. One fixed seed for
     every frame; 0.371 is the layout _pickSpots itself falls back to. */
  const FRESH = () => Object.assign(L.freshEd('person'), { spotSeed: 0.371 });
  const setEd = (fn) => new Promise(r => L.setState(s => { const ed=JSON.parse(JSON.stringify(s.ed)); fn(ed); return {ed}; }, r));
  const reset = () => new Promise(r => L.setState({ ed: FRESH() }, r));
  const setModel = async (m) => {
    await new Promise(r => L.setState({ model:m, ed:FRESH() }, r));
    for (let i=0;i<80 && !L._skinPool(m);i++) await new Promise(r => setTimeout(r,100));
    await settle();
  };
  /* Rec.709 luminance on the sRGB byte, which is what "how bright does this
     pixel look" means for a defect described as WHITE PIXELS. */
  const lum = (d,i) => 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
  /* ΔE76 — the perceptual distance the report quotes. sRGB → linear → XYZ (D65)
     → Lab, then a euclidean distance in Lab. */
  const f_ = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787*t + 16/116);
  const lab = (r,g,b) => {
    const s = (c)=>{ c/=255; return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
    const R=s(r),G=s(g),B=s(b);
    const X=(0.4124*R+0.3576*G+0.1805*B)/0.95047,
          Y=(0.2126*R+0.7152*G+0.0722*B),
          Z=(0.0193*R+0.1192*G+0.9505*B)/1.08883;
    const fx=f_(X),fy=f_(Y),fz=f_(Z);
    return [116*fy-16, 500*(fx-fy), 200*(fy-fz)];
  };
  const dE = (a,b,i) => { const A=lab(a[i],a[i+1],a[i+2]), B=lab(b[i],b[i+1],b[i+2]);
    return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2]); };
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://localhost:8788/glam-team-makeover/');
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

const MODELS = ['m2', 'm3', 'm4'];
const report = { models: {} };

for (const m of MODELS) {
  const row = await logic(page, `return (async () => {
    ${HELPERS}
    const TOOLS = ${TOOLS};
    await setModel(${JSON.stringify(m)});

    /* WARM-UP, and it is load-bearing. Several tools draw a SPRITE the
       compositor has never asked for on a bare face — the earring, the outfit,
       the liner — and _img kicks the fetch off and repaints on load. settle
       waits for the canvas to stop CHANGING, and a canvas that has not started
       drawing the sprite yet is perfectly stable, so it returns before the
       sprite lands and the tool measures as though it painted nothing. Run the
       whole catalogue once first, so every sprite is decoded and cached before
       any number is taken. Without this the same probe reports Earrings and
       Shirt at 0.00 ΔE and contour/highlight/lip-liner at a fifth of their real
       value — reproducibly, which is what made it look like a renderer change
       rather than an instrument fault. */
    await setEd((ed)=>{ for(const t of TOOLS) t.mut(ed); });
    await settle();
    await reset();

    const bare = await settle();

    // FACE denominator — the compositor's own face zone, restricted to pixels the
    // base render actually drew. Zones are % of the frame.
    const Z = L._artZones().face;
    const x0=Math.round(Z.l/100*W), x1=Math.round((Z.l+Z.w)/100*W),
          y0=Math.round(Z.t/100*H), y1=Math.round((Z.t+Z.h)/100*H);
    const faceIdx=[];
    for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++){ const i=(y*W+x)*4; if(bare.data[i+3]>8) faceIdx.push(i); }

    const measure = (after) => {
      let n=0, sum=0, sumAll=0, max=0;
      for(const i of faceIdx){ const d=dE(bare.data,after.data,i);
        sumAll+=d; if(d>2){ n++; sum+=d; if(d>max) max=d; } }
      return { pct:+(n/faceIdx.length*100).toFixed(2), meanChanged:+(n?sum/n:0).toFixed(2),
               meanFace:+(sumAll/faceIdx.length).toFixed(2), maxDE:+max.toFixed(1) };
    };

    // ── per tool, alone from the bare face ──
    const tools=[];
    for(const t of TOOLS){ await reset(); await settle(); await setEd(t.mut);
      const a=await settle(); tools.push(Object.assign({ key:t.key, label:t.label }, measure(a))); }

    /* ── the mascara-only frame gives us the lash geometry ──
       The geometry is every pixel the mascara sprite CHANGES, in either
       direction — not only the ones it darkens. A mask built from darkening
       alone quietly excludes the white pixels, which are the whole defect.
       What comes out is the EYEBALL: the sprite's sclera is legitimately far
       brighter than the skin it replaces, and it is not a lash. The aperture is
       cut with an ellipse in the sprite's own frame, off _irisBox — which
       carries the drawn sprite's box — so it tracks the art at every model. */
    await reset(); await settle(); await setEd((ed)=>{ ed.cov.mascara=1; });
    const masc = await settle();
    const boxes = (L._irisBoxes(W,H) || []).filter(Boolean);
    const inEye = (x,y) => boxes.some(b => {
      const u=(x-b.cx)/(0.38*b.dw), v=(y-b.cy)/(0.16*b.dh); return u*u+v*v <= 1; });
    const lash=[];
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i=(y*W+x)*4;
      if(masc.data[i+3]<200) continue;
      if(Math.abs(lum(masc.data,i) - lum(bare.data,i)) <= 12) continue;
      if(!inEye(x,y)) lash.push(i); }

    // ── the COMPLETED look ──
    await reset(); await settle();
    await setEd((ed)=>{ for(const t of TOOLS) t.mut(ed); ed.hairShape='hair-blonde'; });
    const done = await settle();
    const full = measure(done);

    // lash luminance: bare vs completed, at the lash geometry
    let over=0, worst=0, sumB=0, sumD=0, hot=[], maxAbs=0, white=0, dark=0;
    for(const i of lash){ const lb=lum(bare.data,i), ld=lum(done.data,i);
      sumB+=lb; sumD+=ld; const d=ld-lb;
      if(ld>maxAbs) maxAbs=ld;
      if(ld>=190) white++;             // "white pixel", stated absolutely
      if(lb-ld>=20) dark++;            // …and the lash actually rendered as ink
      if(d>0){ over++; if(d>worst) worst=d; }
      if(d > 0) hot.push({ x:(i/4)%W, y:Math.floor((i/4)/W), bare:+lb.toFixed(1), done:+ld.toFixed(1) }); }
    hot.sort((a,b)=>(b.done-b.bare)-(a.done-a.bare));

    return { model:L.state.model, facePx:faceIdx.length, tools, full,
      lash:{ px:lash.length, over, overPct:+(lash.length?over/lash.length*100:0).toFixed(2),
             worstOver:+worst.toFixed(1), maxAbs:+maxAbs.toFixed(1),
             white, whitePct:+(lash.length?white/lash.length*100:0).toFixed(2),
             darkPct:+(lash.length?dark/lash.length*100:0).toFixed(2),
             meanBare:+(lash.length?sumB/lash.length:0).toFixed(1),
             meanDone:+(lash.length?sumD/lash.length:0).toFixed(1),
             hottest:hot.slice(0,12) } };
  })();`);
  report.models[m] = row;
  console.log(`\n══ ${m} · face ${row.facePx} px ══`);
  console.log('  tool            %face   ΔE(changed)  ΔE(face)  maxΔE');
  for (const t of row.tools) {
    console.log(`  ${t.label.padEnd(15)} ${String(t.pct).padStart(6)}  ${String(t.meanChanged).padStart(10)}  ${String(t.meanFace).padStart(8)}  ${String(t.maxDE).padStart(6)}`);
  }
  console.log(`  ${'COMPLETED'.padEnd(15)} ${String(row.full.pct).padStart(6)}  ${String(row.full.meanChanged).padStart(10)}  ${String(row.full.meanFace).padStart(8)}  ${String(row.full.maxDE).padStart(6)}`);
  console.log(`  lash geometry: ${row.lash.px} px · brighter than bare: ${row.lash.over} (${row.lash.overPct}%) · worst +${row.lash.worstOver} L`);
  console.log(`  lash mean luminance  bare ${row.lash.meanBare} → completed ${row.lash.meanDone}`);
  console.log(`  lash whitest pixel: ${row.lash.maxAbs} L · pixels at or over 190 L: ${row.lash.white} (${row.lash.whitePct}%) · rendered as ink: ${row.lash.darkPct}%`);
  if (row.lash.hottest.length) {
    console.log('  hottest lash pixels:', row.lash.hottest.slice(0, 6)
      .map((h) => `(${h.x},${h.y}) ${h.bare}→${h.done}`).join('  '));
  }
}

writeFileSync(resolve(OUT, 'measure-completed-look.json'), JSON.stringify(report, null, 2));
console.log(`\nwrote ${resolve(OUT, 'measure-completed-look.json')}`);
await browser.close();
if (errors.length) { console.error('\nCONSOLE ERRORS:\n' + errors.join('\n')); process.exit(1); }
