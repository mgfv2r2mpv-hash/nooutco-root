/**
 * AdminTools edits, driven through `worker.js` for real.
 *
 * `tests/stimulus-uploads.spec.js` proves the *rules* agree - that
 * `applyUpload()` returns what `buildLibrary()` would. This file proves the
 * *wiring*: a POST to the Worker's admin endpoints, answered by an in-memory
 * GitHub, has to leave the branch holding exactly the files the next
 * `npm run stimuli:build` would write from that same commit.
 *
 * That is the whole point of Stage 3. `<game>/manifest.json` is generated now,
 * so an upload that only appends to it is undone by the next rebuild, and an
 * upload whose bytes land only under `uploads/` 404s until someone runs one.
 * Both failures are silent, and both are caught here by rebuilding the library
 * from what the Worker actually committed.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import worker from '../worker.js';
import { buildLibrary } from '../shared/stimuli/build.mjs';
import { LIBRARY_ROOT, stableJson } from '../shared/stimuli/library.mjs';
import { FakeGitHub, adminRequest, adminToken } from './lib/fake-github.mjs';

const GAMES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIBRARY_GAMES = ['clock', 'receptive', 'matching'];

const ADMIN_SECRET = 'test-admin-secret';
/** Exercises the retarget: game files live under this subdirectory of the repo. */
const REPO_SUBDIR = 'apps/games';

const env = {
  GITHUB_TOKEN: 'token', GITHUB_OWNER: 'owner', GITHUB_REPO: 'repo',
  GITHUB_BRANCH: 'main', ADMIN_SECRET, REPO_SUBDIR,
};

/** Repo paths the Worker reads or writes, prefixed exactly as `gh()` does. */
const repo = (relative) => `${REPO_SUBDIR}/${relative}`;

const LIBRARY_FILES = [
  `${LIBRARY_ROOT}/stimuli.json`,
  `${LIBRARY_ROOT}/provenance.json`,
  `${LIBRARY_ROOT}/publishing.json`,
  `${LIBRARY_ROOT}/labels.json`,
  `${LIBRARY_ROOT}/topics.json`,
  ...LIBRARY_GAMES.map((game) => `${game}/manifest.json`),
];

/** A fake repo seeded from the library exactly as it is committed today. */
function seededRepo() {
  const files = {};
  for (const relative of LIBRARY_FILES) {
    files[repo(relative)] = fs.readFileSync(path.join(GAMES_ROOT, relative));
  }
  return new FakeGitHub(files);
}

let restoreFetch;
test.beforeEach(() => {
  restoreFetch = globalThis.fetch;
});
test.afterEach(() => {
  globalThis.fetch = restoreFetch;
});

async function post(hub, endpoint, payload) {
  globalThis.fetch = hub.fetch;
  const token = await adminToken(ADMIN_SECRET);
  const response = await worker.fetch(adminRequest(endpoint, payload, token), env);
  return { status: response.status, body: await response.json() };
}

/** Deterministic, unique-per-seed bytes. Raster extension ⇒ real art. */
const bytesFor = (seed) => Buffer.from(`gnhf worker probe ${seed} `.repeat(64));

/**
 * The mime has to match the requested extension. `save-image` renames the file
 * to whatever the *content type* says - a .jpg posted as image/png is saved as
 * .png - so a mismatched fixture would silently test a different filename than
 * the one it names.
 */
const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

const uploadPayload = ({ game, folder, filename, seed }) => ({
  game,
  folder,
  filename,
  imageData: bytesFor(seed).toString('base64'),
  imageMime: MIME[filename.split('.').pop().toLowerCase()],
});

/**
 * What `npm run stimuli:build` would produce from the commit the Worker just
 * made: the uploads it committed as source, plus the technician state it wrote
 * into `labels.json` / `publishing.json` / the manifests.
 */
function rebuildFrom(hub) {
  const uploadPrefix = repo(`${LIBRARY_ROOT}/uploads/`);
  const extraUploads = [...hub.files().keys()]
    .filter((p) => p.startsWith(uploadPrefix) && !p.endsWith('README.md'))
    .sort()
    .map((p) => {
      const [category, filename] = p.slice(uploadPrefix.length).split('/');
      return { category, filename, bytes: hub.read(p) };
    });

  return buildLibrary({
    extraUploads,
    labels: hub.readJson(repo(`${LIBRARY_ROOT}/labels.json`)).overrides,
    publishing: hub.readJson(repo(`${LIBRARY_ROOT}/publishing.json`)),
    topicNames: hub.readJson(repo(`${LIBRARY_ROOT}/topics.json`)).names,
    liveManifests: Object.fromEntries(
      LIBRARY_GAMES.map((game) => [game, hub.readJson(repo(`${game}/manifest.json`))]),
    ),
  });
}

