import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { classify, needsBodyToClassify } from './lib/stimuli.mjs';

/**
 * clock, receptive and matching repointed at the shared stimulus library.
 *
 * Their `manifest.json` is no longer hand-maintained per game — it is projected
 * out of `shared/stimuli/stimuli.json` by the same build that merges the trees.
 * Each game keeps its own programme list; only the art is shared.
 *
 * Two things can go wrong in a repoint, and both are silent:
 *
 *   1. a URL that used to resolve stops resolving — a blank card in front of a
 *      learner mid-trial
 *   2. a technician's saved target selection is keyed by the URLs the game used
 *      to serve, so on first load it matches nothing and every game's own
 *      "prune stale filters" logic throws the selection away
 *
 * (2) is why `pathAliases` exists and why these tests seed a real pre-repoint
 * localStorage payload rather than asserting on the table in isolation.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..');

const LIBRARY_BASE = '/shared/stimuli/';

/** The manifests as they stood before the build began generating them. */
const SOURCE_MANIFESTS = JSON.parse(
  readFileSync(path.join(GAMES_ROOT, 'shared/stimuli/source-manifests.json'), 'utf8'),
).games;

/**
 * The four games that read one of these manifests, with the localStorage key
 * each persists its settings under and the base it prefixed onto image paths.
 * market borrows matching's manifest instead of carrying its own art.
 */
const REPOINTED = [
  { game: 'clock', url: '/clock/', manifest: '/clock/manifest.json', source: 'clock', storageKey: 'hddSettings', legacyBase: '' },
  { game: 'receptive', url: '/receptive/', manifest: '/receptive/manifest.json', source: 'receptive', storageKey: 'ngSettings', legacyBase: '' },
  { game: 'matching', url: '/matching/', manifest: '/matching/manifest.json', source: 'matching', storageKey: 'mgSettings', legacyBase: '' },
  {
    game: 'market',
    url: '/market/',
    manifest: '/matching/manifest.json',
    source: 'matching',
    storageKey: 'mmSettings',
    legacyBase: '../../IDMatchGame/IDMatchGame/',
  },
];

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

// ── The projection ─────────────────────────────────────────────────────────

for (const source of ['clock', 'receptive', 'matching']) {
  test(`${source}: manifest is projected from the shared library`, async ({ request }) => {
    const manifest = await loadJson(request, `/${source}/manifest.json`);

    expect(manifest.library, 'names the library it came from').toBe(`${LIBRARY_BASE}stimuli.json`);
    expect(manifest.folders, 'keeps the programme list it shipped')
      .toEqual(SOURCE_MANIFESTS[source].folders);

    const published = Object.values(manifest.images).flat();
    const stragglers = published.filter((p) => !p.startsWith(LIBRARY_BASE));
    expect(stragglers, 'images still served out of the game\'s own tree').toEqual([]);
  });
}

test('no category serves fewer stimuli than it did before the repoint', async ({ request }) => {
  const shortfalls = [];
  for (const source of ['clock', 'receptive', 'matching']) {
    const manifest = await loadJson(request, `/${source}/manifest.json`);
    for (const [category, before] of Object.entries(SOURCE_MANIFESTS[source].images)) {
      const after = (manifest.images[category] || []).length;
      if (after < before.length) shortfalls.push(`${source}/${category}: ${before.length} -> ${after}`);
    }
  }
  expect(shortfalls, 'categories that shrank in the repoint').toEqual([]);
});

// ── Nothing a game used to serve stops resolving ───────────────────────────

for (const source of ['clock', 'receptive', 'matching']) {
  test(`${source}: every URL it used to serve still reaches a picture`, async ({ request }) => {
    test.slow(); // a few hundred asset fetches

    const manifest = await loadJson(request, `/${source}/manifest.json`);
    const indexed = new Set(Object.values(manifest.images).flat());
    const legacy = Object.values(SOURCE_MANIFESTS[source].images).flat();
    expect(legacy.length, 'the frozen snapshot has paths to check').toBeGreaterThan(0);

    const orphaned = legacy.filter((p) => !manifest.pathAliases[p]);
    expect(orphaned, 'paths with no alias into the library').toEqual([]);

    const unserved = legacy
      .map((p) => manifest.pathAliases[p])
      .filter((url) => !indexed.has(url));
    expect(unserved, 'aliases pointing at something this game does not index').toEqual([]);

    const statuses = await mapWithConcurrency([...indexed], 12, async (urlPath) => {
      const res = await request.get(urlPath);
      return { urlPath, status: res.status() };
    });
    expect(statuses.filter((r) => r.status !== 200).map((r) => `${r.status} ${r.urlPath}`),
      'indexed images that do not resolve').toEqual([]);
  });
}

