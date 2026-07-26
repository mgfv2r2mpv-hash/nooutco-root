#!/usr/bin/env node
/**
 * Build the shared stimulus library from the three duplicated `_Resources`
 * trees carried by clock, receptive and matching, plus anything AdminTools has
 * uploaded into `shared/stimuli/uploads/`.
 *
 *   node shared/stimuli/build.mjs           # write the library AND the three game manifests
 *   node shared/stimuli/build.mjs --check   # rebuild in memory and diff; never writes
 *
 * The three trees hold the SAME item names at different quality, in different
 * formats, and with different manifest selections — `T_animals/bear.jpg` is
 * byte-identical between clock and receptive but a completely different photo
 * in matching. This script collapses them onto one entry per stimulus, keeps
 * every distinct piece of real art, and records where each file came from so
 * the eventual deletion of the duplicated trees is provably lossless.
 *
 * It then projects that library back out as one `manifest.json` per game — the
 * shape the games already consume — so each game keeps its own programme list
 * while every game reads the same art. The projection lives in `library.mjs`
 * because `worker.js` has to apply a single upload with the same rules,
 * without being able to run this script.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { classify, isImagePath, needsBodyToClassify } from '../../tests/lib/stimuli.mjs';
import {
  IMG_SUBDIR,
  PLACEHOLDER_SUBDIR,
  RASTER_EXTENSIONS,
  SITE_BASE,
  UPLOADS_SUBDIR,
  UPLOADS_URL_PREFIX,
  deriveLabel,
  emojiPlaceholderSvg,
  imageUrl,
  libraryFileName,
  liveGames,
  manifestStamp,
  placeholderUrl,
  projectManifest,
  publishingFrom,
  sortKeys,
  stableJson,
  stemOfId,
  stimulusId,
} from './library.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '../..');
const LIBRARY_DIR = HERE;
const IMG_DIR = path.join(LIBRARY_DIR, IMG_SUBDIR);
const PLACEHOLDER_DIR = path.join(LIBRARY_DIR, PLACEHOLDER_SUBDIR);
const UPLOADS_DIR = path.join(LIBRARY_DIR, UPLOADS_SUBDIR);
const OUTPUT_DIRS = [IMG_DIR, PLACEHOLDER_DIR];

/**
 * The manifests as they stood before this script started generating them.
 * Which files a technician had selected, and the labels they set, are inputs
 * to the merge — reading the live (generated) manifests back in would make the
 * ranking self-referential and let the library drift on every rebuild.
 */
const SOURCE_MANIFESTS = readJson(path.join(LIBRARY_DIR, 'source-manifests.json')).games;

/**
 * Source trees, in preference order. `uploads` leads because an image a
 * technician put there through AdminTools is an explicit choice, not one of
 * several shipped candidates. `matching` leads the rest because its manifest
 * is the one still being regenerated (2026-07-26 against 2026-05 for the other
 * two) and it carries the most curated real art — T_household_items and
 * T_kitchen_items are photographs there and emoji placeholders everywhere else.
 */
const SOURCE_ORDER = [UPLOADS_SUBDIR, 'matching', 'receptive', 'clock'];
const SOURCE_GAMES = SOURCE_ORDER.filter((s) => s !== UPLOADS_SUBDIR);

/** Placeholder SVGs drawn with an emoji font, as opposed to a text font. */
const EMOJI_FONT_RE = /font-family="[^"]*Emoji/i;
const TEXT_BODY_RE = /<text[^>]*>([\s\S]*?)<\/text>/i;

// ── Scanning ───────────────────────────────────────────────────────

