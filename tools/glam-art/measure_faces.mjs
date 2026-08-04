/*
 * measure_faces.mjs - detect each model's face geometry in the 320×360 game box,
 * so the game's feature ZONES + spot anchors can be driven from a real per-model
 * face box instead of one mis-tuned shared guess.
 *
 * The base PNG is 520×600, drawn object-fit:contain into 320×360 → height-fills
 * (scale 360/600), 312 wide, centred with a 4px x-bar. So box% coords:
 *   boxY% = artY/600*100 ;  boxX% = (4 + artX*312/520)/320*100
 *
 * Detects (in box%): eye-line y, face centre x, face half-width at the eyes,
 * hairline/brow-top y, and an estimated chin y. Prints a faceBox + suggested
 * spot anchors. Usage: node tools/glam-art/measure_faces.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { MODELS } from './harness/modes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.resolve(HERE, '../..', 'apps/games/glam-team-makeover/assets/art/person');
const dataUrl = async (f) => `data:image/png;base64,${(await fs.readFile(f)).toString('base64')}`;

const detect = ({ url }) => new Promise((resolve) => {
  const img = new Image();
  img.onload = () => {
    const W = 520, H = 600, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, W, H).data;
    const A = (px, y) => d[(y * W + px) * 4 + 3];
    const bright = (px, y) => { const i = (y * W + px) * 4; return d[i + 3] > 40 && d[i] > 222 && d[i + 1] > 222 && d[i + 2] > 222; };
    // opaque (character) vertical extent
    let topY = H, botY = 0;
    for (let y = 0; y < H; y++) { let any = false; for (let px = 0; px < W; px += 2) if (A(px, y) > 40) { any = true; break; } if (any) { if (y < topY) topY = y; if (y > botY) botY = y; } }
    // eye row: most sclera-white pixels in the upper-central face band
    let eyeY = 0, best = -1;
    const y0 = Math.round(topY + (botY - topY) * 0.12), y1 = Math.round(topY + (botY - topY) * 0.45);
    for (let y = y0; y < y1; y++) { let n = 0; for (let px = Math.round(W * 0.25); px < Math.round(W * 0.75); px++) if (bright(px, y)) n++; if (n > best) { best = n; eyeY = y; } }
    // face centre + half-width from the bright eye pixels on the eye row band
    let minEx = W, maxEx = 0, sum = 0, cnt = 0;
    for (let y = eyeY - 12; y <= eyeY + 12; y++) for (let px = Math.round(W * 0.15); px < Math.round(W * 0.85); px++) if (bright(px, y)) { if (px < minEx) minEx = px; if (px > maxEx) maxEx = px; sum += px; cnt++; }
    const faceCx = cnt ? sum / cnt : W / 2;
    const eyeSpan = cnt ? (maxEx - minEx) : W * 0.4; // outer eye corners span
    // skin face width at eye level (opaque extent on that row)
    let fl = W, fr = 0; for (let px = 0; px < W; px++) if (A(px, eyeY) > 40) { if (px < fl) fl = px; if (px > fr) fr = px; }
    const toBoxX = (ax) => (4 + ax * 312 / 520) / 320 * 100;
    const toBoxY = (ay) => ay / 600 * 100;
    resolve({
      topY, botY, eyeY, faceCxArt: Math.round(faceCx), eyeSpanArt: Math.round(eyeSpan), faceLArt: fl, faceRArt: fr,
      box: {
        hairTopPct: +toBoxY(topY).toFixed(1),
        eyeYPct: +toBoxY(eyeY).toFixed(1),
        faceCxPct: +toBoxX(faceCx).toFixed(1),
        faceLPct: +toBoxX(fl).toFixed(1),
        faceRPct: +toBoxX(fr).toFixed(1),
        eyeSpanPct: +(toBoxX(minEx + eyeSpan) - toBoxX(minEx)).toFixed(1),
      },
    });
  };
  img.onerror = () => resolve(null);
  img.src = url;
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage(); await page.setContent('<body>');
const rows = {};
for (const m of MODELS) {
  const f = path.join(OUT_ROOT, m, 'base.png');
  const r = await page.evaluate(detect, { url: await dataUrl(f) });
  rows[m] = r.box;
  console.log(`${m}: hairTop=${r.box.hairTopPct}%  eyeY=${r.box.eyeYPct}%  faceCx=${r.box.faceCxPct}%  face x[${r.box.faceLPct},${r.box.faceRPct}]%  eyeSpan=${r.box.eyeSpanPct}%`);
}
await browser.close();
console.log('\nJSON:', JSON.stringify(rows));
