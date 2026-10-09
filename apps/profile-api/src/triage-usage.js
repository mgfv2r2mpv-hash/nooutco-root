/**
 * HOW EACH BT ANSWERS NoMe's QUESTIONS, as counts and rates.
 *
 * His words, 3 Oct 2026: "I do want some reporting on BT note tool use so that
 * I can guide their performance. Can't do that blind." Tracking went live in
 * #235 and #240: every Send that finishes a triage round records one
 * `triage_answers` event holding four integer counts and the round. This file
 * reads those events back, per technician and per tool, for the admin view.
 *
 * CONTENT-FREE BY CONSTRUCTION. The Pages worker holds this event type to
 * integer keys (AUDIT_INTEGER_KEYS in apps/tools/_worker.js), so there is no
 * word in the rows to leak. This module goes one step further and reads ONLY
 * the four kind keys below, so a key a later change adds to the event cannot
 * reach the report without being named here first.
 *
 * Pure. No Workers APIs and no clock: the route in index.js does the query and
 * hands the rows over.
 */

/** The four ways a question gets its answer, in the order the view shows them.
 *  Mirrored from answerKind in apps/tools/notes/bcba/engine.jsx. */
export const USAGE_KINDS = Object.freeze(["accepted_as_is", "edited", "own_words", "not_refined"]);

/** One question in a round cannot be answered twice, so a count past this is a
 *  broken client rather than a busy BT. Refused per row, not clamped. */
export const MAX_QUESTIONS_PER_SEND = 50;

const isCount = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_QUESTIONS_PER_SEND;

/**
 * Read one stored row's counts, or null when the row is not a usable reading.
 * A row is all or nothing: one bad count drops the whole Send, because a Send
 * with three of its four counts would tilt every rate it joins.
 *
 * @param {string|object} data  the stored JSON text, or an already parsed object
 * @returns {Record<string, number>|null}
 */
export function readCounts(data) {
  let parsed = data;
  if (typeof data === "string") {
    try { parsed = JSON.parse(data); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out = {};
  let questions = 0;
  for (const kind of USAGE_KINDS) {
    const v = parsed[kind] === undefined ? 0 : parsed[kind];
    if (!isCount(v)) return null;
    out[kind] = v;
    questions += v;
  }
  return questions > 0 ? out : null;
}

const emptyCounts = () => Object.fromEntries(USAGE_KINDS.map((k) => [k, 0]));

function addCounts(into, counts) {
  return Object.fromEntries(USAGE_KINDS.map((k) => [k, into[k] + counts[k]]));
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/** Rates over questions asked, never over Sends: a Send can carry one question
 *  or nine, and only the question count says how often a suggestion was taken. */
export function ratesOf(counts) {
  const questions = USAGE_KINDS.reduce((sum, k) => sum + counts[k], 0);
  return Object.fromEntries(
    USAGE_KINDS.map((k) => [k, questions ? round3(counts[k] / questions) : null]),
  );
}

function line(tool, sends, counts) {
  return {
    tool,
    sends,
    questions: USAGE_KINDS.reduce((sum, k) => sum + counts[k], 0),
    counts,
    rates: ratesOf(counts),
  };
}

/**
 * Fold stored rows into the report.
 *
 * @param {Array<{kid:string, tool:string, data:string}>} rows
 * @returns {{technicians: Array, tools: Array, skipped: number}}
 */
export function summariseTriageUsage(rows) {
  const byKid = new Map();   // kid -> Map(tool -> {sends, counts})
  const byTool = new Map();  // tool -> {sends, counts}
  let skipped = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const counts = row && typeof row.kid === "string" && row.kid ? readCounts(row.data) : null;
    if (!counts) { skipped += 1; continue; }
    const tool = typeof row.tool === "string" && row.tool ? row.tool : "unknown";

    const tools = byKid.get(row.kid) || new Map();
    const prev = tools.get(tool) || { sends: 0, counts: emptyCounts() };
    tools.set(tool, { sends: prev.sends + 1, counts: addCounts(prev.counts, counts) });
    byKid.set(row.kid, tools);

    const cohort = byTool.get(tool) || { sends: 0, counts: emptyCounts() };
    byTool.set(tool, { sends: cohort.sends + 1, counts: addCounts(cohort.counts, counts) });
  }

  const technicians = [...byKid.entries()].map(([kid, tools]) => {
    const perTool = [...tools.entries()]
      .map(([tool, t]) => line(tool, t.sends, t.counts))
      .sort((a, b) => b.questions - a.questions || a.tool.localeCompare(b.tool));
    const total = perTool.reduce(
      (acc, t) => ({ sends: acc.sends + t.sends, counts: addCounts(acc.counts, t.counts) }),
      { sends: 0, counts: emptyCounts() },
    );
    return { kid, tools: perTool, total: line("all", total.sends, total.counts) };
  }).sort((a, b) => b.total.questions - a.total.questions || a.kid.localeCompare(b.kid));

  const tools = [...byTool.entries()]
    .map(([tool, t]) => line(tool, t.sends, t.counts))
    .sort((a, b) => b.questions - a.questions || a.tool.localeCompare(b.tool));

  return { technicians, tools, skipped };
}