function readJson(file, fallback) {
  if (fallback !== undefined && !fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

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
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function extractGlyph(body) {
  const match = body.match(TEXT_BODY_RE);
  if (!match) return null;
  const text = match[1].trim();
  if (!text) return null;
  return { text, kind: EMOJI_FONT_RE.test(body) ? 'emoji' : 'text' };
}

function describe({ source, servedPath, file, bytes, indexed, label }) {
  const body = needsBodyToClassify(file) ? bytes.toString('utf8') : null;
  const stem = path.basename(file).replace(/\.[^.]+$/, '');
  const category = path.basename(path.dirname(file));
  return {
    source,
    servedPath,
    category,
    stem,
    id: stimulusId(category, stem),
    extension: path.extname(file).toLowerCase(),
    classification: classify(file, body),
    indexed,
    label,
    glyph: body ? extractGlyph(body) : null,
    sha256: sha256(bytes),
    bytes,
  };
}

/**
 * Every image file in every source, tagged with the facts the merge needs:
 * what it is, whether a technician's manifest actually selected it, and its
 * content hash.
 *
 * @param {Array<{category: string, filename: string, bytes: Buffer}>} extraUploads
 *   uploads that exist only in memory. The tests use this to ask "what would a
 *   rebuild produce?" without writing into the working tree.
 */
function collectCandidates(extraUploads = []) {
  const candidates = [];

  for (const game of SOURCE_GAMES) {
    const treeRoot = path.join(GAMES_ROOT, game, '_Resources', '_imgSource');
    if (!fs.existsSync(treeRoot)) continue;

    const manifest = SOURCE_MANIFESTS[game];
    const indexed = new Set(Object.values(manifest.images || {}).flat());
    const displayNames = manifest.displayNames || {};

    for (const file of walk(treeRoot)) {
      if (!isImagePath(file)) continue;
      const gameRelative = toPosix(path.relative(path.join(GAMES_ROOT, game), file));
      candidates.push(describe({
        source: game,
        servedPath: `/${game}/${gameRelative}`,
        file,
        bytes: fs.readFileSync(file),
        indexed: indexed.has(gameRelative),
        label: displayNames[gameRelative],
      }));
    }
  }

  const uploaded = fs.existsSync(UPLOADS_DIR)
    ? walk(UPLOADS_DIR).filter(isImagePath).map((file) => ({ file, bytes: fs.readFileSync(file) }))
    : [];
  for (const { file, bytes } of uploaded) {
    candidates.push(describe({
      source: UPLOADS_SUBDIR,
      servedPath: `${UPLOADS_URL_PREFIX}${toPosix(path.relative(UPLOADS_DIR, file))}`,
      file,
      bytes,
      indexed: true,
      label: undefined,
    }));
  }
  for (const upload of extraUploads) {
    candidates.push(describe({
      source: UPLOADS_SUBDIR,
      servedPath: `${UPLOADS_URL_PREFIX}${upload.category}/${upload.filename}`,
      file: path.join(UPLOADS_DIR, upload.category, upload.filename),
      bytes: upload.bytes,
      indexed: true,
      label: undefined,
    }));
  }

  return candidates;
}

// ── The canonical core vocabulary ──────────────────────────────────

/**
 * `vocabulary.json` indexed by stimulus id, with every word checked against the
 * one rule that makes it joinable: its id has to be the id the merge would
 * derive for a file called `<name>` sitting in `<category>`. A word whose id
 * drifts from its name would seed a second entry beside the art it meant to
 * label, and nothing downstream would notice.
 */
function readVocabulary(vocabulary) {
  const doc = vocabulary || readJson(path.join(LIBRARY_DIR, 'vocabulary.json'), { words: [] });
  const words = new Map();

  for (const word of doc.words || []) {
    for (const field of ['id', 'category', 'name', 'label']) {
      if (typeof word[field] !== 'string' || !word[field].trim()) {
        throw new Error(`vocabulary: "${word.id || '?'}" is missing ${field}`);
      }
    }
    if (!('emoji' in word)) throw new Error(`vocabulary: "${word.id}" must declare an emoji, even if null`);
    if (stimulusId(word.category, word.name) !== word.id) {
      throw new Error(
        `vocabulary: "${word.id}" does not match ${word.category}/${word.name} `
          + `(that names ${stimulusId(word.category, word.name)})`,
      );
    }
    if (stemOfId(word.category, word.id) !== word.name) {
      throw new Error(`vocabulary: "${word.id}" is not "${word.name}" in ${word.category}`);
    }
    if (words.has(word.id)) throw new Error(`vocabulary: "${word.id}" is listed twice`);
    words.set(word.id, word);
  }

  return words;
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
    SOURCE_ORDER.indexOf(candidate.source),
    candidate.servedPath,
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

/**
 * The art files one stimulus publishes, in order, plus a drop reason for every
 * candidate that did not make it.
 *
 * An upload is authoritative: it supersedes every other art candidate rather
 * than joining them as an unpublished variant. Only one URL per stimulus is
 * ever served, so keeping the old file would buy nothing and would force the
 * rebuild to rename files on each upload — churn `worker.js` cannot mirror,
 * and the two have to agree or an upload goes live wrong.
 */
function selectArt(group, category, claimed) {
  const art = [];
  const seen = new Set();
  const uploaded = group.some((c) => c.classification === 'art' && c.source === UPLOADS_SUBDIR);

  for (const candidate of group) {
    if (candidate.classification !== 'art') continue;
    if (uploaded && candidate.source !== UPLOADS_SUBDIR) {
      candidate.dropReason = 'superseded-by-upload';
      continue;
    }
    if (uploaded && art.length) {
      candidate.dropReason = 'superseded-by-upload';
      continue;
    }
    if (seen.has(candidate.sha256)) continue;
    // Two stimuli in one category must never resolve to the same bytes:
    // receptive ships `on.png` as a byte copy of `above.png`, so one picture
    // gets asked about under two names. An explicit upload is exempt — that
    // duplication is the technician's call, not a shipping accident.
    const owner = claimed.get(candidate.sha256);
    if (owner && owner !== candidate.id && candidate.source !== UPLOADS_SUBDIR) {
      candidate.dropReason = `duplicate-of:${category}/${owner}`;
      continue;
    }
    seen.add(candidate.sha256);
    art.push(candidate);
  }
  return art;
}

function buildLibrary(options = {}) {
  const { extraUploads = [], labels: labelsOverride, liveManifests } = options;
  const candidates = collectCandidates(extraUploads);

  const labels = labelsOverride || readJson(path.join(LIBRARY_DIR, 'labels.json'), { overrides: {} }).overrides || {};
  const publishing = options.publishing || readJson(path.join(LIBRARY_DIR, 'publishing.json'), { excluded: {} });
  const topicNames = options.topicNames || readJson(path.join(LIBRARY_DIR, 'topics.json'), { names: {} }).names || {};
  const vocabulary = readVocabulary(options.vocabulary);

  /** category -> stimulus id -> candidates */
  const byCategory = new Map();
  for (const candidate of candidates) {
    if (!byCategory.has(candidate.category)) byCategory.set(candidate.category, new Map());
    const ids = byCategory.get(candidate.category);
    if (!ids.has(candidate.id)) ids.set(candidate.id, []);
    ids.get(candidate.id).push(candidate);
  }

  // A core word is a stimulus whether or not a file for it exists yet: seeding
  // the vocabulary is what puts a word in front of a learner before anyone has
  // photographed it, and the emoji fallback is what it is drawn as until then.
  for (const word of vocabulary.values()) {
    if (!byCategory.has(word.category)) byCategory.set(word.category, new Map());
    const ids = byCategory.get(word.category);
    if (!ids.has(word.id)) ids.set(word.id, []);
  }

  const categories = [...byCategory.keys()].sort();
  const stimuli = [];
  const provenance = {};
  const files = new Map(); // library-relative path -> bytes
  const warnings = [];

  for (const category of categories) {
    const claimed = new Map(); // content hash -> the stimulus id that kept it
    const ids = [...byCategory.get(category).keys()].sort();

    for (const id of ids) {
      const group = byCategory.get(category).get(id).slice().sort(compareRank);
      const art = selectArt(group, category, claimed);
      for (const candidate of group) {
        if (candidate.dropReason && candidate.dropReason.startsWith('duplicate-of:')) {
          warnings.push(
            `${category}/${id}: skipped ${candidate.servedPath} — byte-identical to ${candidate.dropReason.slice(13)}`,
          );
        }
      }

      // Every spelling in the group names the same stimulus (`mail-carrier`
      // and `mail_carrier` share an id), so the best-ranked one names the file.
      // A core word with no file at all names itself.
      const word = vocabulary.get(id) || null;
      const canonicalStem = art[0]?.stem ?? group[0]?.stem ?? word.name;
      const glyphSource = group.find((c) => c.glyph);
      const labelOverride = group.map((c) => c.label).find((l) => typeof l === 'string' && l.trim());

      // Labels: a technician's own override first, then the curated vocabulary,
      // then whatever a pre-repoint manifest happened to have frozen, then the
      // filename. The vocabulary sits above the frozen label because a filename
      // is what the frozen label was usually derived from in the first place.
      const label = labels[id]
        || (word ? word.label : null)
        || (labelOverride ? labelOverride.trim() : deriveLabel(canonicalStem));

      const entry = {
        id,
        label,
        categories: [category],
        image: null,
        emoji: (word && word.emoji) || (glyphSource ? glyphSource.glyph.text : null),
      };
      if (word && word.emoji) entry.glyphKind = 'emoji';
      else if (glyphSource) entry.glyphKind = glyphSource.glyph.kind;

      // The glyph a shipped placeholder actually draws and the glyph the
      // vocabulary records have to be the same character. They are two
      // descriptions of one picture, and a learner sees the file.
      if (word && word.emoji && glyphSource && !art.length && glyphSource.glyph.text !== word.emoji) {
        throw new Error(
          `vocabulary: "${id}" says ${word.emoji} but ${glyphSource.servedPath} draws `
            + `${glyphSource.glyph.text}`,
        );
      }

      const variants = [];
      art.forEach((candidate, index) => {
        // Only shipped art claims a hash. An upload must never demote another
        // stimulus, or `worker.js` — which sees one file, not the whole tree —
        // would publish something a rebuild then takes away.
        if (candidate.source !== UPLOADS_SUBDIR) claimed.set(candidate.sha256, id);
        const relative = `${IMG_SUBDIR}/${category}/${libraryFileName(canonicalStem, candidate.extension, index)}`;
        if (files.has(relative)) throw new Error(`library file name collision: ${relative}`);
        files.set(relative, candidate.bytes);
        if (index === 0) entry.image = imageUrl(category, libraryFileName(canonicalStem, candidate.extension, 0));
        else variants.push(SITE_BASE + relative);
      });
      if (variants.length) entry.variants = variants;

      // A stimulus with no real art still has to render something, and the
      // games draw an `<img>`. So the emoji lives on as the placeholder SVG
      // the trees already shipped, kept byte-for-byte: the repoint changes
      // where a glyph is served from and nothing about how it looks. `emoji`
      // and `glyphKind` carry the same glyph as data, for a later render that
      // does not need a file at all.
      let placeholderSource = null;
      if (!entry.image && glyphSource) {
        placeholderSource = glyphSource;
        const fileName = libraryFileName(canonicalStem, glyphSource.extension, 0);
        const relative = `${PLACEHOLDER_SUBDIR}/${category}/${fileName}`;
        if (files.has(relative)) throw new Error(`library file name collision: ${relative}`);
        files.set(relative, glyphSource.bytes);
        entry.placeholder = placeholderUrl(category, fileName);
      } else if (!entry.image && entry.emoji) {
        // A seeded word has no file anywhere, so its glyph is drawn rather than
        // copied. Same 200×200 emoji card the trees shipped, so the two kinds
        // of placeholder are indistinguishable to a game.
        const fileName = libraryFileName(canonicalStem, '.svg', 0);
        const relative = `${PLACEHOLDER_SUBDIR}/${category}/${fileName}`;
        if (files.has(relative)) throw new Error(`library file name collision: ${relative}`);
        files.set(relative, Buffer.from(emojiPlaceholderSvg(entry.emoji), 'utf8'));
        entry.placeholder = placeholderUrl(category, fileName);
      }

      if (!entry.image && !entry.placeholder) {
        // A core word is data someone wrote down, so a blank one is a mistake
        // to fix rather than a gap to report: it has no file to fall back on.
        if (word) throw new Error(`vocabulary: "${id}" has neither art nor an emoji — it would render blank`);
        warnings.push(`${category}/${id}: no art and no glyph — would render blank`);
      }

      stimuli.push(entry);

      // Provenance: every served path in the old trees mapped to whatever in
      // the library now carries those bytes. A null `library` always carries a
      // `droppedBecause`, so deleting the duplicated trees can be shown to
      // lose nothing that was not deliberately dropped.
      for (const candidate of group) {
        const keptIndex = art.findIndex((a) => a.sha256 === candidate.sha256);
        const record = {
          stimulus: id,
          sha256: candidate.sha256,
          library:
            keptIndex === -1
              ? null
              : SITE_BASE
                + `${IMG_SUBDIR}/${category}/${libraryFileName(canonicalStem, art[keptIndex].extension, keptIndex)}`,
        };
        if (!record.library && placeholderSource && candidate.sha256 === placeholderSource.sha256) {
          record.library = entry.placeholder;
        }
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
      'Shared stimulus library. Generated from the clock, receptive and matching _Resources trees ' +
      'plus shared/stimuli/uploads/ by shared/stimuli/build.mjs — change that script or the source ' +
      'art, never this file.',
    sources: SOURCE_GAMES,
    uploads: `${UPLOADS_SUBDIR}/`,
    basePath: SITE_BASE,
    categories,
    stimuli,
  };

  // Sorted before it is projected, not just before it is written: the Worker
  // reads the committed (sorted) file, so an unsorted in-memory projection
  // would order `pathAliases` differently and the two would never match.
  const sorted = sortKeys(provenance);

  const stamp = manifestStamp(sha256(stableJson(index)));
  const games = liveGames({ manifests: liveManifests || readLiveManifests(), publishing, topicNames });
  const manifests = {};
  for (const [game, config] of Object.entries(games)) {
    manifests[game] = projectManifest(index, sorted, { game, ...config, stamp });
  }

  return { index, provenance: sorted, files, warnings, manifests, publishing: publishingFrom(games) };
}

/**
 * `folders` and `archived` are a technician's programme state, and after the
 * repoint the generated manifest is the only place they live. Reading them
 * back is deliberate and narrow: a topic added through AdminTools must survive
 * a rebuild. Nothing here feeds art ranking, which reads only the frozen
 * `source-manifests.json`.
 */
function readLiveManifests() {
  const manifests = {};
  for (const [game, source] of Object.entries(SOURCE_MANIFESTS)) {
    const live = readJson(path.join(GAMES_ROOT, game, 'manifest.json'), null);
    manifests[game] = live && Array.isArray(live.folders)
      ? live
      : { folders: source.folders, archived: source.archived || {} };
  }
  return manifests;
}

// ── Output ─────────────────────────────────────────────────────────

/** Every generated file, as `<path relative to apps/games>` -> serialised text. */
function generatedDocuments({ index, provenance, manifests, publishing }) {
  const documents = new Map([
    ['shared/stimuli/stimuli.json', stableJson(index)],
    ['shared/stimuli/provenance.json', stableJson(provenance)],
    ['shared/stimuli/publishing.json', stableJson(publishing)],
  ]);
  for (const [game, manifest] of Object.entries(manifests)) {
    documents.set(`${game}/manifest.json`, stableJson(manifest));
  }
  return documents;
}

function writeLibrary(built) {
  for (const dir of OUTPUT_DIRS) fs.rmSync(dir, { recursive: true, force: true });
  for (const [relative, bytes] of built.files) {
    const target = path.join(LIBRARY_DIR, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }
  for (const [relative, text] of generatedDocuments(built)) {
    fs.writeFileSync(path.join(GAMES_ROOT, relative), text);
  }
}

function checkLibrary(built) {
  const problems = [];

  for (const [relative, text] of generatedDocuments(built)) {
    const committed = path.join(GAMES_ROOT, relative);
    if (!fs.existsSync(committed)) {
      problems.push(`${relative} is missing — run: npm run stimuli:build`);
    } else if (fs.readFileSync(committed, 'utf8') !== text) {
      problems.push(`${relative} is stale — run: npm run stimuli:build`);
    }
  }

  for (const [relative, bytes] of built.files) {
    const target = path.join(LIBRARY_DIR, relative);
    if (!fs.existsSync(target)) problems.push(`missing library file: ${relative}`);
    else if (!fs.readFileSync(target).equals(bytes)) problems.push(`library file differs from source: ${relative}`);
  }

  const onDisk = OUTPUT_DIRS.filter((dir) => fs.existsSync(dir)).flatMap((dir) =>
    walk(dir).map((f) => toPosix(path.relative(LIBRARY_DIR, f))),
  );
  for (const relative of onDisk) {
    if (!built.files.has(relative)) problems.push(`unexpected library file: ${relative}`);
  }

  return problems;
}

export { buildLibrary, generatedDocuments };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
}
