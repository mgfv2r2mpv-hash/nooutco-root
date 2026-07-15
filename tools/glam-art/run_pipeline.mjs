/*
 * run_pipeline.mjs — Playwright driver for the Glam Team Makeover art pipeline.
 *
 * Loads the uncompressed masters from disk, runs harness/pipeline.js inside a
 * headless Chromium page (same Canvas2D the reference was tuned in), and writes
 * the processed 520×600 layer PNGs + _meta.json for each model.
 *
 * Usage:
 *   node tools/glam-art/run_pipeline.mjs            # all 4 models
 *   node tools/glam-art/run_pipeline.mjs m1 m3      # a subset
 *
 * Output: apps/games/glam-team-makeover/assets/art/person/<model>/*.png + _meta.json
 * Report: tools/glam-art/out/report.json (keep-counts, dims, timings for QA)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { bboxToFrame } from './harness/frame.mjs';
import {
  MODES, DIFF_KEYS, MODEL_SUFFIX, MODELS, SHIRT_TINTS, EAR_DESIGNS,
  EAR_ANCHORS, HAIR_OVERRIDES,
} from './harness/modes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const MASTERS = path.join(HERE, 'masters');
const OUT_ROOT = path.join(REPO, 'apps/games/glam-team-makeover/assets/art/person');
const PIPELINE_JS = path.join(HERE, 'harness/pipeline.js');

const targets = process.argv.slice(2).filter((a) => MODELS.includes(a));
const RUN = targets.length ? targets : MODELS;

const masterPath = (key, suffix) => path.join(MASTERS, `person:${key}${suffix}.png`);

async function dataUrl(file) {
  const buf = await fs.readFile(file);
  return `data:image/png;base64,${buf.toString('base64')}`;
}
async function writePng(dir, name, url) {
  const b64 = url.split(',')[1];
  await fs.writeFile(path.join(dir, `${name}.png`), Buffer.from(b64, 'base64'));
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const report = { models: {} };
  try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('  [pageerror]', e.message));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ path: PIPELINE_JS });
  const ok = await page.evaluate(() => typeof window.GlamPipeline === 'object');
  if (!ok) throw new Error('pipeline.js failed to expose window.GlamPipeline');

  for (const model of RUN) {
    const t0 = Date.now();
    const suffix = MODEL_SUFFIX[model];
    const outDir = path.join(OUT_ROOT, model);
    await fs.mkdir(outDir, { recursive: true });
    console.log(`\n=== ${model} (masters suffix "${suffix}") → ${path.relative(REPO, outDir)} ===`);
    const m = { layers: {}, warnings: [] };

    // 1) base → strip, compute frame, meta, export
    const baseUrl = await dataUrl(masterPath('base', suffix));
    const strip = await page.evaluate((u) => window.GlamPipeline.stripBase(u), baseUrl);
    const frame = bboxToFrame(strip.bbox);
    const face = await page.evaluate((f) => window.GlamPipeline.faceAnchors(f), frame);
    const meta = { bbox: strip.bbox, frame, srcW: strip.srcW, srcH: strip.srcH, clusters: strip.clusters, face };
    await fs.writeFile(path.join(outDir, '_meta.json'), JSON.stringify(meta));
    const basePng = await page.evaluate((f) => window.GlamPipeline.exportBase(f), frame);
    await writePng(outDir, 'base', basePng);
    console.log(`  base   eyeE=${strip.eyeE}  face=${JSON.stringify(face)}`);

    // 2) diffed layers
    for (const key of DIFF_KEYS) {
      const mode = { ...MODES[key] };
      if (mode.kind === 'hair' && HAIR_OVERRIDES[model]) mode.hair = HAIR_OVERRIDES[model];
      const file = masterPath(key, suffix);
      try {
        const u = await dataUrl(file);
        const res = await page.evaluate(
          (a) => window.GlamPipeline.processLayer(a.key, a.mode, a.u, a.frame),
          { key, mode, u, frame },
        );
        await writePng(outDir, key, res.png);
        m.layers[key] = res.keepCount;
        process.stdout.write(`  ${key.padEnd(18)} keep=${res.keepCount}\n`);
      } catch (e) {
        m.warnings.push(`${key}: ${e.message}`);
        console.error(`  ${key.padEnd(18)} FAILED: ${e.message}`);
      }
    }

    // 3) spot (true-alpha sprite, no diff)
    try {
      const u = await dataUrl(masterPath('spot', suffix));
      const spot = await page.evaluate((x) => window.GlamPipeline.processSpot(x), u);
      await writePng(outDir, 'spot', spot);
      console.log('  spot               (sprite 256)');
    } catch (e) { m.warnings.push(`spot: ${e.message}`); }

    // 4) shirt recolors (recolor the exported base tee)
    for (const [name, tint] of Object.entries(SHIRT_TINTS)) {
      try {
        const shirt = await page.evaluate((a) => window.GlamPipeline.processShirt(a.base, a.tint), { base: basePng, tint });
        await writePng(outDir, name, shirt);
      } catch (e) { m.warnings.push(`${name}: ${e.message}`); }
    }
    console.log(`  shirts             (${Object.keys(SHIRT_TINTS).length} recolors)`);

    // 5) ear composites (m3/m4 PNG studs at this model's ear anchors)
    for (const d of EAR_DESIGNS) {
      try {
        const studUrl = await dataUrl(masterPath('earring-stud', MODEL_SUFFIX[d.studModel]));
        const ear = await page.evaluate(
          (a) => window.GlamPipeline.processEar(a.u, a.anchors, 0.045),
          { u: studUrl, anchors: EAR_ANCHORS[model] },
        );
        await writePng(outDir, d.out, ear);
      } catch (e) { m.warnings.push(`${d.out}: ${e.message}`); }
    }
    console.log(`  ears               (${EAR_DESIGNS.length} composites @ ${JSON.stringify(EAR_ANCHORS[model])})`);

    m.ms = Date.now() - t0;
    report.models[model] = m;
    if (m.warnings.length) console.warn(`  ⚠ ${m.warnings.length} warning(s):`, m.warnings);
    console.log(`  done in ${(m.ms / 1000).toFixed(1)}s`);
  }

  } finally {
    await browser.close(); // always reap Chromium, even if a model throws
  }
  await fs.mkdir(path.join(HERE, 'out'), { recursive: true });
  await fs.writeFile(path.join(HERE, 'out/report.json'), JSON.stringify(report, null, 2));
  console.log(`\nreport → tools/glam-art/out/report.json`);
  return report;
}

run().catch((e) => { console.error(e); process.exit(1); });
