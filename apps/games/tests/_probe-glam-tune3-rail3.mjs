/* THIRD PASS · rail correction probe 3 - the 390 margin, in all three engines.
   Not a spec.  Run against a hash-verified :8788:

     node tests/_probe-glam-tune3-rail3.mjs

   The single-line rail's whole risk is width at 390, and the margin measured in
   Chromium was 7.7px - small enough that a different text shaper decides it.
   So this asks each engine the same question directly: force the LONGEST line
   the game can show into the live rail and read how far the text overruns the
   box that clips it.  Anything > 0 is a rail that truncates the child's line. */
import { chromium, firefox, webkit } from '@playwright/test';

const ENGINES = [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]];
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
  { tag: 'phone', width: 390, height: 844 },
];
/* Every my-turn string, longest last. `All set…` is the real worst case: it is
   what the line says when the budget is spent, which is also when all 7 pips
   are on screen. */
const LINES = [
  'My turn is ready - tap Go!',
  'My turn - I can do 7 more',
  'My turn - I can do 19 more',
  'My turn - add some things!',
  'All set - now I hand it over!',
];

const painted = () => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
};

for (const [name, engine] of ENGINES) {
  const browser = await engine.launch();
  for (const d of DEVICES) {
    const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, reducedMotion: 'reduce' });
    await page.goto('http://localhost:8788/glam-team-makeover/');
    await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
    await page.getByTitle('Show / hide setup').click();
    await page.getByLabel('Character', { exact: true }).selectOption('m4');
    await page.getByRole('button', { name: /^▶ Play/ }).click();
    await page.getByRole('button', { name: /Go - / }).click();
    await page.waitForFunction(painted, undefined, { timeout: 20000 });
    await page.waitForTimeout(250);

    const out = await page.evaluate(async (LINES) => {
      const band = document.querySelector('.gtm-band');
      const line = band.querySelector('.gtm-band-line');
      /* The runtime wraps interpolations in a span; write to the deepest node so
         the class's own nowrap/ellipsis still governs the box we measure. */
      const sink = line.querySelector('span') || line;
      const was = sink.textContent;
      const rows = [];
      for (const t of LINES) {
        sink.textContent = t;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        rows.push([t, +(line.scrollWidth - line.clientWidth).toFixed(1), +line.getBoundingClientRect().width.toFixed(1)]);
      }
      sink.textContent = was;
      const r = band.getBoundingClientRect();
      return { railH: +r.height.toFixed(1), railW: +r.width.toFixed(1),
               font: getComputedStyle(line).fontSize,
               loaded: document.fonts.check('800 15px "Atkinson Hyperlegible"'), rows };
    }, LINES);

    console.log(`\n--- ${name} · ${d.tag} ${d.width}×${d.height} · rail ${out.railW}×${out.railH} · line ${out.font} · webfont ${out.loaded}`);
    for (const [t, over, boxW] of out.rows) {
      console.log(`    ${over > 0 ? 'CLIP' : '  ok'}  overrun ${String(over).padStart(6)}  box ${String(boxW).padStart(6)}  "${t}"`);
    }
    await page.close();
  }
  await browser.close();
}
