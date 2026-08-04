/* THIRD PASS · Finding A1 - the lash bound, on the geometry the pinned spec uses.
 *
 * `glam-art-fidelity.spec.js` asserts the bound; this prints the numbers behind
 * it, at all three coverage thresholds, so the report can show the shape of the
 * 0.75 choice rather than assert it. The mask is a copy of the spec's - read off
 * `glam.png` itself, with the iris circle taken out - deliberately using nothing
 * from the renderer's own A1 machinery, so this probe produces comparable rows
 * against the PRE-CHANGE file as well as the shipped one.
 *
 * Run against a hash-verified server on :8788:
 *   node tests/_probe-glam-tune3-core.mjs
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

const COMPLETED = `(ed) => {
  ed.cov.wash=1; ed.cov.moist=1; ed.pimples=(ed.pimples||[]).map(()=>2);
  ed.cov.brows=1; ed.cov.pencil=1; ed.cov.contour=1;
  ed.cov.blush=1; ed.col.blush='#f28ba0';
  ed.cov.hl=1;
  ed.cov.shadow=1; ed.col.shadow='#a06cc9';
  ed.cov.liner=1; ed.cov.mascara=1; ed.col.contacts='#4a90d9';
  ed.cov.lipliner=1; ed.col.lipliner='#b23a56';
  ed.cov.lips=1; ed.col.lips='#d64b6a';
  ed.col.hair='berry'; ed.gl.ear='ring';
  ed.outfit='dress'; ed.col.garment='#d6608a';
}`;

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
  const setEd = (fn) => new Promise(r => L.setState(s => { const ed=JSON.parse(JSON.stringify(s.ed)); fn(ed); return {ed}; }, r));
  const setModel = async (m) => {
    await new Promise(r => L.setState({ model:m, ed:L.freshEd('person') }, r));
    for (let i=0;i<80 && !L._skinPool(m);i++) await new Promise(r => setTimeout(r,100));
    await settle();
  };
  const lum = (d,i) => 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
  const spritePixels = (src) => { const rec = L._img(src); if (!rec || !rec.ok) return null;
    const im = rec.img, SW = im.naturalWidth||im.width, SH = im.naturalHeight||im.height;
    const c = document.createElement('canvas'); c.width=SW; c.height=SH;
    const x = c.getContext('2d'); x.drawImage(im,0,0,SW,SH);
    return { W:SW, H:SH, data: x.getImageData(0,0,SW,SH).data }; };
  const lashCore = (cover) => {
    const meta = (L.gen().eyes||{}).glam;
    const mt = meta && spritePixels(meta.src);
    if (!mt) return null;
    const sl = (q)=>{ const i=q*4; return 0.2126*mt.data[i]+0.7152*mt.data[i+1]+0.0722*mt.data[i+2]; };
    const ink = new Uint8Array(mt.W*mt.H);
    for (let q=0;q<mt.W*mt.H;q++) if (mt.data[q*4+3]>=200 && sl(q)<=90) ink[q]=1;
    const f = L.genEntry().face;
    const tuples = [[f.eyeL.x*W,f.eyeL.y*H,f.eyeL.w*W,f.eyeL.h*H,-1],
                    [f.eyeR.x*W,f.eyeR.y*H,f.eyeR.w*W,f.eyeR.h*H,1]];
    const mask = new Uint8Array(W*H);
    for (const e of tuples) {
      const b = L._irisBox(e); if (!b) continue;
      const o = e[4];
      const x0=Math.max(0,Math.floor(b.dx)), x1=Math.min(W,Math.ceil(b.dx+b.dw));
      const y0=Math.max(0,Math.floor(b.dy)), y1=Math.min(H,Math.ceil(b.dy+b.dh));
      for (let y=y0;y<y1;y++) for (let x=x0;x<x1;x++){
        if (Math.hypot(x+0.5-b.cx, y+0.5-b.cy) <= b.r*1.10) continue;
        let fa=(x-b.dx)/b.dw, fb=(x+1-b.dx)/b.dw;
        if (o<0){ const t=1-fb; fb=1-fa; fa=t; }
        const sa=Math.floor(fa*mt.W), sb=Math.ceil(fb*mt.W);
        const ta=Math.floor((y-b.dy)/b.dh*mt.H), tb=Math.ceil((y+1-b.dy)/b.dh*mt.H);
        let hit=0, tot=0;
        for (let sy=ta; sy<tb; sy++) for (let sx=sa; sx<sb; sx++){
          if (sx<0||sy<0||sx>=mt.W||sy>=mt.H) continue;
          tot++; if (ink[sy*mt.W+sx]) hit++; }
        if (tot && hit/tot>=cover) mask[y*W+x]=1; } }
    return mask;
  };
  const scoreLash = (mask, bare, done) => {
    let px=0, white=0, maxAbs=0, worstUp=-999, ink=0, sumB=0, sumD=0, wx=0, wy=0;
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){
      if (!mask[y*W+x]) continue;
      const i=(y*W+x)*4, lb=lum(bare.data,i), ld=lum(done.data,i);
      px++; sumB+=lb; sumD+=ld;
      if (ld>maxAbs) maxAbs=ld;
      if (ld>=190) white++;
      if (ld-lb>worstUp){ worstUp=ld-lb; wx=x; wy=y; }
      if (lb-ld>=20) ink++; }
    return { px, white, maxAbs:+maxAbs.toFixed(1), worstUp:+worstUp.toFixed(1),
             worstAt:wx+','+wy, inkShare:+(ink/px).toFixed(3),
             meanBare:+(sumB/px).toFixed(1), meanDone:+(sumD/px).toFixed(1),
             drop:+((sumB-sumD)/px).toFixed(1) };
  };
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
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

for (const m of ['m2', 'm3', 'm4']) {
  const row = await logic(page, `return (async () => {
    ${HELPERS}
    await setModel(${JSON.stringify(m)});
    await setEd((ed) => { ed.spotSeed = 0.371; ed.cov.mascara = 1; });
    const masc = await settle();
    const masks = { 0.50: lashCore(0.50), 0.60: lashCore(0.60), 0.75: lashCore(0.75) };
    await setEd((ed) => { ed.cov.mascara = 0; });
    const bare = await settle();
    await setEd(${COMPLETED});
    const done = await settle();
    const out = { model: L.state.model, cover: {} };
    for (const k of Object.keys(masks)) out.cover[k] = scoreLash(masks[k], bare, done);
    out.mascaraOnly = scoreLash(masks['0.75'], bare, masc);
    return out;
  })();`);

  console.log(`\n══ ${row.model} ══`);
  console.log('  cover   px   white≥190  maxL   worst+   ink%   mean bare→done   drop');
  for (const k of Object.keys(row.cover)) {
    const s = row.cover[k];
    console.log(`  ${k}  ${String(s.px).padStart(5)}  ${String(s.white).padStart(8)}  ${String(s.maxAbs).padStart(5)}  ${('+' + s.worstUp).padStart(6)}  ${String((s.inkShare * 100).toFixed(1)).padStart(5)}  ${String(s.meanBare).padStart(6)}→${String(s.meanDone).padEnd(6)}  ${s.drop}`);
  }
  const s = row.mascaraOnly;
  console.log(`  mascara sprite alone (0.75): white ${s.white} · max ${s.maxAbs} L · ink ${(s.inkShare * 100).toFixed(1)}% · mean ${s.meanBare}→${s.meanDone}`);
}

await browser.close();
if (errors.length) { console.error('\nCONSOLE ERRORS:\n' + errors.join('\n')); process.exit(1); }
