#!/usr/bin/env node
/**
 * update-image-paths.js
 *
 * Reads image-map.json (written by download-famous-images.js) and rewrites
 * every img: URL in TheGame.html to the corresponding local relative path.
 *
 * Run after download-famous-images.js has completed with no failures:
 *   node IDMatchGame/update-image-paths.js
 *
 * All 201 Wikimedia URLs are unique strings, so simple string replacement
 * has zero risk of false positives.
 *
 * After running:
 *   1. Open the game in a browser and spot-check 10–15 people.
 *   2. Delete FamousGame/FamousPerson/image-map.json (it's a build artifact).
 *   3. git add FamousGame/FamousPerson/images/ FamousGame/FamousPerson/TheGame.html
 *   4. git commit -m "feat: self-host all Famous Person images"
 *   5. git push
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT      = path.resolve(__dirname, '..');
const HTML_PATH = path.join(ROOT, 'FamousGame', 'FamousPerson', 'TheGame.html');
const MAP_PATH  = path.join(ROOT, 'FamousGame', 'FamousPerson', 'image-map.json');

if (!fs.existsSync(MAP_PATH)) {
  console.error('image-map.json not found. Run download-famous-images.js first.');
  process.exit(1);
}

const map  = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
let   html = fs.readFileSync(HTML_PATH, 'utf8');

let changed = 0;
let skipped = 0;

for (const { name, oldUrl, newPath } of map) {
  if (!oldUrl.startsWith('http')) {
    // Already a local path — skip
    skipped++;
    continue;
  }
  const before = html;
  html = html.replaceAll(oldUrl, newPath);
  if (html !== before) {
    changed++;
  } else {
    console.warn(`  WARNING: URL not found in TheGame.html for ${name}`);
    console.warn(`    ${oldUrl}`);
  }
}

fs.writeFileSync(HTML_PATH, html, 'utf8');

console.log(`Updated ${changed} URL(s) → local paths`);
if (skipped > 0) console.log(`Skipped ${skipped} (already local)`);
console.log('\nNext steps:');
console.log('  1. Open the game in a browser, spot-check 10–15 people');
console.log('  2. Delete FamousGame/FamousPerson/image-map.json');
console.log('  3. git add FamousGame/FamousPerson/images/ FamousGame/FamousPerson/TheGame.html');
console.log('  4. git commit -m "feat: self-host all Famous Person images; remove Wikimedia dependency"');
console.log('  5. git push');
