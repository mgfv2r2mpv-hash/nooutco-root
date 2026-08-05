// Shared helpers (generated copies - canonical source in packages/shared; run
// `npm run sync:shared`). Bundled into this worker by wrangler at deploy time.
import { jsonRes, sha256Hex } from "./shared/helpers.js";
import { handleSuggest } from "./shared/suggest.js";

// Notes tools that can be scoped to a managed password.
const NOTES_TOOLS = ["bt", "sup", "parent", "assess", "sap"];

// Old URL → new URL prefix mapping (specific paths before their parent prefix).
// The four BCBA note tools live on one unified page at /notes/bcba/?tool=<id>.
const LEGACY_PREFIXES = [
  ['/NoteDrafter/BTNotes',       '/notes/bt/'],
  ['/NoteDrafter/SupNotes',      '/notes/bcba/?tool=sup'],
  ['/NoteDrafter/PTNotes',       '/notes/bcba/?tool=parent'],
  ['/NoteDrafter/AssessNotes',   '/notes/bcba/?tool=assess'],
  ['/NoteDrafter/SAPGoalsDrafter', '/notes/bcba/?tool=sap'],
  ['/NoteDrafter',               '/notes/'],
  ['/SessionFlow',               '/session-flow/'],
  ['/CPRAnalyzer',               '/cpr/'],
  ['/notes/sup',                 '/notes/bcba/?tool=sup'],
  ['/notes/sap',                 '/notes/bcba/?tool=sap'],
  ['/notes/assess',              '/notes/bcba/?tool=assess'],
  ['/notes/parent',              '/notes/bcba/?tool=parent'],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Bot Fight Mode (cannot be disabled on this plan) challenges every non-static
    // request, which breaks fetch()/XHR to /api/* - an XHR can't solve an interactive
    // challenge, so it receives challenge HTML instead of JSON. Cloudflare exempts
    // static file extensions from the challenge, so the client appends a ".js" suffix
    // to API paths (see API_SUFFIX in notes-gate.js). Strip it here so routing is
    // unchanged. REMOVE this and API_SUFFIX once the edge stops challenging /api/*.
    if (url.pathname.startsWith("/api/") && url.pathname.endsWith(".js")) {
      url.pathname = url.pathname.slice(0, -3);
    }

    // Password login - returns a signed session token that unlocks Generate Note
    if (url.pathname === "/api/login" && request.method === "POST") {
      return handleLogin(request, env);
    }

    // API proxy endpoint for LLM calls (server-side key, requires a session token)
    if (url.pathname === "/api/llm-call" && request.method === "POST") {
      return handleLlmCall(request, env);
    }

    // Admin-only CRUD for managed access passwords (GET/POST/PATCH/DELETE)
    if (url.pathname === "/api/admin/passwords") {
      return handleAdminPasswords(request, env);
    }

    if (url.pathname === "/api/nonpii") {
      return handleNonPii(request, env);
    }

    if (url.pathname === "/api/error-report" && request.method === "POST") {
      return handleErrorReport(request, env);
    }

    if (url.pathname === "/api/report-error" && request.method === "POST") {
      return handleUserReport(request, env);
    }

    if (url.pathname === "/api/suggest" && request.method === "POST") {
      return handleSuggest(request, env);
    }

    // Public endpoint - returns learned stopwords/firstNames (generic vocab, not PHI)
    if (url.pathname === "/api/scrub-config" && request.method === "GET") {
      return handleScrubConfig(request, env);
    }

    // Admin-only: manage problem strings queue for next nightly learning run
    if (url.pathname === "/api/admin/scrub-learn") {
      return handleScrubLearn(request, env);
    }

    // Admin-only: view current scrub override state
    if (url.pathname === "/api/admin/scrub-overrides" && request.method === "GET") {
      return handleScrubOverrides(request, env);
    }

    // Admin-only: review queue - list pending AI suggestions, approve/reject
    if (url.pathname === "/api/admin/scrub-suggestions") {
      return handleScrubSuggestions(request, env);
    }

    // Trigger the learning run - admin token OR CRON_SECRET (for the scheduled GitHub Action)
    if (url.pathname === "/api/admin/scrub-run" && request.method === "POST") {
      return handleScrubRun(request, env);
    }

    // Any authenticated user: silently report bare scrubbed words (no context, no
    // linkage) into the PII review queue. PHI-safe vocabulary capture only.
    if (url.pathname === "/api/scrub-report" && request.method === "POST") {
      return handleScrubReport(request, env);
    }

    // Any authenticated user: content-free audit / usage events.
    if (url.pathname === "/api/audit" && request.method === "POST") {
      return handleAudit(request, env);
    }

    // The technician's own learned style card. The browser talks to us, never
    // to the profile Worker - see profileFetch.
    if (url.pathname === "/api/style-card" && request.method === "GET") {
      return handleStyleCard(request, env);
    }
    if (url.pathname === "/api/style-card/mute" && request.method === "POST") {
      return handleStyleCardMute(request, env);
    }

    // Admin-only: anonymised, cohort-level view of what the tool has learned
    // across technicians. Names nobody - see handleInsights in the profile app.
    if (url.pathname === "/api/admin/style-insights" && request.method === "GET") {
      return handleStyleInsights(request, env);
    }

    // Admin-only: read back the house voice block that is currently live.
    if (url.pathname === "/api/admin/voice-block" && request.method === "GET") {
      return handleVoiceBlockRead(request, env);
    }

    // Admin-only: file a ticket stub from inside the site.
    if (url.pathname === "/api/admin/ticket" && request.method === "POST") {
      return handleTicket(request, env);
    }

    // Admin-only: the supervisor view of individual technician profiles, and
    // removing a rule that is not in line with policy. See handleProfileAdmin.
    if (url.pathname.startsWith("/api/admin/profile/")) {
      return handleProfileAdmin(request, env, url);
    }

    // Admin-only: review queue for tech-submitted PII/non-PII candidate terms
    if (url.pathname === "/api/admin/term-queue") {
      return handleTermQueue(request, env);
    }

    // Admin-only: directly curate (add/remove) a live PII or non-PII term
    if (url.pathname === "/api/admin/terms") {
      return handleTerms(request, env);
    }

    // Weekly term digest - admin token OR CRON_SECRET (the Friday GitHub Action)
    if (url.pathname === "/api/admin/term-digest" && request.method === "POST") {
      return handleTermDigest(request, env);
    }

    for (const [old, next] of LEGACY_PREFIXES) {
      if (url.pathname === old || url.pathname.startsWith(old + '/')) {
        // Targets with a query string are exact destinations - don't append the rest.
        const rest = next.includes('?') ? '' : url.pathname.slice(old.length).replace(/^\//, '');
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

    const headers = new Headers(response.headers);
    headers.delete("content-length");

    return new Response(html, { status: response.status, headers });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScrubLearning(env));
  },
};

// Repeats of an identical tool+message are counted rather than emailed. The
// first mails immediately; after that only these thresholds do, each carrying
// the running count. A single email cannot report a count that has not happened
// yet, so frequency arrives by escalation instead of by delaying the first
// alert - which matters because the clinician is told to make contact if it
// happens again, and the plain dedupe would have discarded exactly that repeat.
const ERROR_ESCALATE_AT = [5, 25, 100];

// Email an operational error to the admin, so failures are seen even if no user
// reports them. Bounded against flooding by (a) a per-message occurrence counter
// that only mails at the escalation thresholds and (b) a global hourly budget.
// Never throws.
async function notifyError(env, tool, message, meta, diagnostics) {
  try {
    if (!env.RESEND_API_KEY) return;
    const msg = (message || "").toString().slice(0, 2000);
    if (!msg) return;

    let occurrence = 1;
    if (env.SUGGEST_DUPES) {
      // Per-message occurrence count, on a one-hour sliding window.
      const dedupeKey = "errmail:" + (await sha256Hex((tool || "") + "|" + msg));
      occurrence = parseInt((await env.SUGGEST_DUPES.get(dedupeKey)) || "0", 10) + 1;
      await env.SUGGEST_DUPES.put(dedupeKey, String(occurrence), { expirationTtl: 3600 });
      if (occurrence > 1 && !ERROR_ESCALATE_AT.includes(occurrence)) return;

      // Global hourly budget so a flood of distinct messages can't email-bomb.
      const hour = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
      const budgetKey = "errmail:budget:" + hour;
      const used = parseInt((await env.SUGGEST_DUPES.get(budgetKey)) || "0", 10);
      if (used >= 30) return;
      await env.SUGGEST_DUPES.put(budgetKey, String(used + 1), { expirationTtl: 3600 });
    }

    const toEmail = env.SUGGEST_TO_EMAIL || "feedback@nooutco.me";
    const diagLines = diagnostics
      ? Object.keys(diagnostics).map((k) => `  ${k}: ${diagnostics[k]}`)
      : [];
    const text = [
      `Tool: ${tool || "(unknown)"}`,
      `Time: ${new Date().toISOString()}`,
      occurrence > 1 ? `Occurrences: ${occurrence} in the past hour` : `Occurrences: 1 (first this hour)`,
      meta ? `Context: ${meta}` : null,
      ``,
      `Error:`,
      msg,
      diagLines.length ? `\nDiagnostics (structural only - no note content):` : null,
      ...diagLines,
    ].filter((l) => l !== null).join("\n");
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: "No Outcome ABA <noreply@nooutco.me>",
        to: [toEmail],
        subject: `[Error${occurrence > 1 ? ` ×${occurrence}` : ""}] ${tool || "notes"} - ${msg.slice(0, 60)}`,
        text,
      }),
    });
  } catch (e) {
    // Reporting must never break the request path.
    console.error("notifyError failed:", e && e.message ? e.message : "unknown");
  }
}

