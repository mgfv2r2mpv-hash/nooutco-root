/* Sentence shape targeting, scoped to the section rather than to the note.
 *
 * WHAT THE FIRST VERSION GOT WRONG. It gave the model one target: a coefficient
 * of variation in sentence length for the whole note. One number cannot pin the
 * shape, and the corpus says so plainly. Across 108 human documents:
 *
 *   r(whole-document CV, within-section CV)  0.448
 *   r(whole-document CV, between-section step) 0.384
 *   r(within-section CV, between-section step) 0.096
 *
 * The whole-document figure is a MIXTURE of two things that are themselves
 * almost unrelated to each other. So a note can hit it either way, and the
 * evidence that this is not a theoretical worry: 21 human documents sit at a
 * whole-document CV of 0.60 give or take 0.03, and among just those, sentences
 * inside a section vary anywhere from 0.373 to 0.583 while the step between
 * sections runs from 0.071 to 0.389. Same target, opposite shapes. A model
 * given that one number picks whichever decomposition is cheapest to produce.
 *
 * THE MAINTAINER'S FRAMING, which is what suggested measuring this at all:
 * "burstiness should be scoped to the domains / areas spoken about. When I
 * switch topic that is when my rhythm or effort is likeliest to pivot, I am
 * changing gears and have to spin up again."
 *
 * WHAT THE MEASUREMENT SUPPORTS. The step is the most portable number in the
 * whole set. Coursework lands on 0.296 and clinical plans on 0.297, across
 * corpora whose mean sentence lengths are 20.7 and 12.0 words. Nothing else
 * here transfers like that: whole-document CV runs 0.592 against 0.665 and
 * within-section CV 0.459 against 0.510 between the same two corpora.
 *
 * WHAT IS NOT CLAIMED, because it did not survive measurement. An earlier draft
 * of this comment said the generated notes read flat INSIDE their sections and
 * put a number on it. Neither archived note supports that under these rules.
 * One was saved without its blank lines, so it is a single section and cannot
 * answer the question at all; the other measures 0.486 inside its sections and
 * 0.324 between them, both squarely human. The case for two targets is the
 * structural one above, which holds whatever any particular note measured. Do
 * not re-add an empirical claim here without a note that can carry it.
 *
 * WHAT IS PERSONAL AND WHAT IS NOT. Mean sentence length is a property of the
 * document class: the same author writes around 21 words a sentence in academic
 * prose and 12 in a clinical plan. Variability barely moves across that
 * boundary. Hence one row per technician PER TOOL, and hence the cold start
 * defaults below are a measured human baseline rather than a neutral one.
 *
 * COLD START. The maintainer's observation, which simplifies this a lot: having
 * a spread at all is not unique to any one person, it is what being human looks
 * like. So a technician with no history is not a blank. They get the human
 * baseline immediately and their own numbers displace it as evidence arrives.
 *
 * ONE DIALECT ONLY. Every constant here was computed with the exact tokenizer,
 * word rule and section rule in apps/tools/notes/bcba/note-metrics.js, because
 * the browser is what feeds this profile. An earlier pass measured the corpus
 * with a splitter that did not treat a newline as a sentence boundary, and on a
 * bulleted note that single difference moved the within-section figure from
 * 0.362 to 0.486. Change one side and you must change the other.
 */

/* Measured across 108 documents: 101 coursework, 7 clinical plans.
 *
 * Clamps are the 1st and 99th percentile rather than the observed minimum and
 * maximum, because a clamp built on min and max is a clamp built on one
 * document. */
export const HUMAN_WITHIN_CV_MEAN = 0.465; // median 0.461, so barely skewed
export const HUMAN_WITHIN_CV_SD = 0.066;
export const WITHIN_CV_FLOOR = 0.336;
export const WITHIN_CV_CEILING = 0.600;

/* The step from one section's average sentence length to the next, as a share
 * of the average across sections, so it compares across registers. */
