/* Screenshot pass for TUNING fix 4a (lip liner), 4b (colored-contact clipping),
   4c (eyeshadow gradient), 4d (blush) and 4e (highlight).
   Not a spec. Run against a server on :8788:

     git show HEAD:apps/games/glam-team-makeover/index.html \
       > apps/games/glam-team-makeover/_before-tune.html
     PHASE=before PAGE=/glam-team-makeover/_before-tune.html node tests/_shots-glam-tune-face.mjs
     PHASE=after  node tests/_shots-glam-tune-face.mjs
     rm apps/games/glam-team-makeover/_before-tune.html

   Same "previous commit's file, same directory" trick as the thread and trolley
   passes, so `../tailwind.css`, `vendor/` and `assets/` resolve identically and
   only the renderer differs.

   These two defects live at the pixel, not at the layout: the lip-liner speckles
   are single pixels on the mouth seam and the contact overrun is a few pixels of
   colour past the iris. A 1280-wide stage shot renders the whole mouth about
   40 px across, where neither is legible. So every face shot is a LOUPE: the
   region is cropped out of the live `#gtm-canvas` and blitted ×7 with smoothing
   OFF into an overlay canvas, which is what gets photographed. Nearest-neighbour
   is deliberate - it shows the actual pixels the compositor wrote rather than a
   resampler's opinion of them.

   Per model (the whole roster, because each has its own mask and eye scale):
     · lipliner-<phase>-<model>.png - the mouth, liner + lipstick on
     · eyeclip-<phase>-<model>.png - the eye pair, contacts + shadow + mascara on
     · eyeshadow-<phase>-<model>.png - the lids, shadow ONLY (no lashes over it)
     · blush-<phase>-<model>.png - one cheek, blush only
     · highlight-<phase>-<model>.png - the cheekbones + nose bridge, highlight only
   Plus the un-magnified stage with both tools applied, at three widths:
     · face-<phase>-<device>.png
     · glow-<phase>-<device>.png - shadow + blush + highlight, nothing else

   `Math.random` is seeded and the client pinned through the ⚙ Character lock, so
   the two passes photograph the same face. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const PHASE = process.env.PHASE || 'after';
const PAGE = process.env.PAGE || '/glam-team-makeover/';
const OUT = new URL('../../../docs/eval/shots/glam-tune/', import.meta.url).pathname;
const MODELS = ['m2', 'm3', 'm4'];
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
  { tag: 'phone', width: 390, height: 844 },
];
const ZOOM = 7;

/** Walk the React fiber to the component and run `src` with `L` bound to it. */
const logic = (page, src) => page.evaluate(({ src }) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  return new Function('L', src)(f.stateNode.logic);
}, { src });

/* The state both shots are taken in. Lipstick is on under the liner because that
   is how a liner is worn and how the maintainer met the artifact; shadow and
   mascara are on because the contact disc has to survive the sprite stack it
   sits under. Written straight to `ed` so both passes land on the same frame. */
const FACE_ON = `
  return new Promise((r) => L.setState((s) => {
    const ed = JSON.parse(JSON.stringify(s.ed));
    ed.pimples = (ed.pimples || []).map(() => 2);
    ed.cov.wash = 1; ed.cov.moist = 1;
    ed.cov.lips = 1; ed.col.lips = '#d64b6a';
    ed.cov.lipliner = 1; ed.col.lipliner = '#b23a56';
    ed.cov.shadow = 1; ed.col.shadow = '#a06cc9';
    ed.cov.mascara = 1;
    ed.col.contacts = '#4a90d9';
    return { ed };
  }, r));`;

/* The three procedural-cosmetic tools of 4c/4d/4e, with nothing else on the face:
   the lid gradient, the blush edge and the highlight footprint are all judged
   against BARE skin, and a lash sprite or a lip colour over them only makes the
   pair harder to read. */
const GLOW_ON = `
  return new Promise((r) => L.setState((s) => {
    const ed = JSON.parse(JSON.stringify(s.ed));
    ed.pimples = (ed.pimples || []).map(() => 2);
    ed.cov.wash = 1; ed.cov.moist = 1;
    ed.cov.shadow = 1; ed.col.shadow = '#a06cc9';
    ed.cov.blush = 1; ed.col.blush = '#f28ba0';
    ed.cov.hl = 1;
    return { ed };
  }, r));`;

