/* Finding B - WIDE loupe over the whole brow + temple + hairline band,
   bare face, no brow tool, no recolour, plus a "canvas with the brow state
   sprite suppressed" frame so the base layer and the sprite layer can be told
   apart by eye. That frame is what shows `_eyesCanvas` to be a visual no-op
   where nothing is drawn between the base and the lift.

   From apps/games:  TAG=after node tests/_probe-glam-browtail3.mjs           */
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

const MODELS = ['m2', 'm3', 'm4'];
const PAGE = process.env.PAGE || '/glam-team-makeover/';
const TAG = process.env.TAG || 'after';
const OUT = new URL('../../../.probe-browtail/', import.meta.url).pathname;
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
for (const m of MODELS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
  await page.goto(`http://localhost:8788${PAGE}`);
  await page.waitForFunction(() => !!window.GlamTT);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Character', { exact: true }).selectOption(m);
  await page.getByLabel('Routine', { exact: true }).selectOption('free');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go - / }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });

  const res = await page.evaluate(async ([model, BC]) => {
    const G = window.__GLAM_ART_GEN__;
    const E = G.models[model].styles['hair-copper'] || G.models[model].styles.base;
    const cv = document.getElementById('gtm-canvas');
    const W = cv.width, H = cv.height;
    const load = (src) => new Promise((r, j) => { const im = new Image(); im.onload = () => r(im); im.onerror = j; im.src = '/glam-team-makeover/' + src; });
    const scale = (im) => { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(im, 0, 0, W, H); return c; };
    const baseC = scale(await load(E.base));
    const maskC = scale(await load(E.mask));
    const f = E.face;
    const asp = ((G.brows[model] || {}).bushy || {}).L?.aspect || 2.4;
    // BASE + ecv only: base, then the blue-channel lift composited back, no state sprite
    const bd = baseC.getContext('2d').getImageData(0, 0, W, H);
    const md = maskC.getContext('2d').getImageData(0, 0, W, H);
    const noSprite = document.createElement('canvas'); noSprite.width = W; noSprite.height = H;
    { const x = noSprite.getContext('2d'); x.drawImage(baseC, 0, 0);
      const o = x.createImageData(W, H), b = bd.data, mm = md.data;
      for (let i = 0; i < b.length; i += 4) { const eb = mm[i + 2] / 255;
        if (eb < 0.12) { o.data[i + 3] = 0; continue; }
        o.data[i] = b[i]; o.data[i + 1] = b[i + 1]; o.data[i + 2] = b[i + 2]; o.data[i + 3] = eb * (b[i + 3] / 255) * 255; }
      const t = document.createElement('canvas'); t.width = W; t.height = H;
      t.getContext('2d').putImageData(o, 0, 0); x.drawImage(t, 0, 0); }
    const eyes = [[f.eyeL.x * W, f.eyeL.y * H, f.eyeL.w * W, f.eyeL.h * H, -1],
                  [f.eyeR.x * W, f.eyeR.y * H, f.eyeR.w * W, f.eyeR.h * H, 1]];
    const crops = [];
    for (const [x, y, w, h, o] of eyes) {
      const bw = BC.wf * (2 * w), bh = bw / asp, by = y - BC.dy * h, bx = x;
      const L = Math.round(bx - bw * (o < 0 ? 0.85 : 0.15)), Ww = Math.round(bw * 1.0);
      const T = Math.round(by - bh * 1.4), Hh = Math.round(bh * 2.8);
      crops.push({ side: o < 0 ? 'L' : 'R', L, T, W: Ww, H: Hh });
    }
    const Z = 5;
    const strip = (src) => {
      const o = document.createElement('canvas');
      o.width = crops.reduce((a, c) => a + c.W, 0) * Z + 8;
      o.height = Math.max(...crops.map(c => c.H)) * Z;
      const x = o.getContext('2d'); x.imageSmoothingEnabled = false;
      x.fillStyle = '#ff00ff'; x.fillRect(0, 0, o.width, o.height);
      let px = 0;
      for (const c of crops) { x.drawImage(src, c.L, c.T, c.W, c.H, px, 0, c.W * Z, c.H * Z); px += c.W * Z + 8; }
      return o.toDataURL('image/png');
    };
    return { crops, canvas: strip(cv), base: strip(baseC), mask: strip(maskC), nosprite: strip(noSprite) };
  }, [m, BROWCFG[m]]);

  for (const k of ['canvas', 'base', 'mask', 'nosprite']) {
    await writeFile(`${OUT}${TAG}-w-${m}-${k}.png`, Buffer.from(res[k].split(',')[1], 'base64'));
  }
  console.log(m, JSON.stringify(res.crops));
  await page.close();
}
await browser.close();
