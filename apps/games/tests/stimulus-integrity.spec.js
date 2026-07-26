import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  STIMULUS_SOURCES,
  entriesFor,
  classify,
  isEmojiPlaceholder,
  isImagePath,
  needsBodyToClassify,
  summarize,
} from './lib/stimuli.mjs';

/**
 * Safety net for the stimulus pipeline.
 *
 * clock, receptive and matching each carry their own copy of the same art with
 * their own manifest, and those manifests have already drifted apart. Before
 * any of that gets merged into a shared library, this spec pins down three
 * things that must survive the merge:
 *
 *   1. every stimulus index is structurally valid
 *   2. every path an index publishes actually resolves (a 404 here is a blank
 *      card in front of a learner mid-trial)
 *   3. no category serves less REAL art than the committed baseline
 *
 * (3) is the one that matters most: merging three trees "preferring real art"
 * is exactly the operation that can quietly drop art on a name collision.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const baseline = JSON.parse(readFileSync(path.join(HERE, 'fixtures/stimulus-baseline.json'), 'utf8'));

const CATEGORY_RE = /^[A-Za-z][\w-]*$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

/**
 * A repointed manifest is generated from the shared library, so its build
 * stamp is the library's content hash rather than a wall-clock time — the
 * build has to be reproducible for `npm run stimuli:check` to mean anything.
 */
const LIBRARY_STAMP_RE = /^shared-stimuli:[0-9a-f]{12}$/;

/** The only absolute prefix a manifest may publish images under. */
const LIBRARY_BASE = '/shared/stimuli/';

/** Fetch with a bounded pool so a 500-asset sweep does not open 500 sockets. */
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

function resolveUrlPath(base, relative) {
  return new URL(relative, `http://localhost${base}`).pathname;
}

async function loadIndex(request, source) {
  const res = await request.get(source.index);
  expect(res.status(), `${source.index} should be served`).toBe(200);
  return res.json();
}

// ── Classifier ─────────────────────────────────────────────────────────────
// The merge in the next stage hinges entirely on telling a generated glyph
// placeholder apart from real art, and it cannot be done by filename.

test.describe('emoji placeholder detection', () => {
  const GLYPH_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">\n' +
    '  <text x="100" y="125" text-anchor="middle" font-size="95" font-family="Apple Color Emoji,sans-serif">🛏️</text>\n' +
    '</svg>';
  const VECTOR_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">\n' +
    '  <rect x="60" y="115" width="80" height="70" fill="#4299e1"/>\n' +
    '  <circle cx="100" cy="55" r="28" fill="#e53e3e"/>\n' +
    '</svg>';

  test('a single-<text> SVG is a placeholder regardless of its filename', () => {
    expect(isEmojiPlaceholder('bed.svg', GLYPH_SVG)).toBe(true);
    // real art and placeholders share a naming scheme, so the name proves nothing
    expect(isEmojiPlaceholder('above.svg', GLYPH_SVG)).toBe(true);
  });

  test('hand-authored vector art is not a placeholder', () => {
    expect(isEmojiPlaceholder('above.svg', VECTOR_SVG)).toBe(false);
    expect(classify('above.svg', VECTOR_SVG)).toBe('art');
  });

  test('raster art is never a placeholder and needs no body read', () => {
    for (const name of ['table.jpg', 'sofa.webp', 'clock.png']) {
      expect(isEmojiPlaceholder(name, null)).toBe(false);
      expect(needsBodyToClassify(name)).toBe(false);
    }
    expect(needsBodyToClassify('bed.svg')).toBe(true);
  });
});

// ── Index schemas ──────────────────────────────────────────────────────────

