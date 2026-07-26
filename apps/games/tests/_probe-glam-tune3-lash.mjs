/* THIRD PASS · Finding A1 — WHICH layer puts white pixels on the lashes.
 *
 * `_probe-glam-tune3-look.mjs` establishes that 6–12 % of the lash geometry is
 * BRIGHTER on the completed look than on the bare face. This attributes it:
 * every tool is rendered alone-plus-mascara and scored on the same lash mask,
 * and then the completed look is re-rendered with each suspect removed. The
 * layer whose presence creates the over-bright pixels — and whose removal
 * clears them — is the cause.
 *
 * Run against a hash-verified server on :8788:
 *   node tests/_probe-glam-tune3-lash.mjs
 */
import { chromium } from '@playwright/test';

const logic = (page, src) => page.evaluate(({ src }) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  return new Function('L', src)(f.stateNode.logic);
}, { src });

const TOOLS = `[
  { key:'wash',     mut:(ed)=>{ ed.cov.wash=1; } },
  { key:'moist',    mut:(ed)=>{ ed.cov.moist=1; } },
  { key:'spots',    mut:(ed)=>{ ed.pimples=(ed.pimples||[]).map(()=>2); } },
  { key:'brows',    mut:(ed)=>{ ed.cov.brows=1; } },
  { key:'pencil',   mut:(ed)=>{ ed.cov.pencil=1; } },
  { key:'contour',  mut:(ed)=>{ ed.cov.contour=1; } },
  { key:'blush',    mut:(ed)=>{ ed.cov.blush=1; ed.col.blush='#f28ba0'; } },
  { key:'hl',       mut:(ed)=>{ ed.cov.hl=1; } },
  { key:'shadow',   mut:(ed)=>{ ed.cov.shadow=1; ed.col.shadow='#a06cc9'; } },
  { key:'liner',    mut:(ed)=>{ ed.cov.liner=1; } },
  { key:'contacts', mut:(ed)=>{ ed.col.contacts='#4a90d9'; } },
  { key:'lipliner', mut:(ed)=>{ ed.cov.lipliner=1; ed.col.lipliner='#b23a56'; } },
  { key:'lips',     mut:(ed)=>{ ed.cov.lips=1; ed.col.lips='#d64b6a'; } },
  { key:'hair',     mut:(ed)=>{ ed.col.hair='berry'; } },
  { key:'ear',      mut:(ed)=>{ ed.gl.ear='ring'; } },
  { key:'outfit',   mut:(ed)=>{ ed.outfit='dress'; ed.col.garment='#d6608a'; } }
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
  const lum = (d,i) => 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
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

for (const m of ['m2', 'm3', 'm4']) {
  const row = await logic(page, `return (async () => {
    ${HELPERS}
    const TOOLS = ${TOOLS};
    await setModel(${JSON.stringify(m)});
    const bare = await settle();

    await reset(); await settle(); await setEd((ed)=>{ ed.cov.mascara=1; });
    const masc = await settle();
    // the lash geometry — every pixel the mascara sprite CHANGES, eyeball cut out
    const boxes = (L._irisBoxes(W,H) || []).filter(Boolean);
    const inEye = (x,y) => boxes.some(b => {
      const u=(x-b.cx)/(0.38*b.dw), v=(y-b.cy)/(0.16*b.dh); return u*u+v*v <= 1; });
    const lash=[];
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i=(y*W+x)*4;
      if(masc.data[i+3]<200) continue;
      if(Math.abs(lum(masc.data,i) - lum(bare.data,i)) <= 12) continue;
      if(!inEye(x,y)) lash.push(i); }

    // scored on WHITENESS, stated absolutely — that is the reported defect
    const score = (img) => { let white=0, worst=0;
      for(const i of lash){ const l = lum(img.data,i);
        if(l>=190){ white++; if(l>worst) worst=l; } }
      return { over:white, worst:+worst.toFixed(1) }; };

    // each tool ALONE + mascara
    const alone=[];
    for(const t of TOOLS){ await reset(); await settle();
      await setEd((ed)=>{ ed.cov.mascara=1; t.mut(ed); });
      alone.push(Object.assign({ key:t.key }, score(await settle()))); }

    // the completed look, and the completed look with each suspect REMOVED
    const applyAll=(ed,skip)=>{ ed.cov.mascara=1; ed.hairShape='hair-blonde';
      for(const t of TOOLS) if(t.key!==skip) t.mut(ed); };
    await reset(); await settle(); await setEd((ed)=>applyAll(ed,null));
    const full = score(await settle());
    const minus=[];
    for(const k of ['hl','moist','shadow','liner','contacts','blush','contour']){
      await reset(); await settle(); await setEd((ed)=>applyAll(ed,k));
      minus.push(Object.assign({ without:k }, score(await settle()))); }

    return { model:L.state.model, lashPx:lash.length, alone, full, minus };
  })();`);

  console.log(`\n══ ${row.model} · lash geometry ${row.lashPx} px ══`);
  console.log('  tool alone (+mascara)   over  worst');
  for (const a of row.alone) if (a.over) console.log(`  ${a.key.padEnd(22)} ${String(a.over).padStart(5)}  +${a.worst}`);
  console.log(`  ${'COMPLETED'.padEnd(22)} ${String(row.full.over).padStart(5)}  +${row.full.worst}`);
  for (const mm of row.minus) console.log(`  ${('  completed − ' + mm.without).padEnd(22)} ${String(mm.over).padStart(5)}  +${mm.worst}`);
}

await browser.close();