test('clock and receptive now serve real photographs for household and kitchen items', async ({ request }) => {
  // The headline of the merge. Both games served nothing but generated emoji
  // glyphs for T_household_items before this, and five real files for kitchen.
  for (const game of ['clock', 'receptive']) {
    const manifest = await loadJson(request, `/${game}/manifest.json`);

    for (const [category, minimum] of [['T_household_items', 11], ['T_kitchen_items', 19]]) {
      const urls = manifest.images[category] || [];
      const rows = await mapWithConcurrency(urls, 12, async (urlPath) => {
        const res = await request.get(urlPath);
        expect(res.status(), `${urlPath} resolves`).toBe(200);
        const body = needsBodyToClassify(urlPath) ? await res.text() : null;
        return { urlPath, classification: classify(urlPath, body) };
      });
      const art = rows.filter((r) => r.classification === 'art');

      const before = (SOURCE_MANIFESTS[game].images[category] || []).length;
      // eslint-disable-next-line no-console -- the resolved entries are the evidence
      console.log(`${game}/${category}: ${art.length} real of ${rows.length} indexed (${before} indexed before)\n  ` +
        art.map((r) => `${manifest.displayNames[r.urlPath]}  ${r.urlPath}`).join('\n  '));

      expect(art.length, `${game} ${category} real photographs`).toBeGreaterThanOrEqual(minimum);
    }
  }
});

// ── A renamed topic reaches the learner-facing dropdown ────────────────────

/**
 * A rename is a name, not a move. The manifest carries `topicNames` — the
 * per-game override AdminTools writes — and the game has to prefer it over the
 * name it derives from the folder while still selecting by the unchanged key.
 * A game that took the name as the value would write a topic no manifest has
 * into the technician's saved settings.
 */
for (const { game, url, manifest: manifestUrl } of REPOINTED) {
  test(`${game}: a renamed topic shows its new name and keeps its key`, async ({ page, request }) => {
    const manifest = await loadJson(request, manifestUrl);
    const topic = manifest.folders[0];

    await page.route(`**${manifestUrl}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...manifest, topicNames: { [topic]: 'Renamed In Admin' } }),
      });
    });

    await page.goto(url);
    await expect(page.locator('#sel-topic option')).toHaveCount(manifest.folders.length);

    const first = page.locator('#sel-topic option').first();
    await expect(first).toHaveText('Renamed In Admin');
    await expect(first, 'the key the images are indexed by never moved').toHaveAttribute('value', topic);

    // Every other topic still shows the name it derives for itself.
    const second = page.locator('#sel-topic option').nth(1);
    await expect(second).not.toHaveText('Renamed In Admin');
  });
}

// ── A saved target selection survives the move ─────────────────────────────

/**
 * Seed the settings a technician would have had before the repoint, load the
 * game, and read back what it persisted. Every value must come back, and the
 * target paths must have been rewritten to the library URLs that carry the
 * same pictures — a game that pruned them instead comes back with an empty
 * array and no way to tell the technician their programme changed.
 */
for (const { game, url, manifest: manifestUrl, source, storageKey, legacyBase } of REPOINTED) {
  test(`${game}: a pre-repoint target selection survives a reload`, async ({ page, request }) => {
    const manifest = await loadJson(request, manifestUrl);
    const topic = SOURCE_MANIFESTS[source].folders[0];
    const legacyPaths = (SOURCE_MANIFESTS[source].images[topic] || []).slice(0, 3);
    expect(legacyPaths.length, `${topic} has paths to seed`).toBe(3);

    // Every value deliberately off its default, so a redefault shows up as a
    // failure rather than as a coincidence.
    const seeded = {
      topic,
      arraySize: 6,
      representErrors: false,
      errorless: true,
      noErrorAnim: true,
      crossCategory: true,
      nonTargetDistractors: false,
      promptPersists: true,
      promptStyle: 'outline',
      autoPromptEnabled: true,
      promptDelay: true,
      promptDelaySecs: 5,
      targetFilters: { [topic]: legacyPaths.map((p) => legacyBase + p) },
    };

    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [storageKey, JSON.stringify(seeded)],
    );
    await page.goto(url);
    // Every game builds its topic dropdown straight after adopting the
    // manifest, and the migration runs before that — so a fully populated
    // dropdown means the migration has already had its chance.
    await expect(page.locator('#sel-topic option'))
      .toHaveCount(SOURCE_MANIFESTS[source].folders.length);

    const saved = JSON.parse(await page.evaluate((key) => window.localStorage.getItem(key), storageKey));

    // Nothing the technician set may be dropped or quietly redefaulted.
    for (const [option, value] of Object.entries(seeded)) {
      if (option === 'targetFilters') continue;
      expect(saved[option], `${option} survived the reload`).toEqual(value);
    }

    const expected = legacyPaths.map((p) => manifest.pathAliases[p]);
    expect(new Set(expected).size, 'the seeded paths name distinct stimuli').toBe(3);
    expect([...saved.targetFilters[topic]].sort(), `${topic} targets were remapped, not pruned`)
      .toEqual([...expected].sort());
  });
}
