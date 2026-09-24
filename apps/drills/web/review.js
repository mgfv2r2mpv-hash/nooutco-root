/* Spaced review: bank questions come back, and come back from the other side.
 *
 * His ask of 2026-09-23: "cycle and present items to strengthen my clinical
 * knowledge ... keep me fresh, current, and considering the other side of my
 * opinions and knee-jerks."
 *
 * A bank question he has answered is scheduled again, Leitner style. A full
 * answer (STRONG_WORDS kept words or more) moves it up a box, so it waits
 * longer; a thin one puts it back in box 0, so it comes back tomorrow. When it
 * comes back it wears a LENS: steelman the other side, check the knee-jerk,
 * say what would change his mind, or say what current research says. The lens
 * turns with every return, so the same question is never asked the same way
 * twice in a row.
 *
 * Reviews interleave with new questions: never two reviews in a row, so the
 * map's emptiest cell still gets its turn. Pure; reads the history only, and
 * only its ids, dates and word counts, never anything he typed.
 */

/* Days to wait, by box. */
export const INTERVALS = Object.freeze([1, 3, 7, 16, 35]);
/* Kept words that count as a full answer. At his speed a minute is about 90. */
export const STRONG_WORDS = 30;
const DAY = 86400000;

export const LENSES = Object.freeze([
  { id: "steelman", name: "steelman",
    ask: "This time, make the strongest case for the view you usually argue against, then say where you land." },
  { id: "kneejerk", name: "knee-jerk check",
    ask: "This time, give your first reaction in a line, then test it: which part is habit, and which part is evidence?" },
  { id: "mind", name: "what would change your mind",
    ask: "This time, name the finding or the data that would make you answer this differently." },
  { id: "research", name: "current research",
    ask: "This time, say what you think current research says here, and what you would look up to check it. Oracle mode can search it with you." },
]);

const isAnswer = (h) => h && h.itemId && (h.mode === "answer" || (!h.mode && !h.passage));
const wordsOf = (h) => Number(h.keptWords ?? h.words) || 0;

/**
 * Where each answered bank question stands.
 * @param {Array} history  drill records, oldest first
 * @param {(id: string) => boolean} [known]  ids still in the bank
 * @returns {Map<string, {box: number, n: number, last: number, due: number}>}
 */
export function schedule(history, known = () => true) {
  const out = new Map();
  for (const h of history || []) {
    if (!isAnswer(h) || !known(h.itemId)) continue;
    const t = Date.parse(h.at);
    if (!Number.isFinite(t)) continue;
    const prev = out.get(h.itemId);
    // A Keep going round continues the same answer: it adds words, not a review.
    if (prev && Number(h.cont) >= 1) {
      prev.words += wordsOf(h);
      if (prev.words >= STRONG_WORDS) prev.box = Math.max(prev.box, Math.min(prev.base + 1, INTERVALS.length - 1));
      prev.due = prev.last + INTERVALS[Math.min(prev.box, INTERVALS.length - 1)] * DAY;
      continue;
    }
    const base = prev ? prev.box : 0;
    const words = wordsOf(h);
    const box = words >= STRONG_WORDS ? Math.min(base + 1, INTERVALS.length - 1) : 0;
    out.set(h.itemId, { box, base, words, n: (prev ? prev.n : 0) + 1, last: t, due: t + INTERVALS[box] * DAY });
  }
  return new Map([...out].map(([id, { box, n, last, due }]) => [id, { box, n, last, due }]));
}

/** Questions due now, the most overdue (relative to its interval) first. */
export function dueReviews(history, now, known) {
  const rows = [];
  for (const [itemId, s] of schedule(history, known)) {
    if (s.due > now) continue;
    rows.push({ itemId, ...s, overdue: (now - s.due) / (INTERVALS[s.box] * DAY) });
  }
  return rows.sort((a, b) => b.overdue - a.overdue || a.itemId.localeCompare(b.itemId));
}

/** The lens for a question answered `n` times before: it turns with each return. */
export const lensFor = (n) => LENSES[(Math.max(1, n) - 1) % LENSES.length];

/**
 * The review to ask next, or null. Never two reviews in a row. The question
 * he just answered is never due yet: its own schedule moved on with it.
 */
export function pickReview(history, now, known) {
  const answers = (history || []).filter(isAnswer);
  const last = answers[answers.length - 1];
  if (last && last.review) return null;
  const row = dueReviews(history, now, known)[0];
  return row ? { itemId: row.itemId, n: row.n, lens: lensFor(row.n) } : null;
}

/** A bank item dressed for its return: the lens is part of the question he answers. */
export function asReview(item, lens) {
  return { ...item, tag: `review \u00b7 ${lens.name}`, question: `${item.question} ${lens.ask}`, review: true, lens: lens.id };
}

/** A line for the home screen: how many are due and when the next one is. */
export function describeReviews(history, now, known) {
  const s = schedule(history, known);
  if (!s.size) return null;
  const due = [...s.values()].filter((v) => v.due <= now).length;
  if (due) return `${due} question${due === 1 ? "" : "s"} due for another look, from the other side`;
  const next = Math.min(...[...s.values()].map((v) => v.due));
  const days = Math.ceil((next - now) / DAY);
  return `${s.size} question${s.size === 1 ? "" : "s"} in review; the next comes back ${days <= 1 ? "tomorrow" : `in ${days} days`}`;
}
