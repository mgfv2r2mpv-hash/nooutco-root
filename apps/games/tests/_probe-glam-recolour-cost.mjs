/* Ruling 1b - measure the per-turn cost of changing a colour 2nd..Nth time.
 *
 * The maintainer names five types: shadow, blush, lips, hair, clothes. For each,
 * inside ONE turn, apply shade A, then B, then C, and report:
 *   key - the charge key each of the three resolves to (`_optKey`)
 *   actions - turn actions spent by each of the three changes
 *   strokes - pointer strokes each change needed to complete
 *
 * 1b holds for a type when the three changes cost 1 + 0 + 0.
 * 1a holds when the 2nd and 3rd changes need the SAME number of strokes as the
 * first (a fresh drag) rather than one.
 *
 * Usage: node tests/_probe-glam-recolour-cost.mjs   (server on :8788)
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
await page.getByLabel('Routine', { exact: true }).selectOption('free');
await page.getByLabel('Turns', { exact: true }).selectOption('10');
await page.getByRole('button', { name: /^▶ Play/ }).click();
await page.getByRole('button', { name: /Go - / }).click();
await page.waitForFunction(painted, undefined, { timeout: 20000 });

const rows = await page.evaluate(async () => {
  const host = document.getElementById('gtm-canvas');
  let f = host[Object.keys(host).find((k) => k.startsWith('__reactFiber$'))];
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  const L = f.stateNode.logic;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const opts = L.cfg().cats.flatMap((g) => g.options);
  const byId = (id) => opts.find((o) => o.id === id);

  /* Apply one option the way the surface does, and count the strokes it took.
     A paint tool is armed then stroked until it disarms (coverage complete) or
     the stroke ceiling is hit; everything else applies in one go. */
  const applyOne = async (opt) => {
    L.arm(opt);
    await tick();
    if (opt.mech !== 'paint') { if (L.state.armed) { L.tapApply(); await tick(); } return 1; }
    let n = 0;
    while (L.state.armed && n < 40) { L.paintStep(); await tick(); n++; }
    return n;
  };

  const TYPES = [
    { type: 'shadow', ids: ['es1', 'es4', 'es5'] },
    { type: 'blush', ids: ['bl1', 'bl4', 'bl6'] },
    { type: 'lips', ids: ['lp1', 'lp3', 'lp5'] },
    { type: 'hair', ids: ['hc_blonde', 'hc_copper', 'hc_berry'] },
    { type: 'clothes', ids: ['of1', 'of3', 'of5'] },
  ];

  const out = [];
  for (const { type, ids } of TYPES) {
    // Fresh turn per type so each type is measured on its own budget, and the
    // budget is lifted so the cap can never stand in for "it was free".
    L._trial.turn.actions = 0;
    L._trial.turn.budget = 999;
    L._charged = {};
    const steps = [];
    for (const id of ids) {
      const opt = byId(id);
      const before = L._trial.turn.actions;
      const strokes = await applyOne(opt);
      steps.push({
        id,
        key: L._optKey(opt),
        actions: L._trial.turn.actions - before,
        strokes,
        landed: JSON.parse(JSON.stringify({ col: L.state.ed.col[opt.slot], cov: L.state.ed.cov[opt.slot] })),
      });
    }
    out.push({ type, total: steps.reduce((a, s) => a + s.actions, 0), steps });
  }
  return out;
});

for (const r of rows) {
  console.log(`\n${r.type.padEnd(8)} total actions for three changes: ${r.total}`);
  for (const s of r.steps) {
    console.log(`   ${s.id.padEnd(11)} key=${String(s.key).padEnd(14)} actions=${s.actions}  strokes=${String(s.strokes).padStart(2)}  → col=${s.landed.col} cov=${s.landed.cov}`);
  }
}
console.log('\nconsole errors:', errs.length ? errs : 'none');
await browser.close();
