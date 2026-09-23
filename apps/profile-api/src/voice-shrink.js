/**
 * One author's voice estimate, and the small number of moves a draft is allowed
 * to spend chasing it.
 *
 * Pure. No Workers APIs, no clock, no storage, no randomness. Everything it
 * knows about the house arrives through house-prior.js, which cannot be handed
 * an observation, and everything it knows about an author arrives as running
 * sums the caller read out of D1.
 *
 * THREE STAGES, IN THIS ORDER, AND THE ORDER MATTERS.
 *
 *   1. SHRINKAGE.  shrunk = houseMean + w * (authorMean - houseMean)
 *                  w = n / (n + k),  k = withinVariance / betweenVariance
 *
 *      An author with one note has one note's worth of evidence, and a target
 *      built on it would swing wildly between their second and third. w is the
 *      share of the distance from the house to this author that the evidence
 *      has actually paid for. k is the price: how many notes it takes to buy
 *      half the distance. A measure where authors differ a lot from each other
 *      and little from themselves is cheap, and one where the reverse holds is
 *      expensive. Both variances belong to the house, which is why k is
 *      computed in house-prior.js and not here.
 *
 *   2. ENVELOPE CLAMP, applied AFTER shrinkage and never before. Shrinking
 *      first and clamping second means the clamp is the last word: an author
 *      with a thousand notes still writes inside the range the house will put
 *      its name to. Clamping the author mean first and then shrinking would let
 *      a clamped value be pulled back out again by the house mean, which is the
 *      same bug wearing the right order.
 *
 *   3. STYLE BUDGET. A fixed small number of moves per note, spent ONLY where
 *      the draft already sits outside that author's band. A note that already
 *      reads like the person who is about to sign it needs no moves at all, and
 *      spending one anyway is how a tool talks someone out of their own voice.
 *      The in-band counter below is the audit of exactly that: it counts moves
 *      that were emitted against a feature that was already fine, and it is
 *      zero by construction rather than by intention.
 */

import { housePrior, HOUSE_FEATURES } from "./house-prior.js";

/**
 * How many moves one note may spend. Small on purpose: this is a style budget,
 * not a rewrite. Four features carry a house prior today, and Kaleb ruled this
 * to 2 on 18 September: half the measures, so a note gets touched where it is
 * furthest off and left alone everywhere else. His standing requirement is that
 * the tool sound like the author without overtrying, and three of four measures
 * moved in one note is most of that note's style rather than a nudge.
 */
export const MOVES_PER_NOTE = 2;

/**
 * Half the width of an author's band, in units of that author's own note to
 * note spread. At one sd, roughly two thirds of this author's own notes sit
 * inside their band, so a draft landing there is indistinguishable from
 * something they wrote and there is nothing to correct.
 *
 * The spread is the house's within_var rather than the author's measured sd,
 * and that is deliberate: a spread needs far more evidence than a mean, and an
 * author whose first three notes happened to land together would otherwise get
 * a band narrow enough to fail every draft.
 */
export const BAND_SDS = 1;

/**
 * How far above their own mean "a great work day" sits, in the author's OWN
 * sample sds, for a feature whose house direction is "higher". One, the same
 * width as the band: a great day is the top of the range the tool already
 * calls theirs, not a value outside it.
 *
 * WHY THE OFFSET IS OFF THEIR SPREAD AND NOT OFF THE HOUSE. If it pointed at
 * the house mean it would pull the same way shrinkage does, and every author
 * would converge on the house ideal while the tool appeared to be learning
 * them. Off their own sd, two authors with different means at the same n get
 * different targets. The test named for that is the one that matters.
 *
 * WHY IT IS SCALED BY w BEFORE SHRINKAGE SCALES IT AGAIN. A spread estimated
 * from n notes is a weaker number than a mean from the same n, so it pays for
 * evidence twice: once here, and once when the whole author term is shrunk. At
 * n = 1 the sd is 0 and the offset is exactly 0, so a first note buys nothing.
 */
export const GREAT_DAY_SDS = 1;

/* ---- the per author accumulators ------------------------------------------
 *
 * The same shape shape_profile already uses: running sums, no per note history,
 * nothing to prune, and nothing in the row that could hold a word.
 */

/**
 * Fold one note's measurement into a feature's accumulators.
 *
 * Two triples ride together. The raw one counts every note by one, so a report
 * can still say "twelve notes". The weighted one counts a note by its
 * engagement, the share of it that was the technician's own; house-prior.js
 * says per feature which triple the estimate reads (`evidence`). A weight that
 * is not a share is treated as one rather than trusted, because it arrives
 * here only after acceptVoice has already refused anything malformed.
 *
 * @param {{n:number,sum:number,sum_sq:number,w_n?:number,w_sum?:number,w_sum_sq?:number}|null} row
 * @param {number} value
 * @param {number} [weight]  engagement, 0 to 1; missing means 1
 */
