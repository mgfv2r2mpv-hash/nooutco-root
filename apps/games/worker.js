/**
 * Cloudflare Worker — save-photo + admin image management endpoints
 *
 * POST /api/save-photo            (existing — used by FamousPersonGame in-game)
 *   Body: { personName: string, imageUrl: string }
 *
 * POST /api/admin/save-image      (admin — add or replace any game image)
 *   Body: { game, folder, filename, imageUrl, personName?, personMeta? }
 *
 * POST /api/admin/remove-image    (admin — remove a single image)
 *   Body: { game, folder, filename, personName? }
 *   For clock / receptive / matching this records an exclusion rather than
 *   deleting the file — one blob now backs all three games (see "The shared
 *   stimulus library" below).
 *
 * POST /api/admin/archive-topic   (admin — soft-delete a T_ folder → _a_T_)
 *   Body: { game, folder }
 *
 * POST /api/admin/restore-topic   (admin — undo archive: _a_T_ → T_)
 *   Body: { game, folder }
 *
 * POST /api/admin/purge-topic     (admin — permanent hide: _a_T_ → _x_T_)
 *   Body: { game, folder }
 *
 * POST /api/admin/rename-topic    (admin — rename an active T_ folder)
 *   Body: { game, folder, newFolder }
 *
 * POST /api/admin/save-display-name (admin — set/clear manifest displayName override)
 *   Body: { game, localPath, displayName }   empty/blank displayName clears it
 *
 * POST /api/admin/ffc-save-items  (admin — write the whole ffc/items.json)
 *   Body: { items: <full items.json object> }
 *
 * POST /api/admin/ffc-save-image  (admin — download + store a single FFC item image)
 *   Body: { id, filename, imageUrl }
 *
 * POST /api/admin/ffc-remove-image (admin — delete a single FFC item image file)
 *   Body: { localPath }
 *
 * POST /api/admin/update-facts    (admin — AI-expand FamousPersonGame people to 4 facts)
 *   Body: {}
 *   Reads famous-person/index.html from GitHub, calls Anthropic API for any person
 *   with fewer than 4 facts, then commits the updated file back to main.
 *
 * Required Worker Secrets (set in Cloudflare dashboard):
 *   GITHUB_TOKEN  — fine-grained PAT, Contents: Read & Write on the repo
 *   GITHUB_OWNER  — GitHub username or org
 *   GITHUB_REPO   — repository name
 *   ADMIN_SECRET  — password used by AdminTools/ImageManager
 *   ANTHRO_KEY    — Anthropic API key (used by /api/admin/update-facts)
 *
 * Route (Cloudflare dashboard → Websites → games.nooutco.me → Worker Routes):
 *   games.nooutco.me/api/*  →  this Worker
 */

import {
  LIBRARY_ROOT,
  applyExclusion,
  applyLabel,
  applyUpload,
  publishingFrom,
  sortKeys,
  stableJson,
  stampManifests,
  stemOf,
  stimulusId,
} from './shared/stimuli/library.mjs';

const KNOWN_GAMES = ['IDMatchGame', 'NameIDGame', 'FamousPersonGame', 'HickoryDickoryDockGame'];

// Maps game API identifiers to their repo folder names (decoupled after URL shortening)
const GAME_PATHS = {
  IDMatchGame: 'matching',
  NameIDGame: 'receptive',
  HickoryDickoryDockGame: 'clock',
};
function gameFolder(g) { return GAME_PATHS[g] || g; }

/**
 * Games whose stimuli come from the shared library rather than from their own
 * `_Resources/_imgSource` tree. Their `manifest.json` is generated, so an admin
 * edit has to be written to the library's source files (`uploads/`,
 * `labels.json`, `publishing.json`) and the manifests re-projected — appending
 * to the manifest alone would be undone by the next `npm run stimuli:build`.
 */
