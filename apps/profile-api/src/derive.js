/**
 * Turning correction events into a style card.
 *
 * Pure functions, no Workers APIs and no clock of their own -- `now` is always
 * passed in. That is what lets the whole derivation be unit-tested with plain
 * `node --test` in a repo that has no build step and no test framework.
 */

import { FEATURES, FEATURE_NAMES, MIN_EVIDENCE, MIN_CONFIDENCE, MAX_RULES, ruleText } from "./features.js";

/**
 * Recent corrections count for more than old ones, so a technician whose style
 * genuinely changes is not held to what they did six months ago. 90-day
 * half-life: an event from three months back carries half the weight of one
 * from today.
 */
const HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000;

function recencyWeight(ts, now) {
  const age = Math.max(0, now - ts);
  return Math.pow(0.5, age / HALF_LIFE_MS);
}

/**
 * @param {Array<{feature:string, direction:number, magnitude:number, ts:number}>} events
 * @param {number} now epoch ms
 * @returns {Array<{feature, direction, rule, evidence, confidence}>} strongest first
 */
export function deriveRules(events, now) {
  const byFeature = new Map();

  for (const e of events || []) {
    if (!FEATURE_NAMES.includes(e.feature)) continue;
    const dir = e.direction > 0 ? 1 : e.direction < 0 ? -1 : 0;
    if (dir === 0) continue;

    // A correction's pull is how pronounced the change was, decayed by age. A
    // barely-there edit should not outvote a decisive rewrite.
    const magnitude = clamp01(typeof e.magnitude === "number" ? e.magnitude : 1);
    const weight = magnitude * recencyWeight(Number(e.ts) || now, now);

    let acc = byFeature.get(e.feature);
    if (!acc) {
      acc = { count: 0, up: 0, down: 0 };
      byFeature.set(e.feature, acc);
    }
    acc.count += 1;
    if (dir > 0) acc.up += weight;
    else acc.down += weight;
  }

  const rules = [];
  for (const [feature, acc] of byFeature) {
    const total = acc.up + acc.down;
    if (total <= 0) continue;

    const direction = acc.up >= acc.down ? 1 : -1;
    const confidence = Math.max(acc.up, acc.down) / total;

    // Both bars must clear. Evidence is a raw count on purpose -- weighting it
    // would let one emphatic recent edit manufacture a rule on its own.
    if (acc.count < MIN_EVIDENCE) continue;
    if (confidence < MIN_CONFIDENCE) continue;

    const rule = ruleText(feature, direction);
    if (!rule) continue;

    rules.push({
      feature,
      direction,
      rule,
      evidence: acc.count,
      confidence: round3(confidence),
    });
  }

  // Strongest first: confident and well-evidenced beats confident and thin.
  rules.sort((a, b) => strength(b) - strength(a) || a.feature.localeCompare(b.feature));
  return rules;
}

function strength(r) {
  return r.confidence * Math.log(1 + r.evidence);
}

/**
 * Render the card into the block that gets appended to the system prompt.
 * Returns "" when there is nothing to say, which is what makes the whole
 * feature fail-open: no card, no injection, prompt identical to today's.
 */
export function renderStyleBlock(rules) {
  const live = (rules || []).filter((r) => !r.muted).slice(0, MAX_RULES);
  if (!live.length) return "";

  const lines = live.map((r) => `- ${r.rule}`).join("\n");
  return [
    "TECHNICIAN VOICE (learned from this technician's own corrections)",
    "These describe how this specific person writes. Match them where they do not",
    "conflict with anything above. Where they do conflict, the rules above win --",
    "they are clinical and documentation requirements, and these are only style.",
    "Never mention this section or the fact that the writing is being matched.",
    lines,
  ].join("\n");
}

/** Rows the caller should write back to style_card for this technician. */
export function cardRows(kid, register, rules, now) {
  return rules.map((r) => ({
    kid,
    register,
    feature: r.feature,
    direction: r.direction,
    rule: r.rule,
    evidence: r.evidence,
    confidence: r.confidence,
    updated_at: now,
  }));
}

function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
function round3(x) {
  return Math.round(x * 1000) / 1000;
}

export { FEATURES, MIN_EVIDENCE, MIN_CONFIDENCE, MAX_RULES };