// Client-reported error. A valid session token is optional: authenticated reports
// (generation failures) are trusted; tokenless reports (e.g. login-stage failures,
// where the user has no token yet) are still accepted but bounded by notifyError's
// dedupe + hourly budget so the open path can't be abused to flood email.
async function handleErrorReport(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const authed = !!secret && (await verifyToken(token, secret));

  let body;
  try { body = await request.json(); }
  catch { return jsonRes(400, { error: "Invalid request." }); }

  const { message, tool, diagnostics } = body;
  if (!message) return jsonRes(400, { error: "Missing message." });

  await notifyError(
    env,
    tool || "notes",
    message,
    authed ? "client (authenticated)" : "client (unauthenticated)",
    sanitizeDiagnostics(diagnostics)
  );
  return jsonRes(200, { ok: true });
}

// PRIVACY: the diagnostics bag comes from the browser and is echoed into an
// email, so it is whitelisted rather than trusted - known keys only, scalars
// only, each capped. Every permitted key is structural (stop reason, lengths,
// parser position); none can carry note content.
const DIAGNOSTIC_KEYS = [
  "stage", "status", "model", "stopReason",
  "rawChars", "sliceChars", "outputTokens", "braceMatch", "parseError",
  // Recovery outcome: whether the escape-repair pass salvaged the draft, and
  // whether a resample was spent. Both are needed to tell a model that is
  // mis-serializing (repaired/retried, clinician saw nothing) apart from one
  // that defeated both recoveries.
  "repaired", "retried",
  // Which contracted sections the model omitted. Schema key names, not content.
  "missingKeys",
];

function sanitizeDiagnostics(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const out = {};
  for (const k of DIAGNOSTIC_KEYS) {
    const v = d[k];
    if (v === null || v === undefined || v === "") continue;
    if (typeof v === "object") continue;
    out[k] = String(v).slice(0, 200);
  }
  return Object.keys(out).length ? out : null;
}

// User-initiated error report from the floating ⚠️ button on tool pages.
// Unlike notifyError(), this is never silently dropped - no hourly budget cap.
// Dedup prevents the same report being submitted twice within 24 hours.
async function handleUserReport(request, env) {
  const MIN_CHARS = 10;

  let body;
  try { body = await request.json(); }
  catch { return jsonRes(400, { error: "Invalid request." }); }

  const { message, tool, replyTo } = body;
  const msg = (message || "").trim();

  if (msg.length < MIN_CHARS) {
    return jsonRes(400, { error: `Please describe the error (at least ${MIN_CHARS} characters).` });
  }

  if (env.SUGGEST_DUPES) {
    const dedupeKey = "userreport:" + (await sha256Hex((tool || "") + "|" + msg.toLowerCase()));
    if (await env.SUGGEST_DUPES.get(dedupeKey)) {
      return jsonRes(409, { error: "Already reported - we have this one." });
    }
  }

  if (!env.RESEND_API_KEY) {
    return jsonRes(503, { error: "Email delivery not configured." });
  }

  const toEmail = env.SUGGEST_TO_EMAIL || "feedback@nooutco.me";
  const subject = `[⚠️ Error Report] ${tool || "App"}: ${msg.slice(0, 60)}${msg.length > 60 ? "…" : ""}`;
  const lines = [
    `Tool: ${tool || "(unknown)"}`,
    `Time: ${new Date().toISOString()}`,
    ``,
    msg,
    replyTo ? `\nReply to: ${replyTo.trim()}` : null,
  ].filter(l => l !== null);

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
    console.error("handleUserReport Resend error", sendResp.status, err);
    return jsonRes(502, { error: "Send failed. Please try again." });
  }

  if (env.SUGGEST_DUPES) {
    const dedupeKey = "userreport:" + (await sha256Hex((tool || "") + "|" + msg.toLowerCase()));
    await env.SUGGEST_DUPES.put(dedupeKey, "1", { expirationTtl: 60 * 60 * 24 });
  }

  return jsonRes(200, { ok: true });
}

// Validate a password and issue a signed session token.
// Two tiers: the ADMIN_SECRET (role "admin", also unlocks the passwords admin)
// and managed access passwords in the API_PASSWORDS KV (role "user", Generate
// Note only). The token is an HMAC over {exp, role[, kid]} signed with
// ADMIN_SECRET, so rotating the secret invalidates every outstanding token.
async function handleLogin(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return jsonRes(400, { error: "Invalid request." }); }

  const secret = (env.ADMIN_SECRET ?? "").trim();
  const password = (body.password ?? "").trim();

  if (!secret) { await notifyError(env, "login", "Login is not configured (ADMIN_SECRET missing)."); return jsonRes(503, { error: "Login is not configured." }); }
  if (!password) return jsonRes(401, { error: "Incorrect password." });

  try {
    // Turnstile bot check - enforced only when TURNSTILE_SECRET is configured. It runs
    // before any password comparison so /api/login can be safely exempted from
    // Cloudflare's edge bot challenge (which otherwise blocks the fetch outright).
    const turnstileSecret = (env.TURNSTILE_SECRET ?? "").trim();
    if (turnstileSecret) {
      const ok = await verifyTurnstile(
        turnstileSecret,
        (body.turnstileToken ?? "").trim(),
        request.headers.get("CF-Connecting-IP") || ""
      );
      if (!ok) return jsonRes(403, { error: "Verification failed. Please complete the challenge and retry." });
    }

    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;

    // Admin password - full access including the API Passwords admin screen.
    if (password === secret) {
      const token = await signToken({ exp, role: "admin" }, secret);
      return jsonRes(200, { token, role: "admin" });
    }

    // Managed access passwords (API_PASSWORDS KV) - scoped to specific tools.
    if (env.API_PASSWORDS) {
      const rec = await findPassword(env.API_PASSWORDS, password);
      if (rec && rec.active) {
        const tools = Array.isArray(rec.tools) ? rec.tools : [];
        const token = await signToken({ exp, role: "user", kid: rec.id, tools }, secret);
        return jsonRes(200, { token, role: "user", tools });
      }
    }

    return jsonRes(401, { error: "Incorrect password." });
  } catch (err) {
    // Unexpected failure (KV, crypto, Turnstile siteverify) - email the admin; a
    // wrong password returns 401 above and is intentionally NOT reported.
    await notifyError(env, "login", err && err.message ? err.message : "Unknown login error.");
    return jsonRes(500, { error: "Login failed due to a server error. Please try again." });
  }
}

// Verify a Cloudflare Turnstile token via siteverify. Returns true only on success.
async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  try {
    const form = new URLSearchParams();
    form.append("secret", secret);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const data = await res.json().catch(() => ({}));
    return !!data.success;
  } catch {
    return false;
  }
}

async function handleLlmCall(request, env) {
  try {
    const secret = (env.ADMIN_SECRET ?? "").trim();
    const auth = request.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const payload = secret ? await readToken(token, secret) : null;

    if (!payload) {
      return jsonRes(401, { error: "Not logged in. Please log in to generate a note." });
    }

    const body = await request.json();
    const { systemPrompt, userPrompt, system, messages, model, maxTokens, tool } = body;
    // The schema comes from the browser, so it is shape-checked rather than
    // forwarded verbatim - this is a field we hand to the upstream API.
    const outputConfig = sanitizeOutputConfig(body.output_config);
    if (body.output_config && !outputConfig) {
      return jsonRes(400, { error: "Invalid output_config." });
    }
    // Two accepted shapes: legacy single-shot {systemPrompt, userPrompt}, or a
    // conversation {system, messages} for the multi-turn revision flow.
    const isConversation = typeof system === "string" && Array.isArray(messages);
    if (!isConversation && (!systemPrompt || !userPrompt)) {
      return jsonRes(400, { error: "Missing required fields: systemPrompt+userPrompt or system+messages" });
    }
    if (isConversation) {
      const err = validateConversation(system, messages);
      if (err) return jsonRes(400, { error: err });
    }

    // Managed passwords: re-check the KV every call for instant revocation AND
    // per-tool scope enforcement. Admin bypasses scope.
    if (payload.role !== "admin") {
      const rec = env.API_PASSWORDS ? await getPasswordRecord(env.API_PASSWORDS, payload.kid) : null;
      if (!rec || !rec.active) return jsonRes(401, { error: "Access revoked. Please log in again." });
      if (tool && !rec.tools.includes(tool)) {
        return jsonRes(403, { error: "Your access doesn't include this tool." });
      }
    }

    const apiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
    if (!apiKey) return jsonRes(503, { error: "Server API key is not configured." });

    // Append the house voice, server-side, so the rules never reach a browser.
    // An unlisted tool, or any failure reading the block, leaves the prompt
    // exactly as it arrived.
    const voice = await getVoiceBlock(env);
    let sys = composeVoice(isConversation ? system : systemPrompt, voice, tool);
    // His clinical judgement, only where the caller explicitly asked for a
    // recommendation. Ruling 2: an opinion never fills a silence in the input.
    sys = composeOpinions(sys, voice, tool, { wantsRecommendation: body.want_opinions === true });

    const llmResponse = isConversation
      ? await callAnthropicConversation(
          apiKey, sys, messages, model || "claude-haiku-4-5-20251001", maxTokens || 3000, outputConfig
        )
      : await callAnthropicApi(
          apiKey, sys, userPrompt, model || "claude-haiku-4-5-20251001", maxTokens || 3000, outputConfig
        );
    return jsonRes(200, llmResponse);
  } catch (error) {
    // PRIVACY: never log the request body, systemPrompt, or userPrompt. The client
    // de-identifies (scrubs names to role tokens) before sending, and we keep it that
    // way - log only the error message, never prompt content.
    const m = error && error.message ? error.message : "unknown";
    console.error("LLM call error:", m);
    await notifyError(env, "llm-call", m);
    return jsonRes(500, { error: error.message || "Internal server error" });
  }
}

