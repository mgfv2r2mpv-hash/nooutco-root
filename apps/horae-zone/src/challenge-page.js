/**
 * GET /challenge: the one page where the Turnstile widget runs (design of
 * 8 Oct 2026, section 2.4). Sass opens it in a throwaway web view with no app
 * doors; the JanusMirror phone opens it in an iframe. Neither client's own
 * origin loads Cloudflare's script.
 *
 * The action rides in the fragment (`/challenge#account`, `/challenge#signin`,
 * `/challenge#recover`), since a query string is refused everywhere
 * (src/index.js); the page's list is turnstile.js ACTIONS. The sitekey is
 * the Worker var HZ_TURNSTILE_SITEKEY, public by Cloudflare's design. On a
 * solved challenge the page hands the token to whichever host is present:
 * Sass's `turnstile` message handler, or the parent frame at each of
 * FRAME_ORIGINS (a postMessage to an origin the parent does not have is
 * dropped by the browser).
 *
 * The page is fixed text: no value a request carries is echoed into it, and
 * it touches no database (it writes no audit row, so a flood of GETs cannot
 * grow D1). Until both Turnstile keys are set it answers 503 with the
 * not-configured sentence and loads no script, so a client never shows a
 * challenge whose token the Worker could not check.
 */
import { NOT_CONFIGURED_SENTENCE, turnstileSecret } from "./turnstile.js";

// The JanusMirror phone origins allowed to frame the page (design 2.9 item 5).
export const FRAME_ORIGINS = Object.freeze(["https://lc.nooutco.me", "https://lp.nooutco.me"]);
export const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const CHALLENGE_ORIGIN = "https://challenges.cloudflare.com";

// What a person reads when the widget itself fails (blocked network, a
// Cloudflare error): the same sentence the clients show for `challenge`.
const FAILED_SENTENCE = "Cloudflare could not check this device just now. Close this and try again, or try another network.";

// The inline script, fixed text, so its CSP hash is fixed too. It reads the
// sitekey from the widget box and the action from the fragment.
export const PAGE_SCRIPT = `(function () {
  var box = document.getElementById("widget");
  var note = document.getElementById("note");
  var action = location.hash.slice(1);
  var actions = ["account", "signin", "recover"];
  if (actions.indexOf(action) < 0) {
    note.textContent = "This page needs #account, #signin or #recover.";
    return;
  }
  var parents = ${JSON.stringify(FRAME_ORIGINS)};
  function hand(token) {
    var host = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.turnstile;
    if (host) {
      host.postMessage(token);
      return;
    }
    if (window.parent !== window) {
      parents.forEach(function (origin) { window.parent.postMessage({ turnstile: token }, origin); });
    }
  }
  turnstile.render(box, {
    sitekey: box.getAttribute("data-sitekey"),
    action: action,
    callback: hand,
    "error-callback": function () { note.textContent = ${JSON.stringify(FAILED_SENTENCE)}; return true; },
    "expired-callback": function () { turnstile.reset(box); }
  });
})();`;

// The one style rule: no margin, so the widget (300 by 65) fits the phone's
// 80-pixel frame. Hashed like the script; no other style may load.
export const PAGE_STYLE = "body{margin:0;font:15px -apple-system,system-ui,sans-serif}";

// A sitekey is letters, digits, _ and -; anything else is not one Cloudflare
// issued and is never put into the page.
const SITEKEY = /^[A-Za-z0-9_-]{1,100}$/;

async function cspHash(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let s = "";
  for (const b of new Uint8Array(digest)) s += String.fromCharCode(b);
  return `'sha256-${btoa(s)}'`;
}

// Computed once per isolate: both texts are fixed.
let hashes = null;
const pageHashes = async () => {
  hashes ??= { script: await cspHash(PAGE_SCRIPT), style: await cspHash(PAGE_STYLE) };
  return hashes;
};

export async function challengeCsp() {
  const { script, style } = await pageHashes();
  return [
    "default-src 'none'",
    `script-src ${CHALLENGE_ORIGIN} ${script}`,
    `style-src ${style}`,
    `frame-src ${CHALLENGE_ORIGIN}`,
    "connect-src 'none'",
    `frame-ancestors ${FRAME_ORIGINS.join(" ")}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

// For the not-configured answer: no script at all, and nobody may frame it
// but the same phone origins.
const QUIET_CSP = `default-src 'none'; frame-ancestors ${FRAME_ORIGINS.join(" ")}; base-uri 'none'; form-action 'none'`;

const BASE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const page = (title, body, head = "") => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
${head}</head>
<body>
${body}
</body>
</html>
`;

export function sitekeyOf(env) {
  const value = env?.HZ_TURNSTILE_SITEKEY;
  return typeof value === "string" && SITEKEY.test(value) ? value : null;
}

export async function challengePage(env) {
  const sitekey = sitekeyOf(env);
  if (!sitekey || !turnstileSecret(env)) {
    return new Response(page("Horae Zone", `<p>${NOT_CONFIGURED_SENTENCE}</p>`), {
      status: 503,
      headers: { ...BASE_HEADERS, "content-security-policy": QUIET_CSP },
    });
  }
  const body = `<div id="widget" data-sitekey="${sitekey}"></div>
<p id="note" role="status"></p>
<script>${PAGE_SCRIPT}</script>`;
  const head = `<style>${PAGE_STYLE}</style>\n<script src="${TURNSTILE_SCRIPT}"></script>\n`;
  return new Response(page("Horae Zone check", body, head), {
    status: 200,
    headers: { ...BASE_HEADERS, "content-security-policy": await challengeCsp() },
  });
}
