/**
 * The shared library has to stay editable by a technician.
 *
 * `<game>/manifest.json` is generated now, so an AdminTools upload can no
 * longer just append a path to it - the next `npm run stimuli:build` would
 * wipe it. The answer is that an upload is committed as *source*
 * (`shared/stimuli/uploads/`) and published by the same projection the builder
 * uses, so the Worker can apply it in place without a rebuild.
 *
 * That only holds if the two agree. These tests are the proof: for every kind
 * of upload, `applyUpload()` - what `worker.js` runs inside a Cloudflare
 * isolate, seeing one file - must produce byte-for-byte what `buildLibrary()`
 * produces from the whole tree. Anything else means an upload goes live in a
 * state a rebuild silently undoes.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { buildLibrary } from '../shared/stimuli/build.mjs';
import {
  applyExclusion,
  applyLabel,
  applyUpload,
  manifestStamp,
  publishingFrom,
  liveGames,
  stableJson,
  stampManifests,
} from '../shared/stimuli/library.mjs';

const GAMES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = ['clock', 'receptive', 'matching'];

const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(GAMES_ROOT, relative), 'utf8'));
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** The library exactly as committed - what the Worker would fetch from GitHub. */
function committedState() {
  return {
    index: readJson('shared/stimuli/stimuli.json'),
    provenance: readJson('shared/stimuli/provenance.json'),
    manifests: Object.fromEntries(GAMES.map((game) => [game, readJson(`${game}/manifest.json`)])),
    publishing: readJson('shared/stimuli/publishing.json'),
    labels: readJson('shared/stimuli/labels.json').overrides,
    topicNames: readJson('shared/stimuli/topics.json').names,
  };
}

/**
 * Deterministic bytes that are unique per seed. Content only decides art-vs-
 * placeholder for `.svg`, so any bytes under a raster extension are real art - * which is what an uploaded photograph is.
 */
const bytesFor = (seed) => Buffer.from(`gnhf upload probe ${seed} `.repeat(64));

/** What `worker.js` commits: apply in place, then re-stamp from the new index. */
function applied(upload, state = committedState()) {
  const result = applyUpload(state, { ...upload, sha256: sha256(upload.bytes) });
  return { ...result, manifests: stampManifests(result.manifests, sha256(stableJson(result.index))) };
}

/** What the next `npm run stimuli:build` would produce from that same commit. */
function rebuilt(upload, worker) {
  return buildLibrary({
    extraUploads: [upload],
    labels: worker.labels,
    liveManifests: worker.manifests,
    publishing: worker.publishing,
    topicNames: worker.topicNames || readJson('shared/stimuli/topics.json').names,
  });
}

function expectAgreement(worker, build) {
  expect(Object.keys(worker.provenance), 'provenance is key-sorted')
    .toEqual([...Object.keys(worker.provenance)].sort());
  expect(stableJson(worker.index)).toBe(stableJson(build.index));
  expect(stableJson(worker.provenance)).toBe(stableJson(build.provenance));
  for (const game of GAMES) {
    expect(stableJson(worker.manifests[game]), `${game}/manifest.json`).toBe(stableJson(build.manifests[game]));
  }
}

const urlsIn = (manifest) => Object.values(manifest.images).flat();

/** A stem no source tree ships, so the upload really does create a stimulus. */
const NEW_STIMULUS = {
  game: 'matching',
  category: 'T_household_items',
  filename: 'stapler.jpg',
  bytes: bytesFor('stapler'),
};

