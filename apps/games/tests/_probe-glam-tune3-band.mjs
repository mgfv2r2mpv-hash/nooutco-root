/* Finding B probe — how much room is there at the foot of the stage, and what
   of the client art lives in it?  Not a spec.  Run against a hash-verified
   :8788:

     PAGE=/glam-team-makeover/ node tests/_probe-glam-tune3-band.mjs

   Per device it prints the stage panel's rect, the client canvas's rect inside
   it, and — read off the canvas's own pixels — the topmost row of the SHIRT
   (the first opaque row below the neck whose colour is the garment tint), so a
   band height can be chosen against the F-10 rule that the ledge must not bury
   a tool the child just used. */
import { chromium } from '@playwright/test';

const PAGE = process.env.PAGE || '/glam-team-makeover/';
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
  { tag: 'phone', width: 390, height: 844 },
];
const MODELS = (process.env.MODELS || 'm2,m3,m4').split(',');

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
  for (const model of MODELS) {
    const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, reducedMotion: 'reduce' });
    await page.goto(`http://localhost:8788${PAGE}`);
    await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
    await page.getByTitle('Show / hide setup').click();
    await page.getByLabel('Character', { exact: true }).selectOption(model);
    await page.getByRole('button', { name: /^▶ Play/ }).click();
    await page.getByRole('button', { name: /Go —/ }).click();
    await page.waitForFunction(painted, undefined, { timeout: 20000 });
    await page.waitForTimeout(300);
    const out = await page.evaluate(() => {
      const R = (e) => {
        const r = e.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const stage = document.querySelector('.gtm-stage');
      const cv = document.getElementById('gtm-canvas');
      const g = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      // topmost opaque row of the bottom-most contiguous art block = the shirt's
      // shoulder line; walk up from the canvas bottom while the row stays wide.
      let shirtTop = cv.height;
      for (let y = cv.height - 1; y >= 0; y--) {
        let n = 0;
        for (let x = 0; x < cv.width; x++) if (g[(y * cv.width + x) * 4 + 3] > 40) n++;
        if (n < cv.width * 0.35) break;
        shirtTop = y;
      }
      const sr = stage.getBoundingClientRect(), cr = cv.getBoundingClientRect();
      return {
        stage: R(stage),
        canvas: R(cv),
        // how many CSS px of the stage's bottom edge the shirt block occupies
        shirtTopFromStageBottom: Math.round(sr.bottom - (cr.top + (shirtTop / cv.height) * cr.height)),
        canvasBottomFromStageBottom: Math.round(sr.bottom - cr.bottom),
      };
    });
    console.log(`${d.tag} ${model}: ${JSON.stringify(out)}`);
    await page.close();
  }
}
await browser.close();
