#!/usr/bin/env node
'use strict';

/**
 * FFCGame integrity validator.
 * Checks that items.json is internally consistent:
 *   - every tag referenced in an item exists in vocab[bucket]
 *   - every prompt key exists in the corresponding vocab bucket
 *   - warns on vocab entries with zero item references (stale tags)
 *   - checks image files exist under _Resources/_imgSource/items/
 *
 * Exits 1 on errors, 0 on clean.
 * Does NOT regenerate items.json from disk — it is authored by the admin.
 *
 * Future: migrate NameIDGame T_* folder items by seeding one FFC item
 * per image with groups:[folder-without-T-prefix] and empty tag arrays.
 */

const fs   = require('fs');
const path = require('path');

const ITEMS_JSON = path.join(__dirname, 'FFCGame', 'items.json');
const IMG_DIR    = path.join(__dirname, 'FFCGame', '_Resources', '_imgSource', 'items');

let errors   = 0;
let warnings = 0;

function err(msg)  { console.error('ERROR:', msg);   errors++;   }
function warn(msg) { console.warn ('WARN: ', msg);   warnings++; }
function ok(msg)   { console.log  ('OK:   ', msg); }

// ── Load items.json ────────────────────────────────────────────────

let data;
try {
  data = JSON.parse(fs.readFileSync(ITEMS_JSON, 'utf8'));
} catch (e) {
  err(`Cannot read ${ITEMS_JSON}: ${e.message}`);
  process.exit(1);
}

const { vocab = {}, prompts = {}, items = [] } = data;
const BUCKETS = { groups: 'groups', features: 'features', functions: 'functions', classes: 'classes' };
const MODE_TO_BUCKET = {
  feature:            'features',
  function:           'functions',
  classWithinGroup:   'classes',
  classCrossCategory: 'classes',
};

// ── Check vocab structure ──────────────────────────────────────────

for (const bucket of Object.values(BUCKETS)) {
  if (!Array.isArray(vocab[bucket])) {
    err(`vocab.${bucket} is missing or not an array`);
  }
}

// ── Build vocab sets for fast lookup ──────────────────────────────

const vocabSets = {};
for (const [key, bucket] of Object.entries(BUCKETS)) {
  vocabSets[bucket] = new Set(Array.isArray(vocab[bucket]) ? vocab[bucket] : []);
}

// ── Check each item ────────────────────────────────────────────────

const tagUsage = {};
for (const bucket of Object.values(BUCKETS)) {
  tagUsage[bucket] = {};
  (vocab[bucket] || []).forEach(t => { tagUsage[bucket][t] = 0; });
}

const seenIds = new Set();
for (const item of items) {
  if (!item.id) { err('Item missing "id"'); continue; }
  if (seenIds.has(item.id)) { err(`Duplicate item id: "${item.id}"`); }
  seenIds.add(item.id);

  if (!item.label)  warn(`Item "${item.id}" missing "label"`);
  if (!item.img)    { err(`Item "${item.id}" missing "img"`); }

  // Check image file
  if (item.img) {
    const imgPath = path.join(IMG_DIR, item.img);
    if (!fs.existsSync(imgPath)) {
      err(`Item "${item.id}": image not found at ${imgPath}`);
    }
  }

  // Check each tag array
  for (const [key, bucket] of Object.entries(BUCKETS)) {
    const tagArr = item[key];
    if (!Array.isArray(tagArr)) {
      err(`Item "${item.id}": "${key}" is not an array`);
      continue;
    }
    for (const tag of tagArr) {
      if (!vocabSets[bucket].has(tag)) {
        err(`Item "${item.id}": tag "${tag}" in "${key}" not found in vocab.${bucket}`);
      } else {
        tagUsage[bucket][tag] = (tagUsage[bucket][tag] || 0) + 1;
      }
    }
  }
}

// ── Check for stale vocab entries ──────────────────────────────────

for (const [bucket, usage] of Object.entries(tagUsage)) {
  for (const [tag, count] of Object.entries(usage)) {
    if (count === 0) warn(`vocab.${bucket} entry "${tag}" is not used by any item`);
  }
}

// ── Check prompt keys exist in vocab ──────────────────────────────

for (const [mode, bucket] of Object.entries(MODE_TO_BUCKET)) {
  const modePrompts = prompts[mode] || {};
  for (const tag of Object.keys(modePrompts)) {
    if (!vocabSets[bucket].has(tag)) {
      err(`prompts.${mode} references tag "${tag}" which is not in vocab.${bucket}`);
    }
  }
}

// ── Report ─────────────────────────────────────────────────────────

console.log('');
console.log(`Items checked: ${items.length}`);
if (warnings) console.warn(`Warnings: ${warnings}`);
if (errors) {
  console.error(`\nFailed with ${errors} error(s).`);
  process.exit(1);
} else {
  ok(`items.json is valid.`);
}