/** The committed tree is byte-for-byte what a rebuild of it would write. */
function expectRebuildIsANoOp(hub) {
  const built = rebuildFrom(hub);

  expect(hub.read(repo(`${LIBRARY_ROOT}/stimuli.json`)).toString('utf8')).toBe(stableJson(built.index));
  expect(hub.read(repo(`${LIBRARY_ROOT}/provenance.json`)).toString('utf8')).toBe(stableJson(built.provenance));
  expect(hub.read(repo(`${LIBRARY_ROOT}/publishing.json`)).toString('utf8')).toBe(stableJson(built.publishing));
  for (const game of LIBRARY_GAMES) {
    expect(hub.read(repo(`${game}/manifest.json`)).toString('utf8'), `${game}/manifest.json`)
      .toBe(stableJson(built.manifests[game]));
  }
  return built;
}

/** Every URL a manifest publishes has bytes behind it in the same commit. */
function expectEveryPublishedUrlResolves(hub, built) {
  for (const game of LIBRARY_GAMES) {
    const manifest = hub.readJson(repo(`${game}/manifest.json`));
    for (const url of Object.values(manifest.images).flat()) {
      const relative = url.replace('/shared/stimuli/', '');
      const committed = hub.read(repo(`${LIBRARY_ROOT}/${relative}`));
      // A library file the Worker did not touch is still on disk in the real
      // tree - the fake repo only carries the JSON plus whatever was committed.
      const onDisk = fs.existsSync(path.join(GAMES_ROOT, LIBRARY_ROOT, relative));
      expect(Boolean(committed) || onDisk || built.files.has(relative), `${game} publishes ${url}`).toBe(true);
    }
  }
}

