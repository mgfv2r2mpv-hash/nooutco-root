// Shared Cloudflare Pages worker helpers.
// CANONICAL SOURCE — edit here, never in apps/<app>/shared/ (those are generated
// copies produced by `npm run sync:shared`; a CI drift check fails on hand edits).

export async function sha256Hex(str) {
  const buf = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export function jsonRes(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    // no-store: API responses are served from ".js" paths (to dodge the bot challenge),
    // which the CDN would otherwise treat as cacheable static assets.
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
