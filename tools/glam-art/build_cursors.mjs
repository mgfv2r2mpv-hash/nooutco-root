/*
 * build_cursors.mjs - per-tool drag cursors for Glam Team Makeover (issue #40).
 *
 * The game already ships one shelf icon per tool (assets/art/icons/*.png, plus
 * the earring sprites). A cursor is that same art, cut down to cursor size:
 *   - tools with a working tip (pencils, wands, brushes, tubes) are tilted so the
 *     tip points up-left like a pointer, and the hotspot sits ON the tip;
 *   - tools applied as a whole (bottles, compacts, the patch, earrings) keep
 *     their pose and take the hotspot at their centre;
 *   - every sprite gets a dark outer ring and a white inner ring, so it reads
 *     against the lightest and darkest skin tones and the sandy counter band.
 *
 * Shade tools (blush, eye shadow, lipstick, contacts) are written NEUTRAL here,
 * the same grey base the shelf button uses. The game tints them per shade at run
 * time through `_tintIcon`, exactly as it tints the shelf buttons, so a new shade
 * needs no new cursor art.
 *
 * Usage : node tools/glam-art/build_cursors.mjs
 * Output: apps/games/glam-team-makeover/assets/art/cursors/<key>.png
 *         tools/glam-art/out/cursors.json   (hotspots, pasted into TOOL_CURSOR_ART)
 *         tools/glam-art/out/cursors-preview.png (each cursor over skin and sand)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const ART = path.join(REPO, 'apps/games/glam-team-makeover/assets/art');
const OUT_DIR = path.join(ART, 'cursors');
const REPORT_DIR = path.join(HERE, 'out');

/* Cursor box in CSS px. Browsers accept up to 128, but Chromium refuses a custom
   cursor larger than 32x32 wherever it would overlap browser UI, and the OS
   pointer is 32 on most desktops, so 32 keeps the cursor honest at any position. */
const BOX = 32;
/* Room for the two outline rings around the ink. */
const PAD = 3;
/* Tip tools are tilted this far counter-clockwise so the tip leads up-left. */
const TILT = -38;
/* Direction the hotspot search walks for a tip tool, in the tilted frame. */
const UP_LEFT = [-1, -1];
const UP = [0, -1];

/* key -> source art, pose and hotspot rule. `hot: 'tip'` takes the opaque pixel
   furthest along `dir`; `hot: 'center'` takes the centre of the opaque box. */
const CURSORS = {
  wash:       { src: 'icons/wash.png',       rotate: 0,    hot: 'center' },
  moist:      { src: 'icons/moist.png',      rotate: 0,    hot: 'center' },
  treat:      { src: 'icons/treat.png',      rotate: 0,    hot: 'center' },
  conceal:    { src: 'icons/conceal.png',    rotate: TILT, hot: 'tip', dir: UP_LEFT },
  brows:      { src: 'icons/brows.png',      rotate: TILT, hot: 'tip', dir: UP_LEFT },
  browpencil: { src: 'icons/browpencil.png', rotate: TILT, hot: 'tip', dir: UP_LEFT },
  contour:    { src: 'icons/contour.png',    rotate: 0,    hot: 'tip', dir: UP_LEFT },
  blush:      { src: 'icons/blush.png',      rotate: 0,    hot: 'center' },
  highlight:  { src: 'icons/highlight.png',  rotate: 0,    hot: 'center' },
  eyeshadow:  { src: 'icons/eyeshadow.png',  rotate: 0,    hot: 'center' },
  eyeliner:   { src: 'icons/eyeliner.png',   rotate: TILT, hot: 'tip', dir: UP_LEFT },
  mascara:    { src: 'icons/mascara.png',    rotate: TILT, hot: 'tip', dir: UP_LEFT },
  lipliner:   { src: 'icons/lipliner.png',   rotate: 0,    hot: 'tip', dir: UP, band: [0.30, 0.56] },
  lipstick:   { src: 'icons/lipstick.png',   rotate: TILT, hot: 'tip', dir: UP_LEFT },
  contacts:   { src: 'icons/contacts.png',   rotate: 0,    hot: 'center' },
  stud:       { src: 'earrings/stud.png',    rotate: 0,    hot: 'center' },
  ring:       { src: 'earrings/ring.png',    rotate: 0,    hot: 'center' },
  sapphire:   { src: 'earrings/sapphire.png', rotate: 0,   hot: 'center' },
};

/* Skin swatches and the counter band the cursor must read against. */
const BACKGROUNDS = ['#f6dccb', '#e2b48f', '#b77b55', '#7a4a32', '#4a2c20', '#e9dccb'];