const LIBRARY_GAMES = ['clock', 'receptive', 'matching'];
const isLibraryGame = (game) => LIBRARY_GAMES.includes(gameFolder(game));

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Public: serve an image straight from R2. The Pages worker rewrites portrait
    // URLs (/famous-person/_Resources/…/<slug>.<ext>) to /api/img/fpg/<slug> and
    // falls back to the static asset when the object isn't in R2 yet.
    if (request.method === 'GET' && pathname.startsWith('/api/img/')) {
      return handleServeImage(pathname, env);
    }

    if (request.method === 'POST' && pathname === '/api/save-photo') {
      return handleSavePhoto(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/save-image') {
      return handleAdminSaveImage(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/migrate-portraits-r2') {
      return handleMigratePortraitsR2(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/remove-image') {
      return handleAdminRemoveImage(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/archive-topic') {
      return handleAdminArchiveTopic(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/restore-topic') {
      return handleAdminRestoreTopic(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/purge-topic') {
      return handleAdminPurgeTopic(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/rename-topic') {
      return handleAdminRenameTopic(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/save-display-name') {
      return handleAdminSaveDisplayName(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/ffc-save-items') {
      return handleFFCSaveItems(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/ffc-save-image') {
      return handleFFCSaveImage(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/ffc-remove-image') {
      return handleFFCRemoveImage(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/ffc-suggest-mappings') {
      return handleAdminFfcSuggestMappings(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/intraverbal-save-items') {
      return handleIVSaveItems(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/intraverbal-save-image') {
      return handleIVSaveImage(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/intraverbal-remove-image') {
      return handleIVRemoveImage(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/sequences-save-symbols') {
      return handleSeqSaveSymbols(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/ping') {
      return handleAdminPing(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/update-facts') {
      return handleAdminUpdateFacts(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/rcc-save-facts') {
      return handleRccSaveFacts(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/rcc-generate-facts') {
      return handleRccGenerateFacts(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/batch') {
      return handleAdminBatch(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};

// ─── Admin: ping ─────────────────────────────────────────────────────────────

async function handleAdminPing(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  return json({ ok: true });
}

// ─── Admin: ffc-suggest-mappings ─────────────────────────────────────────────
// Suggest which FFC stimuli plausibly belong to a single {bucket, tag} label, to
// drive the Mass Assign "✨ Suggest" pass. Uses Anthropic when ANTHRO_KEY is set;
// otherwise a deterministic tag-overlap heuristic. The page applies the result as
// reviewable "suggested" tiles — the actual write still goes through ffc-save-items.
// Returns { suggested:[id…], source:'ai'|'heuristic' }.

const FFC_SUGGEST_MODEL   = 'claude-haiku-4-5';
const FFC_SUGGEST_BUCKETS = ['groups', 'features', 'functions', 'classes'];
const FFC_SUGGEST_TIMEOUT = 35000;

async function handleAdminFfcSuggestMappings(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body = {};
  try { body = await request.json(); } catch (_) { return jsonError('Invalid JSON body', 400); }

  const bucket = String(body.bucket || '');
  const tag    = String(body.label  || '');
  const items  = Array.isArray(body.items) ? body.items : null;
  if (!FFC_SUGGEST_BUCKETS.includes(bucket)) {
    return jsonError('bucket must be one of: ' + FFC_SUGGEST_BUCKETS.join(', '), 400);
  }
  if (!tag) return jsonError('label (tag) is required', 400);
  if (!items || !items.length) return jsonError('items must be a non-empty array', 400);

  // Normalise to { id, label, tags:[…] }; track valid ids + ids already carrying the tag.
  const norm = items.map(it => ({
    id:    String(it.id ?? ''),
    label: String(it.label ?? ''),
    tags:  Array.isArray(it.tags) ? it.tags.map(String) : [],
  })).filter(it => it.id);
  const validIds      = new Set(norm.map(it => it.id));
  const alreadyTagged = new Set(norm.filter(it => it.tags.includes(tag)).map(it => it.id));

  if (env.ANTHRO_KEY) {
    try {
      const ai = await ffcSuggestViaAI(env, bucket, tag, norm);
      const suggested = ai.filter(id => validIds.has(id) && !alreadyTagged.has(id));
      return json({ suggested, source: 'ai' });
    } catch (_) {
      // fall through to the deterministic heuristic on any AI/parse/timeout failure
    }
  }

  return json({ suggested: ffcSuggestViaOverlap(norm, alreadyTagged), source: 'heuristic' });
}

// Deterministic no-key fallback: an untagged item is suggested when it shares ≥1
// tag (any bucket) with an item that already carries the target {bucket, tag}.
function ffcSuggestViaOverlap(norm, alreadyTagged) {
  const seedTags = new Set();
  norm.forEach(it => { if (alreadyTagged.has(it.id)) it.tags.forEach(t => seedTags.add(t)); });
  if (!seedTags.size) return [];
  return norm
    .filter(it => !alreadyTagged.has(it.id) && it.tags.some(t => seedTags.has(t)))
    .map(it => it.id);
}

async function ffcSuggestViaAI(env, bucket, tag, norm) {
  const system =
    'You classify children\'s learning stimuli for an ABA "Feature / Function / Class" game. ' +
    'Given a target label and a list of stimuli (each with an id, a human label, and its current tags), ' +
    'return ONLY the stimuli that genuinely belong to the target label. ' +
    'Reply with a single JSON object and nothing else — no markdown fences, no preamble: ' +
    '{"suggested":[<id>,…]} using the exact ids given. ' +
    'Be precise: include an id only when the stimulus clearly fits the label; an empty list is fine.';
  const userPayload = {
    target:  { bucket, tag },
    stimuli: norm.map(it => ({ id: it.id, label: it.label, tags: it.tags })),
  };

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FFC_SUGGEST_TIMEOUT);
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         env.ANTHRO_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      FFC_SUGGEST_MODEL,
        max_tokens: 1024,
        system,
        messages:   [{ role: 'user', content: JSON.stringify(userPayload) }],
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`anthropic ${res.status}`);
  const data = await res.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('no text block');
  const raw = textBlock.text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed.suggested) ? parsed.suggested.map(String) : [];
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function requireAdmin(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return jsonError('Unauthorized', 401);
  const secret = (env.ADMIN_SECRET ?? '').trim();
  const buf = new TextEncoder().encode(secret);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const hash = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  if (token !== hash) return jsonError('Unauthorized', 401);
  return null;
}

// ─── Existing save-photo handler ───────────────────────────────────────────────

async function handleSavePhoto(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { personName, imageUrl } = body;
  if (!personName || !imageUrl) {
    return jsonError('personName and imageUrl are required', 400);
  }

  let parsedUrl;
  try { parsedUrl = new URL(imageUrl); }
  catch { return jsonError('Invalid imageUrl', 400); }

  if (!parsedUrl.hostname.endsWith('wikimedia.org') &&
      !parsedUrl.hostname.endsWith('wikipedia.org')) {
    return jsonError('imageUrl must be from wikimedia.org or wikipedia.org', 403);
  }

  let imgBytes, ext;
  try {
    ({ bytes: imgBytes, ext } = await downloadImage(imageUrl));
  } catch (err) {
    return jsonError('Failed to download image: ' + err.message, 502);
  }

  const slug      = nameToSlug(personName);
  const localPath = `_Resources/_imgSource/images/${slug}.${ext}`;

  // Portrait bytes → R2 (instant, no commit/deploy). The roster img field is
  // patched into git only when it actually changes (see commitFPGMeta).
  try {
    await putPortraitR2(env, slug, imgBytes, ext);
  } catch (err) {
    return jsonError('R2 image save failed: ' + err.message, 502);
  }
  try {
    await commitFPGMetaWithRetry(env, { personName, localPath });
  } catch (err) {
    // Image is already in R2 and serves fine; a stale roster img field still
    // resolves via the extension-agnostic key, so a meta failure is non-fatal.
    return json({ ok: true, localPath, metaWarning: err.message });
  }

  return json({ ok: true, localPath });
}

// ─── Admin: save-image ────────────────────────────────────────────────────────

async function handleAdminSaveImage(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { game, folder, filename, imageUrl, imageData, imageMime, personName, personMeta } = body;
  if (!game || !folder || !filename || (!imageUrl && !imageData)) {
    return jsonError('game, folder, filename, and imageUrl or imageData are required', 400);
  }
  if (!KNOWN_GAMES.includes(game)) {
    return jsonError('Unknown game: ' + game, 400);
  }

  let imgBytes, ext;
  try {
    ({ bytes: imgBytes, ext } = await resolveImage(imageUrl, imageData, imageMime));
  } catch (err) {
    return jsonError('Failed to load image: ' + err.message, 502);
  }

  // Use detected extension so the saved file always matches its content-type.
  const base = filename.replace(/\.[^.]+$/, '');
  const saveFilename = `${base}.${ext}`;

  if (game === 'FamousPersonGame') {
    const localPath = `_Resources/_imgSource/images/${saveFilename}`;
    try {
      await putPortraitR2(env, base, imgBytes, ext);
    } catch (err) {
      return jsonError('R2 image save failed: ' + err.message, 502);
    }
    try {
      await commitFPGMetaWithRetry(env, { personName, personMeta, localPath });
    } catch (err) {
      return json({ ok: true, path: localPath, filename: saveFilename, metaWarning: err.message });
    }
    return json({ ok: true, path: localPath, filename: saveFilename });
  }

  if (!isLibraryGame(game)) return jsonError('Unknown game: ' + game, 400);
  if (!/^T_/.test(folder))  return jsonError('folder must start with T_', 400);

  let change;
  try {
    change = await commitLibraryChange(env, (state) => libraryUploadPlan(state, {
      game: gameFolder(game),
      folder,
      filename: saveFilename,
      bytes: imgBytes,
    }));
  } catch (err) {
    return jsonError('GitHub commit failed: ' + err.message, 502);
  }

  // `path` is the URL the manifest now serves — site-absolute, and the same for
  // every game that runs this stimulus.
  return json({ ok: true, path: change.url, url: change.url, id: change.id, filename: saveFilename });
}

// ─── Admin: remove-image ──────────────────────────────────────────────────────

async function handleAdminRemoveImage(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { game, folder, filename, localPath, id, personName } = body;
  if (!game || !folder || !filename) {
    return jsonError('game, folder, and filename are required', 400);
  }
  if (!KNOWN_GAMES.includes(game)) {
    return jsonError('Unknown game: ' + game, 400);
  }

  if (game === 'FamousPersonGame') {
    const repoPath = `famous-person/_Resources/_imgSource/images/${filename}`;
    // Portrait bytes live in R2 — delete the object so a removed portrait stops
    // serving. Best-effort; the git commit below still removes any legacy static
    // file and clears the roster img field.
    if (env.IMAGES) {
      try { await env.IMAGES.delete(fpgR2Key(filename.replace(/\.[^.]+$/, ''))); } catch { /* non-fatal */ }
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await atomicFPGRemoveCommit(env, personName, repoPath);
        break;
      } catch (err) {
        if (err.message === 'CONFLICT' && attempt < 2) continue;
        return jsonError('GitHub commit failed: ' + err.message, 502);
      }
    }
    return json({ ok: true });
  }

  if (!isLibraryGame(game)) return jsonError('Unknown game: ' + game, 400);
  const libraryGame = gameFolder(game);

  let change;
  try {
    change = await commitLibraryChange(env, async (state) => {
      const stimulus = resolveStimulusId(state, libraryGame, { id, localPath, folder, filename });
      if (!stimulus) throw new Error(`NOT_FOUND:${folder}/${filename}`);
      const applied = applyExclusion(state, { game: libraryGame, category: folder, id: stimulus });
      return {
        id: stimulus,
        message: `Admin: stop ${libraryGame} offering ${stimulus} (${folder})`,
        documents: changedLibraryDocuments(state, await finalLibraryDocuments(foldLibraryState(state, applied))),
      };
    });
  } catch (err) {
    if (err.message.startsWith('NOT_FOUND:')) {
      return jsonError(`No stimulus in the shared library for ${err.message.slice(10)}`, 404);
    }
    return jsonError('GitHub commit failed: ' + err.message, 502);
  }

  // The art stays in the library — only this game stops offering it. Deleting
  // the file would pull the same picture out of the other two games.
  return json({ ok: true, id: change.id, excluded: true });
}

// ─── Public: serve an image from R2 ──────────────────────────────────────────
// GET /api/img/<key>. Returns the stored bytes + content-type, or 404 when the
// object isn't in R2 (the Pages worker then falls back to the static asset).
async function handleServeImage(pathname, env) {
  const key = decodeURIComponent(pathname.slice('/api/img/'.length));
  if (!key || key.includes('..')) return new Response('Not found', { status: 404 });
  if (!env.IMAGES)                 return new Response('Not found', { status: 404 });

  let obj;
  try { obj = await env.IMAGES.get(key); }
  catch { return new Response('Not found', { status: 404 }); }
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  if (!headers.has('content-type')) headers.set('content-type', 'image/jpeg');
  headers.set('etag', obj.httpEtag);
  headers.set('Cache-Control', 'public, max-age=600');
  headers.set('Access-Control-Allow-Origin', '*');
  return new Response(obj.body, { headers });
}

// ─── Admin: migrate existing portraits into R2 ───────────────────────────────
// One-time backfill: copy the deployed famous-person portraits (repo files) into
// R2 under fpg/<slug>. Chunked + resumable so a single invocation stays within
// Cloudflare limits — POST { start, limit }, repeat with the returned nextStart
// until { done:true }. Idempotent (re-running just re-PUTs the same bytes).
async function handleMigratePortraitsR2(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  if (!env.IMAGES) return jsonError('R2 bucket IMAGES not bound', 500);

  let body = {};
  try { body = await request.json(); } catch { /* defaults */ }
  const start = Number.isInteger(body.start) ? Math.max(0, body.start) : 0;
  const limit = Number.isInteger(body.limit) ? Math.min(Math.max(1, body.limit), 50) : 40;

  let listing;
  try {
    listing = await gh(env, 'GET', 'contents/famous-person/_Resources/_imgSource/images');
  } catch (err) {
    return jsonError('Failed to list portraits: ' + err.message, 502);
  }
  const files = (Array.isArray(listing) ? listing : [])
    .filter(f => f.type === 'file' && /\.(jpe?g|png|webp|gif|avif|svg)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const total = files.length;
  const slice = files.slice(start, start + limit);

  const migrated = [];
  const failed   = [];
  const CONCURRENCY = 5;
  let cursor = 0;
  async function pump() {
    while (cursor < slice.length) {
      const f    = slice[cursor++];
      const base = f.name.replace(/\.[^.]+$/, '');
      const ext  = f.name.split('.').pop().toLowerCase();
      try {
        const blob   = await gh(env, 'GET', `git/blobs/${f.sha}`);
        const binary = atob(blob.content.replace(/\s/g, ''));
        const bytes  = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        await env.IMAGES.put(fpgR2Key(base), bytes.buffer, { httpMetadata: { contentType: mimeForExt(ext) } });
        migrated.push(base);
      } catch (err) {
        failed.push({ name: f.name, error: err.message });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, slice.length) }, pump));

  const nextStart = start + slice.length;
  return json({ ok: true, total, start, count: migrated.length, migrated, failed, nextStart, done: nextStart >= total });
}

// ─── Admin: archive-topic ─────────────────────────────────────────────────────

async function handleAdminArchiveTopic(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { game, folder } = body;
  if (!game || !folder) return jsonError('game and folder are required', 400);
  if (!KNOWN_GAMES.includes(game)) return jsonError('Unknown game: ' + game, 400);
  if (!/^T_/.test(folder)) return jsonError('folder must start with T_', 400);

  const archivedFolder = `_a_${folder}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await atomicTopicRenameCommit(env, game, folder, archivedFolder, 'archive');
      break;
    } catch (err) {
      if (attempt < 2 && (err.message === 'CONFLICT' || err.message.startsWith('No files found'))) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true, archived: archivedFolder });
}

// ─── Admin: restore-topic ─────────────────────────────────────────────────────

async function handleAdminRestoreTopic(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { game, folder } = body;
  if (!game || !folder) return jsonError('game and folder are required', 400);
  if (!KNOWN_GAMES.includes(game)) return jsonError('Unknown game: ' + game, 400);
  if (!/^_a_T_/.test(folder)) return jsonError('folder must start with _a_T_', 400);

  const restoredFolder = folder.replace(/^_a_/, '');

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await atomicTopicRenameCommit(env, game, folder, restoredFolder, 'restore');
      break;
    } catch (err) {
      if (attempt < 2 && (err.message === 'CONFLICT' || err.message.startsWith('No files found'))) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true, restored: restoredFolder });
}

// ─── Admin: purge-topic ───────────────────────────────────────────────────────

async function handleAdminPurgeTopic(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { game, folder } = body;
  if (!game || !folder) return jsonError('game and folder are required', 400);
  if (!KNOWN_GAMES.includes(game)) return jsonError('Unknown game: ' + game, 400);
  if (!/^_a_T_/.test(folder)) return jsonError('folder must start with _a_T_', 400);

  const purgedFolder = folder.replace(/^_a_/, '_x_');

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await atomicTopicRenameCommit(env, game, folder, purgedFolder, 'purge');
      break;
    } catch (err) {
      if (attempt < 2 && (err.message === 'CONFLICT' || err.message.startsWith('No files found'))) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true, purged: purgedFolder });
}

// ─── Admin: rename-topic ──────────────────────────────────────────────────────

async function handleAdminRenameTopic(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { game, folder, newFolder } = body;
  if (!game || !folder || !newFolder) return jsonError('game, folder, and newFolder are required', 400);
  if (!KNOWN_GAMES.includes(game)) return jsonError('Unknown game: ' + game, 400);
  if (!/^T_/.test(folder))    return jsonError('folder must start with T_', 400);
  if (!/^T_/.test(newFolder)) return jsonError('newFolder must start with T_', 400);
  if (folder === newFolder)   return jsonError('newFolder must differ from folder', 400);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await atomicTopicRenameCommit(env, game, folder, newFolder, 'rename');
      break;
    } catch (err) {
      if (attempt < 2 && (err.message === 'CONFLICT' || err.message.startsWith('No files found'))) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true, renamed: newFolder });
}

// ─── Admin: save-display-name ─────────────────────────────────────────────────

async function handleAdminSaveDisplayName(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { game, localPath, displayName, itemId, personName } = body;
  if (!game) return jsonError('game is required', 400);

  if (game === 'FFCGame') {
    if (!itemId) return jsonError('itemId is required for FFCGame', 400);
    const trimmed = typeof displayName === 'string' ? displayName.trim() : '';
    if (!trimmed) return jsonError('displayName cannot be empty for FFCGame', 400);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await atomicFFCLabelCommit(env, itemId, trimmed);
        break;
      } catch (err) {
        if (err.message === 'CONFLICT' && attempt < 2) continue;
        return jsonError('GitHub commit failed: ' + err.message, 502);
      }
    }
    return json({ ok: true });
  }

  if (game === 'FamousPersonGame') {
    if (!personName) return jsonError('personName is required for FamousPersonGame', 400);
    const trimmed = typeof displayName === 'string' ? displayName.trim() : '';
    if (!trimmed) return jsonError('displayName cannot be empty for FamousPersonGame', 400);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await atomicFPGRenamePersonCommit(env, personName, trimmed);
        break;
      } catch (err) {
        if (err.message === 'CONFLICT' && attempt < 2) continue;
        return jsonError('GitHub commit failed: ' + err.message, 502);
      }
    }
    return json({ ok: true });
  }

  if (!isLibraryGame(game)) {
    return jsonError('Unknown game: ' + game, 400);
  }
  if (!localPath && !body.id) return jsonError('localPath is required', 400);

  const libraryGame = gameFolder(game);
  const label = typeof displayName === 'string' ? displayName.trim() : '';

  let change;
  try {
    change = await commitLibraryChange(env, async (state) => {
      const stimulus = resolveStimulusId(state, libraryGame, { id: body.id, localPath, folder: body.folder, filename: body.filename });
      if (!stimulus) throw new Error(`NOT_FOUND:${localPath || body.id}`);
      const applied = applyLabel(state, { id: stimulus, label });
      return {
        id: stimulus,
        label: applied.label,
        message: label
          ? `Admin: set display name "${label}" for ${stimulus}`
          : `Admin: clear display name for ${stimulus}`,
        documents: changedLibraryDocuments(state, await finalLibraryDocuments(foldLibraryState(state, applied))),
      };
    });
  } catch (err) {
    if (err.message.startsWith('NOT_FOUND:')) {
      return jsonError(`No stimulus in the shared library for ${err.message.slice(10)}`, 404);
    }
    return jsonError('GitHub commit failed: ' + err.message, 502);
  }

  return json({ ok: true, id: change.id, displayName: change.label });
}

// ─── Atomic commit: FFCGame item label update ────────────────────────────────

async function atomicFFCLabelCommit(env, itemId, newLabel) {
  const refData    = await gh(env, 'GET', `git/ref/heads/${env.GITHUB_BRANCH || 'main'}`);
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const itemsRepoPath = 'ffc/items.json';
  const itemsFile     = await gh(env, 'GET', `contents/${itemsRepoPath}`);
  const items         = JSON.parse(base64ToUtf8(itemsFile.content.replace(/\s/g, '')));

  const item = (items.items || []).find(i => i.id === itemId);
  if (!item) throw new Error(`Item not found: ${itemId}`);
  item.label = newLabel;
  items.generated = new Date().toISOString();

  const itemsBlob = await gh(env, 'POST', 'git/blobs', {
    content:  utf8ToBase64(JSON.stringify(items, null, 2) + '\n'),
    encoding: 'base64',
  });
  const newTree   = await gh(env, 'POST', 'git/trees', {
    base_tree: treeSha,
    tree: [{ path: itemsRepoPath, mode: '100644', type: 'blob', sha: itemsBlob.sha }],
  });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Admin: set label "${newLabel}" for FFC item ${itemId}`,
    tree:    newTree.sha,
    parents: [headSha],
  });
  const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${env.GITHUB_BRANCH || 'main'}`, { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Atomic commit: FamousPersonGame person rename ───────────────────────────

async function atomicFPGRenamePersonCommit(env, currentName, newName) {
  const refData    = await gh(env, 'GET', `git/ref/heads/${env.GITHUB_BRANCH || 'main'}`);
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const htmlFile   = await gh(env, 'GET', 'contents/famous-person/index.html');
  const htmlNow    = base64ToUtf8(htmlFile.content.replace(/\s/g, ''));

  const safe = currentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re   = new RegExp(`(name:\\s*['"])${safe}(['"])`);
  if (!re.test(htmlNow)) throw new Error(`Person not found: ${currentName}`);
  const escaped = newName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const htmlPatched = htmlNow.replace(re, `$1${escaped}$2`);

  const htmlBlob = await gh(env, 'POST', 'git/blobs', {
    content:  utf8ToBase64(htmlPatched),
    encoding: 'base64',
  });
  const newTree   = await gh(env, 'POST', 'git/trees', {
    base_tree: treeSha,
    tree: [{ path: 'famous-person/index.html', mode: '100644', type: 'blob', sha: htmlBlob.sha }],
  });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Admin: rename person "${currentName}" → "${newName}"`,
    tree:    newTree.sha,
    parents: [headSha],
  });
  const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${env.GITHUB_BRANCH || 'main'}`, { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Commit ONLY the FPG roster text (img field / new person) ────────────────
// The portrait bytes now live in R2, so a save no longer commits an image blob.
// This patches famous-person/index.html and commits *only when the roster text
// actually changes*. Replacing an existing portrait (img field already correct)
// is a no-op here → no commit, no deploy, instant. Returns { changed }.
async function commitFPGMeta(env, { personName, personMeta, localPath }) {
  const branch = env.GITHUB_BRANCH || 'main';

  const htmlFile = await gh(env, 'GET', 'contents/famous-person/index.html');
  const htmlNow  = base64ToUtf8(htmlFile.content.replace(/\s/g, ''));
  let   htmlPatched = htmlNow;
  if (personName)      htmlPatched = patchImg(htmlNow, personName, localPath);
  else if (personMeta) htmlPatched = appendPerson(htmlNow, localPath, personMeta);

  if (htmlPatched === htmlNow) return { changed: false };

  const refData    = await gh(env, 'GET', `git/ref/heads/${branch}`);
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const htmlBlob = await gh(env, 'POST', 'git/blobs', { content: utf8ToBase64(htmlPatched), encoding: 'base64' });
  const newTree  = await gh(env, 'POST', 'git/trees', {
    base_tree: treeSha,
    tree: [{ path: 'famous-person/index.html', mode: '100644', type: 'blob', sha: htmlBlob.sha }],
  });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: personName ? `Update roster img for ${personName}` : `Add person ${(personMeta && personMeta.name) || ''}`.trim(),
    tree:    newTree.sha,
    parents: [headSha],
  });
  const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${branch}`, { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
  return { changed: true };
}

async function commitFPGMetaWithRetry(env, args) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await commitFPGMeta(env, args); }
    catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) { await sleep(400 * (attempt + 1)); continue; }
      throw err;
    }
  }
}

// ─── Atomic commit: FamousPersonGame image remove ────────────────────────────

async function atomicFPGRemoveCommit(env, personName, repoPath) {
  const refData    = await gh(env, 'GET', `git/ref/heads/${env.GITHUB_BRANCH || 'main'}`);
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const treeEntries = [
    { path: repoPath, mode: '100644', type: 'blob', sha: null },
  ];

  if (personName) {
    const htmlFile  = await gh(env, 'GET', 'contents/famous-person/index.html');
    const htmlNow   = base64ToUtf8(htmlFile.content.replace(/\s/g, ''));
    const htmlPatch = patchImg(htmlNow, personName, '');
    if (htmlPatch !== htmlNow) {
      const htmlBlob = await gh(env, 'POST', 'git/blobs', {
        content:  utf8ToBase64(htmlPatch),
        encoding: 'base64',
      });
      treeEntries.push({ path: 'famous-person/index.html', mode: '100644', type: 'blob', sha: htmlBlob.sha });
    }
  }

  const newTree   = await gh(env, 'POST', 'git/trees', { base_tree: treeSha, tree: treeEntries });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Remove image ${repoPath}`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${env.GITHUB_BRANCH || 'main'}`, { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── The shared stimulus library ──────────────────────────────────────────────
//
// clock, receptive and matching no longer own their art: one merged library
// under `shared/stimuli/` backs all three, and each `manifest.json` is a
// projection of it (`shared/stimuli/build.mjs`). A generated file cannot hold
// anything a technician changes, so an admin edit is written to the library's
// source files and every manifest is re-projected in the same commit:
//
//   an upload   → `shared/stimuli/uploads/<T_folder>/<file>` (+ the img/ path
//                 its URL resolves to: one blob, two tree entries, or the
//                 published URL 404s until someone runs a rebuild)
//   a label     → `shared/stimuli/labels.json`
//   a removal   → `shared/stimuli/publishing.json` — an exclusion, NOT a file
//                 delete: the same bytes back three games now, so deleting
//                 T_animals/bear.jpg for matching would pull the picture out of
//                 clock and receptive too.
//
// `library.mjs` holds the rules and is shared with the builder verbatim;
// `tests/stimulus-library-worker.spec.js` drives these handlers against an
// in-memory GitHub and asserts the resulting commit is byte-for-byte what
// `npm run stimuli:build` would produce from it.

/** Library files whose committed text is `stableJson(...)` of parsed JSON. */
const LIBRARY_DOCUMENTS = {
  index:      `${LIBRARY_ROOT}/stimuli.json`,
  provenance: `${LIBRARY_ROOT}/provenance.json`,
  publishing: `${LIBRARY_ROOT}/publishing.json`,
  labels:     `${LIBRARY_ROOT}/labels.json`,
};

async function ghJsonFile(env, repoPath) {
  const file = await gh(env, 'GET', `contents/${repoPath}`);
  return JSON.parse(base64ToUtf8(file.content.replace(/\s/g, '')));
}

async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Everything `library.mjs` needs, read straight from the branch. */
async function readLibraryState(env) {
  const [index, provenance, publishing, labelsFile, ...manifestList] = await Promise.all([
    ghJsonFile(env, LIBRARY_DOCUMENTS.index),
    ghJsonFile(env, LIBRARY_DOCUMENTS.provenance),
    ghJsonFile(env, LIBRARY_DOCUMENTS.publishing),
    ghJsonFile(env, LIBRARY_DOCUMENTS.labels),
    ...LIBRARY_GAMES.map(g => ghJsonFile(env, `${g}/manifest.json`)),
  ]);
  return {
    index,
    provenance,
    publishing,
    labelsFile,
    labels: labelsFile.overrides || {},
    derivedLabels: labelsFile.derived || {},
    manifests: Object.fromEntries(LIBRARY_GAMES.map((g, i) => [g, manifestList[i]])),
  };
}

/**
 * The committed text of every library file an `apply*` result changes.
 *
 * Same set `build.mjs` writes, so an unchanged document drops out here rather
 * than landing in the commit as a no-op diff — both producers serialise through
 * `stableJson`, which is what makes the comparison exact.
 */
function changedLibraryDocuments(state, result) {
  const proposed = new Map();
  if (result.index)      proposed.set(LIBRARY_DOCUMENTS.index, result.index);
  if (result.provenance) proposed.set(LIBRARY_DOCUMENTS.provenance, result.provenance);
  if (result.publishing) proposed.set(LIBRARY_DOCUMENTS.publishing, result.publishing);
  if (result.labels || result.derivedLabels) {
    proposed.set(LIBRARY_DOCUMENTS.labels, {
      ...state.labelsFile,
      overrides: sortKeys(result.labels || state.labels),
      derived:   sortKeys(result.derivedLabels || state.derivedLabels),
    });
  }
  for (const [game, manifest] of Object.entries(result.manifests || {})) {
    proposed.set(`${game}/manifest.json`, manifest);
  }

  const committed = new Map([
    [LIBRARY_DOCUMENTS.index, state.index],
    [LIBRARY_DOCUMENTS.provenance, state.provenance],
    [LIBRARY_DOCUMENTS.publishing, state.publishing],
    [LIBRARY_DOCUMENTS.labels, state.labelsFile],
    ...Object.entries(state.manifests).map(([game, m]) => [`${game}/manifest.json`, m]),
  ]);

  const changed = new Map();
  for (const [repoPath, value] of proposed) {
    const text = stableJson(value);
    if (text !== stableJson(committed.get(repoPath))) changed.set(repoPath, text);
  }
  return changed;
}

/**
 * Thread one `apply*` result back into the state the next one reads, so a batch
 * of admin operations folds through `library.mjs` in order. `games` carries the
 * programme + exclusion state forward; without it the second op in a batch would
 * re-derive it from the manifests it has already superseded.
 */
function foldLibraryState(state, applied) {
  return {
    ...state,
    index:         applied.index         || state.index,
    provenance:    applied.provenance    || state.provenance,
    manifests:     applied.manifests     || state.manifests,
    games:         applied.games         || state.games,
    publishing:    applied.publishing    || state.publishing,
    labels:        applied.labels        || state.labels,
    derivedLabels: applied.derivedLabels || state.derivedLabels,
  };
}

/**
 * The folded state as a set of documents to commit. `generated` is the index
 * digest rather than a timestamp, so it is stamped once here from the final
 * index — every intermediate projection carried a stamp that no longer holds.
 */
async function finalLibraryDocuments(state) {
  return {
    index:         state.index,
    provenance:    state.provenance,
    publishing:    state.games ? publishingFrom(state.games) : state.publishing,
    labels:        state.labels,
    derivedLabels: state.derivedLabels,
    manifests:     stampManifests(state.manifests, await sha256Hex(stableJson(state.index))),
  };
}

/**
 * Read the library, plan a change against it, and commit the whole thing as one
 * tree. Retried end-to-end: `force: false` rejects the ref update when another
 * commit landed after the head we read, so the plan is recomputed against the
 * new head rather than replayed onto a stale one.
 *
 * @param {function} plan `(state) => { message, documents, blobs, removeRepoPaths, ...result }`
 */
async function commitLibraryChange(env, plan) {
  const branch = env.GITHUB_BRANCH || 'main';

  for (let attempt = 0; attempt < 3; attempt++) {
    const refData    = await gh(env, 'GET', `git/ref/heads/${branch}`);
    const headSha    = refData.object.sha;
    const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
    const treeSha    = commitData.tree.sha;

    const state  = await readLibraryState(env);
    const change = await plan(state);
    if (!change.documents.size && !(change.blobs || []).length && !(change.removeRepoPaths || []).length) {
      return change; // nothing to do — don't spend a commit on it
    }

    const tree = [];
    for (const { repoPaths, bytes } of change.blobs || []) {
      const blob = await gh(env, 'POST', 'git/blobs', { content: arrayBufferToBase64(bytes), encoding: 'base64' });
      for (const repoPath of repoPaths) tree.push({ path: repoPath, mode: '100644', type: 'blob', sha: blob.sha });
    }
    for (const [repoPath, text] of change.documents) {
      const blob = await gh(env, 'POST', 'git/blobs', { content: utf8ToBase64(text), encoding: 'base64' });
      tree.push({ path: repoPath, mode: '100644', type: 'blob', sha: blob.sha });
    }
    for (const repoPath of change.removeRepoPaths || []) {
      tree.push({ path: repoPath, mode: '100644', type: 'blob', sha: null });
    }

    const newTree   = await gh(env, 'POST', 'git/trees', { base_tree: treeSha, tree });
    const newCommit = await gh(env, 'POST', 'git/commits', {
      message: change.message,
      tree:    newTree.sha,
      parents: [headSha],
    });

    const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${branch}`, { sha: newCommit.sha, force: false });
    if (refRes.ok) return change;
    if (refRes.status === 422 && attempt < 2) continue;
    throw new Error(refRes.status === 422 ? 'CONFLICT' : `ref update: ${refRes.status}`);
  }
  throw new Error('CONFLICT');
}

/**
 * Which stimulus an admin request names.
 *
 * AdminTools identifies an image by the path the manifest serves it from, and
 * after the repoint that is a library URL. A legacy `_Resources` path still
 * resolves through the manifest's own `pathAliases`, and folder + filename is
 * the last resort because ids are derived from exactly that pair.
 */
function resolveStimulusId(state, game, { id, localPath, folder, filename }) {
  const known = new Set(state.index.stimuli.map(e => e.id));
  if (id && known.has(id)) return id;

  const byUrl = new Map();
  for (const entry of state.index.stimuli) {
    for (const url of [entry.image, entry.placeholder, ...(entry.variants || [])]) {
      if (url) byUrl.set(url, entry.id);
    }
  }
  if (localPath) {
    const aliases = (state.manifests[game] && state.manifests[game].pathAliases) || {};
    const url = byUrl.has(localPath) ? localPath : aliases[localPath];
    if (url && byUrl.has(url)) return byUrl.get(url);
  }
  if (folder && filename) {
    const derived = stimulusId(folder, stemOf(filename));
    if (known.has(derived)) return derived;
  }
  return null;
}

async function libraryUploadPlan(state, { game, folder, filename, bytes }) {
  const applied = applyUpload(state, {
    game,
    category: folder,
    filename,
    sha256: await sha256Hex(bytes),
  });
  const folded = foldLibraryState(state, applied);
  return {
    id: applied.id,
    url: applied.url,
    message: `Admin: add ${folder}/${filename} to the shared stimulus library`,
    documents: changedLibraryDocuments(state, await finalLibraryDocuments(folded)),
    // One blob, two tree entries: the upload is the source a rebuild rescans,
    // the img/ path is what the published URL resolves to.
    blobs: [{ repoPaths: applied.addRepoPaths, bytes }],
    removeRepoPaths: applied.removeRepoPaths,
  };
}

// ─── Atomic commit: topic folder rename (archive / restore / purge) ───────────

async function atomicTopicRenameCommit(env, game, fromFolder, toFolder, action) {
  const imgSourcePrefix = `${gameFolder(game)}/_Resources/_imgSource`;
  const manifestRepoPath = `${gameFolder(game)}/manifest.json`;

  // 1. Get HEAD
  const refData    = await gh(env, 'GET', `git/ref/heads/${env.GITHUB_BRANCH || 'main'}`);
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  // 2. Get full recursive tree to find all files in the source folder
  const fullTree = await gh(env, 'GET', `git/trees/${treeSha}?recursive=1`);
  if (fullTree.truncated) {
    throw new Error(`Tree too large to list; cannot rename ${fromFolder}`);
  }
  const prefix   = `${imgSourcePrefix}/${fromFolder}/`;
  const toMove   = fullTree.tree.filter(entry => entry.path.startsWith(prefix) && entry.type === 'blob');

  if (toMove.length === 0) {
    throw new Error(`No files found in ${fromFolder}`);
  }

  // 3. Read and update manifest
  const manifestFile = await gh(env, 'GET', `contents/${manifestRepoPath}`);
  const manifest     = JSON.parse(base64ToUtf8(manifestFile.content.replace(/\s/g, '')));
  if (!manifest.archived) manifest.archived = {};

  if (action === 'archive') {
    manifest.folders = manifest.folders.filter(f => f !== fromFolder);
    manifest.archived[toFolder] = (manifest.images[fromFolder] || [])
      .map(p => p.replace(`/${fromFolder}/`, `/${toFolder}/`));
    delete manifest.images[fromFolder];
  } else if (action === 'restore') {
    const baseFolder = fromFolder.replace(/^_a_/, '');
    manifest.folders = [...manifest.folders, baseFolder].sort();
    manifest.images[baseFolder] = (manifest.archived[fromFolder] || [])
      .map(p => p.replace(`/${fromFolder}/`, `/${baseFolder}/`));
    delete manifest.archived[fromFolder];
  } else if (action === 'purge') {
    delete manifest.archived[fromFolder];
  } else if (action === 'rename') {
    manifest.folders = [...manifest.folders.filter(f => f !== fromFolder), toFolder].sort();
    manifest.images[toFolder] = (manifest.images[fromFolder] || [])
      .map(p => p.replace(`/${fromFolder}/`, `/${toFolder}/`));
    delete manifest.images[fromFolder];
  }

  // Keep displayNames keyed by the current path of each image.
  if (manifest.displayNames) {
    if (action === 'purge') {
      for (const p of Object.keys(manifest.displayNames)) {
        if (p.includes(`/${fromFolder}/`)) delete manifest.displayNames[p];
      }
    } else {
      const migrated = {};
      for (const [p, name] of Object.entries(manifest.displayNames)) {
        const toKey = p.includes(`/${fromFolder}/`)
          ? p.replace(`/${fromFolder}/`, `/${toFolder}/`)
          : p;
        migrated[toKey] = name;
      }
      manifest.displayNames = migrated;
    }
  }

  manifest.generated = new Date().toISOString();

  // 4. Build tree entries: copy files to new path, delete from old path
  const treeEntries = [];
  for (const entry of toMove) {
    const newPath = entry.path.replace(`/${fromFolder}/`, `/${toFolder}/`);
    treeEntries.push({ path: newPath,    mode: entry.mode, type: 'blob', sha: entry.sha });
    treeEntries.push({ path: entry.path, mode: entry.mode, type: 'blob', sha: null });
  }

  // 5. Updated manifest blob
  const manifestBlob = await gh(env, 'POST', 'git/blobs', {
    content:  utf8ToBase64(JSON.stringify(manifest, null, 2) + '\n'),
    encoding: 'base64',
  });
  treeEntries.push({ path: manifestRepoPath, mode: '100644', type: 'blob', sha: manifestBlob.sha });

  // 6. Commit
  const newTree   = await gh(env, 'POST', 'git/trees', { base_tree: treeSha, tree: treeEntries });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Admin: ${action} topic ${fromFolder} → ${toFolder}`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${env.GITHUB_BRANCH || 'main'}`, { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── FFC: save items.json ─────────────────────────────────────────────────────

async function handleFFCSaveItems(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { items: itemsObj } = body;
  if (!itemsObj || typeof itemsObj !== 'object') {
    return jsonError('items object is required', 400);
  }

  itemsObj.generated = new Date().toISOString();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await atomicFFCSaveCommit(env, itemsObj);
      break;
    } catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true, generated: itemsObj.generated });
}

// ─── FFC: save image ──────────────────────────────────────────────────────────

async function handleFFCSaveImage(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { id, filename, imageUrl, imageData, imageMime } = body;
  if (!id || !filename || (!imageUrl && !imageData)) {
    return jsonError('id, filename, and imageUrl or imageData are required', 400);
  }

  let imgBytes, ext;
  try {
    ({ bytes: imgBytes, ext } = await resolveImage(imageUrl, imageData, imageMime));
  } catch (err) {
    return jsonError('Failed to load image: ' + err.message, 502);
  }

  const base         = filename.replace(/\.[^.]+$/, '');
  const saveFilename = `${base}.${ext}`;
  const repoPath     = `ffc/_Resources/_imgSource/items/${saveFilename}`;
  const localPath    = repoPath;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await atomicFFCImageCommit(env, repoPath, imgBytes, saveFilename);
      break;
    } catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true, localPath });
}

// ─── FFC: remove image ────────────────────────────────────────────────────────

async function handleFFCRemoveImage(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { localPath } = body;
  if (!localPath) return jsonError('localPath is required', 400);

  const repoPath = localPath.startsWith('ffc/_Resources/')
    ? localPath
    : `ffc/_Resources/_imgSource/items/${localPath.split('/').pop()}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await atomicFFCImageRemoveCommit(env, repoPath);
      break;
    } catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true });
}

// ─── Atomic commit: FFCGame items.json save ───────────────────────────────────

async function atomicFFCSaveCommit(env, itemsObj) {
  const refData    = await gh(env, 'GET', `git/ref/heads/${env.GITHUB_BRANCH || 'main'}`);
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const itemsRepoPath = 'ffc/items.json';
  const itemsBlob = await gh(env, 'POST', 'git/blobs', {
    content:  utf8ToBase64(JSON.stringify(itemsObj, null, 2) + '\n'),
    encoding: 'base64',
  });

  const newTree   = await gh(env, 'POST', 'git/trees', {
    base_tree: treeSha,
    tree: [{ path: itemsRepoPath, mode: '100644', type: 'blob', sha: itemsBlob.sha }],
  });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: 'Admin: update FFC items.json',
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${env.GITHUB_BRANCH || 'main'}`, { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Atomic commit: FFCGame image save ────────────────────────────────────────

async function atomicFFCImageCommit(env, repoPath, imgBytes, filename) {
  const refData    = await gh(env, 'GET', `git/ref/heads/${env.GITHUB_BRANCH || 'main'}`);
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const imgBlob = await gh(env, 'POST', 'git/blobs', {
    content:  arrayBufferToBase64(imgBytes),
    encoding: 'base64',
  });

  const newTree   = await gh(env, 'POST', 'git/trees', {
    base_tree: treeSha,
    tree: [{ path: repoPath, mode: '100644', type: 'blob', sha: imgBlob.sha }],
  });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Admin: save FFC image ${filename}`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${env.GITHUB_BRANCH || 'main'}`, { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Atomic commit: FFCGame image remove ─────────────────────────────────────

async function atomicFFCImageRemoveCommit(env, repoPath) {
  const refData    = await gh(env, 'GET', `git/ref/heads/${env.GITHUB_BRANCH || 'main'}`);
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const newTree   = await gh(env, 'POST', 'git/trees', {
    base_tree: treeSha,
    tree: [{ path: repoPath, mode: '100644', type: 'blob', sha: null }],
  });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Admin: remove FFC image ${repoPath}`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${env.GITHUB_BRANCH || 'main'}`, { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Intraverbal: save items.json ────────────────────────────────────────────

async function handleIVSaveItems(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { items: itemsObj } = body;
  if (!itemsObj || typeof itemsObj !== 'object') {
    return jsonError('items object is required', 400);
  }

  itemsObj.generated = new Date().toISOString();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await atomicIVSaveCommit(env, itemsObj);
      break;
    } catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true, generated: itemsObj.generated });
}

// ─── Intraverbal: save image ──────────────────────────────────────────────────

async function handleIVSaveImage(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { id, filename, imageUrl, imageData, imageMime } = body;
  if (!id || !filename || (!imageUrl && !imageData)) {
    return jsonError('id, filename, and imageUrl or imageData are required', 400);
  }

  let imgBytes, ext;
  try {
    ({ bytes: imgBytes, ext } = await resolveImage(imageUrl, imageData, imageMime));
  } catch (err) {
    return jsonError('Failed to load image: ' + err.message, 502);
  }

  const base         = filename.replace(/\.[^.]+$/, '');
  const saveFilename = `${base}.${ext}`;
  const repoPath     = `intraverbal/_Resources/_imgSource/items/${saveFilename}`;
  const localPath    = repoPath;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await atomicIVImageCommit(env, repoPath, imgBytes, saveFilename);
      break;
    } catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true, localPath, filename: saveFilename });
}

// ─── Intraverbal: remove image ────────────────────────────────────────────────

async function handleIVRemoveImage(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { localPath } = body;
  if (!localPath) return jsonError('localPath is required', 400);

  const repoPath = localPath.startsWith('intraverbal/_Resources/')
    ? localPath
    : `intraverbal/_Resources/_imgSource/items/${localPath.split('/').pop()}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await atomicIVImageRemoveCommit(env, repoPath);
      break;
    } catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true });
}

// ─── Atomic commit: Intraverbal items.json save ───────────────────────────────

async function handleSeqSaveSymbols(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { symbols: symObj } = body;
  if (!symObj || typeof symObj !== 'object' || !symObj.sets || typeof symObj.sets !== 'object') {
    return jsonError('symbols.sets object is required', 400);
  }

  symObj.generated = new Date().toISOString();

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await atomicSeqSaveCommit(env, symObj);
      break;
    } catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true, generated: symObj.generated });
}

async function atomicSeqSaveCommit(env, symObj) {
  const refData    = await gh(env, 'GET', `git/ref/heads/${env.GITHUB_BRANCH || 'main'}`);
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const repoPath = 'sequences/symbols.json';
  const blob = await gh(env, 'POST', 'git/blobs', {
    content:  utf8ToBase64(JSON.stringify(symObj, null, 2) + '\n'),
    encoding: 'base64',
  });

  const newTree   = await gh(env, 'POST', 'git/trees', {
    base_tree: treeSha,
    tree: [{ path: repoPath, mode: '100644', type: 'blob', sha: blob.sha }],
  });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: 'Admin: update Sequences symbols.json',
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${env.GITHUB_BRANCH || 'main'}`, { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

async function atomicIVSaveCommit(env, itemsObj) {
  const refData    = await gh(env, 'GET', `git/ref/heads/${env.GITHUB_BRANCH || 'main'}`);
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const itemsRepoPath = 'intraverbal/items.json';
  const itemsBlob = await gh(env, 'POST', 'git/blobs', {
    content:  utf8ToBase64(JSON.stringify(itemsObj, null, 2) + '\n'),
    encoding: 'base64',
  });

  const newTree   = await gh(env, 'POST', 'git/trees', {
    base_tree: treeSha,
    tree: [{ path: itemsRepoPath, mode: '100644', type: 'blob', sha: itemsBlob.sha }],
  });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: 'Admin: update Intraverbal items.json',
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${env.GITHUB_BRANCH || 'main'}`, { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Atomic commit: Intraverbal image save ────────────────────────────────────

async function atomicIVImageCommit(env, repoPath, imgBytes, filename) {
  const refData    = await gh(env, 'GET', `git/ref/heads/${env.GITHUB_BRANCH || 'main'}`);
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const imgBlob = await gh(env, 'POST', 'git/blobs', {
    content:  arrayBufferToBase64(imgBytes),
    encoding: 'base64',
  });

  const newTree   = await gh(env, 'POST', 'git/trees', {
    base_tree: treeSha,
    tree: [{ path: repoPath, mode: '100644', type: 'blob', sha: imgBlob.sha }],
  });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Admin: save Intraverbal image ${filename}`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${env.GITHUB_BRANCH || 'main'}`, { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Atomic commit: Intraverbal image remove ──────────────────────────────────

async function atomicIVImageRemoveCommit(env, repoPath) {
  const refData    = await gh(env, 'GET', `git/ref/heads/${env.GITHUB_BRANCH || 'main'}`);
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const newTree   = await gh(env, 'POST', 'git/trees', {
    base_tree: treeSha,
    tree: [{ path: repoPath, mode: '100644', type: 'blob', sha: null }],
  });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Admin: remove Intraverbal image ${repoPath}`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${env.GITHUB_BRANCH || 'main'}`, { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Admin: batch ─────────────────────────────────────────────────────────────
//
// POST /api/admin/batch
//   Body: { operations: BatchOp[] }
//
// BatchOp types (same field names as individual endpoints):
//   { type:'save-image',       game, folder, filename, imageUrl?, imageData?, imageMime?, personName?, personMeta? }
//   { type:'ffc-save',         id, filename, imageUrl?, imageData?, imageMime?, newItem? }
//   { type:'iv-save',          id, filename, imageIdx?, imageUrl?, imageData?, imageMime? }
//   { type:'save-display-name',game, localPath?, itemId?, personName?, displayName }
//   { type:'remove-image',     game, folder, filename, personName? }
//   { type:'ffc-remove',       id, filename }
//   { type:'iv-remove',        id, filename, imageIdx }
//
// All operations in one call are processed and committed as a SINGLE Git commit.

async function handleAdminBatch(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { operations } = body;
  if (!Array.isArray(operations) || !operations.length) {
    return jsonError('operations array is required', 400);
  }
  if (operations.length > 100) {
    return jsonError('Batch size limit is 100 operations', 400);
  }

  try {
    const results = await executeBatch(env, operations);
    const anyOk = results.some(r => r && r.ok);
    return json({ ok: anyOk, results });
  } catch (err) {
    const m = err.message || 'error';
    // GitHub secondary-rate-limit (403/429), transient upstream (5xx), or a
    // ref conflict that outlived its retries → tell the client to wait & retry,
    // instead of a bodiless-looking 502.
    if (m === 'CONFLICT' || /: (403|429|5\d\d)\b/.test(m)) {
      return jsonError('GitHub is throttling commits — wait a few seconds and retry. (' + m + ')', 429);
    }
    return jsonError('Batch commit failed: ' + m, 502);
  }
}

async function executeBatch(env, operations) {
  const BRANCH = env.GITHUB_BRANCH || 'main';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Phase 1: resolve images + create git blobs, capped at a few at a time. Firing
  // one subrequest-pair per image via an unbounded Promise.all is what blows
  // Cloudflare's per-invocation subrequest limit on large batches; a small pool
  // keeps concurrent outbound requests bounded regardless of batch size.
  const resolved = new Array(operations.length);
  const CONCURRENCY = 5;
  let cursor = 0;
  async function pump() {
    while (cursor < operations.length) {
      const idx = cursor++;
      const op = operations[idx];
      const hasImage = !!(op.imageUrl || op.imageData);
      if (!hasImage) { resolved[idx] = { idx, op, blobSha: null, ext: null }; continue; }
      try {
        const { bytes, ext } = await resolveImage(op.imageUrl, op.imageData, op.imageMime);
        // Famous-person portraits go straight to R2 — no git blob, no tree entry.
        // Other games still commit their image bytes as a git blob.
        if (op.type === 'save-image' && op.game === 'FamousPersonGame') {
          const base = (op.filename || '').replace(/\.[^.]+$/, '') || nameToSlug(op.personName || '');
          await putPortraitR2(env, base, bytes, ext);
          resolved[idx] = { idx, op, blobSha: null, ext, r2Base: base };
        } else {
          const blob = await gh(env, 'POST', 'git/blobs', { content: arrayBufferToBase64(bytes), encoding: 'base64' });
          // The library records a content hash per source file, and the bytes are
          // dropped after this phase — so hash them here, not in the commit phase.
          const sha256 = op.type === 'save-image' && isLibraryGame(op.game) ? await sha256Hex(bytes) : null;
          resolved[idx] = { idx, op, blobSha: blob.sha, ext, sha256 };
        }
      } catch (err) {
        resolved[idx] = { idx, op, blobSha: null, ext: null, error: 'Image failed: ' + err.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, operations.length) }, pump));

  // Phase 2: build and push a single commit (retry on conflict, with backoff so
  // a race against a still-settling previous commit doesn't hammer the ref).
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await doBatchCommit(env, BRANCH, resolved);
    } catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) { await sleep(400 * (attempt + 1)); continue; }
      throw err;
    }
  }
}

async function doBatchCommit(env, branch, resolved) {
  // Snapshot HEAD
  const refData    = await gh(env, 'GET', `git/ref/heads/${branch}`);
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  // Determine which index files are needed
  const LIBRARY_OPS = ['save-image', 'remove-image', 'save-display-name'];
  let needLibrary = false, needFPG = false, needFFC = false, needIV = false;
  for (const { op, error } of resolved) {
    if (error) continue;
    const t = op.type;
    if (LIBRARY_OPS.includes(t) && isLibraryGame(op.game)) needLibrary = true;
    if ((t === 'save-image' || t === 'remove-image') && op.game === 'FamousPersonGame') needFPG = true;
    if (t === 'ffc-save' || t === 'ffc-remove') needFFC = true;
    if (t === 'iv-save'  || t === 'iv-remove')  needIV  = true;
    if (t === 'save-display-name') {
      if (op.game === 'FamousPersonGame') needFPG = true;
      if (op.game === 'FFCGame')          needFFC = true;
      if (op.game === 'IntraverbalGame')  needIV  = true;
    }
  }

  // Read needed index files in parallel
  const fetches = {};
  if (needFPG) {
    fetches['fpg'] = gh(env, 'GET', 'contents/famous-person/index.html')
      .then(f => base64ToUtf8(f.content.replace(/\s/g, '')));
  }
  if (needFFC) {
    fetches['ffc'] = gh(env, 'GET', 'contents/ffc/items.json')
      .then(f => JSON.parse(base64ToUtf8(f.content.replace(/\s/g, ''))));
  }
  if (needIV) {
    fetches['iv'] = gh(env, 'GET', 'contents/intraverbal/items.json')
      .then(f => JSON.parse(base64ToUtf8(f.content.replace(/\s/g, ''))));
  }

  const fetchKeys = Object.keys(fetches);
  const fetchVals = await Promise.all(fetchKeys.map(k => fetches[k]));
  const reads     = Object.fromEntries(fetchKeys.map((k, i) => [k, fetchVals[i]]));

  let fpgHtml     = reads['fpg'] || null;
  const fpgOrig   = fpgHtml;
  const ffcItems  = reads['ffc'] || null;
  const ivItems   = reads['iv']  || null;

  // Library ops fold through `library.mjs` one after another and the whole
  // library is written once at the end. The manifests are a projection, so the
  // last projection IS the result of applying every op in turn — and one write
  // per file keeps a batch to one blob each instead of one per operation.
  const libraryBefore = needLibrary ? await readLibraryState(env) : null;
  let   libraryState  = libraryBefore;
  const libraryTree   = new Map(); // repo path -> blob sha, or null to delete

  const treeEntries = [];
  const results     = new Array(resolved.length).fill(null);
  let   ffcModified = false, ivModified = false;

  for (const { idx, op, blobSha, ext, sha256, error } of resolved) {
    if (error) { results[idx] = { ok: false, error }; continue; }

    const t = op.type;

    if (t === 'save-image') {
      const { game, folder, filename } = op;
      if (game === 'FamousPersonGame') {
        const base         = filename.replace(/\.[^.]+$/, '');
        const saveFilename = `${base}.${ext}`;
        const localPath    = `_Resources/_imgSource/images/${saveFilename}`;
        // Portrait bytes were written to R2 in phase 1 — no git blob/tree entry.
        // Only the roster text is committed, and only if patchImg/appendPerson
        // actually changes it (an existing-portrait replace touches nothing).
        if (op.personName) fpgHtml = patchImg(fpgHtml, op.personName, localPath);
        else if (op.personMeta) fpgHtml = appendPerson(fpgHtml, localPath, op.personMeta);
        results[idx] = { ok: true, localPath, filename: saveFilename };
      } else if (isLibraryGame(game) && /^T_/.test(folder || '')) {
        const saveFilename = `${filename.replace(/\.[^.]+$/, '')}.${ext}`;
        const applied = applyUpload(libraryState, {
          game: gameFolder(game), category: folder, filename: saveFilename, sha256,
        });
        libraryState = foldLibraryState(libraryState, applied);
        // Removals first, then adds: a later op re-adding a path an earlier one
        // superseded has to win, and vice versa.
        for (const p of applied.removeRepoPaths) libraryTree.set(p, null);
        for (const p of applied.addRepoPaths)    libraryTree.set(p, blobSha);
        results[idx] = { ok: true, localPath: applied.url, path: applied.url, url: applied.url, id: applied.id, filename: saveFilename };
      } else {
        results[idx] = { ok: false, error: `Cannot save an image for ${game}/${folder}` };
      }

    } else if (t === 'ffc-save') {
      const { id, filename } = op;
      const base         = filename.replace(/\.[^.]+$/, '');
      const saveFilename = `${base}.${ext}`;
      const repoPath     = `ffc/_Resources/_imgSource/items/${saveFilename}`;
      treeEntries.push({ path: repoPath, mode: '100644', type: 'blob', sha: blobSha });
      if (ffcItems) {
        const item = (ffcItems.items || []).find(i => i.id === id);
        if (item) { item.img = saveFilename; }
        else if (op.newItem) { (ffcItems.items = ffcItems.items || []).push({ ...op.newItem, img: saveFilename }); }
        ffcModified = true;
      }
      results[idx] = { ok: true, filename: saveFilename, localPath: repoPath };

    } else if (t === 'iv-save') {
      const { id, filename, imageIdx } = op;
      const base         = filename.replace(/\.[^.]+$/, '');
      const saveFilename = `${base}.${ext}`;
      const repoPath     = `intraverbal/_Resources/_imgSource/items/${saveFilename}`;
      treeEntries.push({ path: repoPath, mode: '100644', type: 'blob', sha: blobSha });
      if (ivItems) {
        const item = (ivItems.items || []).find(i => i.id === id);
        if (item) {
          if (!item.images) item.images = [];
          if (imageIdx !== undefined && imageIdx < item.images.length) item.images[imageIdx] = saveFilename;
          else item.images.push(saveFilename);
          ivModified = true;
        }
      }
      results[idx] = { ok: true, filename: saveFilename, localPath: repoPath };

    } else if (t === 'save-display-name') {
      const { game, localPath: imgPath, displayName, itemId, personName } = op;
      const trimmed = typeof displayName === 'string' ? displayName.trim() : '';
      if (isLibraryGame(game)) {
        const stimulus = resolveStimulusId(libraryState, gameFolder(game), {
          id: op.id, localPath: imgPath, folder: op.folder, filename: op.filename,
        });
        if (!stimulus) {
          results[idx] = { ok: false, error: `No stimulus in the shared library for ${imgPath || op.id}` };
          continue;
        }
        const applied = applyLabel(libraryState, { id: stimulus, label: trimmed });
        libraryState = foldLibraryState(libraryState, applied);
        results[idx] = { ok: true, id: stimulus, displayName: applied.label };
        continue;
      } else if (game === 'FFCGame' && ffcItems) {
        const item = (ffcItems.items || []).find(i => i.id === itemId);
        if (item) { item.label = trimmed; ffcModified = true; }
      } else if (game === 'IntraverbalGame' && ivItems) {
        const item = (ivItems.items || []).find(i => i.id === itemId);
        if (item) { item.label = trimmed; ivModified = true; }
      } else if (game === 'FamousPersonGame' && fpgHtml && personName && trimmed) {
        const safe = personName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        fpgHtml = fpgHtml.replace(
          new RegExp(`(name:\\s*['"])${safe}(['"])`),
          `$1${trimmed.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}$2`,
        );
      }
      results[idx] = { ok: true };

    } else if (t === 'remove-image') {
      const { game, folder, filename, personName } = op;
      if (game === 'FamousPersonGame') {
        const repoPath = `famous-person/_Resources/_imgSource/images/${filename}`;
        treeEntries.push({ path: repoPath, mode: '100644', type: 'blob', sha: null });
        if (personName && fpgHtml) fpgHtml = patchImg(fpgHtml, personName, '');
        if (env.IMAGES) { try { await env.IMAGES.delete(fpgR2Key(filename.replace(/\.[^.]+$/, ''))); } catch { /* non-fatal */ } }
      } else if (isLibraryGame(game)) {
        const stimulus = resolveStimulusId(libraryState, gameFolder(game), {
          id: op.id, localPath: op.localPath, folder, filename,
        });
        if (!stimulus) {
          results[idx] = { ok: false, error: `No stimulus in the shared library for ${folder}/${filename}` };
          continue;
        }
        // An exclusion, not a delete: the same bytes back the other two games.
        const applied = applyExclusion(libraryState, { game: gameFolder(game), category: folder, id: stimulus });
        libraryState = foldLibraryState(libraryState, applied);
        results[idx] = { ok: true, id: stimulus, excluded: true };
        continue;
      } else {
        results[idx] = { ok: false, error: `Cannot remove an image for ${game}` };
        continue;
      }
      results[idx] = { ok: true };

    } else if (t === 'ffc-remove') {
      const { id, filename } = op;
      const repoPath = `ffc/_Resources/_imgSource/items/${filename}`;
      treeEntries.push({ path: repoPath, mode: '100644', type: 'blob', sha: null });
      if (ffcItems) { ffcItems.items = (ffcItems.items || []).filter(i => i.id !== id); ffcModified = true; }
      results[idx] = { ok: true };

    } else if (t === 'iv-remove') {
      const { id, filename, imageIdx } = op;
      const repoPath = `intraverbal/_Resources/_imgSource/items/${filename}`;
      treeEntries.push({ path: repoPath, mode: '100644', type: 'blob', sha: null });
      if (ivItems) {
        const item = (ivItems.items || []).find(i => i.id === id);
        if (item && item.images && imageIdx !== undefined) { item.images.splice(imageIdx, 1); ivModified = true; }
      }
      results[idx] = { ok: true };

    } else {
      results[idx] = { ok: false, error: 'Unknown operation type: ' + t };
    }
  }

  // Write back modified index files
  const ts = new Date().toISOString();
  if (libraryState && libraryState !== libraryBefore) {
    for (const [path, sha] of libraryTree) treeEntries.push({ path, mode: '100644', type: 'blob', sha });
    for (const [path, text] of changedLibraryDocuments(libraryBefore, await finalLibraryDocuments(libraryState))) {
      const blob = await gh(env, 'POST', 'git/blobs', { content: utf8ToBase64(text), encoding: 'base64' });
      treeEntries.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
    }
  }
  if (fpgHtml && fpgHtml !== fpgOrig) {
    const blob = await gh(env, 'POST', 'git/blobs', { content: utf8ToBase64(fpgHtml), encoding: 'base64' });
    treeEntries.push({ path: 'famous-person/index.html', mode: '100644', type: 'blob', sha: blob.sha });
  }
  if (ffcItems && ffcModified) {
    ffcItems.generated = ts;
    const blob = await gh(env, 'POST', 'git/blobs', {
      content: utf8ToBase64(JSON.stringify(ffcItems, null, 2) + '\n'), encoding: 'base64',
    });
    treeEntries.push({ path: 'ffc/items.json', mode: '100644', type: 'blob', sha: blob.sha });
  }
  if (ivItems && ivModified) {
    ivItems.generated = ts;
    const blob = await gh(env, 'POST', 'git/blobs', {
      content: utf8ToBase64(JSON.stringify(ivItems, null, 2) + '\n'), encoding: 'base64',
    });
    treeEntries.push({ path: 'intraverbal/items.json', mode: '100644', type: 'blob', sha: blob.sha });
  }

  if (!treeEntries.length) return results; // display-name-only batch with no actual changes

  const successCount = results.filter(r => r && r.ok).length;
  const newTree   = await gh(env, 'POST', 'git/trees', { base_tree: treeSha, tree: treeEntries });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Admin: batch update ${successCount} item(s)`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${branch}`, { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);

  return results;
}

// ─── Admin: update-facts ─────────────────────────────────────────────────────

const FPG_HTML_PATH  = 'famous-person/index.html';
const FPG_TARGET     = 4;
// Rich fact objects are ~10x larger than the old plain strings, so batches are
// smaller and max_tokens larger than the legacy string-generation path.
const FPG_BATCH_SIZE = 8;
const FPG_MODEL      = 'claude-opus-4-8';
const FPG_MAX_TOKENS = 16000;
// Every authored fact object must carry these slots (mirrors the game's
// REQUIRED_FACT_SLOTS). The generator is required to return all nine.
const FPG_FACT_SLOTS = [
  'text', 'topic', 'fragment',
  'commentMin', 'commentPartial', 'commentFull',
  'volleyMin',  'volleyPartial',  'volleyFull',
];

async function handleAdminUpdateFacts(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  if (!env.ANTHRO_KEY) {
    return jsonError('ANTHRO_KEY environment variable not set on this Worker', 500);
  }

  // Options (JSON body, all optional):
  //   mode  : 'fill' (default) only touches people with < 4 facts — i.e. the
  //           freshly-added, not-yet-populated roster entries.
  //           'regenerate' rewrites EVERY targeted person from scratch, so
  //           existing facts can be refreshed into the connected style.
  //   names : optional array of person names to limit the run to (lets you
  //           populate/regenerate a small, reviewable batch at a time).
  //   limit : optional cap on how many people to process this run.
  let opts = {};
  try { opts = await request.json(); } catch (_) { /* no body — use defaults */ }
  const mode      = opts.mode === 'regenerate' ? 'regenerate' : 'fill';
  const nameFilter = Array.isArray(opts.names) && opts.names.length
    ? new Set(opts.names) : null;
  const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : null;

  // 1. Fetch current HTML from GitHub
  let htmlContent;
  try {
    const fileData = await gh(env, 'GET', `contents/${FPG_HTML_PATH}`);
    htmlContent = base64ToUtf8(fileData.content.replace(/\s/g, ''));
  } catch (err) {
    return jsonError(`Failed to fetch HTML from GitHub: ${err.message}`, 502);
  }

  // 2. Parse people; choose who to (re)generate.
  const people = fpgParsePeople(htmlContent);
  let todo = people.filter(p =>
    mode === 'regenerate' ? true : p.factCount < FPG_TARGET);
  if (nameFilter) todo = todo.filter(p => nameFilter.has(p.name));
  if (limit)      todo = todo.slice(0, limit);

  if (todo.length === 0) {
    const why = mode === 'regenerate'
      ? 'No matching people to regenerate.'
      : 'Every person already has 4 facts — nothing to populate.';
    return json({ ok: true, message: why, updated: 0 });
  }

  // 3. Generate a full set of 4 connected facts per person, in batches.
  const newFactsMap = {}; // name → [4] rich fact objects
  const skipped = [];
  for (let i = 0; i < todo.length; i += FPG_BATCH_SIZE) {
    const batch = todo.slice(i, i + FPG_BATCH_SIZE);
    let batchResult;
    try {
      batchResult = await fpgGenerateFacts(env, batch);
    } catch (err) {
      return jsonError(`Anthropic API error (batch ${Math.floor(i / FPG_BATCH_SIZE) + 1}): ${err.message}`, 502);
    }
    for (const p of batch) {
      const facts = fpgValidateFacts(batchResult[p.name]);
      if (facts) newFactsMap[p.name] = facts;
      else skipped.push(p.name);
    }
  }

  // 4. Replace each person's facts block (reverse offset order keeps offsets valid).
  const updates = people
    .filter(p => newFactsMap[p.name])
    .sort((a, b) => b.blockStart - a.blockStart);

  if (updates.length === 0) {
    return jsonError(`Generation returned no valid facts (skipped: ${skipped.join(', ')})`, 502);
  }

  let updated = htmlContent;
  for (const p of updates) {
    updated = updated.slice(0, p.blockStart) +
              fpgBuildFactsBlock(newFactsMap[p.name]) +
              updated.slice(p.blockEnd);
  }

  // 5. Commit back to GitHub
  try {
    await atomicFpgFactsCommit(env, updated, updates.length, mode);
  } catch (err) {
    return jsonError(`GitHub commit failed: ${err.message}`, 502);
  }

  return json({
    ok: true,
    mode,
    updated: updates.length,
    skipped,
    message: `${mode === 'regenerate' ? 'Regenerated' : 'Populated'} ${updates.length} people`
      + (skipped.length ? `, skipped ${skipped.length} (malformed output)` : '')
      + '. Deployment will follow shortly.',
  });
}

// Coerce/validate a generated value into a clean [4] array of 9-slot fact
// objects. Returns null if the shape is unusable so we never write garbage.
function fpgValidateFacts(generated) {
  if (!Array.isArray(generated)) return null;
  const facts = generated.slice(0, FPG_TARGET);
  if (facts.length < FPG_TARGET) return null;
  for (const f of facts) {
    if (!f || typeof f !== 'object') return null;
    for (const slot of FPG_FACT_SLOTS) {
      if (typeof f[slot] !== 'string' || !f[slot].trim()) return null;
    }
  }
  return facts;
}

// ─── FPG parse / build helpers ────────────────────────────────────────────────

function fpgLastMatch(reSource, str) {
  const re = new RegExp(reSource, 'g');
  let m, last = null;
  while ((m = re.exec(str)) !== null) last = m[1];
  return last;
}

function fpgEscapeJs(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// Build a `    facts: [ … ]` block of rich fact objects matching the authored
// style in index.html (8-space fields, single-quoted JS strings).
function fpgBuildFactsBlock(facts) {
  const lines = ['    facts: ['];
  for (const f of facts) {
    lines.push('      {');
    for (const slot of FPG_FACT_SLOTS) {
      lines.push(`        ${slot}: '${fpgEscapeJs(f[slot])}',`);
    }
    lines.push('      },');
  }
  lines.push('    ],');
  return lines.join('\n');
}

// Bracket-match from a `[` to its matching `]`, skipping over string literals.
// Handles both inline empty arrays (`facts: [],`) and multi-line object arrays.
function fpgMatchBracket(str, openIdx) {
  let depth = 0, inStr = false, strCh = '';
  for (let i = openIdx; i < str.length; i++) {
    const c = str[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === strCh) inStr = false;
    } else if (c === "'" || c === '"') {
      inStr = true; strCh = c;
    } else if (c === '[') {
      depth++;
    } else if (c === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function fpgParsePeople(html) {
  const marker       = 'const PEOPLE = [\n';
  const sectionStart = html.indexOf(marker) + marker.length;
  const sectionEnd   = html.indexOf('\n];', sectionStart);
  const section      = html.slice(sectionStart, sectionEnd);

  const people  = [];
  const factsRe = /\n    facts: \[/g;
  let fm;
  while ((fm = factsRe.exec(section)) !== null) {
    const openIdx = fm.index + fm[0].length - 1;   // the '[' itself
    const closeIdx = fpgMatchBracket(section, openIdx);
    if (closeIdx === -1) continue;

    const blockStartRel = fm.index + 1;             // start of '    facts:'
    let blockEndRel = closeIdx + 1;
    if (section[blockEndRel] === ',') blockEndRel++; // swallow trailing comma

    // Each fact object carries exactly one `text:` field — count them.
    const inner     = section.slice(openIdx + 1, closeIdx);
    const factCount = (inner.match(/\n {8}text:/g) || []).length;

    const preceding = section.slice(0, fm.index);
    const name  = fpgLastMatch("name:\\s*'([^']+)'",  preceding);
    const years = fpgLastMatch("years:\\s*'([^']+)'", preceding);
    const tag   = fpgLastMatch("tag:\\s*'([^']+)'",   preceding);
    if (!name) continue;

    people.push({
      name,
      years: years || '',
      tag:   tag   || '',
      factCount,
      blockStart: sectionStart + blockStartRel,
      blockEnd:   sectionStart + blockEndRel,
    });
  }
  return people;
}

const FPG_SYSTEM_PROMPT =
`You write material for a "Famous Person" conversation game used by speech-language pathologists in one-on-one therapy with older adults and with adults rebuilding conversation skills (aphasia, cognitive-communication, autism, brain injury). The clinician and client take turns talking ABOUT a famous person. The real goal is conversation practice: making comments, asking follow-up questions, and linking one idea to the next and to the client's own life.

For each person you are given, write EXACTLY 4 facts that together form ONE flowing conversation — NOT four disconnected trivia items. Order and word them so each fact leads naturally into the next, like a good chat unfolding:
  Fact 1 — what the person is best known for (the hook).
  Fact 2 — a related achievement or turning point that follows from Fact 1.
  Fact 3 — a human, warm, or surprising personal detail.
  Fact 4 — their legacy / why they still matter, ending by turning the talk toward the client.

Each fact is a JSON object with these 9 fields. EVERY field is required and must be plain, warm, spoken-style language — short words, one idea at a time, dignified and upbeat, nothing grim or violent. Use the person's FIRST name:
  text           — the fact, told to the client. ONE simple sentence, about 10–18 words.
  topic          — a 2–4 word label for the fact (e.g. "the moon landing").
  fragment       — the heart of the fact as a lowercase fragment with no subject (e.g. "walked on the moon in 1969").
  commentMin     — a SHORT spoken starter the CLIENT could say to comment on this fact; a few words trailing off with "…" (least help).
  commentPartial — a fuller spoken comment with a stem for the client to finish, ending with "…".
  commentFull    — a complete, natural spoken comment the client can copy word-for-word.
  volleyMin      — an INDIRECT cue telling the CLINICIAN what to elicit; NOT a line to read aloud. Begin with "Ask about" or "Get them to…", trailing off with "…".
  volleyPartial  — a partial spoken volley: a brief reaction plus a question stem the client finishes (ends with "…"); lean it toward the NEXT fact's topic.
  volleyFull     — a complete spoken volley the client can copy: react, then ask a question that BRIDGES into the next fact's topic so the chat keeps moving. For Fact 4, instead turn the question to the client's own experience ("What about you…").

Hard rules:
  • CONNECT the facts: each volleyFull for facts 1–3 must tee up the topic of the very next fact; Fact 4 closes by asking the client about themselves.
  • commentMin/Partial/Full and volleyPartial/Full are spoken BY the client (everyday first-person voice). volleyMin is an instruction to the clinician and is never read aloud.
  • Be accurate. Keep it positive — no death details, violence, or anything distressing.
  • Vary how sentences open; don't start every line the same way.

Return ONLY a JSON object — no markdown fences, no preamble. Keys are the person names EXACTLY as given. Each value is an array of exactly 4 fact objects, each with all 9 fields.

Example showing the connected style (Facts 1→2 of a 4-fact set — note how volleyFull on Fact 1 sets up Fact 2's topic). This is illustration only; do NOT reuse this text:
{"Example Person":[
  {"text":"Amelia was the first woman to fly alone across the Atlantic Ocean.","topic":"flying across the ocean","fragment":"flew alone across the Atlantic Ocean","commentMin":"Amelia was brave…","commentPartial":"Amelia flew all the way across the…","commentFull":"Amelia flew all by herself across the whole ocean.","volleyMin":"Ask how she felt up there…","volleyPartial":"Flying alone sounds scary. I wonder what she did before she was…","volleyFull":"All alone over the ocean — so brave! Did you know she set speed records too? Want to hear?"},
  {"text":"Amelia set many speed records and won a big flying medal.","topic":"speed records","fragment":"set speed records and won a flying medal","commentMin":"She was fast…","commentPartial":"Amelia won a medal for…","commentFull":"Amelia was so fast she won a special flying medal.","volleyMin":"Ask what she did for fun…","volleyPartial":"A medal! I wonder what she liked to do when she was not…","volleyFull":"A medal-winning pilot! I heard she loved writing poems too — can you picture that?"}
]}`;

async function fpgGenerateFacts(env, batch) {
  const peopleList = batch.map(p => ({
    name: p.name,
    ...(p.years && { years: p.years }),
    ...(p.tag   && { tag:   p.tag   }),
  }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         env.ANTHRO_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      FPG_MODEL,
      max_tokens: FPG_MAX_TOKENS,
      system:     FPG_SYSTEM_PROMPT,
      messages:   [{ role: 'user', content: JSON.stringify(peopleList, null, 2) }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  // With JSON-only output and no thinking, the first text block is the payload.
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('no text block in model response');
  let raw = textBlock.text.trim();
  raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  return JSON.parse(raw);
}

// ─── Atomic commit: FPG HTML update ──────────────────────────────────────────

async function atomicFpgFactsCommit(env, htmlContent, count, mode) {
  const refData    = await gh(env, 'GET', 'git/ref/heads/main');
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const htmlBlob = await gh(env, 'POST', 'git/blobs', {
    content:  utf8ToBase64(htmlContent),
    encoding: 'base64',
  });

  const newTree = await gh(env, 'POST', 'git/trees', {
    base_tree: treeSha,
    tree: [{ path: FPG_HTML_PATH, mode: '100644', type: 'blob', sha: htmlBlob.sha }],
  });

  const verb = mode === 'regenerate' ? 'regenerate' : 'populate';
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Admin: ${verb} Famous Person conversation facts (${count} people)`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', 'git/refs/heads/main', { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Red Carpet Convos: roster (people.json) save + AI draft ──────────────────
// The redesigned Famous Person game (red-carpet-convos/) stores its roster as a
// JSON file with the NEW 7-field fact schema (fade levels derived at runtime).
// The Famous Person Manager edits it; these endpoints commit + AI-draft it.

const RCC_JSON_PATH  = 'red-carpet-convos/people.json';
const RCC_MODEL      = 'claude-opus-4-8';
const RCC_MAX_TOKENS = 6000;
const RCC_BATCH_SIZE = 8;
const RCC_FACT_SLOTS = ['text', 'topic', 'say', 'sayShort', 'ask', 'askYou', 'bridge'];

const RCC_SYSTEM_PROMPT =
`You write material for "Red Carpet Convos," a conversation game used by ABA technicians one-on-one with learners (often children or teens, including autistic learners) practicing reciprocal conversation. Two people chat ABOUT a famous person: the learner makes a COMMENT, then asks a QUESTION back (a "volley"). First they "meet" the person by reading a few facts together, then they talk.

For each person you are given, write EXACTLY 4 facts that together form ONE connected conversation — not four disconnected trivia items:
  Fact 1 — what the person is best known for (the hook).
  Fact 2 — a related achievement or moment that follows from Fact 1.
  Fact 3 — a warm or surprising personal detail.
  Fact 4 — why they still matter, ending by turning toward the learner.

Each fact is a JSON object with these 7 fields. EVERY field is required, in plain, warm, spoken language a 6th grader could read — short words, one idea at a time, positive and kind, nothing grim or violent. Use the person's FIRST name.
  text     — the fact, read together in the "meet" phase. ONE simple sentence, about 10–18 words.
  topic    — a 2–4 word lowercase label for the fact (e.g. "the moon landing").
  say      — a COMMENT the learner can say about this fact: a complete, plain first-person statement (NOT an exclamation, NOT a question).
  sayShort — the same comment boiled down to a few words; still a complete short version (the "in a few words" hook).
  ask      — a VOLLEY: a genuine, open question the learner asks their PARTNER about this topic. Do NOT restate the fact first; just ask.
  askYou   — an alternate volley that turns the question toward the partner's own life or opinion ("Have you ever…", "What would you…").
  bridge   — a short line the PARTNER says to lead INTO this fact by recalling it from the "meet" phase, e.g. "I liked the part about {this topic}. Remember?". For Fact 1 ONLY, set bridge to an empty string "" (there is no fact before it).

Hard rules:
  • say and sayShort are statements the learner says; ask and askYou are questions the learner asks the partner. Keep them clearly distinct.
  • bridge is the PARTNER's short recall opener into THIS fact and must refer to this fact's topic. Fact 1's bridge = "".
  • Be accurate and upbeat — no death details, violence, or anything distressing.
  • Vary how sentences open; don't start every line the same way.

Return ONLY a JSON object — no markdown fences, no preamble. Keys are the person names EXACTLY as given. Each value is an array of exactly 4 fact objects, each with all 7 fields.

Example (Facts 1→2 only, illustration — do NOT reuse this text):
{"Example Person":[
  {"text":"Amelia was the first woman to fly a plane alone across the ocean.","topic":"flying across the ocean","say":"Amelia flew all by herself across the whole ocean.","sayShort":"She flew across the ocean alone.","ask":"Have you ever been on a plane?","askYou":"Where would you fly if you could go anywhere?","bridge":""},
  {"text":"She set speed records and won a big medal for flying.","topic":"speed records","say":"Amelia was so fast she won a special flying medal.","sayShort":"She won a flying medal.","ask":"What is something you are really good at?","askYou":"Have you ever won a prize?","bridge":"I liked the part about her speed records. Remember?"}
]}`;

async function rccLoadRoster(env) {
  const file = await gh(env, 'GET', 'contents/' + RCC_JSON_PATH);
  const text = base64ToUtf8((file.content || '').replace(/\n/g, ''));
  const data = JSON.parse(text);
  const people = Array.isArray(data) ? data : (data.people || []);
  return { data, people };
}

// Enforce the 7-slot shape; fact 1 always has an empty inbound bridge.
function rccNormalizeFacts(arr) {
  return (arr || []).slice(0, 4).map((f, i) => {
    const o = {};
    for (const k of RCC_FACT_SLOTS) o[k] = (f && typeof f[k] === 'string') ? f[k] : '';
    if (i === 0) o.bridge = '';
    return o;
  });
}

async function atomicRccSaveCommit(env, rosterObj, message) {
  const branch     = env.GITHUB_BRANCH || 'main';
  const refData    = await gh(env, 'GET', `git/ref/heads/${branch}`);
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const blob = await gh(env, 'POST', 'git/blobs', {
    content:  utf8ToBase64(JSON.stringify(rosterObj, null, 2) + '\n'),
    encoding: 'base64',
  });
  const newTree = await gh(env, 'POST', 'git/trees', {
    base_tree: treeSha,
    tree: [{ path: RCC_JSON_PATH, mode: '100644', type: 'blob', sha: blob.sha }],
  });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: message || 'Admin: update Red Carpet Convos roster',
    tree:    newTree.sha,
    parents: [headSha],
  });
  const refRes = await ghRaw(env, 'PATCH', `git/refs/heads/${branch}`, { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// Commit hand-edited roster back to people.json (from the manager's Save).
async function handleRccSaveFacts(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const people = body && body.people;
  if (!Array.isArray(people)) return jsonError('people array is required', 400);
  for (const p of people) {
    if (!p || typeof p.name !== 'string' || !p.name.trim()) return jsonError('Every person needs a name', 400);
  }
  // Migration flag: a person is live (converted) only with a full fact set,
  // unless explicitly hidden (an incoming converted:false is preserved).
  people.forEach(p => { const complete = !!(p.facts && p.facts.length >= 4); p.converted = complete && p.converted !== false; });

  // Preserve any top-level wrapper fields (e.g. _note) already in the file.
  let roster;
  try { roster = await rccLoadRoster(env); }
  catch { roster = { data: {}, people: [] }; }
  const out = (roster.data && typeof roster.data === 'object' && !Array.isArray(roster.data)) ? { ...roster.data } : {};
  out.people    = people;
  out.generated = new Date().toISOString();

  for (let attempt = 0; attempt < 3; attempt++) {
    try { await atomicRccSaveCommit(env, out, 'Admin: update Red Carpet Convos roster'); break; }
    catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }
  return json({ ok: true, generated: out.generated, count: people.length });
}

async function rccGenerateFacts(env, batch) {
  const peopleList = batch.map(p => ({
    name: p.name,
    ...(p.years && { years: p.years }),
    ...(p.tag   && { tag:   p.tag   }),
  }));
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHRO_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: RCC_MODEL, max_tokens: RCC_MAX_TOKENS, system: RCC_SYSTEM_PROMPT, messages: [{ role: 'user', content: JSON.stringify(peopleList, null, 2) }] }),
  });
  if (!res.ok) { const txt = await res.text(); throw new Error(`${res.status}: ${txt.slice(0, 300)}`); }
  const data = await res.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('no text block in model response');
  let raw = textBlock.text.trim().replace(/^\`\`\`(?:json)?\s*/, '').replace(/\s*\`\`\`$/, '');
  return JSON.parse(raw);
}

// AI-draft facts. With { name } → return facts for review (no commit, used by the
// manager). With { limit } → fill factless people in people.json and COMMIT
// (used by the GM "populate" button / bulk conversion).
async function handleRccGenerateFacts(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;
  if (!env.ANTHRO_KEY) return jsonError('AI not configured (ANTHRO_KEY missing)', 503);

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  // Single-person draft — return facts, do NOT commit (human reviews then Saves).
  if (body && body.name) {
    let gen;
    try { gen = await rccGenerateFacts(env, [{ name: body.name, years: body.years, tag: body.tag }]); }
    catch (err) { return jsonError('Generation failed: ' + err.message, 502); }
    const arr   = gen[body.name] || Object.values(gen)[0] || [];
    const facts = rccNormalizeFacts(arr);
    if (facts.length < 4) return jsonError('Model returned too few facts', 502);
    return json({ ok: true, facts });
  }

  // Batch fill — draft facts for people that still need them, then commit.
  const limit = Math.max(1, Math.min(RCC_BATCH_SIZE, Number(body && body.limit) || RCC_BATCH_SIZE));
  let roster;
  try { roster = await rccLoadRoster(env); }
  catch (err) { return jsonError('Could not read people.json: ' + err.message, 502); }
  const need = roster.people.filter(p => !(p.facts && p.facts.length >= 4)).slice(0, limit);
  if (!need.length) return json({ ok: true, filled: [], message: 'Every person already has facts.' });

  let gen;
  try { gen = await rccGenerateFacts(env, need.map(p => ({ name: p.name, years: p.years, tag: p.tag }))); }
  catch (err) { return jsonError('Generation failed: ' + err.message, 502); }

  const filled = [];
  for (const p of need) {
    const arr = gen[p.name];
    if (arr && arr.length) { p.facts = rccNormalizeFacts(arr); p.converted = true; filled.push(p.name); }
  }
  if (!filled.length) return jsonError('Model returned no usable facts', 502);

  for (let attempt = 0; attempt < 3; attempt++) {
    try { await atomicRccSaveCommit(env, roster.data, `Admin: draft Red Carpet Convos facts (${filled.length} people)`); break; }
    catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }
  return json({ ok: true, filled });
}

// ─── HTML patch helpers ────────────────────────────────────────────────────────

function patchImg(html, personName, localPath) {
  const safe = personName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re   = new RegExp(
    `(name:\\s*['"]${safe}['"][\\s\\S]{0,400}?img:\\s*['"])[^'"]+(['"])`,
  );
  return html.replace(re, `$1${localPath}$2`);
}

function appendPerson(html, localPath, meta) {
  // Find the closing bracket of the PEOPLE array and insert a new entry before it
  const { name, years, emoji, tag, facts } = meta;
  const factsStr = (facts || []).map(f => `'${f.replace(/'/g, "\\'")}'`).join(', ');
  const entry = `  {
    name: '${name.replace(/'/g, "\\'")}',
    years: '${(years || '').replace(/'/g, "\\'")}',
    emoji: '${(emoji || '').replace(/'/g, "\\'")}',
    tag: '${(tag || '').replace(/'/g, "\\'")}',
    img: '${localPath}',
    facts: [${factsStr}],
  },`;

  // Insert before the closing `];` of PEOPLE
  return html.replace(/(\bconst PEOPLE\s*=\s*\[[\s\S]*?)(\];)/, `$1${entry}\n$2`);
}

// ─── GitHub helpers ───────────────────────────────────────────────────────────

function ghHeaders(env) {
  return {
    Authorization:  `token ${env.GITHUB_TOKEN}`,
    Accept:         'application/vnd.github+json',
    'User-Agent':   'games-save-photo-worker/1.0',
    'Content-Type': 'application/json',
  };
}

function ghUrl(env, path) {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/${path}`;
}

async function gh(env, method, path, body) {
  // Repo retarget: when REPO_SUBDIR is set (e.g. "apps/games"), the game files
  // live under that subdirectory of GITHUB_REPO. Prefix the file paths — content
  // reads and git-tree entry paths — while leaving the repo-wide git-data
  // endpoints (git/ref, git/refs, git/blobs, git/trees, git/commits) untouched.
  // Unset (default) = no prefix, i.e. current behavior — safe to deploy before
  // the GITHUB_REPO/REPO_SUBDIR secrets are flipped.
  const sub = (env.REPO_SUBDIR || '').replace(/^\/+|\/+$/g, '');
  if (sub) {
    if (method === 'GET' && path.startsWith('contents/')) {
      path = 'contents/' + sub + '/' + path.slice(9); // "contents/".length === 9
    } else if (method === 'POST' && path === 'git/trees' && body && Array.isArray(body.tree)) {
      body = { ...body, tree: body.tree.map(e => (e && e.path) ? { ...e, path: sub + '/' + e.path } : e) };
    }
  }
  let url = ghUrl(env, path);
  if (method === 'GET' && path.startsWith('contents/')) {
    url += `?ref=${encodeURIComponent(env.GITHUB_BRANCH || 'main')}`;
  }
  const res = await fetch(url, {
    method,
    headers: ghHeaders(env),
    body:    body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status}`);
  return res.json();
}

async function ghRaw(env, method, path, body) {
  return fetch(ghUrl(env, path), {
    method,
    headers: ghHeaders(env),
    body:    body ? JSON.stringify(body) : undefined,
  });
}

// ─── Image resolution (URL or uploaded base64) ───────────────────────────────

const MIME_TO_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/png':  'png', 'image/webp': 'webp',
  'image/gif':  'gif', 'image/avif': 'avif',
  'image/svg+xml': 'svg',
};

async function resolveImage(imageUrl, imageData, imageMime) {
  if (imageData) {
    const binary = atob(imageData);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ext = MIME_TO_EXT[imageMime] || 'jpg';
    return { bytes: bytes.buffer, ext };
  }
  return downloadImage(imageUrl);
}

// ─── Image download ───────────────────────────────────────────────────────────

async function downloadImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'games-save-photo-worker/1.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const ct     = (res.headers.get('content-type') || '').split(';')[0].trim();
  const extMap = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg',
    'image/png':  'png', 'image/webp': 'webp',
    'image/gif':  'gif', 'image/avif': 'avif',
    'image/svg+xml': 'svg',
  };
  const urlExt = url.split('?')[0].split('.').pop().toLowerCase();
  const ext = extMap[ct]
    || (['jpg','jpeg','png','webp','gif','avif','svg'].includes(urlExt)
        ? (urlExt === 'jpeg' ? 'jpg' : urlExt)
        : 'jpg');

  return { bytes: await res.arrayBuffer(), ext };
}

// ─── R2 image storage ─────────────────────────────────────────────────────────
// Famous-person portraits live in R2 under an extension-agnostic key
// (`fpg/<slug>`) so a portrait resolves no matter which .jpg/.png the roster
// happens to reference. The content-type is stored as R2 metadata and replayed
// on serve. All game/roster image URLs are unchanged — only the backing store is.

const EXT_TO_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
};
function mimeForExt(ext) { return EXT_TO_MIME[(ext || '').toLowerCase()] || 'image/jpeg'; }

const FPG_R2_PREFIX = 'fpg/';
function fpgR2Key(base) { return FPG_R2_PREFIX + base; }

// Write a famous-person portrait to R2. `bytes` is an ArrayBuffer; `base` is the
// slug (filename without extension). Throws if the IMAGES binding is missing.
async function putPortraitR2(env, base, bytes, ext) {
  if (!env.IMAGES) throw new Error('R2 bucket IMAGES not bound');
  await env.IMAGES.put(fpgR2Key(base), bytes, {
    httpMetadata: { contentType: mimeForExt(ext) },
  });
}

// ─── Encoding helpers ─────────────────────────────────────────────────────────

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary  = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary  = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ─── Slug ─────────────────────────────────────────────────────────────────────

function nameToSlug(name) {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function jsonError(message, status = 400) {
  return json({ ok: false, error: message }, status);
}
