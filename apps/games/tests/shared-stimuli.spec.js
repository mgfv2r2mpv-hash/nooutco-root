import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { classify, isImagePath, needsBodyToClassify } from './lib/stimuli.mjs';

/**
 * The shared stimulus library — one entry per stimulus, merged from the three
 * duplicated `_Resources` trees that clock, receptive and matching each carry.
 *
 * The merge's whole job is to prefer real art over a generated glyph on every
 * name collision, so the assertions that matter here are:
 *
 *   1. the committed library still matches the source trees (nobody added art
 *      to a game without rebuilding, and nobody hand-edited the output)
 *   2. every image the library publishes resolves AND classifies as real art —
 *      an emoji placeholder reaching `image` means the merge picked wrong
 *   3. no category carries less real art than the best any single game had at
 *      the origin/main baseline
 *   4. every file in the old trees is accounted for, so deleting them later is
 *      demonstrably lossless rather than hopefully lossless
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..');
const baseline = JSON.parse(readFileSync(path.join(HERE, 'fixtures/stimulus-baseline.json'), 'utf8'));

const LIBRARY_INDEX = '/shared/stimuli/stimuli.json';
const LIBRARY_PROVENANCE = '/shared/stimuli/provenance.json';
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Fetch with a bounded pool so a 200-asset sweep does not open 200 sockets. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await worker(items[i], i);
      }
    }));
  return results;
}

async function loadJson(request, urlPath) {
  const res = await request.get(urlPath);
  expect(res.status(), `${urlPath} should be served`).toBe(200);
  return res.json();
}

/**
 * The highest real-art count any single merged game had for a category at
 * baseline. Only the games the library actually merges count — ffc and
 * emotions keep their own art and are not part of this stage.
 */
function baselineHighWaterMark(sources) {
  const best = {};
  for (const game of sources) {
    for (const [category, counts] of Object.entries(baseline.games[game] || {})) {
      best[category] = Math.max(best[category] || 0, counts.art);
    }
  }
  return best;
}

// ── The committed library matches its sources ──────────────────────────────

