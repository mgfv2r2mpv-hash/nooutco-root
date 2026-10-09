/*
 * finish_brow_removal.mjs - finish the base renders' brow removal (issue #41).
 *
 * The shipped per-style renders (person/<model>/<style>/base.png, 512x576) had
 * their original brow skin-filled when they were built in the Claude Design
 * project, and that fill stopped at the edge of the mask's eyes+brows key. The
 * key is shorter than the brow, so a faint arc of the brow's outline survives
 * on the temple outboard of it. This step removes that arc in place, losslessly,
 * using harness/brow_finish.mjs. It is idempotent: a second run changes almost
 * nothing, and `--check` reports without writing.
 *
 * Rerun it whenever base renders are regenerated from the design project, until
 * the key there is drawn to the end of the brow.
 *
 * Usage:
 *   node tools/glam-art/finish_brow_removal.mjs            # m2 m3 m4, every style
 *   node tools/glam-art/finish_brow_removal.mjs --check    # report only
 *   node tools/glam-art/finish_brow_removal.mjs m2         # a subset
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './harness/png.mjs';
import { finishBrowRemoval } from './harness/brow_finish.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '../../apps/games/glam-team-makeover');
const PERSON = path.join(GAME, 'assets/art/person');
/* The models the game ships (GlamStory.MODELS); m1 was retired. */
const LIVE_MODELS = ['m2', 'm3', 'm4'];

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const picked = args.filter((a) => LIVE_MODELS.includes(a));
const MODELS = picked.length ? picked : LIVE_MODELS;

async function styleDirs(model) {
  const dir = path.join(PERSON, model);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const base = path.join(dir, e.name, 'base.png');
    const mask = path.join(dir, e.name, 'mask.png');
    try { await fs.access(base); await fs.access(mask); out.push({ style: e.name, base, mask }); } catch { /* not a style dir */ }
  }
  return out.sort((a, b) => a.style.localeCompare(b.style));
}

/* The per-style eye anchors the game itself reads (window.__GLAM_ART_GEN__). */
async function loadFaces() {
  const src = await fs.readFile(path.join(GAME, 'assets/art-generated.js'), 'utf8');
  const json = src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1);
  return JSON.parse(json).models;
}

async function run() {
  const models = await loadFaces();
  let total = 0;
  for (const model of MODELS) {
    for (const s of await styleDirs(model)) {
      const base = decodePng(await fs.readFile(s.base));
      const mask = decodePng(await fs.readFile(s.mask));
      if (base.channels !== 4) throw new Error(`${s.base}: expected RGBA`);
      if (base.width !== mask.width || base.height !== mask.height) throw new Error(`${s.base}: mask size differs`);
      const face = models[model]?.styles?.[s.style]?.face;
      if (!face) throw new Error(`${model}/${s.style}: no face anchors in art-generated.js`);
      const res = finishBrowRemoval(base.data, mask.data, base.width, base.height, mask.channels, face);
      const sides = res.bands.map((b) => `${b.side}[${b.band.x0}-${b.band.x1},${b.band.y0}-${b.band.y1}]`).join(' ');
      console.log(`${model}/${s.style.padEnd(14)} ghost ${String(res.ghost).padStart(5)}  pixels ${String(res.changed).padStart(4)}  ${sides}`);
      total += res.changed;
      if (!CHECK && res.changed) await fs.writeFile(s.base, encodePng({ ...base, data: res.data }));
    }
  }
  console.log(`${CHECK ? 'would change' : 'changed'} ${total} pixels`);
}

run().catch((e) => { console.error(e); process.exit(1); });
