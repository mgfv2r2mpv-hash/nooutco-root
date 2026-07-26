/* Screenshot pass for SECOND-PASS fix U1 (the highlight's falloff) and U2 (its
   silhouette). Not a spec. Run against a server on :8788:

     git show HEAD:apps/games/glam-team-makeover/index.html \
       > apps/games/glam-team-makeover/_before-tune2.html
     PHASE=before PAGE=/glam-team-makeover/_before-tune2.html node tests/_shots-glam-tune2-hl.mjs
     PHASE=after  node tests/_shots-glam-tune2-hl.mjs
     rm apps/games/glam-team-makeover/_before-tune2.html

   Same "previous commit's file, same directory" trick as the first pass, so
   `../tailwind.css`, `vendor/` and `assets/` resolve identically and only the
   renderer differs.

   Per model (m2/m3/m4), the cheekbones and nose bridge with the HIGHLIGHT ONLY
   on bare skin — no blush, no shadow, nothing else to read the shape against:

     · highlight-<phase>-<model>.png   — ×7 loupe, nearest-neighbour

   The crop is wider than the first pass's (1.9 eye-widths outboard, and up to
   0.4 eye-heights above the eye line) because the swept shape reaches further
   out along the cheekbone than the ellipse it replaces; both phases use the same
   numbers off the same face anchors, so the pair frames identical pixels.

   Blemishes are HEALED. They are seeded off `Math.random`, so leaving them in
   would put different dark dots under the two phases' sweeps and the loupe would
   be showing spots rather than the fix.

   Plus the un-magnified stage at three widths, so the fix is also seen in
   context on a whole face:
     · glow-<phase>-<device>.png       — highlight + blush + shadow */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const PHASE = process.env.PHASE || 'after';
const PAGE = process.env.PAGE || '/glam-team-makeover/';
const OUT = new URL('../../../docs/eval/shots/glam-tune2/', import.meta.url).pathname;
const MODELS = ['m2', 'm3', 'm4'];
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
  { tag: 'phone', width: 390, height: 844 },
];
const ZOOM = 7;

const logic = (page, src) => page.evaluate(({ src }) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  return new Function('L', src)(f.stateNode.logic);
}, { src });

/* Highlight alone on bare skin: this pass is about one shape's outline and one
   ramp's falloff, and a blush under it or a lash sprite over it only makes the
   before/after pair harder to read. */
const HL_ONLY = `
  return new Promise((r) => L.setState((s) => {
    const ed = JSON.parse(JSON.stringify(s.ed));
    ed.pimples = (ed.pimples || []).map(() => 2);
    ed.cov.hl = 1;
    return { ed };
  }, r));`;

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

const LOUPE = (zoom) => `
  const cv = document.getElementById('gtm-canvas');
  const W = cv.width, H = cv.height;
  const f = L.genEntry().face, l = f.eyeL, r = f.eyeR;
  const yc = (l.y + r.y) / 2 * H, hh = Math.max(l.h, r.h) * H;
  let box = { x: (l.x - l.w * 1.9) * W, y: yc + hh * -0.4,
              w: ((r.x + r.w * 1.9) - (l.x - l.w * 1.9)) * W, h: hh * 2.9 };
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

const painted = () => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
};

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];

{
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, reducedMotion: 'reduce' });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`loupe: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`loupe: ${e.message}`));
  await page.goto(`http://localhost:8788${PAGE}`);
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await page.getByTitle('Show / hide setup').click();
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });

  for (const m of MODELS) {
    await logic(page, `return (async () => {
      await new Promise((r) => L.setState({ model: '${m}', ed: L.freshEd('person') }, r));
      for (let i = 0; i < 80 && !L._skinPool('${m}'); i++) await new Promise((r) => setTimeout(r, 100));
    })();`);
    await logic(page, HL_ONLY);
    await page.waitForTimeout(500);
    await logic(page, LOUPE(ZOOM));
    await page.waitForTimeout(120);
    await page.locator('#gtm-loupe').screenshot({ path: `${OUT}highlight-${PHASE}-${m}.png` });
    await page.evaluate(() => { const e = document.getElementById('gtm-loupe'); if (e) e.remove(); });
  }
  await page.close();
}

for (const d of DEVICES) {
  const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, reducedMotion: 'reduce' });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${d.tag}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${d.tag}: ${e.message}`));
  await page.goto(`http://localhost:8788${PAGE}`);
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Character', { exact: true }).selectOption('m4');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go —/ }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });
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
console.log(`${PHASE} highlight shots written to ${OUT}`);