export function accumulateLevel(row, value, weight) {
  if (!Number.isFinite(value)) return normaliseRow(row);
  const base = normaliseRow(row);
  const w = isShare(weight) ? weight : 1;
  return {
    n: base.n + 1,
    sum: base.sum + value,
    sum_sq: base.sum_sq + value * value,
    w_n: base.w_n + w,
    w_sum: base.w_sum + w * value,
    w_sum_sq: base.w_sum_sq + w * value * value,
  };
}

const isShare = (v) => Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * Mean and sample sd from the running sums.
 *
 * @param {object|null} row
 * @param {"engaged"|"all"} [evidence]  which triple to read; "all" when absent.
 *   An engaged feature whose weighted triple is still all zero (a row written
 *   before the weight columns existed) reads the raw one, so nobody's estimate
 *   jumps on the deploy that adds them.
 */
export function summariseLevel(row, evidence) {
  const base = normaliseRow(row);
  const weighted = evidence === "engaged" && base.w_n > 0;
  const n = weighted ? base.w_n : base.n;
  const sum = weighted ? base.w_sum : base.sum;
  const sumSq = weighted ? base.w_sum_sq : base.sum_sq;
  if (!n) return { n: 0, mean: null, sd: null };
  const mean = sum / n;
  // Guarded: floating point on running sums can drive a variance that should be
  // zero very slightly negative.
  const variance = Math.max(0, sumSq / n - mean * mean);
  return {
    n,
    mean,
    sd: n > 1 ? Math.sqrt((variance * n) / (n - 1)) : 0,
  };
}

function normaliseRow(row) {
  const n = row && Number.isFinite(row.n) ? Math.max(0, Math.trunc(row.n)) : 0;
  const num = (k) => (row && Number.isFinite(row[k]) ? row[k] : 0);
  return {
    n,
    sum: num("sum"),
    sum_sq: num("sum_sq"),
    w_n: Math.max(0, num("w_n")),
    w_sum: num("w_sum"),
    w_sum_sq: num("w_sum_sq"),
  };
}

/* ---- shrinkage and the envelope ------------------------------------------- */

/**
 * One author's target for one feature.
 *
 * Note what is NOT a parameter: the house mean, the envelope, and k. They are
 * fetched by feature name from house-prior.js, so there is no route by which a
 * caller could hand this function a house number derived from technician data,
 * whether or not they meant to.
 *
 * @param {string} feature  a name from HOUSE_FEATURES
 * @param {{n:number,sum:number,sum_sq:number}|null} row  this author's sums
 * @returns {object} the target, the band, and the working that produced it
 */
export function authorTarget(feature, row) {
  const prior = housePrior(feature);
  const seen = summariseLevel(row, prior.evidence);

  /* n = 0 leaves authorMean standing in as the house mean.
   *
   * This changes no output today and the revert proof says so: summariseLevel
   * returns null for a cold author, null coerces to 0, and w is exactly 0, so
   * the multiply comes out at negative zero and the sum is the house mean
   * either way. It is written out because the n = 0 case is a promise this
   * module makes, and resting it on how null happens to coerce is resting it on
   * something no test would notice breaking. */
  const authorMean = seen.n > 0 ? seen.mean : prior.mean;
  const w = seen.n / (seen.n + prior.k);

  /* THE GREAT-DAY TERM. Only where the house says a better end exists, which
     is one feature today (house-prior.js, `direction`). Everywhere else the
     author term is their mean and this is a no-op, pinned by test: a personal
     feature pushed toward an end is someone made to write less like themselves.
     It goes in BEFORE shrinkage and the clamp, in that order, unchanged: shrink
     so it is bought with evidence, clamp last so a great day still writes
     inside the range the house will sign. */
  /* THE CAP, his ruling 2026-09-22. The lift is bought off the author's own
     spread, and the sums cannot tell scatter from range: two authors at the
     same mean landed at 0.70 and 0.99 by n = 40 because one varied more. So the
     spread the lift reads is capped at the house within-note sd, a house number
     from the prior that no row can supply. Scatter beyond what the house itself
     shows buys no extra lift. */
  const houseWithinSd = Math.sqrt(prior.within_var);
  const liftSd = seen.n > 1 ? Math.min(seen.sd, houseWithinSd) : 0;
  const capped = seen.n > 1 && seen.sd > houseWithinSd;
  const offset = prior.direction === "higher" && seen.n > 1
    ? GREAT_DAY_SDS * w * liftSd
    : 0;
  const greatDay = authorMean + offset;
  const shrunk = prior.mean + w * (greatDay - prior.mean);
  const value = Math.min(prior.ceiling, Math.max(prior.floor, shrunk));

  const half = BAND_SDS * Math.sqrt(prior.within_var);
  // The band is clipped to the envelope too. Without it a target sitting on the
  // ceiling would carry a band reaching past it, and a draft written outside
  // the range the house writes in would read as already fine.
  const band = [
    Math.max(prior.floor, value - half),
    Math.min(prior.ceiling, value + half),
  ];

  return {
    feature,
    n: seen.n,
    k: prior.k,
    w,
    houseMean: prior.mean,
    authorMean: seen.n > 0 ? seen.mean : null,
    direction: prior.direction,
    evidence: prior.evidence,
    offset,
    capped: prior.direction === "higher" && capped,
    greatDay: seen.n > 0 ? greatDay : null,
    shrunk,
    value,
    clamped: value !== shrunk,
    band,
    halfWidth: half,
    envelope: [prior.floor, prior.ceiling],
    source: seen.n > 0 ? "shrunk" : "house",
  };
}

