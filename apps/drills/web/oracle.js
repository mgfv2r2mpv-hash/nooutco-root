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
  "Keep him considering the other side. When his last answer sounds settled, ask him to steelman the view he argued against, or to say what would change his mind. Where current research (use web search) dissents from common practice, or from what he said, say so and cite it.",
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
  "When you are also given the research that was in front of him (claims with their sources), read his answer against it. Where he took the research on, a record may state the consensus those sources support (kind \"consensus\"). Where he pushed back or named a limit, a record may state that dissent or limit as a live question in the field, with what the research says on each side (kind \"dissent\"). Otherwise a record is a plain rule of practice (kind \"practice\").",
  "Name a source only if it is in the list you were given; never invent a citation. Say \"general practice knowledge\" when no listed source fits. The stance line is a word count, not a reading: trust his answer over it.",
  "Never quote his answer. Never include a client, a name, a place, a date or a session detail. If the answer holds nothing general enough, return an empty list; an empty list is a good answer.",
  "Each record: a short title, the rule in plain words (under 120 words), when the expert should fetch it (\"applies\", one line), why (\"rationale\", one or two sentences), a topic slug (lowercase words joined by hyphens), up to six keywords, and its kind.",
].join(" ");

/* The kinds a drafted record may be. `consensus` and `dissent` need research
   in the entry; without it every record is `practice`. */
export const KINDS = Object.freeze(["practice", "consensus", "dissent"]);

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
          kind: { type: "string", enum: KINDS },
        },
        required: ["title", "rule", "applies", "topic"],
      },
    },
  },
  required: ["records"],
};

/**
 * The drafting prompt for one kept entry. The research is what was in front
 * of him (never his text); only the stance label rides along from the tone
 * counts, which otherwise stay in the kept sidecar.
 */
export function draftPrompt(entry) {
  const r = entry.research || null;
  const lens = entry.lens || (r && r.lens) || "";
  const claims = r && Array.isArray(r.claims) ? r.claims : [];
  const stance = entry.tone && entry.tone.stance;
  return [
    `Question: ${entry.question || "(none)"}`,
    entry.outline ? `BACB outline item: ${entry.outline}` : "",
    lens ? `He was asked through the "${lens}" lens (consider the other side).` : "",
    claims.length ? `The research in front of him (${r.kind || "research"}):` : "",
    ...claims.map((c) => `- ${c.text} (${c.source || "general practice knowledge"})`),
    stance && claims.length ? `Stance markers in his answer: ${stance}.` : "",
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
  // consensus and dissent need research in the entry; without it, practice.
  const research = entry && entry.research && Array.isArray(entry.research.claims) && entry.research.claims.length ? entry.research : null;
  const kind = research && KINDS.includes(d.kind) ? d.kind : "practice";
  // The kind rides as a keyword, a field the store already takes, so the
  // admin page can find the dissent records without a new field.
  const keywords = [...new Set([...(kind === "practice" ? [] : [kind]), ...(Array.isArray(d.keywords) ? d.keywords : [])]
    .map((k) => String(k).toLowerCase().trim()).filter((k) => k && k.length <= 40))].slice(0, 24);
  const sources = [...new Set([
    ...((entry && entry.oracle && entry.oracle.thoughts) || []).map((t) => t.source),
    ...((research && research.sources) || []),
  ].filter(Boolean))];
  return {
    record: {
      tier: "topic", scope: SCOPE, body: BODY, topic, applies, title, rule,
      ...(rationale ? { rationale } : {}), ...(keywords.length ? { keywords } : {}),
      provenance: {
        kind: "clickclackoracle", mode: (entry && entry.mode) || "answer", register: (entry && entry.register) || "drill",
        outline: (entry && entry.outline) || null, answeredAt: (entry && entry.at) || null,
        sources,
      },
    },
  };
}

/* ---- the baton pass ----------------------------------------------------
 * His ask of 2026-09-23: after a respond round he hands his answer to the
 * expert, which reads the literature and what the expert already holds, then
 * answers him: agrees and fleshes out, or (most usefully) gently names what he
 * has not considered and where his read sits apart from the research. Its
 * answer becomes his next passage to copy, so he takes it in with his hands,
 * and then he responds again in his own words.
 *
 * The passage is never kept (copy rounds never are), and it is written to be
 * typed: plain ASCII, no em dashes, no curly quotes, sized to his clock. */

export const BATON_SYSTEM = [
  "You are the expert behind a set of ABA clinical tools, answering Kaleb, a BCBA, inside a typing practice app on his Mac.",
  "He has just copied a short passage and then answered it in his own words. Read his answer against the research and against what the expert already holds (given below, when there is any).",
  "Write him a reply he will type out word for word. Where he is right, say so briefly and add depth. Most usefully, gently name one or two things he has not considered, or where his understanding sits apart from the research or from the expert's records, and say why.",
  "Be warm and direct, one clinician to another. Do not explain his job to him and do not praise for its own sake. Never quote him back at length.",
  "Write the passage in plain prose paragraphs, as close as you can to the word count asked for. Use only plain keyboard characters: straight quotes, a spaced hyphen instead of any dash, no bullet points, no headings, no symbols a US keyboard lacks, no citations inside the passage.",
  "Put the sources separately: each one an author and year for a paper or book you are confident exists, or a page you found with web search. If you are not sure a source exists, write \"general practice knowledge\". Never invent a citation.",
  "Then write one short question for his next free write, building on the gap or the push back.",
  "No client names, places or dates.",
].join(" ");

export const BATON_SCHEMA = {
  type: "object",
  properties: {
    stance: { type: "string", description: "A few words: agrees and adds, adds a consideration, or pushes back gently." },
    title: { type: "string", description: "A short title for the passage, under 60 characters." },
    passage: { type: "string" },
    sources: {
      type: "array", minItems: 1, maxItems: 4,
      items: { type: "object", properties: { claim: { type: "string" }, source: { type: "string" } }, required: ["claim", "source"] },
    },
    respond: { type: "string", description: "One question for his next free write." },
  },
  required: ["stance", "title", "passage", "sources", "respond"],
};

/** Text he can type: straight quotes, spaced hyphens, no symbols a US keyboard lacks. */
export function typable(s) {
  return String(s || "")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/\s*[\u2012\u2013\u2014\u2015]\s*/g, " - ")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .normalize("NFKD").replace(/[\u0300-\u036F]/g, "")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n+ */g, "\n\n")
    .trim();
}

