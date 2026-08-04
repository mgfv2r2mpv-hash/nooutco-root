/* Screenshot pass for SECOND-PASS fix U3 (the stage cropping the game art).
   Not a spec. Run against a server on :8788:

     git show HEAD:apps/games/glam-team-makeover/index.html \
       > apps/games/glam-team-makeover/_before-tune2b.html
     PHASE=before PAGE=/glam-team-makeover/_before-tune2b.html node tests/_shots-glam-tune2-stage.mjs
     PHASE=after  node tests/_shots-glam-tune2-stage.mjs
     rm apps/games/glam-team-makeover/_before-tune2b.html

   Same "previous commit's file, same directory" trick as the first pass, so
   `../tailwind.css`, `vendor/` and `assets/` resolve identically and only the
   renderer differs.

   Per device (1280×860 / 834×1112 / 390×844):

     · stage-<phase>-<device>.png - the stage panel alone, so the crop is
                                          read against the panel's own edge
     · page-<phase>-<device>.png - the whole viewport, scrolled to the top,
                                          because "the game area" is what the child
                                          sees, not a cropped element shot

   The client is m4 and the look is left bare: this pass is about the fit, and a
   painted face only makes the two phases harder to line up. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const PHASE = process.env.PHASE || 'after';
const PAGE = process.env.PAGE || '/glam-team-makeover/';
const OUT = new URL('../../../docs/eval/shots/glam-tune2/', import.meta.url).pathname;
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
  { tag: 'phone', width: 390, height: 844 },
];

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

for (const d of DEVICES) {
  const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, reducedMotion: 'reduce' });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${d.tag}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${d.tag}: ${e.message}`));
  await page.goto(`http://localhost:8788${PAGE}`);
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Character', { exact: true }).selectOption('m4');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go - / }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });
  await page.waitForTimeout(700);
  // "Go" scrolls the trolley into view; the crop is not a scroll artefact, so
  // both phases are shot from the top of the page.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  /* The stage panel is the one element whose edge the composition is cut by, and
     it is found by the art it carries so the same rule locates it in both phases
     (the post-change file has a class for it; the pre-change one does not). */
  const found = await page.evaluate(() => {
    const cv = document.getElementById('gtm-canvas');
    for (let e = cv.parentElement.parentElement; e; e = e.parentElement) {
      if (/url\(/.test(getComputedStyle(e).backgroundImage || '')) { e.id = 'gtm-stage-shot'; return true; }
    }
    return false;
  });
  if (!found) { problems.push(`${d.tag}: no element under the client carries the backdrop`); }
  else await page.locator('#gtm-stage-shot').screenshot({ path: `${OUT}stage-${PHASE}-${d.tag}.png` });
  await page.evaluate(() => { const e = document.getElementById('gtm-stage-shot'); if (e) e.removeAttribute('id'); });
  await page.screenshot({ path: `${OUT}page-${PHASE}-${d.tag}.png` });
  await page.close();
}

await browser.close();
if (problems.length) {
  console.error('CONSOLE / PAGE ERRORS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`${PHASE} stage shots written to ${OUT}`);
