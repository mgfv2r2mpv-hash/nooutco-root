/* The oracle and the expert's drafting: prompts, schemas and the checks a
 * proposal must pass before it leaves the Mac. Pure; node --test reads it.
 *
 * His rulings of 2026-09-23: the oracle thinks with his own Claude Code on this
 * Mac (1A); kept answers become PROPOSED knowledge records he commits or
 * rejects in the admin page (2A); spoken answers are their own register (3A).
 *
 * The store's hard rule: no text a clinician typed may go into a record. So a
 * draft is authored knowledge in the drafter's own words, and a draft that
 * shares a run of EIGHT_WORDS or more with his answer is dropped here, before
 * it can be proposed. He still reads every proposal before it is in force.
 */

/* ---- the oracle ------------------------------------------------------- */

export const ORACLE_SYSTEM = [
  "You are the expert behind a set of ABA clinical tools, talking with Kaleb, a BCBA, inside a practice app on his Mac.",
  "Each turn you ask him ONE focused question he can answer out loud or by typing in about a minute, and you share two or three short points of your own thinking first.",
  "Every point carries a source: an author and year for a paper or book you are confident exists, or a page you found with web search. If you are not sure a source exists, write \"general practice knowledge\" instead. Never invent a citation.",
  "Write plainly, as one clinician to another. Do not explain his job to him. No em dashes. No client names, places or dates.",
  "On a follow-up turn, read his last answer: say in one sentence what you would add or where you see it differently, then ask the next question, building on what he said.",
].join(" ");

export const ORACLE_SCHEMA = {
  type: "object",
  properties: {
    reflection: { type: "string", description: "One sentence on his last answer; empty on the first turn." },
    thoughts: {
      type: "array", minItems: 2, maxItems: 3,
      items: { type: "object", properties: { text: { type: "string" }, source: { type: "string" } }, required: ["text", "source"] },
    },
    question: { type: "string" },
  },
  required: ["thoughts", "question"],
};

/** The prompt for one oracle turn. turns: [{ question, answer }] so far. */
export function oraclePrompt({ topic, outline = null, turns = [] }) {
  const lines = [`Topic: ${topic}${outline ? ` (BACB outline ${outline})` : ""}.`];
  if (!turns.length) lines.push("This is the first turn: no reflection, then your points, then one question.");
  for (const [i, t] of turns.entries()) {
    lines.push(`Turn ${i + 1}. You asked: ${t.question}`);
    lines.push(`He answered: ${t.answer || "(no answer)"}`);
  }
  if (turns.length) lines.push("Now the next turn: one sentence of reflection on his last answer, your points, one question.");
  return lines.join("\n");
}

/** A reply the page can show, or null: thoughts need text and a source, and there is one question. */
export function readOracle(out) {
  if (!out || typeof out !== "object") return null;
  const question = String(out.question || "").trim();
  const thoughts = (Array.isArray(out.thoughts) ? out.thoughts : [])
    .map((t) => ({ text: String((t && t.text) || "").trim(), source: String((t && t.source) || "").trim() || "general practice knowledge" }))
    .filter((t) => t.text);
  if (!question || !thoughts.length) return null;
  return { question, thoughts: thoughts.slice(0, 3), reflection: String(out.reflection || "").trim() };
}

/* ---- the expert's drafting ------------------------------------------- */

export const DRAFT_SYSTEM = [
  "You draft knowledge records for the expert that reviews ABA session notes and treatment documents.",
  "You are given a BCBA's own answer to a clinical question. Draft zero, one or two records that state, in your own words, a general rule of practice or a fact of the field that his answer shows he holds and that would help the expert review notes.",
  "Never quote his answer. Never include a client, a name, a place, a date or a session detail. If the answer holds nothing general enough, return an empty list; an empty list is a good answer.",
  "Each record: a short title, the rule in plain words (under 120 words), when the expert should fetch it (\"applies\", one line), why (\"rationale\", one or two sentences), a topic slug (lowercase words joined by hyphens) and up to six keywords.",
].join(" ");

export const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    records: {
      type: "array", maxItems: 2,
      items: {
        type: "object",
        properties: {
          title: { type: "string" }, rule: { type: "string" }, applies: { type: "string" },
          rationale: { type: "string" }, topic: { type: "string" }, keywords: { type: "array", items: { type: "string" } },
        },
        required: ["title", "rule", "applies", "topic"],
      },
    },
  },
  required: ["records"],
};

export function draftPrompt(entry) {
  return [
    `Question: ${entry.question || "(none)"}`,
    entry.outline ? `BACB outline item: ${entry.outline}` : "",
    `His answer: ${entry.answer || ""}`,
  ].filter(Boolean).join("\n");
}

/* The store's own validation (prompt-api src/knowledge/write.js), mirrored so
   a bad draft is dropped here with a reason instead of bouncing off the site. */
const SLUG = /^[a-z0-9][a-z0-9_-]{0,59}$/;
export const BODY = "clinician-practice";
export const SCOPE = "expert";
export const EIGHT_WORDS = 8;

export function slugify(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/** True when `text` shares a run of `n` or more words with `source`. */
export function sharesRun(text, source, n = EIGHT_WORDS) {
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
  const a = norm(text), b = norm(source);
  if (a.length < n || b.length < n) return false;
  const grams = new Set();
  for (let i = 0; i + n <= b.length; i++) grams.add(b.slice(i, i + n).join(" "));
  for (let i = 0; i + n <= a.length; i++) if (grams.has(a.slice(i, i + n).join(" "))) return true;
  return false;
}

/**
 * One draft to one proposal body, or { error } saying why it was dropped.
 * The answer itself never travels: provenance names where it came from.
 */
export function toProposal(draft, entry) {
  const d = draft || {};
  const title = String(d.title || "").trim();
  const rule = String(d.rule || "").trim();
  const applies = String(d.applies || "").trim();
  const rationale = String(d.rationale || "").trim();
  const topic = slugify(d.topic);
  if (!title || title.length > 120) return { error: "title missing or over 120 characters" };
  if (!rule || rule.length > 4000) return { error: "rule missing or over 4000 characters" };
  if (!applies || applies.length > 200) return { error: "applies missing or over 200 characters" };
  if (rationale.length > 4000) return { error: "rationale over 4000 characters" };
  if (!SLUG.test(topic)) return { error: "topic is not a slug" };
  for (const field of [title, rule, applies, rationale]) {
    if (sharesRun(field, entry && entry.answer)) return { error: "quotes the answer (a run of eight words or more)" };
  }
  const keywords = [...new Set((Array.isArray(d.keywords) ? d.keywords : [])
    .map((k) => String(k).toLowerCase().trim()).filter((k) => k && k.length <= 40))].slice(0, 24);
  return {
    record: {
      tier: "topic", scope: SCOPE, body: BODY, topic, applies, title, rule,
      ...(rationale ? { rationale } : {}), ...(keywords.length ? { keywords } : {}),
      provenance: {
        kind: "clickclackoracle", mode: (entry && entry.mode) || "answer", register: (entry && entry.register) || "drill",
        outline: (entry && entry.outline) || null, answeredAt: (entry && entry.at) || null,
        sources: ((entry && entry.oracle && entry.oracle.thoughts) || []).map((t) => t.source).filter(Boolean),
      },
    },
  };
}
