/* A change note never claims an edit that did not land.
 *
 * THE CASES. Two bench runs, 2026-10-09. A Supervision section's change note
 * said it had removed "preliminary assessment suggests", and the text still
 * had it. An Assessment report-writing note said "Added observable counts or
 * rates for manding and elopement, drawn from the follow-up response", and no
 * count was added: the follow-up had gone unanswered.
 *
 * WHERE THE NOTES COME FROM. The corrections pass (handleCorrections in
 * _worker.js) asks the model for each changed section whole, plus a `why` line
 * for the section and a `reasons` list of {quote, why}. Both are the model's
 * own account of what it did, and nothing compared that account with the text
 * it returned. Every tool's notes go through this one route, so the check
 * lives here and covers BT, Supervision, Parent, Assessment and SAP at once.
 *
 * WHAT IS CHECKED, and the direction it errs in. Each claim is held against
 * the section before and after:
 *
 *   a REASON whose quote reads the same number of times before and after names
 *   wording that did not change, so it is dropped;
 *
 *   a CLAUSE of the section line that says it removed words still there, or
 *   added words that are not there, is dropped, and so is one that claims
 *   counts, rates or other figures when no number was added, or claims an
 *   addition or removal when no word was added or removed at all.
 *
 * A claim that cannot be checked is KEPT. "Removed the hedge" names nothing
 * literal, and dropping it would trade a possibly-true note for silence. Only
 * a claim the text contradicts is dropped, because that is the one that tells
 * a clinician the record says something it does not.
 *
 * Pure. Imported by _worker.js; tested in tests/change-claims.spec.js.
 */

const REMOVE_VERB = /\b(?:removed|cut|deleted|dropped|took out|taken out|stripped|struck|eliminated|replaced)\b/i;
const ADD_VERB = /\b(?:added|inserted|included)\b/i;
const FIGURE_WORDS = /\b(?:counts?|rates?|numbers?|figures?|percent\w*|percentages?|frequenc\w*|scores?|durations?|totals?)\b/i;

// Where an unquoted claim's object ends: the words after the verb, up to the
// first of these, are taken as the words the claim is about.
const OBJECT_END = /[,;:.!?()]|\s(?:and|so|to|because|for|from|in|with|since|as|which|that|per)\s/i;
// Leading words that describe what kind of words they were, not the words.
const DESCRIPTORS = /^(?:(?:the|a|an|hedge|hedging|hedged|phrase|wording|language|words?|clause|sentence|repeated|duplicate|duplicated|redundant|stray|extra)\s+)+/i;

const NUMBER_WORDS = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred|once|twice|half";
const NUMBER = new RegExp("\\d+(?:[.,]\\d+)?%?|\\b(?:" + NUMBER_WORDS + ")\\b", "gi");

function normalised(s) {
  return String(s == null ? "" : s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function countOf(hay, needle) {
  const h = normalised(hay);
  const n = normalised(needle);
  if (!n) return 0;
  let count = 0;
  let at = h.indexOf(n);
  while (at !== -1) {
    count += 1;
    at = h.indexOf(n, at + n.length);
  }
  return count;
}

function tally(list) {
  const out = new Map();
  for (const w of list) out.set(w, (out.get(w) || 0) + 1);
  return out;
}

// True when `a` holds some item more times than `b` does.
function exceeds(a, b) {
  for (const [w, n] of a) if (n > (b.get(w) || 0)) return true;
  return false;
}

function words(s) {
  return normalised(s).match(/[a-z0-9%']+/g) || [];
}

function numbers(s) {
  return String(s == null ? "" : s).toLowerCase().match(NUMBER) || [];
}

// Quoted spans in a claim: double quotes of either kind, or single quotes that
// open and close at a word edge (so an apostrophe never opens a quote).
function quotedSpans(clause) {
  const spans = [];
  const dbl = /["“]([^"”]{2,}?)["”]/g;
  const sgl = /(?:^|[\s(])['‘]([^'’]{2,}?)['’](?=[\s.,;:)!?]|$)/g;
  let m;
  while ((m = dbl.exec(clause))) spans.push(m[1]);
  while ((m = sgl.exec(clause))) spans.push(m[1]);
  return spans;
}

// The words an unquoted claim is about: after the verb, up to OBJECT_END,
// with descriptor words stripped. Two words at least, or nothing.
function unquotedObject(clause, verb) {
  const m = verb.exec(clause);
  if (!m) return "";
  const rest = clause.slice(m.index + m[0].length);
  const end = rest.search(OBJECT_END);
  const object = (end === -1 ? rest : rest.slice(0, end)).trim().replace(DESCRIPTORS, "").trim();
  return object.split(/\s+/).filter(Boolean).length >= 2 ? object : "";
}

/* One clause of a section line, held against the section. Returns false only
   when the text contradicts the clause. */
function clauseHolds(clause, before, after) {
  const removes = REMOVE_VERB.test(clause);
  const adds = ADD_VERB.test(clause);
  if (!removes && !adds) return true;

  const beforeWords = tally(words(before));
  const afterWords = tally(words(after));
  if (removes && !adds && !exceeds(beforeWords, afterWords)) return false;
  if (adds && !removes && !exceeds(afterWords, beforeWords)) return false;
  if (adds && FIGURE_WORDS.test(clause) && !exceeds(tally(numbers(after)), tally(numbers(before)))) return false;

  for (const span of quotedSpans(clause)) {
    const was = countOf(before, span);
    const now = countOf(after, span);
    if (removes && !adds && was > 0 && now >= was) return false;
    if (adds && !removes && now <= was && (was > 0 || now > 0)) return false;
  }
  if (!quotedSpans(clause).length && removes && !adds) {
    const object = unquotedObject(clause, REMOVE_VERB);
    const was = object ? countOf(before, object) : 0;
    if (was > 0 && countOf(after, object) >= was) return false;
  }
  return true;
}

/* The section line with every clause the text contradicts taken out. Clauses
   are split at sentence ends and semicolons; what is left keeps its wording. */
export function checkedWhy(why, before, after) {
  const line = typeof why === "string" ? why.trim() : "";
  if (!line) return "";
  const clauses = line.split(/(?<=[.;!?])\s+/).filter(Boolean);
  const kept = clauses.filter((c) => clauseHolds(c, before, after));
  if (kept.length === clauses.length) return line;
  return kept.join(" ").replace(/;\s*$/, ".").trim();
}

/* The per-change reasons with every quote that did not change taken out. A
   quote read the same number of times before and after names wording the
   pass left alone, so its reason belongs to no change. */
export function checkedReasons(reasons, before, after) {
  return (Array.isArray(reasons) ? reasons : []).filter((r) => {
    const quote = r && typeof r.quote === "string" ? r.quote : "";
    if (!quote.trim()) return false;
    const was = countOf(before, quote);
    const now = countOf(after, quote);
    // A quote found on neither side cannot be checked; corrections.js already
    // leaves an unmatched quote off every mark, so keeping it costs nothing.
    if (was === 0 && now === 0) return true;
    return was !== now;
  });
}
