/* Screenshot pass for TUNING fix 3 - the styling trolley's vertical flow.
   Not a spec. Run against a server on :8788:

     git show HEAD:apps/games/glam-team-makeover/index.html \
       > apps/games/glam-team-makeover/_before-tune.html
     PHASE=before PAGE=/glam-team-makeover/_before-tune.html node tests/_shots-glam-tune-trolley.mjs
     PHASE=after  node tests/_shots-glam-tune-trolley.mjs
     rm apps/games/glam-team-makeover/_before-tune.html

   Same trick as the thread pass: the `before` page is the previous commit's file
   dropped into the SAME directory, so `../tailwind.css`, `vendor/` and `assets/`
   resolve identically and only the thing under test differs.

   Three moments are photographed, each on the STAGED routine (the default, and
   the routine the complaint is about):

     · trolley-open - the cart as the appointment starts
     · trolley-mid - a few steps in: skincare taken, most of makeup taken
     · trolley-reopen - a settled shelf asked back open

   `Math.random` is seeded so both passes draw the same client, and the mid/reopen
   states are written straight to `ed` so the two passes are photographed at
   exactly the same point of the appointment rather than at whatever point a
   replayed drag happened to reach. Reduced motion settles the arrival keyframes. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const PHASE = process.env.PHASE || 'after';
const PAGE = process.env.PAGE || '/glam-team-makeover/';
const OUT = new URL('../../../docs/eval/shots/glam-tune/', import.meta.url).pathname;
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
  { tag: 'phone', width: 390, height: 844 },
];

/** Walk the React fiber to the component and run `src` with `L` bound to it. */
const logic = (page, src) => page.evaluate(({ src }) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  return new Function('L', src)(f.stateNode.logic);
}, { src });

const THROUGH_MAKEUP = `
  return new Promise((r) => L.setState((s) => {
    const ed = JSON.parse(JSON.stringify(s.ed));
    ed.pimples = [2, 2, 2];
    for (const k of ['wash','moist','contour','blush','hl','shadow','liner','mascara']) ed.done[k] = true;
    ed.cov.wash = 1; ed.cov.moist = 1; ed.cov.contour = 1;
    ed.cov.blush = 1; ed.col.blush = '#f28ba0';
    ed.cov.hl = 1;
    ed.cov.shadow = 1; ed.col.shadow = '#a06cc9';
    ed.cov.liner = 1; ed.cov.mascara = 1;
    return { ed };
  }, r));`;

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];

for (const d of DEVICES) {
  const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, reducedMotion: 'reduce' });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${d.tag}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${d.tag}: ${e.message}`));
  await page.addInitScript(() => {
    let s = 20260725;
    Math.random = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  });
  await page.goto(`http://localhost:8788${PAGE}`);
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);

  // The BT's route in: ⚙ → staged routine → ▶ Play → Go.
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Routine', { exact: true }).selectOption('on');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go - / }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}trolley-open-${PHASE}-${d.tag}.png` });

  await logic(page, THROUGH_MAKEUP);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}trolley-mid-${PHASE}-${d.tag}.png` });

  /* Ask a settled shelf back. Before the tuning pass there is no header to tap,
     so the shot is simply the same mid state - which is the point of the pair. */
  const head = page.locator('[data-shelf="Eyes"] button[aria-expanded]');
  if (await head.count()) {
    await head.click();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: `${OUT}trolley-reopen-${PHASE}-${d.tag}.png` });

  await page.close();
}

await browser.close();
if (problems.length) {
  console.error('CONSOLE / PAGE ERRORS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`${PHASE} trolley shots written to ${OUT}`);
