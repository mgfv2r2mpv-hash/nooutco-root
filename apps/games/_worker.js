// Shared helpers (generated copies — canonical source in packages/shared; run
// `npm run sync:shared`). Bundled into this worker by wrangler at deploy time.
import { jsonRes, sha256Hex } from "./shared/helpers.js";
import { handleSuggest } from "./shared/suggest.js";

// Single source of truth for the deployed app version. Bump on every deploy that
// changes CSS/JS so the asset ?v= query changes and clients fetch fresh files.
// Policy: patch = fixes, minor = features/reskins; major stays 0 for now.
const APP_VERSION = "0.3.0";

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
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/suggest" && request.method === "POST") {
      return handleSuggest(request, env);
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

// handleSuggest moved to packages/shared/worker/suggest.js (imported above).
// jsonRes + sha256Hex moved to packages/shared/worker/helpers.js (imported above).
