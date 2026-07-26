/* Finding B — the METRIC, run identically against any build.

   stray-ink pixel := on the composited BARE face (no tool used, no recolour), a
   pixel inside the brow-tail band that
     (a) the model's own mask calls skin — hair < 0.10, lips < 0.12, eyes+brows
         key < 0.12, which excludes hair, the hairline's anti-aliased edge, and
         the region the base render's build-time brow removal DID reach;
     (b) is not covered by the brow STATE SPRITE (its own alpha, sampled at the
         exact rect paintAvatar draws it into, must be <= 8); and
     (c) is darker than 0.86 x the model's CHEEK skin luminance — a reference
         taken well away from the band so the repair cannot move the threshold.

   From apps/games:
     PAGE=/glam-team-makeover/_before-brow.html TAG=before node tests/_probe-glam-browtail-metric.mjs
     TAG=after node tests/_probe-glam-browtail-metric.mjs                        */
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

const MODELS = ['m2', 'm3', 'm4'];
const PAGE = process.env.PAGE || '/glam-team-makeover/';
const TAG = process.env.TAG || 'after';
const OUT = new URL('../../../.probe-browtail/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const painted = () => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
};

export const BROWCFG = { m2: { wf: 1.3, dx: 0, dy: 1.65 }, m3: { wf: 1.3, dx: 0, dy: 1.75 }, m4: { wf: 1.3, dx: 0, dy: 1.5 } };
export const BAND = { in: 0.18, out: 0.50, tall: 1.10, hair: 0.10, key: 0.12, lips: 0.12, dark: 0.86 };

export const strayInk = async ([model, BC, B]) => {
  const G = window.__GLAM_ART_GEN__;
  const E = G.models[model].styles['hair-copper'];
  const cv = document.getElementById('gtm-canvas');
  const W = cv.width, H = cv.height;
  const load = (s) => new Promise((r, j) => { const im = new Image(); im.onload = () => r(im); im.onerror = j; im.src = '/glam-team-makeover/' + s; });
  const layer = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const mc = layer(); mc.getContext('2d').drawImage(await load(E.mask), 0, 0, W, H);
  const m = mc.getContext('2d').getImageData(0, 0, W, H).data;
  const c = cv.getContext('2d').getImageData(0, 0, W, H).data;
  const f = E.face, asp = G.brows[model].bushy.L.aspect;
  const lum = i => 0.299 * c[i] + 0.587 * c[i + 1] + 0.114 * c[i + 2];
  const skinAt = i => m[i] / 255 < B.hair && m[i + 1] / 255 < B.lips && m[i + 2] / 255 < B.key;
  const eyes = [[f.eyeL.x * W, f.eyeL.y * H, f.eyeL.w * W, f.eyeL.h * H, -1],
                [f.eyeR.x * W, f.eyeR.y * H, f.eyeR.w * W, f.eyeR.h * H, 1]];
  // the bare face wears the `bushy` pair; stamp it where paintAvatar stamps it
  const sc = layer(); const sx = sc.getContext('2d');
  for (const [x, y, w, h, o] of eyes) {
    const meta = G.brows[model].bushy[o > 0 ? 'R' : 'L']; if (!meta) continue;
    const bw = BC.wf * (2 * w), bh = bw / meta.aspect, by = y - BC.dy * h, bx = x + o * BC.dx * w;
    sx.drawImage(await load(meta.src), bx - bw / 2, by - bh / 2, bw, bh);
  }
  const s = sx.getImageData(0, 0, W, H).data;
  const per = [];
  for (const [x, y, w, h, o] of eyes) {
    // cheek reference: pure skin, well below the band, unaffected by any repair
    const ref = [];
    for (let yy = Math.round(y + h * 1.6); yy < Math.round(y + h * 3.2); yy++)
      for (let xx = Math.round(x - w * 0.6); xx < Math.round(x + w * 0.6); xx++) {
        const i = (yy * W + xx) * 4; if (i < 0 || i >= c.length || !skinAt(i)) continue; ref.push(lum(i));
      }
    ref.sort((p, q) => p - q);
    const skin = ref.length ? ref[ref.length >> 1] : 0;
    const bw = BC.wf * (2 * w), bh = bw / asp, by = y - BC.dy * h, tail = x + o * (BC.dx * w + bw / 2);
    const a = tail - o * B.in * bw, z = tail + o * B.out * bw;
    const x0 = Math.round(Math.min(a, z)), x1 = Math.round(Math.max(a, z));
    const y0 = Math.round(by - B.tall * bh), y1 = Math.round(by + B.tall * bh);
    let stray = 0, band = 0, deficit = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const i = (yy * W + xx) * 4; if (i < 0 || i >= c.length || !skinAt(i) || s[i + 3] > 8) continue;
      band++;
      const L = lum(i);
      if (L < skin * B.dark) { stray++; deficit += skin * B.dark - L; }
    }
    per.push({ side: o < 0 ? 'L' : 'R', box: [x0, y0, x1 - x0, y1 - y0], barePx: band,
               cheekLum: +skin.toFixed(1), stray, deficit: Math.round(deficit) });
  }
  return per;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const browser = await chromium.launch();
  const all = {};
  for (const m of MODELS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
    const errs = [];
    page.on('console', (e) => { if (e.type() === 'error') errs.push(e.text()); });
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`http://localhost:8788${PAGE}`);
    await page.waitForFunction(() => !!window.GlamTT);
    await page.getByTitle('Show / hide setup').click();
    await page.getByLabel('Character', { exact: true }).selectOption(m);
    await page.getByLabel('Routine', { exact: true }).selectOption('free');
    await page.getByRole('button', { name: /^▶ Play/ }).click();
    await page.getByRole('button', { name: /Go —/ }).click();
    await page.waitForFunction(painted, undefined, { timeout: 20000 });
    // the spot flaws are seeded per play and one of m4's pool positions lands
    // inside the R band, so leaving them in makes the count run-dependent
    await page.evaluate(async () => {
      const host = document.getElementById('gtm-canvas');
      let f = host[Object.keys(host).find(k => k.startsWith('__reactFiber$'))];
      while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
      const L = f.stateNode.logic;
      await new Promise(r => L.setState(s => {
        const ed = JSON.parse(JSON.stringify(s.ed)); ed.pimples = []; return { ed };
      }, r));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    all[m] = await page.evaluate(strayInk, [m, BROWCFG[m], BAND]);
    if (errs.length) console.log('CONSOLE', m, errs);
    await page.close();
  }
  await writeFile(`${OUT}${TAG}-metric.json`, JSON.stringify(all, null, 1));
  console.log(TAG);
  for (const [m, v] of Object.entries(all))
    for (const p of v) console.log(` ${m} ${p.side}  band=${p.box.join(',')} barePx=${String(p.barePx).padStart(5)} cheek=${p.cheekLum}  stray=${String(p.stray).padStart(4)}  deficit=${p.deficit}`);
  await browser.close();
}
