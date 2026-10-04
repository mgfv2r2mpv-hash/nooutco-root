/**
 * Pieces of the Horae Zone deploy script (bin/deploy.mjs): the catalog of
 * Worker secrets and variables, the answer checks, the deploy-only config,
 * the scrubber that keeps a secret value out of every printed line, the
 * prompt reader and the checklist.
 */
import { addressOf } from "../src/signup.js";
import { fragmentLink } from "../../../packages/account-engine/src/mailer.mjs";

export const DATABASE = "horae-zone";
export const HOSTNAME = "horae-zone.nooutco.me";
export const DEPLOY_CONFIG = "wrangler.deploy.toml";
export const CRON = "0 * * * *";
export const ACCOUNT_KEY_BYTES = 32; // src/account-keys.js MIN_SECRET_BYTES
const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";
const SAMPLE_CODE = "AAAAAAAAAAAAAAAAAAAAAA";

const isAddress = (v) => {
  try {
    addressOf(v);
    return true;
  } catch {
    return false;
  }
};
// A from-address may carry a display name: Name <mail@domain>.
const isFrom = (v) => isAddress(v) || (/^[^<>\r\n]+<([^<>\s]+)>$/.test(v) && isAddress(v.match(/<([^<>\s]+)>$/)[1]));
const isLinkBase = (v) => {
  try {
    fragmentLink(v, SAMPLE_CODE);
    return true;
  } catch {
    return false;
  }
};

/**
 * Every Worker value the service reads (src/**: env.X), how the script gets
 * it and how it is stored. HZ_ACCOUNT_KEY is one internal secret: the PIN
 * pepper, the ticket digest key, the address and link sealing keys and every
 * other key are derived from it by HKDF (src/account-keys.js). HZ_TICKET_KEY
 * is a second: A5 signs tickets with an ECDSA P-256 private key (a JWK), which
 * an HKDF output cannot stand in for, so it is generated too. The seed sealing key
 * arrives with A5 (not built); test/deploy.test.mjs fails when src/ reads a
 * name this list does not carry.
 *   source    generated (crypto randomness) or asked (a prompt)
 *   store     secret (wrangler secret put, value on stdin) or var (the
 *             deploy-only config, for a value that is not secret)
 *   sensitive the value is never printed, even masked as part of a line
 */
export const CATALOG = Object.freeze([
  { name: "HZ_ACCOUNT_KEY", source: "generated", store: "secret", sensitive: true, label: `account key (${ACCOUNT_KEY_BYTES} random bytes, base64url; pepper, ticket and sealing keys derive from it)` },
  { name: "HZ_TICKET_KEY", source: "generated", store: "secret", sensitive: true, label: "ticket signing key (ECDSA P-256 private key, JWK; src/unlock.js signs each ticket with it)" },
  { name: "RESEND_KEY", source: "asked", store: "secret", sensitive: true, hidden: true, label: "Resend API key", check: (v) => /^\S{8,}$/.test(v), rule: "at least 8 characters, no spaces" },
  { name: "HZ_MAIL_FROM", source: "asked", store: "secret", sensitive: true, label: "From address for sign-up mail (on the domain verified in Resend), e.g. Horae Zone <mail@your-domain>", check: isFrom, rule: "an address, or Name <address>" },
  { name: "HZ_ALERT_TO", source: "asked", store: "secret", sensitive: true, label: "Alert address (mailed once a day when sign-ups reach half the daily cap)", check: isAddress, rule: "one address" },
  { name: "HZ_LINK_BASE", source: "asked", store: "secret", sensitive: false, label: "Sign-up link base (the https page that reads the code after #)", check: isLinkBase, rule: "https, no ? and no #" },
  { name: "HZ_CODES_PER_DAY", source: "asked", store: "var", sensitive: false, optional: true, label: "Mail plan daily send limit (blank keeps the default 3000)", check: (v) => /^[1-9]\d{0,6}$/.test(v), rule: "a whole number from 1" },
]);

