/* Finding B - the base render's ink against the mask key, as an ASCII map.

   Prints, per roster model and side, an ASCII map of the outer brow-tail band in
   the base render's own pixels, one character per pixel:

     K  mask blue key >= 0.12  (the region the build-time skin fill was keyed to)
     H  mask red >= 0.5        (hair)
     #  dark ink, not hair, OUTSIDE the key
     :  mid ink, not hair, outside the key
     .  skin

   If the base eyebrow was removed by a fill keyed off the blue channel, then the
   surviving ink is exactly the `#`/`:` that sit immediately outboard of the last
   `K` on each row, and nowhere else.

   From apps/games:  node tests/_probe-glam-browtail5.mjs                       */
import { chromium } from '@playwright/test';

const MODELS = ['m2', 'm3', 'm4'];
const BROWCFG = { m2: { wf: 1.3, dx: 0, dy: 1.65 }, m3: { wf: 1.3, dx: 0, dy: 1.75 }, m4: { wf: 1.3, dx: 0, dy: 1.5 } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
await page.goto('http://localhost:8788/glam-team-makeover/');
await page.waitForFunction(() => !!window.__GLAM_ART_GEN__);

for (const m of MODELS) {
  const txt = await page.evaluate(async ([model, BC]) => {
    const G = window.__GLAM_ART_GEN__;
    const E = G.models[model].styles['hair-copper'];
    const load = (s) => new Promise((r, j) => { const im = new Image(); im.onload = () => r(im); im.onerror = j; im.src = '/glam-team-makeover/' + s; });
    const W = G.frame.w, H = G.frame.h;
    const grab = async (s) => { const im = await load(s); const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(im, 0, 0, W, H); return c.getContext('2d').getImageData(0, 0, W, H).data; };
    const b = await grab(E.base), k = await grab(E.mask);
    const f = E.face, asp = G.brows[model].bushy.L.aspect;
    const lines = [];
    for (const [x, y, w, h, o] of [[f.eyeL.x * W, f.eyeL.y * H, f.eyeL.w * W, f.eyeL.h * H, -1],
                                   [f.eyeR.x * W, f.eyeR.y * H, f.eyeR.w * W, f.eyeR.h * H, 1]]) {
      const bw = BC.wf * 2 * w, bh = bw / asp, by = y - BC.dy * h;
      const tail = x + o * bw / 2;
      const L = Math.round(o < 0 ? tail - bw * 0.34 : tail - bw * 0.20);
      const R = Math.round(o < 0 ? tail + bw * 0.20 : tail + bw * 0.34);
      const T = Math.round(by - bh * 0.75), B = Math.round(by + bh * 0.85);
      lines.push(`--- ${model} ${o < 0 ? 'L' : 'R'}  x ${L}..${R}  y ${T}..${B}  tail x=${Math.round(tail)} ---`);
      // per-row skin reference: median luminance of non-hair non-key pixels in the row's
      // wider neighbourhood, so "dark" means dark FOR THIS FACE not dark in absolute terms
      for (let yy = T; yy < B; yy++) {
        const ref = [];
        for (let xx = L - 30; xx < R + 30; xx++) {
          const i = (yy * W + xx) * 4; if (i < 0 || i >= b.length) continue;
          if (k[i] < 128 && k[i + 2] < 31) ref.push(0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2]);
        }
        ref.sort((p, q) => p - q);
        const skin = ref.length ? ref[ref.length >> 1] : 180;
        let row = '';
        for (let xx = L; xx < R; xx++) {
          const i = (yy * W + xx) * 4;
          const lum = 0.299 * b[i] + 0.587 * b[i + 1] + 0.114 * b[i + 2];
          if (k[i] >= 128) row += 'H';
          else if (k[i + 2] >= 31) row += 'K';
          else if (lum < skin * 0.55) row += '#';
          else if (lum < skin * 0.80) row += ':';
          else row += '.';
        }
        lines.push(String(yy).padStart(4) + ' ' + row + `   skin=${Math.round(skin)}`);
      }
    }
    return lines.join('\n');
  }, [m, BROWCFG[m]]);
  console.log(txt);
  console.log();
}
await browser.close();
