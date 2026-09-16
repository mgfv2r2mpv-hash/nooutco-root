/* THE WRITE PATH FOR voice_level AND diction_level.
 *
 * Both tables had a schema and an accumulator and nothing that wrote to them.
 * They arrive on /events, the route the Pages worker already forwards /api/audit
 * to, as a `voice` array beside `corrections` and `metrics`. There is no new
 * route here, and the browser still never reaches this Worker.
 *
 * ONE ENTRY PER NOTE, and an entry is three things:
 *
 *   tool     which note tool, from a closed list
 *   levels   this note's reading of the four house features, one number each
 *   diction  {family_id, variant_index, count} rows, through accept()
 *
 * NOTHING IN AN ENTRY IS READ BY ITS OWN KEYS. The levels are read by walking
 * HOUSE_FEATURES and looking each one up, so a key the payload made up is never
 * visited and cannot reach a statement. The diction rows go through accept(),
 * which admits a family only from its closed list. The tool is matched against
 * VOICE_TOOLS. So every string this file hands to a statement is a string this
 * file already held before the request arrived, and that is the property the
 * surface form test drives every route to prove.
 *
 * READ, FOLD, WRITE, the same trade shape_profile makes: the running variance
 * needs the previous sums and D1 has no RETURNING on conflict. Two notes for one
 * tool in the same request are folded in order in memory, so the second is
 * added to the first rather than both being added to what was stored.
 */

import { HOUSE_FEATURES } from "./house-prior.js";
import { accept, applyNote } from "./diction-level.js";
import { accumulateLevel } from "./voice-shrink.js";

/** The note tools a voice entry may name. Mirrored from NOTES_TOOLS in
 *  apps/tools/_worker.js and pinned to it by test/voice-write.test.js. A slug
 *  rule would admit any single word as a tool, and a tool is a stored column. */
export const VOICE_TOOLS = Object.freeze(["bt", "sup", "parent", "assess", "sap", "graphva"]);

/* Every one of the four features is a rate or a ratio, and real notes put each
   of them under 2. A value past this is a broken client or a forged payload,
   and folded into a running sum it would move one author's mean further than a
   year of their real notes. Refused, not clamped: clamping would still enter an
   observation nobody made. */
export const LEVEL_MAX = 10;

/* One request's worth. The browser flushes up to this many notes at once, and
   a burst past it is refused rather than written, the same way the batch caps
   in validate.js bound corrections and metrics. */
export const MAX_VOICE_NOTES = 20;

// Number.isFinite is false for anything that is not a number, so "0.5", null and
// [0.5] never reach the comparisons, where JavaScript would coerce them.
const isLevel = (v) => Number.isFinite(v) && v >= 0 && v <= LEVEL_MAX;

/**
 * What may be written, rebuilt from scratch.
 *
 * @param {unknown} input  body.voice as it arrived
 * @returns {{notes: Array<{tool, levels, diction}>, refused: number}}
 */
export function acceptVoice(input) {
  const notes = [];
  let refused = 0;
  for (const raw of (Array.isArray(input) ? input : []).slice(0, MAX_VOICE_NOTES)) {
    const entry = raw && typeof raw === "object" ? raw : {};
    const tool = VOICE_TOOLS.includes(entry.tool) ? entry.tool : null;
    if (!tool) { refused += 1; continue; }

    const given = entry.levels && typeof entry.levels === "object" ? entry.levels : {};
    const levels = {};
    for (const feature of HOUSE_FEATURES) {
      if (!Object.prototype.hasOwnProperty.call(given, feature)) continue;
      if (isLevel(given[feature])) levels[feature] = given[feature];
    }
    const { counts } = accept(entry.diction);

    if (!Object.keys(levels).length && !counts.length) { refused += 1; continue; }
    notes.push({ tool, levels, diction: counts });
  }
  return { notes, refused };
}

/**
 * Fold a run of notes into the rows one author holds, per tool.
 *
 * Pure. `stored` is what the tables held before this request, keyed by tool;
 * nothing in it is touched.
 *
 * @param {Record<string, {levels: Array<{feature,n,sum,sum_sq}>, diction: Array<{family_id,variant_index,count,notes}>}>} stored
 * @param {Array<{tool, levels, diction}>} notes  from acceptVoice
 * @returns {{levels: Array<{tool,feature,n,sum,sum_sq}>, diction: Array<{tool,family_id,variant_index,count,notes}>}}
 *   only the rows this request changed
 */
export function foldVoice(stored, notes) {
  const levelRows = new Map();
  const dictionByTool = new Map();
  const touched = new Set();

  for (const note of notes) {
    const held = (stored && stored[note.tool]) || {};

    for (const feature of Object.keys(note.levels)) {
      const key = note.tool + "|" + feature;
      const before = levelRows.has(key)
        ? levelRows.get(key)
        : (Array.isArray(held.levels) ? held.levels : []).find((r) => r && r.feature === feature) || null;
      levelRows.set(key, { tool: note.tool, feature, ...accumulateLevel(before, note.levels[feature]) });
    }

    if (!note.diction.length) continue;
    // The running total for this tool so far in THIS request, so a second note
    // adds to the first rather than to what was stored before either arrived.
    const before = dictionByTool.has(note.tool) ? dictionByTool.get(note.tool) : held.diction;
    dictionByTool.set(note.tool, applyNote(before, note.diction));
    note.diction.forEach((c) => touched.add(note.tool + "|" + c.family_id + ":" + c.variant_index));
  }

  const diction = [];
  for (const [tool, rows] of dictionByTool) {
    for (const row of rows) {
      if (touched.has(tool + "|" + row.family_id + ":" + row.variant_index)) diction.push({ tool, ...row });
    }
  }
  return { levels: [...levelRows.values()], diction };
}

/**
 * The statements that write one request's voice entries for one author.
 *
 * @param {D1Database} db
 * @param {string} kid  already authenticated by the Pages worker
 * @param {Array} notes  from acceptVoice
 * @param {number} now
 * @returns {Promise<Array<D1PreparedStatement>>}
 */
export async function voiceStatements(db, kid, notes, now) {
  if (!notes.length) return [];
  const stored = {};
  for (const tool of [...new Set(notes.map((n) => n.tool))]) {
    const [levels, diction] = await Promise.all([
      db.prepare(`SELECT feature, n, sum, sum_sq FROM voice_level WHERE kid = ? AND tool = ?`).bind(kid, tool).all(),
      db.prepare(
        `SELECT family AS family_id, variant AS variant_index, count, notes
           FROM diction_level WHERE kid = ? AND tool = ?`,
      ).bind(kid, tool).all(),
    ]);
    stored[tool] = { levels: levels.results || [], diction: diction.results || [] };
  }

  const folded = foldVoice(stored, notes);
  return [
    ...folded.levels.map((r) =>
      db.prepare(
        `INSERT INTO voice_level (kid, tool, feature, n, sum, sum_sq, updated)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(kid, tool, feature) DO UPDATE SET
           n = excluded.n, sum = excluded.sum, sum_sq = excluded.sum_sq, updated = excluded.updated`,
      ).bind(kid, r.tool, r.feature, r.n, r.sum, r.sum_sq, now)),
    ...folded.diction.map((r) =>
      db.prepare(
        `INSERT INTO diction_level (kid, tool, family, variant, count, notes, updated)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(kid, tool, family, variant) DO UPDATE SET
           count = excluded.count, notes = excluded.notes, updated = excluded.updated`,
      ).bind(kid, r.tool, r.family_id, r.variant_index, r.count, r.notes, now)),
  ];
}