/* ── Session tokens: base64url(JSON payload) "." base64url(HMAC-SHA256) ── */

function b64urlEncode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(str) {
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmac(payloadStr, secret) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadStr));
  return new Uint8Array(sig);
}
async function signToken(payload, secret) {
  const payloadStr = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64urlEncode(await hmac(payloadStr, secret));
  return `${payloadStr}.${sig}`;
}
// Verify signature + expiry; return the decoded payload, or null if invalid.
async function readToken(token, secret) {
  if (!token || token.indexOf(".") === -1) return null;
  const [payloadStr, sig] = token.split(".");
  const expected = b64urlEncode(await hmac(payloadStr, secret));
  // constant-time-ish compare
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadStr)));
    if (payload.exp && payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

async function verifyToken(token, secret) {
  return (await readToken(token, secret)) !== null;
}

/* ── API_PASSWORDS KV ──────────────────────────────────────────────
   Each managed password is a key `pw:<id>` whose value is unused ("1")
   and whose metadata holds { label, hash, active, createdAt }, where
   hash = sha256(password). list() returns metadata, so login and the
   admin list are both a single list() call - no per-key reads. ── */

async function findPassword(kv, password) {
  const h = await sha256Hex(password);
  // Point lookup via the hash→id index: a get() reflects a just-written key in
  // its origin colo immediately, unlike list() which lags ~60s. This is what
  // lets a freshly-created password log in right away.
  const indexedId = await kv.get("h:" + h);
  if (indexedId) {
    const { metadata } = await kv.getWithMetadata("pw:" + indexedId);
    if (metadata && metadata.hash === h) {
      return { id: indexedId, label: metadata.label || "", active: !!metadata.active, tools: Array.isArray(metadata.tools) ? metadata.tools : [], createdAt: metadata.createdAt || null };
    }
  }
  // Fallback for legacy records created before the index existed.
  const list = await kv.list({ prefix: "pw:" });
  for (const k of list.keys) {
    const md = k.metadata || {};
    if (md.hash === h) {
      return { id: k.name.slice(3), label: md.label || "", active: !!md.active, tools: Array.isArray(md.tools) ? md.tools : [], createdAt: md.createdAt || null };
    }
  }
  return null;
}

async function getPasswordRecord(kv, id) {
  if (!id) return null;
  const { metadata } = await kv.getWithMetadata("pw:" + id);
  if (!metadata) return null;
  return { active: !!metadata.active, tools: Array.isArray(metadata.tools) ? metadata.tools : [] };
}

// Certified-non-PII store - any authenticated user can read/add; admin can delete.
// Stored as nonpii:v1 in the API_PASSWORDS KV namespace.
async function handleNonPii(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const payload = secret ? await readToken(token, secret) : null;
  if (!payload) return jsonRes(401, { error: "Login required." });
  if (!env.API_PASSWORDS) return jsonRes(503, { error: "Storage not configured." });
  const kv = env.API_PASSWORDS;
  const KV_KEY = "nonpii:v1";

  if (request.method === "GET") {
    const raw = await kv.get(KV_KEY);
    const terms = raw ? JSON.parse(raw) : [];
    return jsonRes(200, { terms });
  }

  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonRes(400, { error: "Invalid body." }); }
    const term = normalizeTerm(body.term);
    if (!term) return jsonRes(400, { error: "term is required." });
    // A tech certification no longer commits globally - it lands in a review queue
    // (handleTermQueue) for the admin to approve. Only an admin add commits live here.
    if (payload.role !== "admin") {
      await enqueueTerms(kv, "nonpii-pending:v1", [term], "tech-cert");
      return jsonRes(200, { ok: true, queued: true });
    }
    const raw = await kv.get(KV_KEY);
    const terms = raw ? JSON.parse(raw) : [];
    if (!terms.some((e) => e.term === term)) {
      terms.push({ term, certifiedAt: body.certifiedAt || new Date().toISOString() });
      await kv.put(KV_KEY, JSON.stringify(terms));
    }
    return jsonRes(200, { ok: true });
  }

  if (request.method === "DELETE") {
    if (payload.role !== "admin") return jsonRes(403, { error: "Admin only." });
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const raw = await kv.get(KV_KEY);
    const terms = raw ? JSON.parse(raw) : [];
    if (body.term) {
      const lc = body.term.toLowerCase().trim();
      await kv.put(KV_KEY, JSON.stringify(terms.filter((e) => e.term !== lc)));
    } else {
      await kv.put(KV_KEY, JSON.stringify([]));
    }
    return jsonRes(200, { ok: true });
  }

  return jsonRes(405, { error: "Method not allowed." });
}

// Admin-only management of the managed access passwords.
async function handleAdminPasswords(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const payload = secret ? await readToken(token, secret) : null;
  if (!payload || payload.role !== "admin") return jsonRes(401, { error: "Admin access required." });
  if (!env.API_PASSWORDS) return jsonRes(503, { error: "API_PASSWORDS KV is not bound." });
  const kv = env.API_PASSWORDS;

  if (request.method === "GET") {
    const list = await kv.list({ prefix: "pw:" });
    const passwords = list.keys
      .map((k) => ({
        id: k.name.slice(3),
        label: (k.metadata && k.metadata.label) || "",
        active: !!(k.metadata && k.metadata.active),
        tools: (k.metadata && Array.isArray(k.metadata.tools)) ? k.metadata.tools : [],
        createdAt: (k.metadata && k.metadata.createdAt) || null,
      }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return jsonRes(200, { passwords, allTools: NOTES_TOOLS });
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonRes(400, { error: "Invalid request." }); }

  if (request.method === "POST") {
    const label = (body.label ?? "").trim();
    const password = (body.password ?? "").trim();
    const tools = Array.isArray(body.tools) ? body.tools.filter((t) => NOTES_TOOLS.includes(t)) : [];
    if (!password) return jsonRes(400, { error: "A password is required." });
    if (tools.length === 0) return jsonRes(400, { error: "Select at least one tool this password can use." });
    if (password === secret) return jsonRes(409, { error: "That is the admin password - pick a different one." });
    if (await findPassword(kv, password)) return jsonRes(409, { error: "That password already exists." });
    const id = crypto.randomUUID();
    const metadata = { label, hash: await sha256Hex(password), active: true, tools, createdAt: new Date().toISOString() };
    await kv.put("pw:" + id, "1", { metadata });
    await kv.put("h:" + metadata.hash, id); // hash→id index for instant login
    return jsonRes(200, { id, label, active: true, tools, createdAt: metadata.createdAt });
  }

  if (request.method === "PATCH") {
    const id = (body.id ?? "").trim();
    const { metadata } = await kv.getWithMetadata("pw:" + id);
    if (!metadata) return jsonRes(404, { error: "Password not found." });
    const updated = { ...metadata };
    if (typeof body.active === "boolean") updated.active = body.active;
    if (Array.isArray(body.tools)) {
      const t = body.tools.filter((x) => NOTES_TOOLS.includes(x));
      if (t.length === 0) return jsonRes(400, { error: "A password must allow at least one tool." });
      updated.tools = t;
    }
    await kv.put("pw:" + id, "1", { metadata: updated });
    return jsonRes(200, { id, active: !!updated.active, tools: updated.tools || [] });
  }

  if (request.method === "DELETE") {
    const id = (body.id ?? "").trim();
    const { metadata } = await kv.getWithMetadata("pw:" + id);
    await kv.delete("pw:" + id);
    if (metadata && metadata.hash) await kv.delete("h:" + metadata.hash); // drop the index too
    return jsonRes(200, { ok: true });
  }

  return jsonRes(405, { error: "Method not allowed." });
}

// Fail fast on malformed conversations before they reach the API. Limits are
// generous for the revision flow (a note session is ~10-20 turns) but block
// runaway payloads.
const MAX_CONVERSATION_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 60000;

function validateConversation(system, messages) {
  if (!system.trim()) return "system must be a non-empty string";
  if (!messages.length) return "messages must be a non-empty array";
  if (messages.length > MAX_CONVERSATION_MESSAGES) return "Conversation too long - start a fresh note.";
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return "Each message needs role user|assistant";
    if (typeof m.content !== "string" || !m.content.trim()) return "Each message needs non-empty string content";
    if (m.content.length > MAX_MESSAGE_CHARS) return "A message exceeds the size limit.";
  }
  if (messages[0].role !== "user") return "First message must be role user";
  return null;
}

// Structured output: constrains the model's answer to a JSON Schema so the note
// is serialized by the API rather than hand-typed into a string the client then
// has to parse. Rebuilt from known keys instead of passed through, so a browser
// cannot smuggle arbitrary fields into the upstream request. Returns null when
// absent or malformed; the caller treats malformed-but-present as a 400 rather
// than silently generating an unconstrained note.
const MAX_SCHEMA_CHARS = 20000;

function sanitizeOutputConfig(cfg) {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return null;
  const format = cfg.format;
  if (!format || typeof format !== "object" || Array.isArray(format)) return null;
  if (format.type !== "json_schema") return null;
  const schema = format.schema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return null;
  // Bounded so an oversized schema fails here rather than at the upstream API.
  if (JSON.stringify(schema).length > MAX_SCHEMA_CHARS) return null;
  return { format: { type: "json_schema", schema } };
}

// Multi-turn call with prompt caching. Two cache_control breakpoints: the system
// block and the last message's content block. Anthropic's servers keep the
// computed prefix for 5 minutes (refreshed on each use) and bill cache reads at
// ~0.1x input price, so replayed conversation history is not recomputed.
async function callAnthropicConversation(apiKey, system, messages, model, maxTokens, outputConfig) {
  const msgs = messages.map((m, i) =>
    i === messages.length - 1
      ? { role: m.role, content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }] }
      : { role: m.role, content: m.content }
  );
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: msgs,
      ...(outputConfig ? { output_config: outputConfig } : {}),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Anthropic API error ${response.status}: ${error?.error?.message || response.statusText}`);
  }

  return await response.json();
}

async function callAnthropicApi(apiKey, systemPrompt, userPrompt, model, maxTokens, outputConfig) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      ...(outputConfig ? { output_config: outputConfig } : {}),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Anthropic API error ${response.status}: ${error?.error?.message || response.statusText}`);
  }

  return await response.json();
}

