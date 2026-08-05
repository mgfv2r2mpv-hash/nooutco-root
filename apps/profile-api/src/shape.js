/* Sentence shape targeting.
 *
 * THE PROBLEM. Generated notes sit at a coefficient of variation of 0.42 to
 * 0.45 in sentence length. Across 103 documents of real human writing the same
 * measure runs 0.49 to 0.68. The machine output is not at the low end of the
 * human range, it is outside it, and no instruction to "vary sentence length"
 * moved it. Telling a model to vary without a number made it write longer and
 * more elaborate sentences instead, which went the wrong way.
 *
 * THE FIX. Give it a number. Then, because a hundred notes all hitting the same
 * number is its own signature, sample that number from a spread rather than
 * using the mean every time.
 *
 *   fixed target at the mean       CV sd across notes = 0.000   flat
 *   sampled from a human spread    CV sd across notes = 0.088   human
 *   real documents                 CV sd across notes = 0.088
 *
 * WHAT IS PERSONAL AND WHAT IS NOT. Mean sentence length is a property of the
 * document class: the same author writes 20.9 words a sentence academically and
 * 13.0 in a clinical plan. Variability barely moves across that boundary, so
 * cv_mean is close to a personal trait and mean length is not. Hence one row
 * per technician PER TOOL, and hence the cold start defaults below are a human
 * baseline rather than a neutral one.
 *
 * COLD START. The maintainer's observation, which simplifies this a lot: having
 * a spread at all is not unique to any one person, it is what being human looks
 * like. So a technician with no history is not a blank. They get the measured
 * human baseline immediately and their own numbers displace it as evidence
 * arrives.
 */

// Measured across 103 documents, one tokenizer throughout. These are the
// fallback for a technician with too little history to have their own numbers.
export const HUMAN_CV_MEAN = 0.583;
export const HUMAN_CV_SD = 0.088;
// Observed range across the same corpus. Sampling is clamped to it, because an
// unbounded normal eventually emits a target no human produced, and then the
// tails belong to the distribution rather than to a person.
export const CV_FLOOR = 0.391;
export const CV_CEILING = 0.952;

// Below this many notes a per person mean is noise, so the human baseline is
// used instead. Five is where the standard error of the mean drops under the
// spread it is trying to estimate.
export const MIN_NOTES = 5;

/* A floor on the spread, and it is load bearing rather than defensive.
 *
 * If a technician's notes happen to land on the same variability, their
 * measured sd is zero, and a zero sd makes every target identical. That is
 * precisely the flatness this whole mechanism exists to prevent, arrived at by
 * a different route. Half the human spread is the least that still reads as a
 * person rather than as a setting. */
export const MIN_CV_SD = HUMAN_CV_SD / 2;

/** Mean length by document class, for a technician with no history of their own.
 *  Clinical plans measured at 13.0; session notes have no measured corpus yet,
 *  so they inherit the plan figure rather than an invented one. */
export const CLASS_MEAN_LEN = { sap: 13, bt: 13, sup: 13, assess: 13, parent: 13 };

/** Fold one note's measurement into the running accumulators. */
export function accumulate(row, meanLen, cv) {
  const n = (row && row.n_notes) || 0;
  return {
    n_notes: n + 1,
    sum_len: ((row && row.sum_len) || 0) + meanLen,
    sum_cv: ((row && row.sum_cv) || 0) + cv,
    sum_cv_sq: ((row && row.sum_cv_sq) || 0) + cv * cv,
  };
}

/** Turn accumulators into the numbers a target is drawn from. */
export function summarise(row) {
  const n = (row && row.n_notes) || 0;
  if (!n) return { n: 0, meanLen: null, cvMean: null, cvSd: null };
  const meanLen = row.sum_len / n;
  const cvMean = row.sum_cv / n;
  // Population variance from the running sums. Guarded, because floating point
  // can drive a variance that should be zero very slightly negative.
  const variance = Math.max(0, row.sum_cv_sq / n - cvMean * cvMean);
  // The sample sd is what matters for a spread, so Bessel correct it.
  const cvSd = n > 1 ? Math.sqrt((variance * n) / (n - 1)) : 0;
  return { n, meanLen, cvMean, cvSd };
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

/**
 * The target for one note.
 * @param {object|null} row  shape_profile row, or null for a new technician
 * @param {string} tool
 * @param {string} seed      anything stable per note; the note's own id is ideal
 */
export function targetFor(row, tool, seed) {
  const s = summarise(row);
  const enough = s.n >= MIN_NOTES;
  const cvMean = enough && s.cvMean ? s.cvMean : HUMAN_CV_MEAN;
  // A technician's own spread only becomes usable later than their own mean,
  // because a standard deviation needs more evidence than an average.
  const learnedSd = enough && s.n >= MIN_NOTES * 2 ? s.cvSd : HUMAN_CV_SD;
  // Never let a person's own numbers collapse the spread to nothing.
  const cvSd = Math.max(MIN_CV_SD, learnedSd || 0);
  const meanLen = enough && s.meanLen ? s.meanLen : (CLASS_MEAN_LEN[tool] || 13);

  const draw = cvMean + normal(seeded(seed)) * cvSd;
  const cv = Math.min(CV_CEILING, Math.max(CV_FLOOR, draw));

  return {
    cv: Math.round(cv * 1000) / 1000,
    meanLen: Math.round(meanLen * 10) / 10,
    // Roughly what that CV means in words, which is the only form the model can
    // actually act on. A CV is not something you can write to.
    sdWords: Math.round(cv * meanLen * 10) / 10,
    source: enough ? "learned" : "human baseline",
    n: s.n,
  };
}

/** The instruction block. Written in words a model can follow, because a
 *  coefficient of variation is not something anyone can write toward. */
export function renderShapeBlock(target) {
  if (!target) return "";
  const short = Math.max(4, Math.round(target.meanLen - target.sdWords));
  const long = Math.round(target.meanLen + target.sdWords);
  return [
    "",
    "SENTENCE LENGTH, MEASURED FROM HUMAN WRITING IN THIS FORMAT.",
    `Average about ${target.meanLen} words per sentence across the whole note.`,
    `Do not make them uniform. Most sentences should fall between roughly ${short} and ${long} words, and a few should sit outside that on either side.`,
    "A run of sentences that are all close to the average is the single clearest sign a note was generated. Put a short one next to a long one deliberately, the way someone writing quickly actually does.",
  ].join("\n");
}
