/**
 * The closed list of style features, and the sentences a learned rule turns into.
 *
 * This file is the contract between the browser (which measures a diff and emits
 * a feature name plus a direction) and the prompt (which receives an English
 * instruction). Nothing else crosses that boundary -- no words, no phrases, no
 * clinical text. If a feature cannot be expressed as "this person consistently
 * moves in direction X", it does not belong here.
 *
 * The rule text matters more than it looks. It is injected into the system
 * prompt verbatim, so it has to read as an instruction to a writer, and it must
 * never contradict the non-negotiable house rules -- those win, and the prompt
 * says so explicitly.
 */

export const FEATURES = {
  sentence_length: {
    label: "Sentence length",
    "-1": "Keep sentences short. This technician consistently trims long sentences, so favour a plain declarative over a subordinate clause where the meaning survives the cut.",
    "1": "Let sentences run longer where they earn it. This technician consistently expands terse sentences to add the conditions and context a reader would otherwise have to infer.",
  },
  plain_wording: {
    label: "Plain wording",
    "-1": "Prefer the everyday word. This technician consistently replaces elevated or Latinate phrasing with plain equivalents.",
    "1": "Keep the precise clinical register. This technician consistently restores technical vocabulary that had been simplified away.",
  },
  actor_naming: {
    label: "Naming the actor",
    "-1": "Keep attributions light. This technician consistently trims repeated references to who performed each step once the actor is already established.",
    "1": "Name who did what. This technician consistently rewrites actorless procedural sentences to say which person carried out the step.",
  },
  hedging: {
    label: "Hedging",
    "-1": "State observations directly. This technician consistently removes hedges such as 'appeared to' or 'seemed to' in favour of what was observed.",
    "1": "Preserve appropriate tentativeness. This technician consistently softens flat assertions where the observation genuinely was uncertain.",
  },
  contractions: {
    label: "Contractions",
    "-1": "Write contractions out in full. This technician consistently expands them.",
    "1": "Contractions are fine. This technician consistently introduces them, so do not write stiffly around them.",
  },
  clause_density: {
    label: "Clause density",
    "-1": "Break compound sentences apart. This technician consistently splits multi-clause sentences into separate statements.",
    "1": "Join related statements. This technician consistently combines short adjacent sentences that share a subject.",
  },
  quantification: {
    label: "Quantification",
    "-1": "Do not manufacture precision. This technician consistently removes counts and percentages that the intake did not supply.",
    "1": "Carry the numbers through. This technician consistently adds the counts, durations and trial totals that the intake supplied.",
  },
  opener_variety: {
    label: "Opener variety",
    "-1": "Do not manufacture a fresh opening. This technician consistently settles reworded sentence openings back onto the plain construction, so leave an opening that already reads naturally rather than recasting it only to avoid an echo.",
    "1": "Vary where each sentence enters. This technician consistently rewrites sentences that begin the same way as the one before, so change the subject or the construction each sentence opens on.",
  },
};

export const FEATURE_NAMES = Object.keys(FEATURES);

/** Evidence bar before a signal is allowed to become a rule at all. */
export const MIN_EVIDENCE = 5;

/**
 * How one-sided the evidence has to be. At 0.7, five corrections pointing the
 * same way makes a rule; three-against-two never does. This is deliberately
 * strict -- a wrong rule silently degrades every note the technician writes,
 * and they have no way to tell it is the cause.
 */
export const MIN_CONFIDENCE = 0.7;

/** Cap on rules injected into a prompt, strongest first. */
export const MAX_RULES = 6;

export function isFeature(name) {
  return Object.prototype.hasOwnProperty.call(FEATURES, name);
}

export function ruleText(feature, direction) {
  const f = FEATURES[feature];
  if (!f) return null;
  return f[String(direction)] || null;
}