async function callOpenAiApi(apiKey, systemPrompt, userPrompt, model, maxTokens) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`OpenAI API error ${response.status}: ${error?.error?.message || response.statusText}`);
  }

  return await response.json();
}

async function callGeminiApi(apiKey, systemPrompt, userPrompt, model, maxTokens) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`Gemini API error ${response.status}: ${error?.error?.message || response.statusText}`);
  }

  return await response.json();
}

// Returns learned stopwords/firstNames - public, no auth, generic vocabulary only.
/* ── House voice ───────────────────────────────────────────────────────
   The owning clinician's own writing style, authored locally and published to
   the API_PASSWORDS KV as markdown under voice-block:v1.

   WHY IT LIVES IN KV AND NOT IN THIS FILE
   This repo is public. The voice rules are personal and are derived from his
   own writing, so keeping them out of source is the point of the exercise.
   Composing them here rather than in the browser means they are never served
   to a client either - only the model ever sees them.

   WHAT IT MAY AND MAY NOT DO
   Style only. It never changes clinical content, never overrides a payer or
   regulatory requirement, and never licenses inventing a particular that was
   not supplied. The header below states that to the model, and the block is
   appended AFTER the tool's own system prompt so the clinical instructions are
   read first and win any conflict.

   toolRegister IS AN ALLOWLIST. A tool absent from it gets no voice block at
   all. That is how the BT note tool stays out: those notes are written for the
   technician who signs them and already carry that technician's own learned
   style card, and stacking a second voice on them would be wrong.

   FAILS OPEN. Missing key, malformed JSON, unbound KV, or enabled:false all
   yield exactly the prompt that shipped before any of this existed. */
/* WHICH TOOLS RECEIVE THE HOUSE VOICE, and why the one that does not.
 *
 * The mapping itself lives in KV, off in the block, which means a tool added to
 * NOTES_TOOLS can miss the voice entirely and nothing here would say so. That
 * already nearly happened: `bt` is excluded on purpose, but nothing in this repo
 * recorded that it was a decision rather than an oversight.
 *
 * So the decision is declared here and pinned by a test. Adding a tool without
 * an entry fails that test, which forces the question to be answered rather than
 * defaulted. "kv" means the block's own toolRegister decides the register; a
 * string means excluded, and the string is the reason. */
const VOICE_COVERAGE = {
  sap: "kv",
  sup: "kv",
  parent: "kv",
  assess: "kv",
  // Split on his ruling of 2026-08-04, rather than excluded whole. The stances
  // and the cited obligations reach BT because how a person is described and
  // what the ethics code requires belong to the practice; his voice card and his
  // discretionary calls do not, because the technician signs the note.
  bt: "kv",
};

const VOICE_KV_KEY = "voice-block:v1";

const VOICE_HEADER = [
  "HOUSE VOICE - style only.",
  "This describes how the clinician who owns this tool writes. Match the register.",
  "It does not change clinical content, does not override a payer or regulatory",
  "requirement, and never licenses inventing a detail that was not provided.",
  "Where it conflicts with anything above, what is above wins.",
].join("\n");

async function getVoiceBlock(env) {
  if (!env.API_PASSWORDS) return null;
  try {
    // cacheTtl bounds how long a republish takes to land. It also keeps the
    // composed system prompt byte-stable across the turns of one conversation,
    // which is what the Anthropic prompt cache needs to keep hitting.
    const raw = await env.API_PASSWORDS.get(VOICE_KV_KEY, { cacheTtl: 300 });
    if (!raw) return null;
    const block = JSON.parse(raw);
    return block && block.enabled === true ? block : null;
  } catch {
    return null;
  }
}

/* STANCES ride here rather than with the opinions, on his ruling of 2026-08-04:
   "always on, as framing, never as a recommendation." A stance is a commitment
   about how behaviour works and how a person is described, so gating it behind
   want_opinions would leave it silent in every document that is not asking for
   advice, which is every document. It governs description only and is told so
   explicitly, because the one way this goes wrong is a stance turning into a
   clinical recommendation nobody asked for. */
const STANCE_HEADER = [
  "HOW HE DESCRIBES PEOPLE - framing, not advice.",
  "These are standing commitments of the clinician who owns this tool. They",
  "change the words used to describe a person and why they did something. They",
  "never produce a recommendation, never add or soften a clinical fact, and never",
  "override the input or anything above.",
].join("\n");

/* An OBLIGATION is what his field requires of him, not what he prefers. He drew
   the distinction himself: "Even if it didn't [align with my personal ethics], I
   would defer to the ethics code because to not do so risks my credential and
   license." Attributing an ethics-code requirement to him personally would
   understate it, inviting a reader to weigh it against his judgement when it is
   not negotiable, so these cite the standard and never the clinician. They are
   also the one category the input does not overrule. */
const OBLIGATION_HEADER = [
  "PROFESSIONAL REQUIREMENTS - not preferences, and not negotiable.",
  "These come from the ethics code that governs this clinician's licence. Cite",
  "the standard, never the clinician, and never present one as a personal view.",
  "Unlike everything above, the input does not overrule these: where the input",
  "falls short of one, say so as a gap in the record rather than writing around",
  "it. Do not extend one beyond its stated scope.",
].join("\n");

export { VOICE_COVERAGE };

/* Which layers a tool takes. Absent means all of them, which keeps every
   existing tool behaving exactly as before.

   BT is the reason this exists. His ruling of 2026-08-04 split it rather than
   including or excluding it whole: "give bt the stances and obligations but not
   the voice card or the calls." A BT note is written for and signed by the
   technician, so his sentence habits and his discretionary calls do not belong
   in it - but how a person is described, and what the ethics code requires,
   belong to the practice rather than to whoever holds the pen. BT also draws its
   obligations from the RBT code rather than the analyst code, which the block
   handles by giving it its own register. */
function layersFor(block, tool) {
  const l = block.toolLayers && block.toolLayers[tool];
  return Array.isArray(l) ? l : ["core", "register", "stances", "obligations", "opinions"];
}

export function composeVoice(system, block, tool) {
  if (typeof system !== "string" || !block || !tool) return system;
  const register = block.toolRegister && block.toolRegister[tool];
  if (!register) return system; // allowlist: unlisted tools get nothing
  const layers = layersFor(block, tool);
  const parts = [
    layers.includes("core") ? block.core : null,
    layers.includes("register") ? (block.registers || {})[register] : null,
  ].filter((p) => typeof p === "string" && p.trim());
  const stance = layers.includes("stances") ? (block.stances || {})[register] : null;
  const obligation = layers.includes("obligations") ? (block.obligations || {})[register] : null;
  const has = (v) => typeof v === "string" && v.trim();
  if (!parts.length && !has(stance) && !has(obligation)) return system;
  let out = parts.length ? `${system}\n\n${VOICE_HEADER}\n\n${parts.join("\n\n")}` : system;
  if (has(stance)) out = `${out}\n\n${STANCE_HEADER}\n\n${stance}`;
  // Obligations ride here too, and for the same reason as stances: a
  // professional requirement that only surfaced when a tool asked for advice
  // would be absent from every document that has to satisfy it. Unlike an
  // opinion it is never his preference and is never overruled by the input.
  if (has(obligation)) out = `${out}\n\n${OBLIGATION_HEADER}\n\n${obligation}`;
  return out;
}

/* ── The opinions block ───────────────────────────────────────────────────────

   The voice block governs HOW something is written. This governs WHAT he would
   decide where the data does not decide it, so it is gated far harder.

   His rulings, 2026-08-04:
     1  MARKED BY STRENGTH. `preference` is flagged in the output as his
        preference. `default` and `firm` read as ordinary clinical statements.
     2  FIRES ONLY WHEN ASKED. The caller must set want_opinions. An opinion
        never fills a silence in the input, and no tool gets it by default.
     3  THE INPUT WINS, AND HE IS TOLD. On a conflict the document follows the
        input and the model says which opinion it set aside and why.

   Ruling 2 is why this can carry ruling 3's notice at all: a call that asks for
   a recommendation is already advisory, so the notice has somewhere to go
   without touching any tool's JSON schema.

   Only `call` records reach the published block. Stances - his commitments about
   how behaviour works - are stored locally and excluded, because an always-on
   framing instruction is a far larger change than a gated recommendation and he
   has not ruled on it. */
const OPINIONS_HEADER = [
  "HIS CLINICAL JUDGEMENT - discretionary calls only.",
  "Each entry below is a choice this clinician tends to make where several options",
  "are defensible. None of it is a finding, and none of it is evidence.",
  "",
  "1. SCOPE IS BINDING. An entry applies only inside its stated scope. Do not",
  "   generalise it to a neighbouring population, setting, or behaviour.",
  "2. NEVER INVENT A REASON. Use the reason quoted in the entry, or give none.",
  "   Do not supply a clinical rationale the entry does not carry.",
  "3. THE INPUT WINS. Where the input contradicts an entry, follow the input,",
  "   leave the entry out of the document, and state plainly which entry you set",
  "   aside and what in the input overruled it.",
  "4. MARKING. An entry marked `preference` must be attributed to him in the",
  "   output as his preference. `default` and `firm` entries need no attribution.",
  "5. This never overrides the input, a payer or regulatory requirement, or",
  "   anything above. It never licenses inventing a detail that was not provided.",
].join("\n");

