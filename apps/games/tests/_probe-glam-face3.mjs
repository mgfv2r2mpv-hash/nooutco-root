/* Measurement harness behind TUNING fixes 4c/4d/4e (eyeshadow / blush /
   highlight). NOT a spec — it prints numbers, it asserts nothing. The tables in
   docs/eval/glam-team-makeover-build-report.md §T4c–T4e came out of it.

   Run against a server on :8788, once per side of the comparison:

     git show HEAD:apps/games/glam-team-makeover/index.html \
       > apps/games/glam-team-makeover/_before-tune.html
     PAGE=/glam-team-makeover/_before-tune.html node tests/_probe-glam-face3.mjs
     node tests/_probe-glam-face3.mjs
     rm apps/games/glam-team-makeover/_before-tune.html

   Same "previous commit's file, served from the same directory" trick the shot
   passes use, so `../tailwind.css`, `vendor/` and `assets/` resolve identically
   and only the renderer differs.

   The default VIEW=1280x720 matches what `playwright.config.js` gives the specs
   (Desktop Chrome), which is the viewport any number quoted at a test bound has
   to come from — a bigger canvas reads a few percent differently.

   Each tool is measured PER SIDE of the face, as the delta against the same
   face without it:
     n       — pixels moved
     peak    — largest single-channel delta
     area    — n in units of one eye's area, so the figure is model-independent
     theta   — principal angle of the delta-weighted second-moment tensor, +y down
     ecc     — anisotropy of that tensor: 0 for a circle, → 1 for a line
     faint   — share of the footprint under 35 % of peak (soft-edge proxy)
     lmax    — strict local maxima of the smoothed field (plateau-sensitive; use
               `maxC` instead — a raised-cosine core ties across many pixels)
     sweep   — components at 12 level sets from 0.35 to 0.90 of peak, counting
               only components worth 2 % of the footprint
     maxC    — the worst of those. 1 = one blob. 2 = two blobs meeting.
   Options: PAGE, VIEW=WxH, SHOT=<tag> (writes /tmp/glamface/<tag>-<model>-<tool>.png). */
import { chromium } from '@playwright/test';

const PAGE = process.env.PAGE || '/glam-team-makeover/';
const [VW, VH] = (process.env.VIEW || '1280x720').split('x').map(Number);
const MODELS = ['m2', 'm3', 'm4'];

const logic = (page, src) => page.evaluate(({ src }) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  return new Function('L', src)(f.stateNode.logic);
}, { src });

/* Every state is cut from ONE baseline `ed` per model, never from a second
   `freshEd()`: `spotSeed` is random, so two fresh draws move the blemishes and
   the diff then measures the blemishes rather than the tool. (Found the hard
   way — it read as a 120-peak "eyeshadow" spanning half the face.) */
const SET = (patch) => `
  const p = ${JSON.stringify(patch)};
  return new Promise((r) => L.setState(() => {
    const ed = JSON.parse(JSON.stringify(window.__BASE_ED));
    if (p.cov) Object.assign(ed.cov, p.cov);
    if (p.col) Object.assign(ed.col, p.col);
    return { ed };
  }, r));`;

const GRAB = () => {
  const cv = document.getElementById('gtm-canvas');
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
  return { w: cv.width, h: cv.height, data: Array.from(d.data) };
};

