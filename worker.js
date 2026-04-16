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
 * Required Worker Secrets (set in Cloudflare dashboard):
 *   GITHUB_TOKEN  — fine-grained PAT, Contents: Read & Write on the repo
 *   GITHUB_OWNER  — GitHub username or org
 *   GITHUB_REPO   — repository name
 *   ADMIN_SECRET  — password used by AdminTools/ImageManager
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

    return new Response('Not found', { status: 404 });
  },
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

function requireAdmin(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token || token !== env.ADMIN_SECRET) {
    return jsonError('Unauthorized', 401);
  }
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
  const authErr = requireAdmin(request, env);
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
  const authErr = requireAdmin(request, env);
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
  const authErr = requireAdmin(request, env);
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
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true, archived: archivedFolder });
}

// ─── Admin: restore-topic ─────────────────────────────────────────────────────

async function handleAdminRestoreTopic(request, env) {
  const authErr = requireAdmin(request, env);
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
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true, restored: restoredFolder });
}

// ─── Admin: purge-topic ───────────────────────────────────────────────────────

async function handleAdminPurgeTopic(request, env) {
  const authErr = requireAdmin(request, env);
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
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true, purged: purgedFolder });
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
    // Remove from active, add to archived
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
