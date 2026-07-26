/**
 * The shared stimulus library's vocabulary, expressed as pure data transforms.
 *
 * Three consumers have to agree on every rule in here:
 *   • `shared/stimuli/build.mjs` — rebuilds the whole library from source
 *   • `worker.js` — applies one AdminTools upload in place, without a rebuild
 *   • `tests/stimulus-uploads.spec.js` — proves those two agree
 *
 * That is why this module holds no node builtins and touches no filesystem: it
 * is bundled into a Cloudflare Worker as well as run under node. It also never
 * mutates its inputs — every `apply*` returns fresh objects, so a caller can
 * diff old against new before committing anything.
 *
 * ── Why a generated manifest still needs technician state ──────────────────
 *
 * `<game>/manifest.json` is now generated from this library, so anything a
 * technician changes through AdminTools has to live somewhere the rebuild
 * reads. Three files carry exactly that, and nothing else:
 *
 *   `uploads/<category>/<file>`  the art they added        (which art exists)
 *   `labels.json`                stimulus id -> label      (what it is called)
 *   `publishing.json`            game -> excluded ids      (which game runs it)
 *   `topics.json`                game -> category -> name  (what the topic is called)
 */

export const SITE_BASE = '/shared/stimuli/';

/** Repo-relative, i.e. what a GitHub tree entry is keyed by. */
export const LIBRARY_ROOT = 'shared/stimuli';
export const IMG_SUBDIR = 'img';
export const PLACEHOLDER_SUBDIR = 'placeholder';
export const UPLOADS_SUBDIR = 'uploads';

export const IMG_URL_PREFIX = `${SITE_BASE}${IMG_SUBDIR}/`;
export const PLACEHOLDER_URL_PREFIX = `${SITE_BASE}${PLACEHOLDER_SUBDIR}/`;
export const UPLOADS_URL_PREFIX = `${SITE_BASE}${UPLOADS_SUBDIR}/`;

/** Raster formats rank above `.svg`; several `.svg` files are JPEG bytes. */
export const RASTER_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

// ── Names ──────────────────────────────────────────────────────────

export const slug = (value) =>
  String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const categorySlug = (category) => slug(String(category).replace(/^T_/, ''));

/**
 * Ids are category-qualified because stems are not unique on their own:
 * `orange` is both a colour and a food, and `a` / `A` are different stimuli
 * that collide on a case-insensitive filesystem.
 *
 * Slugging the stem is also what retires the `mail-carrier` / `mail_carrier`
 * separator split — both spellings name one stimulus, so an upload of either
 * replaces the art for both rather than forking a near-duplicate entry.
 */
export const stimulusId = (category, stem) => `${categorySlug(category)}-${slug(stem)}`;

export const extensionOf = (filename) => {
  const match = /\.[^.\\/]+$/.exec(String(filename));
  return match ? match[0].toLowerCase() : '';
};

export const stemOf = (filename) => String(filename).replace(/\.[^.\\/]+$/, '');

/**
 * A single character or a bare number is its own label — title-casing would
 * render the lowercase-letter programme as uppercase, which is a different
 * discrimination entirely.
 */