test.describe('an AdminTools upload survives the next rebuild', () => {
  test('a stimulus the library did not carry at all: worker and rebuild agree', () => {
    const upload = NEW_STIMULUS;
    const worker = applied(upload);

    expect(committedState().index.stimuli.some((s) => s.id === 'household-items-stapler')).toBe(false);
    expect(worker.id).toBe('household-items-stapler');
    expect(worker.url).toBe('/shared/stimuli/img/T_household_items/stapler.jpg');
    expect(worker.addRepoPaths).toEqual([
      'shared/stimuli/uploads/T_household_items/stapler.jpg',
      'shared/stimuli/img/T_household_items/stapler.jpg',
    ]);
    expect(worker.removeRepoPaths).toEqual([]);

    expectAgreement(worker, rebuilt(upload, worker));
  });

  test('re-uploading under the same name replaces the bytes and retires nothing', () => {
    const before = committedState();
    // A stimulus with one art file and no alternates, found rather than named:
    // an upload supersedes alternates, so a subject that has gained one would
    // be testing that rule instead of this one.
    const only = before.index.stimuli.find(
      (s) => s.categories.includes('T_household_items') && s.image && !s.variants,
    );
    expect(only, 'T_household_items has a single-file stimulus').toBeTruthy();

    const filename = only.image.split('/').pop();
    const upload = { game: 'matching', category: 'T_household_items', filename, bytes: bytesFor(only.id) };
    const worker = applied(upload, before);

    expect(worker.url).toBe(only.image);
    expect(worker.removeRepoPaths).toEqual([]);
    for (const game of GAMES) {
      expect(worker.manifests[game].images.T_household_items)
        .toEqual(before.manifests[game].images.T_household_items);
    }

    expectAgreement(worker, rebuilt(upload, worker));
  });

  test('every game that runs the topic gains it, and only that topic changes', () => {
    const before = committedState();
    const worker = applied(NEW_STIMULUS, before);

    for (const game of GAMES) {
      const was = before.manifests[game];
      const now = worker.manifests[game];
      expect(now.folders).toEqual(was.folders);
      expect(now.images.T_household_items).toContain(worker.url);
      expect(now.images.T_household_items.length).toBe(was.images.T_household_items.length + 1);
      expect(now.displayNames[worker.url]).toBe('Stapler');
      for (const folder of was.folders) {
        if (folder === 'T_household_items') continue;
        expect(now.images[folder], `${game}/${folder}`).toEqual(was.images[folder]);
      }
    }
  });

  test('replacing a photograph retires the old file and keeps saved targets pointing at it', () => {
    const before = committedState();
    const old = before.index.stimuli.find((s) => s.id === 'household-items-table');
    expect(old.image).toBe('/shared/stimuli/img/T_household_items/table.jpg');

    const upload = { game: 'matching', category: 'T_household_items', filename: 'table.png', bytes: bytesFor('table') };
    const worker = applied(upload, before);

    expect(worker.url).toBe('/shared/stimuli/img/T_household_items/table.png');
    expect(worker.removeRepoPaths).toEqual(['shared/stimuli/img/T_household_items/table.jpg']);
    // The technician's label is not re-derived from whatever the new file was
    // called, and every path a saved target selection may name still lands on
    // the stimulus rather than on a URL that no longer exists.
    expect(worker.manifests.matching.displayNames[worker.url]).toBe(old.label);
    for (const [alias, target] of Object.entries(before.manifests.matching.pathAliases)) {
      if (target !== old.image) continue;
      expect(worker.manifests.matching.pathAliases[alias]).toBe(worker.url);
    }
    for (const game of GAMES) {
      expect(urlsIn(worker.manifests[game])).not.toContain(old.image);
    }

    const build = rebuilt(upload, worker);
    expectAgreement(worker, build);
    expect([...build.files.keys()]).not.toContain('img/T_household_items/table.jpg');
  });

  test('replacing an emoji placeholder drops the glyph file and publishes real art', () => {
    const before = committedState();
    const old = before.index.stimuli.find((s) => s.id === 'buildings-store');
    expect(old.image).toBeNull();
    expect(old.placeholder).toBe('/shared/stimuli/placeholder/T_buildings/store.svg');

    const upload = { game: 'matching', category: 'T_buildings', filename: 'store.jpg', bytes: bytesFor('store') };
    const worker = applied(upload, before);

    const entry = worker.index.stimuli.find((s) => s.id === 'buildings-store');
    expect(entry.image).toBe('/shared/stimuli/img/T_buildings/store.jpg');
    expect(entry.placeholder).toBeUndefined();
    expect(entry.emoji).toBe('🏪'); // the glyph stays as data for a native render
    expect(worker.removeRepoPaths).toEqual(['shared/stimuli/placeholder/T_buildings/store.svg']);

    const build = rebuilt(upload, worker);
    expectAgreement(worker, build);
    expect([...build.files.keys()]).not.toContain('placeholder/T_buildings/store.svg');
  });

  test('art for a seeded core word replaces its generated glyph and keeps its label', () => {
    // A vocabulary word starts life with no file anywhere: the build draws its
    // glyph from `emoji`. The Worker sees only the uploaded photograph and the
    // committed index, so it has to retire a placeholder it never generated and
    // keep the curated label - a rebuild reading `vocabulary.json` will.
    const before = committedState();
    // Two words still waiting for art - and the *topic* is found rather than
    // named, not just the words. Naming one here made this fixture fail the day
    // T_vehicles got its photographs, which is ordinary work rather than a
    // regression. Group by the category the placeholder actually lives under so
    // the removed path and the upload category cannot disagree for a stimulus
    // that belongs to more than one topic.
    const waitingByTopic = new Map();
    for (const s of before.index.stimuli) {
      if (s.image || !s.placeholder) continue;
      const topic = s.placeholder.split('/placeholder/')[1].split('/')[0];
      if (!waitingByTopic.has(topic)) waitingByTopic.set(topic, []);
      waitingByTopic.get(topic).push(s);
    }
    const category = [...waitingByTopic.keys()].sort().find((t) => waitingByTopic.get(t).length > 1);
    expect(category, 'some topic still has words seeded ahead of their art').toBeTruthy();
    const [seeded, untouched] = waitingByTopic.get(category);
    expect(seeded.placeholder, 'a seeded word renders as its glyph').toBeTruthy();

    const stem = seeded.placeholder.split('/').pop().replace(/\.[^.]+$/, '');
    const upload = { game: 'clock', category, filename: `${stem}.jpg`, bytes: bytesFor(stem) };
    const worker = applied(upload, before);

    const entry = worker.index.stimuli.find((s) => s.id === seeded.id);
    expect(entry.image).toBe(`/shared/stimuli/img/${category}/${stem}.jpg`);
    expect(entry.placeholder).toBeUndefined();
    expect(entry.label, 'the vocabulary label survives the upload').toBe(seeded.label);
    expect(entry.emoji, 'the glyph stays as data').toBe(seeded.emoji);
    expect(worker.removeRepoPaths).toEqual([`shared/stimuli/placeholder/${category}/${stem}.svg`]);

    const build = rebuilt(upload, worker);
    expectAgreement(worker, build);
    expect([...build.files.keys()]).not.toContain(`placeholder/${category}/${stem}.svg`);
    expect([...build.files.keys()], 'the other seeded words keep their glyphs')
      .toContain(`placeholder/${untouched.placeholder.split('/placeholder/')[1]}`);
  });

  test('a brand-new topic joins the uploading game only', () => {
    const before = committedState();
    const upload = { game: 'matching', category: 'T_gnhf_probe', filename: 'widget.jpg', bytes: bytesFor('widget') };
    const worker = applied(upload, before);

    expect(worker.manifests.matching.folders).toContain('T_gnhf_probe');
    expect(worker.manifests.matching.images.T_gnhf_probe).toEqual([worker.url]);
    for (const game of ['clock', 'receptive']) {
      expect(worker.manifests[game].folders).toEqual(before.manifests[game].folders);
      expect(urlsIn(worker.manifests[game])).not.toContain(worker.url);
    }
    expect(worker.index.categories).toContain('T_gnhf_probe');

    expectAgreement(worker, rebuilt(upload, worker));
  });

  test('re-uploading under a different extension removes the earlier upload', () => {
    const one = applied(NEW_STIMULUS);

    const second = {
      game: 'matching', category: 'T_household_items', filename: 'stapler.png', bytes: bytesFor('stapler2'),
    };
    const two = applied(second, { ...one, manifests: one.manifests });

    expect(two.removeRepoPaths).toEqual(expect.arrayContaining([
      'shared/stimuli/uploads/T_household_items/stapler.jpg',
      'shared/stimuli/img/T_household_items/stapler.jpg',
    ]));
    expect(two.manifests.matching.images.T_household_items).toContain(two.url);
    expect(urlsIn(two.manifests.matching)).not.toContain(one.url);
    // The first upload leaves no trace for a rebuild to disagree about - its
    // file is gone, so its provenance record must be gone too.
    expect(Object.keys(two.provenance)).not.toContain('/shared/stimuli/uploads/T_household_items/stapler.jpg');
    expectAgreement(two, buildLibrary({
      extraUploads: [second], labels: two.labels, liveManifests: two.manifests,
    }));
  });
});

