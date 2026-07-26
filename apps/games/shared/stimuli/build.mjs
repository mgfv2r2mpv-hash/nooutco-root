#!/usr/bin/env node
/**
 * Build the shared stimulus library from the three duplicated `_Resources`
 * trees carried by clock, receptive and matching.
 *
 *   node shared/stimuli/build.mjs           # write stimuli.json, provenance.json, img/
 *   node shared/stimuli/build.mjs --check   # rebuild in memory and diff; never writes
 *
 * The three trees hold the SAME item names at different quality, in different
 * formats, and with different manifest selections — `T_animals/bear.jpg` is
 * byte-identical between clock and receptive but a completely different photo
 * in matching. This script collapses them onto one entry per stimulus, keeps
 * every distinct piece of real art, and records where each file came from so
 * the eventual deletion of the duplicated trees is provably lossless.
 *
 * Nothing here mutates a game. Repointing the games at the library is a
 * separate step; until then this output is purely additive.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { classify, isImagePath, needsBodyToClassify } from '../../tests/lib/stimuli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '../..');
const LIBRARY_DIR = HERE;
const IMG_DIR = path.join(LIBRARY_DIR, 'img');

/** Site-absolute prefix the games will fetch library art from. */
const SITE_BASE = '/shared/stimuli/';

/**
 * Source trees, in preference order. `matching` leads because its manifest is
 * the one still being regenerated (2026-07-26 against 2026-05 for the other
 * two), it is the only tree that receives AdminTools uploads today, and it
 * carries the most curated real art — T_household_items and T_kitchen_items
 * are photographs there and emoji placeholders everywhere else.
 */
const SOURCE_GAMES = ['matching', 'receptive', 'clock'];

const RASTER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

/** Placeholder SVGs drawn with an emoji font, as opposed to a text font. */
const EMOJI_FONT_RE = /font-family="[^"]*Emoji/i;
const TEXT_BODY_RE = /<text[^>]*>([\s\S]*?)<\/text>/i;

// ── Scanning ───────────────────────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const toPosix = (p) => p.split(path.sep).join('/');

function extractGlyph(body) {
  const match = body.match(TEXT_BODY_RE);
  if (!match) return null;
  const text = match[1].trim();
  if (!text) return null;
  return { text, kind: EMOJI_FONT_RE.test(body) ? 'emoji' : 'text' };
}

/**
 * Every image file in every source tree, tagged with the facts the merge
 * needs: what it is, whether a technician's manifest actually selected it,
 * and its content hash.
 */
function collectCandidates() {
  const candidates = [];
  for (const game of SOURCE_GAMES) {
    const treeRoot = path.join(GAMES_ROOT, game, '_Resources', '_imgSource');
    if (!fs.existsSync(treeRoot)) continue;

    const manifest = JSON.parse(fs.readFileSync(path.join(GAMES_ROOT, game, 'manifest.json'), 'utf8'));
    const indexed = new Set(Object.values(manifest.images || {}).flat());
    const displayNames = manifest.displayNames || {};

    for (const file of walk(treeRoot)) {
      if (!isImagePath(file)) continue;
      const gameRelative = toPosix(path.relative(path.join(GAMES_ROOT, game), file));
      const bytes = fs.readFileSync(file);
      const body = needsBodyToClassify(file) ? bytes.toString('utf8') : null;
      candidates.push({
        game,
        gameRelative,
        servedPath: `/${game}/${gameRelative}`,
        category: path.basename(path.dirname(file)),
        stem: path.basename(file).replace(/\.[^.]+$/, ''),
        extension: path.extname(file).toLowerCase(),
        classification: classify(file, body),
        indexed: indexed.has(gameRelative),
        label: displayNames[gameRelative],
        glyph: body ? extractGlyph(body) : null,
        md5: crypto.createHash('md5').update(bytes).digest('hex'),
        bytes,
      });
    }
  }
  return candidates;
}

// ── Merge ──────────────────────────────────────────────────────────

