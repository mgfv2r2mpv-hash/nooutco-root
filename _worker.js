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

    if (url.pathname === "/api/suggest" && request.method === "POST") {
      return handleSuggest(request, env);
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

  // Managed access passwords (API_PASSWORDS KV) — Generate Note only.
  if (env.API_PASSWORDS) {
    const rec = await findPassword(env.API_PASSWORDS, password);
    if (rec && rec.active) {
      const token = await signToken({ exp, role: "user", kid: rec.id }, secret);
      return jsonRes(200, { token, role: "user" });
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

    // Managed passwords can be revoked instantly: re-check the KV on every call.
    if (payload.role === "user") {
      const active = env.API_PASSWORDS && (await isPasswordActive(env.API_PASSWORDS, payload.kid));
      if (!active) return jsonRes(401, { error: "Access revoked. Please log in again." });
    }

    const apiKey = (env.ANTHROPIC_API_KEY ?? "").trim();
    if (!apiKey) return jsonRes(503, { error: "Server API key is not configured." });

    const body = await request.json();
    const { systemPrompt, userPrompt, model, maxTokens } = body;
    if (!systemPrompt || !userPrompt) {
      return jsonRes(400, { error: "Missing required fields: systemPrompt, userPrompt" });
    }

    const llmResponse = await callAnthropicApi(
      apiKey, systemPrompt, userPrompt, model || "claude-haiku-4-5-20251001", maxTokens || 3000
    );
    return jsonRes(200, llmResponse);
  } catch (error) {
    console.error("LLM call error:", error);
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
  const list = await kv.list({ prefix: "pw:" });
  for (const k of list.keys) {
    const md = k.metadata || {};
    if (md.hash === h) {
      return { id: k.name.slice(3), label: md.label || "", active: !!md.active, createdAt: md.createdAt || null };
    }
  }
  return null;
}

async function isPasswordActive(kv, id) {
  if (!id) return false;
  const { metadata } = await kv.getWithMetadata("pw:" + id);
  return !!(metadata && metadata.active);
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
        createdAt: (k.metadata && k.metadata.createdAt) || null,
      }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return jsonRes(200, { passwords });
  }

  let body;
  try { body = await request.json(); }
  catch { return jsonRes(400, { error: "Invalid request." }); }

  if (request.method === "POST") {
    const label = (body.label ?? "").trim();
    const password = (body.password ?? "").trim();
    if (!password) return jsonRes(400, { error: "A password is required." });
    if (password === secret) return jsonRes(409, { error: "That is the admin password — pick a different one." });
    if (await findPassword(kv, password)) return jsonRes(409, { error: "That password already exists." });
    const id = crypto.randomUUID();
    const metadata = { label, hash: await sha256Hex(password), active: true, createdAt: new Date().toISOString() };
    await kv.put("pw:" + id, "1", { metadata });
    return jsonRes(200, { id, label, active: true, createdAt: metadata.createdAt });
  }

  if (request.method === "PATCH") {
    const id = (body.id ?? "").trim();
    const { metadata } = await kv.getWithMetadata("pw:" + id);
    if (!metadata) return jsonRes(404, { error: "Password not found." });
    const updated = { ...metadata, active: !!body.active };
    await kv.put("pw:" + id, "1", { metadata: updated });
    return jsonRes(200, { id, active: updated.active });
  }

  if (request.method === "DELETE") {
    const id = (body.id ?? "").trim();
    await kv.delete("pw:" + id);
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

async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
