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
 * @param {object} game       `{ game, folders, archived, excluded }`
 */
export function projectManifest(index, provenance, { game, folders, archived, excluded, stamp }) {
  const byCategory = new Map();
  for (const entry of index.stimuli) {
    for (const category of entry.categories) {
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category).push(entry);
    }
  }
  const urlById = new Map(index.stimuli.map((entry) => [entry.id, primaryUrl(entry)]));

  const images = {};
  const displayNames = {};
  const served = new Set();

  for (const folder of folders) {
    const hidden = new Set((excluded && excluded[folder]) || []);
    const entries = (byCategory.get(folder) || [])
      .filter((entry) => !hidden.has(entry.id) && primaryUrl(entry))
      .slice()
      .sort(byId);
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

  return {
    generated: stamp,
    note:
      'Generated by shared/stimuli/build.mjs from the shared library — edit that script or the ' +
      'library, never this file. `pathAliases` maps every URL this game used to serve to the ' +
      'library URL that replaced it.',
    library: `${SITE_BASE}stimuli.json`,
    folders,
    images,
    displayNames,
    pathAliases,
    archived: Object.fromEntries(
      Object.entries(archived || {}).map(([key, value]) => [pathAliases[key] || key, value]),
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
    labels: { ...(state.labels || {}), [id]: label },
    id,
    url,
    addRepoPaths: [uploadRepoPath(category, filename), keep],
    removeRepoPaths,
  };
}

function withCategory(games, game, category) {
  const target = game && games[game];
  if (!target || target.folders.includes(category)) return games;
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

/**
 * Set a technician's label for a stimulus.
 *
 * The label has to be returned as an override map, not just written into the
 * index: `stimuli.json` is generated, so a label that only lived there would
 * be reverted by the next rebuild.
 */
export function applyLabel(state, { id, label }) {
  let found = false;
  const stimuli = state.index.stimuli.map((entry) => {
    if (entry.id !== id) return entry;
    found = true;
    return { ...entry, label };
  });
  if (!found) throw new Error(`Unknown stimulus: ${id}`);

  const index = { ...state.index, stimuli };
  return {
    index,
    provenance: state.provenance,
    manifests: reproject(index, state.provenance, state),
    labels: { ...(state.labels || {}), [id]: label },
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
  const games = {};
  for (const [game, manifest] of Object.entries(state.manifests || {})) {
    games[game] = {
      folders: manifest.folders,
      archived: manifest.archived,
      excluded: excluded[game] || {},
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
