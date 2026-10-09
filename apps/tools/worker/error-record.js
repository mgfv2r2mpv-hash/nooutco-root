// A durable record of note-tool production errors (issue #152).
//
// notifyError's email is throttled on purpose: one mail per message, then only
// at 5, 25 and 100 repeats, inside a 30-a-hour budget. That is right for an
// inbox and wrong for a morning review, because once the hour rolls over an
// error that happened 400 times reads like one that happened twice. This keeps
// a count per day, written on every occurrence, before the email throttle
// decides anything.
//
// WHAT IT KEEPS, AND WHAT IT NEVER KEEPS. An error message can carry user text
// (a model reply, a client-reported message), so the message is never stored.
// A record holds only what the code itself controls: the tool name, the
// caller's own context label, the structural diagnostics notifyError already
// mails (sanitizeDiagnostics, "structural only - no note content"), a
// fingerprint of tool+message, the count, and the first and last time. The
// fingerprint is printed on the email too, so a record and the mail that
// carries the words can be matched by hand. Keeping a scrubbed message text is
// Kaleb's call (issue #152), and nothing here does it.
//
// Counts are read-modify-write on KV, so two workers hitting the same error in
// the same instant can undercount by one. The record is for review, not billing.

export const ERROR_RECORD_PREFIX = "errrec:";
export const ERROR_RECORD_DAYS = 30;
export const ERROR_LIST_MAX_DAYS = 30;
const FIELD_MAX = 80;
const DAY_MS = 86400000;

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const label = (v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, FIELD_MAX) : null);

function cleanDiagnostics(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || typeof v === "object") continue;
    out[String(k).slice(0, 40)] = String(v).slice(0, 200);
  }
  return Object.keys(out).length ? out : null;
}

// The fingerprint names an error without carrying it: the first 16 hex of
// sha256(tool|message), the same pair notifyError dedupes on.
export async function errorFingerprint(sha256Hex, tool, message) {
  return (await sha256Hex(String(tool || "") + "|" + String(message || ""))).slice(0, 16);
}

// Count one occurrence. Never throws: recording must never break the request.
export async function recordError(kv, sha256Hex, { tool, message, meta, diagnostics, now = Date.now() } = {}) {
  try {
    if (!kv || !message) return null;
    const fingerprint = await errorFingerprint(sha256Hex, tool, message);
    const iso = new Date(now).toISOString();
    const key = ERROR_RECORD_PREFIX + dayOf(now) + ":" + fingerprint;
    let prior = null;
    try { prior = JSON.parse((await kv.get(key)) || "null"); } catch { prior = null; }
    const record = {
      day: dayOf(now),
      fingerprint,
      tool: label(tool) || "(unknown)",
      source: label(meta),
      count: (prior && Number.isInteger(prior.count) ? prior.count : 0) + 1,
      first: (prior && prior.first) || iso,
      last: iso,
      diagnostics: cleanDiagnostics(diagnostics) || (prior && prior.diagnostics) || null,
    };
    await kv.put(key, JSON.stringify(record), { expirationTtl: ERROR_RECORD_DAYS * 86400 });
    return record;
  } catch (e) {
    console.error("recordError failed:", e && e.message ? e.message : "unknown");
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
        try {
          const r = JSON.parse((await kv.get(name)) || "null");
          if (r) records.push(r);
        } catch { /* a record that no longer parses is skipped, not fatal */ }
      }
      cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
  }
  records.sort((a, b) => String(b.last).localeCompare(String(a.last)));
  return { days: span, total: records.reduce((n, r) => n + (r.count || 0), 0), records };
}