export const HUMAN_STEP_MEAN = 0.309; // median 0.296; mildly right skewed
export const HUMAN_STEP_SD = 0.120;
export const STEP_FLOOR = 0.104;
export const STEP_CEILING = 0.584;

// Below this many notes a per person mean is noise, so the human baseline is
// used instead. Five is where the standard error of the mean drops under the
// spread it is trying to estimate.
export const MIN_NOTES = 5;

/* A floor on each spread, and it is load bearing rather than defensive.
 *
 * If a technician's notes happen to land on the same variability, their
 * measured sd is zero, and a zero sd makes every target identical. That is
 * precisely the flatness this whole mechanism exists to prevent, arrived at by
 * a different route. Half the human spread is the least that still reads as a
 * person rather than as a setting. */
export const MIN_WITHIN_CV_SD = HUMAN_WITHIN_CV_SD / 2;
export const MIN_STEP_SD = HUMAN_STEP_SD / 2;

/** Mean length by document class, for a technician with no history of their own.
 *  The clinical plan corpus measures 12.0 to 13.0 words depending on whether a
 *  bulleted line counts as its own sentence, so 13 is kept rather than re-tuned
 *  across a difference that small. Session notes have no measured corpus yet and
 *  inherit the plan figure rather than an invented one. */
export const CLASS_MEAN_LEN = { sap: 13, bt: 13, sup: 13, assess: 13, parent: 13 };

/** Fold one note's measurement into the running accumulators.
 *  @param {object|null} row      previous accumulators, or null
 *  @param {number} meanLen       mean sentence length across the whole note
 *  @param {number} withinCv      variability INSIDE a section, pooled
 *  @param {number} stepRel       mean step between section averages, divided by
 *                                the average OF those averages
 */
export function accumulate(row, meanLen, withinCv, stepRel) {
  const n = (row && row.n_notes) || 0;
  return {
    n_notes: n + 1,
    sum_len: ((row && row.sum_len) || 0) + meanLen,
    sum_cv: ((row && row.sum_cv) || 0) + withinCv,
    sum_cv_sq: ((row && row.sum_cv_sq) || 0) + withinCv * withinCv,
    sum_step: ((row && row.sum_step) || 0) + stepRel,
    sum_step_sq: ((row && row.sum_step_sq) || 0) + stepRel * stepRel,
  };
}

/** Mean and sample sd from running sums, without keeping any per note history. */
function moments(sum, sumSq, n) {
  if (!n) return { mean: null, sd: null };
  const mean = sum / n;
  // Population variance from the running sums. Guarded, because floating point
  // can drive a variance that should be zero very slightly negative.
  const variance = Math.max(0, sumSq / n - mean * mean);
  // The sample sd is what matters for a spread, so Bessel correct it.
  return { mean, sd: n > 1 ? Math.sqrt((variance * n) / (n - 1)) : 0 };
}

/** Turn accumulators into the numbers the two targets are drawn from. */
export function summarise(row) {
  const n = (row && row.n_notes) || 0;
  if (!n) {
    return { n: 0, meanLen: null, cvMean: null, cvSd: null, stepMean: null, stepSd: null };
  }
  const cv = moments(row.sum_cv || 0, row.sum_cv_sq || 0, n);
  const step = moments(row.sum_step || 0, row.sum_step_sq || 0, n);
  return {
    n,
    meanLen: (row.sum_len || 0) / n,
    cvMean: cv.mean,
    cvSd: cv.sd,
    stepMean: step.mean,
    stepSd: step.sd,
  };
}

/* A deterministic generator, seeded per note.
 *
 * Math.random would make two identical requests produce different targets,
 * which makes a bug impossible to reproduce and a test impossible to write. The
 * seed is the note's own identity, so the same note always draws the same
 * target and a different note draws a different one. */
function seeded(seed) {
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h ^= h << 13; h >>>= 0;
    h ^= h >> 17;
    h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };
}

/** Box-Muller, so the draw is normal rather than flat. A flat draw would put as
 *  much weight on the extremes as on the middle, which no writer does. */
