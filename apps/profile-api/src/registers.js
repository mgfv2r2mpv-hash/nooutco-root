/**
 * Which document class each tool writes in.
 *
 * WHY A CARD IS KEYED BY THIS AND NOT BY THE TOOL. Kaleb's ruling of
 * 2026-08-06, after asking whether a correction made on the SAP tool was
 * reaching his supervision notes. It was: the card was one pool per person
 * across every note type. Per tool was the other candidate and he rejected it,
 * correctly. His 66 corrections at the time were sup 57, assess 6, and one each
 * for sap, parent and bt, so per tool would have kept sup's rules and dropped
 * every other tool below the five-evidence bar. Per register keeps 63 of the 66
 * together.
 *
 * The deeper reason is the one already written into shape_profile: a writing
 * habit is a property of the document class, not of the person. The same author
 * writes 20.9 words a sentence in academic prose and 13.0 in a clinical plan.
 * Two tools that produce the same class of document should pool; two that do
 * not should not.
 *
 * WHY THE MAP LIVES HERE AND NOT IN THE VOICE BLOCK. The same names appear in
 * the voice block in KV, and it is tempting to read them from there rather than
 * keep a second copy. That would be wrong for this use: a register is part of a
 * PRIMARY KEY here, so if KV were unreachable for one request the same tool
 * would write rows under a different key and silently fragment a person's card.
 * A durable key has to come from something that cannot fail to load.
 */

export const TOOL_REGISTER = {
  sap: "clinical-instrument",
  sup: "clinical-narrative",
  assess: "clinical-narrative",
  parent: "interpersonal",
  bt: "technician-note",
};

/**
 * Every tool the notes engine can run, as its own list rather than the keys of
 * the map above. Keeping the two separate is what lets the test assert they
 * agree, which is what makes a tool added without a register decision an error
 * rather than a silent default.
 */
export const KNOWN_TOOLS = ["bt", "sup", "parent", "assess", "sap"];

/**
 * The pool a correction from `tool` belongs to.
 *
 * An unmapped tool falls back to its own id rather than to a shared
 * "unclassified" bucket. Sharing one would recreate exactly the bleed this
 * change exists to stop, and it would do it silently, for whichever tools
 * happened to be added without a decision.
 */
export function registerFor(tool) {
  if (typeof tool !== "string" || !tool) return "unknown";
  return TOOL_REGISTER[tool] || tool;
}
