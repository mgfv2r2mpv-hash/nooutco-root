/* HAZARD A, settled by identity rather than by statistics.

   `_wash` is shared by the eyeshadow (T4c), the blush (T4d), the contour and the
   highlight. The second pass gave it an opt-in `o.core` so the highlight could
   move its fade inward (U1); the other three must be untouched. Re-measuring
   them with `_probe-glam-face3.mjs` is the wrong instrument for that question —
   `freshEd` seeds the blemishes off `Math.random`, so two runs of the same
   renderer differ by a few percent on the blush and the comparison can only ever
   be "close enough".

   This compares the COMPOSITOR OUTPUT instead: the same model, the same `ed`
   down to a pinned `spotSeed`, rendered by the pre-change file and by the
   current one, then diffed pixel by pixel. Anything but zero is a regression.

   Run against a server on :8788:

     git show HEAD:apps/games/glam-team-makeover/index.html \
       > apps/games/glam-team-makeover/_before-tune2.html
     node tests/_probe-glam-wash-parity.mjs
     rm apps/games/glam-team-makeover/_before-tune2.html */
import { chromium } from '@playwright/test';

const MODELS = ['m2', 'm3', 'm4'];
const BEFORE = process.env.BEFORE || '/glam-team-makeover/_before-tune2.html';
const AFTER = process.env.AFTER || '/glam-team-makeover/';

/* Every tool that goes through `_wash` EXCEPT the highlight, plus a couple of
   neighbours that share the frame, so a change leaking sideways also shows. */
const CASES = [
  ['shadow', { cov: { shadow: 1 }, col: { shadow: '#a06cc9' } }],
  ['blush', { cov: { blush: 1 }, col: { blush: '#f28ba0' } }],
  ['contour', { cov: { contour: 1 } }],
  ['wash+moist', { cov: { wash: 1, moist: 1 } }],
  ['all-but-hl', { cov: { shadow: 1, blush: 1, contour: 1, wash: 1, moist: 1 },
                   col: { shadow: '#a06cc9', blush: '#f28ba0' } }],
];

const logic = (page, src) => page.evaluate(({ src }) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  return new Function('L', src)(f.stateNode.logic);
}, { src });

const GRAB = () => new Promise((res) => {
  const cv = document.getElementById('gtm-canvas'), cx = cv.getContext('2d');
  const snap = () => cx.getImageData(0, 0, cv.width, cv.height);
  const hash = (d) => { let h = 2166136261;
    for (let i = 0; i < d.data.length; i += 997) h = Math.imul(h ^ d.data[i], 16777619) >>> 0;
    return h; };
  let last = null, same = 0, i = 0;
  const tick = () => {
    const d = snap(), h = hash(d);
    if (h === last) same++; else { same = 0; last = h; }
    if (same >= 4 || ++i > 200) return res(Array.from(d.data));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

async function open(browser, path) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`http://localhost:8788${path}`);
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await page.getByTitle('Show / hide setup').click();
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.waitForFunction(() => {
    const c = document.getElementById('gtm-canvas');
    if (!c) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
    return false;
  }, undefined, { timeout: 20000 });
  return { page, problems };
}

/* `spotSeed` is pinned, so the blemishes land on the same three pool spots in
   both files and the diff is the cosmetics alone. */
const SET = (patch) => `
  const p = ${JSON.stringify(patch)};
  return new Promise((r) => L.setState(() => {
    const ed = L.freshEd('person');
    ed.spotSeed = 0.4242;
    if (p.cov) Object.assign(ed.cov, p.cov);
    if (p.col) Object.assign(ed.col, p.col);
    return { ed };
  }, r));`;

const browser = await chromium.launch();
const A = await open(browser, BEFORE);
const B = await open(browser, AFTER);
let bad = 0;

for (const m of MODELS) {
  for (const pg of [A.page, B.page]) {
    await logic(pg, `return (async () => {
      await new Promise((r) => L.setState({ model: '${m}', ed: L.freshEd('person') }, r));
      for (let i = 0; i < 80 && !L._skinPool('${m}'); i++) await new Promise((r) => setTimeout(r, 100));
    })();`);
  }
  for (const [name, patch] of CASES) {
    await logic(A.page, SET(patch)); await logic(B.page, SET(patch));
    const [a, b] = await Promise.all([A.page.evaluate(GRAB), B.page.evaluate(GRAB)]);
    let n = 0, worst = 0;
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - b[i]); if (d) { n++; if (d > worst) worst = d; } }
    if (n) bad++;
    console.log(`${m} ${name.padEnd(11)} differing bytes=${n} worst=${worst}  ${n ? 'CHANGED' : 'identical'}`);
  }
}

await browser.close();
const problems = [...A.problems, ...B.problems];
if (problems.length) { console.error('CONSOLE:\n' + problems.join('\n')); process.exit(1); }
if (bad) { console.error(`\n${bad} case(s) changed — the shared wash regressed.`); process.exit(1); }
console.log('\nAll cases pixel-identical: the shared _wash is unchanged for every non-highlight caller.');
