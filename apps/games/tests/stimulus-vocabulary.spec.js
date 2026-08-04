import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { classify, needsBodyToClassify } from './lib/stimuli.mjs';
import { buildLibrary } from '../shared/stimuli/build.mjs';
import { emojiPlaceholderSvg, stemOfId, stimulusId } from '../shared/stimuli/library.mjs';

/**
 * The canonical core vocabulary - the everyday words a learner is taught to
 * name, held as data in `shared/stimuli/vocabulary.json` rather than inferred
 * from whatever files happen to exist.
 *
 * Three things have to hold for that to be worth anything:
 *
 *   1. a word is joinable - its id is exactly the id the merge derives for a
 *      file called `<name>` in `<category>`, so art added later lands on the
 *      word instead of beside it
 *   2. a word renders - art if there is any, otherwise the glyph its `emoji`
 *      names, drawn as a real file because the games draw an `<img>`
 *   3. the games the objective names actually offer the core: clock and
 *      receptive publish every word, under the vocabulary's own label
 *
 * The build-level assertions run `buildLibrary()` in memory with a doctored
 * vocabulary, which is the only way to reach the failure modes the committed
 * data is (deliberately) free of.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..');

const VOCABULARY = JSON.parse(readFileSync(path.join(GAMES_ROOT, 'shared/stimuli/vocabulary.json'), 'utf8'));
const CONSUMERS = ['clock', 'receptive'];

/** The nine naming domains the objective seeds, however they are keyed. */
const REQUIRED_DOMAINS = [
  'household', 'kitchen', 'clothing', 'food', 'hygiene', 'school', 'community', 'toy', 'vehicle',
];

async function loadJson(request, urlPath) {
  const res = await request.get(urlPath);
  expect(res.status(), `${urlPath} should be served`).toBe(200);
  return res.json();
}

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

const LIBRARY = JSON.parse(readFileSync(path.join(GAMES_ROOT, 'shared/stimuli/stimuli.json'), 'utf8'));
const PROVENANCE = JSON.parse(readFileSync(path.join(GAMES_ROOT, 'shared/stimuli/provenance.json'), 'utf8'));

/**
 * Placeholder URLs a source tree shipped, as opposed to ones the build drew.
 * Provenance only ever records source files, so a placeholder that turns up as
 * a `library` value there is one whose bytes came off disk.
 */
const SHIPPED_PLACEHOLDERS = new Set(
  Object.values(PROVENANCE)
    .map((record) => record.library)
    .filter((url) => url && url.startsWith('/shared/stimuli/placeholder/')),
);

/**
 * A core word still rendered by a glyph SVG a tree shipped - found rather than
 * named, because a word gains a photograph the moment one is added for it and a
 * hard-coded subject silently stops testing what it says it tests.
 */
function wordWithShippedGlyph() {
  const ids = new Set(VOCABULARY.words.map((w) => w.id));
  const entry = LIBRARY.stimuli.find(
    (s) => ids.has(s.id) && !s.image && s.placeholder && SHIPPED_PLACEHOLDERS.has(s.placeholder),
  );
  expect(entry, 'some core word still renders as a glyph a tree shipped').toBeTruthy();
  return entry;
}

/** Rebuild in memory with one word altered, and return the error it raises. */
function buildWith(mutate) {
  const vocabulary = JSON.parse(JSON.stringify(VOCABULARY));
  mutate(vocabulary);
  try {
    buildLibrary({ vocabulary });
    return null;
  } catch (error) {
    return error.message;
  }
}

// ── The file itself ────────────────────────────────────────────────────────