export function deriveLabel(stem) {
  if (stem.length === 1 || /^\d+$/.test(stem)) return stem;
  return stem.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function libraryFileName(stem, extension, alternateIndex) {
  const base = slug(stem) || stem;
  return alternateIndex === 0 ? `${base}${extension}` : `${base}--alt${alternateIndex}${extension}`;
}

export const imageUrl = (category, fileName) => `${IMG_URL_PREFIX}${category}/${fileName}`;
export const placeholderUrl = (category, fileName) => `${PLACEHOLDER_URL_PREFIX}${category}/${fileName}`;

/**
 * An archived topic keeps its stimuli but leaves the programme, and AdminTools
 * names it by a prefix rather than by a flag: `T_colors` archived is
 * `_a_T_colors`. That prefix used to be a real directory — the topic's files
 * were moved into it — which is exactly what cannot happen now that the same
 * bytes back three games.
 */
export const ARCHIVE_PREFIX = '_a_';
export const archivedFolderName = (category) => `${ARCHIVE_PREFIX}${category}`;
export const categoryOfArchivedFolder = (folder) =>
  folder.startsWith(ARCHIVE_PREFIX) ? folder.slice(ARCHIVE_PREFIX.length) : folder;

/**
 * What a topic is called when nothing overrides it — the prettified folder
 * name every game and AdminTools has always shown. Shared so that a technician
 * who renames a topic back to its derived name clears the override instead of
 * pinning a string that merely looks the same.
 */
export const deriveTopicName = (folder) =>
  categoryOfArchivedFolder(String(folder))
    .replace(/^T_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * `archived` reaches us as the manifest wrote it: prefixed folder name -> the
 * URLs it held. Only the *names* are technician state — the URL lists are a
 * projection exactly like `images`, so they are recomputed on every build
 * rather than carried forward, and an upload into an archived topic shows up
 * there instead of going stale.
 */
export const archivedNames = (archived) =>
  (Array.isArray(archived) ? archived : Object.keys(archived || {})).slice().sort();

/** Repo path of an upload as committed by AdminTools, keeping its own name. */
export const uploadRepoPath = (category, filename) =>
  `${LIBRARY_ROOT}/${UPLOADS_SUBDIR}/${category}/${filename}`;

/** Repo path behind a `/shared/stimuli/…` URL. */
export function repoPathForUrl(url) {
  if (!url || !url.startsWith(SITE_BASE)) return null;
  return `${LIBRARY_ROOT}/${url.slice(SITE_BASE.length)}`;
}

/** The single URL a game serves for a stimulus. Real art when there is any. */
export const primaryUrl = (entry) => entry.image || entry.placeholder || null;

export const stableJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * The `generated` field of every projected manifest. Content-derived rather
 * than a timestamp so `--check` stays meaningful: a manifest is stale exactly
 * when the library it was projected from has changed.
 */
export const manifestStamp = (indexDigestHex) => `shared-stimuli:${indexDigestHex.slice(0, 12)}`;

/**
 * Re-stamp projected manifests once the caller has hashed the new index.
 * Hashing is synchronous under node and asynchronous in a Worker, so the
 * `apply*` functions stay pure and leave the stamp to whoever can compute it.
 */
export function stampManifests(manifests, indexDigestHex) {
  const stamp = manifestStamp(indexDigestHex);
  return Object.fromEntries(Object.entries(manifests).map(([game, m]) => [game, { ...m, generated: stamp }]));
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Key order is content for these files: they are committed, diffed and
 * compared byte-for-byte by `build.mjs --check`. A rebuild emits provenance in
 * scan order and an in-place update appends, so both sort.
 */
export const sortKeys = (map) =>
  Object.fromEntries(Object.keys(map).sort().map((key) => [key, map[key]]));

/**
 * A stimulus entry with its fields in the one order both producers emit.
 * `{...existing, image}` would keep whatever order the file happened to have.
 */
export function canonicalEntry(entry) {
  const out = {
    id: entry.id,
    label: entry.label,
    categories: entry.categories,
    image: entry.image ?? null,
    emoji: entry.emoji ?? null,
  };
  if (entry.glyphKind) out.glyphKind = entry.glyphKind;
  if (entry.variants && entry.variants.length) out.variants = entry.variants;
  if (entry.placeholder) out.placeholder = entry.placeholder;
  return out;
}

// ── Per-game manifest projection ───────────────────────────────────

/**
 * Project the library back out as one game's `manifest.json`.
 *
 * Only the art is shared. `folders` is the game's own programme list, and
 * `excluded` is what a technician removed from it — matching's `T_lowercase`
 * turning up in receptive's topic dropdown would be a behaviour change, not a
 * merge, and so would a removed stimulus reappearing.
 *
 * Exactly one URL per stimulus, never its `variants`. Indexing both the clock
 * and the matching photograph of a bear would put two correct answers in one
 * discrimination array; the alternates stay in the library for a later feature
 * that knows to rotate rather than to offer them side by side.
 *
 * @param {object} index      the library index (`stimuli.json`)
 * @param {object} provenance old served path -> what now carries those bytes
 * @param {object} game       `{ game, folders, archived, excluded, names }`
 */
export function projectManifest(index, provenance, { game, folders, archived, excluded, names, stamp }) {
  const byCategory = new Map();
  for (const entry of index.stimuli) {
    for (const category of entry.categories) {
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category).push(entry);
    }
  }
  const urlById = new Map(index.stimuli.map((entry) => [entry.id, primaryUrl(entry)]));

  /** What one folder publishes — the same rule active and archived. */
  const publishedIn = (folder) => {
    const category = categoryOfArchivedFolder(folder);
    const hidden = new Set((excluded && excluded[category]) || []);
    return (byCategory.get(category) || [])
      .filter((entry) => !hidden.has(entry.id) && primaryUrl(entry))
      .slice()
      .sort(byId);
  };

  const images = {};
  const displayNames = {};
  const served = new Set();

  for (const folder of folders) {
    const entries = publishedIn(folder);
    images[folder] = entries.map((entry) => primaryUrl(entry));
    for (const entry of entries) {
      const url = primaryUrl(entry);
      served.add(url);
      // Labels are data, not a title-cased filename: `T_lowercase/a.svg` must
      // render as "a", and a technician's override must survive.
      displayNames[url] = entry.label;
    }
  }

  // Old URL -> new URL. A saved `targetFilters` entry names a stimulus by the
  // path it used to be served from; without this the game silently prunes the
  // technician's whole target selection on first load.
  const prefix = `/${game}/`;
  const pathAliases = {};
  for (const [servedPath, record] of Object.entries(provenance)) {
    if (!servedPath.startsWith(prefix)) continue;
    const url = urlById.get(record.stimulus);
    if (!url || !served.has(url)) continue; // a category this game does not run
    pathAliases[servedPath.slice(prefix.length)] = url;
  }

  // A topic's name is per game, exactly as it was when each game carried its
  // own `_Resources` tree: naming matching's `T_colors` must not rename it in
  // clock. Keyed by category, so the name survives an archive round trip, and
  // holding only overrides, so every consumer keeps its derived fallback.
  const topicNames = {};
  for (const folder of [...folders, ...archivedNames(archived)]) {
    const category = categoryOfArchivedFolder(folder);
    const name = names && names[category];
    if (name) topicNames[category] = name;
  }

  return {
    generated: stamp,
    note:
      'Generated by shared/stimuli/build.mjs from the shared library — edit that script or the ' +
      'library, never this file. `pathAliases` maps every URL this game used to serve to the ' +
      'library URL that replaced it.',
    library: `${SITE_BASE}stimuli.json`,
    folders,
    topicNames: sortKeys(topicNames),
    images,
    displayNames,
    pathAliases,
    archived: Object.fromEntries(
      archivedNames(archived).map((folder) => [folder, publishedIn(folder).map((entry) => primaryUrl(entry))]),
    ),
  };
}

// ── Applying one AdminTools change without a rebuild ───────────────

/** The library files a stimulus entry currently owns, as repo paths. */
function ownedRepoPaths(entry) {
  if (!entry) return [];
  return [entry.image, ...(entry.variants || []), entry.placeholder]
    .filter(Boolean)
    .map(repoPathForUrl)
    .filter(Boolean);
}

/**
 * Fold one uploaded image into the library, exactly as a full rebuild would.
 *
 * An upload is authoritative: it supersedes every other art candidate for that
 * stimulus rather than joining them as a variant. A technician who uploads a
 * photo of a bear has chosen the bear picture, and only one URL per stimulus
 * is ever published anyway — keeping the old file as an unpublished alternate
 * would mean the rebuild had to rename files on every upload, which is exactly
 * the churn that makes an in-worker update impossible to keep honest.
 *
 * @param {object} state `{ index, provenance, manifests, publishing, stamp }`
 *   where `manifests` is game -> live manifest.
 * @param {object} upload `{ game, category, filename, sha256, label }`
 * @returns {object} `{ index, provenance, manifests, id, url, addRepoPaths,
 *   removeRepoPaths }` — all fresh objects; nothing in `state` is touched.
 *   Callers must hash `stableJson(index)` and {@link stampManifests}.
 */
export function applyUpload(state, upload) {
  const { category, filename, sha256 } = upload;
  const stem = stemOf(filename);
  const extension = extensionOf(filename);
  if (!category || !stem || !extension) throw new Error('category and a filename with an extension are required');

  const id = stimulusId(category, stem);
  const fileName = libraryFileName(stem, extension, 0);
  const url = imageUrl(category, fileName);

  const existing = state.index.stimuli.find((entry) => entry.id === id) || null;
  const label = upload.label || (existing && existing.label) || deriveLabel(stem);

  const next = canonicalEntry({
    ...(existing || { emoji: null }),
    id,
    label,
    image: url,
    categories: existing && existing.categories.includes(category)
      ? existing.categories
      : [...((existing && existing.categories) || []), category],
    // Real art means no placeholder glyph and no stale alternates: the rebuild
    // drops both, so an in-place update that kept them would drift at once.
    variants: null,
    placeholder: null,
  });

  const stimuli = existing
    ? state.index.stimuli.map((entry) => (entry.id === id ? next : entry))
    : [...state.index.stimuli, next].sort(byId);
  const categories = state.index.categories.includes(category)
    ? state.index.categories
    : [...state.index.categories, category].sort();
  const index = { ...state.index, categories, stimuli };

  const uploadUrl = `${UPLOADS_URL_PREFIX}${category}/${filename}`;

  // Any earlier upload for this same stimulus goes with the file it named —
  // re-uploading `bear.png` over `bear.jpg` must not leave the old one behind
  // for the next rebuild to resurrect as an alternate. Its provenance record
  // goes too, because a rebuild scans what is on disk and would not write one.
  const staleUploads = Object.keys(state.provenance).filter(
    (p) => p.startsWith(UPLOADS_URL_PREFIX) && p !== uploadUrl && state.provenance[p].stimulus === id,
  );

  // Provenance: the upload now carries the bytes, and every source file this
  // stimulus used to resolve to is superseded rather than silently forgotten.
  const provenance = {};
  for (const [servedPath, record] of Object.entries(state.provenance)) {
    if (staleUploads.includes(servedPath)) continue;
    if (record.stimulus !== id || !record.library) {
      provenance[servedPath] = record;
      continue;
    }
    provenance[servedPath] = {
      ...record,
      library: null,
      droppedBecause: record.library.startsWith(PLACEHOLDER_URL_PREFIX)
        ? 'placeholder-glyph'
        : 'superseded-by-upload',
    };
  }
  provenance[uploadUrl] = { stimulus: id, sha256, library: url };
  // Sorted before it is projected, not just before it is returned: the order
  // decides `pathAliases` key order, so projecting from an unsorted copy would
  // produce a manifest a rebuild formats differently.
  const sorted = sortKeys(provenance);

  const keep = repoPathForUrl(url);
  const removeRepoPaths = [
    ...new Set([...ownedRepoPaths(existing), ...staleUploads.map(repoPathForUrl)]),
  ].filter((p) => p !== keep && p !== uploadRepoPath(category, filename));

  // A brand-new topic has to join the uploading game's programme, or the
  // stimulus lands in the library and no game ever offers it.
  const games = withCategory(liveGames(state), upload.game, category);

  return {
    index,
    provenance: sorted,
    manifests: reproject(index, sorted, { ...state, games }),
    games,
    // Pinning the resolved label is what keeps a rebuild from renaming the
    // stimulus: `stimuli.json` is generated, so a label that only lived there
    // would fall back to whatever the uploaded file happened to be called.
    labels: sortKeys({ ...(state.labels || {}), [id]: label }),
    id,
    url,
    addRepoPaths: [uploadRepoPath(category, filename), keep],
    removeRepoPaths,
  };
}

function withCategory(games, game, category) {
  const target = game && games[game];
  if (!target || target.folders.includes(category)) return games;
  // An archived topic stays archived. The technician took it out of the
  // programme deliberately, and the upload still reaches it — `archived` is
  // projected from the same category — so re-adding the folder here would
  // quietly undo a decision nobody asked to undo.
  if (archivedNames(target.archived).includes(archivedFolderName(category))) return games;
  return { ...games, [game]: { ...target, folders: [...target.folders, category].sort() } };
}

/**
 * Drop a stimulus from ONE game's programme.
 *
 * Removal used to delete the file, which was safe when every game carried its
 * own copy of the art. It is not safe now: the same bytes back three games, so
 * deleting them on matching's behalf would pull the picture out of clock and
 * receptive too. So a removal is recorded as an exclusion — the art stays in
 * the library, this game stops offering it, and nothing another game runs
 * changes.
 *
 * @param {object} state    as for {@link applyUpload}
 * @param {object} removal  `{ game, category, id }`
 */
export function applyExclusion(state, { game, category, id }) {
  const games = liveGames(state);
  const target = games[game];
  if (!target) throw new Error(`Unknown game: ${game}`);

  const current = (target.excluded && target.excluded[category]) || [];
  const excluded = current.includes(id)
    ? target.excluded
    : { ...target.excluded, [category]: [...current, id].sort() };
  const nextGames = { ...games, [game]: { ...target, excluded } };

  return {
    index: state.index,
    provenance: state.provenance,
    manifests: reproject(state.index, state.provenance, { ...state, games: nextGames }),
    games: nextGames,
    publishing: publishingFrom(nextGames),
    changed: excluded !== target.excluded,
  };
}

// ── The topic lifecycle: archive / restore / purge ─────────────────

/**
 * Change one game's topic list, leaving every file where it is.
 *
 * Archiving used to be a directory rename — `T_colors/` became `_a_T_colors/`
 * inside that game's own `_Resources` tree — which was safe only while each
 * game carried its own copy of the art. It is not safe now: one blob backs
 * three games, so moving the colours out of matching's way would take them out
 * of clock and receptive too, and the prefixed directory would not be a
 * category any manifest could project from.
 *
 * So a topic's whole lifecycle is programme state. `folders` and `archived`
 * live in the generated manifest and are read back from it on every rebuild
 * (see {@link liveGames}), which is what makes a rename of nothing survive one.
 *
 * @param {function} mutate `({folders, archived}) => partial game config`
 */
function withTopics(state, game, mutate) {
  const games = liveGames(state);
  const target = games[game];
  if (!target) throw new Error(`Unknown game: ${game}`);

  const next = mutate({ folders: target.folders, archived: archivedNames(target.archived) });
  const nextGames = { ...games, [game]: { ...target, ...next } };

  return {
    index: state.index,
    provenance: state.provenance,
    manifests: reproject(state.index, state.provenance, { ...state, games: nextGames }),
    games: nextGames,
    publishing: publishingFrom(nextGames),
    changed: true,
  };
}

/** Move an active topic out of the programme, keeping it recoverable. */
export function applyTopicArchive(state, { game, category }) {
  return withTopics(state, game, ({ folders, archived }) => {
    if (!folders.includes(category)) throw new Error(`UNKNOWN_TOPIC:${category}`);
    const folder = archivedFolderName(category);
    return {
      folders: folders.filter((f) => f !== category),
      archived: [...archived.filter((name) => name !== folder), folder].sort(),
    };
  });
}

/** Put an archived topic back. Its images are re-projected, never replayed. */
export function applyTopicRestore(state, { game, folder }) {
  return withTopics(state, game, ({ folders, archived }) => {
    if (!archived.includes(folder)) throw new Error(`UNKNOWN_TOPIC:${folder}`);
    const category = categoryOfArchivedFolder(folder);
    return {
      folders: folders.includes(category) ? folders : [...folders, category].sort(),
      archived: archived.filter((name) => name !== folder),
    };
  });
}

/**
 * Drop an archived topic for good — for this game.
 *
 * Purging used to delete the pictures (a rename to `_x_`, invisible to every
 * reader). It cannot, for the same reason removal cannot: the art is shared.
 * What it does do is take the topic's per-stimulus exclusions with it, because
 * those name removals from a programme this game no longer runs at all.
 */
export function applyTopicPurge(state, { game, folder }) {
  return withTopics(state, game, ({ folders, archived }) => {
    if (!archived.includes(folder)) throw new Error(`UNKNOWN_TOPIC:${folder}`);
    const category = categoryOfArchivedFolder(folder);
    const excluded = { ...((liveGames(state)[game] || {}).excluded || {}) };
    delete excluded[category];
    return { folders, archived: archived.filter((name) => name !== folder), excluded };
  });
}

/**
 * Name one game's topic — the rename that a shared library can honour.
 *
 * The legacy rename moved the topic's directory and, with it, the key every
 * stimulus id is derived from. Neither half of that survives the library: the
 * directory now backs three games, and re-keying `T_colors` to `T_colours`
 * would re-key `colors-red` to `colours-red`, orphaning every saved target
 * selection naming it. So a rename sets a *name*. The category keeps its
 * stable key, nothing moves, and the name is per game — matching renaming its
 * colours topic leaves clock's alone, exactly as it did when each game carried
 * its own folder.
 *
 * A blank name clears the override, and so does one that equals the derived
 * name, so "rename it back" is a clear rather than a pinned duplicate.
 *
 * @param {object} state   as for {@link applyUpload}, plus `topicNames`
 * @param {object} change  `{ game, folder, name }` — `folder` may be archived
 */
export function applyTopicRename(state, { game, folder, name }) {
  const games = liveGames(state);
  const target = games[game];
  if (!target) throw new Error(`Unknown game: ${game}`);

  const category = categoryOfArchivedFolder(folder);
  const runs = target.folders.includes(category)
    || archivedNames(target.archived).includes(archivedFolderName(category));
  if (!runs) throw new Error(`UNKNOWN_TOPIC:${folder}`);

  const derived = deriveTopicName(category);
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const current = { ...(target.names || {}) };
  if (trimmed && trimmed !== derived) current[category] = trimmed;
  else delete current[category];

  const names = sortKeys(current);
  const nextGames = { ...games, [game]: { ...target, names } };

  return {
    index: state.index,
    provenance: state.provenance,
    manifests: reproject(state.index, state.provenance, { ...state, games: nextGames }),
    games: nextGames,
    topicNames: sortKeys({ ...(state.topicNames || {}), [game]: names }),
    name: trimmed || derived,
    changed: stableJson(names) !== stableJson(sortKeys(target.names || {})),
  };
}

/**
 * Set — or clear — a technician's label for a stimulus.
 *
 * The label has to be returned as an override map, not just written into the
 * index: `stimuli.json` is generated, so a label that only lived there would
 * be reverted by the next rebuild.
 *
 * Clearing is why `derivedLabels` exists. AdminTools has always been able to
 * blank a display name and get the library's own label back, but a Worker
 * cannot re-derive that label — it would have to redo the whole merge. So the
 * label being overridden is captured the first time an override lands, and a
 * clear puts it back. `build.mjs` reads only `overrides`, so the record costs a
 * rebuild nothing.
 *
 * @param {object} state    as for {@link applyUpload}, plus `derivedLabels`
 * @param {object} change   `{ id, label }` — a blank `label` clears
 */
export function applyLabel(state, { id, label }) {
  const existing = state.index.stimuli.find((entry) => entry.id === id);
  if (!existing) throw new Error(`Unknown stimulus: ${id}`);

  const labels = { ...(state.labels || {}) };
  const derived = { ...(state.derivedLabels || {}) };
  const trimmed = typeof label === 'string' ? label.trim() : '';

  let resolved;
  if (trimmed) {
    if (!(id in derived)) derived[id] = existing.label;
    labels[id] = trimmed;
    resolved = trimmed;
  } else {
    resolved = id in derived ? derived[id] : existing.label;
    delete labels[id];
    delete derived[id];
  }

  const stimuli = state.index.stimuli.map((entry) => (entry.id === id ? { ...entry, label: resolved } : entry));
  const index = { ...state.index, stimuli };
  return {
    index,
    provenance: state.provenance,
    manifests: reproject(index, state.provenance, state),
    labels: sortKeys(labels),
    derivedLabels: sortKeys(derived),
    label: resolved,
  };
}

/**
 * `folders`, `archived` and the exclusion list are technician state that only
 * ever lived in the manifest, so the live manifest (plus `publishing.json`) is
 * where they are read from — never the frozen pre-repoint snapshot, which
 * would silently revert a topic a technician added. Art ranking never reads a
 * generated manifest (see build.mjs), so this is not the self-referential read
 * that would let the library drift.
 */
export function liveGames(state) {
  if (state.games) return state.games;
  const excluded = (state.publishing && state.publishing.excluded) || {};
  const names = state.topicNames || {};
  const games = {};
  for (const [game, manifest] of Object.entries(state.manifests || {})) {
    games[game] = {
      folders: manifest.folders,
      archived: archivedNames(manifest.archived),
      excluded: excluded[game] || {},
      // Topic names come from `topics.json`, not from the manifest they are
      // projected into — a name read back out of the projection would be
      // indistinguishable from a derived one and could never be cleared.
      names: names[game] || {},
    };
  }
  return games;
}

export const publishingFrom = (games) => ({
  schema: 1,
  note:
    'Stimuli a technician removed from a game, by stimulus id. The art stays in the shared ' +
    'library — the same bytes back three games, so deleting it on one game\'s behalf would pull ' +
    'the picture out of the other two.',
  excluded: Object.fromEntries(Object.entries(games).map(([game, v]) => [game, v.excluded || {}])),
});

function reproject(index, provenance, state) {
  const games = liveGames(state);
  const stamp = state.stamp || Object.values(state.manifests || {})[0]?.generated || '';
  const manifests = {};
  for (const [game, config] of Object.entries(games)) {
    manifests[game] = projectManifest(index, provenance, { game, ...config, stamp });
  }
  return manifests;
}