/**
 * Every feature the house holds a prior for, for one author.
 * @param {Record<string, object>} rowsByFeature  missing features are cold, not an error
 */
export function authorTargets(rowsByFeature) {
  const rows = rowsByFeature || {};
  return HOUSE_FEATURES.map((feature) => authorTarget(feature, rows[feature] || null));
}

/* ---- the style budget ------------------------------------------------------ */

/** The rule: a move is earned by sitting outside the band, and by nothing else. */
export const OUT_OF_BAND = (value, band) => value < band[0] || value > band[1];

/**
 * Decide which moves this note may spend.
 *
 * `spendWhere` is a seam and not a setting. Left alone it is OUT_OF_BAND, which
 * is the rule. It is injectable because the in band audit below is otherwise
 * unfalsifiable: the rule guarantees the answer is zero, so a test cannot tell
 * a counter that is reading the moves from one that has been replaced by the
 * literal zero, and a number the caller trusts has to be one a test can make
 * move. Injecting a rule that spends everywhere is how the audit gets shown
 * doing its job.
 *
 * @param {object} args
 * @param {Array<object>} args.targets   from authorTargets
 * @param {Record<string, number>} args.measured  what this draft actually measures
 * @param {number} [args.budget]
 * @param {(value:number, band:[number,number]) => boolean} [args.spendWhere]
 * @returns {object}
 */
export function planStyleMoves({ targets, measured, budget, spendWhere } = {}) {
  const cap = Number.isFinite(budget) ? Math.max(0, Math.trunc(budget)) : MOVES_PER_NOTE;
  const list = Array.isArray(targets) ? targets : [];
  const draft = measured || {};
  const earnsAMove = typeof spendWhere === "function" ? spendWhere : OUT_OF_BAND;

  const candidates = [];
  const inBand = [];
  const unmeasured = [];
  const refused = [];

  for (const target of list) {
    /* A target whose band is not two real numbers used to disappear: every
       comparison against NaN is false, so it earned no move, was not in band
       and was not unmeasured either. It was in no list at all and the plan read
       as though the feature had never been asked about. Say so instead. */
    if (!target || !Array.isArray(target.band)
        || !Number.isFinite(target.band[0]) || !Number.isFinite(target.band[1])) {
      refused.push({ feature: (target && target.feature) || null, why: "band is not two numbers" });
      continue;
    }

    const value = draft[target.feature];
    if (!Number.isFinite(value)) {
      // A feature the draft did not produce a measurement for is not evidence
      // that it is fine. It gets no move and it is reported, rather than
      // counted as in band.
      unmeasured.push(target.feature);
      continue;
    }
    const [lo, hi] = target.band;
    if (value >= lo && value <= hi) inBand.push(target.feature);
    if (!earnsAMove(value, target.band)) continue;

    const excess = value < lo ? Math.max(0, lo - value) : Math.max(0, value - hi);
    candidates.push({
      feature: target.feature,
      direction: value < lo ? 1 : -1,
      measured: value,
      target: target.value,
      band: target.band,
      excess,
      // Normalised by the band's own half width, because these features are
      // measured on four different scales and a raw distance would rank them by
      // which unit happens to be largest.
      distanceSds: target.halfWidth > 0 ? excess / target.halfWidth : 0,
    });
  }

  // Furthest outside first, so a budget too small to fix everything is spent on
  // what a reader would notice. The name breaks a tie, so the same draft always
  // produces the same plan.
  candidates.sort((a, b) => b.distanceSds - a.distanceSds || a.feature.localeCompare(b.feature));

  const moves = candidates.slice(0, cap);

  return {
    moves,
    spent: moves.length,
    budget: cap,
    withheld: candidates.slice(cap).map((c) => c.feature),
    inBand,
    unmeasured,
    refused,
    inBandMoves: countInBandMoves(moves),
  };
}

/**
 * The audit: how many of these moves were aimed at a feature the draft had
 * already got right.
 *
 * SEPARATE AND EXPORTED ON PURPOSE. Inlined in planStyleMoves it was a counter
 * that could only ever report zero, because the filter above it guarantees the
 * answer, and a check that cannot come back non zero is indistinguishable from
 * one that never ran. Reverting its body changed no test. Out here a test can
 * hand it a move that IS in band and watch it say so, which is what makes the
 * zero coming back from a real plan mean something.
 *
 * Zero is the whole claim. A budget spent on a feature the author already had
 * right is the tool talking someone out of their own voice, and this is the
 * number that would say so.
 *
 * @param {Array<{measured:number, band:[number,number]}>} moves
 */
export function countInBandMoves(moves) {
  let count = 0;
  for (const move of moves || []) {
    const [lo, hi] = move.band;
    if (move.measured >= lo && move.measured <= hi) count += 1;
  }
  return count;
}
