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
 * POST /api/admin/ffc-save-items  (admin — write the whole FFCGame/FFCGame/items.json)
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
 *   Reads FamousPersonGame/index.html from GitHub, calls Anthropic API for any person
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

const KNOWN_GAMES = ['IDMatchGame', 'NameIDGame', 'FamousPersonGame'];

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === 'POST' && pathname === '/api/save-photo') {
      return handleSavePhoto(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/save-image') {
      return handleAdminSaveImage(request, env);
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
    if (request.method === 'POST' && pathname === '/api/admin/ping') {
      return handleAdminPing(request, env);
    }
    if (request.method === 'POST' && pathname === '/api/admin/update-facts') {
      return handleAdminUpdateFacts(request, env);
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
  const imgPath   = `FamousPersonGame/_Resources/_imgSource/images/${slug}.${ext}`;
  const localPath = `_Resources/_imgSource/images/${slug}.${ext}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await atomicFPGCommit(env, personName, imgPath, imgBytes, localPath);
      break;
    } catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
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

  const { game, folder, filename, imageUrl, personName, personMeta } = body;
  if (!game || !folder || !filename || !imageUrl) {
    return jsonError('game, folder, filename, and imageUrl are required', 400);
  }
  if (!KNOWN_GAMES.includes(game)) {
    return jsonError('Unknown game: ' + game, 400);
  }

  let imgBytes, ext;
  try {
    ({ bytes: imgBytes, ext } = await downloadImage(imageUrl));
  } catch (err) {
    return jsonError('Failed to download image: ' + err.message, 502);
  }

  // Use detected extension so the saved file always matches its content-type.
  const base = filename.replace(/\.[^.]+$/, '');
  const saveFilename = `${base}.${ext}`;
  const oldFilename  = filename !== saveFilename ? filename : null;

  let repoPath, localPath, oldLocalPath;
  if (game === 'FamousPersonGame') {
    repoPath     = `FamousPersonGame/_Resources/_imgSource/images/${saveFilename}`;
    localPath    = `_Resources/_imgSource/images/${saveFilename}`;
    oldLocalPath = null;
  } else {
    repoPath     = `${game}/${game}/_Resources/_imgSource/${folder}/${saveFilename}`;
    localPath    = `_Resources/_imgSource/${folder}/${saveFilename}`;
    oldLocalPath = oldFilename ? `_Resources/_imgSource/${folder}/${oldFilename}` : null;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (game === 'FamousPersonGame') {
        await atomicFPGCommit(env, personName, repoPath, imgBytes, localPath, personMeta);
      } else {
        await atomicManifestSaveCommit(env, game, folder, saveFilename, repoPath, imgBytes, localPath, oldLocalPath);
      }
      break;
    } catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true, path: localPath, filename: saveFilename });
}

// ─── Admin: remove-image ──────────────────────────────────────────────────────

async function handleAdminRemoveImage(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  let body;
  try { body = await request.json(); }
  catch { return jsonError('Invalid JSON body', 400); }

  const { game, folder, filename, personName } = body;
  if (!game || !folder || !filename) {
    return jsonError('game, folder, and filename are required', 400);
  }
  if (!KNOWN_GAMES.includes(game)) {
    return jsonError('Unknown game: ' + game, 400);
  }

  let repoPath;
  if (game === 'FamousPersonGame') {
    repoPath = `FamousPersonGame/_Resources/_imgSource/images/${filename}`;
  } else {
    repoPath = `${game}/${game}/_Resources/_imgSource/${folder}/${filename}`;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (game === 'FamousPersonGame') {
        await atomicFPGRemoveCommit(env, personName, repoPath);
      } else {
        await atomicManifestRemoveCommit(env, game, folder, filename, repoPath);
      }
      break;
    } catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true });
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

  if (!['IDMatchGame', 'NameIDGame'].includes(game)) {
    return jsonError('Unknown game: ' + game, 400);
  }
  if (!localPath) return jsonError('localPath is required', 400);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await atomicManifestDisplayNameCommit(env, game, localPath, displayName);
      break;
    } catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true });
}

async function atomicManifestDisplayNameCommit(env, game, localPath, displayName) {
  const refData    = await gh(env, 'GET', 'git/ref/heads/main');
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const manifestRepoPath = `${game}/${game}/manifest.json`;
  const manifestFile     = await gh(env, 'GET', `contents/${manifestRepoPath}`);
  const manifest         = JSON.parse(base64ToUtf8(manifestFile.content.replace(/\s/g, '')));

  if (!manifest.displayNames || typeof manifest.displayNames !== 'object') {
    manifest.displayNames = {};
  }

  const trimmed = typeof displayName === 'string' ? displayName.trim() : '';
  if (trimmed) {
    manifest.displayNames[localPath] = trimmed;
  } else {
    delete manifest.displayNames[localPath];
  }
  manifest.generated = new Date().toISOString();

  const manifestBlob = await gh(env, 'POST', 'git/blobs', {
    content:  utf8ToBase64(JSON.stringify(manifest, null, 2) + '\n'),
    encoding: 'base64',
  });

  const newTree   = await gh(env, 'POST', 'git/trees', {
    base_tree: treeSha,
    tree: [{ path: manifestRepoPath, mode: '100644', type: 'blob', sha: manifestBlob.sha }],
  });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: trimmed
      ? `Admin: set display name "${trimmed}" for ${localPath}`
      : `Admin: clear display name for ${localPath}`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', 'git/refs/heads/main', { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Atomic commit: FFCGame item label update ────────────────────────────────

async function atomicFFCLabelCommit(env, itemId, newLabel) {
  const refData    = await gh(env, 'GET', 'git/ref/heads/main');
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const itemsRepoPath = 'FFCGame/FFCGame/items.json';
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
  const refRes = await ghRaw(env, 'PATCH', 'git/refs/heads/main', { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Atomic commit: FamousPersonGame person rename ───────────────────────────

async function atomicFPGRenamePersonCommit(env, currentName, newName) {
  const refData    = await gh(env, 'GET', 'git/ref/heads/main');
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const htmlFile   = await gh(env, 'GET', 'contents/FamousPersonGame/index.html');
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
    tree: [{ path: 'FamousPersonGame/index.html', mode: '100644', type: 'blob', sha: htmlBlob.sha }],
  });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Admin: rename person "${currentName}" → "${newName}"`,
    tree:    newTree.sha,
    parents: [headSha],
  });
  const refRes = await ghRaw(env, 'PATCH', 'git/refs/heads/main', { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Atomic commit: FamousPersonGame image save/add ──────────────────────────

async function atomicFPGCommit(env, personName, imgPath, imgBytes, localPath, personMeta) {
  const refData    = await gh(env, 'GET', 'git/ref/heads/main');
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const htmlFile   = await gh(env, 'GET', 'contents/FamousPersonGame/index.html');
  const htmlNow    = base64ToUtf8(htmlFile.content.replace(/\s/g, ''));
  let   htmlPatched;

  if (personName) {
    // Replace existing person's img field
    htmlPatched = patchImg(htmlNow, personName, localPath);
  } else if (personMeta) {
    // Append new person entry
    htmlPatched = appendPerson(htmlNow, localPath, personMeta);
  } else {
    htmlPatched = htmlNow;
  }

  const imgBlob = await gh(env, 'POST', 'git/blobs', {
    content:  arrayBufferToBase64(imgBytes),
    encoding: 'base64',
  });

  const treeEntries = [
    { path: imgPath, mode: '100644', type: 'blob', sha: imgBlob.sha },
  ];

  if (htmlPatched !== htmlNow) {
    const htmlBlob = await gh(env, 'POST', 'git/blobs', {
      content:  utf8ToBase64(htmlPatched),
      encoding: 'base64',
    });
    treeEntries.push({
      path: 'FamousPersonGame/index.html',
      mode: '100644',
      type: 'blob',
      sha:  htmlBlob.sha,
    });
  }

  const newTree   = await gh(env, 'POST', 'git/trees', { base_tree: treeSha, tree: treeEntries });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: personName ? `Update image for ${personName}` : `Add image ${imgPath}`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', 'git/refs/heads/main', { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Atomic commit: FamousPersonGame image remove ────────────────────────────

async function atomicFPGRemoveCommit(env, personName, repoPath) {
  const refData    = await gh(env, 'GET', 'git/ref/heads/main');
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const treeEntries = [
    { path: repoPath, mode: '100644', type: 'blob', sha: null },
  ];

  if (personName) {
    const htmlFile  = await gh(env, 'GET', 'contents/FamousPersonGame/index.html');
    const htmlNow   = base64ToUtf8(htmlFile.content.replace(/\s/g, ''));
    const htmlPatch = patchImg(htmlNow, personName, '');
    if (htmlPatch !== htmlNow) {
      const htmlBlob = await gh(env, 'POST', 'git/blobs', {
        content:  utf8ToBase64(htmlPatch),
        encoding: 'base64',
      });
      treeEntries.push({ path: 'FamousPersonGame/index.html', mode: '100644', type: 'blob', sha: htmlBlob.sha });
    }
  }

  const newTree   = await gh(env, 'POST', 'git/trees', { base_tree: treeSha, tree: treeEntries });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Remove image ${repoPath}`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', 'git/refs/heads/main', { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Atomic commit: IDMatchGame/NameIDGame image save ────────────────────────

async function atomicManifestSaveCommit(env, game, folder, filename, repoPath, imgBytes, localPath, oldLocalPath) {
  const refData    = await gh(env, 'GET', 'git/ref/heads/main');
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const manifestRepoPath = `${game}/${game}/manifest.json`;
  const manifestFile     = await gh(env, 'GET', `contents/${manifestRepoPath}`);
  const manifest         = JSON.parse(base64ToUtf8(manifestFile.content.replace(/\s/g, '')));

  // Add folder if new
  if (!manifest.folders.includes(folder)) {
    manifest.folders = [...manifest.folders, folder].sort();
    manifest.images[folder] = [];
  }
  // Remove old entry when extension changed (e.g. bear.svg → bear.jpg)
  if (oldLocalPath && manifest.images[folder]) {
    manifest.images[folder] = manifest.images[folder].filter(p => p !== oldLocalPath);
  }
  // Add new image path if not already present
  if (!manifest.images[folder].includes(localPath)) {
    manifest.images[folder] = [...manifest.images[folder], localPath].sort();
  }
  manifest.generated = new Date().toISOString();

  const imgBlob = await gh(env, 'POST', 'git/blobs', {
    content:  arrayBufferToBase64(imgBytes),
    encoding: 'base64',
  });
  const manifestBlob = await gh(env, 'POST', 'git/blobs', {
    content:  utf8ToBase64(JSON.stringify(manifest, null, 2) + '\n'),
    encoding: 'base64',
  });

  const treeEntries = [
    { path: repoPath,         mode: '100644', type: 'blob', sha: imgBlob.sha },
    { path: manifestRepoPath, mode: '100644', type: 'blob', sha: manifestBlob.sha },
  ];

  const newTree   = await gh(env, 'POST', 'git/trees', { base_tree: treeSha, tree: treeEntries });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Admin: save image ${repoPath}`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', 'git/refs/heads/main', { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Atomic commit: IDMatchGame/NameIDGame image remove ──────────────────────

async function atomicManifestRemoveCommit(env, game, folder, filename, repoPath) {
  const refData    = await gh(env, 'GET', 'git/ref/heads/main');
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const manifestRepoPath = `${game}/${game}/manifest.json`;
  const manifestFile     = await gh(env, 'GET', `contents/${manifestRepoPath}`);
  const manifest         = JSON.parse(base64ToUtf8(manifestFile.content.replace(/\s/g, '')));

  if (manifest.images[folder]) {
    manifest.images[folder] = manifest.images[folder].filter(p => !p.endsWith(`/${filename}`));
    if (manifest.images[folder].length === 0) {
      manifest.folders = manifest.folders.filter(f => f !== folder);
      delete manifest.images[folder];
    }
  }
  if (manifest.displayNames) {
    for (const p of Object.keys(manifest.displayNames)) {
      if (p.endsWith(`/${folder}/${filename}`)) delete manifest.displayNames[p];
    }
  }
  manifest.generated = new Date().toISOString();

  const manifestBlob = await gh(env, 'POST', 'git/blobs', {
    content:  utf8ToBase64(JSON.stringify(manifest, null, 2) + '\n'),
    encoding: 'base64',
  });

  const treeEntries = [
    { path: repoPath,         mode: '100644', type: 'blob', sha: null },
    { path: manifestRepoPath, mode: '100644', type: 'blob', sha: manifestBlob.sha },
  ];

  const newTree   = await gh(env, 'POST', 'git/trees', { base_tree: treeSha, tree: treeEntries });
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Admin: remove image ${repoPath}`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', 'git/refs/heads/main', { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Atomic commit: topic folder rename (archive / restore / purge) ───────────

async function atomicTopicRenameCommit(env, game, fromFolder, toFolder, action) {
  const imgSourcePrefix = `${game}/${game}/_Resources/_imgSource`;
  const manifestRepoPath = `${game}/${game}/manifest.json`;

  // 1. Get HEAD
  const refData    = await gh(env, 'GET', 'git/ref/heads/main');
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

  const refRes = await ghRaw(env, 'PATCH', 'git/refs/heads/main', { sha: newCommit.sha, force: false });
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

  const { id, filename, imageUrl } = body;
  if (!id || !filename || !imageUrl) {
    return jsonError('id, filename, and imageUrl are required', 400);
  }

  let imgBytes, ext;
  try {
    ({ bytes: imgBytes, ext } = await downloadImage(imageUrl));
  } catch (err) {
    return jsonError('Failed to download image: ' + err.message, 502);
  }

  const base         = filename.replace(/\.[^.]+$/, '');
  const saveFilename = `${base}.${ext}`;
  const repoPath     = `FFCGame/FFCGame/_Resources/_imgSource/items/${saveFilename}`;
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

  const repoPath = localPath.startsWith('FFCGame/FFCGame/_Resources/')
    ? localPath
    : `FFCGame/FFCGame/_Resources/_imgSource/items/${localPath.split('/').pop()}`;

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
  const refData    = await gh(env, 'GET', 'git/ref/heads/main');
  const headSha    = refData.object.sha;
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  const itemsRepoPath = 'FFCGame/FFCGame/items.json';
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

  const refRes = await ghRaw(env, 'PATCH', 'git/refs/heads/main', { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Atomic commit: FFCGame image save ────────────────────────────────────────

async function atomicFFCImageCommit(env, repoPath, imgBytes, filename) {
  const refData    = await gh(env, 'GET', 'git/ref/heads/main');
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

  const refRes = await ghRaw(env, 'PATCH', 'git/refs/heads/main', { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Atomic commit: FFCGame image remove ─────────────────────────────────────

async function atomicFFCImageRemoveCommit(env, repoPath) {
  const refData    = await gh(env, 'GET', 'git/ref/heads/main');
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

  const refRes = await ghRaw(env, 'PATCH', 'git/refs/heads/main', { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── Admin: update-facts ─────────────────────────────────────────────────────

const FPG_HTML_PATH  = 'FamousPersonGame/index.html';
const FPG_TARGET     = 4;
const FPG_BATCH_SIZE = 40;

async function handleAdminUpdateFacts(request, env) {
  const authErr = await requireAdmin(request, env);
  if (authErr) return authErr;

  if (!env.ANTHRO_KEY) {
    return jsonError('ANTHRO_KEY environment variable not set on this Worker', 500);
  }

  // 1. Fetch current HTML from GitHub
  let htmlContent;
  try {
    const fileData = await gh(env, 'GET', `contents/${FPG_HTML_PATH}`);
    htmlContent = base64ToUtf8(fileData.content.replace(/\s/g, ''));
  } catch (err) {
    return jsonError(`Failed to fetch HTML from GitHub: ${err.message}`, 502);
  }

  // 2. Parse people; find who needs more facts
  const people = fpgParsePeople(htmlContent);
  const todo   = people.filter(p => p.facts.length < FPG_TARGET);

  if (todo.length === 0) {
    return json({ ok: true, message: 'All people already have 4 facts — nothing to do.', updated: 0 });
  }

  // 3. Generate facts in batches (Haiku has 8K output limit, 40 per batch is safe)
  const newFactsMap = {}; // name → full [4] fact array
  for (let i = 0; i < todo.length; i += FPG_BATCH_SIZE) {
    const batch = todo.slice(i, i + FPG_BATCH_SIZE);
    let batchResult;
    try {
      batchResult = await fpgGenerateFacts(env, batch);
    } catch (err) {
      return jsonError(`Anthropic API error (batch ${Math.floor(i / FPG_BATCH_SIZE) + 1}): ${err.message}`, 502);
    }
    for (const p of batch) {
      const generated = batchResult[p.name];
      if (Array.isArray(generated) && generated.length > 0) {
        const need = FPG_TARGET - p.facts.length;
        newFactsMap[p.name] = [...p.facts, ...generated.slice(0, need)];
      }
    }
  }

  // 4. Apply replacements in reverse offset order
  const updates = people
    .filter(p => newFactsMap[p.name])
    .sort((a, b) => b.blockStart - a.blockStart);

  let updated = htmlContent;
  for (const p of updates) {
    updated = updated.slice(0, p.blockStart) +
              fpgBuildFactsBlock(newFactsMap[p.name]) +
              updated.slice(p.blockEnd);
  }

  // 5. Commit back to GitHub
  try {
    await atomicFpgFactsCommit(env, updated, updates.length);
  } catch (err) {
    return jsonError(`GitHub commit failed: ${err.message}`, 502);
  }

  return json({ ok: true, message: `Updated ${updates.length} people. Deployment will follow shortly.`, updated: updates.length });
}

// ─── FPG parse / build helpers ────────────────────────────────────────────────

function fpgLastMatch(reSource, str) {
  const re = new RegExp(reSource, 'g');
  let m, last = null;
  while ((m = re.exec(str)) !== null) last = m[1];
  return last;
}

function fpgExtractFacts(block) {
  const m = block.match(/facts:\s*\[([\s\S]*?)\]/);
  if (!m) return [];
  const facts = [];
  for (const line of m[1].split('\n')) {
    const t = line.trim();
    if (t.startsWith("'")) {
      const content = t.endsWith("',") ? t.slice(1, -2) : t.slice(1, -1);
      if (content) facts.push(content.replace(/\\'/g, "'"));
    }
  }
  return facts;
}

function fpgEscapeJs(s) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function fpgBuildFactsBlock(facts) {
  const lines = ['    facts: ['];
  for (const f of facts) lines.push(`      '${fpgEscapeJs(f)}',`);
  lines.push('    ],');
  return lines.join('\n');
}

function fpgParsePeople(html) {
  const marker       = 'const PEOPLE = [\n';
  const sectionStart = html.indexOf(marker) + marker.length;
  const sectionEnd   = html.indexOf('\n];', sectionStart);
  const section      = html.slice(sectionStart, sectionEnd);

  const people   = [];
  const factsRe  = /    facts: \[/g;
  let fm;
  while ((fm = factsRe.exec(section)) !== null) {
    const factsOpen  = fm.index;
    const closeMatch = /    \],/.exec(section.slice(factsOpen));
    if (!closeMatch) continue;
    const blockEndRel = factsOpen + closeMatch.index + closeMatch[0].length;

    const preceding = section.slice(0, factsOpen);
    const name  = fpgLastMatch("name:\\s*'([^']+)'",  preceding);
    const years = fpgLastMatch("years:\\s*'([^']+)'", preceding);
    const tag   = fpgLastMatch("tag:\\s*'([^']+)'",   preceding);
    if (!name) continue;

    people.push({
      name,
      years: years || '',
      tag:   tag   || '',
      facts: fpgExtractFacts(section.slice(factsOpen, blockEndRel)),
      blockStart: sectionStart + factsOpen,
      blockEnd:   sectionStart + blockEndRel,
    });
  }
  return people;
}

async function fpgGenerateFacts(env, batch) {
  const peopleList = batch.map(p => ({
    name:             p.name,
    ...(p.years && { years: p.years }),
    ...(p.tag   && { tag:   p.tag   }),
    existing_facts:   p.facts,
    new_facts_needed: FPG_TARGET - p.facts.length,
  }));

  const systemPrompt =
    'You write short biographical facts for a memory-support conversation game ' +
    'used in speech therapy with older adults.\n' +
    'Rules:\n' +
    '• 1–2 sentences, about 15–25 words per fact\n' +
    '• Simple, clear language (suitable for adults with mild cognitive impairment)\n' +
    '• Factually accurate\n' +
    '• Distinct from any existing facts listed — do not repeat them\n' +
    '• Positive tone — nothing disturbing, violent, or overly sad\n' +
    '• Cover variety: personal background, personality, lesser-known achievement, or cultural legacy\n\n' +
    'Return ONLY a valid JSON object. Keys are the person names exactly as given. ' +
    'Values are arrays of exactly new_facts_needed new fact strings.\n' +
    'No markdown. No preamble.\n' +
    'Example: {"Marie Curie": ["She was born in Warsaw, Poland in 1867.", "She loved long walks in nature."]}';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         env.ANTHRO_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5',
      max_tokens: 8000,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: JSON.stringify(peopleList, null, 2) }],
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status}: ${txt.slice(0, 300)}`);
  }

  const data = await res.json();
  let raw = data.content[0].text.trim();
  raw = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  return JSON.parse(raw);
}

// ─── Atomic commit: FPG HTML update ──────────────────────────────────────────

async function atomicFpgFactsCommit(env, htmlContent, count) {
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

  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Admin: expand Famous Person facts to 4 per person (${count} updated)`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  const refRes = await ghRaw(env, 'PATCH', 'git/refs/heads/main', { sha: newCommit.sha, force: false });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
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
  const res = await fetch(ghUrl(env, path), {
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