test.describe('worker: shared stimulus library', () => {
  test('an upload lands as library source AND as the published image', async () => {
    const hub = seededRepo();
    const upload = { game: 'IDMatchGame', folder: 'T_household_items', filename: 'desk-lamp.png', seed: 'desk-lamp' };
    const { status, body } = await post(hub, '/api/admin/save-image', uploadPayload(upload));

    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.url).toBe('/shared/stimuli/img/T_household_items/desk-lamp.png');
    expect(body.id).toBe('household-items-desk-lamp');

    // One blob, two tree entries. Only the uploads/ copy is rescanned by a
    // rebuild; only the img/ copy is what the published URL resolves to.
    const bytes = bytesFor(upload.seed);
    expect(hub.read(repo(`${LIBRARY_ROOT}/uploads/T_household_items/desk-lamp.png`))).toEqual(bytes);
    expect(hub.read(repo(`${LIBRARY_ROOT}/img/T_household_items/desk-lamp.png`))).toEqual(bytes);

    const built = expectRebuildIsANoOp(hub);
    expectEveryPublishedUrlResolves(hub, built);
  });

  test('the uploaded stimulus is published to every game that runs the topic', async () => {
    const hub = seededRepo();
    await post(hub, '/api/admin/save-image', uploadPayload({
      game: 'IDMatchGame', folder: 'T_household_items', filename: 'desk-lamp.png', seed: 'desk-lamp',
    }));

    const url = '/shared/stimuli/img/T_household_items/desk-lamp.png';
    for (const game of LIBRARY_GAMES) {
      const manifest = hub.readJson(repo(`${game}/manifest.json`));
      if (!manifest.folders.includes('T_household_items')) continue;
      expect(manifest.images.T_household_items, `${game} serves the upload`).toContain(url);
      expect(manifest.displayNames[url]).toBe('Desk Lamp');
    }
  });

  test('re-uploading under a different extension leaves no orphan behind', async () => {
    const hub = seededRepo();
    const first = { game: 'IDMatchGame', folder: 'T_household_items', filename: 'desk-lamp.png', seed: 'one' };
    await post(hub, '/api/admin/save-image', uploadPayload(first));
    await post(hub, '/api/admin/save-image', uploadPayload({ ...first, filename: 'desk-lamp.jpg', seed: 'two' }));

    expect(hub.read(repo(`${LIBRARY_ROOT}/uploads/T_household_items/desk-lamp.png`)), 'stale upload deleted').toBeNull();
    expect(hub.read(repo(`${LIBRARY_ROOT}/img/T_household_items/desk-lamp.png`)), 'stale image deleted').toBeNull();
    expect(hub.read(repo(`${LIBRARY_ROOT}/img/T_household_items/desk-lamp.jpg`))).toEqual(bytesFor('two'));

    const built = expectRebuildIsANoOp(hub);
    expectEveryPublishedUrlResolves(hub, built);
  });

  test('replacing existing art supersedes it rather than adding a second answer', async () => {
    const hub = seededRepo();
    const before = hub.readJson(repo('matching/manifest.json'));
    const countBefore = before.images.T_animals.length;

    await post(hub, '/api/admin/save-image', uploadPayload({
      game: 'IDMatchGame', folder: 'T_animals', filename: 'bear.jpg', seed: 'new-bear',
    }));

    const after = hub.readJson(repo('matching/manifest.json'));
    expect(after.images.T_animals.length, 'no extra option in the discrimination array').toBe(countBefore);
    expect(after.images.T_animals).toContain('/shared/stimuli/img/T_animals/bear.jpg');
    expect(hub.read(repo(`${LIBRARY_ROOT}/img/T_animals/bear.jpg`))).toEqual(bytesFor('new-bear'));

    expectRebuildIsANoOp(hub);
  });

  test('an upload into a new topic adds it to the uploading game only', async () => {
    const hub = seededRepo();
    await post(hub, '/api/admin/save-image', uploadPayload({
      game: 'IDMatchGame', folder: 'T_playground', filename: 'swing.png', seed: 'swing',
    }));

    expect(hub.readJson(repo('matching/manifest.json')).folders).toContain('T_playground');
    expect(hub.readJson(repo('clock/manifest.json')).folders).not.toContain('T_playground');
    expect(hub.readJson(repo('receptive/manifest.json')).folders).not.toContain('T_playground');

    expectRebuildIsANoOp(hub);
  });

  test('removing an image excludes it from one game and keeps it for the others', async () => {
    const hub = seededRepo();
    const url = '/shared/stimuli/img/T_animals/bear.jpg';
    const sharedBefore = LIBRARY_GAMES.filter((game) =>
      (hub.readJson(repo(`${game}/manifest.json`)).images.T_animals || []).includes(url));
    expect(sharedBefore.length, 'the picture backs more than one game').toBeGreaterThan(1);

    const { status, body } = await post(hub, '/api/admin/remove-image', {
      game: 'IDMatchGame', folder: 'T_animals', filename: 'bear.jpg', localPath: url,
    });
    expect(status).toBe(200);
    expect(body.id).toBe('animals-bear');

    expect(hub.readJson(repo('matching/manifest.json')).images.T_animals).not.toContain(url);
    for (const game of sharedBefore.filter((g) => g !== 'matching')) {
      expect(hub.readJson(repo(`${game}/manifest.json`)).images.T_animals, `${game} keeps the picture`).toContain(url);
    }
    // The bytes stay: they back the other games.
    expect(hub.readJson(repo(`${LIBRARY_ROOT}/publishing.json`)).excluded.matching.T_animals).toContain('animals-bear');
    expect(hub.treeEntryPaths.filter((p) => p.includes('/img/T_animals/bear'))).toEqual([]);

    expectRebuildIsANoOp(hub);
  });

  test('a removal names a stimulus by folder + filename when no path is sent', async () => {
    const hub = seededRepo();
    const { status, body } = await post(hub, '/api/admin/remove-image', {
      game: 'NameIDGame', folder: 'T_animals', filename: 'bear.jpg',
    });
    expect(status).toBe(200);
    expect(body.id).toBe('animals-bear');
    expect(hub.readJson(repo(`${LIBRARY_ROOT}/publishing.json`)).excluded.receptive.T_animals).toContain('animals-bear');
  });

  test('a removal the library cannot resolve is a 404, not a silent no-op', async () => {
    const hub = seededRepo();
    const { status, body } = await post(hub, '/api/admin/remove-image', {
      game: 'IDMatchGame', folder: 'T_animals', filename: 'not-a-stimulus.jpg',
    });
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
    expect(hub.commitMessages, 'nothing was committed').toEqual([]);
  });

  test('a display name is pinned by stimulus id and survives a rebuild', async () => {
    const hub = seededRepo();
    const url = '/shared/stimuli/img/T_household_items/table.jpg';
    const { status } = await post(hub, '/api/admin/save-display-name', {
      game: 'IDMatchGame', localPath: url, displayName: 'Kitchen Table',
    });
    expect(status).toBe(200);

    expect(hub.readJson(repo(`${LIBRARY_ROOT}/labels.json`)).overrides['household-items-table']).toBe('Kitchen Table');
    for (const game of LIBRARY_GAMES) {
      const manifest = hub.readJson(repo(`${game}/manifest.json`));
      if (!manifest.displayNames[url]) continue;
      expect(manifest.displayNames[url], `${game} renders the technician's label`).toBe('Kitchen Table');
    }

    expectRebuildIsANoOp(hub);
  });

  test('clearing a display name restores the library label, not a blank one', async () => {
    const hub = seededRepo();
    const url = '/shared/stimuli/img/T_household_items/table.jpg';
    const original = hub.readJson(repo('matching/manifest.json')).displayNames[url];
    expect(original).toBeTruthy();

    await post(hub, '/api/admin/save-display-name', { game: 'IDMatchGame', localPath: url, displayName: 'Kitchen Table' });
    const { body } = await post(hub, '/api/admin/save-display-name', { game: 'IDMatchGame', localPath: url, displayName: '' });

    expect(body.displayName).toBe(original);
    const labels = hub.readJson(repo(`${LIBRARY_ROOT}/labels.json`));
    expect(labels.overrides['household-items-table']).toBeUndefined();
    expect(labels.derived['household-items-table'], 'the capture is cleared with it').toBeUndefined();
    expect(hub.readJson(repo('matching/manifest.json')).displayNames[url]).toBe(original);

    expectRebuildIsANoOp(hub);
  });

  test('a display name for a legacy _Resources path resolves through pathAliases', async () => {
    const hub = seededRepo();
    const manifest = hub.readJson(repo('matching/manifest.json'));
    const legacy = Object.keys(manifest.pathAliases).find((k) => k.startsWith('_Resources/'));
    expect(legacy, 'the manifest still carries legacy aliases').toBeTruthy();

    const { status, body } = await post(hub, '/api/admin/save-display-name', {
      game: 'IDMatchGame', localPath: legacy, displayName: 'Relabelled',
    });
    expect(status).toBe(200);
    expect(hub.readJson(repo(`${LIBRARY_ROOT}/labels.json`)).overrides[body.id]).toBe('Relabelled');
    expect(hub.readJson(repo('matching/manifest.json')).displayNames[manifest.pathAliases[legacy]]).toBe('Relabelled');
  });

  test('clock is a first-class admin target', async () => {
    const hub = seededRepo();
    const { status, body } = await post(hub, '/api/admin/save-image', uploadPayload({
      game: 'HickoryDickoryDockGame', folder: 'T_kitchen_items', filename: 'ladle.png', seed: 'ladle',
    }));
    expect(status).toBe(200);
    expect(body.url).toBe('/shared/stimuli/img/T_kitchen_items/ladle.png');
    expect(hub.readJson(repo('clock/manifest.json')).images.T_kitchen_items)
      .toContain('/shared/stimuli/img/T_kitchen_items/ladle.png');

    expectRebuildIsANoOp(hub);
  });

  test('REPO_SUBDIR is applied exactly once to every path the Worker writes', async () => {
    const hub = seededRepo();
    await post(hub, '/api/admin/save-image', uploadPayload({
      game: 'IDMatchGame', folder: 'T_household_items', filename: 'desk-lamp.png', seed: 'desk-lamp',
    }));

    expect(hub.treeEntryPaths.length).toBeGreaterThan(0);
    for (const p of hub.treeEntryPaths) {
      expect(p.startsWith(`${REPO_SUBDIR}/`), `${p} is under the retarget subdirectory`).toBe(true);
      expect(p.slice(REPO_SUBDIR.length + 1).startsWith(`${REPO_SUBDIR}/`), `${p} double-applies REPO_SUBDIR`).toBe(false);
    }
  });

  test('with no REPO_SUBDIR the same upload writes unprefixed paths', async () => {
    const files = {};
    for (const relative of LIBRARY_FILES) files[relative] = fs.readFileSync(path.join(GAMES_ROOT, relative));
    const hub = new FakeGitHub(files);

    globalThis.fetch = hub.fetch;
    const token = await adminToken(ADMIN_SECRET);
    const response = await worker.fetch(
      adminRequest('/api/admin/save-image', uploadPayload({
        game: 'IDMatchGame', folder: 'T_household_items', filename: 'desk-lamp.png', seed: 'desk-lamp',
      }), token),
      { ...env, REPO_SUBDIR: '' },
    );

    expect(response.status).toBe(200);
    expect(hub.read(`${LIBRARY_ROOT}/img/T_household_items/desk-lamp.png`)).toEqual(bytesFor('desk-lamp'));
    for (const p of hub.treeEntryPaths) expect(p.startsWith('apps/')).toBe(false);
  });

  test('a concurrent commit is retried, not overwritten', async () => {
    const hub = seededRepo();
    // Someone else's commit lands between the Worker reading head and patching
    // the ref. `force: false` rejects it; the Worker must re-read and re-apply.
    let landed = false;
    const underlying = hub.fetch;
    const racing = async (url, init) => {
      const response = await underlying(url, init);
      if (!landed && (init?.method || 'GET') === 'GET' && String(url).includes('git/commits/')) {
        landed = true;
        hub.landConcurrentCommit(repo('README-race.md'), 'someone else was here\n');
      }
      return response;
    };

    globalThis.fetch = racing;
    const token = await adminToken(ADMIN_SECRET);
    const response = await worker.fetch(
      adminRequest('/api/admin/save-image', uploadPayload({
        game: 'IDMatchGame', folder: 'T_household_items', filename: 'desk-lamp.png', seed: 'desk-lamp',
      }), token),
      env,
    );

    expect(response.status).toBe(200);
    expect(hub.read(repo('README-race.md')), 'the other commit survived').not.toBeNull();
    expect(hub.read(repo(`${LIBRARY_ROOT}/img/T_household_items/desk-lamp.png`))).toEqual(bytesFor('desk-lamp'));
    expectRebuildIsANoOp(hub);
  });

  // `/api/admin/batch` is the endpoint AdminTools actually posts to - every
  // queued operation lands in ONE commit. Folding several library ops through
  // one library state is where an in-place update is easiest to get wrong, so
  // each of these ends by rebuilding what the batch committed.
  test('a batch of library operations commits once and rebuilds identically', async () => {
    const hub = seededRepo();
    const { status, body } = await post(hub, '/api/admin/batch', {
      operations: [
        { type: 'save-image', ...uploadPayload({ game: 'IDMatchGame', folder: 'T_household_items', filename: 'desk-lamp.png', seed: 'lamp' }) },
        { type: 'save-image', ...uploadPayload({ game: 'IDMatchGame', folder: 'T_household_items', filename: 'stool.png', seed: 'stool' }) },
        { type: 'save-display-name', game: 'IDMatchGame', localPath: '/shared/stimuli/img/T_household_items/table.jpg', displayName: 'Kitchen Table' },
        { type: 'remove-image', game: 'IDMatchGame', folder: 'T_animals', filename: 'cat.jpg' },
      ],
    });

    expect(status).toBe(200);
    expect(body.results.map((r) => r.ok)).toEqual([true, true, true, true]);
    expect(hub.commitMessages, 'one commit for the whole batch').toHaveLength(1);

    const matching = hub.readJson(repo('matching/manifest.json'));
    expect(matching.images.T_household_items).toContain('/shared/stimuli/img/T_household_items/desk-lamp.png');
    expect(matching.images.T_household_items).toContain('/shared/stimuli/img/T_household_items/stool.png');
    expect(matching.displayNames['/shared/stimuli/img/T_household_items/table.jpg']).toBe('Kitchen Table');
    expect(matching.images.T_animals).not.toContain('/shared/stimuli/img/T_animals/cat.jpg');
    expect(hub.readJson(repo(`${LIBRARY_ROOT}/labels.json`)).overrides['household-items-table']).toBe('Kitchen Table');

    const built = expectRebuildIsANoOp(hub);
    expectEveryPublishedUrlResolves(hub, built);
  });

  test('a batch replacing the same stimulus twice leaves only the last upload', async () => {
    const hub = seededRepo();
    const { body } = await post(hub, '/api/admin/batch', {
      operations: [
        { type: 'save-image', ...uploadPayload({ game: 'IDMatchGame', folder: 'T_household_items', filename: 'desk-lamp.png', seed: 'first' }) },
        { type: 'save-image', ...uploadPayload({ game: 'IDMatchGame', folder: 'T_household_items', filename: 'desk-lamp.jpg', seed: 'second' }) },
      ],
    });

    expect(body.results.every((r) => r.ok)).toBe(true);
    expect(hub.read(repo(`${LIBRARY_ROOT}/img/T_household_items/desk-lamp.png`)), 'superseded within the batch').toBeNull();
    expect(hub.read(repo(`${LIBRARY_ROOT}/uploads/T_household_items/desk-lamp.png`))).toBeNull();
    expect(hub.read(repo(`${LIBRARY_ROOT}/img/T_household_items/desk-lamp.jpg`))).toEqual(bytesFor('second'));

    const built = expectRebuildIsANoOp(hub);
    expectEveryPublishedUrlResolves(hub, built);
  });

  test('one bad operation in a batch fails alone', async () => {
    const hub = seededRepo();
    const { body } = await post(hub, '/api/admin/batch', {
      operations: [
        { type: 'remove-image', game: 'IDMatchGame', folder: 'T_animals', filename: 'not-a-stimulus.jpg' },
        { type: 'save-image', ...uploadPayload({ game: 'IDMatchGame', folder: 'T_household_items', filename: 'desk-lamp.png', seed: 'lamp' }) },
      ],
    });

    expect(body.results[0].ok).toBe(false);
    expect(body.results[0].error).toMatch(/No stimulus in the shared library/);
    expect(body.results[1].ok).toBe(true);
    expect(hub.readJson(repo('matching/manifest.json')).images.T_household_items)
      .toContain('/shared/stimuli/img/T_household_items/desk-lamp.png');

    expectRebuildIsANoOp(hub);
  });

  // AdminTools renders from a manifest, and the deployed copy stays pre-commit
  // until Pages republishes - so the batch response has to carry the manifests
  // it just committed, or the only honest thing a client can do is refuse to
  // redraw. See `admin-image-manager.spec.js` for the client half.
  test('the batch response carries the manifests it committed', async () => {
    const hub = seededRepo();
    const { body } = await post(hub, '/api/admin/batch', {
      operations: [
        { type: 'save-image', ...uploadPayload({ game: 'IDMatchGame', folder: 'T_household_items', filename: 'desk-lamp.png', seed: 'lamp' }) },
        { type: 'remove-image', game: 'IDMatchGame', folder: 'T_animals', filename: 'cat.jpg' },
      ],
    });

    expect(Object.keys(body.manifests).sort()).toEqual([...LIBRARY_GAMES].sort());
    for (const game of LIBRARY_GAMES) {
      expect(stableJson(body.manifests[game]), `${game} as returned`)
        .toBe(hub.read(repo(`${game}/manifest.json`)).toString('utf8'));
    }

    // And it is the *post*-commit projection, not the state that was read.
    expect(body.manifests.matching.images.T_household_items)
      .toContain('/shared/stimuli/img/T_household_items/desk-lamp.png');
    expect(body.manifests.matching.images.T_animals)
      .not.toContain('/shared/stimuli/img/T_animals/cat.jpg');
    expect(body.manifests.receptive.images.T_animals, 'the other games keep the picture')
      .toContain('/shared/stimuli/img/T_animals/cat.jpg');
  });

  test('a batch that commits nothing returns no manifests to render', async () => {
    const hub = seededRepo();
    const { body } = await post(hub, '/api/admin/batch', {
      operations: [{ type: 'remove-image', game: 'IDMatchGame', folder: 'T_animals', filename: 'not-a-stimulus.jpg' }],
    });

    expect(body.results[0].ok).toBe(false);
    expect(body.manifests, 'nothing committed ⇒ nothing to redraw from').toBeUndefined();
    expect(hub.commitMessages).toEqual([]);
  });

  test('replaying a batch that already landed does not spend a commit', async () => {
    const hub = seededRepo();
    const operations = [
      { type: 'save-display-name', game: 'IDMatchGame', localPath: '/shared/stimuli/img/T_household_items/table.jpg', displayName: 'Kitchen Table' },
    ];
    // The first pass IS a change even when the rendered label is unchanged: it
    // pins the label, which is what makes it survive the next rebuild.
    await post(hub, '/api/admin/batch', { operations });
    expect(hub.commitMessages).toHaveLength(1);

    const { body } = await post(hub, '/api/admin/batch', { operations });
    expect(body.results[0].ok).toBe(true);
    expect(hub.commitMessages, 'the replay is a no-op').toHaveLength(1);
  });

  // ── The topic lifecycle ────────────────────────────────────────────
  //
  // `archive` / `restore` / `purge` used to be directory renames inside one
  // game's own `_Resources` tree: `T_colors/` became `_a_T_colors/`, and the
  // manifest was rewritten to match. Neither half of that survives the repoint
  // - the pictures back three games now, and the manifest is generated - so
  // every test here checks both that nothing moved and that a rebuild of the
  // commit reproduces it exactly.

  test('archiving a topic moves no files and leaves the other games alone', async () => {
    const hub = seededRepo();
    const before = hub.readJson(repo('matching/manifest.json'));
    expect(before.folders).toContain('T_colors');

    const { status, body } = await post(hub, '/api/admin/archive-topic', {
      game: 'IDMatchGame', folder: 'T_colors',
    });
    expect(status).toBe(200);
    expect(body.archived).toBe('_a_T_colors');

    const after = hub.readJson(repo('matching/manifest.json'));
    expect(after.folders, 'out of the programme').not.toContain('T_colors');
    expect(after.images.T_colors, 'and out of the served images').toBeUndefined();
    expect(Object.keys(after.archived)).toEqual(['_a_T_colors']);

    for (const game of ['clock', 'receptive']) {
      expect(hub.readJson(repo(`${game}/manifest.json`)).folders, `${game} still runs the topic`)
        .toContain('T_colors');
    }

    // The whole point: the art is shared, so an archive is a name change in one
    // programme and nothing else. No blob is written, moved or deleted.
    expect(hub.treeEntryPaths.filter((p) => p.includes('/img/') || p.includes('_Resources'))).toEqual([]);

    const built = expectRebuildIsANoOp(hub);
    expectEveryPublishedUrlResolves(hub, built);
  });

  test('an archived topic keeps its pictures, projected rather than replayed', async () => {
    const hub = seededRepo();
    const served = hub.readJson(repo('matching/manifest.json')).images.T_colors;
    expect(served.length).toBeGreaterThan(0);

    await post(hub, '/api/admin/archive-topic', { game: 'IDMatchGame', folder: 'T_colors' });
    expect(hub.readJson(repo('matching/manifest.json')).archived._a_T_colors).toEqual(served);

    // An upload into an archived topic reaches it, because the archived list is
    // a projection of the category exactly like `images` is.
    await post(hub, '/api/admin/save-image', uploadPayload({
      game: 'IDMatchGame', folder: 'T_colors', filename: 'teal.png', seed: 'teal',
    }));
    const archived = hub.readJson(repo('matching/manifest.json')).archived._a_T_colors;
    expect(archived, 'the new picture is in the archived topic').toContain('/shared/stimuli/img/T_colors/teal.png');
    expect(hub.readJson(repo('matching/manifest.json')).folders, 'and it stays archived').not.toContain('T_colors');

    expectRebuildIsANoOp(hub);
  });

  test('restoring a topic puts back exactly what it served', async () => {
    const hub = seededRepo();
    const before = hub.readJson(repo('matching/manifest.json'));

    await post(hub, '/api/admin/archive-topic', { game: 'IDMatchGame', folder: 'T_colors' });
    const { status, body } = await post(hub, '/api/admin/restore-topic', {
      game: 'IDMatchGame', folder: '_a_T_colors',
    });
    expect(status).toBe(200);
    expect(body.restored).toBe('T_colors');

    const after = hub.readJson(repo('matching/manifest.json'));
    expect(after.folders).toEqual(before.folders);
    expect(after.images.T_colors).toEqual(before.images.T_colors);
    expect(after.archived).toEqual({});
    // A full round trip is a no-op on the committed bytes, `generated` included.
    expect(stableJson(after)).toBe(stableJson(before));

    expectRebuildIsANoOp(hub);
  });

  test('purging drops the topic for good and a rebuild does not bring it back', async () => {
    const hub = seededRepo();
    await post(hub, '/api/admin/archive-topic', { game: 'IDMatchGame', folder: 'T_colors' });
    const { status } = await post(hub, '/api/admin/purge-topic', {
      game: 'IDMatchGame', folder: '_a_T_colors',
    });
    expect(status).toBe(200);

    const after = hub.readJson(repo('matching/manifest.json'));
    expect(after.folders).not.toContain('T_colors');
    expect(after.archived).toEqual({});

    // The pictures are still in the library - they back clock and receptive.
    expect(hub.readJson(repo('receptive/manifest.json')).images.T_colors.length).toBeGreaterThan(0);
    expect(hub.treeEntryPaths.filter((p) => p.includes('/img/'))).toEqual([]);

    const built = expectRebuildIsANoOp(hub);
    expect(built.manifests.matching.folders, 'the rebuild agrees the topic is gone').not.toContain('T_colors');
  });

  test('an exclusion survives archive + restore, and a purge takes it with it', async () => {
    const hub = seededRepo();
    const url = hub.readJson(repo('matching/manifest.json')).images.T_colors[0];
    await post(hub, '/api/admin/remove-image', {
      game: 'IDMatchGame', folder: 'T_colors', filename: url.split('/').pop(), localPath: url,
    });
    const excludedId = hub.readJson(repo(`${LIBRARY_ROOT}/publishing.json`)).excluded.matching.T_colors[0];
    expect(excludedId).toBeTruthy();

    await post(hub, '/api/admin/archive-topic', { game: 'IDMatchGame', folder: 'T_colors' });
    expect(hub.readJson(repo('matching/manifest.json')).archived._a_T_colors, 'archived respects the removal')
      .not.toContain(url);
    await post(hub, '/api/admin/restore-topic', { game: 'IDMatchGame', folder: '_a_T_colors' });
    expect(hub.readJson(repo(`${LIBRARY_ROOT}/publishing.json`)).excluded.matching.T_colors, 'still removed')
      .toContain(excludedId);
    expect(hub.readJson(repo('matching/manifest.json')).images.T_colors).not.toContain(url);

    // Purging the topic retires the removals inside it: they name stimuli this
    // game no longer offers at all.
    await post(hub, '/api/admin/archive-topic', { game: 'IDMatchGame', folder: 'T_colors' });
    await post(hub, '/api/admin/purge-topic', { game: 'IDMatchGame', folder: '_a_T_colors' });
    expect(hub.readJson(repo(`${LIBRARY_ROOT}/publishing.json`)).excluded.matching.T_colors).toBeUndefined();

    expectRebuildIsANoOp(hub);
  });

  test('a topic the game does not run is a 404, not a silent no-op', async () => {
    const hub = seededRepo();
    const archive = await post(hub, '/api/admin/archive-topic', { game: 'HickoryDickoryDockGame', folder: 'T_lowercase' });
    expect(archive.status).toBe(404);
    expect(archive.body.error).toMatch(/clock has no topic T_lowercase/);

    const restore = await post(hub, '/api/admin/restore-topic', { game: 'IDMatchGame', folder: '_a_T_colors' });
    expect(restore.status).toBe(404);

    expect(hub.commitMessages, 'nothing was committed').toEqual([]);
  });

  // ── Rename ───────────────────────────────────────────────────────
  //
  // A rename moves the topic's NAME, never its key. The key is what every
  // stimulus id in the topic is derived from and what three games share, so
  // moving it would re-key `colors-red` to `colours-red` - orphaning every
  // saved target selection naming it - and could not be done on one game's
  // behalf anyway. These tests pin both halves: the name lands, and nothing
  // else does.

  test('renaming a topic names it for one game and moves no files', async () => {
    const hub = seededRepo();
    const before = Object.fromEntries(
      LIBRARY_GAMES.map((game) => [game, hub.read(repo(`${game}/manifest.json`)).toString('utf8')]),
    );

    const { status, body } = await post(hub, '/api/admin/rename-topic', {
      game: 'IDMatchGame', folder: 'T_colors', newName: 'Colours',
    });

    expect(status).toBe(200);
    expect(body.name).toBe('Colours');
    // The key is echoed back unchanged: a client that re-keyed from this would
    // be wrong, and the old response shape said the opposite.
    expect(body.renamed).toBe('T_colors');

    expect(hub.readJson(repo(`${LIBRARY_ROOT}/topics.json`)).names)
      .toEqual({ matching: { T_colors: 'Colours' } });

    const matching = hub.readJson(repo('matching/manifest.json'));
    expect(matching.topicNames).toEqual({ T_colors: 'Colours' });
    expect(matching.folders, 'the key never moves').toContain('T_colors');
    expect(matching.images.T_colors).toEqual(JSON.parse(before.matching).images.T_colors);

    // Per game, exactly as it was when each game carried its own folder.
    for (const game of ['clock', 'receptive']) {
      expect(hub.read(repo(`${game}/manifest.json`)).toString('utf8'), `${game} untouched`)
        .toBe(before[game]);
    }

    expect(hub.treeEntryPaths.filter((p) => p.includes('/img/') || p.includes('_Resources'))).toEqual([]);

    const built = expectRebuildIsANoOp(hub);
    expectEveryPublishedUrlResolves(hub, built);
  });

  test('renaming a topic back to its derived name clears the override', async () => {
    const hub = seededRepo();
    const before = hub.read(repo('matching/manifest.json')).toString('utf8');

    await post(hub, '/api/admin/rename-topic', { game: 'IDMatchGame', folder: 'T_colors', newName: 'Colours' });
    const cleared = await post(hub, '/api/admin/rename-topic', {
      game: 'IDMatchGame', folder: 'T_colors', newName: 'Colors',
    });

    // "Colors" IS the derived name, so this is a clear - not an override that
    // merely looks identical and would outlive a change to the derivation.
    expect(cleared.status).toBe(200);
    expect(cleared.body.name).toBe('Colors');
    expect(hub.readJson(repo(`${LIBRARY_ROOT}/topics.json`)).names).toEqual({ matching: {} });
    expect(hub.read(repo('matching/manifest.json')).toString('utf8')).toBe(before);

    expectRebuildIsANoOp(hub);
  });

  test('a renamed topic keeps its name through archive and restore', async () => {
    const hub = seededRepo();
    await post(hub, '/api/admin/rename-topic', { game: 'IDMatchGame', folder: 'T_colors', newName: 'Colours' });

    await post(hub, '/api/admin/archive-topic', { game: 'IDMatchGame', folder: 'T_colors' });
    // Keyed by category, so the name follows the topic into the archive rather
    // than being stranded under a `_a_` name the restore would not look up.
    expect(hub.readJson(repo('matching/manifest.json')).topicNames).toEqual({ T_colors: 'Colours' });

    await post(hub, '/api/admin/restore-topic', { game: 'IDMatchGame', folder: '_a_T_colors' });
    const restored = hub.readJson(repo('matching/manifest.json'));
    expect(restored.folders).toContain('T_colors');
    expect(restored.topicNames).toEqual({ T_colors: 'Colours' });

    expectRebuildIsANoOp(hub);
  });

  test('an archived topic can be renamed, and a rename of nothing spends no commit', async () => {
    const hub = seededRepo();
    await post(hub, '/api/admin/archive-topic', { game: 'IDMatchGame', folder: 'T_colors' });
    const commits = hub.commitMessages.length;

    const archived = await post(hub, '/api/admin/rename-topic', {
      game: 'IDMatchGame', folder: '_a_T_colors', newName: 'Retired Colours',
    });
    expect(archived.status).toBe(200);
    expect(hub.readJson(repo(`${LIBRARY_ROOT}/topics.json`)).names.matching).toEqual({ T_colors: 'Retired Colours' });

    const replay = await post(hub, '/api/admin/rename-topic', {
      game: 'IDMatchGame', folder: '_a_T_colors', newName: 'Retired Colours',
    });
    expect(replay.status).toBe(200);
    expect(hub.commitMessages.length, 'the second rename changed nothing').toBe(commits + 1);

    expectRebuildIsANoOp(hub);
  });

  test('a topic the game does not run cannot be renamed', async () => {
    const hub = seededRepo();
    const { status, body } = await post(hub, '/api/admin/rename-topic', {
      game: 'HickoryDickoryDockGame', folder: 'T_lowercase', newName: 'Little Letters',
    });

    expect(status).toBe(404);
    expect(body.error).toMatch(/clock has no topic T_lowercase/);
    expect(hub.commitMessages).toEqual([]);
    expect(hub.readJson(repo(`${LIBRARY_ROOT}/topics.json`)).names).toEqual({});
  });

  test('an unauthenticated admin request changes nothing', async () => {
    const hub = seededRepo();
    globalThis.fetch = hub.fetch;
    const response = await worker.fetch(
      adminRequest('/api/admin/save-image', uploadPayload({
        game: 'IDMatchGame', folder: 'T_household_items', filename: 'desk-lamp.png', seed: 'desk-lamp',
      }), 'not-the-token'),
      env,
    );
    expect(response.status).toBe(401);
    expect(hub.commitMessages).toEqual([]);
  });
});