export function composeOpinions(system, block, tool, opts) {
  if (typeof system !== "string" || !block || !tool) return system;
  // Ruling 2: an opinion never fills silence. Absent an explicit request, this
  // is a no-op, which is also the behaviour for every tool that never adopts it.
  if (!opts || opts.wantsRecommendation !== true) return system;
  const register = block.toolRegister && block.toolRegister[tool];
  if (!register) return system; // same allowlist as the voice block
  // A tool can be on the allowlist and still take no opinions: BT does.
  if (!layersFor(block, tool).includes("opinions")) return system;
  const entries = (block.opinions || {})[register];
  if (typeof entries !== "string" || !entries.trim()) return system;
  return `${system}\n\n${OPINIONS_HEADER}\n\n${entries}`;
}

// Admin-only, read-only: check what is live without reaching for wrangler.
// Publishing goes through `wrangler kv key put`, so this Worker has no write
// path to its own voice.
async function handleVoiceBlockRead(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const payload = secret ? await readToken(auth.replace(/^Bearer\s+/i, ""), secret) : null;
  if (!payload || payload.role !== "admin") return jsonRes(401, { error: "Admin access required." });
  if (!env.API_PASSWORDS) return jsonRes(503, { error: "Storage not configured." });
  const raw = await env.API_PASSWORDS.get(VOICE_KV_KEY);
  if (!raw) return jsonRes(200, { present: false });
  try {
    const block = JSON.parse(raw);
    return jsonRes(200, {
      present: true,
      enabled: block.enabled === true,
      version: block.version ?? null,
      updatedAt: block.updatedAt ?? null,
      registers: Object.keys(block.registers || {}),
      toolRegister: block.toolRegister || {},
      coreWords: (block.core || "").split(/\s+/).filter(Boolean).length,
    });
  } catch {
    return jsonRes(500, { present: true, error: "Stored voice block is not valid JSON." });
  }
}

async function handleScrubConfig(request, env) {
  if (!env.API_PASSWORDS) return jsonRes(200, { stopwords: [], firstNames: [] });
  const raw = await env.API_PASSWORDS.get("scrub-overrides:v1");
  const data = raw ? JSON.parse(raw) : {};
  return jsonRes(200, { stopwords: data.stopwords || [], firstNames: data.firstNames || [] });
}

// Admin-only: manage the problem-strings queue fed to the nightly learning run.
async function handleScrubLearn(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const payload = secret ? await readToken(token, secret) : null;
  if (!payload || payload.role !== "admin") return jsonRes(401, { error: "Admin access required." });
  if (!env.API_PASSWORDS) return jsonRes(503, { error: "Storage not configured." });
  const kv = env.API_PASSWORDS;
  const KV_KEY = "scrub-learn:v1";

  if (request.method === "GET") {
    const raw = await kv.get(KV_KEY);
    return jsonRes(200, { items: raw ? JSON.parse(raw) : [] });
  }
  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonRes(400, { error: "Invalid body." }); }
    const text = (body.text ?? "").trim();
    if (!text) return jsonRes(400, { error: "text is required." });
    const raw = await kv.get(KV_KEY);
    const items = raw ? JSON.parse(raw) : [];
    items.push({ text, submittedAt: new Date().toISOString() });
    await kv.put(KV_KEY, JSON.stringify(items));
    return jsonRes(200, { ok: true, count: items.length });
  }
  if (request.method === "DELETE") {
    await kv.put(KV_KEY, JSON.stringify([]));
    return jsonRes(200, { ok: true });
  }
  return jsonRes(405, { error: "Method not allowed." });
}

// Admin-only: view current scrub overrides state (last run, digest, word counts).
async function handleScrubOverrides(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const payload = secret ? await readToken(token, secret) : null;
  if (!payload || payload.role !== "admin") return jsonRes(401, { error: "Admin access required." });
  if (!env.API_PASSWORDS) return jsonRes(503, { error: "Storage not configured." });
  const raw = await env.API_PASSWORDS.get("scrub-overrides:v1");
  const data = raw ? JSON.parse(raw) : { stopwords: [], firstNames: [], lastRun: null, digest: null };
  const sugRaw = await env.API_PASSWORDS.get("scrub-suggestions:v1");
  const pending = sugRaw ? JSON.parse(sugRaw) : [];
  return jsonRes(200, { ...data, pending: pending.length });
}

// Admin-only review queue. The nightly run only ever PROPOSES stopwords (never removes
// names, never weakens detection); a human approves each one here before it goes live.
async function handleScrubSuggestions(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const payload = secret ? await readToken(token, secret) : null;
  if (!payload || payload.role !== "admin") return jsonRes(401, { error: "Admin access required." });
  if (!env.API_PASSWORDS) return jsonRes(503, { error: "Storage not configured." });
  const kv = env.API_PASSWORDS;
  const SUG_KEY = "scrub-suggestions:v1";

  if (request.method === "GET") {
    const raw = await kv.get(SUG_KEY);
    return jsonRes(200, { suggestions: raw ? JSON.parse(raw) : [] });
  }

  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonRes(400, { error: "Invalid body." }); }
    const id = body.id;
    const decision = body.decision;
    if (!id || (decision !== "approve" && decision !== "reject")) {
      return jsonRes(400, { error: "id and decision (approve|reject) are required." });
    }
    const raw = await kv.get(SUG_KEY);
    const suggestions = raw ? JSON.parse(raw) : [];
    const match = suggestions.find((s) => s.id === id);
    if (!match) return jsonRes(404, { error: "Suggestion not found." });

    if (decision === "approve") {
      // Promote the term into the live stopword list the client reads via /api/scrub-config.
      const ovRaw = await kv.get("scrub-overrides:v1");
      const ov = ovRaw ? JSON.parse(ovRaw) : { stopwords: [], firstNames: [] };
      const term = (match.term || "").toLowerCase().trim();
      const stopwords = Array.from(new Set([...(ov.stopwords || []), term].filter(Boolean)));
      await kv.put("scrub-overrides:v1", JSON.stringify({ ...ov, stopwords }));
    }
    // Both approve and reject remove the suggestion from the queue.
    await kv.put(SUG_KEY, JSON.stringify(suggestions.filter((s) => s.id !== id)));
    return jsonRes(200, { ok: true });
  }

  return jsonRes(405, { error: "Method not allowed." });
}

// Trigger the learning run. Accepts an admin login token (manual button) OR the
// CRON_SECRET shared secret (the scheduled GitHub Action, which can't log in).
async function handleScrubRun(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const cronSecret = (env.CRON_SECRET ?? "").trim();
  const adminSecret = (env.ADMIN_SECRET ?? "").trim();
  const isCron = cronSecret && timingSafeEqual(token, cronSecret);
  const payload = adminSecret ? await readToken(token, adminSecret) : null;
  const isAdmin = payload && payload.role === "admin";
  if (!isCron && !isAdmin) return jsonRes(401, { error: "Admin or cron authorization required." });
  await runScrubLearning(env);
  return jsonRes(200, { ok: true });
}

