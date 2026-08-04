/* Screenshot pass for the refresh's station kit.
   Not a spec - run with `node tests/_shots-station-kit.mjs` against a server on
   :8788. Photographs the palette with its full stock on show (Routine = free, so
   nothing is phase-gated out of the picture) at the three device widths §3.9
   names, plus a close crop of the deepest shelf and one shot of the STAGED first
   turn so the "hidden, not dimmed" gating is on the record next to it. Fails
   loudly on any console error. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const OUT = new URL('../../../docs/eval/shots/glam-refresh/', import.meta.url).pathname;
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
  { tag: 'phone', width: 390, height: 844 },
];

/** Every source image decoded AND this model's hair masks resolved - before that
    the compositor is still assembling the face. */
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

async function open(browser, d, routine) {
  const page = await browser.newPage({ viewport: { width: d.width, height: d.height } });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${d.tag}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${d.tag}: ${e.message}`));
  await page.goto('http://localhost:8788/glam-team-makeover/');
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Routine', { exact: true }).selectOption(routine);
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go - / }).waitFor();
  await page.waitForFunction(PAINTED, undefined, { timeout: 25000 });
  await page.getByRole('button', { name: /Go - / }).click();
  return { page, problems };
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];

for (const d of DEVICES) {
  // Free play: the whole stock on one shelf-stack, which is the point of the shot.
  const free = await open(browser, d, 'free');
  problems.push(...free.problems);
  await free.page.screenshot({ animations: 'disabled', path: `${OUT}station-kit-${d.tag}.png` });

  if (d.tag === 'desktop') {
    // The palette column on its own, scrolled to the deepest shelf.
    const col = free.page.locator('.gtm-scroll').first();
    await col.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await col.screenshot({ animations: 'disabled', path: `${OUT}station-kit-shelves.png` });
  }
  await free.page.close();

  // …and the staged first turn, where every later station is absent rather than
  // greyed out. Desktop only - it is a gating record, not a layout one.
  if (d.tag === 'desktop') {
    const staged = await open(browser, d, 'on');
    problems.push(...staged.problems);
    await staged.page.screenshot({ animations: 'disabled', path: `${OUT}station-kit-staged-turn1.png` });
    await staged.page.close();
  }
}

await browser.close();
if (problems.length) { console.error('CONSOLE ERRORS:\n' + problems.join('\n')); process.exit(1); }
console.log('shots written to ' + OUT);
