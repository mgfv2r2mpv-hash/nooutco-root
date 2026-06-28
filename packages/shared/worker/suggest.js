// Shared "Suggest a feature" handler for the /api/suggest POST endpoint.
// CANONICAL SOURCE — edit here, never in apps/<app>/shared/ (generated copies).
//
// Requires env bindings: RESEND_API_KEY (secret), SUGGEST_DUPES (KV, optional dedup),
// SUGGEST_TO_EMAIL (optional, defaults to feedback@nooutco.me).

import { jsonRes, sha256Hex } from "./helpers.js";

export async function handleSuggest(request, env) {
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
