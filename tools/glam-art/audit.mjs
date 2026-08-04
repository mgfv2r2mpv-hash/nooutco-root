/*
 * audit.mjs - the "pixel-exact except the feature" gate.
 *
 * For every processed layer of every model it measures, against the base:
 *   - outsideOpaque : opaque px where the BASE is transparent (stray content off
 *     the character). Legit only for hair (adds hair beyond the buzz silhouette).
 *   - grayBg        : opaque, neutral-gray, NON-skin px (checkerboard / backdrop
 *     remnant) anywhere. This is the m2 skin-clean checker signature.
 *   - checker       : neutral-gray px arranged in an alternating ~grid (strong
 *     backdrop tell).
 * It also renders a magenta contact sheet per model (out/audit/<m>_sheet.png)
 * and the raw masters sheet, for eyeball confirmation.
 *
 * A layer is CLEAN when grayBg≈0, checker=false, and outsideOpaque≈0 (hair aside).
 * Usage: node tools/glam-art/audit.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { MODELS } from './harness/modes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ART = path.resolve(HERE, '../..', 'apps/games/glam-team-makeover/assets/art/person');
const OUT = path.join(HERE, 'out/audit');
const PIPE = path.join(HERE, 'harness/pipeline.js');
const dataUrl = async (f) => `data:image/png;base64,${(await fs.readFile(f)).toString('base64')}`;
const exists = async (f) => !!(await fs.stat(f).catch(() => null));

const analyze = ({ baseUrl, layerUrl, isHair }) => new Promise((resolve) => {
  const bi = new Image();
  bi.onload = () => {
    const W = 520, H = 600;
    const bc = document.createElement('canvas'); bc.width = W; bc.height = H;
    const bx = bc.getContext('2d', { willReadFrequently: true }); bx.drawImage(bi, 0, 0, W, H);
    const bd = bx.getImageData(0, 0, W, H).data;
    const li = new Image();
    li.onload = () => {
      const lc = document.createElement('canvas'); lc.width = W; lc.height = H;
      const lx = lc.getContext('2d', { willReadFrequently: true }); lx.drawImage(li, 0, 0, W, H);
      const ld = lx.getImageData(0, 0, W, H).data;
      const isSkin = window.GlamPipeline._internal.isSkin;
      let opaque = 0, outsideOpaque = 0, grayBg = 0;
      const grayMask = new Uint8Array(W * H);
      for (let k = 0; k < W * H; k++) {
        const i = k * 4;
        if (ld[i + 3] <= 60) continue;
        opaque++;
        const r = ld[i], g = ld[i + 1], b = ld[i + 2];
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), L = (r + g + b) / 3;
        const neutralGray = (mx - mn) < 22 && L > 55 && L < 232;
        if (bd[i + 3] < 20 && !isHair) outsideOpaque++;
        if (neutralGray && !isSkin(r, g, b)) { grayBg++; grayMask[k] = 1; }
      }
      // checker: fraction of gray px whose diagonal neighbor flips light/dark
      let flips = 0, pairs = 0;
      for (let y = 2; y < H - 2; y += 2) for (let x = 2; x < W - 2; x += 2) {
        const k = y * W + x; if (!grayMask[k]) continue;
        const i = k * 4, L0 = (ld[i] + ld[i + 1] + ld[i + 2]) / 3;
        const j = ((y + 4) * W + (x + 4)) * 4;
        if (ld[j + 3] > 60) { pairs++; if (Math.abs(L0 - (ld[j] + ld[j + 1] + ld[j + 2]) / 3) > 22) flips++; }
      }
      resolve({ opaque, outsideOpaque, grayBg, checker: pairs > 40 && flips / pairs > 0.35 });
    };
    li.onerror = () => resolve(null);
    li.src = layerUrl;
  };
  bi.src = baseUrl;
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage(); await page.setContent('<body>');
await page.addScriptTag({ path: PIPE });
await page.evaluate(() => {
  // cells[n].urls = image stack drawn in order (e.g. [base, layer]); bg fills
  // behind each cell (magenta exposes stray alpha; white mimics the game).
  window.__sheet = async (cells, cols, cw, ch, bg) => {
    const pad = 16, rows = Math.ceil(cells.length / cols);
    const c = document.createElement('canvas'); c.width = cols * (cw + 4); c.height = rows * (ch + pad);
    const x = c.getContext('2d');
    x.fillStyle = bg || '#ff00ff'; x.fillRect(0, 0, c.width, c.height);
    for (let n = 0; n < cells.length; n++) {
      const cx = (n % cols) * (cw + 4), cy = Math.floor(n / cols) * (ch + pad);
      for (const u of (cells[n].urls || [cells[n].url])) {
        await new Promise((res) => { const im = new Image(); im.onload = () => { x.drawImage(im, cx, cy + pad, cw, ch); res(); }; im.onerror = res; im.src = u; });
      }
      x.fillStyle = '#000'; x.fillRect(cx, cy, cw, pad); x.fillStyle = cells[n].bad ? '#ff5' : '#fff';
      x.font = '10px monospace'; x.fillText(cells[n].label, cx + 2, cy + 11);
    }
    return c.toDataURL('image/png');
  };
});

await fs.mkdir(OUT, { recursive: true });
const report = {};
for (const m of MODELS) {
  const dir = path.join(ART, m);
  const baseUrl = await dataUrl(path.join(dir, 'base.png'));
  const layers = (await fs.readdir(dir)).filter((f) => f.endsWith('.png') && f !== 'base.png' && !f.startsWith('_')).map((f) => f.replace('.png', '')).sort();
  const cells = [], rows = {};
  let dirty = 0;
  for (const key of layers) {
    const f = path.join(dir, `${key}.png`);
    if (!(await exists(f))) continue;
    const url = await dataUrl(f);
    const r = await page.evaluate(analyze, { baseUrl, layerUrl: url, isHair: key.startsWith('hair') });
    rows[key] = r;
    const bad = r.checker || r.grayBg > 120 || r.outsideOpaque > 300;
    if (bad) dirty++;
    cells.push({ url, label: `${key}${bad ? ' ✗' : ''}`, bad });
  }
  const sheet = await page.evaluate(({ cells }) => window.__sheet(cells, 6, 150, 173), { cells });
  await fs.writeFile(path.join(OUT, `${m}_sheet.png`), Buffer.from(sheet.split(',')[1], 'base64'));
  // second proof: every layer composited over the base, on white (game view)
  const onbaseCells = cells.map((c) => ({ urls: [baseUrl, ...(c.urls || [c.url])], label: c.label, bad: c.bad }));
  const onbase = await page.evaluate(({ cells }) => window.__sheet(cells, 6, 150, 173, '#fff'), { cells: onbaseCells });
  await fs.writeFile(path.join(OUT, `${m}_onbase.png`), Buffer.from(onbase.split(',')[1], 'base64'));
  report[m] = { dirty, layers: rows };
  const flags = Object.entries(rows).filter(([, r]) => r.checker || r.grayBg > 120 || r.outsideOpaque > 300)
    .map(([k, r]) => `${k}(gray:${r.grayBg}${r.checker ? ',CHECKER' : ''}${r.outsideOpaque > 300 ? `,out:${r.outsideOpaque}` : ''})`);
  console.log(`${m}: ${dirty} dirty layer(s) → ${flags.join('  ') || 'clean ✓'}`);
}
await browser.close();
await fs.writeFile(path.join(OUT, 'audit.json'), JSON.stringify(report, null, 2));
console.log(`\nsheets + audit.json → tools/glam-art/out/audit/`);
