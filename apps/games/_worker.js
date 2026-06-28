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

async function handleSuggest(request, env) {
  const MIN_CHARS = 30;

  let body;
  try { body = await request.json(); }
  catch { return jsonRes(400, { error: "Invalid request." }); }

  const { kind, role, summary, idea, replyTo } = body;
  const ideaTrimmed = (idea || "").trim();

  if (ideaTrimmed.length < MIN_CHARS) {
    return jsonRes(400, { error: `Ideas must be at least ${MIN_CHARS} characters.` });
  }

  const key = await sha256Hex(ideaTrimmed.toLowerCase());

  if (env.SUGGEST_DUPES) {
    const seen = await env.SUGGEST_DUPES.get(key);
    if (seen) return jsonRes(409, { error: "We already have this suggestion — thank you!" });
  }

  if (!env.RESEND_API_KEY) {
    return jsonRes(503, { error: "Email delivery not configured. Use 'Copy instead'." });
  }

  const subject = `[Feature: ${kind || "Other"}] ${(summary || "").trim() || "Suggestion"}`;
  const lines = [
    `Type: ${kind || "Other"}`,
    role                   ? `From a: ${role}`                        : null,
    (summary || "").trim() ? `Summary: ${(summary || "").trim()}`     : null,
    "",
    ideaTrimmed,
    replyTo                ? `\nReply to: ${replyTo.trim()}`          : null,
  ].filter(l => l !== null);

  const toEmail = env.SUGGEST_TO_EMAIL || "feedback@nooutco.me";
  const resendBody = {
    from: "No Outcome ABA <noreply@nooutco.me>",
    to: [toEmail],
    subject,
    text: lines.join("\n"),
  };
  if (replyTo) resendBody.reply_to = [replyTo.trim()];

  const sendResp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(resendBody),
  });

  if (!sendResp.ok) {
    const err = await sendResp.json().catch(() => ({}));
    console.error("Resend error", sendResp.status, err);
    return jsonRes(502, { error: "Send failed. Use 'Copy instead' to send manually." });
  }

  if (env.SUGGEST_DUPES) {
    await env.SUGGEST_DUPES.put(key, "1", { expirationTtl: 60 * 60 * 24 * 365 });
  }

  return jsonRes(200, { ok: true });
}

function jsonRes(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