/**
 * A new HZ_TICKET_KEY: an ECDSA P-256 key pair made by WebCrypto, the private
 * half exported as the JWK string src/unlock.js imports (kty, crv, x, y, d
 * only). The CryptoKey objects go out of scope here; the string is the value.
 */
export async function ticketKeyJwk(subtle = globalThis.crypto.subtle) {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const { kty, crv, x, y, d } = await subtle.exportKey("jwk", pair.privateKey);
  return JSON.stringify({ kty, crv, x, y, d });
}

export const SECRET_NAMES = CATALOG.filter((s) => s.store === "secret").map((s) => s.name);

/**
 * The deploy-only config, from the committed wrangler.toml: the real database
 * id in place of the zero placeholder, the one route as a Custom Domain
 * (always proxied through Cloudflare, so cf-connecting-ip is set by the edge
 * and cannot be spoofed), and the non-secret variables. workers_dev stays
 * false. The file is gitignored; wrangler.toml keeps the placeholder and no
 * route (test/config.test.mjs).
 */
export function deployConfig(toml, { databaseId, vars = {} }) {
  if (!/^workers_dev\s*=\s*false\s*$/m.test(toml)) throw new Error("deploy config: wrangler.toml must keep workers_dev = false");
  if (!toml.includes(`database_id = "${PLACEHOLDER_ID}"`)) throw new Error("deploy config: wrangler.toml has lost its placeholder database_id");
  if (!/^[0-9a-f-]{36}$/.test(databaseId)) throw new Error("deploy config: the database id is not a D1 id");
  const route = `routes = [{ pattern = "${HOSTNAME}", custom_domain = true }]`;
  let text = toml
    .replace(`database_id = "${PLACEHOLDER_ID}"`, `database_id = "${databaseId}"`)
    .replace(/^(workers_dev\s*=\s*false\s*)$/m, `$1\n${route}`);
  const entries = Object.entries(vars);
  if (entries.length > 0) text += `\n[vars]\n${entries.map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join("\n")}\n`;
  return `# GENERATED by bin/deploy.mjs for one deploy. Gitignored: never commit it.\n${text}`;
}

// The shapes a value takes in wrangler or API output: as typed, JSON-escaped
// (quotes, backslashes, control characters), URL-encoded with upper or lower
// case hex, encodeURI's lighter form and the form-encoded one (space as +).
function maskedForms(value) {
  const component = encodeURIComponent(value);
  const forms = [
    value,
    JSON.stringify(value).slice(1, -1),
    component,
    component.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase()),
    encodeURI(value),
    new URLSearchParams({ v: value }).toString().slice(2),
  ];
  return [...new Set(forms)];
}

// Masks every known value in `text`, in each of its forms, longest first so a
// shorter form never splits a longer one; `leaked` says whether one was there.
export function scrub(text, values) {
  const forms = values.filter(Boolean).flatMap(maskedForms).sort((a, b) => b.length - a.length);
  let out = String(text);
  let leaked = false;
  for (const form of forms) {
    if (!out.includes(form)) continue;
    leaked = true;
    out = out.split(form).join("[masked]");
  }
  return { text: out, leaked };
}