/** Shape of one tool's footprint on one half of the frame (`side` −1 / +1). */
const stats = (a, b, w, h, side) => {
  const D = new Float64Array(w * h);
  let n = 0, peak = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  const lo = side < 0 ? 0 : w >> 1, hi = side < 0 ? w >> 1 : w;
  for (let y = 0; y < h; y++) for (let x = lo; x < hi; x++) {
    const i = (y * w + x) * 4;
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    D[y * w + x] = d;
    if (d <= 2) continue;
    n++; if (d > peak) peak = d;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (!n) return { n: 0 };

  let faint = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = D[y * w + x]; if (d > 2 && d < peak * 0.35) faint++; }

  let sw = 0, sx = 0, sy = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = D[y * w + x]; if (d <= 2) continue; sw += d; sx += d * x; sy += d * y; }
  const mx = sx / sw, my = sy / sw;
  let uxx = 0, uyy = 0, uxy = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = D[y * w + x]; if (d <= 2) continue;
    uxx += d * (x - mx) ** 2; uyy += d * (y - my) ** 2; uxy += d * (x - mx) * (y - my); }
  uxx /= sw; uyy /= sw; uxy /= sw;
  const theta = 0.5 * Math.atan2(2 * uxy, uxx - uyy) * 180 / Math.PI;
  const ecc = Math.sqrt((uxx - uyy) ** 2 + 4 * uxy * uxy) / (uxx + uyy);

  const S = new Float64Array(w * h);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { let s = 0, c = 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= h || xx < lo || xx >= hi) continue;
      s += D[yy * w + xx]; c++; }
    S[y * w + x] = s / c; }
  let spk = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (S[y * w + x] > spk) spk = S[y * w + x];
  const MINPX = Math.max(20, n * 0.02);
  const comps = (lvl) => { const seen = new Set(); let k = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const id = y * w + x; if (S[id] < lvl || seen.has(id)) continue;
      let sz = 0; const st = [id]; seen.add(id);
      while (st.length) { const p = st.pop(), py = (p / w) | 0, px = p % w; sz++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = py + dy, xx = px + dx; if (yy < y0 || yy > y1 || xx < x0 || xx > x1) continue;
          const q = yy * w + xx; if (seen.has(q) || S[q] < lvl) continue; seen.add(q); st.push(q); } }
      if (sz >= MINPX) k++; }
    return k; };
  const sweep = Array.from({ length: 12 }, (_, i) => comps(spk * (0.35 + i * 0.05)));
  let lmax = 0;
  for (let y = y0 + 3; y <= y1 - 3; y++) for (let x = x0 + 3; x <= x1 - 3; x++) {
    const v = S[y * w + x]; if (v < spk * 0.4) continue; let top = true;
    for (let dy = -3; dy <= 3 && top; dy++) for (let dx = -3; dx <= 3; dx++) {
      if (!dx && !dy) continue; if (S[(y + dy) * w + x + dx] > v) { top = false; break; } }
    if (top) lmax++; }

  return { n, peak, bw: x1 - x0 + 1, bh: y1 - y0 + 1,
    theta: +theta.toFixed(1), ecc: +ecc.toFixed(3),
    faint: +(faint / n * 100).toFixed(0),
    lmax, sweep: sweep.join(''), maxComp: Math.max(...sweep) };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: VW, height: VH }, reducedMotion: 'reduce' });
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', (e) => problems.push(e.message));
await page.goto(`http://localhost:8788${PAGE}`);
await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
await page.getByTitle('Show / hide setup').click();
await page.getByRole('button', { name: /^▶ Play/ }).click();
await page.waitForFunction(() => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
}, undefined, { timeout: 20000 });

const TOOLS = [
  ['shadow', { cov: { shadow: 1 }, col: { shadow: '#a06cc9' } }],
  ['blush', { cov: { blush: 1 }, col: { blush: '#f28ba0' } }],
  ['hl', { cov: { hl: 1 } }],
];

for (const m of MODELS) {
  // switching model needs that model's masks decoded before anything is measured
  await logic(page, `return (async () => {
    await new Promise((r) => L.setState({ model: '${m}', ed: L.freshEd('person') }, r));
    for (let i = 0; i < 80 && !L._skinPool('${m}'); i++) await new Promise((r) => setTimeout(r, 100));
    window.__BASE_ED = JSON.parse(JSON.stringify(L.state.ed));
  })();`);
  await logic(page, SET({}));
  await page.waitForTimeout(400);
  const base = await page.evaluate(GRAB);
  const eye = await logic(page, `const f=L.genEntry().face; const cv=document.getElementById('gtm-canvas');
    return { ew:(f.eyeL.w+f.eyeR.w)/2*cv.width, eh:(f.eyeL.h+f.eyeR.h)/2*cv.height };`);
  for (const [name, patch] of TOOLS) {
    await logic(page, SET(patch));
    await page.waitForTimeout(350);
    const on = await page.evaluate(GRAB);
    if (process.env.SHOT) {
      await page.locator('#gtm-canvas').screenshot({ path: `/tmp/glamface/${process.env.SHOT}-${m}-${name}.png` });
    }
    for (const side of [-1, 1]) {
      const s = stats(base.data, on.data, base.w, base.h, side);
      console.log(`${m} ${name.padEnd(7)} ${side < 0 ? 'L' : 'R'}`
        + ` n=${String(s.n).padStart(5)} peak=${String(s.peak).padStart(3)}`
        + ` area=${(s.n / (eye.ew * eye.eh)).toFixed(2)}ey bbox=${s.bw}x${s.bh}`
        + ` theta=${String(s.theta).padStart(6)} ecc=${s.ecc} faint=${s.faint}%`
        + ` lmax=${s.lmax} sweep=${s.sweep} maxC=${s.maxComp}`);
    }
    await logic(page, SET({}));
    await page.waitForTimeout(250);
  }
}
await browser.close();
if (problems.length) { console.error('CONSOLE:\n' + problems.join('\n')); process.exit(1); }
