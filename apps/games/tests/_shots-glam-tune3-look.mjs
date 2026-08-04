/* THIRD PASS · the COMPLETED look, photographed - and the eye region loupe'd.
 *
 * Writes, per roster model, into docs/eval/shots/glam-tune3/:
 *   <tag>-<model>-completed.png   the whole finished client off the compositor
 *   <tag>-<model>-eye.png         the eye region at ×7, bare | completed | Δ
 * `tag` is the first argument (default "after"), so the same script produces the
 * before and after halves of a loupe pair.
 *
 * Run against a hash-verified server on :8788:
 *   node tests/_shots-glam-tune3-look.mjs before
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TAG = process.argv[2] || 'after';
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
     from two resets have the spots in DIFFERENT places - and a spot that moved
     reads as a tool brightening pixels it never touched. One fixed seed for
     every frame; 0.371 is the layout _pickSpots itself falls back to. */
  const FRESH = () => Object.assign(L.freshEd('person'), { spotSeed: 0.371 });
  const setEd = (fn) => new Promise(r => L.setState(s => { const ed=JSON.parse(JSON.stringify(s.ed)); fn(ed); return {ed}; }, r));
  const reset = () => new Promise(r => L.setState({ ed: FRESH() }, r));
  const setModel = async (m) => {
    await new Promise(r => L.setState({ model:m, ed:FRESH() }, r));
    for (let i=0;i<80 && !L._skinPool(m);i++) await new Promise(r => setTimeout(r,100));
    await settle(); };
  const COMPLETE = (ed) => {
    ed.cov.wash=1; ed.cov.moist=1; ed.pimples=(ed.pimples||[]).map(()=>2);
    ed.cov.brows=1; ed.cov.pencil=1;
    ed.cov.contour=1; ed.cov.blush=1; ed.col.blush='#f28ba0'; ed.cov.hl=1;
    ed.cov.shadow=1; ed.col.shadow='#a06cc9'; ed.cov.liner=1; ed.cov.mascara=1;
    ed.col.contacts='#4a90d9';
    ed.cov.lipliner=1; ed.col.lipliner='#b23a56'; ed.cov.lips=1; ed.col.lips='#d64b6a';
    ed.col.hair='berry'; ed.hairShape='hair-blonde';
    ed.gl.ear='ring'; ed.outfit='dress'; ed.col.garment='#d6608a'; };
  const png = (img) => { const c=document.createElement('canvas'); c.width=img.width; c.height=img.height;
    c.getContext('2d').putImageData(img,0,0); return c.toDataURL('image/png'); };
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

const save = (name, dataUrl) => {
  writeFileSync(resolve(OUT, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('  wrote', name);
};

for (const m of ['m2', 'm3', 'm4']) {
  const out = await logic(page, `return (async () => {
    ${HELPERS}
    const Z = 7;                                     // the loupe's magnification
    await setModel(${JSON.stringify(m)});
    const bare = await settle();
    await reset(); await settle(); await setEd(COMPLETE);
    const done = await settle();

    // the eye band, off the compositor's own eyes zone
    const z = L._artZones().eyes;
    const x0=Math.max(0,Math.round(z.l/100*W)), x1=Math.min(W,Math.round((z.l+z.w)/100*W)),
          y0=Math.max(0,Math.round(z.t/100*H)), y1=Math.min(H,Math.round((z.t+z.h)/100*H));
    const bw=x1-x0, bh=y1-y0;

    // three panels stacked: bare · completed · where completed is BRIGHTER
    const c=document.createElement('canvas'); c.width=bw*Z; c.height=bh*Z*3;
    const cc=c.getContext('2d'); cc.imageSmoothingEnabled=false;
    cc.fillStyle='#20141c'; cc.fillRect(0,0,c.width,c.height);
    const blit=(img,row)=>{ const t=document.createElement('canvas'); t.width=bw; t.height=bh;
      t.getContext('2d').putImageData(img,-x0,-y0);
      cc.drawImage(t,0,row*bh*Z,bw*Z,bh*Z); };
    blit(bare,0); blit(done,1);
    // panel 3 - the defect map. Red where the completed look is BRIGHTER than the
    // bare face inside the lash geometry; grey elsewhere, so shape stays readable.
    const heat=ctx.createImageData(W,H);
    for(let i=0;i<heat.data.length;i+=4){
      const d=lum(done.data,i)-lum(bare.data,i);
      const g=Math.round(lum(done.data,i)*0.35);
      heat.data[i]=g; heat.data[i+1]=g; heat.data[i+2]=g; heat.data[i+3]=done.data[i+3];
      if(done.data[i+3]>200 && d>6){ const k=Math.min(1,d/60);
        heat.data[i]=Math.round(90+165*k); heat.data[i+1]=Math.round(40*(1-k)); heat.data[i+2]=Math.round(60*(1-k)); } }
    blit(heat,2);
    cc.font='bold 15px system-ui'; cc.fillStyle='#ffe9a8';
    ['bare face','completed look','Δ brighter than bare (red)'].forEach((t,i)=>cc.fillText(t,8,i*bh*Z+20));

    return { eye: c.toDataURL('image/png'), full: png(done), box:[x0,y0,bw,bh] };
  })();`);
  console.log(`${m} · eye band ${out.box[2]}×${out.box[3]} at ${out.box[0]},${out.box[1]}`);
  save(`${TAG}-${m}-completed.png`, out.full);
  save(`${TAG}-${m}-eye.png`, out.eye);
}

await browser.close();