test.describe('the other two kinds of technician state', () => {
  test('a removal unpublishes for one game and leaves the art for the others', () => {
    const before = committedState();
    const target = before.index.stimuli.find((s) => s.id === 'household-items-table');

    const result = applyExclusion(before, {
      game: 'matching',
      category: 'T_household_items',
      id: 'household-items-table',
    });

    expect(result.changed).toBe(true);
    expect(urlsIn(result.manifests.matching)).not.toContain(target.image);
    for (const game of ['clock', 'receptive']) {
      expect(result.manifests[game].images.T_household_items).toContain(target.image);
    }
    // The bytes stay in the library - the same file backs three games, so
    // deleting it on matching's behalf would pull the picture out of two
    // programmes nobody touched.
    expect(result.index).toBe(before.index);
    expect(result.publishing.excluded.matching.T_household_items).toEqual(['household-items-table']);

    const build = buildLibrary({ liveManifests: result.manifests, publishing: result.publishing });
    for (const game of GAMES) {
      expect(stableJson(result.manifests[game]), `${game}/manifest.json`)
        .toBe(stableJson({ ...build.manifests[game], generated: result.manifests[game].generated }));
    }
  });

  test('a display name is pinned by id, so a rebuild keeps it', () => {
    const before = committedState();
    const result = applyLabel(before, { id: 'household-items-table', label: 'Kitchen Table' });

    for (const game of GAMES) {
      const url = result.index.stimuli.find((s) => s.id === 'household-items-table').image;
      expect(result.manifests[game].displayNames[url]).toBe('Kitchen Table');
    }
    expect(result.labels['household-items-table']).toBe('Kitchen Table');

    const build = buildLibrary({ labels: result.labels, liveManifests: result.manifests });
    expect(build.index.stimuli.find((s) => s.id === 'household-items-table').label).toBe('Kitchen Table');
  });

  test('applyLabel refuses an id the library does not carry', () => {
    expect(() => applyLabel(committedState(), { id: 'not-a-stimulus', label: 'x' })).toThrow(/Unknown stimulus/);
  });
});