test('vocabulary.json is structurally valid and joinable', () => {
  expect(VOCABULARY.schema, 'schema version').toBe(1);
  expect(Array.isArray(VOCABULARY.core), 'core is an array of categories').toBe(true);
  expect(Array.isArray(VOCABULARY.words), 'words is an array').toBe(true);

  // "~100 common early functional English words" is the seed size the stage
  // asks for; a file that quietly shrank below it is not the core any more.
  expect(VOCABULARY.words.length, 'the core is seeded').toBeGreaterThanOrEqual(100);

  const ids = new Set();
  for (const word of VOCABULARY.words) {
    expect(typeof word.label, `"${word.id}" has a label`).toBe('string');
    expect(word.label.trim().length, `"${word.id}" label is non-empty`).toBeGreaterThan(0);
    expect(VOCABULARY.core, `"${word.id}" sits in a declared core topic`).toContain(word.category);

    // The join rule. `name` is the file stem art for this word is stored under,
    // so an id that does not round-trip through it would seed a second entry
    // beside the photograph it was written to label.
    expect(stimulusId(word.category, word.name), `"${word.id}" is ${word.category}/${word.name}`)
      .toBe(word.id);
    expect(stemOfId(word.category, word.id), `"${word.id}" recovers its own stem`).toBe(word.name);

    expect(ids.has(word.id), `"${word.id}" is listed once`).toBe(false);
    ids.add(word.id);

    expect('emoji' in word, `"${word.id}" states an emoji, even if null`).toBe(true);
    if (word.emoji !== null) expect(word.emoji.trim().length, `"${word.id}" emoji`).toBeGreaterThan(0);
  }
});

test('the core covers every domain the stage names', () => {
  const missing = REQUIRED_DOMAINS.filter(
    (domain) => !VOCABULARY.core.some((category) => category.toLowerCase().includes(domain)),
  );
  expect(missing, 'naming domains with no core topic').toEqual([]);
});

// ── Every word is in the library, and renders ──────────────────────────────

test('every core word is a library stimulus with the vocabulary\'s label', async ({ request }) => {
  const library = await loadJson(request, '/shared/stimuli/stimuli.json');
  const byId = new Map(library.stimuli.map((entry) => [entry.id, entry]));
  const overrides = JSON.parse(
    readFileSync(path.join(GAMES_ROOT, 'shared/stimuli/labels.json'), 'utf8'),
  ).overrides || {};

  const problems = [];
  for (const word of VOCABULARY.words) {
    const entry = byId.get(word.id);
    if (!entry) {
      problems.push(`${word.id}: seeded in the vocabulary, missing from the library`);
      continue;
    }
    if (!entry.categories.includes(word.category)) {
      problems.push(`${word.id}: library has it in ${entry.categories.join(',')}, not ${word.category}`);
    }
    // A technician's own override still wins - the vocabulary is the label
    // below that, not above it.
    const expected = overrides[word.id] || word.label;
    if (entry.label !== expected) problems.push(`${word.id}: label "${entry.label}" should be "${expected}"`);
  }
  expect(problems, 'core words the library does not carry as written').toEqual([]);
});

test('a rebuild seeds every core word, art or no art', () => {
  // Deliberately the builder rather than the committed file: a build that
  // stopped seeding would leave `stimuli.json` exactly as it is on disk today,
  // so every assertion made over HTTP would still pass.
  const built = buildLibrary({ vocabulary: VOCABULARY });
  const byId = new Map(built.index.stimuli.map((entry) => [entry.id, entry]));

  const problems = [];
  for (const word of VOCABULARY.words) {
    const entry = byId.get(word.id);
    if (!entry) {
      problems.push(`${word.id}: a rebuild does not produce it`);
      continue;
    }
    if (!entry.image && !entry.placeholder) problems.push(`${word.id}: rebuilt with nothing to draw`);
    if (!built.index.categories.includes(word.category)) {
      problems.push(`${word.id}: ${word.category} is not a rebuilt category`);
    }
  }
  expect(problems, 'core words a rebuild loses').toEqual([]);
});

