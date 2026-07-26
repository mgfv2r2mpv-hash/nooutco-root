/* Screenshot pass for the turn-exchange Finding A (a finished tool going, and
   staying, disabled). Not a spec. Run against a hash-verified :8788:

     git show 95ba6101:apps/games/glam-team-makeover/index.html \
       > apps/games/glam-team-makeover/_before-dead.html
     PHASE=before PAGE=/glam-team-makeover/_before-dead.html node tests/_shots-glam-dead-tool.mjs
     PHASE=after  node tests/_shots-glam-dead-tool.mjs
     rm apps/games/glam-team-makeover/_before-dead.html

   Same "previous commit's file, same directory" trick the earlier passes used,
   so `../tailwind.css`, `vendor/` and `assets/` resolve identically and only the
   renderer differs.

   The state photographed is the one the maintainer reported: every spot patched,
   two of three concealed, the turn handed over. Per phase:

     · deadtool-<phase>-<turn>.png   — the Skincare shelf of the trolley, on my
                                       turn and again on the partner's, which is
                                       where `Treat spots` has to read as
                                       finished rather than as still-offered.
     · deadflicker-<phase>.png       — the same shelf immediately after clicking
                                       `Treat spots`. On the pre-change build
                                       this is the frame the ✓ vanished in.

   `ed` is seeded rather than played because what is under test is the CART's
   response to a state; the route there is driven for real in
   tests/glam-turn-exchange.spec.js. */
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

/** Reach the component instance the way the specs do (fiber walk). */
const withLogic = (src) => `(() => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  const L = f.stateNode.logic;
  ${src}
})()`;

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
await page.getByLabel('Routine', { exact: true }).selectOption('on');
await page.getByLabel('Turns', { exact: true }).selectOption('4');
await page.getByRole('button', { name: /^▶ Play/ }).click();
await page.getByRole('button', { name: /Go —/ }).click();
await page.waitForFunction(painted, undefined, { timeout: 20000 });

// The reported state: washed, moisturized, all three spots patched, two concealed.
await page.evaluate(withLogic(`
  return new Promise((r) => L.setState((s) => {
    const ed = JSON.parse(JSON.stringify(s.ed));
    ed.done.wash = true; ed.done.moist = true;
    ed.cov.wash = 1; ed.cov.moist = 1;
    ed.pimples = [2, 2, 1];
    return { ed };
  }, r));`));
await page.waitForTimeout(400);

/* The Skincare shelf is found by its own `data-shelf`, which both phases carry. */
const shelf = page.locator('[data-shelf="Skincare"]');
if (!(await shelf.count())) problems.push('no Skincare shelf on the trolley');
else {
  await shelf.screenshot({ path: `${OUT}deadtool-${PHASE}-mine.png` });

  // The flicker frame: click the finished tool and photograph what the shelf does.
  await page.getByTitle('Treat spots', { exact: true }).first().click({ force: true });
  await page.waitForTimeout(250);
  await shelf.screenshot({ path: `${OUT}deadflicker-${PHASE}.png` });

  // And the same shelf after the exchange — the state the partner inherits.
  await page.getByRole('button', { name: /Done — their turn/ }).click();
  await page.waitForTimeout(400);
  await shelf.screenshot({ path: `${OUT}deadtool-${PHASE}-theirs.png` });
}

await page.close();
await browser.close();
if (problems.length) {
  console.error('CONSOLE / PAGE ERRORS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`${PHASE} dead-tool shots written to ${OUT}`);