// Constant-time string comparison to avoid leaking the secret via timing.
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Normalize a candidate term to a single lowercase word (letters, apostrophe, hyphen),
// capped at 40 chars. Returns "" if nothing usable remains. Keeps stored terms as bare
// name-vocabulary - no surrounding context ever survives this.
function normalizeTerm(raw) {
  if (typeof raw !== "string") return "";
  const first = raw.trim().split(/\s+/)[0] || "";
  return first.toLowerCase().replace(/[^a-z'-]/g, "").slice(0, 40);
}

// Add terms to a pending review queue, deduped by term. A repeat bumps count/lastSeen
// instead of adding a row, so the queue stays a vocabulary set, not an event log.
async function enqueueTerms(kv, key, terms, source) {
  const raw = await kv.get(key);
  const list = raw ? JSON.parse(raw) : [];
  const now = new Date().toISOString();
  const index = new Map(list.map((e) => [e.term, e]));
  for (const term of terms) {
    if (!term) continue;
    const existing = index.get(term);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.lastSeen = now;
    } else {
      const entry = { term, source, count: 1, firstSeen: now, lastSeen: now };
      list.push(entry);
      index.set(term, entry);
    }
  }
  await kv.put(key, JSON.stringify(list));
}

// Commit a term to the appropriate LIVE list. "pii" -> force-detect (firstNames in
// scrub-overrides, synced to clients via /api/scrub-config). "nonpii" -> the detection
// exclusion whitelist (nonpii:v1).
async function commitTerm(kv, list, term) {
  if (list === "pii") {
    const ovRaw = await kv.get("scrub-overrides:v1");
    const ov = ovRaw ? JSON.parse(ovRaw) : { stopwords: [], firstNames: [] };
    const firstNames = Array.from(new Set([...(ov.firstNames || []), term].filter(Boolean)));
    await kv.put("scrub-overrides:v1", JSON.stringify({ ...ov, firstNames }));
  } else {
    const raw = await kv.get("nonpii:v1");
    const terms = raw ? JSON.parse(raw) : [];
    if (!terms.some((e) => e.term === term)) {
      terms.push({ term, certifiedAt: new Date().toISOString() });
      await kv.put("nonpii:v1", JSON.stringify(terms));
    }
  }
}

// Remove a term from the appropriate LIVE list (admin pruning a bad entry).
async function removeTerm(kv, list, term) {
  if (list === "pii") {
    const ovRaw = await kv.get("scrub-overrides:v1");
    const ov = ovRaw ? JSON.parse(ovRaw) : { stopwords: [], firstNames: [] };
    const firstNames = (ov.firstNames || []).filter((t) => t !== term);
    await kv.put("scrub-overrides:v1", JSON.stringify({ ...ov, firstNames }));
  } else {
    const raw = await kv.get("nonpii:v1");
    const terms = raw ? JSON.parse(raw) : [];
    await kv.put("nonpii:v1", JSON.stringify(terms.filter((e) => e.term !== term)));
  }
}

// Any authenticated user: silently enqueue bare scrubbed words into the PII review queue.
// The client only sends words NOT already in its FIRST_NAMES dictionary, and never any
// surrounding text - this is PHI-safe name-vocabulary capture, nothing more.
/* ── Audit / usage events ──────────────────────────────────────────
   Content-free by construction, and re-validated HERE rather than trusted from
   the browser: a modified client must not be able to turn an append-only audit
   log into a place where note text ends up on a server.

   The allowlist is the control. Event type must match a known name, and every
   data value is coerced to a number, a boolean, or a short token-shaped string
   - a sentence cannot survive that, whatever the client sends.

   Stored per technician (`kid` from the session token, which is the login code's
   identity) so a supervisor can see engagement over time. 400-day TTL: long
   enough to be a record, bounded so it cannot accumulate forever. */

const AUDIT_TYPES = new Set([
  "note_generated",
  "gap_questions",
  "revision",
  "note_copied",
]);

function sanitizeAuditEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.type !== "string" || !AUDIT_TYPES.has(raw.type)) return null;
  const tool = typeof raw.tool === "string" && /^[a-z0-9_-]{1,16}$/.test(raw.tool) ? raw.tool : null;
  const ts = Number.isFinite(raw.ts) ? Math.round(raw.ts) : Date.now();
  const data = {};
  const src = raw.data && typeof raw.data === "object" ? raw.data : {};
  for (const k of Object.keys(src).slice(0, 12)) {
    if (!/^[a-z][a-z0-9_]{0,23}$/i.test(k)) continue;
    const v = src[k];
    if (typeof v === "number" && Number.isFinite(v)) data[k] = Math.round(v);
    else if (typeof v === "boolean") data[k] = v;
    else if (typeof v === "string" && /^[a-z0-9_-]{1,24}$/i.test(v)) data[k] = v;
    // Anything else - objects, arrays, prose - is dropped, not stringified.
  }
  return { type: raw.type, tool, ts, data };
}

async function handleAudit(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const payload = secret ? await readToken(token, secret) : null;
  if (!payload) return jsonRes(401, { error: "Not logged in." });

  let body;
  try { body = await request.json(); } catch { return jsonRes(400, { error: "Invalid JSON." }); }
  const incoming = Array.isArray(body?.events) ? body.events.slice(0, 50) : [];
  const events = incoming.map(sanitizeAuditEvent).filter(Boolean);
  const incomingCorr = Array.isArray(body?.corrections) ? body.corrections.slice(0, 50) : [];
  const corrections = incomingCorr.map(sanitizeCorrection).filter(Boolean);
  // Same response shape whether or not there was anything to do, so a caller
  // never has to distinguish "zero accepted" from "key absent".
  if (!events.length && !corrections.length) {
    return jsonRes(200, { stored: 0, corrections: 0, profile: "skipped" });
  }

  // Audit events need KV; corrections do not - they go to the profile store.
  // Refusing the whole request when KV is unbound would couple style learning
  // to a dependency it does not have.
  if (events.length && !env.API_PASSWORDS) {
    return jsonRes(503, { error: "Storage not configured." });
  }

  // The login code IS the technician identity; admin sessions have no kid.
  const kid = typeof payload.kid === "string" ? payload.kid : "admin";

  // KV stays the durable trail. It is the compliance artifact, it already
  // works, and it must not start depending on a service that did not exist
  // yesterday - so it is written first and its success is what we report.
  if (events.length) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await env.API_PASSWORDS.put(
      `audit:${kid}:${stamp}`,
      JSON.stringify({ kid, role: payload.role || null, events }),
      { expirationTtl: 60 * 60 * 24 * 400 },
    );
  }

  // Style learning is an enhancement, so this is best-effort by design: if the
  // profile app is down or unbound, the technician still gets their note and
  // the audit record is still safe in KV.
  const forwarded = await profileFetch(env, "/events", {
    kid,
    tool: events[0]?.tool || null,
    corrections,
    metrics: events.map((e) => ({ type: e.type, ts: e.ts, data: e.data })),
  });

  return jsonRes(200, {
    stored: events.length,
    corrections: corrections.length,
    profile: forwarded ? "ok" : "skipped",
  });
}

/**
 * A correction is a measurement of a diff, never the diff itself. The browser
 * sends a feature name and a direction; the words that changed never leave the
 * page.
 *
 * The authoritative check on which features exist lives in the profile Worker
 * (src/features.js) - duplicating that list here would mean two copies to keep
 * in step across two deployables with no shared module. This is the boundary
 * check: right shape, sane range, nothing that could carry prose.
 */
function sanitizeCorrection(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.feature !== "string" || !/^[a-z][a-z0-9_]{0,31}$/.test(raw.feature)) return null;

  const direction = raw.direction > 0 ? 1 : raw.direction < 0 ? -1 : 0;
  if (direction === 0) return null;

  return {
    feature: raw.feature,
    direction,
    source: raw.source === "manual" ? "manual" : "revision",
    magnitude: Number.isFinite(raw.magnitude) ? Math.max(0, Math.min(1, raw.magnitude)) : 1,
    ts: Number.isFinite(raw.ts) ? Math.round(raw.ts) : Date.now(),
  };
}

/**
 * Call the profile Worker over its service binding.
 *
 * FAILS OPEN, ALWAYS. Every caller treats null as "no profile today" and
 * carries on: a note still generates, an audit record is still kept. The
 * binding is absent entirely until the Worker is deployed and bound, so the
 * unbound case is the normal one during rollout, not an error worth logging
 * loudly.
 *
 * The 1.5s cap matters because two of these sit in front of a clinician waiting
 * on a note. A slow profile store must never become a slow note.
 */
const PROFILE_TIMEOUT_MS = 1500;

async function profileFetch(env, path, body, method = "POST", diag = null) {
  const note = (reason) => { if (diag) diag.reason = reason; };
  if (!env.PROFILE) { note("unbound"); return null; }
  try {
    const init = {
      method,
      signal: AbortSignal.timeout(PROFILE_TIMEOUT_MS),
      headers: { "Content-Type": "application/json" },
    };
    if (method !== "GET") init.body = JSON.stringify(body || {});

    const res = await env.PROFILE.fetch(`https://profile.internal${path}`, init);
    if (!res.ok) { note("status_" + res.status); return null; }
    note("ok");
    return await res.json();
  } catch (err) {
    // Timeouts are expected under load and are not incidents. Never log the
    // body - it is the one field that could carry something it should not.
    note(String((err && err.name) || "error"));
    console.error("profile-api unreachable", path, err && err.name);
    return null;
  }
}

/**
 * The technician's own card. A session token is scoped to one login code, so a
 * technician can only ever ask for their own - `kid` comes from the verified
 * token, never from the query string.
 */
async function handleStyleCard(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const payload = secret ? await readToken(auth.replace(/^Bearer\s+/i, ""), secret) : null;
  if (!payload) return jsonRes(401, { error: "Not logged in." });

  const kid = typeof payload.kid === "string" ? payload.kid : null;
  if (!kid) return jsonRes(200, { rules: [], block: "", available: false });

  /* tool and seed decide the sentence shape target. The seed must be stable for
     one note and different across notes: stable so a revision replays the same
     prompt prefix and stays inside the cache, different so a hundred notes do
     not all land on one target. The browser supplies it. */
  const tool = String(new URL(request.url).searchParams.get("tool") || "").slice(0, 24);
  const seed = String(new URL(request.url).searchParams.get("seed") || "").slice(0, 64);
  const qs = `/style-card?kid=${encodeURIComponent(kid)}`
    + (tool ? `&tool=${encodeURIComponent(tool)}` : "")
    + (seed ? `&seed=${encodeURIComponent(seed)}` : "");

  const card = await profileFetch(env, qs, null, "GET");
  if (!card) return jsonRes(200, { rules: [], block: "", shapeBlock: "", available: false });

  return jsonRes(200, {
    rules: card.rules || [],
    block: card.block || "",
    shapeBlock: card.shapeBlock || "",
    available: true,
  });
}

/**
 * Cohort-level view of what the tool has learned, for deciding whether the
 * house prompt should move. Admin only, and the profile app returns no `kid`
 * from any row, so this cannot be turned into a per-technician report even by
 * an admin. That is the intended limit, not an oversight -- a technician who
 * knows their supervisor reads their style card uses the tool differently.
 */
async function handleStyleInsights(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const payload = secret ? await readToken(auth.replace(/^Bearer\s+/i, ""), secret) : null;
  if (!payload || payload.role !== "admin") {
    return jsonRes(401, { error: "Admin access required." });
  }

  // `available: false` used to mean three different things - no binding, a
  // Worker that answered with an error, a Worker that never answered - and
  // collapsing them cost a day of guessing at which one it was. `reason` is a
  // fixed word from a closed set, carries no data, and is admin-only.
  const diag = { reason: "unknown" };
  const data = await profileFetch(env, "/insights", null, "GET", diag);
  if (!data) {
    return jsonRes(200, {
      available: false, reason: diag.reason, features: [], cohort: { technicians: 0, notes: 0 },
    });
  }
  return jsonRes(200, { available: true, reason: "ok", ...data });
}

