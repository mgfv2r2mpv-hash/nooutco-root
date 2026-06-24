// Notes tools that can be scoped to a managed password.
const NOTES_TOOLS = ["bt", "sup", "parent", "assess", "sap"];

// Old URL → new URL prefix mapping (specific paths before their parent prefix)
const LEGACY_PREFIXES = [
  ['/NoteDrafter/BTNotes',       '/notes/bt/'],
  ['/NoteDrafter/SupNotes',      '/notes/sup/'],
  ['/NoteDrafter/PTNotes',       '/notes/parent/'],
  ['/NoteDrafter/AssessNotes',   '/notes/assess/'],
  ['/NoteDrafter/SAPGoalsDrafter', '/notes/sap/'],
  ['/NoteDrafter',               '/notes/'],
  ['/SessionFlow',               '/session-flow/'],
  ['/CPRAnalyzer',               '/cpr/'],
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Password login — returns a signed session token that unlocks Generate Note
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

    if (url.pathname === "/api/suggest" && request.method === "POST") {
      return handleSuggest(request, env);
    }

    // Public endpoint — returns learned stopwords/firstNames (generic vocab, not PHI)
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

    // Admin-only: review queue — list pending AI suggestions, approve/reject
    if (url.pathname === "/api/admin/scrub-suggestions") {
      return handleScrubSuggestions(request, env);
    }

    // Trigger the learning run — admin token OR CRON_SECRET (for the scheduled GitHub Action)
    if (url.pathname === "/api/admin/scrub-run" && request.method === "POST") {
      return handleScrubRun(request, env);
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

    const headers = new Headers(response.headers);
    headers.delete("content-length");

    return new Response(html, { status: response.status, headers });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScrubLearning(env));
  },
};

async function handleErrorReport(request, env) {
  const secret = (env.ADMIN_SECRET ?? "").trim();
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!secret || !(await verifyToken(token, secret))) {
    return jsonRes(401, { error: "Unauthorized." });
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonRes(400, { error: "Invalid request." }); }

  const { message, tool, timestamp } = body;
  if (!message) return jsonRes(400, { error: "Missing message." });

  if (!env.RESEND_API_KEY) return jsonRes(200, { ok: true });

  const toEmail = env.SUGGEST_TO_EMAIL || "feedback@nooutco.me";
  const subject = `[Error] ${tool || "notes"} — ${(message || "").slice(0, 60)}`;
  const text = [
    `Tool: ${tool || "(unknown)"}`,
    `Time: ${timestamp || new Date().toISOString()}`,
    ``,
    `Error:`,
    message,
  ].join("\n");

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: "No Outcome ABA <noreply@nooutco.me>", to: [toEmail], subject, text }),
  });

  return jsonRes(200, { ok: true });
}

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
    role           ? `From a: ${role}`                      : null,
    (summary || "").trim() ? `Summary: ${(summary || "").trim()}` : null,
    "",
    ideaTrimmed,
    replyTo        ? `\nReply to: ${replyTo.trim()}`        : null,
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

  if (!secret) return jsonRes(503, { error: "Login is not configured." });
  if (!password) return jsonRes(401, { error: "Incorrect password." });

  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;

  // Admin password — full access including the API Passwords admin screen.
  if (password === secret) {
    const token = await signToken({ exp, role: "admin" }, secret);
    return jsonRes(200, { token, role: "admin" });
  }

  // Managed access passwords (API_PASSWORDS KV) — scoped to specific tools.
  if (env.API_PASSWORDS) {
    const rec = await findPassword(env.API_PASSWORDS, password);
    if (rec && rec.active) {
      const tools = Array.isArray(rec.tools) ? rec.tools : [];
      const token = await signToken({ exp, role: "user", kid: rec.id, tools }, secret);
      return jsonRes(200, { token, role: "user", tools });
    }
  }

  return jsonRes(401, { error: "Incorrect password." });
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
    const { systemPrompt, userPrompt, model, maxTokens, tool } = body;
    if (!systemPrompt || !userPrompt) {
      return jsonRes(400, { error: "Missing required fields: systemPrompt, userPrompt" });
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

    const llmResponse = await callAnthropicApi(
      apiKey, systemPrompt, userPrompt, model || "claude-haiku-4-5-20251001", maxTokens || 3000
    );
    return jsonRes(200, llmResponse);
  } catch (error) {
    // PRIVACY: never log the request body, systemPrompt, or userPrompt. The client
    // de-identifies (scrubs names to role tokens) before sending, and we keep it that
    // way — log only the error message, never prompt content.
    console.error("LLM call error:", error && error.message ? error.message : "unknown");
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
   admin list are both a single list() call — no per-key reads. ── */

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

// Certified-non-PII store — any authenticated user can read/add; admin can delete.
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
    const term = (body.term ?? "").toLowerCase().trim();
    if (!term) return jsonRes(400, { error: "term is required." });
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
    if (password === secret) return jsonRes(409, { error: "That is the admin password — pick a different one." });
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

async function callAnthropicApi(apiKey, systemPrompt, userPrompt, model, maxTokens) {
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

// Returns learned stopwords/firstNames — public, no auth, generic vocabulary only.
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

// Core learning logic: called by scheduled() and handleScrubRun().
// PROPOSE-ONLY by design. This is a PHI de-identification control with no BAA, so the
// only safe error direction is over-detection. The run can therefore only ever suggest
// SUPPRESSING a human-certified false positive (adding a stopword) — never removing a
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
    "If a term could plausibly be anyone's first or last name — including uncommon, nickname, or international names like Raphael or Raphy — DO NOT suggest it; leave it flagged.",
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
          subject: "PHI scrub run failed — " + new Date().toISOString().slice(0, 10),
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

  // Send a review digest — suggestions are pending, NOT applied.
  if (env.RESEND_API_KEY && env.SUGGEST_TO_EMAIL) {
    const lines = fresh.length
      ? fresh.map((s) => "  - " + s.term + " — " + s.reason + " (" + s.confidence + ")")
      : ["  (no new suggestions)"];
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.RESEND_API_KEY },
      body: JSON.stringify({
        from: "tools@nooutco.me", to: env.SUGGEST_TO_EMAIL,
        subject: "PHI scrub — " + fresh.length + " suggestion" + (fresh.length === 1 ? "" : "s") + " awaiting review",
        text: [
          "PHI scrub review digest — " + runDate,
          "",
          result.digest || "",
          "",
          "These are SUGGESTIONS only — nothing has changed in detection. Approve or reject each at:",
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

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
