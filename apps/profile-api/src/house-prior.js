/**
 * The house prior: where an author's voice estimate starts before that author
 * has written anything.
 *
 * THE RULING THIS FILE EXISTS TO ENFORCE. The house prior is NOT the mean over
 * technicians. The maintainer's words: "I don't really want BTs teaching the
 * system anything but their style." A technician's observations move THEIR OWN
 * estimate away from this prior and they move nothing else, ever. Pooling
 * technicians would make every technician's target drift toward whatever the
 * busiest writers happen to do, which is the opposite of learning one person's
 * voice, and it would quietly carry one person's habits into another person's
 * note.
 *
 * WHY THAT IS STRUCTURAL HERE RATHER THAN WRITTEN DOWN AND HOPED FOR. A comment
 * is not a control. Two things enforce the ruling:
 *
 *   1. `housePrior` takes exactly one argument and it must be a feature name
 *      from a closed list. There is no parameter an observation could arrive
 *      through, whatever the caller intends, so the refusal does not depend on
 *      anyone reading this comment.
 *
 *   2. `buildHousePrior` parses its entries against an ALLOWLIST of keys and a
 *      CLOSED enum of provenances. An entry carrying a `kid`, an author, a
 *      sample of observations or any key this file does not name is refused,
 *      and a provenance outside the enum is refused rather than admitted with a
 *      warning. Both fail closed: a shape nobody anticipated is rejected, not
 *      waved through.
 *
 * WHAT MAY SOURCE A PRIOR. Two provenances only. `maintainer_bar` is the
 * maintainer's own stated rule for how these notes should read; it is a bar,
 * not a measurement, and the entries say so. `bcba_authored` is material a BCBA
 * wrote, measured. Nothing a technician typed is in either.
 *
 * THE ENVELOPE. Each entry owns a [floor, ceiling]. It is applied AFTER
 * shrinkage in voice-shrink.js, so an author with a great deal of evidence
 * still cannot pull their own target outside the range the house will write in.
 * Two of the floors are load bearing rather than tidy and are marked as such.
 */

/**
 * Closed enum. A provenance not on this list is refused, which is what makes it
 * a capability limit rather than a label: adding a technician channel would
 * mean editing this array, in a diff, on purpose.
 */
export const HOUSE_PROVENANCE = Object.freeze(["maintainer_bar", "bcba_authored"]);

/**
 * Allowlist of keys a corpus entry may carry. Anything else is refused.
 *
 * An allowlist rather than a denylist of author-bearing names, because a
 * denylist has to already know the name of the field that will one day carry a
 * technician's observations, and it will not.
 */
const ENTRY_KEYS = Object.freeze([
  "feature", "label", "mean", "within_var", "between_var", "floor", "ceiling",
  "provenance", "basis",
]);

/* The corpus.
 *
 * within_var is the variance of ONE author's note to note measurements around
 * that author's own mean. between_var is the variance of author MEANS around
 * the house mean. Their ratio is the k in w = n / (n + k), so k is how many
 * notes an author has to write before their own mean carries as much weight as
 * the house's.
 *
 * WHAT IS MEASURED AND WHAT IS A BAR, stated per entry, because these are not
 * the same kind of number and a reader must not have to guess which they are
 * looking at. The within_var figures for within_cv and step_rel come from the
 * 108 document corpus behind shape.js, 101 of which are one author's, so that
 * spread is a fair reading of one author's note to note noise. NO corpus in
 * this repo measures how far author MEANS sit from each other, so every
 * between_var below is a house setting with its reason written out. Replacing
 * one with a measurement needs a repeated measures corpus: several authors,
 * several notes each. Until that exists, do not present these as measured.
 */