/**
 * Supervisor view of individual technician profiles.
 *
 * The first design hid individual cards from BCBAs entirely, reasoning that a
 * technician who knows their supervisor reads their card uses the tool
 * differently. That was overruled on 2026-08-04: the heuristics about staff
 * have to be visible over time, and a rule that is out of line with company or
 * best practice policy has to be removable. Removal is silent and reviewed in
 * supervision rather than announced by the tool.
 *
 * Four routes behind one admin check, because four copies of the same six lines
 * is four chances to leave one of them out:
 *
 *   GET  /api/admin/profile/roster        everyone the store knows about
 *   GET  /api/admin/profile/card?kid=     one card, including muted and removed
 *   GET  /api/admin/profile/history?kid=  how that card moved, replayed
 *   POST /api/admin/profile/suppress      remove a rule, or put it back
 *
 * Still content-free end to end. These read the same numeric columns as
 * everything else; there is no note text in the store to expose.
 */
const PROFILE_ADMIN_ROUTES = {
  roster:   { path: "/roster",       method: "GET" },
  card:     { path: "/card-detail",  method: "GET" },
  history:  { path: "/card-history", method: "GET" },
  suppress: { path: "/suppress",     method: "POST" },
};

async function handleProfileAdmin(request, env, url) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const payload = secret ? await readToken(auth.replace(/^Bearer\s+/i, ""), secret) : null;
  if (!payload || payload.role !== "admin") {
    return jsonRes(401, { error: "Admin access required." });
  }

  const name = url.pathname.slice("/api/admin/profile/".length);
  const route = Object.prototype.hasOwnProperty.call(PROFILE_ADMIN_ROUTES, name)
    ? PROFILE_ADMIN_ROUTES[name]
    : null;
  if (!route || route.method !== request.method) {
    return jsonRes(404, { error: "No such route." });
  }

  let path = route.path;
  let body = null;
  if (route.method === "GET") {
    // Forward only the parameters these routes take. Passing the query string
    // through wholesale would let a caller reach for anything the profile app
    // ever learns to read.
    const kid = url.searchParams.get("kid");
    const points = url.searchParams.get("points");
    const qs = new URLSearchParams();
    if (kid) qs.set("kid", kid);
    if (points) qs.set("points", points);
    if ([...qs].length) path += "?" + qs.toString();
  } else {
    try { body = await request.json(); } catch { return jsonRes(400, { error: "Invalid JSON." }); }
  }

  const diag = { reason: "unknown" };
  const data = await profileFetch(env, path, body, route.method, diag);
  if (!data) return jsonRes(503, { error: "Style profile is unavailable right now.", reason: diag.reason });
  return jsonRes(200, data);
}

/**
 * File a ticket stub as a GitHub issue.
 *
 * His ask: as an admin, feedback like "I hate that the page does this" should
 * become something he can grill into a proper dev item later, filed while he is
 * using the site rather than remembered afterwards. His answer on where: a
 * GitHub issue on nooutco-root, because that is where the work already lives.
 *
 * A STUB, and labelled as one. It is a sentence he typed at the moment he
 * noticed something, not a specification, and dressing it up as one would make
 * every issue in the tracker untrustworthy.
 *
 * NEEDS A CREDENTIAL. GITHUB_ISSUE_TOKEN must be a fine-grained token with
 * Issues: write on this repository and nothing else, set as a Pages secret.
 * Until it is, this route says so plainly rather than failing silently or
 * pretending to have filed something.
 */
const TICKET_REPO = "mgfv2r2mpv-hash/nooutco-root";

async function handleTicket(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const payload = secret ? await readToken(auth.replace(/^Bearer\s+/i, ""), secret) : null;
  if (!payload || payload.role !== "admin") {
    return jsonRes(401, { error: "Admin access required." });
  }

  let body;
  try { body = await request.json(); } catch { return jsonRes(400, { error: "Invalid JSON." }); }

  const note = String(body?.note || "").trim();
  if (note.length < 5) return jsonRes(400, { error: "Nothing to file." });

  const token = (env.GITHUB_ISSUE_TOKEN ?? "").trim();
  if (!token) {
    // Named, not swallowed. An admin who thinks they filed a ticket and did
    // not is worse off than one told the wiring is missing.
    return jsonRes(503, {
      error: "No GitHub token is configured, so nothing was filed.",
      reason: "no_issue_token",
    });
  }

  // Where they were, and what they pointed at. Both are the difference between
  // a stub worth reading in a month and "the page is doing a thing".
  const where = String(body?.where || "").trim().slice(0, 200);
  const target = String(body?.target || "").trim().slice(0, 200);
  const title = "Stub: " + note.replace(/\s+/g, " ").slice(0, 72) + (note.length > 72 ? "..." : "");

  const lines = [
    "Filed from inside the tool, in the moment. This is a STUB, not a spec.",
    "",
    "**What he said**",
    "",
    "> " + note.replace(/\n/g, "\n> "),
    "",
  ];
  if (where) lines.push("**Where** " + where);
  if (target) lines.push("**Pointed at** " + target);
  lines.push("", "Grill this before building it.");

  try {
    const res = await fetch(`https://api.github.com/repos/${TICKET_REPO}/issues`, {
      method: "POST",
      signal: AbortSignal.timeout(6000),
      headers: {
        "Authorization": "Bearer " + token,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "tools-nooutco-me",
      },
      body: JSON.stringify({ title, body: lines.join("\n"), labels: ["stub", "from-the-tool"] }),
    });
    if (!res.ok) {
      return jsonRes(502, { error: "GitHub refused it.", reason: "status_" + res.status });
    }
    const issue = await res.json();
    return jsonRes(200, { ok: true, number: issue.number, url: issue.html_url });
  } catch (err) {
    // Never log the note itself: it is the one field that could carry anything.
    console.error("ticket filing failed", err && err.name);
    return jsonRes(502, { error: "Could not reach GitHub.", reason: String((err && err.name) || "error") });
  }
}

async function handleStyleCardMute(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const payload = secret ? await readToken(auth.replace(/^Bearer\s+/i, ""), secret) : null;
  if (!payload) return jsonRes(401, { error: "Not logged in." });

  const kid = typeof payload.kid === "string" ? payload.kid : null;
  if (!kid) return jsonRes(403, { error: "This session has no technician profile." });

  let body;
  try { body = await request.json(); } catch { return jsonRes(400, { error: "Invalid JSON." }); }
  if (typeof body?.feature !== "string") return jsonRes(400, { error: "Missing feature." });

  const ok = await profileFetch(env, "/style-card/mute", {
    kid,
    feature: body.feature,
    muted: body.muted !== false,
  });
  if (!ok) return jsonRes(503, { error: "Style profile is unavailable right now." });
  return jsonRes(200, { ok: true });
}

async function handleScrubReport(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const payload = secret ? await readToken(token, secret) : null;
  if (!payload) return jsonRes(401, { error: "Login required." });
  if (!env.API_PASSWORDS) return jsonRes(503, { error: "Storage not configured." });
  let body;
  try { body = await request.json(); } catch { return jsonRes(400, { error: "Invalid body." }); }
  const input = Array.isArray(body.terms) ? body.terms : [];
  const seen = new Set();
  for (const raw of input.slice(0, 50)) {
    const term = normalizeTerm(raw);
    if (term) seen.add(term);
  }
  if (seen.size) await enqueueTerms(env.API_PASSWORDS, "pii-pending:v1", [...seen], "tech-scrub");
  return jsonRes(200, { ok: true });
}

// Admin-only: review queue for tech-submitted candidate terms.
// GET -> { piiPending, nonPiiPending }. POST { list, term, decision } approves (commit to
// live list) or rejects; either way the term leaves its pending queue.
async function handleTermQueue(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const payload = secret ? await readToken(token, secret) : null;
  if (!payload || payload.role !== "admin") return jsonRes(401, { error: "Admin access required." });
  if (!env.API_PASSWORDS) return jsonRes(503, { error: "Storage not configured." });
  const kv = env.API_PASSWORDS;
  const PII_Q = "pii-pending:v1";
  const NONPII_Q = "nonpii-pending:v1";

  if (request.method === "GET") {
    const piiPending = JSON.parse((await kv.get(PII_Q)) || "[]");
    const nonPiiPending = JSON.parse((await kv.get(NONPII_Q)) || "[]");
    return jsonRes(200, { piiPending, nonPiiPending });
  }

  if (request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonRes(400, { error: "Invalid body." }); }
    const list = body.list;
    const decision = body.decision;
    const term = normalizeTerm(body.term);
    if (!term || (list !== "pii" && list !== "nonpii") || (decision !== "approve" && decision !== "reject")) {
      return jsonRes(400, { error: "list (pii|nonpii), term, and decision (approve|reject) are required." });
    }
    const queueKey = list === "pii" ? PII_Q : NONPII_Q;
    const queue = JSON.parse((await kv.get(queueKey)) || "[]");
    await kv.put(queueKey, JSON.stringify(queue.filter((e) => e.term !== term)));
    if (decision === "approve") await commitTerm(kv, list, term);
    return jsonRes(200, { ok: true });
  }

  return jsonRes(405, { error: "Method not allowed." });
}

// Admin-only: directly curate a LIVE term. POST commits immediately (the admin is the
// approver); DELETE prunes a live term.
async function handleTerms(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const payload = secret ? await readToken(token, secret) : null;
  if (!payload || payload.role !== "admin") return jsonRes(401, { error: "Admin access required." });
  if (!env.API_PASSWORDS) return jsonRes(503, { error: "Storage not configured." });
  const kv = env.API_PASSWORDS;

  if (request.method === "POST" || request.method === "DELETE") {
    let body;
    try { body = await request.json(); } catch { return jsonRes(400, { error: "Invalid body." }); }
    const list = body.list;
    const term = normalizeTerm(body.term);
    if (!term || (list !== "pii" && list !== "nonpii")) {
      return jsonRes(400, { error: "list (pii|nonpii) and term are required." });
    }
    if (request.method === "POST") await commitTerm(kv, list, term);
    else await removeTerm(kv, list, term);
    return jsonRes(200, { ok: true });
  }

  return jsonRes(405, { error: "Method not allowed." });
}

