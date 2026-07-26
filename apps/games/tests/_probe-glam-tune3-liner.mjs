/* THIRD PASS · Finding A1 — is the winged-liner sprite painting over the lashes?
 *
 * `paintAvatar` draws the glam lash sprite and then draws the eyeliner sprite ON
 * TOP of it, and the code's own note says the liner sprite "carries its own"
 * eyeball. If that sprite is a WHOLE eye — sclera, lid, lash line — then every
 * opaque pale pixel in it lands on whatever the lash sprite drew underneath.
 *
 * This renders one eye at ×14 in four states so the answer is visible, and
 * counts the lash pixels each state brightens.
 *
 * Run against a hash-verified server on :8788:
 *   node tests/_probe-glam-tune3-liner.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../../docs/eval/shots/glam-tune3');
mkdirSync(OUT, { recursive: true });
const TAG = process.argv[2] || 'before';

const logic = (page, src) => page.evaluate(({ src }) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  return new Function('L', src)(f.stateNode.logic);
}, { src });

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
  const out = await logic(page, `return (async () => {
    const cv=document.getElementById('gtm-canvas'), ctx=cv.getContext('2d'), W=cv.width, H=cv.height;
    const snap=()=>ctx.getImageData(0,0,W,H);
    const hash=(d)=>{ let h=2166136261; for(let i=0;i<d.data.length;i+=997){ h=Math.imul(h^d.data[i],16777619)>>>0; } return h; };
    const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const settle=async()=>{ let last=null,same=0;
      for(let i=0;i<80&&same<3;i++){ await frame(); const h=hash(snap()); if(h===last) same++; else { same=0; last=h; } }
      return snap(); };
    const setEd=(fn)=>new Promise(r=>L.setState(s=>{ const ed=JSON.parse(JSON.stringify(s.ed)); fn(ed); return {ed}; },r));
    const FRESH=()=>Object.assign(L.freshEd('person'),{ spotSeed:0.371 });
    const reset=()=>new Promise(r=>L.setState({ ed:FRESH() },r));
    const lum=(d,i)=>0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2];
    await new Promise(r=>L.setState({ model:${JSON.stringify(m)}, ed:FRESH() },r));
    for(let i=0;i<80&&!L._skinPool(${JSON.stringify(m)});i++) await new Promise(r=>setTimeout(r,100));
    const bare=await settle();

    const state=async(fn)=>{ await reset(); await settle(); await setEd(fn); return settle(); };
    const masc = await state((ed)=>{ ed.cov.mascara=1; });
    const both = await state((ed)=>{ ed.cov.mascara=1; ed.cov.liner=1; });
    const linr = await state((ed)=>{ ed.cov.liner=1; });

    // lash geometry off the mascara-only frame
    const boxes=L._irisBoxes(W,H)||[];
    const inIris=(x,y)=>boxes.some(b=>b&&Math.hypot(x-b.cx,y-b.cy)<=b.r*1.06);
    const lash=[];
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i=(y*W+x)*4;
      if(masc.data[i+3]<200) continue;
      const lb=lum(bare.data,i), lm=lum(masc.data,i);
      if(lm<110 && lb-lm>40 && !inIris(x,y)) lash.push(i); }

    /* The direct question: how many lash pixels does ADDING the liner sprite make
       brighter, measured against the mascara frame rather than against the bare
       face — so the skincare wash cannot be mistaken for the defect. */
    let over=0, worst=0, sum=0;
    for(const i of lash){ const d=lum(both.data,i)-lum(masc.data,i);
      if(d>4){ over++; sum+=d; if(d>worst) worst=d; } }

    // ×14 loupe of ONE eye, four rows
    const Z=14, e=L._irisBoxes(W,H)[0];
    const x0=Math.max(0,Math.round(e.cx-e.dw*0.62)), x1=Math.min(W,Math.round(e.cx+e.dw*0.62));
    const y0=Math.max(0,Math.round(e.cy-e.dh*0.42)), y1=Math.min(H,Math.round(e.cy+e.dh*0.46));
    const bw=x1-x0, bh=y1-y0;
    const c=document.createElement('canvas'); c.width=bw*Z; c.height=bh*Z*4;
    const cc=c.getContext('2d'); cc.imageSmoothingEnabled=false;
    const blit=(img,row)=>{ const t=document.createElement('canvas'); t.width=bw; t.height=bh;
      t.getContext('2d').putImageData(img,-x0,-y0); cc.drawImage(t,0,row*bh*Z,bw*Z,bh*Z); };
    blit(masc,0); blit(linr,1); blit(both,2);
    const heat=ctx.createImageData(W,H);
    for(let i=0;i<heat.data.length;i+=4){ const g=Math.round(lum(both.data,i)*0.32);
      heat.data[i]=g; heat.data[i+1]=g; heat.data[i+2]=g; heat.data[i+3]=both.data[i+3]; }
    for(const i of lash){ const d=lum(both.data,i)-lum(masc.data,i);
      if(d>4){ const k=Math.min(1,d/70); heat.data[i]=Math.round(110+145*k); heat.data[i+1]=20; heat.data[i+2]=40; } }
    blit(heat,3);
    cc.font='bold 14px system-ui'; cc.fillStyle='#ffe9a8';
    ['mascara only','eyeliner only','mascara + eyeliner','lash px the liner BRIGHTENS (red)']
      .forEach((t,i)=>cc.fillText(t,7,i*bh*Z+18));

    return { model:L.state.model, lashPx:lash.length, over,
      overPct:+(lash.length?over/lash.length*100:0).toFixed(2),
      worst:+worst.toFixed(1), mean:+(over?sum/over:0).toFixed(1),
      png:c.toDataURL('image/png') };
  })();`);
  console.log(`${out.model}: lash ${out.lashPx} px · liner brightens ${out.over} (${out.overPct}%) · mean +${out.mean} L · worst +${out.worst} L`);
  writeFileSync(resolve(OUT, `${TAG}-${m}-liner-loupe.png`), Buffer.from(out.png.split(',')[1], 'base64'));
}

await browser.close();
