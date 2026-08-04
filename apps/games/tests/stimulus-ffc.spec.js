import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildLibrary, compareRank } from '../shared/stimuli/build.mjs';
import { applyUpload, stableJson } from '../shared/stimuli/library.mjs';

/**
 * ffc joins the shared core.
 *
 * Before this, ffc was an island: 71 items keyed by a bare stem (`pencil`,
 * `mail_carrier`), each naming a file in its own flat `_Resources` tree, with
 * its own labels and its own copy of art the other games also carried. Its
 * feature / function / class metadata described stimuli the library already
 * had, and neither side could see the other.
 *
 * The join is by id, and it runs both ways:
 *
 *   • ffc's metadata hangs off library ids - `shared/stimuli/ffc.json` is the
 *     source, `ffc/items.json` is its projection, and the game resolves each
 *     item's picture and label from `stimuli.json` at run time
 *   • ffc's art becomes library art - its tree is merged as a *late* source, so
 *     it fills gaps (T_school had no photographs at all) and never displaces a
 *     picture another game is already serving
 *
 * The failure modes worth guarding are the silent ones: a word that ends up in
 * the library twice, art that quietly moves under a game that did not ask for
 * it, and a saved target selection pruned because the ids it names were
 * renamed underneath it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..');

const readJson = (relative) => JSON.parse(readFileSync(path.join(GAMES_ROOT, relative), 'utf8'));

const FFC_SOURCE = readJson('shared/stimuli/ffc.json');
const FFC_ITEMS = readJson('ffc/items.json');
const LIBRARY = readJson('shared/stimuli/stimuli.json');
const PROVENANCE = readJson('shared/stimuli/provenance.json');
const BASELINE = readJson('tests/fixtures/stimulus-baseline.json');

const FFC_PREFIX = '/ffc/';
const ENTRY_BY_ID = new Map(LIBRARY.stimuli.map((entry) => [entry.id, entry]));
const primary = (entry) => (entry ? entry.image || entry.placeholder || null : null);

/** A doctored copy of the ffc source, for the failure modes the data avoids. */
function withItems(mutate) {
  const items = FFC_SOURCE.items.map((item) => ({ ...item }));
  return { ...FFC_SOURCE, items: mutate(items) || items };
}

// ── The projection ─────────────────────────────────────────────────────────

test('ffc/items.json is exactly what a rebuild projects from ffc.json', () => {
  const built = buildLibrary();
  expect(stableJson(built.ffcItems)).toBe(stableJson(FFC_ITEMS));
});

test('every ffc item names a stimulus the library carries, exactly once', () => {
  const seen = new Set();
  const problems = [];
  for (const item of FFC_ITEMS.items) {
    if (seen.has(item.id)) problems.push(`${item.id}: listed twice`);
    seen.add(item.id);
    if (!ENTRY_BY_ID.has(item.id)) problems.push(`${item.id}: not in the library`);
    else if (!primary(ENTRY_BY_ID.get(item.id))) problems.push(`${item.id}: resolves to no picture at all`);
    for (const key of ['groups', 'features', 'functions', 'classes']) {
      if (!Array.isArray(item[key])) problems.push(`${item.id}: ${key} is not an array`);
    }
  }
  expect(problems).toEqual([]);
  expect(seen.size, 'every item ffc shipped is still published').toBe(FFC_SOURCE.items.length);
});

test('the projection carries no picture and no label of its own', () => {
  // This is what keeps `ffc/items.json` out of the Worker's business: it is a
  // pure function of `ffc.json`, so an upload elsewhere in the library cannot
  // make it stale. The two fields are asserted absent rather than merely unused,
  // because a stale copy of either is exactly the drift that would not show.
  for (const item of FFC_ITEMS.items) {
    expect(item, `${item.id} carries no frozen image`).not.toHaveProperty('image');
    expect(item, `${item.id} carries no frozen img`).not.toHaveProperty('img');
    expect(item, `${item.id} carries no frozen label`).not.toHaveProperty('label');
  }
});

test('an upload anywhere in the library leaves ffc/items.json byte-identical', () => {
  const built = buildLibrary();
  const uploaded = buildLibrary({
    extraUploads: [{ category: 'T_school', filename: 'pencil.png', bytes: Buffer.from('\x89PNG\r\n\x1a\nfake') }],
  });
  expect(uploaded.index.stimuli.find((s) => s.id === 'school-pencil').image)
    .toBe('/shared/stimuli/img/T_school/pencil.png');
  expect(stableJson(uploaded.ffcItems), 'the upload moved a picture ffc serves').toBe(stableJson(built.ffcItems));
});

// ── The `mail_carrier` split, retired ──────────────────────────────────────