// Weekly term digest - admin token OR CRON_SECRET (the Friday GitHub Action).
async function handleTermDigest(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const cronSecret = (env.CRON_SECRET ?? "").trim();
  const adminSecret = (env.ADMIN_SECRET ?? "").trim();
  const isCron = cronSecret && timingSafeEqual(token, cronSecret);
  const payload = adminSecret ? await readToken(token, adminSecret) : null;
  const isAdmin = payload && payload.role === "admin";
  if (!isCron && !isAdmin) return jsonRes(401, { error: "Admin or cron authorization required." });
  await sendTermDigest(env);
  return jsonRes(200, { ok: true });
}

// Email a COUNTS-ONLY summary of term-queue activity. Terms are withheld by design -
// pending PII candidates may be real names, so only aggregate counts ever leave the worker.
async function sendTermDigest(env) {
  if (!env.API_PASSWORDS) return;
  const kv = env.API_PASSWORDS;
  const piiPending = JSON.parse((await kv.get("pii-pending:v1")) || "[]");
  const nonPiiPending = JSON.parse((await kv.get("nonpii-pending:v1")) || "[]");
  const weekAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newThisWeek = (rows) =>
    rows.filter((e) => e.firstSeen && new Date(e.firstSeen).getTime() >= weekAgoMs).length;
  const piiNew = newThisWeek(piiPending);
  const nonPiiNew = newThisWeek(nonPiiPending);

  if (!env.RESEND_API_KEY || !env.SUGGEST_TO_EMAIL) return;
  const runDate = new Date().toISOString().slice(0, 10);
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.RESEND_API_KEY },
    body: JSON.stringify({
      from: "tools@nooutco.me",
      to: env.SUGGEST_TO_EMAIL,
      subject: "PHI terms - weekly review digest (" + runDate + ")",
      text: [
        "Weekly term review digest - " + runDate,
        "",
        "New submissions this week (last 7 days):",
        "  - PII candidates (names techs scrubbed): " + piiNew,
        "  - Non-PII candidates (terms techs certified): " + nonPiiNew,
        "",
        "Total awaiting your review:",
        "  - PII queue: " + piiPending.length,
        "  - Non-PII queue: " + nonPiiPending.length,
        "",
        "Counts only - the terms themselves are withheld from email by design.",
        "Review and approve/reject at:",
        "https://tools.nooutco.me/admin → PII Terms / Non-PII Terms",
      ].join("\n"),
    }),
  }).catch(() => {});
}

// Core learning logic: called by scheduled() and handleScrubRun().
// PROPOSE-ONLY by design. This is a PHI de-identification control with no BAA, so the
// only safe error direction is over-detection. The run can therefore only ever suggest
// SUPPRESSING a human-certified false positive (adding a stopword) - never removing a
// name, never weakening detection. Every suggestion is queued for human approval in the
// admin Algorithm Lab; nothing here mutates the live detection config.
async function runScrubLearning(env) {
  if (!env.API_PASSWORDS || !env.ANTHROPIC_API_KEY) return;
  const kv = env.API_PASSWORDS;

  // Today's certified non-PII terms (false positives a clinician explicitly cleared)
  const today = new Date();
  const todayMidnightMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const nonPiiRaw = await kv.get("nonpii:v1");
  const nonPiiAll = nonPiiRaw ? JSON.parse(nonPiiRaw) : [];
  const todayTerms = nonPiiAll
    .filter((e) => e.certifiedAt && new Date(e.certifiedAt).getTime() >= todayMidnightMs)
    .map((e) => e.term);

  // Admin-submitted problem strings
  const learnRaw = await kv.get("scrub-learn:v1");
  const problemStrings = learnRaw ? JSON.parse(learnRaw) : [];

  if (todayTerms.length === 0 && problemStrings.length === 0) return;

  // Vocabulary the AI is allowed to draw from (defense in depth: it cannot invent words).
  const inputVocab = new Set();
  todayTerms.forEach((t) => inputVocab.add(String(t).toLowerCase().trim()));
  problemStrings.forEach((p) => String(p.text || "").split(/\s+/).forEach((w) => {
    const clean = w.replace(/[^A-Za-z'\-]/g, "").toLowerCase().trim();
    if (clean) inputVocab.add(clean);
  }));

  const systemPrompt = [
    "You review terms flagged by a client-side PHI name-detection algorithm used in ABA clinical notes tools.",
    "Your ONLY job is to decide which human-certified non-PII terms are safe to suppress globally by adding them to a STOPWORDS list (always-skip).",
    "Suggest a term ONLY if it is unmistakably common English or ABA clinical vocabulary that could never be a person's name.",
    "If a term could plausibly be anyone's first or last name - including uncommon, nickname, or international names like Raphael or Raphy - DO NOT suggest it; leave it flagged.",
    "You may never remove names or weaken detection; a human reviews every suggestion before it takes effect. When in doubt, suggest nothing.",
  ].join(" ");

  const userPrompt = [
    "Certified-not-PHI terms (a clinician flagged these as NOT person names):",
    todayTerms.length ? todayTerms.map((t) => "  - " + t).join("\n") : "  (none today)",
    "",
    "Admin problem strings (examples where detection went wrong):",
    problemStrings.length ? problemStrings.map((p) => "  - " + p.text).join("\n") : "  (none today)",
    "",
    'Return ONLY valid JSON (no markdown): {"suggestions":[{"term":"word","reason":"why it is safe to suppress","confidence":"high|medium|low"}],"digest":"1-2 sentence summary"}',
  ].join("\n");

  let result;
  try {
    const apiResp = await callAnthropicApi(env.ANTHROPIC_API_KEY, systemPrompt, userPrompt, "claude-haiku-4-5-20251001", 512);
    const content = apiResp?.content?.[0]?.text ?? "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    result = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (e) {
    if (env.RESEND_API_KEY && env.SUGGEST_TO_EMAIL) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.RESEND_API_KEY },
        body: JSON.stringify({
          from: "tools@nooutco.me", to: env.SUGGEST_TO_EMAIL,
          subject: "PHI scrub run failed - " + new Date().toISOString().slice(0, 10),
          text: "Nightly scrub learning run failed: " + (e.message || String(e)),
        }),
      }).catch(() => {});
    }
    return;
  }

  if (!result) return;

  // Load existing queue + already-approved stopwords to dedupe against.
  const sugRaw = await kv.get("scrub-suggestions:v1");
  const queue = sugRaw ? JSON.parse(sugRaw) : [];
  const ovRaw = await kv.get("scrub-overrides:v1");
  const ov = ovRaw ? JSON.parse(ovRaw) : { stopwords: [], firstNames: [] };
  const approvedStopwords = new Set((ov.stopwords || []).map((w) => String(w).toLowerCase()));
  const queuedTerms = new Set(queue.map((s) => String(s.term).toLowerCase()));

  // Accept only terms that (a) the AI returned, (b) appeared in today's input vocab,
  // (c) aren't already approved or queued. This is the hard guardrail.
  const fresh = [];
  (result.suggestions || []).forEach((s) => {
    const term = String(s.term || "").toLowerCase().trim();
    if (!term || !inputVocab.has(term)) return;
    if (approvedStopwords.has(term) || queuedTerms.has(term)) return;
    queuedTerms.add(term);
    fresh.push({
      id: crypto.randomUUID(),
      term,
      reason: String(s.reason || "").slice(0, 300),
      confidence: ["high", "medium", "low"].includes(s.confidence) ? s.confidence : "low",
      proposedAt: new Date().toISOString(),
    });
  });

  const runDate = new Date().toISOString().slice(0, 10);
  await kv.put("scrub-suggestions:v1", JSON.stringify([...queue, ...fresh]));
  // Record the run on the overrides object (last run + digest) without touching live config.
  await kv.put("scrub-overrides:v1", JSON.stringify({
    stopwords: ov.stopwords || [],
    firstNames: ov.firstNames || [],
    lastRun: new Date().toISOString(),
    digest: result.digest || "",
  }));

  // Clear problem strings queue after processing.
  await kv.put("scrub-learn:v1", JSON.stringify([]));

  // Send a review digest - suggestions are pending, NOT applied.
  if (env.RESEND_API_KEY && env.SUGGEST_TO_EMAIL) {
    const lines = fresh.length
      ? fresh.map((s) => "  - " + s.term + " - " + s.reason + " (" + s.confidence + ")")
      : ["  (no new suggestions)"];
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.RESEND_API_KEY },
      body: JSON.stringify({
        from: "tools@nooutco.me", to: env.SUGGEST_TO_EMAIL,
        subject: "PHI scrub - " + fresh.length + " suggestion" + (fresh.length === 1 ? "" : "s") + " awaiting review",
        text: [
          "PHI scrub review digest - " + runDate,
          "",
          result.digest || "",
          "",
          "These are SUGGESTIONS only - nothing has changed in detection. Approve or reject each at:",
          "https://tools.nooutco.me/admin → Algorithm Lab",
          "",
          "Proposed stopwords (" + fresh.length + "):",
          ...lines,
          "",
          "Input: " + todayTerms.length + " certified terms, " + problemStrings.length + " problem strings",
        ].join("\n"),
      }),
    }).catch(() => {});
  }
}