for (const source of STIMULUS_SOURCES.filter((s) => s.kind === 'manifest')) {
  test(`${source.game}: manifest.json is structurally valid`, async ({ request }) => {
    const manifest = await loadIndex(request, source);

    expect(
      ISO_DATE_RE.test(manifest.generated) || LIBRARY_STAMP_RE.test(manifest.generated),
      `generated is an ISO timestamp or a library stamp, got "${manifest.generated}"`,
    ).toBe(true);
    expect(Array.isArray(manifest.folders), 'folders is an array').toBe(true);
    expect(manifest.folders.length, 'folders is non-empty').toBeGreaterThan(0);
    expect(new Set(manifest.folders).size, 'folders has no duplicates').toBe(manifest.folders.length);
    for (const folder of manifest.folders) expect(folder).toMatch(CATEGORY_RE);

    expect(typeof manifest.images, 'images is an object').toBe('object');
    expect(typeof manifest.displayNames, 'displayNames is an object').toBe('object');
    expect(typeof manifest.archived, 'archived is an object').toBe('object');

    const indexed = new Set();
    for (const folder of manifest.folders) {
      const paths = manifest.images[folder];
      expect(Array.isArray(paths), `images["${folder}"] is an array`).toBe(true);
      expect(paths.length, `images["${folder}"] is non-empty`).toBeGreaterThan(0);
      for (const p of paths) {
        expect(typeof p, `${folder} entry is a string`).toBe('string');
        expect(isImagePath(p), `${p} has an image extension`).toBe(true);
        // Either still game-relative, or an explicit shared-library URL. Any
        // other absolute path would silently escape the game's own asset tree.
        expect(
          !p.startsWith('/') || p.startsWith(LIBRARY_BASE),
          `${p} is game-relative or under ${LIBRARY_BASE}`,
        ).toBe(true);
        expect(indexed.has(p), `${p} is indexed exactly once`).toBe(false);
        indexed.add(p);
      }
    }

    // Every folder the manifest publishes images for must be declared.
    for (const folder of Object.keys(manifest.images)) {
      expect(manifest.folders, `images key "${folder}" is a declared folder`).toContain(folder);
    }

    // A displayName keyed off a path nobody serves is dead config — a label a
    // technician saved that will never render. A key left over from before the
    // shared-library repoint is fine only because the games fold it forward
    // through pathAliases; anything else names nothing.
    const aliases = manifest.pathAliases || {};
    for (const [key, label] of Object.entries(manifest.displayNames)) {
      expect(
        indexed.has(key) || indexed.has(aliases[key]),
        `displayName key "${key}" reaches an indexed image, directly or via pathAliases`,
      ).toBe(true);
      expect(typeof label, `displayName for "${key}" is a string`).toBe('string');
      expect(label.trim().length, `displayName for "${key}" is non-empty`).toBeGreaterThan(0);
    }

    // pathAliases is the migration table the games apply on load: every URL
    // this game used to serve must still name a picture it serves today, or a
    // saved target selection loses that stimulus without saying so.
    for (const [legacy, url] of Object.entries(aliases)) {
      expect(typeof legacy, 'pathAliases key is a string').toBe('string');
      expect(indexed.has(url), `pathAliases["${legacy}"] -> "${url}" is indexed`).toBe(true);
    }
  });
}

test('ffc: items.json is structurally valid', async ({ request }) => {
  const data = await loadIndex(request, STIMULUS_SOURCES.find((s) => s.game === 'ffc'));

  expect(data.generated).toMatch(ISO_DATE_RE);
  expect(Array.isArray(data.items)).toBe(true);
  expect(data.items.length).toBeGreaterThan(0);

  const ids = new Set();
  for (const item of data.items) {
    expect(typeof item.id, `item id is a string: ${JSON.stringify(item).slice(0, 80)}`).toBe('string');
    expect(item.id.length, 'item id is non-empty').toBeGreaterThan(0);
    expect(ids.has(item.id), `item id "${item.id}" is unique`).toBe(false);
    ids.add(item.id);

    // Labels are authored data, never derived from the filename.
    expect(typeof item.label, `item "${item.id}" has a label`).toBe('string');
    expect(item.label.trim().length, `item "${item.id}" label is non-empty`).toBeGreaterThan(0);
    expect(isImagePath(item.img), `item "${item.id}" img is an image path`).toBe(true);

    for (const key of ['groups', 'features', 'functions', 'classes']) {
      expect(Array.isArray(item[key]), `item "${item.id}" ${key} is an array`).toBe(true);
    }
  }
});

test('intraverbal: items.json is structurally valid', async ({ request }) => {
  const res = await request.get('/intraverbal/items.json');
  expect(res.status()).toBe(200);
  const data = await res.json();

  expect(data.generated).toMatch(ISO_DATE_RE);
  expect(Array.isArray(data.categories)).toBe(true);
  expect(Array.isArray(data.items)).toBe(true);
  expect(data.items.length).toBeGreaterThan(0);

  const ids = new Set();
  for (const item of data.items) {
    expect(typeof item.id, 'item id is a string').toBe('string');
    expect(ids.has(item.id), `item id "${item.id}" is unique`).toBe(false);
    ids.add(item.id);
    expect(typeof item.label, `item "${item.id}" has a label`).toBe('string');
    expect(item.label.trim().length, `item "${item.id}" label is non-empty`).toBeGreaterThan(0);
    expect(Array.isArray(item.carriers), `item "${item.id}" carriers is an array`).toBe(true);
    expect(item.carriers.length, `item "${item.id}" has at least one carrier`).toBeGreaterThan(0);
  }

  for (const [category, ids_] of Object.entries(data.categoryItems || {})) {
    expect(data.categories, `categoryItems key "${category}" is a declared category`).toContain(category);
    for (const id of ids_) expect(ids.has(id), `category "${category}" references known item "${id}"`).toBe(true);
  }
});