// wrangler prints JSON after banner lines on some versions: take the first
// line that opens an array or object through the end.
export function parseJson(stdout) {
  const text = String(stdout);
  const start = text.search(/^[[{]/m);
  if (start < 0) throw new Error("no JSON in wrangler output");
  return JSON.parse(text.slice(start));
}

export function findDatabaseId(list) {
  const db = (Array.isArray(list) ? list : []).find((d) => d && d.name === DATABASE);
  return db ? db.uuid ?? db.id ?? null : null;
}

export function schemaTables(sql) {
  return [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
}

/**
 * Reads one line per question from a stream. A hidden question on a terminal
 * turns echo off (raw mode) and prints nothing as keys are typed; piped input
 * is read line by line, with what follows a newline kept for the next one.
 * In raw mode Ctrl-C and Ctrl-D cancel, and the terminal leaves raw mode on
 * process exit or SIGTERM too. ESC sequences (arrow keys) are dropped.
 */
export class LineReader {
  constructor(input, output, proc = process) {
    this.input = input;
    this.output = output;
    this.proc = proc;
    this.buffer = "";
    this.waiting = null;
    this.ended = false;
    this.escape = null; // null, "start", "csi" or "ss3" inside an ESC sequence
    this.onExit = () => this.cancel();
    this.onTerm = () => {
      this.cancel();
      proc.kill(proc.pid, "SIGTERM");
    };
    this.onData = (chunk) => this.take(String(chunk));
    this.onEnd = () => {
      this.ended = true;
      this.settle();
    };
    input.on("data", this.onData);
    input.on("end", this.onEnd);
    input.pause();
  }

  take(text) {
    for (const ch of text) {
      if (this.inEscape(ch)) continue;
      if (this.waiting?.raw && (ch === "\u0003" || ch === "\u0004")) {
        this.cancel();
        return;
      }
      if (this.waiting?.raw && (ch === "\u007f" || ch === "\b")) {
        this.buffer = this.buffer.slice(0, -1);
        continue;
      }
      // \r, \n and \r\n each end one line (a raw terminal sends \r for Enter).
      if (!(ch === "\n" && this.lastWasCR)) this.buffer += ch === "\r" ? "\n" : ch;
      this.lastWasCR = ch === "\r";
    }
    this.settle();
  }

  // True when ch belongs to an ESC sequence: ESC [ params final (CSI), ESC O x
  // (SS3) or ESC x (Alt). A line end inside one is still a line end.
  inEscape(ch) {
    const code = ch.charCodeAt(0);
    if (ch === "\u001b") {
      this.escape = "start";
      return true;
    }
    const state = this.escape;
    if (!state || ch === "\r" || ch === "\n") {
      this.escape = null;
      return false;
    }
    if (state === "start" && (ch === "[" || ch === "O")) {
      this.escape = ch === "[" ? "csi" : "ss3";
      return true;
    }
    // CSI parameter and intermediate bytes (0x20-0x3f) keep it open; anything else ends it.
    if (state === "csi" && code >= 0x20 && code <= 0x3f) return true;
    this.escape = null;
    return true;
  }

  cancel() {
    this.buffer = ""; // a partly typed key must not outlive the cancel
    if (this.waiting) this.fail(new Error("cancelled"));
  }

  settle() {
    if (!this.waiting) return;
    const at = this.buffer.indexOf("\n");
    if (at < 0 && !this.ended) return;
    const line = at < 0 ? this.buffer : this.buffer.slice(0, at);
    this.buffer = at < 0 ? "" : this.buffer.slice(at + 1);
    const { resolve } = this.finish();
    resolve(line);
  }

  fail(err) {
    const { reject } = this.finish();
    reject(err);
  }

  finish() {
    const w = this.waiting;
    this.waiting = null;
    if (w.raw) {
      this.input.setRawMode(false);
      this.proc.off("exit", this.onExit);
      this.proc.off("SIGTERM", this.onTerm);
    }
    if (w.hidden) this.output.write("\n");
    this.input.pause();
    return w;
  }

  ask({ question, hidden = false }) {
    this.output.write(question);
    return new Promise((resolve, reject) => {
      const raw = hidden && this.input.isTTY === true && typeof this.input.setRawMode === "function";
      if (raw) {
        this.input.setRawMode(true);
        this.proc.once("exit", this.onExit);
        this.proc.once("SIGTERM", this.onTerm);
      }
      this.waiting = { resolve, reject, hidden, raw };
      this.input.resume();
      this.settle();
    });
  }

  close() {
    this.input.off("data", this.onData);
    this.input.off("end", this.onEnd);
    this.input.pause();
  }
}

export function renderChecklist(items) {
  const width = Math.max(...items.map((i) => i.item.length));
  const lines = items.map((i) => `  ${i.status.padEnd(7)} ${i.item.padEnd(width)}  ${i.detail}`);
  const failed = items.filter((i) => i.status === "FAIL").length;
  return [
    "",
    "CHECKLIST",
    ...lines,
    "",
    failed === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failed} item${failed === 1 ? "" : "s"})`,
  ].join("\n");
}
