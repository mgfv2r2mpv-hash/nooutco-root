/* Screenshot pass for the refresh's salon dressing + choice echo (R5).
   Not a spec — run with `node tests/_shots-salon-theme.mjs` against a server on
   :8788. Photographs the dressed play surface at the three device widths §3.9
   names, plus a crop of the styling trolley and a crop of the echo chip over the
   vanity. Fails loudly on any console error.

   REDUCED MOTION, deliberately: the echo chip's keyframe ENDS at opacity 0
   (it is a moment, not a status line), so Playwright's `animations:'disabled'`
   — which snaps every animation to its end state — photographs it as blank.
   Emulating reduced motion drops the animation entirely, leaving the chip at its
   resting style, which is the frame worth putting in the report. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const OUT = new URL('../../../docs/eval/shots/glam-refresh/', import.meta.url).pathname;
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
  // the child's own route in, so the shot is of the surface a child reaches
  await page.getByRole('button', { name: /Start Playing/ }).click();
  await page.getByRole('button', { name: /Skip ahead/ }).click();
  await page.getByRole('button', { name: /Open the salon/ }).click();
  await page.waitForFunction(PAINTED, undefined, { timeout: 30000 });
  await page.getByRole('button', { name: /Go —/ }).click();
  return { page, problems };
}

/** Arm a tap tool and land it, leaving the echo chip up. */
async function echo(page, label) {
  await page.getByTitle(label, { exact: true }).first().click();
  await page.locator('div[style*="gtm-target"]').first().click();
  await page.locator('[style*="gtm-mirror-"]').waitFor();
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];

for (const d of DEVICES) {
  const { page, problems: p } = await open(browser, d);
  problems.push(...p);

  await page.screenshot({ animations: 'disabled', path: `${OUT}salon-dressed-${d.tag}.png` });

  // the echo, on the surface it belongs to
  await echo(page, 'Shape brows');
  await page.screenshot({ animations: 'disabled', path: `${OUT}salon-echo-${d.tag}.png` });

  if (d.tag === 'desktop') {
    const stage = page.locator('#gtm-canvas').locator('xpath=../..');
    await stage.screenshot({ animations: 'disabled', path: `${OUT}salon-echo-closeup.png` });
    const trolley = page.locator('.gtm-scroll').filter({ hasText: 'Styling trolley' }).first();
    await trolley.screenshot({ animations: 'disabled', path: `${OUT}salon-trolley.png` });
  }
  await page.close();
}

await browser.close();
if (problems.length) {
  console.error('CONSOLE / PAGE ERRORS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`shots written to ${OUT}`);