test('the committed library is in sync with the source trees', () => {
  // Art can be added to a game tree by an AdminTools upload at any time; if the
  // library is not rebuilt, the games repointed at it silently never see it.
  const output = execFileSync('node', ['shared/stimuli/build.mjs', '--check'], {
    cwd: GAMES_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  expect(output).toContain('ok:');
});

// ── Index schema ───────────────────────────────────────────────────────────

test('stimuli.json is structurally valid', async ({ request }) => {
  const library = await loadJson(request, LIBRARY_INDEX);

  expect(library.schema, 'schema version').toBe(1);
  expect(library.basePath, 'basePath').toBe('/shared/stimuli/');
  expect(Array.isArray(library.sources), 'sources is an array').toBe(true);
  expect(Array.isArray(library.categories), 'categories is an array').toBe(true);
  expect(library.categories.length, 'categories is non-empty').toBeGreaterThan(0);
  expect(Array.isArray(library.stimuli), 'stimuli is an array').toBe(true);
  expect(library.stimuli.length, 'stimuli is non-empty').toBeGreaterThan(0);

  const ids = new Set();
  for (const entry of library.stimuli) {
    expect(typeof entry.id, `id is a string: ${JSON.stringify(entry).slice(0, 80)}`).toBe('string');
    expect(entry.id, `id "${entry.id}" is a slug`).toMatch(ID_RE);
    expect(ids.has(entry.id), `id "${entry.id}" is unique`).toBe(false);
    ids.add(entry.id);

    // Labels are data. Deriving them at render time is what let the lowercase
    // programme display uppercase letters and dropped the technician's
    // "Group Poster" override.
    expect(typeof entry.label, `"${entry.id}" has a label`).toBe('string');
    expect(entry.label.trim().length, `"${entry.id}" label is non-empty`).toBeGreaterThan(0);

    expect(Array.isArray(entry.categories), `"${entry.id}" categories is an array`).toBe(true);
    expect(entry.categories.length, `"${entry.id}" has a category`).toBeGreaterThan(0);
    for (const category of entry.categories) {
      expect(library.categories, `"${entry.id}" category "${category}" is declared`).toContain(category);
    }

    if (entry.image !== null) {
      expect(isImagePath(entry.image), `"${entry.id}" image is an image path`).toBe(true);
      expect(entry.image.startsWith(library.basePath), `"${entry.id}" image sits under basePath`).toBe(true);
    }
    if (entry.emoji !== null) {
      expect(typeof entry.emoji, `"${entry.id}" emoji is a string`).toBe('string');
      expect(entry.emoji.trim().length, `"${entry.id}" emoji is non-empty`).toBeGreaterThan(0);
      expect(['emoji', 'text'], `"${entry.id}" glyphKind`).toContain(entry.glyphKind);
    }

    // `placeholder` is the glyph SVG the old trees shipped, kept so a stimulus
    // with no art still has a URL to draw. It only exists where art does not:
    // publishing both would let a game index the placeholder over the photo.
    if (entry.placeholder !== undefined) {
      expect(entry.image, `"${entry.id}" has a placeholder only because it has no art`).toBeNull();
      expect(entry.placeholder.startsWith(`${library.basePath}placeholder/`),
        `"${entry.id}" placeholder sits under basePath`).toBe(true);
    }

    // Nothing may render blank in front of a learner.
    expect(
      entry.image !== null || entry.placeholder !== undefined,
      `"${entry.id}" has either art or a glyph fallback to draw`,
    ).toBe(true);

    for (const variant of entry.variants || []) {
      expect(isImagePath(variant), `"${entry.id}" variant is an image path`).toBe(true);
      expect(variant, `"${entry.id}" variant differs from its primary`).not.toBe(entry.image);
    }
  }
});

test('stimuli that share a file stem still get distinct ids', async ({ request }) => {
  const library = await loadJson(request, LIBRARY_INDEX);
  const byId = new Map(library.stimuli.map((s) => [s.id, s]));

  // `orange` is both a colour and a food; `a` and `A` collide on a
  // case-insensitive filesystem. Merging any of these onto one id would put a
  // photo of a fruit into a colour-matching array.
  for (const [a, b] of [['colors-orange', 'foods-orange'], ['lowercase-a', 'uppercase-a']]) {
    expect(byId.has(a), `${a} exists`).toBe(true);
    expect(byId.has(b), `${b} exists`).toBe(true);
  }
  expect(byId.get('lowercase-a').label, 'lowercase a keeps its case').toBe('a');
  expect(byId.get('uppercase-a').label, 'uppercase A keeps its case').toBe('A');
});

// ── Resolution + the merge's core promise ──────────────────────────────────

test('every image the library publishes resolves and is real art', async ({ request }) => {
  test.slow(); // a few hundred asset fetches

  const library = await loadJson(request, LIBRARY_INDEX);
  const published = library.stimuli.flatMap((entry) => [
    ...(entry.image ? [{ id: entry.id, urlPath: entry.image, role: 'image' }] : []),
    ...(entry.variants || []).map((v) => ({ id: entry.id, urlPath: v, role: 'variant' })),
  ]);
  expect(published.length, 'the library publishes art').toBeGreaterThan(0);

  const rows = await mapWithConcurrency(published, 12, async (item) => {
    const res = await request.get(item.urlPath);
    const body = res.ok() && needsBodyToClassify(item.urlPath) ? await res.text() : null;
    return { ...item, status: res.status(), classification: classify(item.urlPath, body) };
  });

  const broken = rows.filter((r) => r.status !== 200).map((r) => `${r.status} ${r.urlPath}`);
  expect(broken, 'library images that do not resolve').toEqual([]);

  // The merge exists to prefer real art. A placeholder glyph in `image` means
  // it picked a placeholder over a photograph that was sitting right there.
  const placeholders = rows.filter((r) => r.classification !== 'art').map((r) => `${r.id} -> ${r.urlPath}`);
  expect(placeholders, 'library images that are generated glyph placeholders').toEqual([]);
});

test('no category carries less real art than the best game had at baseline', async ({ request }) => {
  const library = await loadJson(request, LIBRARY_INDEX);

  const observed = {};
  for (const entry of library.stimuli) {
    for (const category of entry.categories) {
      observed[category] = (observed[category] || 0) + (entry.image ? 1 : 0);
    }
  }

  for (const game of library.sources) {
    expect(baseline.games[game], `${game} has a committed baseline`).toBeTruthy();
  }

  const regressions = [];
  for (const [category, want] of Object.entries(baselineHighWaterMark(library.sources))) {
    const got = observed[category] ?? 0;
    if (got < want) regressions.push(`${category}: ${got} real in the library, best game had ${want}`);
  }
  expect(regressions, 'categories the merge lost art from').toEqual([]);
});

test('the library serves real photographs for household and kitchen items', async ({ request }) => {
  // The clock/receptive repoint depends on this: both games serve nothing but
  // emoji placeholders for these two categories today.
  const library = await loadJson(request, LIBRARY_INDEX);

  for (const [category, minimum] of [['T_household_items', 11], ['T_kitchen_items', 19]]) {
    const entries = library.stimuli.filter((s) => s.categories.includes(category) && s.image);
    const resolved = await mapWithConcurrency(entries, 12, async (entry) => {
      const res = await request.get(entry.image);
      const body = res.ok() && needsBodyToClassify(entry.image) ? await res.text() : null;
      return { id: entry.id, urlPath: entry.image, classification: classify(entry.image, body) };
    });
    const art = resolved.filter((r) => r.classification === 'art');
    // eslint-disable-next-line no-console -- the resolved entries are the evidence
    console.log(`library/${category}: ${art.length} real\n  ` +
      art.map((r) => `${r.id}  ${r.urlPath}`).join('\n  '));
    expect(art.length, `${category} real art in the shared library`).toBeGreaterThanOrEqual(minimum);
  }

  const table = library.stimuli.find((s) => s.id === 'household-items-table');
  expect(table, 'table.jpg survived the merge').toBeTruthy();
  expect(table.image, 'table has real art, not a glyph').toBeTruthy();
});

// ── Nothing lost on the way in ─────────────────────────────────────────────

test('every file in the duplicated trees is accounted for', async ({ request }) => {
  const [library, provenance] = await Promise.all([
    loadJson(request, LIBRARY_INDEX),
    loadJson(request, LIBRARY_PROVENANCE),
  ]);

  const libraryFiles = new Set(
    library.stimuli.flatMap((s) => [
      ...(s.image ? [s.image] : []),
      ...(s.placeholder ? [s.placeholder] : []),
      ...(s.variants || []),
    ]),
  );
  const ids = new Set(library.stimuli.map((s) => s.id));

  const entries = Object.entries(provenance);
  expect(entries.length, 'provenance covers the source trees').toBeGreaterThan(0);

  const problems = [];
  for (const [servedPath, record] of entries) {
    if (!ids.has(record.stimulus)) problems.push(`${servedPath}: unknown stimulus "${record.stimulus}"`);
    if (record.library === null) {
      // A dropped file must say why. "unexplained" is emitted by the builder
      // when real art fell out of the merge without a rule accounting for it.
      if (!record.droppedBecause) problems.push(`${servedPath}: dropped with no reason`);
      else if (record.droppedBecause === 'unexplained') problems.push(`${servedPath}: real art dropped unexplained`);
    } else if (!libraryFiles.has(record.library)) {
      problems.push(`${servedPath}: maps to ${record.library}, which the library does not publish`);
    }
  }
  expect(problems, 'source files the library cannot account for').toEqual([]);
});
