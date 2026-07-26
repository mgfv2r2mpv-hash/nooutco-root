/* Rulings 2 + 3 — what the cart shows at each stage of the spots step.
 *
 * Walks the spots step stage by stage and prints, for each: the tools left on
 * the Skincare shelf, its header mark, and whether the shelf is settled and
 * whether its header can still be opened.
 *
 * Runs in the STAGED routine, which is where a shelf can settle and so where
 * ruling 3's ✓ record row appears. That also means later stations are still
 * locked by the task-analysis gate and simply absent from the cart, so this
 * probe says nothing about the 67 free-but-live tools — for those, run
 * `_probe-glam-turn-sweep.mjs`, which sweeps the whole catalogue with every
 * tool unlocked.
 *
 * Usage: node tests/_probe-glam-dead-gone.mjs   (server on :8788)
 */
import { chromium } from '@playwright/test';

const painted = () => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:8788/glam-team-makeover/');
await page.waitForFunction(() => !!window.GlamTT);
await page.getByTitle('Show / hide setup').click();
await page.getByLabel('Turns', { exact: true }).selectOption('10');
await page.getByRole('button', { name: /^▶ Play/ }).click();
await page.getByRole('button', { name: /Go —/ }).click();
await page.waitForFunction(painted, undefined, { timeout: 20000 });

const out = await page.evaluate(async () => {
  const host = document.getElementById('gtm-canvas');
  let f = host[Object.keys(host).find((k) => k.startsWith('__reactFiber$'))];
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  const L = f.stateNode.logic;
  const set = (fn) => new Promise((r) => L.setState((s) => fn(JSON.parse(JSON.stringify(s.ed))), r));
  const shelf = (label) => {
    const g = (L.renderVals().palette || []).find((x) => x.label === label);
    return g ? { mark: g.mark, settled: !!g.settled, disabled: !!g.headDisabled, tools: g.options.map((o) => o.title) } : null;
  };
  const stages = [];
  const at = (name) => stages.push({ name, skincare: shelf('Skincare') });

  at('bare');
  await set((ed) => ({ ed: (ed.cov.wash = 1, ed.done.wash = true, ed.cov.moist = 1, ed.done.moist = true, ed) }));
  at('washed + moisturized');
  await set((ed) => ({ ed: (ed.pimples = [1, 1, 1], ed) }));
  at('every spot patched (patch is dead)');
  await set((ed) => ({ ed: (ed.pimples = [2, 2, 1], ed) }));
  at('two concealed, one to go');
  await set((ed) => ({ ed: (ed.pimples = [2, 2, 2], ed) }));
  at('every spot clear (both dead)');

  const pal = L.renderVals().palette || [];
  return { stages, shelves: pal.map((g) => `${g.label}:${g.options.length}${g.settled ? ' ✓' : ''}`) };
});

for (const s of out.stages) {
  const k = s.skincare;
  console.log(`\n${s.name}`);
  console.log(k ? `   Skincare  mark="${k.mark}"  settled=${k.settled}  headerDisabled=${k.disabled}  tools=[${k.tools.join(', ')}]`
                : '   Skincare  — shelf not rendered at all');
}
console.log('\nshelves still rendered (label:tools-left):', out.shelves.join(' | '));
console.log('console errors:', errs.length ? errs : 'none');
await browser.close();
