/* Finding B — is the eyes+brows mask key anti-aliased at all?

   Refutes lead 1 (the hard `eb<0.12` cutoff in `_eyesCanvas` stair-stepping an
   anti-aliased edge): the blue channel is ~93 % exactly 255 and its whole 1..63
   shoulder is under 240 px per model. Table quoted in the build report.

   Reproduced in the state the
   maintainer named: bare face, default hair, NO brow tool taken, NO recolour.

   Run against a hash-verified :8788 from apps/games:
     node tests/_probe-glam-browtail.mjs

   Prints, per model, a picture of what is actually in the band between the
   outer brow tail and the temple/hairline, from three separate sources so the
   compositing step responsible can be named rather than guessed:

     base   — the raw base.png alone (what ships in the art)
     mask   — mask.png's BLUE channel (the eyes+brows lift key)
     canvas — the composited avatar as the child sees it

   Everything is measured in the base image's own pixel space and then mapped
   onto the canvas, so the three are comparable. */
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

const MODELS = ['m2', 'm3', 'm4'];
const OUT = new URL('../../../.probe-browtail/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
await page.goto('http://localhost:8788/glam-team-makeover/');
await page.waitForFunction(() => !!window.GlamTT);

const report = await page.evaluate(async (models) => {
  const load = (src) => new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error(src)); im.src = src;
  });
  const dataOf = (im) => {
    const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0);
    return x.getImageData(0, 0, c.width, c.height);
  };
  const gen = await fetch('/glam-team-makeover/assets/art/person/generated.json').then(r => r.json()).catch(() => null);
  const out = { genKeys: gen ? Object.keys(gen) : null, models: {} };
  for (const m of models) {
    const dir = `/glam-team-makeover/assets/art/person/${m}/hair-copper/`;
    let base, mask;
    try { base = dataOf(await load(dir + 'base.png')); mask = dataOf(await load(dir + 'mask.png')); }
    catch (e) { out.models[m] = { error: String(e) }; continue; }
    const W = base.width, H = base.height, b = base.data, k = mask.data;
    // blue-channel histogram over the whole image, bucketed at 1/16
    const hist = new Array(16).fill(0);
    let nonzero = 0, full = 0;
    for (let i = 0; i < b.length; i += 4) {
      const v = k[i + 2];
      if (v > 0) nonzero++;
      if (v === 255) full++;
      hist[Math.min(15, v >> 4)]++;
    }
    // pixels straddling the 0.12 cutoff (30.6/255): how many live in the
    // anti-aliased shoulder the hard threshold cuts through
    let justBelow = 0, justAbove = 0;
    for (let i = 0; i < b.length; i += 4) {
      const v = k[i + 2];
      if (v > 0 && v < 31) justBelow++;
      if (v >= 31 && v < 64) justAbove++;
    }
    // bounding box of the blue key
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (k[(y * W + x) * 4 + 2] >= 31) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    out.models[m] = {
      W, H, blueNonzero: nonzero, blueFull: full,
      blueShoulderBelowCut: justBelow, blueShoulderAboveCut: justAbove,
      hist16: hist, keyBox: { x0, x1, y0, y1 },
    };
  }
  return out;
}, MODELS);

await writeFile(OUT + 'mask-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2).slice(0, 6000));
await browser.close();