for (const game of ['patterns', 'sequences']) {
  test(`${game}: symbols.json is structurally valid`, async ({ request }) => {
    const res = await request.get(`/${game}/symbols.json`);
    expect(res.status()).toBe(200);
    const data = await res.json();

    expect(data.generated).toMatch(ISO_DATE_RE);
    expect(typeof data.sets).toBe('object');
    const names = Object.keys(data.sets);
    expect(names.length, 'at least one symbol set').toBeGreaterThan(0);
    for (const name of names) {
      const symbols = data.sets[name];
      expect(Array.isArray(symbols), `set "${name}" is an array`).toBe(true);
      expect(symbols.length, `set "${name}" is non-empty`).toBeGreaterThan(0);
      expect(new Set(symbols).size, `set "${name}" has no duplicate symbols`).toBe(symbols.length);
      for (const symbol of symbols) {
        expect(typeof symbol, `set "${name}" symbol is a string`).toBe('string');
        expect(symbol.trim().length, `set "${name}" symbol is non-empty`).toBeGreaterThan(0);
      }
    }
  });
}

// ── Resolution + no-regression sweep ───────────────────────────────────────

for (const source of STIMULUS_SOURCES) {
  test(`${source.game}: every indexed stimulus resolves and keeps its real art`, async ({ request }) => {
    test.slow(); // several hundred asset fetches per game

    const index = source.index ? await loadIndex(request, source) : null;
    const entries = entriesFor(source, index);
    expect(entries.length, `${source.game} indexes at least one stimulus`).toBeGreaterThan(0);

    const rows = await mapWithConcurrency(entries, 12, async (entry) => {
      const urlPath = resolveUrlPath(source.base, entry.path);
      const res = await request.get(urlPath);
      const body = res.ok() && needsBodyToClassify(urlPath) ? await res.text() : null;
      return {
        ...entry,
        urlPath,
        status: res.status(),
        classification: classify(urlPath, body),
      };
    });

    const broken = rows.filter((r) => r.status !== 200).map((r) => `${r.status} ${r.urlPath}`);
    expect(broken, `${source.game}: indexed stimuli that do not resolve`).toEqual([]);

    const observed = summarize(rows);
    const expected = baseline.games[source.game];
    expect(expected, `${source.game} has a committed baseline`).toBeTruthy();

    // Real art may only ever go UP. A category that vanishes entirely counts
    // as losing all of its art, so missing categories are caught here too.
    const regressions = [];
    for (const [category, want] of Object.entries(expected)) {
      const got = observed[category];
      if (!got) {
        if (want.art > 0) regressions.push(`${category}: category gone, baseline had ${want.art} real`);
        continue;
      }
      if (got.art < want.art) {
        regressions.push(`${category}: ${got.art} real now, baseline had ${want.art}`);
      }
    }
    expect(regressions, `${source.game}: categories serving less real art than the baseline`).toEqual([]);
  });
}

// ── Rendered art, not just indexed art ─────────────────────────────────────

test('matching renders real photographs for household and kitchen items', async ({ request }) => {
  // Proof-by-manifest: list the resolved entries and show what they actually are.
  const source = STIMULUS_SOURCES.find((s) => s.game === 'matching');
  const manifest = await loadIndex(request, source);

  for (const category of ['T_household_items', 'T_kitchen_items']) {
    const paths = manifest.images[category] || [];
    const resolved = await mapWithConcurrency(paths, 12, async (p) => {
      const urlPath = resolveUrlPath(source.base, p);
      const res = await request.get(urlPath);
      const body = res.ok() && needsBodyToClassify(urlPath) ? await res.text() : null;
      return { urlPath, classification: classify(urlPath, body) };
    });
    const art = resolved.filter((r) => r.classification === 'art');
    // eslint-disable-next-line no-console -- the resolved entries are the evidence
    console.log(`matching/${category}: ${art.length}/${resolved.length} real\n  ` +
      art.map((r) => r.urlPath).join('\n  '));
    expect(art.length, `matching/${category} serves real art`).toBe(baseline.games.matching[category].art);
  }
});

test('an <img> pointing at real art decodes to a non-trivial bitmap', async ({ page }) => {
  // Guards the other half of "renders a real photograph": the asset has to be
  // decodable by the browser, not merely 200. An emoji placeholder decodes too,
  // so this is a rendering check, not a classification check.
  const source = STIMULUS_SOURCES.find((s) => s.game === 'matching');
  const manifest = await (await page.request.get(source.index)).json();
  const sample = (manifest.images.T_household_items || []).slice(0, 3);
  expect(sample.length, 'household items to sample').toBeGreaterThan(0);

  await page.goto(source.base);
  const decoded = await page.evaluate(async (paths) => {
    const results = [];
    for (const p of paths) {
      const img = new Image();
      img.src = p;
      try {
        await img.decode();
        results.push({ src: p, w: img.naturalWidth, h: img.naturalHeight });
      } catch (err) {
        results.push({ src: p, w: 0, h: 0, error: String(err) });
      }
    }
    return results;
  }, sample);

  for (const r of decoded) {
    expect(r.w, `${r.src} decodes with a real width`).toBeGreaterThan(1);
    expect(r.h, `${r.src} decodes with a real height`).toBeGreaterThan(1);
  }
});