/**
 * Ranking within one stimulus. Lower sorts first.
 *
 * Real art always beats a placeholder glyph. After that a file some manifest
 * actually selected beats one that was deliberately left out, and a raster
 * beats a vector — several `.svg` files in matching's tree are JPEG bytes
 * under the wrong extension, and the hand-drawn preposition diagrams should
 * only be reached when no photograph exists at all.
 */
function rank(candidate) {
  return [
    candidate.classification === 'art' ? 0 : 1,
    candidate.indexed ? 0 : 1,
    RASTER_EXTENSIONS.has(candidate.extension) ? 0 : 1,
    SOURCE_GAMES.indexOf(candidate.game),
    candidate.gameRelative,
  ];
}

function compareRank(a, b) {
  const ra = rank(a);
  const rb = rank(b);
  for (let i = 0; i < ra.length; i += 1) {
    if (ra[i] < rb[i]) return -1;
    if (ra[i] > rb[i]) return 1;
  }
  return 0;
}

const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const categorySlug = (category) => slug(category.replace(/^T_/, ''));

/**
 * Ids are category-qualified because stems are not unique on their own:
 * `orange` is both a colour and a food, and `a` / `A` are different stimuli
 * that collide on a case-insensitive filesystem.
 */
const stimulusId = (category, stem) => `${categorySlug(category)}-${slug(stem)}`;

/**
 * A single character or a bare number is its own label — title-casing would
 * render the lowercase-letter programme as uppercase, which is a different
 * discrimination entirely.
 */