test('no published ffc id carries the old separator, and every old id still resolves', () => {
  const published = new Set(FFC_ITEMS.items.map((item) => item.id));

  expect(FFC_ITEMS.items.filter((item) => item.id.includes('_')), 'ids are slugged, never underscored').toEqual([]);
  expect(published.has('community-helpers-mail-carrier'), 'mail carrier is one shared stimulus').toBe(true);

  // `mail_carrier` (ffc) and `mail-carrier.svg` (the file) met on one id. The
  // alias is what carries a technician's saved selection across that move.
  expect(FFC_ITEMS.idAliases.mail_carrier).toBe('community-helpers-mail-carrier');

  const dangling = Object.entries(FFC_ITEMS.idAliases).filter(([, id]) => !published.has(id));
  expect(dangling, 'every legacy id reaches an item ffc still publishes').toEqual([]);
  expect(Object.keys(FFC_ITEMS.idAliases).length).toBe(FFC_ITEMS.items.length);
});

// ── ffc's art fills gaps and never displaces ───────────────────────────────

test('ffc more than keeps the real art it had, and says which words gained it', () => {
  const rows = FFC_ITEMS.items.map((item) => ({ id: item.id, image: ENTRY_BY_ID.get(item.id).image }));
  const withArt = rows.filter((r) => r.image);

  const baselineArt = BASELINE.games.ffc.items.art;
  console.log(`ffc: ${withArt.length}/${rows.length} items resolve to a real photograph (baseline ${baselineArt})`);
  for (const row of withArt.slice(0, 8)) console.log(`  ${row.id} -> ${row.image}`);

  expect(withArt.length, 'ffc serves at least the real art it did at baseline').toBeGreaterThanOrEqual(baselineArt);
});

test('a late source loses every tie, and still beats a placeholder glyph', () => {
  // Asserted on the rule rather than on today's data: ffc happens not to
  // out-rank anything right now, so a build that dropped `late` produces a
  // byte-identical library - and every assertion over the committed files
  // passes. The next time ffc names a file another tree also has, it would not.
  const candidate = (over) => ({
    classification: 'art', late: false, indexed: false, extension: '.jpg', source: 'clock',
    servedPath: '/clock/a.jpg', ...over,
  });
  const shipped = candidate({ indexed: false });
  const lateButSelected = candidate({ late: true, indexed: true, source: 'ffc', servedPath: '/ffc/a.jpg' });
  expect(compareRank(shipped, lateButSelected), 'a shipped picture keeps its place').toBeLessThan(0);

  const glyph = candidate({ classification: 'emoji', indexed: true, extension: '.svg', source: 'matching' });
  expect(compareRank(lateButSelected, glyph), 'but a late photograph still fills a gap').toBeLessThan(0);
});

test('a picture only ffc supplies filled a gap - it never took another game over', () => {
  const recordsByStimulus = new Map();
  for (const [servedPath, record] of Object.entries(PROVENANCE)) {
    if (!recordsByStimulus.has(record.stimulus)) recordsByStimulus.set(record.stimulus, []);
    recordsByStimulus.get(record.stimulus).push({ servedPath, ...record });
  }

  const displaced = [];
  for (const entry of LIBRARY.stimuli) {
    if (!entry.image) continue;
    const records = recordsByStimulus.get(entry.id) || [];
    const carrying = records.filter((r) => r.library === entry.image);
    if (!carrying.length || carrying.some((r) => !r.servedPath.startsWith(FFC_PREFIX))) continue;

    // The published picture comes only from ffc. That is legitimate exactly
    // when no other tree had real art for this stimulus - every one of their
    // files must have been dropped as a placeholder glyph, not as losing art.
    const others = records.filter((r) => !r.servedPath.startsWith(FFC_PREFIX));
    const lost = others.filter((r) => r.droppedBecause && r.droppedBecause !== 'placeholder-glyph');
    if (lost.length) displaced.push(`${entry.id}: ${lost.map((r) => `${r.servedPath} (${r.droppedBecause})`).join(', ')}`);
  }
  expect(displaced, 'ffc art that displaced a picture another game was serving').toEqual([]);
});

test('every file in ffc\'s tree is accounted for', () => {
  const records = Object.keys(PROVENANCE).filter((p) => p.startsWith(FFC_PREFIX));
  expect(records.length, 'provenance covers the ffc tree').toBeGreaterThan(0);

  const problems = [];
  for (const servedPath of records) {
    const record = PROVENANCE[servedPath];
    if (!ENTRY_BY_ID.has(record.stimulus)) problems.push(`${servedPath}: unknown stimulus ${record.stimulus}`);
    if (record.library === null && !record.droppedBecause) problems.push(`${servedPath}: dropped with no reason`);
    if (record.droppedBecause === 'unexplained') problems.push(`${servedPath}: real art dropped unexplained`);
  }
  expect(problems).toEqual([]);
});

test('no stimulus lost art when ffc joined', () => {
  // The high-water mark for every category the merged games ever had. ffc is a
  // late source, so this can only ever move up - a drop means the join changed
  // a ranking it was supposed to sit underneath.
  const best = {};
  for (const game of LIBRARY.sources) {
    for (const [category, counts] of Object.entries(BASELINE.games[game] || {})) {
      best[category] = Math.max(best[category] || 0, counts.art);
    }
  }
  const observed = {};
  for (const entry of LIBRARY.stimuli) {
    for (const category of entry.categories) {
      observed[category] = (observed[category] || 0) + (entry.image ? 1 : 0);
    }
  }
  const regressions = Object.entries(best)
    .filter(([category, want]) => (observed[category] || 0) < want)
    .map(([category, want]) => `${category}: ${observed[category] || 0} now, baseline had ${want}`);
  expect(regressions).toEqual([]);
});

