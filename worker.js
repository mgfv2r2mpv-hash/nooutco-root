/**
 * Cloudflare Worker — save-photo endpoint
 *
 * POST /api/save-photo
 *   Body: { personName: string, imageUrl: string }
 *   Downloads the image from Wikipedia/Wikimedia and lands a single atomic
 *   commit to GitHub containing both the new image file and the patched
 *   img: field in FamousPersonGame/index.html — one build per photo save.
 *
 * Required Worker Secrets (set in Cloudflare dashboard):
 *   GITHUB_TOKEN  — fine-grained PAT, Contents: Read & Write on the repo
 *   GITHUB_OWNER  — GitHub username or org  (e.g. "jsmith")
 *   GITHUB_REPO   — repository name         (e.g. "games-nooutco-me")
 *
 * Route (Cloudflare dashboard → Websites → games.nooutco.me → Worker Routes):
 *   games.nooutco.me/api/*  →  this Worker
 */

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method === 'POST' && pathname === '/api/save-photo') {
      return handleSavePhoto(request, env);
    }

    return new Response('Not found', { status: 404 });
  },
};

// ─── Main handler ─────────────────────────────────────────────────────────────

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

  const slug     = nameToSlug(personName);
  const imgPath  = `FamousPersonGame/images/${slug}.${ext}`;
  const localPath = `images/${slug}.${ext}`;

  // Retry up to 3 times if a concurrent commit races us (422 non-fast-forward)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await atomicCommit(env, personName, imgPath, imgBytes, localPath);
      break;
    } catch (err) {
      if (err.message === 'CONFLICT' && attempt < 2) continue;
      return jsonError('GitHub commit failed: ' + err.message, 502);
    }
  }

  return json({ ok: true, localPath });
}

// ─── Atomic commit via Git Data API ───────────────────────────────────────────
// Bundles the image file + HTML patch into a single commit so Cloudflare Pages
// only triggers one build per photo save (down from two).

async function atomicCommit(env, personName, imgPath, imgBytes, localPath) {
  // 1. Current HEAD
  const refData  = await gh(env, 'GET', 'git/ref/heads/main');
  const headSha  = refData.object.sha;

  // 2. Tree SHA of HEAD commit
  const commitData = await gh(env, 'GET', `git/commits/${headSha}`);
  const treeSha    = commitData.tree.sha;

  // 3. Current index.html (need its content to patch + its blob SHA to skip if unchanged)
  const htmlFile   = await gh(env, 'GET', 'contents/FamousPersonGame/index.html');
  const htmlNow    = base64ToUtf8(htmlFile.content.replace(/\s/g, ''));
  const htmlPatched = patchImg(htmlNow, personName, localPath);

  // 4. Create image blob
  const imgBlob = await gh(env, 'POST', 'git/blobs', {
    content:  arrayBufferToBase64(imgBytes),
    encoding: 'base64',
  });

  // 5. Build tree entries — always include image; only include HTML if changed
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

  // 6. New tree
  const newTree = await gh(env, 'POST', 'git/trees', {
    base_tree: treeSha,
    tree:      treeEntries,
  });

  // 7. New commit
  const newCommit = await gh(env, 'POST', 'git/commits', {
    message: `Save photo for ${personName}`,
    tree:    newTree.sha,
    parents: [headSha],
  });

  // 8. Advance HEAD (fast-forward only — 422 means a concurrent commit won)
  const refRes = await ghRaw(env, 'PATCH', 'git/refs/heads/main', {
    sha:   newCommit.sha,
    force: false,
  });
  if (refRes.status === 422) throw new Error('CONFLICT');
  if (!refRes.ok) throw new Error(`ref update: ${refRes.status}`);
}

// ─── HTML patch ───────────────────────────────────────────────────────────────

function patchImg(html, personName, localPath) {
  const safe = personName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re   = new RegExp(
    `(name:\\s*['"]${safe}['"][\\s\\S]{0,400}?img:\\s*['"])[^'"]+(['"])`,
  );
  return html.replace(re, `$1${localPath}$2`);
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
  };
  const urlExt = url.split('?')[0].split('.').pop().toLowerCase();
  const ext = extMap[ct]
    || (['jpg','jpeg','png','webp','gif','avif'].includes(urlExt)
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
    'Access-Control-Allow-Headers': 'Content-Type',
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
