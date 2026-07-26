// Shared helpers (generated copies — canonical source in packages/shared; run
// `npm run sync:shared`). Bundled into this worker by wrangler at deploy time.
import { jsonRes, sha256Hex } from "./shared/helpers.js";
import { handleSuggest } from "./shared/suggest.js";

// Single source of truth for the deployed app version. Bump on every deploy that
// changes CSS/JS so the asset ?v= query changes and clients fetch fresh files.
// Policy: patch = fixes, minor = features/reskins; major stays 0 for now.
const APP_VERSION = "0.13.0";

// Append ?v=APP_VERSION to local (relative) css/js URLs in served HTML, and expose
// the version to the page as window.APP_VERSION. External/CDN URLs (http(s):, //)
// and URLs that already carry a query string are left untouched.
function injectVersion(html) {
  const stamped = html.replace(
    /\b(href|src)="((?:\.{0,2}\/)?[^":?]+\.(?:css|js))"/g,
    (match, attr, path) => {
      if (path.startsWith("//")) return match; // protocol-relative external
      return `${attr}="${path}?v=${APP_VERSION}"`;
    }
  );
  return stamped.replace(
    /<\/head>/i,
    `<script>window.APP_VERSION=${JSON.stringify(APP_VERSION)};</script></head>`
  );
}

// Old URL → new URL prefix mapping (longest match first within each group)
const LEGACY_PREFIXES = [
  ['/IDMatchGame/IDMatchGame',             '/matching/'],
  ['/MatchingMarket/MatchingMarket',        '/market/'],
  ['/NameIDGame/NameIDGame',               '/receptive/'],
  ['/HickoryDickoryDockGame/HickoryDickoryDockGame', '/clock/'],
  ['/FFCGame/FFCGame',                     '/ffc/'],
  ['/IntraverbalGame/IntraverbalGame',     '/intraverbal/'],
  ['/ThinkOrSayGame/ThinkOrSayGame',       '/think-or-say/'],
  ['/SequencesGame/SequencesGame',         '/sequences/'],
  ['/PatternPackCo/PatternPackCo',         '/patterns/'],
  ['/EmotionID',                           '/emotions/'],
  ['/FamousPersonGame',                    '/famous-person/'],
  ['/RedCarpetConvos',                     '/red-carpet-convos/'],
];

// ── Red Carpet Convos: person suggestions (KV-backed) ────────────────
// Public capture endpoint. Stores ONLY the requested public-figure name,
// deduped by normalized name with a running count — never learner/session
// data (device-local clinical-privacy rules apply).
async function handleSuggestPerson(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonRes(400, { error: "Invalid request." }); }
  const raw = ((body && body.name) || "").trim();
  if (raw.length < 2 || raw.length > 80) return jsonRes(400, { error: "A name is required." });
  const name = raw.replace(/\s+/g, " ");
  if (!env.PERSON_SUGGESTIONS) return jsonRes(200, { ok: true }); // KV not bound — accept + no-op
  const key = "sug:" + name.toLowerCase();
  const now = new Date().toISOString();
  let rec = null;
  try { rec = await env.PERSON_SUGGESTIONS.get(key, { type: "json" }); } catch { rec = null; }
  if (rec && typeof rec === "object") { rec.count = (rec.count || 1) + 1; rec.last = now; if (!rec.name) rec.name = name; }
  else rec = { name, count: 1, first: now, last: now };
  try { await env.PERSON_SUGGESTIONS.put(key, JSON.stringify(rec)); } catch { /* non-fatal */ }
  return jsonRes(200, { ok: true });
}

// Admin review endpoint (list / dismiss). Gated by ADMIN_SECRET like the API
// worker's /api/admin/* routes; ADMIN_SECRET is available on this project too.
async function handlePersonSuggestions(request, env) {
  const authErr = await requireAdminLocal(request, env);
  if (authErr) return authErr;
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const action = (body && body.action) || "list";
  if (!env.PERSON_SUGGESTIONS) return jsonRes(200, { suggestions: [] });
  if (action === "dismiss") {
    const norm = String((body && body.name) || "").trim().toLowerCase();
    if (norm) { try { await env.PERSON_SUGGESTIONS.delete("sug:" + norm); } catch { /* non-fatal */ } }
    return jsonRes(200, { ok: true });
  }
  const out = [];
  let cursor;
  do {
    const res = await env.PERSON_SUGGESTIONS.list({ prefix: "sug:", cursor });
    for (const k of res.keys) {
      try { const v = await env.PERSON_SUGGESTIONS.get(k.name, { type: "json" }); if (v) out.push(v); } catch { /* skip */ }
    }
    cursor = res.list_complete ? null : res.cursor;
  } while (cursor);
  out.sort((a, b) => (b.count || 0) - (a.count || 0) || String(b.last || "").localeCompare(String(a.last || "")));
  return jsonRes(200, { suggestions: out });
}

async function requireAdminLocal(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return jsonRes(401, { error: "Unauthorized" });
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const hash = await sha256Hex(secret);
  if (token !== hash) return jsonRes(401, { error: "Unauthorized" });
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/suggest" && request.method === "POST") {
      return handleSuggest(request, env);
    }

    // Red Carpet Convos person-suggestion queue. The KV namespace lives on
    // this Pages project, so both the public capture and the admin review
    // endpoints are handled here rather than proxied to the API worker.
    if (url.pathname === "/api/suggest-person" && request.method === "POST") {
      return handleSuggestPerson(request, env);
    }
    if (url.pathname === "/api/admin/person-suggestions" && request.method === "POST") {
      return handlePersonSuggestions(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return env.API_WORKER.fetch(request);
    }

    for (const [old, next] of LEGACY_PREFIXES) {
      if (url.pathname === old || url.pathname.startsWith(old + '/')) {
        const rest = url.pathname.slice(old.length).replace(/^\//, '');
        return Response.redirect(new URL(next + rest, request.url).href, 301);
      }
    }

    // R2-backed famous-person portraits. Try R2 (via the API worker) first; fall
    // back to the static asset for portraits not yet migrated. The URL is identical
    // either way, so no game or roster changes are needed. Red Carpet Convos reuses
    // these same portrait paths, so it resolves from R2 for free.
    const portraitMatch = url.pathname.match(
      /^\/famous-person\/_Resources\/_imgSource\/images\/([^/]+)\.(?:jpe?g|png|gif|webp|avif|svg)$/i
    );
    if (request.method === "GET" && portraitMatch) {
      try {
        const r2Res = await env.API_WORKER.fetch(
          new Request(new URL("/api/img/fpg/" + encodeURIComponent(portraitMatch[1]), request.url).href)
        );
        if (r2Res.ok) {
          const headers = new Headers(r2Res.headers);
          headers.set("Cache-Control", "public, max-age=600");
          return new Response(r2Res.body, { status: 200, headers });
        }
      } catch (_) { /* fall through to the static asset */ }
    }

    const response = await env.ASSETS.fetch(request);

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return response;
    }

    const secret = (env.ADMIN_SECRET ?? "").trim();
    const hash = await sha256Hex(secret);
    let html = await response.text();
    html = html.replace(
      /const ADMIN_SECRET_HASH = "[a-f0-9]{64}";/g,
      `const ADMIN_SECRET_HASH = "${hash}";`
    );
    html = injectVersion(html);

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    // HTML is rewritten per-request (admin hash + versioned asset URLs); never
    // cache it hard, so a deploy is picked up immediately. Asset caching lives
    // in _headers (immutable, busted by the ?v= bump).
    headers.set("Cache-Control", "no-cache");

    return new Response(html, { status: response.status, headers });
  },
};
