/* Screenshot pass for the THIRD-PASS RAIL CORRECTION (maintainer's ruling 3 —
   the two-line rail becomes a single-line stack). Not a spec. Run against a
   hash-verified :8788:

     git show fed4e2be:apps/games/glam-team-makeover/index.html \
       > apps/games/glam-team-makeover/_before-rail.html
     PHASE=before PAGE=/glam-team-makeover/_before-rail.html node tests/_shots-glam-tune3-rail.mjs
     PHASE=after  node tests/_shots-glam-tune3-rail.mjs
     rm apps/games/glam-team-makeover/_before-rail.html

   Same "previous commit's file, same directory" trick the earlier passes used,
   so `../tailwind.css`, `vendor/` and `assets/` resolve identically and only the
   renderer differs. Prefix is `rail…` so the Finding-B `turn…` shots the report
   already cites are not overwritten.

   Per device (1280×860 / 834×1112 / 390×844):

     · rail-<phase>-<device>.png       — the rail alone, cropped to its own box,
                                         so the before/after heights are read
                                         against each other and nothing else
     · railstage-<phase>-<device>.png  — the stage panel, so the rail is read in
                                         the composition it belongs to

   Plus, phone only:

     · railtrolley-<phase>-phone.png   — the viewport with the trolley scrolled
                                         to its end, which is the AC-12 case the
                                         sticky panel exists for: whose-turn and
                                         actions-left must still be on screen.

   And, desktop only, the three states the rail has to read correctly in:

     · railstate-<phase>-ready.png / -mine.png / -theirs.png

   The client is m4. `MID=1` plays four tools first, so the rail can be read
   against a part-spent meter rather than a full one. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const PHASE = process.env.PHASE || 'after';
const PAGE = process.env.PAGE || '/glam-team-makeover/';
const MID = process.env.MID === '1';
const OUT = new URL('../../../docs/eval/shots/glam-tune3/', import.meta.url).pathname;
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
  { tag: 'phone', width: 390, height: 844 },
];

const painted = () => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
};

/* Tag the rail and the stage panel by what they ARE on screen, not by class, so
   the same rule finds them in both renderers AND in every state — including
   `ready`, where nothing has been spent yet so the rail carries no meter to
   pick out. The panel is the ancestor of the client canvas that carries the
   backdrop art; the rail is the first ancestor of the whose-turn label that
   spans that panel (it is painted `left:0;right:0` in both builds). */
const tagParts = () => {
  const deepest = (txt) => [...document.querySelectorAll('*')].filter((e) =>
    (e.textContent || '').trim() === txt &&
    ![...e.children].some((c) => (c.textContent || '').trim() === txt))[0] || null;
  let stageOk = false, panelW = 0;
  const cv = document.getElementById('gtm-canvas');
  if (cv) {
    for (let e = cv.parentElement.parentElement; e; e = e.parentElement) {
      if (/url\(/.test(getComputedStyle(e).backgroundImage || '')) {
        e.id = 'gtm-stage-shot'; stageOk = true; panelW = e.getBoundingClientRect().width; break;
      }
    }
  }
  const turn = deepest('MY TURN') || deepest('THEIR TURN');
  let railOk = false;
  if (turn && panelW) {
    for (let e = turn; e; e = e.parentElement) {
      const r = e.getBoundingClientRect();
      if (r.width >= panelW * 0.9) { e.id = 'gtm-rail-shot'; railOk = true; break; }
    }
  }
  return { railOk, stageOk, railH: railOk ? +document.getElementById('gtm-rail-shot').getBoundingClientRect().height.toFixed(1) : null };
};
const untag = () => ['gtm-rail-shot', 'gtm-stage-shot']
  .forEach((id) => { const e = document.getElementById(id); if (e) e.removeAttribute('id'); });

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];

const boot = async (page) => {
  await page.goto(`http://localhost:8788${PAGE}`);
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Character', { exact: true }).selectOption('m4');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
};

for (const d of DEVICES) {
  const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, reducedMotion: 'reduce' });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${d.tag}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${d.tag}: ${e.message}`));
  await boot(page);
  await page.getByRole('button', { name: /Go —/ }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });
  if (MID) {
    for (const tool of ['Wash', 'Shape brows', 'Eyeliner', 'Mascara']) {
      await page.getByRole('button', { name: new RegExp(`^(✓ )?${tool}$`) }).first().click();
      await page.locator('.gtm-tool, [id="gtm-canvas"]').first().click({ position: { x: 100, y: 100 } }).catch(() => {});
      await page.waitForTimeout(120);
    }
  }
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(200);

  const t = await page.evaluate(tagParts);
  if (!t.railOk) problems.push(`${d.tag}: could not locate the rail from its own words`);
  else {
    await page.locator('#gtm-rail-shot').screenshot({ path: `${OUT}rail-${PHASE}-${d.tag}.png` });
    console.log(`  ${PHASE} ${d.tag}: rail ${t.railH}px`);
  }
  if (!t.stageOk) problems.push(`${d.tag}: no element under the client carries the backdrop`);
  else await page.locator('#gtm-stage-shot').screenshot({ path: `${OUT}railstage-${PHASE}-${d.tag}.png` });
  await page.evaluate(untag);

  if (d.tag === 'phone') {
    /* The AC-12 case: the trolley scrolled to its END, which is what a child
       reaching the last shelf does, and the furthest they get from the stage. */
    await page.evaluate(() => {
      const t2 = document.getElementById('gtm-trolley');
      if (t2) { t2.scrollTop = t2.scrollHeight; t2.scrollIntoView({ block: 'end' }); }
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}railtrolley-${PHASE}-phone.png` });
  }
  await page.close();
}

/* The three states the rail has to read correctly in, at desktop. `ready` is
   before Go; `mine` is a live learner turn; `theirs` is the partner's. */
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`states: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`states: ${e.message}`));
  await boot(page);
  await page.waitForTimeout(500);
  /* The states are shot as the stage panel's bottom STRIP — ledge plus rail —
     rather than as a tight rail crop. At `ready` nothing has been spent, so the
     rail carries no meter and a crop keyed to its contents finds the wrong box;
     a fixed strip off the panel's foot is the same frame in all three states
     and in both builds, which is what makes them comparable. */
  const STRIP = 96;
  const shoot = async (name) => {
    const t = await page.evaluate(tagParts);
    if (!t.stageOk) { problems.push(`state ${name}: no element under the client carries the backdrop`); return; }
    const box = await page.locator('#gtm-stage-shot').boundingBox();
    await page.screenshot({ path: `${OUT}railstate-${PHASE}-${name}.png`,
      clip: { x: box.x, y: box.y + box.height - STRIP, width: box.width, height: STRIP } });
    console.log(`  ${PHASE} state ${name}: rail ${t.railOk ? t.railH + 'px' : '(no meter yet)'}`);
    await page.evaluate(untag);
  };
  await shoot('ready');
  await page.getByRole('button', { name: /Go —/ }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });
  await page.waitForTimeout(400);
  await shoot('mine');
  await page.getByRole('button', { name: /Done — their turn/ }).click();
  await page.waitForTimeout(500);
  await shoot('theirs');
  await page.close();
}

await browser.close();
if (problems.length) {
  console.error('CONSOLE / PAGE ERRORS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`${PHASE} rail shots written to ${OUT}`);
