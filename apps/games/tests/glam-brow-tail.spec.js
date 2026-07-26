/* Glam Team Makeover — turn-exchange pass, Finding B: the brow-tail pixel noise.

   Reported: "a small amount of pixel noise between outer tail of eyebrows and
   temple/hairline". The maintainer then corrected the diagnosis and their
   correction is the one under test here: "the base image has an eyebrow that is
   removed by code and that is the likeliest source of aberration" — on a face
   where NO brow tool has been used and NO recolour has happened, which is why
   `BROW_TINT` is not involved and is not touched. It is asserted unchanged below.

   The state under test is exactly the reported one: bare face, default hair,
   routine `free` so no tool has had to be taken to reach the salon, and the spot
   flaws cleared — one of m4's seeded spot positions lands inside the R band, and
   leaving it in makes the count depend on the draw rather than on the render. */
import { test, expect } from '@playwright/test';

const MODELS = ['m2', 'm3', 'm4'];

/* Hoisted from index.html so the band lands where paintAvatar draws, and kept in
   step with `BROW_CLEAN` there: the repair and the measurement of it have to come
   out of the same numbers or they drift apart silently. */
const BROWCFG = { m2: { wf: 1.3, dx: 0, dy: 1.65 }, m3: { wf: 1.3, dx: 0, dy: 1.75 }, m4: { wf: 1.3, dx: 0, dy: 1.5 } };
const BAND = { in: 0.18, out: 0.50, tall: 1.10, hair: 0.10, key: 0.12, lips: 0.12, dark: 0.86 };

/* A stray-ink pixel is, on the composited bare face, a pixel inside the brow-tail
   band that
     (a) the model's OWN mask calls skin — hair < 0.10, lips < 0.12, eyes+brows
         key < 0.12. That excludes hair, the hairline's anti-aliased edge, and
         the region the base render's build-time brow removal did reach;
     (b) is not covered by the brow STATE SPRITE, whose alpha is sampled at the
         exact rect paintAvatar stamps it into; and
     (c) is darker than 0.86 x the model's CHEEK skin luminance — a reference
         taken well below the band so no repair inside the band can move it.
   `deficit` is the integral of how far under that threshold the band runs, in
   luminance-pixels. It is the headline number: the noise is a haze, so its area
   barely moves when it is lifted while its depth roughly halves. */
const strayInk = async ([model, BC, B]) => {
  const G = window.__GLAM_ART_GEN__;
  const E = G.models[model].styles['hair-copper'];
  const cv = document.getElementById('gtm-canvas');
  const W = cv.width, H = cv.height;
  const load = (s) => new Promise((r, j) => { const im = new Image(); im.onload = () => r(im); im.onerror = j; im.src = new URL(s, document.baseURI).href; });
  const layer = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const mc = layer(); mc.getContext('2d').drawImage(await load(E.mask), 0, 0, W, H);
  const m = mc.getContext('2d').getImageData(0, 0, W, H).data;
  const c = cv.getContext('2d').getImageData(0, 0, W, H).data;
  const f = E.face, asp = G.brows[model].bushy.L.aspect;
  const lum = (i) => 0.299 * c[i] + 0.587 * c[i + 1] + 0.114 * c[i + 2];
  const skinAt = (i) => m[i] / 255 < B.hair && m[i + 1] / 255 < B.lips && m[i + 2] / 255 < B.key;
  const eyes = [[f.eyeL.x * W, f.eyeL.y * H, f.eyeL.w * W, f.eyeL.h * H, -1],
                [f.eyeR.x * W, f.eyeR.y * H, f.eyeR.w * W, f.eyeR.h * H, 1]];
  const sc = layer(); const sx = sc.getContext('2d');
  for (const [x, y, w, h, o] of eyes) {
    const meta = G.brows[model].bushy[o > 0 ? 'R' : 'L']; if (!meta) continue;
    const bw = BC.wf * (2 * w), bh = bw / meta.aspect, by = y - BC.dy * h, bx = x + o * BC.dx * w;
    sx.drawImage(await load(meta.src), bx - bw / 2, by - bh / 2, bw, bh);
  }
  const s = sx.getImageData(0, 0, W, H).data;
  const per = [];
  for (const [x, y, w, h, o] of eyes) {
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
               cheekLum: Math.round(skin), stray, deficit: Math.round(deficit) });
  }
  return per;
};

/* Caps sit at the MIDPOINT of the two measured builds, so each has roughly equal
   margin. Measured on a hash-verified :8788, spots cleared, chromium:

       band     93dab9be   with `_browClean`   cap
       m2 L        9205         5840          7500
       m2 R        8523         5114          6800
       m3 L         263          115           190
       m3 R         220          100           160
       m4 L         288          125           205
       m4 R         194          110           150

   Firefox and WebKit read canvas back with their own rounding, so the cap is
   asserted per engine from the same table; the two builds are far enough apart
   (before is 1.5-2.4x after) that the engine spread does not reach the midpoint. */
const CAP = { m2: { L: 7500, R: 6800 }, m3: { L: 190, R: 160 }, m4: { L: 205, R: 150 } };

const painted = () => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
};

const logic = () => {
  const host = document.getElementById('gtm-canvas');
  let f = host[Object.keys(host).find((k) => k.startsWith('__reactFiber$'))];
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  return f && f.stateNode.logic;
};

