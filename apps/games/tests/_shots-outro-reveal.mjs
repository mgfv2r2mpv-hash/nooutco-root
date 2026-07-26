/* Screenshot pass for the refresh's outro photo booth.
   Not a spec — run with `node tests/_shots-outro-reveal.mjs` against a server on
   :8788. Plays a real short trial through the child's route (Start → the thread
   → the salon), works the look with real tool taps so the two frames have
   something to show, ends the trial and photographs the celebration at the three
   device widths §3.9 names. Fails loudly on any console error. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const OUT = new URL('../../../docs/eval/shots/glam-refresh/', import.meta.url).pathname;
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
  { tag: 'phone', width: 390, height: 844 },
];

/** Evaluate `src` with `L` bound to the component. */
const logic = (page, src) => page.evaluate(({ src }) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  const L = f.stateNode.logic;
  return new Function('L', 'T', src)(L, L._trial);
}, { src });

async function useTool(page, name) {
  const tool = page.getByTitle(name, { exact: true }).first();
  if (!(await tool.count())) return;
  await tool.click();
  const target = page.locator('div[style*="gtm-target"]').first();
  if (await target.count()) await target.click();
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];

for (const d of DEVICES) {
  const page = await browser.newPage({ viewport: { width: d.width, height: d.height } });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${d.tag}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${d.tag}: ${e.message}`));

  await page.goto('http://localhost:8788/glam-team-makeover/');
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);

  // The BT's route in, so the routine is ungated and one turn can touch every
  // station — the booth is what is being photographed, not the staging.
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Routine', { exact: true }).selectOption('free');
  await page.getByLabel('Turns', { exact: true }).selectOption('4');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go —/ }).waitFor();

  // Wait out every decode: until they land, the compositor is still assembling
  // the face and the before frame would photograph a half-built doll.
  await page.waitForFunction(() => {
    let f = null;
    for (const el of document.querySelectorAll('*')) {
      const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      if (k) { f = el[k]; break; }
    }
    while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
    const L = f && f.stateNode.logic;
    if (!L || !L._skinPool(L.state.model) || !L._shot()) return false;
    const c = L._imgc || {};
    const keys = Object.keys(c);
    return keys.length > 0 && keys.every((k) => c[k].ok);
  }, undefined, { timeout: 25000 });

  await page.getByRole('button', { name: /Go —/ }).click();
  for (const t of ['Berry', 'Lips red', 'Shadow violet', 'Rose', 'Sapphire', 'Eyeliner']) {
    await useTool(page, t);
  }
  await logic(page, 'L.endTrial(); return null;');
  await page.getByText('Glam team photo booth').waitFor();
  await page.screenshot({ animations: 'disabled', path: `${OUT}outro-reveal-${d.tag}.png` });

  if (d.tag === 'desktop') {
    await page.locator('#gtm-shot-before').locator('xpath=../../..')
      .screenshot({ animations: 'disabled', path: `${OUT}outro-reveal-booth.png` });
  }
  await page.close();
}

await browser.close();
if (problems.length) { console.error('CONSOLE ERRORS:\n' + problems.join('\n')); process.exit(1); }
console.log('shots written to ' + OUT);