const CORPUS = [
  {
    feature: "within_cv",
    label: "Sentence length variability inside a section",
    // shape.js HUMAN_WITHIN_CV_MEAN, measured over 108 documents.
    mean: 0.465,
    // shape.js HUMAN_WITHIN_CV_SD 0.066, squared.
    within_var: 0.004356,
    /* House setting: twice the within figure, so k = 0.5 and an author's own
       mean outweighs the house's after a single note. shape.js is explicit that
       variability "barely moves across classes, so the cv columns are
       effectively personal", and a measure that is personal is one where
       authors differ from each other more than one author differs from
       themselves. */
    between_var: 0.008712,
    // shape.js WITHIN_CV_FLOOR / WITHIN_CV_CEILING, the 1st and 99th percentile
    // of the corpus rather than its min and max.
    floor: 0.336,
    ceiling: 0.600,
    provenance: "bcba_authored",
    basis: "108 documents behind shape.js, 101 coursework and 7 clinical plans",
  },
  {
    feature: "step_rel",
    label: "Step in average sentence length between sections",
    mean: 0.309,            // shape.js HUMAN_STEP_MEAN
    within_var: 0.0144,     // shape.js HUMAN_STEP_SD 0.120, squared
    /* House setting: a quarter of the within figure, so k = 4 and an author
       needs four notes before their own step carries half the weight. The step
       is the one number in shape.js that transfers across registers, 0.296 in
       coursework against 0.297 in clinical plans, on corpora whose mean
       sentence lengths are 20.7 and 12.0 words. A quantity that stable across
       document classes is unlikely to be where people differ most from each
       other, so the house holds it longer. */
    between_var: 0.0036,
    floor: 0.104,           // shape.js STEP_FLOOR
    ceiling: 0.584,         // shape.js STEP_CEILING
    provenance: "bcba_authored",
    basis: "108 documents behind shape.js, 101 coursework and 7 clinical plans",
  },
  {
    feature: "actor_naming",
    label: "Sentences that name who performed the step, per sentence",
    /* A BAR, not a measurement. The maintainer's first voice rule: name the
       actor and the condition, and actorless procedure is how a note stops
       sounding like the person who wrote it. 0.85 is most sentences naming
       someone, which is what that rule asks for without demanding it of a
       sentence that genuinely has no actor. */
    mean: 0.85,
    // House settings. An sd of 0.30 either side is roughly a third of a
    // sentence in ten, which is the smallest movement worth calling a
    // difference in how someone attributes. Equal within and between puts k at
    // 1, the neutral case: one note buys half the weight.
    within_var: 0.09,
    between_var: 0.09,
    /* LOAD BEARING FLOOR. The reporting barrier is the thing these tools must
       not erode. An author who strips attributions out of every note must not
       be able to teach the tool to write notes that never say who did anything,
       so their own estimate stops here however much evidence they bring. */
    floor: 0.40,
    ceiling: 1.30,
    provenance: "maintainer_bar",
    basis: "maintainer voice rule 1, name the actor and the condition",
  },
  {
    feature: "hedging",
    label: "Hedging words per word",
    /* A BAR. The maintainer hedges where the observation was genuinely
       uncertain and nowhere else, so the house sits low but not at zero. */
    mean: 0.012,
    within_var: 0.0004,   // house setting, sd 0.02
    /* House setting, sd 0.04, so k = 0.25 and an author's own rate takes over
       almost at once. How much someone hedges is close to the definition of a
       personal register choice, and it is one of the few here a reader would
       recognise as that person's. */
    between_var: 0.0016,
    /* LOAD BEARING FLOOR. Marking an unknown as unknown is a house requirement
       and not a style preference: the maintainer's rule is never to smooth an
       uncertain observation into a confident sentence. An author whose every
       note is flat assertion cannot drive their own target to zero hedging. */
    floor: 0.004,
    ceiling: 0.045,
    provenance: "maintainer_bar",
    basis: "maintainer voice rule 5, mark uncertainty as uncertainty",
  },
];

function refuse(why) {
  throw new TypeError("house prior: " + why);
}

/**
 * Parse corpus entries into the frozen prior.
 *
 * Exported so a test can drive every route a technician observation could take
 * into a house number and watch each one refuse. It is not called anywhere but
 * at the bottom of this file.
 *
 * @param {Array<object>} entries
 * @returns {Readonly<Record<string, Readonly<object>>>}
 */
export function buildHousePrior(entries) {
  if (!Array.isArray(entries)) refuse("entries must be an array");

  const out = Object.create(null);
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      refuse("every entry must be a plain object");
    }

    // Allowlist first, so an entry carrying an author, a kid, a sample of
    // observations or any field this file does not name never reaches the
    // arithmetic below.
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.includes(key)) {
        refuse("entry carries a key the house does not define: " + key);
      }
    }
    for (const key of ENTRY_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(entry, key)) {
        refuse("entry is missing " + key);
      }
    }

    if (!HOUSE_PROVENANCE.includes(entry.provenance)) {
      refuse("provenance is not one the house accepts: " + String(entry.provenance));
    }
    if (typeof entry.feature !== "string" || !entry.feature) {
      refuse("feature must be a non empty string");
    }
    if (out[entry.feature]) refuse("feature declared twice: " + entry.feature);

    for (const key of ["mean", "within_var", "between_var", "floor", "ceiling"]) {
      if (!Number.isFinite(entry[key])) refuse(entry.feature + "." + key + " must be a finite number");
    }
    if (entry.within_var <= 0) refuse(entry.feature + ".within_var must be above zero");
    // Zero here would divide by zero in k, and a negative one is not a variance.
    if (entry.between_var <= 0) refuse(entry.feature + ".between_var must be above zero");
    if (!(entry.floor <= entry.mean && entry.mean <= entry.ceiling)) {
      refuse(entry.feature + " mean sits outside its own envelope");
    }

    out[entry.feature] = Object.freeze({
      feature: entry.feature,
      label: entry.label,
      mean: entry.mean,
      within_var: entry.within_var,
      between_var: entry.between_var,
      floor: entry.floor,
      ceiling: entry.ceiling,
      provenance: entry.provenance,
      basis: entry.basis,
      // k = withinVariance / betweenVariance, the shrinkage constant. Computed
      // once here so no caller can supply a different one.
      k: entry.within_var / entry.between_var,
    });
  }
  return Object.freeze(out);
}

const HOUSE_PRIOR = buildHousePrior(CORPUS);

/** The closed list of features the house holds a prior for. */
export const HOUSE_FEATURES = Object.freeze(Object.keys(HOUSE_PRIOR));

/**
 * The house prior for one feature.
 *
 * ARITY IS THE CONTROL. One argument, a string from HOUSE_FEATURES. There is no
 * second parameter, so there is nothing for a caller to pass observations
 * through, and passing a second argument anyway is refused rather than ignored.
 * Ignoring it would let a caller believe their data was being used.
 *
 * @param {string} feature
 * @returns {Readonly<object>} frozen, so a caller cannot edit the house either
 */
export function housePrior(feature) {
  if (arguments.length !== 1) {
    refuse("housePrior takes a feature name and nothing else, got " + arguments.length + " arguments");
  }
  if (typeof feature !== "string") {
    refuse("housePrior takes a feature name, got " + (feature === null ? "null" : typeof feature));
  }
  const prior = HOUSE_PRIOR[feature];
  if (!prior) refuse("no house prior for feature " + feature);
  return prior;
}

export { HOUSE_PRIOR };