test('every core word renders something in front of a learner', async ({ request }) => {
  test.slow(); // one fetch per word

  const library = await loadJson(request, '/shared/stimuli/stimuli.json');
  const byId = new Map(library.stimuli.map((entry) => [entry.id, entry]));

  // The rule the stage states: a word with no art yet must carry an emoji, so
  // the seed can land before anyone photographs it. A word that already ships a
  // photograph may record `null` where Unicode has no honest glyph.
  const blank = VOCABULARY.words.filter((word) => {
    const entry = byId.get(word.id);
    return entry && !entry.image && !word.emoji;
  });
  expect(blank.map((w) => w.id), 'core words with neither art nor an emoji').toEqual([]);

  const rows = await mapWithConcurrency(VOCABULARY.words, 12, async (word) => {
    const entry = byId.get(word.id);
    const url = entry.image || entry.placeholder;
    const res = await request.get(url);
    const body = res.ok() && needsBodyToClassify(url) ? await res.text() : null;
    return {
      id: word.id,
      url,
      status: res.status(),
      body,
      classification: classify(url, body),
      hasArt: Boolean(entry.image),
    };
  });

  expect(rows.filter((r) => r.status !== 200).map((r) => `${r.status} ${r.url}`), 'core words that 404').toEqual([]);

  // A word with no art must resolve to a glyph placeholder, not to something
  // the classifier reads as art - that would mean the fallback silently became
  // the stimulus.
  const seeded = rows.filter((r) => !r.hasArt);
  expect(seeded.length, 'the core seeds words ahead of their art').toBeGreaterThan(0);
  expect(seeded.filter((r) => r.classification !== 'emoji').map((r) => r.id), 'seeded words not drawn as a glyph')
    .toEqual([]);

  // The glyph a placeholder draws and the emoji the word records are two
  // descriptions of one picture. A learner sees the file.
  const disagreements = seeded.filter((row) => {
    const word = VOCABULARY.words.find((w) => w.id === row.id);
    return !row.body || !row.body.includes(word.emoji);
  });
  expect(disagreements.map((r) => r.id), 'placeholders drawing a glyph the vocabulary does not name').toEqual([]);

  // eslint-disable-next-line no-console -- the counts are the evidence
  console.log(`core vocabulary: ${VOCABULARY.words.length} words, `
    + `${rows.length - seeded.length} with real art, ${seeded.length} on an emoji fallback`);
});

// ── clock and receptive consume the core directly ──────────────────────────

for (const game of CONSUMERS) {
  test(`${game}: offers every core topic and every word in it`, async ({ request }) => {
    const [manifest, library] = await Promise.all([
      loadJson(request, `/${game}/manifest.json`),
      loadJson(request, '/shared/stimuli/stimuli.json'),
    ]);
    const byId = new Map(library.stimuli.map((entry) => [entry.id, entry]));

    const missingTopics = VOCABULARY.core.filter((category) => !manifest.folders.includes(category));
    expect(missingTopics, `core topics ${game} does not offer`).toEqual([]);

    const problems = [];
    for (const word of VOCABULARY.words) {
      const entry = byId.get(word.id);
      const url = entry && (entry.image || entry.placeholder);
      const published = manifest.images[word.category] || [];
      if (!published.includes(url)) problems.push(`${word.id}: ${url} not published under ${word.category}`);
      else if (manifest.displayNames[url] !== entry.label) {
        problems.push(`${word.id}: shown as "${manifest.displayNames[url]}", library says "${entry.label}"`);
      }
    }
    expect(problems, `core words ${game} does not serve`).toEqual([]);
  });

  test(`${game}: a seeded topic reaches the learner-facing dropdown`, async ({ page, request }) => {
    const manifest = await loadJson(request, `/${game}/manifest.json`);
    await page.goto(`/${game}/`);
    await expect(page.locator('#sel-topic option')).toHaveCount(manifest.folders.length);

    // Selecting by the unchanged category key, showing the name it derives.
    const option = page.locator('#sel-topic option[value="T_vehicles"]');
    await expect(option, 'the seeded topic is selectable').toHaveCount(1);
    await expect(option).toHaveText('Vehicles');
  });
}

// ── The rules the committed data is free of ────────────────────────────────