test.describe('the committed library is what the builder produces', () => {
  test('no uncommitted drift, and publishing.json matches the live manifests', () => {
    const state = committedState();
    const build = buildLibrary();

    expect(stableJson(build.index)).toBe(stableJson(state.index));
    expect(stableJson(build.provenance)).toBe(stableJson(state.provenance));
    for (const game of GAMES) {
      expect(stableJson(build.manifests[game]), `${game}/manifest.json`).toBe(stableJson(state.manifests[game]));
    }
    expect(stableJson(build.publishing)).toBe(stableJson(state.publishing));
    expect(stableJson(publishingFrom(liveGames(state)))).toBe(stableJson(state.publishing));
  });

  test('the manifest stamp is derived from the library it was projected from', () => {
    const state = committedState();
    const stamp = manifestStamp(sha256(stableJson(state.index)));
    for (const game of GAMES) expect(state.manifests[game].generated).toBe(stamp);
  });
});

test.describe('a topic name is source, never read back out of the projection', () => {
  test('topics.json reaches one game\'s manifest; a name only in the manifest does not survive', () => {
    const state = committedState();
    const category = state.manifests.matching.folders[0];
    const common = { labels: state.labels, publishing: state.publishing, liveManifests: state.manifests };

    const named = buildLibrary({ ...common, topicNames: { matching: { [category]: 'Creature Photos' } } });
    expect(named.manifests.matching.topicNames).toEqual({ [category]: 'Creature Photos' });
    for (const game of GAMES.filter((g) => g !== 'matching')) {
      expect(named.manifests[game].topicNames, `${game} keeps its own name for the topic`).toEqual({});
    }

    // The trap finding 10 names, in a second place: the build must not read its
    // own output. `topicNames` lives in the generated manifest, so a build that
    // carried it forward would make an override impossible to clear - deleting
    // it from `topics.json` would change nothing at all.
    const haunted = {
      ...state.manifests,
      matching: { ...state.manifests.matching, topicNames: { [category]: 'Ghost Name' } },
    };
    const rebuild = buildLibrary({ ...common, liveManifests: haunted, topicNames: {} });
    expect(rebuild.manifests.matching.topicNames).toEqual({});
  });
});
