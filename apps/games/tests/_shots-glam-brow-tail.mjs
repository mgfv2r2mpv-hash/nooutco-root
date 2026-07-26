/* Screenshot pass for turn-exchange Finding B (the brow-tail pixel noise).
   Not a spec. Run against a hash-verified :8788, from apps/games:

     git show 93dab9be:apps/games/glam-team-makeover/index.html \
       > apps/games/glam-team-makeover/_before-brow.html
     PHASE=before PAGE=/glam-team-makeover/_before-brow.html node tests/_shots-glam-brow-tail.mjs
     PHASE=after  node tests/_shots-glam-brow-tail.mjs
     rm apps/games/glam-team-makeover/_before-brow.html

   The "previous commit's file, same directory" trick the earlier passes used, so
   `../tailwind.css`, `vendor/` and `assets/` resolve identically and only the
   renderer differs.

   Photographed per roster model, in the state the maintainer described — bare
   face, default hair, routine `free` so no tool has been taken, no recolour, and
   the seeded spot flaws cleared so nothing but the render is in frame:

     browtail-<phase>-<model>.png — a x5 loupe strip, left brow band | right brow
                                    band, spanning the outer brow, the temple and
                                    the hairline.

   `before` carries a desaturated haze on the temple skin immediately outboard of
   each brow tail; `after` is the same frame with that haze lifted and nothing
   else moved. The number behind the picture is in tests/glam-brow-tail.spec.js. */
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

const MODELS = ['m2', 'm3', 'm4'];
const PHASE = process.env.PHASE || 'after';
const PAGE = process.env.PAGE || '/glam-team-makeover/';
const OUT = new URL('../../../docs/eval/shots/glam-turn-exchange/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const BROWCFG = { m2: { wf: 1.3, dx: 0, dy: 1.65 }, m3: { wf: 1.3, dx: 0, dy: 1.75 }, m4: { wf: 1.3, dx: 0, dy: 1.5 } };

const painted = () => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
};

const browser = await chromium.launch();
const problems = [];
for (const m of MODELS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
  page.on('console', (e) => { if (e.type() === 'error') problems.push(e.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`http://localhost:8788${PAGE}`);
  await page.waitForFunction(() => !!window.GlamTT && !!window.__GLAM_ART_GEN__);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Character', { exact: true }).selectOption(m);
  await page.getByLabel('Routine', { exact: true }).selectOption('free');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go —/ }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });
  await page.evaluate(async () => {
    const host = document.getElementById('gtm-canvas');
    let f = host[Object.keys(host).find((k) => k.startsWith('__reactFiber$'))];
    while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
    await new Promise((r) => f.stateNode.logic.setState((s) => {
      const ed = JSON.parse(JSON.stringify(s.ed)); ed.pimples = []; return { ed };
    }, r));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

  const png = await page.evaluate(([model, BC]) => {
    const G = window.__GLAM_ART_GEN__;
    const E = G.models[model].styles['hair-copper'];
    const cv = document.getElementById('gtm-canvas');
    const W = cv.width, H = cv.height, Z = 5;
    const f = E.face, asp = G.brows[model].bushy.L.aspect;
    const crops = [];
    for (const [x, y, w, h, o] of [[f.eyeL.x * W, f.eyeL.y * H, f.eyeL.w * W, f.eyeL.h * H, -1],
                                   [f.eyeR.x * W, f.eyeR.y * H, f.eyeR.w * W, f.eyeR.h * H, 1]]) {
      const bw = BC.wf * (2 * w), bh = bw / asp, by = y - BC.dy * h;
      crops.push({ L: Math.round(x - bw * (o < 0 ? 0.85 : 0.15)), T: Math.round(by - bh * 1.4),
                   W: Math.round(bw), H: Math.round(bh * 2.8) });
    }
    const o = document.createElement('canvas');
    o.width = crops.reduce((a, c) => a + c.W, 0) * Z + 8;
    o.height = Math.max(...crops.map((c) => c.H)) * Z;
    const x = o.getContext('2d'); x.imageSmoothingEnabled = false;
    x.fillStyle = '#ff00ff'; x.fillRect(0, 0, o.width, o.height);
    let px = 0;
    for (const c of crops) { x.drawImage(cv, c.L, c.T, c.W, c.H, px, 0, c.W * Z, c.H * Z); px += c.W * Z + 8; }
    return o.toDataURL('image/png');
  }, [m, BROWCFG[m]]);

  await writeFile(`${OUT}browtail-${PHASE}-${m}.png`, Buffer.from(png.split(',')[1], 'base64'));
  console.log(`browtail-${PHASE}-${m}.png`);
  await page.close();
}
console.log(problems.length ? `CONSOLE PROBLEMS: ${JSON.stringify(problems)}` : 'console clean');
await browser.close();