test('a word whose id does not match its name fails the build', () => {
  const message = buildWith((vocabulary) => {
    const word = vocabulary.words.find((w) => w.id === 'vehicles-ambulance');
    word.name = 'amberlance';
  });
  expect(message, 'a drifted id is refused').toContain('vehicles-ambulance');
});

test('a seeded word with no emoji fails the build rather than rendering blank', () => {
  const message = buildWith((vocabulary) => {
    vocabulary.words.find((w) => w.id === 'school-crayon').emoji = null;
  });
  expect(message, 'a blank seeded word is refused').toContain('school-crayon');
  expect(message).toContain('blank');
});

test('an emoji that disagrees with the shipped placeholder fails the build', () => {
  // The word has no photograph and its glyph comes from an SVG a tree shipped,
  // so the vocabulary and that file have to name the same character.
  const subject = wordWithShippedGlyph();
  const message = buildWith((vocabulary) => {
    vocabulary.words.find((w) => w.id === subject.id).emoji = '🚀';
  });
  expect(message, 'a contradicted glyph is refused').toContain(subject.id);
});

test('the vocabulary label is what the library publishes, not the filename', () => {
  // `household-items-books` derives "Books" from `books.jpg`. Changing only the
  // vocabulary has to change what a game prints, or the label is decoration.
  const built = buildLibrary({
    vocabulary: {
      ...VOCABULARY,
      words: VOCABULARY.words.map((w) => (w.id === 'household-items-books' ? { ...w, label: 'Story Books' } : w)),
    },
  });
  const entry = built.index.stimuli.find((e) => e.id === 'household-items-books');
  expect(entry.label, 'the label follows the data').toBe('Story Books');
  expect(Object.values(built.manifests.clock.displayNames), 'and reaches the game')
    .toContain('Story Books');
});

test('a technician override still wins over the vocabulary label', () => {
  const built = buildLibrary({
    vocabulary: VOCABULARY,
    labels: { 'household-items-books': 'Chapter Books' },
  });
  const entry = built.index.stimuli.find((e) => e.id === 'household-items-books');
  expect(entry.label, 'labels.json outranks the curated core').toBe('Chapter Books');
});

test('a generated placeholder is shaped like the ones the trees shipped', () => {
  const generated = emojiPlaceholderSvg('🚑');

  // Same box, same emoji font stack, one <text> and no vector geometry - the
  // last of which is what makes the classifier read it as a placeholder rather
  // than as art the merge should have preferred.
  expect(generated).toContain('viewBox="0 0 200 200"');
  expect(generated).toContain('Apple Color Emoji');
  expect(classify('x.svg', generated), 'reads as a glyph, not as art').toBe('emoji');

  const subject = wordWithShippedGlyph();
  const shipped = readFileSync(path.join(GAMES_ROOT, subject.placeholder.replace(/^\//, '')), 'utf8');
  expect(shipped).toContain('viewBox="0 0 200 200"');
  expect(shipped).toMatch(/font-family="[^"]*Emoji/);
  expect((shipped.match(/<text/g) || []).length, 'one glyph, no vector geometry').toBe(1);
  expect(classify(subject.placeholder, shipped), 'the shipped one reads the same way').toBe('emoji');

  // And every placeholder the build drew is exactly this function's output - // stronger than comparing one file, and it cannot rot when a word gains art.
  const drawn = LIBRARY.stimuli.filter((s) => s.placeholder && !SHIPPED_PLACEHOLDERS.has(s.placeholder));
  expect(drawn.length, 'the build drew at least one placeholder').toBeGreaterThan(0);
  const wrong = drawn.filter(
    (s) => readFileSync(path.join(GAMES_ROOT, s.placeholder.replace(/^\//, '')), 'utf8')
      !== emojiPlaceholderSvg(s.emoji),
  );
  expect(wrong.map((s) => s.id), 'drawn placeholders are byte-for-byte the generated form').toEqual([]);
});
