/* THIRD PASS · rail correction probe 1 - the footprint numbers, for the report's
   table next to W2.  Not a spec.  Run against a hash-verified :8788:

     PAGE=/glam-team-makeover/_before-rail.html node tests/_probe-glam-tune3-rail1.mjs
     node tests/_probe-glam-tune3-rail1.mjs

   Per device: the rail's own height, the stage panel it is spent out of, how
   much vertical room still sits ABOVE the stage (W2's number, which this
   correction must not disturb), and the whole document's height - the phone is
   the only width that scrolls, so that last one is what a child feels. */
import { chromium } from '@playwright/test';

const PAGE = process.env.PAGE || '/glam-team-makeover/';
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

const browser = await chromium.launch();
for (const d of DEVICES) {
  const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, reducedMotion: 'reduce' });
  await page.goto(`http://localhost:8788${PAGE}`);
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Character', { exact: true }).selectOption('m4');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go - / }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });
  /* Back to the top before measuring: on a phone the panel is `position:sticky`,
     so "how much sits above the stage" is only the layout number while the page
     is unscrolled - read mid-scroll it reports the scroll offset instead. */
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);

  const out = await page.evaluate(() => {
    const band = document.querySelector('.gtm-band');
    const cv = document.getElementById('gtm-canvas');
    let panel = null;
    for (let e = cv.parentElement.parentElement; e; e = e.parentElement) {
      if (/url\(/.test(getComputedStyle(e).backgroundImage || '')) { panel = e; break; }
    }
    const main = document.querySelector('main.gtm-room');
    const mcs = main && getComputedStyle(main);
    const pr = panel.getBoundingClientRect();
    return {
      railH: +band.getBoundingClientRect().height.toFixed(1),
      panelH: +pr.height.toFixed(1), panelW: +pr.width.toFixed(1),
      canvasH: +cv.getBoundingClientRect().height.toFixed(1),
      aboveStage: main ? +(pr.top - (main.getBoundingClientRect().top + parseFloat(mcs.paddingTop || 0))).toFixed(1) : null,
      docH: Math.round(document.documentElement.scrollHeight),
      scrollable: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
    };
  });
  console.log(`${d.tag.padEnd(8)} ${d.width}×${d.height}  rail ${String(out.railH).padStart(5)}px  `
    + `panel ${out.panelW}×${out.panelH}  client canvas ${out.canvasH}  `
    + `above-stage ${out.aboveStage}  doc ${out.docH} (scrollable ${out.scrollable})`);
  await page.close();
}
await browser.close();
