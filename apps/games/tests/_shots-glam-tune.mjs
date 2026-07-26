/* Screenshot pass for the TUNING pass (maintainer-reported fixes).
   Not a spec — run with `PHASE=before node tests/_shots-glam-tune.mjs` (and again
   with `PHASE=after`) against a server on :8788. Writes into
   docs/eval/shots/glam-tune/ with the phase in the filename so the report can
   show a real before → after pair for every fix.

   REDUCED MOTION, deliberately — same reason as _shots-salon-theme.mjs: the echo
   chip's keyframe ENDS at opacity 0, so Playwright's `animations:'disabled'`
   (which snaps to the end state) photographs it blank. Emulating reduced motion
   drops the animation and leaves the resting style, which is the frame worth
   putting in the report. It also settles the mirror-glow's opacity transition
   instantly, so the flare is photographed at full strength — the worst case,
   which is exactly what "the flare is too much" is about. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const PHASE = process.env.PHASE || 'before';
const OUT = new URL('../../../docs/eval/shots/glam-tune/', import.meta.url).pathname;
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
  { tag: 'phone', width: 390, height: 844 },
];

/** Every source image decoded AND this model's hair masks resolved. */
const PAINTED = () => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  const L = f && f.stateNode.logic;
  if (!L || !L._skinPool(L.state.model)) return false;
  const c = L._imgc || {};
  const keys = Object.keys(c);
  return keys.length > 0 && keys.every((k) => c[k].ok);
};

async function open(browser, d) {
  const page = await browser.newPage({
    viewport: { width: d.width, height: d.height },
    reducedMotion: 'reduce',
  });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${d.tag}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${d.tag}: ${e.message}`));
  await page.goto('http://localhost:8788/glam-team-makeover/');
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  return { page, problems };
}

/* The client is drawn at random, so an un-pinned run would photograph a
   different face on the before pass than on the after pass and the pair would be
   unreadable. The BT's character lock — the ONE surface that may still choose a
   model — pins it, which is also a live demonstration that the lock works. */
async function intoSalon(page, model) {
  await page.getByRole('button', { name: /Session setup/ }).click();
  await page.getByLabel('Character', { exact: true }).selectOption(model);
  await page.locator('header').getByTitle('Show / hide setup').click();   // collapse it again
  await page.getByRole('button', { name: /^Start/ }).click();
  await page.getByRole('button', { name: /Skip ahead/ }).click();
  await page.getByRole('button', { name: /Open the salon/ }).click();
  await page.waitForFunction(PAINTED, undefined, { timeout: 30000 });
  await page.getByRole('button', { name: /Go —/ }).click();
}

/** Arm a tap tool and land it, leaving the echo chip + mirror glow up. */
async function echo(page, label) {
  await page.getByTitle(label, { exact: true }).first().click();
  await page.locator('div[style*="gtm-target"]').first().click();
  await page.locator('[style*="gtm-mirror-"]').waitFor();
}

const stageOf = (page) => page.locator('#gtm-canvas').locator('xpath=../..');

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];

for (const d of DEVICES) {
  const { page, problems: p } = await open(browser, d);
  problems.push(...p);
  await intoSalon(page, 'm3');

  /* FIX 1 — the play surface must show no model picker. Whole-surface shot so the
     top-right corner the chips used to occupy is in frame. */
  await page.screenshot({ animations: 'disabled', path: `${OUT}surface-no-model-chips-${PHASE}-${d.tag}.png` });

  /* FIX 5 — the flare. Photographed on the stage crop at full strength. */
  await echo(page, 'Shape brows');
  await stageOf(page).screenshot({ animations: 'disabled', path: `${OUT}action-flare-${PHASE}-${d.tag}.png` });

  await page.close();
}

await browser.close();
if (problems.length) {
  console.error('CONSOLE / PAGE ERRORS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`${PHASE} shots written to ${OUT}`);