function normal(rand) {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* One draw, clamped to the range the corpus actually produced. An unbounded
   normal eventually emits a target no human wrote, and then the tails belong to
   the distribution rather than to a person. */
function draw(mean, sd, floor, ceiling, seed) {
  const x = mean + normal(seeded(seed)) * sd;
  return Math.min(ceiling, Math.max(floor, x));
}

/**
 * The target for one note.
 * @param {object|null} row  shape_profile row, or null for a new technician
 * @param {string} tool
 * @param {string} seed      anything stable per note; the note's own id is ideal
 */
export function targetFor(row, tool, seed) {
  const s = summarise(row);
  const enough = s.n >= MIN_NOTES;
  // A technician's own spread only becomes usable later than their own mean,
  // because a standard deviation needs more evidence than an average.
  const spreadReady = s.n >= MIN_NOTES * 2;

  const cvMean = enough && s.cvMean ? s.cvMean : HUMAN_WITHIN_CV_MEAN;
  const cvSd = Math.max(MIN_WITHIN_CV_SD, (spreadReady ? s.cvSd : HUMAN_WITHIN_CV_SD) || 0);
  const stepMean = enough && s.stepMean ? s.stepMean : HUMAN_STEP_MEAN;
  const stepSd = Math.max(MIN_STEP_SD, (spreadReady ? s.stepSd : HUMAN_STEP_SD) || 0);
  const meanLen = enough && s.meanLen ? s.meanLen : (CLASS_MEAN_LEN[tool] || 13);

  /* Two draws off two seeds rather than two draws off one stream, and the
     corpus is the reason rather than tidiness. Within-section variability and
     the size of the gear change between sections correlate at 0.096 across 108
     human documents, which is as close to unrelated as two measurements of the
     same text get. They are two axes, so they get two independent draws; a
     shared stream would couple them for reasons that belong to the generator
     rather than to any writer. */
  const withinCv = draw(cvMean, cvSd, WITHIN_CV_FLOOR, WITHIN_CV_CEILING, seed + ":within");
  const stepRel = draw(stepMean, stepSd, STEP_FLOOR, STEP_CEILING, seed + ":step");

  const r3 = (x) => Math.round(x * 1000) / 1000;
  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    meanLen: r1(meanLen),
    withinCv: r3(withinCv),
    // Roughly what each coefficient means in words, which is the only form the
    // model can act on. Nobody writes toward a coefficient of variation.
    withinSdWords: r1(withinCv * meanLen),
    stepRel: r3(stepRel),
    /* stepRel is measured against the average OF the section averages and this
       converts it using the note's mean sentence length, which are not the same
       denominator. Across 108 human documents they sit within 3.6% of each
       other at the median and 10% at the tails, and the instruction says "about
       N words", so the approximation is inside its own rounding. */
    stepWords: r1(stepRel * meanLen),
    source: enough ? "learned" : "human baseline",
    n: s.n,
  };
}

/** The instruction block. Written in words a model can follow. */
export function renderShapeBlock(target) {
  if (!target) return "";
  const short = Math.max(4, Math.round(target.meanLen - target.withinSdWords));
  const long = Math.round(target.meanLen + target.withinSdWords);
  return [
    "",
    "SENTENCE LENGTH, MEASURED FROM HUMAN WRITING IN THIS FORMAT.",
    `Average about ${target.meanLen} words per sentence across the whole note.`,
    `INSIDE one section, do not make them uniform. Most sentences there should fall between roughly ${short} and ${long} words, and a few should sit outside that on either side. Put a short one next to a long one deliberately, the way someone writing quickly actually does.`,
    `BETWEEN sections, the average itself moves. Expect each section to run about ${target.stepWords} words longer or shorter on average than the one before it, because changing topic is where a writer changes gear. Those moves are uneven: some boundaries barely shift the rhythm and one or two shift it a lot.`,
    "Both halves matter and they fail differently. A run of sentences all close to the average is the clearest single sign a note was generated. A note whose sections each read at one flat pace, with all the variety sitting between them rather than inside them, is the second clearest.",
  ].join("\n");
}
