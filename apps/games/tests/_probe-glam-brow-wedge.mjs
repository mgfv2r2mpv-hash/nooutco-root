/* Finding B - the m4 R wedge, base / mask / canvas at x24, same crop. */
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

const OUT = new URL('../../../.probe-browtail/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });
const BOX = (process.env.BOX || '352,176,36,32').split(',').map(Number);
const MODEL = process.env.MODEL || 'm4';

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
await page.goto('http://localhost:8788/glam-team-makeover/');
await page.waitForFunction(() => !!window.GlamTT);
await page.getByTitle('Show / hide setup').click();
await page.getByLabel('Character', { exact: true }).selectOption(MODEL);
await page.getByLabel('Routine', { exact: true }).selectOption('free');
await page.getByRole('button', { name: /^▶ Play/ }).click();
await page.getByRole('button', { name: /Go - / }).click();
await page.waitForFunction(painted, undefined, { timeout: 20000 });

const png = await page.evaluate(async ([model, box]) => {
  const [L, T, Ww, Hh] = box, Z = 22;
  const G = window.__GLAM_ART_GEN__;
  const E = G.models[model].styles['hair-copper'];
  const cv = document.getElementById('gtm-canvas');
  const W = cv.width, H = cv.height;
  const load = (s) => new Promise((r, j) => { const im = new Image(); im.onload = () => r(im); im.onerror = j; im.src = '/glam-team-makeover/' + s; });
  const grab = async (s) => { const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(await load(s), 0, 0, W, H); return c; };
  const baseC = await grab(E.base), maskC = await grab(E.mask);
  const o = document.createElement('canvas');
  o.width = Ww * Z * 3 + 16; o.height = Hh * Z;
  const x = o.getContext('2d'); x.imageSmoothingEnabled = false;
  x.fillStyle = '#00ff00'; x.fillRect(0, 0, o.width, o.height);
  [baseC, maskC, cv].forEach((src, n) => x.drawImage(src, L, T, Ww, Hh, n * (Ww * Z + 8), 0, Ww * Z, Hh * Z));
  return o.toDataURL('image/png');
}, [MODEL, BOX]);
await writeFile(`${OUT}wedge-${MODEL}-${BOX.join('_')}.png`, Buffer.from(png.split(',')[1], 'base64'));
console.log('wrote', `${OUT}wedge-${MODEL}-${BOX.join('_')}.png`);
await browser.close();