// ── What the builder refuses ───────────────────────────────────────────────

test('the build refuses an ffc item whose id is not a stimulus of its category', () => {
  const ffc = withItems((items) => { items[0] = { ...items[0], id: 'kitchen-items-pencil' }; });
  expect(() => buildLibrary({ ffc })).toThrow(/not a stimulus of/);
});

test('the build refuses two ffc items that name one stimulus', () => {
  const ffc = withItems((items) => { items[1] = { ...items[1], id: items[0].id }; });
  expect(() => buildLibrary({ ffc })).toThrow(/two items name/);
});

test('the build refuses an ffc file no item claims', () => {
  const ffc = withItems((items) => items.filter((item) => item.legacyId !== 'pencil'));
  expect(() => buildLibrary({ ffc })).toThrow(/is not claimed by any item/);
});

test('the build refuses an ffc item the library does not carry', () => {
  // The shape a word added to `ffc.json` before anything else has: no art on
  // disk and no vocabulary entry, so nothing else in the build creates the
  // stimulus. Without this check the word would simply be missing from the
  // game, at run time, with nothing to notice it.
  const ffc = withItems((items) => [...items, {
    id: 'school-nothing',
    legacyId: 'nothing',
    category: 'T_school',
    img: 'nothing.jpg',
    groups: [], features: [], functions: [], classes: [],
  }]);
  expect(() => buildLibrary({ ffc })).toThrow(/which the library does not have/);
});

// ── The game itself ────────────────────────────────────────────────────────

test('ffc renders the library\'s pictures, not its own tree', async ({ page }) => {
  const failed = [];
  page.on('response', (res) => { if (!res.ok() && res.request().resourceType() === 'image') failed.push(res.url()); });

  await page.goto('/ffc/');
  await expect(page.locator('#sel-tag option').first()).not.toHaveText('(no tags available)');
  await page.locator('#btn-targets-toggle').click();

  const srcs = await page.locator('.target-thumb').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('src')));
  expect(srcs.length, 'the target picker lists the pool').toBeGreaterThan(0);
  expect(srcs.filter((src) => !src.startsWith('/shared/stimuli/')), 'thumbnails come from the library').toEqual([]);
  expect(failed, 'every picture the page asked for was served').toEqual([]);

  // The word every spelling of the split used to fork is one row now.
  const labels = await page.locator('.target-thumb-label').allTextContents();
  expect(labels.filter((l) => l === 'Mail Carrier').length, 'one mail carrier, not two').toBe(1);
});

test('a pre-join target selection survives a reload', async ({ page }) => {
  // Every value deliberately off its default, so a redefault shows up as a
  // failure rather than as a coincidence.
  const legacy = ['pencil', 'mail_carrier', 'toy_car'];
  const seeded = {
    mode: 'function',
    tag: '',
    arraySize: 6,
    representErrors: false,
    errorless: true,
    noErrorAnim: true,
    promptPersists: true,
    promptStyle: 'outline',
    autoPromptEnabled: true,
    promptDelay: true,
    promptDelaySecs: 5,
    targetFilters: { feature: legacy, function: legacy, classWithinGroup: [], classCrossCategory: [] },
  };

  const seededJson = JSON.stringify(seeded);
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    ['ffcgSettings', seededJson],
  );
  await page.goto('/ffc/');
  // The tag dropdown is built from the *eligible target* pool, so a filter that
  // migrated to nothing renders "(no tags available)" - waiting on a real tag
  // means the migration has already had its chance.
  await expect(page.locator('#sel-tag option').first()).not.toHaveText('(no tags available)');

  // Read the result out of the shared settings store, not out of `ffcgSettings`.
  // Since ffc adopted the store, `foldLegacy()` reads the retired key once and
  // never writes it again - so the retired key still holds the PRE-remap ids,
  // and the remap `loadItems()` performs lands in the store's working config.
  const saved = await page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key) || 'null'),
    'nooutco.settings.ffc.trial',
  ).then((store) => (store && store.working) || {});

  for (const [option, value] of Object.entries(seeded)) {
    if (option === 'targetFilters' || option === 'tag') continue;
    expect(saved[option], `${option} survived the reload`).toEqual(value);
  }

  const expected = legacy.map((id) => FFC_ITEMS.idAliases[id]);
  expect(new Set(expected).size, 'the seeded ids name distinct stimuli').toBe(3);
  for (const mode of ['feature', 'function']) {
    expect([...saved.targetFilters[mode]].sort(), `${mode} targets were remapped, not pruned`)
      .toEqual([...expected].sort());
  }

  // …and the retired key itself is returned exactly as it was seeded, ids and
  // all: read-then-fold, never drop.
  const legacyRaw = await page.evaluate(() => window.localStorage.getItem('ffcgSettings'));
  expect(legacyRaw, 'ffcgSettings is byte-for-byte what was seeded').toBe(seededJson);
});
