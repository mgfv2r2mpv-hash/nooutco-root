export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/suggest" && request.method === "POST") {
      return handleSuggest(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return env.API_WORKER.fetch(request);
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
