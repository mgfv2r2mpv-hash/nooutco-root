// A durable record of note-tool production errors (issue #152).
//
// notifyError's email is throttled on purpose: one mail per message, then only
// at 5, 25 and 100 repeats, inside a 30-a-hour budget. That is right for an
// inbox and wrong for a morning review, because once the hour rolls over an
// error that happened 400 times reads like one that happened twice. This keeps
// a count per day, written on every occurrence, before the email throttle
// decides anything.
//
// WHAT IT KEEPS, AND NOTHING ELSE. These are clinical notes, so the record is
// an allow-list rather than a scrub. A record holds the day, the tool, the note
// tool when the code knows it, the route, the error class and a short code, the
// HTTP status, the upstream model API's status, where the report came from,
// the newest Cloudflare request ids, the deployed build, the count, and the
// first and last time. Each of those is either a constant this Worker wrote or
// a value checked against a fixed list or a fixed pattern. The message, the
// meta label's free text, the client's diagnostics bag and anything a caller
// typed are never copied in, because each of them can carry a model reply, a
// JSON parser's quote of one, or a name the scrub missed.
//
// The fingerprint is a hash of those structural fields, not of the message, so
// it carries nothing of the message either. Two different messages from the
// same route, status and code share one record; the email still has the words.
//
// Counts are read-modify-write on KV, so two workers hitting the same error in
// the same instant can undercount by one. The record is for review, not billing.

import { BUILD_SHA } from "./build-info.js";

export const ERROR_RECORD_PREFIX = "errrec:";
export const ERROR_RECORD_DAYS = 30;
export const ERROR_LIST_MAX_DAYS = 30;
export const REQUEST_IDS_KEPT = 5;
// /api/error-report is open without a token. The structural fingerprint already
// bounds how many distinct records can exist, and this caps it again per day.
// Past it, new fingerprints fold into one overflow record; known ones still count.
export const NEW_RECORDS_PER_DAY = 500;
const OVERFLOW = "overflow";
const DAY_MS = 86400000;
const BUILD_CHARS = 12;

// Every tool label notifyError is called with, plus what the browser sends to
// /api/error-report. Anything else is recorded as "(other)".
const NOTE_TOOLS = new Set(["bt", "sup", "parent", "assess", "sap", "graphva"]);
const TOOLS = new Set([
  ...NOTE_TOOLS,
  "notes", "login", "prompt-api", "llm-call",
  "expert-pass", "expert-chat", "corrections-pass", "expert-research",
]);
// The two meta labels handleErrorReport writes. Server calls pass none.
const SOURCES = new Set(["client (authenticated)", "client (unauthenticated)"]);
const ERROR_CLASSES = new Set([
  "Error", "TypeError", "SyntaxError", "RangeError", "ReferenceError",
  "EvalError", "URIError", "AggregateError", "AbortError", "TimeoutError",
]);
// Server codes from the notifyError call sites, and the three stages the
// browser's internalError writes (assets/notes-gate.js).
const ERROR_CODES = new Set([
  "unhandled", "not_configured", "prompt_unavailable",
  "http", "shape", "parse",
]);
const ROUTE_RE = /^\/api\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const ROUTE_MAX = 60;
const RAY_RE = /^[0-9a-f]{16}(?:-[A-Z]{3})?$/;
const SHA_RE = /^[0-9a-f]{7,40}$/;
// The upstream helpers throw "Anthropic API error 529: <their text>". Only the
// three digits after the code-written prefix are read.
const UPSTREAM_RE = /^(?:Anthropic|OpenAI|Gemini) API error (\d{3})\b/;

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const oneOf = (set, v) => (typeof v === "string" && set.has(v) ? v : null);

function httpStatus(v) {
  const n = typeof v === "string" && /^\d{3}$/.test(v) ? Number(v) : v;
  return Number.isInteger(n) && n >= 100 && n <= 599 ? n : null;
}

function routeOf(request) {
  try {
    let path = new URL(request.url).pathname;
    // The client appends ".js" to API paths to get past Bot Fight Mode.
    if (path.endsWith(".js")) path = path.slice(0, -3);
    return path.length <= ROUTE_MAX && ROUTE_RE.test(path) ? path : null;
  } catch {
    return null;
  }
}

function requestIdOf(request) {
  try {
    const ray = request && request.headers ? request.headers.get("cf-ray") : null;
    return typeof ray === "string" && RAY_RE.test(ray) ? ray : null;
  } catch {
    return null;
  }
}

function buildOf(env) {
  const candidates = [BUILD_SHA, env && env.CF_PAGES_COMMIT_SHA];
  const sha = candidates.find((s) => typeof s === "string" && SHA_RE.test(s));
  return sha ? sha.slice(0, BUILD_CHARS) : null;
}

function errorClassOf(error) {
  if (!error || typeof error !== "object") return null;
  return oneOf(ERROR_CLASSES, error.name) || "Error";
}

function upstreamStatusOf(error) {
  const m = error && typeof error.message === "string" ? UPSTREAM_RE.exec(error.message) : null;
  return m ? httpStatus(m[1]) : null;
}

/**
 * The structural fields of one error, each from an allow-list or a pattern.
 * `diagnostics` is the browser's bag on /api/error-report: only its stage and
 * status are read, and only when they are on the fixed lists.
 *
 * @param {{ tool?: string, meta?: string, diagnostics?: object|null,
 *   context?: { request?: Request, status?: number, error?: unknown, code?: string, noteTool?: string },
 *   env?: object }} input
 */
