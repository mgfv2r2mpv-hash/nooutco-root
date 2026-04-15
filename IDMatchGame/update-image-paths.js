#!/usr/bin/env node
/**
 * update-image-paths.js
 *
 * Scans FamousGame/FamousPerson/images/ and rewrites every matching img: URL
 * in TheGame.html to the corresponding local relative path.
 *
 * Does NOT require image-map.json — matches files to people by name slug.
 * Name slug: lowercase, non-alphanumeric stripped, spaces → hyphens, max 40 chars.
 * e.g. "J.K. Rowling" → "jk-rowling", "Tupac Shakur" → "tupac-shakur"
 *
 * Run from anywhere:
 *   node IDMatchGame/update-image-paths.js
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..');
const HTML_PATH  = path.join(ROOT, 'FamousGame', 'FamousPerson', 'TheGame.html');
const IMAGES_DIR = path.join(ROOT, 'FamousGame', 'FamousPerson', 'images');

if (!fs.existsSync(IMAGES_DIR)) {
  console.error('images/ directory not found at', IMAGES_DIR);
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40);
}

// ── Parse names + img URLs from TheGame.html ─────────────────────────────────

let html = fs.readFileSync(HTML_PATH, 'utf8');

const peopleStart = html.indexOf('const PEOPLE = [');
if (peopleStart === -1) throw new Error('Could not find "const PEOPLE = [" in TheGame.html');
const peopleEnd = html.indexOf('\n];', peopleStart);
if (peopleEnd === -1) throw new Error('Could not find end of PEOPLE array');
const peopleText = html.slice(peopleStart, peopleEnd + 3);

const names = [...peopleText.matchAll(/^\s+name:\s*['"]([^'"]+)['"]/gm)].map(m => m[1]);
const imgs  = [...peopleText.matchAll(/^\s+img:\s*['"]([^'"]+)['"]/gm)].map(m => m[1]);

if (names.length !== imgs.length) {
  throw new Error(`Mismatch: ${names.length} names vs ${imgs.length} img entries`);
}

// ── Build slug → filename map from images/ directory ─────────────────────────

const imageFiles = fs.readdirSync(IMAGES_DIR).filter(f =>
  /\.(jpe?g|png|gif|webp|svg)$/i.test(f)
);

// Map slug → filename (first match wins)
const slugToFile = {};
for (const f of imageFiles) {
  const slug = path.basename(f, path.extname(f));
  slugToFile[slug] = f;
}

// ── Match and rewrite ─────────────────────────────────────────────────────────

let updated  = 0;
let skipped  = 0;
let notFound = 0;

for (let i = 0; i < names.length; i++) {
  const name    = names[i];
  const oldPath = imgs[i];
  const slug    = makeSlug(name);
  const file    = slugToFile[slug];

  if (!file) {
    console.log(`  [no image] ${name}  (slug: ${slug})`);
    notFound++;
    continue;
  }

  const newPath = 'images/' + file;

  if (oldPath === newPath) {
    skipped++;
    continue;
  }

  // Escape for use in regex (handles special chars in Wikimedia URLs)
  const escaped = oldPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const before  = html;
  html = html.replace(new RegExp(escaped), newPath);
  if (html !== before) {
    updated++;
  } else {
    console.warn(`  WARNING: could not replace img for ${name}`);
    console.warn(`    looked for: ${oldPath}`);
  }
}

fs.writeFileSync(HTML_PATH, html, 'utf8');

console.log(`\nUpdated ${updated} URL(s) → local paths`);
if (skipped  > 0) console.log(`Skipped  ${skipped}  (already local)`);
if (notFound > 0) console.log(`No image ${notFound} (no matching file in images/)`);
