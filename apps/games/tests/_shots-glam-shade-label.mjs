/* Screenshot pass for turn-exchange Finding C (the paint hitbox claiming a shade
   that was never applied). Not a spec. Run against a hash-verified :8788:

     git show 93dab9be:apps/games/glam-team-makeover/index.html \
       > apps/games/glam-team-makeover/_before-shade.html
     PHASE=before PAGE=/glam-team-makeover/_before-shade.html node tests/_shots-glam-shade-label.mjs
     PHASE=after  node tests/_shots-glam-shade-label.mjs
     rm apps/games/glam-team-makeover/_before-shade.html

   Same "previous commit's file, same directory" trick the earlier passes used,
   so `../tailwind.css`, `vendor/` and `assets/` resolve identically and only the
   renderer differs.

   Photographed, per phase, over the stage (the hitbox floats on the face):

     · shade-<phase>-painted.png  — Blush rose armed again after painting it.
                                    Reads "All done ✓" in BOTH phases, on purpose:
                                    that is the accepted eval §8 fix and this work
                                    must not walk it back.
     · shade-<phase>-switched.png — Blush plum armed instead, never applied. This
                                    is the reported frame: `before` says
                                    "All done ✓" over a shade that has not touched
                                    the face, `after` asks for the work.

   Blush is painted for real by pointer drag; only the shade switch that follows
   is what differs between the two builds. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const PHASE = process.env.PHASE || 'after';
const PAGE = process.env.PAGE || '/glam-team-makeover/';
const OUT = new URL('../../../docs/eval/shots/glam-turn-exchange/', import.meta.url).pathname;

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

const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
page.on('pageerror', (e) => problems.push(e.message));
await page.goto(`http://localhost:8788${PAGE}`);
await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
await page.getByTitle('Show / hide setup').click();
await page.getByLabel('Character', { exact: true }).selectOption('m4');
await page.getByLabel('Routine', { exact: true }).selectOption('free');
await page.getByLabel('Turns', { exact: true }).selectOption('4');
await page.getByRole('button', { name: /^▶ Play/ }).click();
await page.getByRole('button', { name: /Go —/ }).click();
await page.waitForFunction(painted, undefined, { timeout: 20000 });

const target = () => page.locator('div[style*="gtm-target"]').first();

// Paint Blush rose for real — pointer down, drag, up.
await page.getByTitle('Blush rose', { exact: true }).first().click();
const box = await target().boundingBox();
await page.mouse.move(box.x + 10, box.y + box.height / 2);
await page.mouse.down();
for (let i = 1; i <= 14; i++) {
  await page.mouse.move(box.x + 10 + (i * (box.width - 20)) / 14, box.y + box.height / 2);
}
await page.mouse.up();
await page.waitForTimeout(300);

/* The stage is the frame the hitbox lives in — cropping to the hitbox alone
   would lose the face it is making a claim about. */
const stage = page.locator('#gtm-canvas').locator('xpath=ancestor::*[3]').first();
const shot = (await stage.count()) ? stage : page.locator('#gtm-canvas');

await page.getByTitle('Blush rose', { exact: true }).first().click();
await page.waitForTimeout(250);
await shot.screenshot({ path: `${OUT}shade-${PHASE}-painted.png` });

await page.getByTitle('Blush plum', { exact: true }).first().click();
await page.waitForTimeout(250);
await shot.screenshot({ path: `${OUT}shade-${PHASE}-switched.png` });
console.log(`${PHASE} switched-shade hitbox says: ${JSON.stringify(await target().innerText())}`);

await page.close();
await browser.close();
if (problems.length) {
  console.error('CONSOLE / PAGE ERRORS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`${PHASE} shade-label shots written to ${OUT}`);
