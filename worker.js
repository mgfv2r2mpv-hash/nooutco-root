/**
 * Cloudflare Worker — save-photo endpoint
 *
 * POST /api/save-photo
 *   Body: { personName: string, imageUrl: string }
 *   Downloads the image from Wikipedia/Wikimedia, commits it to the GitHub
 *   repo as FamousPersonGame/images/<slug>.<ext>, and patches the img: field
 *   in FamousPersonGame/index.html so all devices see the local image.
 *
 * Required Worker Secrets (set in Cloudflare dashboard):
 *   GITHUB_TOKEN  — fine-grained PAT, Contents: Read & Write on the repo
 *   GITHUB_OWNER  — GitHub username or org  (e.g. "jsmith")
 *   GITHUB_REPO   — repository name         (e.g. "games-nooutco-me")
 *
 * Route (set in Cloudflare dashboard under Websites → games.nooutco.me → Worker Routes):
 *   games.nooutco.me/api/*  →  this Worker
 */

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    // CORS preflight
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
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const { personName, imageUrl } = body;
  if (!personName || !imageUrl) {
    return jsonError('personName and imageUrl are required', 400);
  }

  // Only allow Wikimedia/Wikipedia image domains
  let parsedUrl;
  try { parsedUrl = new URL(imageUrl); } catch {
    return jsonError('Invalid imageUrl', 400);
  }
  if (!parsedUrl.hostname.endsWith('wikimedia.org') &&
      !parsedUrl.hostname.endsWith('wikipedia.org')) {
    return jsonError('imageUrl must be from wikimedia.org or wikipedia.org', 403);
  }

  // Download image
  let imgBytes, ext;
  try {
    ({ bytes: imgBytes, ext } = await downloadImage(imageUrl));
  } catch (err) {
    return jsonError('Failed to download image: ' + err.message, 502);
  }

  const slug    = nameToSlug(personName);
  const imgPath = `FamousPersonGame/images/${slug}.${ext}`;

  // Commit image to GitHub
  try {
    await githubPut(env, imgPath, arrayBufferToBase64(imgBytes),
      `Add photo for ${personName}`);
  } catch (err) {
    return jsonError('GitHub image commit failed: ' + err.message, 502);
  }

  // Fetch, patch, and re-commit index.html
  const htmlPath = 'FamousPersonGame/index.html';
  try {
    await patchAndCommitHtml(env, htmlPath, personName, `images/${slug}.${ext}`);
  } catch (err) {
    // Image is already committed; HTML patch failure is non-fatal
    console.error('HTML patch failed (image was saved):', err.message);
  }

  return json({ ok: true, localPath: `images/${slug}.${ext}` });
}

// ─── HTML patch ───────────────────────────────────────────────────────────────

async function patchAndCommitHtml(env, htmlPath, personName, localPath) {
  // Retry once on 409 (concurrent SHA conflict)
  for (let attempt = 0; attempt < 2; attempt++) {
    const { content: b64, sha } = await githubGet(env, htmlPath);
    const html    = base64ToUtf8(b64);
    const patched = patchImg(html, personName, localPath);

    if (patched === html) {
      // Nothing to update (already set, or name not found)
      return;
    }

    const res = await githubPut(env, htmlPath, utf8ToBase64(patched),
      `Update photo for ${personName}`, sha);

    if (res.status === 409 && attempt === 0) continue; // retry with fresh SHA
    if (!res.ok) throw new Error(`GitHub HTML commit: ${res.status}`);
    return;
  }
  throw new Error('GitHub HTML commit failed after retry');
}

function patchImg(html, personName, localPath) {
  // Match the person's name field then scan up to 400 chars to find the img field.
  // The {0,400} cap prevents accidentally crossing into the next person's entry.
  const safe = personName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re   = new RegExp(
    `(name:\\s*['"]${safe}['"][\\s\\S]{0,400}?img:\\s*['"])[^'"]+(['"])`,
  );
  return html.replace(re, `$1${localPath}$2`);
}

// ─── GitHub API helpers ───────────────────────────────────────────────────────

function githubHeaders(env) {
  return {
    Authorization: `token ${env.GITHUB_TOKEN}`,
    Accept:        'application/vnd.github+json',
    'User-Agent':  'games-save-photo-worker/1.0',
    'Content-Type': 'application/json',
  };
}

function githubUrl(env, path) {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`;
}

async function githubGet(env, path) {
  const res = await fetch(githubUrl(env, path), { headers: githubHeaders(env) });
  if (!res.ok) throw new Error(`GitHub GET ${path}: ${res.status}`);
  return res.json(); // { content, sha, ... }
}

async function githubPut(env, path, content, message, sha) {
  const body = { message, content };
  if (sha) body.sha = sha;
  const res = await fetch(githubUrl(env, path), {
    method:  'PUT',
    headers: githubHeaders(env),
    body:    JSON.stringify(body),
  });
  // Return raw response so the caller can inspect status (e.g. 409 conflict)
  return res;
}

// ─── Image download ───────────────────────────────────────────────────────────

async function downloadImage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'games-save-photo-worker/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const ct  = (res.headers.get('content-type') || '').split(';')[0].trim();
  const extMap = {
    'image/jpeg':   'jpg',
    'image/jpg':    'jpg',
    'image/png':    'png',
    'image/webp':   'webp',
    'image/gif':    'gif',
    'image/avif':   'avif',
  };
  // Fallback: try to infer from URL path
  const urlExt = url.split('?')[0].split('.').pop().toLowerCase();
  const ext = extMap[ct] || (['jpg','jpeg','png','webp','gif','avif'].includes(urlExt) ? (urlExt === 'jpeg' ? 'jpg' : urlExt) : 'jpg');

  const bytes = await res.arrayBuffer();
  return { bytes, ext };
}

// ─── Encoding helpers ─────────────────────────────────────────────────────────

function arrayBufferToBase64(buffer) {
  // Chunked to avoid stack overflow on large images
  const bytes     = new Uint8Array(buffer);
  const chunkSize = 8192;
  let binary      = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function utf8ToBase64(str) {
  const bytes     = new TextEncoder().encode(str);
  const chunkSize = 8192;
  let binary      = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
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
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