/* Runs inside the page: one source image in, one cursor PNG + hotspot out. */
function renderCursor({ url, spec, BOX, PAD }) {
  const load = (u) => new Promise((res, rej) => {
    const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('load ' + u)); im.src = u;
  });
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const opaqueBox = (cx, w, h, min) => {
    const d = cx.getImageData(0, 0, w, h).data; let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] >= min) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x0, y0, x1, y1, d };
  };
  return load(url).then((im) => {
    // 1. Pose the art on a generous canvas so no rotation clips it.
    const diag = Math.ceil(Math.hypot(im.width, im.height)) + 4;
    const big = canvas(diag, diag), bx = big.getContext('2d');
    bx.translate(diag / 2, diag / 2); bx.rotate(spec.rotate * Math.PI / 180);
    bx.drawImage(im, -im.width / 2, -im.height / 2);
    const bb = opaqueBox(bx, diag, diag, 24);
    // 2. Fit the posed ink inside the box, leaving PAD for the rings.
    const iw = bb.x1 - bb.x0 + 1, ih = bb.y1 - bb.y0 + 1;
    const s = (BOX - 2 * PAD) / Math.max(iw, ih);
    const dw = Math.max(1, Math.round(iw * s)), dh = Math.max(1, Math.round(ih * s));
    const ox = Math.round((BOX - dw) / 2), oy = Math.round((BOX - dh) / 2);
    const ink = canvas(BOX, BOX), ix = ink.getContext('2d');
    ix.imageSmoothingQuality = 'high';
    ix.drawImage(big, bb.x0, bb.y0, iw, ih, ox, oy, dw, dh);
    // 3. Hotspot, measured on the scaled ink so it lands on a visible pixel.
    const ib = opaqueBox(ix, BOX, BOX, 160);
    let hx, hy;
    if (spec.hot === 'center') {
      hx = Math.round((ib.x0 + ib.x1) / 2); hy = Math.round((ib.y0 + ib.y1) / 2);
    } else {
      const [dx, dy] = spec.dir; let best = -Infinity;
      const xa = spec.band ? Math.floor(spec.band[0] * BOX) : 0;
      const xb = spec.band ? Math.ceil(spec.band[1] * BOX) : BOX - 1;
      for (let y = 0; y < BOX; y++) for (let x = xa; x <= xb; x++) {
        if (ib.d[(y * BOX + x) * 4 + 3] < 160) continue;
        const v = x * dx + y * dy; if (v > best) { best = v; hx = x; hy = y; } }
    }
    // 4. Outline: a dark outer ring, then a white inner ring, then the ink.
    const sil = (color) => { const c = canvas(BOX, BOX), x = c.getContext('2d');
      x.drawImage(ink, 0, 0); x.globalCompositeOperation = 'source-in';
      x.fillStyle = color; x.fillRect(0, 0, BOX, BOX); return c; };
    const out = canvas(BOX, BOX), o = out.getContext('2d');
    const ring = (c, r) => { for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8;
      o.drawImage(c, Math.cos(a) * r, Math.sin(a) * r); } };
    ring(sil('rgba(38,26,24,0.9)'), 2.6);
    ring(sil('#ffffff'), 1.5);
    o.drawImage(ink, 0, 0);
    return { png: out.toDataURL('image/png'), x: hx, y: hy };
  });
}

/* Runs inside the page: every cursor over every background, hotspot marked. */
function renderPreview({ cells, BACKGROUNDS, BOX }) {
  const S = 3, cw = BOX * S + 12, ch = BOX * S + 12;
  const c = document.createElement('canvas');
  c.width = cw * BACKGROUNDS.length; c.height = ch * cells.length;
  const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
  return Promise.all(cells.map((cell) => new Promise((res) => {
    const im = new Image(); im.onload = () => res({ ...cell, im }); im.src = cell.png;
  }))).then((loaded) => {
    loaded.forEach((cell, r) => BACKGROUNDS.forEach((bg, k) => {
      x.fillStyle = bg; x.fillRect(k * cw, r * ch, cw, ch);
      x.drawImage(cell.im, k * cw + 6, r * ch + 6, BOX * S, BOX * S);
      x.fillStyle = '#00c853'; x.fillRect(k * cw + 6 + cell.x * S, r * ch + 6 + cell.y * S, S, S);
    }));
    return c.toDataURL('image/png');
  });
}

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const table = {};
  const cells = [];
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    for (const [key, spec] of Object.entries(CURSORS)) {
      const buf = await fs.readFile(path.join(ART, spec.src));
      const url = `data:image/png;base64,${buf.toString('base64')}`;
      const res = await page.evaluate(renderCursor, { url, spec, BOX, PAD });
      if (res.x == null || res.y == null) throw new Error(`build_cursors: no hotspot found for ${key}`);
      await fs.writeFile(path.join(OUT_DIR, `${key}.png`), Buffer.from(res.png.split(',')[1], 'base64'));
      table[key] = { url: `assets/art/cursors/${key}.png`, x: res.x, y: res.y };
      cells.push({ key, png: res.png, x: res.x, y: res.y });
      console.log(`  ${key.padEnd(11)} hotspot ${res.x},${res.y}`);
    }
    const preview = await page.evaluate(renderPreview, { cells, BACKGROUNDS, BOX });
    await fs.writeFile(path.join(REPORT_DIR, 'cursors-preview.png'), Buffer.from(preview.split(',')[1], 'base64'));
  } finally {
    await browser.close();
  }
  await fs.writeFile(path.join(REPORT_DIR, 'cursors.json'), JSON.stringify(table, null, 2) + '\n');
  console.log(`wrote ${Object.keys(table).length} cursors to ${path.relative(REPO, OUT_DIR)}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
