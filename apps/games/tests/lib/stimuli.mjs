/**
 * Shared vocabulary for reasoning about stimulus art across the games.
 *
 * Two consumers depend on this module:
 *   • tests/tools/snapshot-stimuli.mjs - regenerates the committed baseline
 *   • tests/stimulus-integrity.spec.js - asserts the served site matches it
 *
 * Keeping the classifier in one place is the point: the baseline and the
 * assertion have to agree on what counts as "real art", or the safety net
 * silently stops catching regressions.
 */

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg'];

/** Elements that draw actual vector geometry (as opposed to a glyph). */
const VECTOR_ELEMENT_RE = /<(path|rect|circle|ellipse|polygon|polyline|line|image|use|g)\b/g;
const TEXT_ELEMENT_RE = /<text\b/g;

/**
 * An emoji placeholder is an SVG whose entire body is a single <text> glyph - * a stand-in generated when no real art existed for a stimulus. There are
 * hundreds of these and they are NOT distinguishable by filename (a real
 * hand-drawn `above.svg` sits in the same folder as a placeholder `bed.svg`),
 * so detection is by content only.
 *
 * @param {string} fileName  the asset's file name or path
 * @param {string|null} body the asset's decoded text body, or null for binary
 * @returns {boolean}
 */
export function isEmojiPlaceholder(fileName, body) {
  if (!/\.svg$/i.test(fileName || '')) return false;
  if (typeof body !== 'string' || body.length === 0) return false;
  const textCount = (body.match(TEXT_ELEMENT_RE) || []).length;
  if (textCount !== 1) return false;
  return (body.match(VECTOR_ELEMENT_RE) || []).length === 0;
}

/**
 * @returns {'emoji'|'art'} 'art' means real stimulus art (photo, illustration,
 * or hand-authored vector); 'emoji' means a generated placeholder glyph.
 */
export function classify(fileName, body) {
  return isEmojiPlaceholder(fileName, body) ? 'emoji' : 'art';
}

export function isImagePath(p) {
  const lower = String(p || '').toLowerCase().split('?')[0];
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** SVGs are the only assets whose bytes we need to read to classify them. */
export function needsBodyToClassify(fileName) {
  return /\.svg$/i.test(fileName || '');
}

/**
 * Every stimulus index in the repo, and how to turn it into served URLs.
 *
 * `kind` drives how the index is parsed:
 *   'manifest' - {folders[], images{folder: path[]}, displayNames, archived}
 *   'items' - flat item list, each with an `img` filename under `imgPrefix`
 *   'fixed' - a hardcoded key list rendered as `${imgPrefix}${key}${ext}`
 *
 * Paths in an index are resolved relative to `base`, so a game can be
 * repointed at a shared library without this registry changing.
 */
export const STIMULUS_SOURCES = [
  { game: 'clock', kind: 'manifest', base: '/clock/', index: '/clock/manifest.json' },
  { game: 'receptive', kind: 'manifest', base: '/receptive/', index: '/receptive/manifest.json' },
  { game: 'matching', kind: 'manifest', base: '/matching/', index: '/matching/manifest.json' },
  {
    // ffc's items name a shared stimulus id and nothing else - no `img`, no
    // label - so the picture is resolved from the library, exactly as the game
    // does it. `base` is the site root because a library URL is site-absolute.
    game: 'ffc',
    kind: 'library-items',
    base: '/',
    index: '/ffc/items.json',
    library: '/shared/stimuli/stimuli.json',
    category: 'items',
  },
  {
    game: 'emotions',
    kind: 'fixed',
    base: '/emotions/',
    imgPrefix: 'faces/',
    ext: '.webp',
    category: 'faces',
    keys: [
      'happy', 'sad', 'angry', 'scared', 'nervous', 'surprised', 'shocked',
      'interested', 'tired', 'calm', 'excited', 'sick', 'silly',
    ],
  },
];

/**
 * Flatten a loaded index into `{category, path}` rows, where `path` is
 * relative to the source's `base`.
 *
 * @param {object} [library] the shared stimulus library, required for a
 *   `library-items` source: its index names stimuli by id and nothing else, so
 *   the picture a row points at can only come from the library.
 */
export function entriesFor(source, index, library) {
  if (source.kind === 'manifest') {
    return (index.folders || []).flatMap((folder) =>
      (index.images?.[folder] || []).map((path) => ({ category: folder, path })));
  }
  if (source.kind === 'library-items') {
    const byId = new Map(((library && library.stimuli) || []).map((entry) => [entry.id, entry]));
    return (index.items || []).map((item) => {
      const entry = byId.get(item.id);
      const url = entry && (entry.image || entry.placeholder);
      // An unresolvable id is deliberately kept as a row rather than filtered
      // out: it has to fail as a 404 the sweep reports, not vanish silently.
      return { category: source.category, path: url ? url.replace(/^\//, '') : `unresolved/${item.id}` };
    });
  }
  if (source.kind === 'items') {
    return (index.items || [])
      .filter((item) => item && item.img)
      .map((item) => ({ category: source.category, path: source.imgPrefix + item.img }));
  }
  return source.keys.map((key) => ({
    category: source.category,
    path: `${source.imgPrefix}${key}${source.ext}`,
  }));
}

/** Roll `{category, path, classification}` rows up into per-category counts. */
export function summarize(rows) {
  const byCategory = {};
  for (const row of rows) {
    const bucket = byCategory[row.category] || (byCategory[row.category] = { art: 0, emoji: 0, paths: [] });
    bucket[row.classification] += 1;
    bucket.paths.push(row.path);
  }
  for (const bucket of Object.values(byCategory)) bucket.paths.sort();
  return byCategory;
}
