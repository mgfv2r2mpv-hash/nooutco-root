/* Finding B - the dull-wash step, i.e. lead 1's second form. REFUTED: 0.0 %.

   Hypothesis: on a BARE face `cov('wash')<1`, so paintAvatar lays a '#786654'
   multiply blob over the whole face. `_eyesCanvas` is then composited ON TOP and
   re-writes the base render's own pixels wherever the mask's blue channel is
   >= 0.12 - which CANCELS the dull blob inside that key and nowhere else. The
   key's brow lobe is a hard-edged shape, so its boundary becomes a visible step
   in skin tone. The brow state sprite hides most of it; the outer tail, where
   the sprite has tapered away but the key has not, is left showing.

   Measures, per model and side, the luminance of the composited canvas just
   INSIDE vs just OUTSIDE the key edge along the brow band, on a bare face and
   again with the wash done (cov.wash = 1, which removes the blob).

   From apps/games:  node tests/_probe-glam-browtail8.mjs                       */
import { chromium } from '@playwright/test';

const MODELS = ['m2', 'm3', 'm4'];

const painted = () => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
};

const measure = async ([model]) => {
  const G = window.__GLAM_ART_GEN__;
  const E = G.models[model].styles['hair-copper'];
  const cv = document.getElementById('gtm-canvas');
  const W = cv.width, H = cv.height;
  const load = (s) => new Promise((r, j) => { const im = new Image(); im.onload = () => r(im); im.onerror = j; im.src = '/glam-team-makeover/' + s; });
  const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
  const x2 = c2.getContext('2d'); x2.drawImage(await load(E.mask), 0, 0, W, H);
  const k = x2.getImageData(0, 0, W, H).data;
  const c = cv.getContext('2d').getImageData(0, 0, W, H).data;
  const lum = i => 0.299 * c[i] + 0.587 * c[i + 1] + 0.114 * c[i + 2];
  const f = E.face;
  const out = [];
  for (const [x, y, w, h, o] of [[f.eyeL.x * W, f.eyeL.y * H, f.eyeL.w * W, f.eyeL.h * H, -1],
                                 [f.eyeR.x * W, f.eyeR.y * H, f.eyeR.w * W, f.eyeR.h * H, 1]]) {
    // walk rows through the brow lobe of the key (above the eye) and find, on each
    // row, the OUTERMOST key pixel; sample 2 px inside and 2 px outside it
    const inside = [], outside = [], edges = [];
    for (let yy = Math.round(y - 3.0 * h); yy < Math.round(y - 0.9 * h); yy++) {
      let edge = -1;
      for (let d = 0; d < Math.round(2.2 * w); d++) {
        const xx = Math.round(x + o * d);
        const i = (yy * W + xx) * 4; if (i < 0 || i >= c.length) continue;
        if (k[i + 2] >= 31) edge = xx;
      }
      if (edge < 0) continue;
      const iIn = (yy * W + (edge - o * 2)) * 4, iOut = (yy * W + (edge + o * 3)) * 4;
      if (iIn < 0 || iOut < 0 || iIn >= c.length || iOut >= c.length) continue;
      // only rows where neither sample is hair, so the step is skin-on-skin
      if (k[iIn] >= 76 || k[iOut] >= 76) continue;
      // and only where neither sample is brow-sprite ink (the sprite is much darker
      // than skin); the point is the SKIN either side of the key edge
      if (lum(iIn) < 90 || lum(iOut) < 90) continue;
      inside.push(lum(iIn)); outside.push(lum(iOut)); edges.push([edge, yy]);
    }
    const med = a => { if (!a.length) return null; const s = [...a].sort((p, q) => p - q); return +s[s.length >> 1].toFixed(1); };
    out.push({ side: o < 0 ? 'L' : 'R', rows: inside.length, inside: med(inside), outside: med(outside),
               stepPct: inside.length ? +(((med(inside) - med(outside)) / med(outside)) * 100).toFixed(1) : null,
               edgeSample: edges.slice(0, 4) });
  }
  return out;
};

const browser = await chromium.launch();
for (const m of MODELS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
  await page.goto('http://localhost:8788/glam-team-makeover/');
  await page.waitForFunction(() => !!window.GlamTT);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Character', { exact: true }).selectOption(m);
  await page.getByLabel('Routine', { exact: true }).selectOption('free');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go - / }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });

  console.log(m, 'BARE      ', JSON.stringify(await page.evaluate(measure, [m])));

  // now do the wash for real, so the dull blob is gone, and measure the same step
  await page.evaluate(() => {
    const root = document.getElementById('gtm-root') || document.body;
    void root;
  });
  const washed = await page.evaluate(async (model) => {
    // reach the component through the React fibre and set cov.wash = 1
    const host = document.getElementById('gtm-canvas');
    let f = host[Object.keys(host).find(k => k.startsWith('__reactFiber$'))];
    while (f && !(f.stateNode && f.stateNode.state && f.stateNode.state.ed)) f = f.return;
    if (!f) return 'no-fibre';
    await new Promise(r => f.stateNode.setState(s => { const ed = JSON.parse(JSON.stringify(s.ed)); ed.cov.wash = 1; return { ed }; }, r));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    void model; return 'ok';
  }, m);
  console.log(m, 'WASHED', washed, JSON.stringify(await page.evaluate(measure, [m])));
  await page.close();
}
await browser.close();
