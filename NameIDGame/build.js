#!/usr/bin/env node
/**
 * build.js <game-folder>
 *
 * Scans <game-folder>/T_* directories for images and writes
 * <game-folder>/manifest.json.
 *
 * Run after adding or removing images:
 *   node build.js IDMatchGame
 *   git add IDMatchGame/manifest.json && git commit -m "Update image manifest"
 *
 * The manifest is read by game.js at startup so it never needs to fetch
 * directory listings (which static hosts don't provide).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = __dirname;
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp)$/i;

// ── Resolve game folder ───────────────────────────────────────────────────────

const gameArg = process.argv[2];

if (!gameArg) {
  console.error('Usage:   node build.js <game-folder>');
  console.error('Example: node build.js IDMatchGame');
  process.exit(1);
}

const GAME_PATH = path.resolve(ROOT, gameArg);

if (!fs.existsSync(GAME_PATH) || !fs.statSync(GAME_PATH).isDirectory()) {
  console.error(`Error: "${gameArg}" is not a directory under ${ROOT}`);
  process.exit(1);
}

// ── Find all T_* directories inside _Resources/_imgSource ────────────────────

const IMG_SOURCE = path.join(GAME_PATH, '_Resources', '_imgSource');

const folders = fs.readdirSync(IMG_SOURCE)
  .filter(name => /^T_[^.]+$/.test(name))
  .filter(name => fs.statSync(path.join(IMG_SOURCE, name)).isDirectory())
  .sort();

// ── Collect archived (_a_*) folders ──────────────────────────────────────────

const archivedFolders = fs.readdirSync(IMG_SOURCE)
  .filter(name => /^_a_T_[^.]+$/.test(name))
  .filter(name => fs.statSync(path.join(IMG_SOURCE, name)).isDirectory())
  .sort();

// ── Collect image files per folder ───────────────────────────────────────────

const images = {};
for (const folder of folders) {
  images[folder] = fs.readdirSync(path.join(IMG_SOURCE, folder))
    .filter(f => IMAGE_EXT.test(f) && !f.startsWith('.'))
    .map(f => `_Resources/_imgSource/${folder}/${f}`)
    .sort();
}

const archived = {};
for (const folder of archivedFolders) {
  archived[folder] = fs.readdirSync(path.join(IMG_SOURCE, folder))
    .filter(f => IMAGE_EXT.test(f) && !f.startsWith('.'))
    .map(f => `_Resources/_imgSource/${folder}/${f}`)
    .sort();
}

// ── Write manifest.json ───────────────────────────────────────────────────────

const manifest = {
  generated: new Date().toISOString(),
  folders,
  images,
  archived,
};

const outPath = path.join(GAME_PATH, 'manifest.json');
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');

// ── Print summary ─────────────────────────────────────────────────────────────

const totalImages = Object.values(images).reduce((s, imgs) => s + imgs.length, 0);
console.log(`${gameArg}/manifest.json written`);
console.log(`  ${folders.length} topic folder(s), ${totalImages} total image(s)\n`);
folders.forEach(f =>
  console.log(`  ${f.padEnd(28)} ${images[f].length} image(s)`)
);
if (archivedFolders.length) {
  console.log(`\n  ${archivedFolders.length} archived folder(s)`);
  archivedFolders.forEach(f =>
    console.log(`  ${f.padEnd(28)} ${archived[f].length} image(s)`)
  );
}
