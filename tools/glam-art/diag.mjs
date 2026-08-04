/* diag.mjs - composite base + named layers over an opaque grey card for eyeballing
 * a single layer's edge. Usage: node tools/glam-art/diag.mjs m1 contour highlight */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const model = process.argv[2] || 'm1';
const layers = process.argv.slice(3);
const dir = path.join(REPO, 'apps/games/glam-team-makeover/assets/art/person', model);
const SCRATCH = path.join(HERE, 'out'); // gitignored
await fs.mkdir(SCRATCH, { recursive: true });

const dataUrl = async (f) => `data:image/png;base64,${(await fs.readFile(f)).toString('base64')}`;

const b = await chromium.launch({ headless: true });
const p = await b.newPage(); await p.setContent('<body>');
for (const L of layers) {
  const urls = [await dataUrl(path.join(dir, 'base.png')), await dataUrl(path.join(dir, `${L}.png`))];
  const png = await p.evaluate((us) => new Promise((res) => {
    const c = document.createElement('canvas'); c.width = 520; c.height = 600; const x = c.getContext('2d');
    x.fillStyle = '#c8c8c8'; x.fillRect(0, 0, 520, 600);
    let i = 0; const next = () => { if (i >= us.length) return res(c.toDataURL('image/png')); const im = new Image(); im.onload = () => { x.drawImage(im, 0, 0, 520, 600); i++; next(); }; im.src = us[i]; }; next();
  }), urls);
  await fs.writeFile(path.join(SCRATCH, `diag-${model}-${L}.png`), Buffer.from(png.split(',')[1], 'base64'));
  console.log(`diag-${model}-${L}.png`);
}
await b.close();
