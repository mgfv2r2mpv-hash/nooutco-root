/* Screenshot pass for THIRD-PASS Finding B (the turn indicator moving into the
   stage's sandy counter rail). Not a spec. Run against a hash-verified :8788:

     git show 2f45dfda:apps/games/glam-team-makeover/index.html \
       > apps/games/glam-team-makeover/_before-tune3.html
     PHASE=before PAGE=/glam-team-makeover/_before-tune3.html node tests/_shots-glam-tune3-turn.mjs
     PHASE=after  node tests/_shots-glam-tune3-turn.mjs
     rm apps/games/glam-team-makeover/_before-tune3.html

   Same "previous commit's file, same directory" trick the earlier passes used,
   so `../tailwind.css`, `vendor/` and `assets/` resolve identically and only the
   renderer differs.

   Per device (1280×860 / 834×1112 / 390×844):

     · turn-<phase>-<device>.png        — the whole viewport at the top of the
                                          page, which is where the card's
                                          vertical footprint is read
     · turnband-<phase>-<device>.png    — the stage panel alone, so the rail is
                                          read against the composition it
                                          belongs to

   Plus, phone only:

     · turnscroll-<phase>-phone.png     — the viewport scrolled all the way to
                                          the bottom of the trolley, which is
                                          where a stage-anchored indicator is
                                          most likely to leave the screen.

   The client is m4 and the look is left bare: this pass is about the furniture.
   `MID=1` instead plays four tools first, so the rail can be read against a
   partly-made-up face and a part-spent meter. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const PHASE = process.env.PHASE || 'after';
const PAGE = process.env.PAGE || '/glam-team-makeover/';
const MID = process.env.MID === '1';
const OUT = new URL('../../../docs/eval/shots/glam-tune3/', import.meta.url).pathname;
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
  await page.getByRole('button', { name: /Go —/ }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });
  if (MID) {
    for (const tool of ['Wash', 'Shape brows', 'Eyeliner', 'Mascara']) {
      await page.getByRole('button', { name: new RegExp(`^(✓ )?${tool}$`) }).first().click();
      await page.locator('.gtm-tool, [id="gtm-canvas"]').first().click({ position: { x: 100, y: 100 } }).catch(() => {});
      await page.waitForTimeout(120);
    }
  }
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}turn-${PHASE}-${d.tag}.png` });

  /* The stage panel is found by the art it carries, so the same rule locates it
     in both phases (the pre-change file has the same `.gtm-stage` class, but
     matching on the backdrop keeps this honest if that ever moves). */
  const found = await page.evaluate(() => {
    const cv = document.getElementById('gtm-canvas');
    for (let e = cv.parentElement.parentElement; e; e = e.parentElement) {
      if (/url\(/.test(getComputedStyle(e).backgroundImage || '')) { e.id = 'gtm-stage-shot'; return true; }
    }
    return false;
  });
  if (!found) problems.push(`${d.tag}: no element under the client carries the backdrop`);
  else await page.locator('#gtm-stage-shot').screenshot({ path: `${OUT}turnband-${PHASE}-${d.tag}.png` });
  await page.evaluate(() => { const e = document.getElementById('gtm-stage-shot'); if (e) e.removeAttribute('id'); });

  if (d.tag === 'phone') {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}turnscroll-${PHASE}-phone.png` });
  }
  await page.close();
}

await browser.close();
if (problems.length) {
  console.error('CONSOLE / PAGE ERRORS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`${PHASE} turn-indicator shots written to ${OUT}`);
