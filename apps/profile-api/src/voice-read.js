/**
 * SLICE 6: A DRAFT READS ITS AUTHOR'S STORED VOICE BACK.
 *
 * The write path fills voice_level and diction_level from the technician's own
 * hand (an overtyped section, an edited correction, an own harvest specimen).
 * Nothing read them. This turns the stored sums into the reading a draft is
 * written to, so drafts sound more like that BT as their notes accumulate.
 *
 * Pure. No Workers APIs, no clock. The route reads the rows and hands them in.
 *
 * WHAT LEAVES IS IDS AND NUMBERS, NEVER A WORD. A level is a house feature name,
 * a direction from a closed pair and a number. A diction preference is a family
 * id, a variant index, a share and a note count. The words those indexes stand
 * for live in the browser dictionary (apps/tools/notes/bcba/diction.js), the
 * same rule diction-level.js keeps: a store that cannot name a word cannot leak
 * one. The Pages worker checks every slot against its closed lists again before
 * the browser sees it (sanitizeVoiceReading in apps/tools/_worker.js).
 *
 * THE BUDGET IS THE ONE KALEB RULED. A move is spent only where the author's
 * band sits away from what the tool writes with nothing to go on, which is the
 * house mean, and at most MOVES_PER_NOTE of them (2, his ruling of 18 Sep).
 * planStyleMoves is the same function the slice 5 design spends a draft's moves
 * with; here the "draft" it measures is the house default, because before the
 * model has written anything the house default is what it would write. An
 * author whose band holds the house mean gets no move on that feature: the
 * tool already sounds like them there.
 */

import { housePrior } from "./house-prior.js";
import { authorTarget, planStyleMoves, MOVES_PER_NOTE } from "./voice-shrink.js";
import { familyShares, FAMILY_IDS } from "./diction-level.js";

/**
 * The level features a draft is told about. within_cv and step_rel are left
 * out ON PURPOSE: the shape block (shape.js, from shape_profile) already sets
 * both for every note, drawn per note, and two numbers for one quantity in one
 * prompt would contradict each other. Their voice_level sums stay stored.
 */
export const READ_FEATURES = Object.freeze(["actor_naming", "hedging"]);

/** A share on two notes is noise. These are the bars a word choice clears
 *  before a draft is told to make it. */
export const DICTION_MIN_NOTES = 3;
export const DICTION_MIN_SHARE = 0.6;
/** At most this many word choices per draft, the most evidenced first. */
export const DICTION_MAX_FAMILIES = 5;

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * @param {Array<{feature:string,n:number,sum:number,sum_sq:number,w_n?:number,w_sum?:number,w_sum_sq?:number}>} levelRows
 *   this author's voice_level rows for one tool
 * @returns {Array<{feature:string, direction:"more"|"less", target:number, n:number}>}
 */
export function levelMoves(levelRows) {
  const byFeature = Object.create(null);
  for (const row of Array.isArray(levelRows) ? levelRows : []) {
    if (row && READ_FEATURES.includes(row.feature)) byFeature[row.feature] = row;
  }
  // Cold features are not candidates. A target built on no notes is the house
  // mean, and telling a draft to write the house mean is telling it nothing.
  const targets = READ_FEATURES
    .map((feature) => authorTarget(feature, byFeature[feature] || null))
    .filter((t) => t.source === "shrunk");
  const houseDraft = Object.fromEntries(READ_FEATURES.map((f) => [f, housePrior(f).mean]));
  const plan = planStyleMoves({ targets, measured: houseDraft, budget: MOVES_PER_NOTE });
  const byName = Object.fromEntries(targets.map((t) => [t.feature, t]));
  return plan.moves.map((m) => ({
    feature: m.feature,
    direction: m.direction > 0 ? "more" : "less",
    target: round3(m.target),
    n: byName[m.feature].n,
  }));
}

/**
 * @param {Array<{family:string, variant:number, count:number, notes:number}>} dictionRows
 *   this author's diction_level rows for one tool, as stored
 * @returns {Array<{family_id:string, variant_index:number, share:number, notes:number}>}
 */
export function dictionPicks(dictionRows) {
  const stored = (Array.isArray(dictionRows) ? dictionRows : []).map((r) => ({
    family_id: r && r.family,
    variant_index: r && r.variant,
    count: r && r.count,
    notes: r && r.notes,
  }));
  const picks = [];
  for (const family of FAMILY_IDS) {
    const read = familyShares(stored, family);
    if (!read || read.notes < DICTION_MIN_NOTES) continue;
    const top = read.shares[0];
    if (!top || top.share < DICTION_MIN_SHARE) continue;
    picks.push({ family_id: family, variant_index: top.variant_index, share: round3(top.share), notes: read.notes });
  }
  return picks
    .sort((a, b) => b.notes - a.notes || b.share - a.share || a.family_id.localeCompare(b.family_id))
    .slice(0, DICTION_MAX_FAMILIES);
}

/** The reading one draft is written to. Empty lists for a cold author, which
 *  leaves the prompt exactly as it was before this slice. */
export function voiceReading(levelRows, dictionRows) {
  return { levels: levelMoves(levelRows), diction: dictionPicks(dictionRows) };
}