async function bareFace(page, model) {
  await page.goto('/glam-team-makeover/');
  await page.waitForFunction(() => !!window.GlamTT && !!window.__GLAM_ART_GEN__);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Character', { exact: true }).selectOption(model);
  await page.getByLabel('Routine', { exact: true }).selectOption('free');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go —/ }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });
  await page.evaluate(async (src) => {
    const L = new Function('return (' + src + ')')()();
    await new Promise((r) => L.setState((s) => {
      const ed = JSON.parse(JSON.stringify(s.ed)); ed.pimples = []; return { ed };
    }, r));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, logic.toString());
}

for (const model of MODELS) {
  test(`brow-tail noise on a bare ${model} stays under the cap`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await bareFace(page, model);
    const per = await page.evaluate(strayInk, [model, BROWCFG[model], BAND]);
    expect(per.map((p) => p.side)).toEqual(['L', 'R']);
    for (const p of per) {
      expect(p.barePx, `${model} ${p.side} band has bare skin to measure`).toBeGreaterThan(400);
      expect(p.deficit, `${model} ${p.side} stray-ink deficit (band ${p.box.join(',')}, cheek ${p.cheekLum})`)
        .toBeLessThanOrEqual(CAP[model][p.side]);
    }
    expect(errors).toEqual([]);
  });
}

test('the repair only ever lightens, and only on mask-skin inside the band', async ({ page }) => {
  await bareFace(page, 'm4');
  const audit = await page.evaluate(async ([src, BC, B]) => {
    const L = new Function('return (' + src + ')')()();
    const E = L.genEntry();
    const cv = L._browClean(E);
    if (!cv) return { err: 'no overlay' };
    const G = window.__GLAM_ART_GEN__, W = cv.width, H = cv.height;
    const load = (s) => new Promise((r, j) => { const im = new Image(); im.onload = () => r(im); im.onerror = j; im.src = new URL(s, document.baseURI).href; });
    const grab = async (s) => { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(await load(s), 0, 0, W, H); return c.getContext('2d').getImageData(0, 0, W, H).data; };
    const b = await grab(E.base), m = await grab(E.mask);
    const d = cv.getContext('2d').getImageData(0, 0, W, H).data;
    const f = E.face, asp = G.brows.m4.bushy.L.aspect;
    const bands = [];
    for (const [x, y, w, h, o] of [[f.eyeL.x * W, f.eyeL.y * H, f.eyeL.w * W, f.eyeL.h * H, -1],
                                   [f.eyeR.x * W, f.eyeR.y * H, f.eyeR.w * W, f.eyeR.h * H, 1]]) {
      const bw = BC.wf * (2 * w), bh = bw / asp, by = y - BC.dy * h, tail = x + o * (BC.dx * w + bw / 2);
      const a = tail - o * B.in * bw, z = tail + o * B.out * bw;
      bands.push([Math.min(a, z), by - B.tall * bh, Math.max(a, z), by + B.tall * bh]);
    }
    // the overlay is read back un-premultiplied, so only its ALPHA is reliable at
    // low coverage; the tone is checked once, from the most opaque pixel it has.
    let touched = 0, outsideBand = 0, onHair = 0, onKey = 0, best = -1, tone = null;
    const lum = (a, i) => 0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2];
    let darkened = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      touched++;
      const p = i / 4, x = p % W, y = (p / W) | 0;
      if (!bands.some((q) => x >= q[0] && x <= q[2] && y >= q[1] && y <= q[3])) outsideBand++;
      if (m[i] / 255 >= B.hair) onHair++;
      if (m[i + 2] / 255 >= B.key) onKey++;
      if (d[i + 3] > best) { best = d[i + 3]; tone = [d[i], d[i + 1], d[i + 2]]; }
    }
    // and the composited effect: nothing under the overlay may come out darker
    const flat = document.createElement('canvas'); flat.width = W; flat.height = H;
    const fx = flat.getContext('2d');
    fx.drawImage(L._img(E.base).img, 0, 0, W, H);
    const before = fx.getImageData(0, 0, W, H).data.slice();
    fx.drawImage(cv, 0, 0, W, H);
    const after = fx.getImageData(0, 0, W, H).data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      if (lum(after, i) < lum(before, i) - 1) darkened++;
    }
    return { touched, outsideBand, onHair, onKey, darkened, tone, best };
  }, [logic.toString(), BROWCFG.m4, BAND]);

  expect(audit.err).toBeUndefined();
  expect(audit.touched, 'the repair found brow ink to lift').toBeGreaterThan(0);
  expect(audit.outsideBand, 'no pixel outside the brow-tail band is touched').toBe(0);
  expect(audit.onHair, 'no hair pixel is repainted').toBe(0);
  expect(audit.onKey, 'no pixel the build-time removal reached is repainted').toBe(0);
  expect(audit.darkened, 'the repair never darkens a pixel').toBe(0);
});

test('the accepted brow tint floor is untouched by this pass', async ({ page }) => {
  await page.goto('/glam-team-makeover/');
  const src = await page.evaluate(() => document.documentElement.outerHTML);
  // the A2 ruling the maintainer accepted: floor 0.60, span 0.55. Finding B is a
  // bare-face defect and must not have moved it.
  expect(src).toContain('const BROW_TINT = { floor:0.60, span:0.55 };');
});
