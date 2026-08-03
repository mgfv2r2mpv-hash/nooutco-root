/**
 * Input validation for the profile store.
 *
 * Only a bound service can reach this Worker, so the caller is trusted to have
 * authenticated the technician. It is NOT trusted to have sent well-formed or
 * safe data -- a bug in the browser is exactly as capable of putting a sentence
 * of clinical text in a metric field as an attacker would be.
 *
 * Every function here rebuilds its output from scratch against an allowlist.
 * Nothing is filtered in place and nothing is coerced: a value that is not
 * already the right type is dropped, because coercion is how prose ends up
 * stored as "[object Object]" or a stringified note.
 */

import { FEATURE_NAMES } from "./features.js";

const MAX_METRIC_KEYS = 12;
const MAX_BATCH = 50;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export function sanitizeCorrections(input, now) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input.slice(0, MAX_BATCH)) {
    if (!raw || typeof raw !== "object") continue;
    if (!FEATURE_NAMES.includes(raw.feature)) continue;

    const direction = raw.direction > 0 ? 1 : raw.direction < 0 ? -1 : 0;
    if (direction === 0) continue; // "no change" is not evidence of anything

    out.push({
      feature: raw.feature,
      direction,
      source: raw.source === "manual" ? "manual" : "revision",
      magnitude: Number.isFinite(raw.magnitude) ? Math.max(0, Math.min(1, raw.magnitude)) : 1,
      ts: Number.isFinite(raw.ts) ? clampTs(raw.ts, now) : now,
    });
  }
  return out;
}

export function sanitizeMetrics(input, now) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input.slice(0, MAX_BATCH)) {
    if (!raw || typeof raw !== "object") continue;
    const type = cleanSlug(raw.type);
    if (!type) continue;

    const data = {};
    let keys = 0;
    for (const [k, v] of Object.entries(raw.data || {})) {
      if (keys >= MAX_METRIC_KEYS) break;
      if (!/^[a-z][a-z0-9_]{0,31}$/i.test(k)) continue;
      if (typeof v === "number" && Number.isFinite(v)) data[k] = v;
      else if (typeof v === "boolean") data[k] = v;
      else continue; // strings, objects, arrays, null, NaN -- all dropped
      keys++;
    }

    out.push({ type, data, ts: Number.isFinite(raw.ts) ? clampTs(raw.ts, now) : now });
  }
  return out;
}

/**
 * A client clock can be wrong, or hostile. A timestamp in the future would sit
 * at maximum recency weight forever and quietly dominate every later rebuild.
 */
export function clampTs(ts, now) {
  return Math.min(Math.max(ts, now - 5 * YEAR_MS), now);
}

export function cleanKid(v) {
  return typeof v === "string" && /^[\w.:-]{1,64}$/.test(v) ? v : null;
}

export function cleanSlug(v) {
  return typeof v === "string" && /^[a-z][a-z0-9_-]{0,31}$/i.test(v) ? v : null;
}
