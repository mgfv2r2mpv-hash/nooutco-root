/* Finding B — dump `_browClean`'s own overlay, and its chosen skin tone. */
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = new URL('../../../.probe-browtail/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });
const MODELS = ['m2', 'm3', 'm4'];

const painted = () => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
};

const browser = await chromium.launch();
for (const m of MODELS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
  await page.goto('http://localhost:8788/glam-team-makeover/');
  await page.waitForFunction(() => !!window.GlamTT);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Character', { exact: true }).selectOption(m);
  await page.getByLabel('Routine', { exact: true }).selectOption('free');
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.getByRole('button', { name: /Go —/ }).click();
  await page.waitForFunction(painted, undefined, { timeout: 20000 });

  const res = await page.evaluate(() => {
    const host = document.getElementById('gtm-canvas');
    let f = host[Object.keys(host).find(k => k.startsWith('__reactFiber$'))];
    while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
    if (!f) return { err: 'no component' };
    const comp = f.stateNode.logic;
    if (!comp._browClean) return { err: 'no _browClean on logic: ' + Object.getOwnPropertyNames(Object.getPrototypeOf(comp)).slice(0,12).join(',') };
    const E = comp.genEntry();
    const cv = comp._browClean(E);
    if (!cv) return { err: 'null overlay' };
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, tone = null;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) {
      n++; const p = i / 4, x = p % cv.width, y = (p / cv.width) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (!tone) tone = [d[i], d[i + 1], d[i + 2]];
    }
    const o = document.createElement('canvas'); o.width = cv.width; o.height = cv.height;
    const x = o.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, o.width, o.height);
    x.drawImage(cv, 0, 0);
    return { n, tone, box: [x0, y0, x1 - x0 + 1, y1 - y0 + 1], png: o.toDataURL('image/png') };
  });
  if (res.png) {
    await writeFile(`${OUT}clean-${m}.png`, Buffer.from(res.png.split(',')[1], 'base64'));
    delete res.png;
  }
  console.log(m, JSON.stringify(res));
  await page.close();
}
await browser.close();