function deriveLabel(stem) {
  if (stem.length === 1 || /^\d+$/.test(stem)) return stem;
  return stem.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function libraryFileName(stem, extension, alternateIndex) {
  const base = slug(stem) || stem;
  return alternateIndex === 0 ? `${base}${extension}` : `${base}--alt${alternateIndex}${extension}`;
}

function buildLibrary() {
  const candidates = collectCandidates();

  /** category -> stem -> candidates */
  const byCategory = new Map();
  for (const candidate of candidates) {
    if (!byCategory.has(candidate.category)) byCategory.set(candidate.category, new Map());
    const stems = byCategory.get(candidate.category);
    if (!stems.has(candidate.stem)) stems.set(candidate.stem, []);
    stems.get(candidate.stem).push(candidate);
  }

  const categories = [...byCategory.keys()].sort();
  const stimuli = [];
  const provenance = {};
  const files = new Map(); // library-relative path -> bytes
  const warnings = [];

  for (const category of categories) {
    // Two different stems must never resolve to the same bytes inside one
    // category: receptive ships `on.png` as a byte copy of `above.png` (and
    // `under.png` of `below.png`), so one picture gets asked about under two
    // names. The first stem alphabetically keeps the file and the other falls
    // through to its next-best candidate.
    const claimed = new Map();
    const stems = [...byCategory.get(category).keys()].sort();

    for (const stem of stems) {
      const group = byCategory.get(category).get(stem).slice().sort(compareRank);

      const art = [];
      const seenHashes = new Set();
      for (const candidate of group) {
        if (candidate.classification !== 'art') continue;
        if (seenHashes.has(candidate.md5)) continue;
        const owner = claimed.get(candidate.md5);
        if (owner && owner !== stem) {
          candidate.dropReason = `duplicate-of:${category}/${owner}`;
          warnings.push(
            `${category}/${stem}: skipped ${candidate.servedPath} — byte-identical to ${category}/${owner}`,
          );
          continue;
        }
        seenHashes.add(candidate.md5);
        art.push(candidate);
      }

      const glyphSource = group.find((c) => c.glyph);
      const labelOverride = group.map((c) => c.label).find((l) => typeof l === 'string' && l.trim());

      const entry = {
        id: stimulusId(category, stem),
        label: labelOverride ? labelOverride.trim() : deriveLabel(stem),
        categories: [category],
        image: null,
        emoji: glyphSource ? glyphSource.glyph.text : null,
      };
      if (glyphSource) entry.glyphKind = glyphSource.glyph.kind;

      const variants = [];
      art.forEach((candidate, index) => {
        claimed.set(candidate.md5, stem);
        const relative = `img/${category}/${libraryFileName(stem, candidate.extension, index)}`;
        if (files.has(relative)) throw new Error(`library file name collision: ${relative}`);
        files.set(relative, candidate.bytes);
        if (index === 0) entry.image = SITE_BASE + relative;
        else variants.push(SITE_BASE + relative);
      });
      if (variants.length) entry.variants = variants;

      if (!entry.image && !entry.emoji) {
        warnings.push(`${category}/${stem}: no art and no glyph — would render blank`);
      }

      stimuli.push(entry);

      // Provenance: every served path in the old trees mapped to whatever in
      // the library now carries those bytes. A null `library` always carries a
      // `droppedBecause`, so deleting the duplicated trees can be shown to
      // lose nothing that was not deliberately dropped.
      for (const candidate of group) {
        const keptIndex = art.findIndex((a) => a.md5 === candidate.md5);
        const record = {
          stimulus: entry.id,
          md5: candidate.md5,
          library:
            keptIndex === -1
              ? null
              : `${SITE_BASE}img/${category}/${libraryFileName(stem, art[keptIndex].extension, keptIndex)}`,
        };
        if (!record.library) {
          record.droppedBecause =
            candidate.dropReason || (candidate.classification === 'art' ? 'unexplained' : 'placeholder-glyph');
        }
        provenance[candidate.servedPath] = record;
      }
    }
  }

  stimuli.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const index = {
    schema: 1,
    note:
      'Shared stimulus library. Generated from the clock, receptive and matching _Resources trees by ' +
      'shared/stimuli/build.mjs — change that script or the source art, never this file.',
    sources: SOURCE_GAMES,
    basePath: SITE_BASE,
    categories,
    stimuli,
  };

  return { index, provenance, files, warnings };
}

// ── Output ─────────────────────────────────────────────────────────

const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

function writeLibrary({ index, provenance, files }) {
  fs.rmSync(IMG_DIR, { recursive: true, force: true });
  for (const [relative, bytes] of files) {
    const target = path.join(LIBRARY_DIR, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  fs.writeFileSync(path.join(LIBRARY_DIR, 'stimuli.json'), stableJson(index));
  fs.writeFileSync(path.join(LIBRARY_DIR, 'provenance.json'), stableJson(provenance));
}

function checkLibrary({ index, provenance, files }) {
  const problems = [];

  for (const [name, expected] of [['stimuli.json', index], ['provenance.json', provenance]]) {
    const committed = path.join(LIBRARY_DIR, name);
    if (!fs.existsSync(committed)) {
      problems.push(`${name} is missing — run: node shared/stimuli/build.mjs`);
    } else if (fs.readFileSync(committed, 'utf8') !== stableJson(expected)) {
      problems.push(`${name} is stale — run: node shared/stimuli/build.mjs`);
    }
  }

  for (const [relative, bytes] of files) {
    const target = path.join(LIBRARY_DIR, relative);
    if (!fs.existsSync(target)) problems.push(`missing library file: ${relative}`);
    else if (!fs.readFileSync(target).equals(bytes)) problems.push(`library file differs from source: ${relative}`);
  }

  const onDisk = fs.existsSync(IMG_DIR)
    ? walk(IMG_DIR).map((f) => toPosix(path.relative(LIBRARY_DIR, f)))
    : [];
  for (const relative of onDisk) {
    if (!files.has(relative)) problems.push(`unexpected library file: ${relative}`);
  }

  return problems;
}

const built = buildLibrary();
for (const warning of built.warnings) console.warn(`warn: ${warning}`);

if (process.argv.includes('--check')) {
  const problems = checkLibrary(built);
  for (const problem of problems) console.error(`error: ${problem}`);
  if (problems.length) process.exit(1);
  console.log(`ok: ${built.index.stimuli.length} stimuli across ${built.index.categories.length} categories`);
} else {
  writeLibrary(built);
  const withArt = built.index.stimuli.filter((s) => s.image).length;
  console.log(
    `wrote ${built.index.stimuli.length} stimuli (${withArt} with real art) across ` +
      `${built.index.categories.length} categories, ${built.files.size} image files`,
  );
}