export function errorRecordFields({ tool, meta, diagnostics, context = {}, env } = {}) {
  const diag = diagnostics && typeof diagnostics === "object" && !Array.isArray(diagnostics) ? diagnostics : {};
  const requestId = requestIdOf(context.request);
  return {
    tool: oneOf(TOOLS, tool) || "(other)",
    noteTool: oneOf(NOTE_TOOLS, context.noteTool),
    route: context.request ? routeOf(context.request) : null,
    errorClass: errorClassOf(context.error),
    errorCode: oneOf(ERROR_CODES, context.code) || oneOf(ERROR_CODES, diag.stage),
    status: httpStatus(context.status) ?? httpStatus(diag.status),
    upstreamStatus: upstreamStatusOf(context.error),
    source: oneOf(SOURCES, meta) || "server",
    requestIds: requestId ? [requestId] : [],
    build: buildOf(env),
  };
}

const GROUPING_KEYS = ["tool", "noteTool", "route", "errorClass", "errorCode", "status", "upstreamStatus", "source"];

// The first 16 hex of sha256 over the grouping fields. Printed on the error
// email too, so a record and the mail that carries the words can be matched.
export async function errorFingerprint(sha256Hex, fields) {
  const basis = GROUPING_KEYS.map((k) => (fields[k] === null || fields[k] === undefined ? "" : String(fields[k])));
  return (await sha256Hex(basis.join("|"))).slice(0, 16);
}

// Only these keys ever leave this module, on write and on read. A record
// written before this shape (issue #152's first cut kept a diagnostics bag) is
// shown through the same filter until its TTL takes it.
const RECORD_KEYS = ["day", "fingerprint", ...GROUPING_KEYS, "requestIds", "build", "count", "first", "last"];

function publicRecord(r) {
  const out = {};
  for (const k of RECORD_KEYS) out[k] = r[k] === undefined ? null : r[k];
  out.requestIds = Array.isArray(r.requestIds) ? r.requestIds.filter((id) => RAY_RE.test(String(id))) : [];
  return out;
}

async function readRecord(kv, key) {
  try { return JSON.parse((await kv.get(key)) || "null"); } catch { return null; }
}

// Whether today may still mint a new record, counting this one if so. The
// counter key sits outside the errrec: prefix so listErrors never reads it.
async function underNewRecordCap(kv, day) {
  const capKey = "errrec-new:" + day;
  const used = parseInt((await kv.get(capKey)) || "0", 10);
  if (used >= NEW_RECORDS_PER_DAY) return false;
  await kv.put(capKey, String(used + 1), { expirationTtl: 2 * 86400 });
  return true;
}

function mergeRecord(prior, fields, { day, fingerprint, iso, overflow }) {
  const base = overflow
    ? { ...Object.fromEntries(GROUPING_KEYS.map((k) => [k, null])), tool: "(over the daily cap of new errors)" }
    : Object.fromEntries(GROUPING_KEYS.map((k) => [k, fields[k]]));
  const priorIds = prior && Array.isArray(prior.requestIds) ? prior.requestIds : [];
  const requestIds = overflow ? [] : [...fields.requestIds, ...priorIds.filter((id) => !fields.requestIds.includes(id))]
    .slice(0, REQUEST_IDS_KEPT);
  return publicRecord({
    ...base,
    day,
    fingerprint,
    requestIds,
    build: fields.build || (prior && prior.build) || null,
    count: (prior && Number.isInteger(prior.count) ? prior.count : 0) + 1,
    first: (prior && prior.first) || iso,
    last: iso,
  });
}

/**
 * Count one occurrence. Never throws: recording must never break the request.
 * @param {KVNamespace|null} kv
 * @param {(s: string) => Promise<string>} sha256Hex
 * @param {{ fields: ReturnType<typeof errorRecordFields>, now?: number }} input
 */
export async function recordError(kv, sha256Hex, { fields, now = Date.now() } = {}) {
  try {
    if (!kv || !fields) return null;
    const iso = new Date(now).toISOString();
    const day = dayOf(now);
    let fingerprint = await errorFingerprint(sha256Hex, fields);
    let key = ERROR_RECORD_PREFIX + day + ":" + fingerprint;
    let prior = await readRecord(kv, key);
    if (!prior && !(await underNewRecordCap(kv, day))) {
      fingerprint = OVERFLOW;
      key = ERROR_RECORD_PREFIX + day + ":" + OVERFLOW;
      prior = await readRecord(kv, key);
    }
    const record = mergeRecord(prior, fields, { day, fingerprint, iso, overflow: fingerprint === OVERFLOW });
    await kv.put(key, JSON.stringify(record), { expirationTtl: ERROR_RECORD_DAYS * 86400 });
    return record;
  } catch (e) {
    console.error("recordError failed:", e && e.name ? e.name : "unknown");
    return null;
  }
}

// The last `days` days of records, newest occurrence first.
export async function listErrors(kv, { days = 7, now = Date.now() } = {}) {
  const span = Math.max(1, Math.min(ERROR_LIST_MAX_DAYS, Math.floor(Number(days)) || 7));
  const records = [];
  for (let i = 0; i < span; i++) {
    const prefix = ERROR_RECORD_PREFIX + dayOf(now - i * DAY_MS) + ":";
    let cursor;
    do {
      const page = await kv.list({ prefix, cursor });
      for (const { name } of page.keys) {
        const r = await readRecord(kv, name);
        if (r) records.push(publicRecord(r));
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
  records.sort((a, b) => String(b.last).localeCompare(String(a.last)));
  return { days: span, total: records.reduce((n, r) => n + (r.count || 0), 0), records };
}
