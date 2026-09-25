/* Oracle seeds: live questions in the field, for his view.
 *
 * With no topic typed, the oracle used to take the thinnest cell of the map,
 * which asks what the outline says. A seed asks what HE thinks, on a question
 * the field has not settled, so the conversation captures his stance and
 * where it bends. Seeds and map cells take turns, one conversation each.
 *
 * A seed is a topic, not a claim: it names a debate and takes no side, so the
 * oracle (which searches current research) brings the evidence and the other
 * side. Each files under the outline item it is closest to.
 */

export const SEEDS = Object.freeze([
  { id: "s-hours", outline: "F.8", topic: "how many hours of ABA a week a young child should get, and who should decide the number: the evidence, the family or the funder" },
  { id: "s-neurodiversity", outline: "E.9", topic: "the neurodiversity critique of ABA: which parts the field should take on board, and which parts it gets wrong" },
  { id: "s-stereotypy", outline: "H.3", topic: "when, if ever, stereotypy should be a target for reduction" },
  { id: "s-assent", outline: "E.1", topic: "assent-based practice: what counts as assent withdrawal for a learner with few words, and what the session should do next" },
  { id: "s-compliance", outline: "H.3", topic: "compliance as a goal: when following instructions protects a child, and when it teaches them to comply with anyone" },
  { id: "s-eye-contact", outline: "F.8", topic: "eye contact as a treatment goal" },
  { id: "s-iisca", outline: "F.6", topic: "the interview-informed synthesized contingency analysis against the standard functional analysis: what each one trades away" },
  { id: "s-fa-risk", outline: "F.6", topic: "whether a functional analysis is worth the risk of evoking dangerous behavior, and what would make you skip one" },
  { id: "s-punishment", outline: "G.17", topic: "whether punishment procedures still have a place in practice, and who should get to decide" },
  { id: "s-restraint", outline: "E.1", topic: "restraint and seclusion in schools and clinics: where the line should be" },
  { id: "s-tiered", outline: "I.1", topic: "whether the RBT credential and the tiered service model serve clients well" },
  { id: "s-caseload", outline: "I.1", topic: "caseload size and supervision ratios: how many clients a BCBA can oversee well" },
  { id: "s-insurance", outline: "E.12", topic: "ABA inside the medical insurance model: what diagnosis-based funding does to goals and hours" },
  { id: "s-social-validity", outline: "F.8", topic: "social validity checked at the end of treatment against social validity built in from intake" },
  { id: "s-rft", outline: "B.19", topic: "Skinner's verbal operants against relational frame theory: what each explains that the other does not" },
  { id: "s-ndbi", outline: "G.13", topic: "naturalistic developmental behavioral interventions and discrete trial teaching: how different they really are" },
  { id: "s-extinction", outline: "G.2", topic: "using extinction with a child who cannot tell you how it feels" },
  { id: "s-tokens", outline: "G.4", topic: "token economies and intrinsic motivation: the overjustification worry, and what the data say" },
  { id: "s-mastery", outline: "H.7", topic: "mastery criteria: whether 80 or 90 percent across three sessions is evidence or habit" },
  { id: "s-maintenance", outline: "G.16", topic: "why maintenance and generalization so often go unmeasured, and what it would take to change that" },
  { id: "s-caregivers", outline: "H.8", topic: "caregiver training: what can fairly be asked of families, and what never should be" },
  { id: "s-collaboration", outline: "H.8", topic: "working alongside SLPs and OTs whose methods you doubt" },
  { id: "s-family-goals", outline: "E.10", topic: "cultural humility when a family's goals conflict with what the data suggest" },
  { id: "s-adults", outline: "F.8", topic: "behavior analysis with autistic adults: what changes about goals, consent and dignity" },
  { id: "s-telehealth", outline: "E.12", topic: "telehealth ABA: what it does well, and what it cannot replace" },
  { id: "s-ai-notes", outline: "E.4", topic: "AI tools in clinical documentation: what they may see, and what they never should" },
  { id: "s-turnover", outline: "I.2", topic: "burnout and turnover among behavior technicians: what supervisors control and what they do not" },
  { id: "s-evidence", outline: "H.2", topic: "what counts as enough evidence to recommend a procedure: single-case replications, meta-analyses, or both" },
  { id: "s-trauma", outline: "G.18", topic: "trauma-informed care in ABA: a real addition to the science, or a relabelling of it" },
  { id: "s-ncr", outline: "G.3", topic: "noncontingent reinforcement: why giving it away works, and when it backfires" },
]);

/** The seed with the fewest conversations so far; ties go in list order. */
export function nextSeed(history) {
  const used = new Map();
  for (const h of history || []) if (h && h.seed) used.set(h.seed, (used.get(h.seed) || 0) + 1);
  let best = SEEDS[0];
  for (const s of SEEDS) if ((used.get(s.id) || 0) < (used.get(best.id) || 0)) best = s;
  return best;
}

/**
 * Seed or map for a new conversation with no topic typed: they take turns.
 * The last oracle round decides; a first-ever oracle round opens on a seed.
 */
export function openWithSeed(history) {
  const last = [...(history || [])].reverse().find((h) => h && h.mode === "oracle");
  return !last || !last.seed;
}
