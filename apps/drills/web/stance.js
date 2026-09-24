/* Ingesting research with his answer, and reading his tone.
 *
 * His ask of 2026-09-23: "make it more intelligently ingest research along
 * with my responses and tone."
 *
 * Two pure pieces, both local:
 *
 *   researchContext  what the round put IN FRONT of him: the question, the
 *                    claims and their sources (a bank question's bullets, a
 *                    passage and its source, the expert's baton claims, the
 *                    oracle's thoughts), the lens, the seed. None of it is his
 *                    text. The oracle's reflection is left out on purpose,
 *                    because it paraphrases his last answer.
 *
 *   toneOf           counts read off his answer on this Mac: hedges, boosters,
 *                    first person, questions, and a stance toward what was in
 *                    front of him (agrees, pushes back, mixed, unclear). The
 *                    counts stay in the kept sidecar. Only the stance label
 *                    goes on to the drafting prompt, which already reads the
 *                    answer itself, so nothing about him travels anywhere new.
 *
 * The stance is a word count, not a reading. It is there so the drafting step
 * knows to look for dissent, never to decide what he meant.
 */

const MAX_CLAIMS = 4;
const MAX_CLAIM_CHARS = 300;

/* Phrases, matched on word boundaries, lower case. */
const HEDGES = ["might", "may", "maybe", "perhaps", "possibly", "probably", "likely", "seems", "seem", "seemed",
  "i think", "i guess", "i suspect", "not sure", "sort of", "kind of", "could be", "it depends", "depends on", "arguably", "(?)"];
const BOOSTERS = ["always", "never", "clearly", "definitely", "certainly", "must", "obviously", "without question", "no doubt", "every time"];
const PUSHBACK = ["disagree", "push back", "pushback", "not convinced", "i don't buy", "i dont buy", "overstated", "overstates",
  "too far", "doesn't hold", "does not hold", "skeptical", "however", "on the other hand",
  "that said", "the problem is", "the trouble is", "not always", "isn't always", "is not always", "falls short", "misses", "wrong"];
const AGREE = ["agree", "exactly", "that's right", "thats right", "that matches", "matches what", "consistent with",
  "i see this", "i've seen this", "ive seen this", "true in my", "makes sense", "spot on", "yes"];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/* One alternation, longest phrase first, so "it depends on" counts once and
   never again as "depends on". */
function count(text, phrases) {
  const alt = [...phrases].sort((a, b) => b.length - a.length)
    .map((p) => `${/^\w/.test(p) ? "\\b" : ""}${esc(p)}${/\w$/.test(p) ? "\\b" : ""}`).join("|");
  return (text.match(new RegExp(alt, "g")) || []).length;
}

/** Stance toward what was in front of him, from marker counts alone. */
export function stanceFrom(pushback, agree) {
  if (!pushback && !agree) return "unclear";
  if (pushback && agree) return pushback >= agree * 2 ? "pushes back" : agree >= pushback * 2 ? "agrees" : "mixed";
  return pushback ? "pushes back" : "agrees";
}

/**
 * Tone and stance, counted locally. Straight and curly apostrophes read alike.
 * @param {string} text
 */
export function toneOf(text) {
  const t = String(text || "").toLowerCase().replace(/[\u2018\u2019]/g, "'");
  const words = (t.match(/[a-z0-9']+/g) || []).length;
  const sentences = (String(text || "").replace(/\(\?\)/g, "").match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).filter((s) => s.trim()).length;
  const pushback = count(t, PUSHBACK);
  const agree = count(t, AGREE);
  return {
    words, sentences,
    hedges: count(t, HEDGES), boosters: count(t, BOOSTERS),
    firstPerson: (t.match(/\b(i|i'm|i've|i'd|me|my|mine)\b/g) || []).length,
    questions: (t.match(/\?/g) || []).length - (t.match(/\(\?\)/g) || []).length,
    pushback, agree, stance: stanceFrom(pushback, agree),
  };
}

const clip = (s) => {
  const x = String(s || "").replace(/\s+/g, " ").trim();
  return x.length > MAX_CLAIM_CHARS ? `${x.slice(0, MAX_CLAIM_CHARS - 3).trimEnd()}...` : x;
};
const firstSentence = (s) => (String(s || "").match(/^[^.!?]*[.!?]/) || [String(s || "")])[0];

/**
 * What the round put in front of him, for the kept entry. Returns null when
 * there was nothing but the question.
 * @param {{ mode: string, item?: object, passage?: object|null, oracle?: object|null }} round
 */
export function researchContext({ mode, item, passage, oracle } = {}) {
  let kind, claims = [];
  if (mode === "oracle" && oracle && oracle.reply) {
    kind = oracle.seed ? "seed" : "oracle";
    claims = (oracle.reply.thoughts || []).map((t) => ({ text: t.text, source: t.source }));
  } else if (mode === "respond" && passage) {
    kind = passage.kind === "baton" ? "baton" : "passage";
    claims = passage.kind === "baton"
      ? (passage.sources || []).map((s) => ({ text: s.claim, source: s.source }))
      : [{ text: `${passage.title}. ${firstSentence(passage.text)}`, source: passage.source }];
  } else if (item) {
    kind = "bank";
    claims = (item.bullets || []).map((b) => ({ text: b.text, source: b.source }));
  } else return null;
  claims = claims.map((c) => ({ text: clip(c.text), source: clip(c.source) || "general practice knowledge" }))
    .filter((c) => c.text).slice(0, MAX_CLAIMS);
  if (!claims.length) return null;
  const sources = [...new Set(claims.map((c) => c.source))];
  return {
    kind, claims, sources,
    ...(passage && mode === "respond" ? { passage: passage.id } : {}),
    ...(item && item.lens ? { lens: item.lens } : {}),
    ...(oracle && oracle.seed && mode === "oracle" ? { seed: oracle.seed } : {}),
  };
}