/* Build the loupe. `what` names the region; every crop comes from geometry both
   passes share - the lip mask's own bbox for the mouth, the face anchors for
   everything else - so the before/after pair frames identical pixels. */
const LOUPE = (what, zoom) => `
  const cv = document.getElementById('gtm-canvas');
  const W = cv.width, H = cv.height;
  let box;
  if ('${what}' === 'lips') {
    const z = L._artZones().lips;
    box = { x: z.l / 100 * W, y: z.t / 100 * H, w: z.w / 100 * W, h: z.h / 100 * H };
  } else {
    const f = L.genEntry().face;
    const l = f.eyeL, r = f.eyeR;
    const yc = (l.y + r.y) / 2 * H, hh = Math.max(l.h, r.h) * H;
    const span = (a, b, tp, bt) => ({ x: (l.x - l.w * a) * W, y: yc + hh * tp,
      w: ((r.x + r.w * b) - (l.x - l.w * a)) * W, h: hh * (bt - tp) });
    box = '${what}' === 'lid'    ? span(1.5, 1.5, -1.9, 0.5)
        : '${what}' === 'cheek'  ? { x: (r.x - r.w * 1.9) * W, y: yc + hh * 0.5,
                                     w: r.w * 3.8 * W, h: hh * 2.9 }
        : '${what}' === 'hl'     ? span(1.7, 1.7, 0.2, 2.7)
        : span(1.5, 1.5, -1.6, 1.6);
  }
  box = { x: Math.max(0, Math.round(box.x)), y: Math.max(0, Math.round(box.y)),
          w: Math.round(box.w), h: Math.round(box.h) };
  let el = document.getElementById('gtm-loupe');
  if (!el) { el = document.createElement('canvas'); el.id = 'gtm-loupe';
    el.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#2a1830';
    document.body.appendChild(el); }
  el.width = box.w * ${zoom}; el.height = box.h * ${zoom};
  const cx = el.getContext('2d'); cx.imageSmoothingEnabled = false;
  cx.clearRect(0, 0, el.width, el.height);
  cx.drawImage(cv, box.x, box.y, box.w, box.h, 0, 0, el.width, el.height);
  return box;`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];

/* ── the loupes: one desktop page, driven across the roster ── */
{
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`loupe: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`loupe: ${e.message}`));
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

  for (const m of MODELS) {
    // switching model needs that model's masks decoded before anything is measured
    await logic(page, `return (async () => {
      await new Promise((r) => L.setState({ model: '${m}', ed: L.freshEd('person') }, r));
      for (let i = 0; i < 80 && !L._skinPool('${m}'); i++) await new Promise((r) => setTimeout(r, 100));
    })();`);
    for (const [state, regions] of [
      [FACE_ON, [['lips', 'lipliner'], ['eyes', 'eyeclip']]],
      [GLOW_ON, [['lid', 'eyeshadow'], ['cheek', 'blush'], ['hl', 'highlight']]],
    ]) {
      await logic(page, `return (async () => {
        await new Promise((r) => L.setState({ ed: L.freshEd('person') }, r));
        await new Promise((r) => setTimeout(r, 120));
      })();`);
      await logic(page, state);
      await page.waitForTimeout(500);
      for (const [what, name] of regions) {
        await logic(page, LOUPE(what, ZOOM));
        await page.waitForTimeout(120);
        await page.locator('#gtm-loupe').screenshot({ path: `${OUT}${name}-${PHASE}-${m}.png` });
      }
      await page.evaluate(() => { const e = document.getElementById('gtm-loupe'); if (e) e.remove(); });
    }
  }
  await page.close();
}

/* ── the un-magnified stage, so the fixes are also seen in context ── */
for (const d of DEVICES) {
  const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, reducedMotion: 'reduce' });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${d.tag}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${d.tag}: ${e.message}`));
  await page.addInitScript(() => {
    let s = 20260725;
    Math.random = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  });
  await page.goto(`http://localhost:8788${PAGE}`);
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Character', { exact: true }).selectOption('m4');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go - / }).click();
  await logic(page, FACE_ON);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}face-${PHASE}-${d.tag}.png` });
  await logic(page, `return new Promise((r) => L.setState({ ed: L.freshEd('person') }, r));`);
  await logic(page, GLOW_ON);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}glow-${PHASE}-${d.tag}.png` });
  await page.close();
}

await browser.close();
if (problems.length) {
  console.error('CONSOLE / PAGE ERRORS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`${PHASE} face shots written to ${OUT}`);
