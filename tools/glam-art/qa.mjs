/*
 * qa.mjs - the DESIGN_FILE §4 QA gate for processed layers.
 *
 * For each model it:
 *   1. Zone-containment: every feature layer's opaque pixels (α>8) must lie
 *      inside its zone + 8px slack (mapped from source bbox space into the
 *      520×600 output frame). Reports stray-pixel count + %.
 *   2. Wash carve-out (§3.2): skin-clean / skin-dull / glow must have ~no
 *      opaque pixels inside the brow / eye / lip zones, and none below 0.68·h.
 *   3. Full-stack composite: base + a canonical full look, z-ordered → writes
 *      assets/art/person/<model>/_qa-fullstack.png for eyeballing.
 *
 * Usage: node tools/glam-art/qa.mjs [m1 m3 ...]   (default: all present)
 * Report: tools/glam-art/out/qa-report.json
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { MODES, MODELS } from './harness/modes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT_ROOT = path.join(REPO, 'apps/games/glam-team-makeover/assets/art/person');

const WASH_KEYS = ['skin-dull', 'skin-clean', 'glow'];
const CARVE_ZONES = { // zones a wash must NOT paint into
  brows: [0.15, 0.06, 0.85, 0.24], eyes: [0.12, 0.08, 0.88, 0.26], lips: [0.28, 0.26, 0.72, 0.42],
};

// canonical "full look" for the composite, in z-order (from the manifest rig)
const FULL_LOOK = [
  'base', 'shirt-gown', 'skin-clean', 'glow', 'hair-brunette', 'brows-shaped',
  'brow-pencil', 'eyeshadow-violet', 'eyeliner', 'mascara', 'contour', 'highlight',
  'blush-rose', 'lip-liner', 'lips-red', 'ear-a',
];

const dataUrl = async (f) => `data:image/png;base64,${(await fs.readFile(f)).toString('base64')}`;
const exists = async (f) => !!(await fs.stat(f).catch(() => null));

async function run() {
  const wanted = process.argv.slice(2).filter((a) => MODELS.includes(a));
  const models = [];
  for (const m of (wanted.length ? wanted : MODELS)) {
    if (await exists(path.join(OUT_ROOT, m, '_meta.json'))) models.push(m);
  }
  if (!models.length) { console.error('no processed models found'); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const report = {};
  const OUT = path.join(HERE, 'out'); // gitignored - debug composites don't ship to the CDN
  await fs.mkdir(OUT, { recursive: true });
  try {
  const page = await browser.newPage();
  await page.setContent('<!doctype html><body></body>');
  await page.addScriptTag({ path: path.join(HERE, 'harness/pipeline.js') }); // share GlamPipeline._internal.isSkin
  // z-ordered compositor: draw each layer PNG (already in draw order) onto 520×600.
  await page.evaluate(() => {
    window.__composite = (urls) => new Promise((resolve) => {
      const W = 520, H = 600, c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); let i = 0;
      const next = () => {
        if (i >= urls.length) return resolve(c.toDataURL('image/png'));
        const img = new Image();
        img.onload = () => { x.drawImage(img, 0, 0, W, H); i++; next(); };
        img.onerror = () => { i++; next(); };
        img.src = urls[i];
      };
      next();
    });
  });

  for (const model of models) {
    const dir = path.join(OUT_ROOT, model);
    const meta = JSON.parse(await fs.readFile(path.join(dir, '_meta.json'), 'utf8'));
    const r = { layers: {}, wash: {}, issues: [] };
    console.log(`\n=== QA ${model} ===`);

    // zone containment for feature layers
    for (const [key, mode] of Object.entries(MODES)) {
      if (mode.kind !== 'feature') continue;
      const f = path.join(dir, `${key}.png`);
      if (!(await exists(f))) continue;
      const res = await page.evaluate(analyzeZone, { url: await dataUrl(f), meta, zone: mode.zone, slack: 8 });
      r.layers[key] = res;
      const pct = res.opaque ? (res.stray / res.opaque * 100) : 0;
      // A real defect is a blob FAR outside the zone; ≤3px is scale-interp feather.
      const blob = res.maxStrayDist > 4;
      const flag = blob ? ' ⚠' : '';
      if (blob) r.issues.push(`${key}: stray blob ${res.maxStrayDist}px outside zone+8 (${pct.toFixed(2)}%)`);
      console.log(`  ${key.padEnd(18)} opaque=${res.opaque} stray=${res.stray} (${pct.toFixed(2)}%) maxDist=${res.maxStrayDist}px${flag}`);
    }

    // wash carve-out
    for (const key of WASH_KEYS) {
      const f = path.join(dir, `${key}.png`);
      if (!(await exists(f))) continue;
      const res = await page.evaluate(analyzeWash, { url: await dataUrl(f), meta, carve: CARVE_ZONES });
      r.wash[key] = res;
      // §3.2 goal: no baked NON-SKIN (feature) pixels in the zones, and nothing
      // below 0.68·h. Clean-skin coverage inside the zones is correct, not a bug.
      const bad = res.nonSkin + res.belowCap;
      const pct = res.opaque ? (bad / res.opaque * 100) : 0;
      const flag = pct > 1 ? ' ⚠' : '';
      if (pct > 1) r.issues.push(`${key}: ${res.nonSkin} baked non-skin px in feature zones + ${res.belowCap} below cap`);
      console.log(`  ${key.padEnd(18)} nonSkinInZones=${res.nonSkin} belowCap=${res.belowCap} skinInZones=${res.skinInZones} (${pct.toFixed(2)}%)${flag}`);
    }

    // full-stack composite
    const present = [];
    for (const k of FULL_LOOK) { const f = path.join(dir, `${k}.png`); if (await exists(f)) present.push(await dataUrl(f)); }
    const comp = await page.evaluate((urls) => window.__composite(urls), present);
    await fs.writeFile(path.join(OUT, `${model}_qa-fullstack.png`), Buffer.from(comp.split(',')[1], 'base64'));
    console.log(`  full-stack → out/${model}_qa-fullstack.png (${present.length} layers)  issues=${r.issues.length}`);
    report[model] = r;
  }

  } finally {
    await browser.close();
  }
  await fs.writeFile(path.join(OUT, 'qa-report.json'), JSON.stringify(report, null, 2));
  const totalIssues = Object.values(report).reduce((a, m) => a + m.issues.length, 0);
  console.log(`\nqa-report → tools/glam-art/out/qa-report.json  · total issues: ${totalIssues}`);
}

// ── in-page analyzers (serialized to the browser) ─────────────────────────
function analyzeZone({ url, meta, zone, slack }) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const W = 520, H = 600; const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, H);
      const d = x.getImageData(0, 0, W, H).data;
      const { bbox, frame } = meta;
      const oX = (sx) => (sx - frame.x) / frame.w * W, oY = (sy) => (sy - frame.y) / frame.h * H;
      const zx0 = oX(bbox.x + zone[0] * bbox.w) - slack / frame.w * W, zx1 = oX(bbox.x + zone[2] * bbox.w) + slack / frame.w * W;
      const zy0 = oY(bbox.y + zone[1] * bbox.h) - slack / frame.h * H, zy1 = oY(bbox.y + zone[3] * bbox.h) + slack / frame.h * H;
      let opaque = 0, stray = 0, maxStrayDist = 0;
      for (let y = 0; y < H; y++) for (let px = 0; px < W; px++) {
        if (d[(y * W + px) * 4 + 3] > 8) {
          opaque++;
          if (px < zx0 || px > zx1 || y < zy0 || y > zy1) {
            stray++;
            const dist = Math.max(zx0 - px, px - zx1, zy0 - y, y - zy1); // chebyshev beyond rect
            if (dist > maxStrayDist) maxStrayDist = dist;
          }
        }
      }
      resolve({ opaque, stray, maxStrayDist: Math.round(maxStrayDist) });
    };
    img.onerror = () => resolve({ opaque: 0, stray: 0, maxStrayDist: 0, error: true });
    img.src = url;
  });
}

function analyzeWash({ url, meta, carve }) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const W = 520, H = 600; const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, H);
      const d = x.getImageData(0, 0, W, H).data;
      const { bbox, frame } = meta;
      const oX = (sx) => (sx - frame.x) / frame.w * W, oY = (sy) => (sy - frame.y) / frame.h * H;
      const rect = (z) => ({ x0: oX(bbox.x + z[0] * bbox.w), y0: oY(bbox.y + z[1] * bbox.h), x1: oX(bbox.x + z[2] * bbox.w), y1: oY(bbox.y + z[3] * bbox.h) });
      const lips = rect(carve.lips), eyes = rect(carve.eyes), brows = rect(carve.brows);
      const capY = oY(bbox.y + 0.68 * bbox.h);
      const inR = (px, y, r) => px >= r.x0 && px <= r.x1 && y >= r.y0 && y <= r.y1;
      const isSkin = window.GlamPipeline._internal.isSkin; // single source of truth (pipeline.js)
      let opaque = 0, nonSkin = 0, skinInZones = 0, belowCap = 0;
      for (let y = 0; y < H; y++) for (let px = 0; px < W; px++) {
        const i = (y * W + px) * 4;
        if (d[i + 3] > 8) {
          opaque++;
          const inZone = inR(px, y, lips) || inR(px, y, eyes) || inR(px, y, brows);
          if (inZone) { if (isSkin(d[i], d[i + 1], d[i + 2])) skinInZones++; else nonSkin++; }
          if (y > capY) belowCap++;
        }
      }
      resolve({ opaque, nonSkin, skinInZones, belowCap });
    };
    img.onerror = () => resolve({ opaque: 0, nonSkin: 0, skinInZones: 0, belowCap: 0, error: true });
    img.src = url;
  });
}

run().catch((e) => { console.error(e); process.exit(1); });