const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean);

/** Cut to about `limit` words, at a sentence end when one is near. */
export function trimToWords(text, limit) {
  const w = words(text);
  if (w.length <= limit) return text;
  const cut = w.slice(0, limit).join(" ");
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "), /[.?!]$/.test(cut) ? cut.length - 1 : -1);
  return end > cut.length * 0.6 ? cut.slice(0, end + 1) : cut + ".";
}

/**
 * How long the expert's passage should be: his copy speed at this clock (the
 * median GWAM of his last ten copy rounds at it, or 50 before he has any)
 * times the clock, held between 40 and 350 words.
 */
export function batonWords(history, minutes) {
  const m = Number(minutes) || 1;
  const speeds = (history || []).filter((h) => h && h.mode === "copy" && h.minutes === m && h.gwam > 0).slice(-10).map((h) => h.gwam).sort((a, b) => a - b);
  const wpm = speeds.length ? speeds[Math.floor(speeds.length / 2)] : 50;
  return Math.max(40, Math.min(350, Math.round(wpm * m)));
}

const STOP = new Set("the a an and or of to in on for with is are was be it that this as at by from not but his her their they you your i".split(" "));
const terms = (s) => new Set(String(s || "").toLowerCase().match(/[a-z][a-z-]{2,}/g)?.filter((t) => !STOP.has(t)) || []);

/**
 * The expert's records that bear on his answer, most shared terms first, at
 * most `n`, each rule cut to 600 characters. These are authored knowledge,
 * never a clinician's typed text, so they may ride in the prompt.
 */
export function relevantRecords(records, text, n = 6) {
  const want = terms(text);
  return (records || [])
    .filter((r) => r && r.title && r.rule)
    .map((r) => {
      const have = terms([r.title, r.rule, r.applies, r.topic, ...(r.keywords || [])].join(" "));
      let score = 0;
      for (const t of have) if (want.has(t)) score += 1;
      return { r, score };
    })
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(({ r }) => ({ title: r.title, rule: String(r.rule).slice(0, 600), ...(r.topic ? { topic: r.topic } : {}) }));
}

/** The prompt for one baton pass. */
export function batonPrompt({ passage, question, answer, records = [], words: target = 120, weak = [], turn = 1 }) {
  const lines = [
    `Baton pass ${turn}.`,
    `The passage he copied: ${passage && passage.title ? passage.title + ". " : ""}${(passage && passage.text) || "(none)"}`,
    `The question he answered: ${question || "(none)"}`,
    `His answer, in his own words: ${answer || "(no answer)"}`,
  ];
  if (records.length) {
    lines.push("What the expert already holds on this (authored records):");
    for (const r of records) lines.push(`- ${r.title}: ${r.rule}`);
  } else lines.push("The expert holds no records on this yet, so weigh his answer against the research alone.");
  lines.push(`Write the passage in about ${target} words.`);
  if (weak.length) lines.push(`Where two words serve equally, prefer the one with these letters, which he is practising: ${weak.join(" ")}. Never let that bend the content.`);
  return lines.join("\n");
}

/** A reply the page can use as the next passage, or null. */
export function readBaton(out, target = 120) {
  if (!out || typeof out !== "object") return null;
  const text = trimToWords(typable(out.passage), Math.round(target * 1.3));
  const respond = typable(out.respond);
  if (words(text).length < 15 || !respond) return null;
  const sources = (Array.isArray(out.sources) ? out.sources : [])
    .map((s) => ({ claim: typable(s && s.claim), source: typable(s && s.source) || "general practice knowledge" }))
    .filter((s) => s.claim)
    .slice(0, 4);
  return {
    stance: typable(out.stance).slice(0, 60) || "the expert's reply",
    title: typable(out.title).slice(0, 60) || "The expert's reply",
    text, respond, sources,
  };
}
