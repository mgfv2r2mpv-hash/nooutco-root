/* Clinical typing drills: the scorer.
 *
 * A typing test scores you against a passage you copy. A drill has no passage,
 * because you compose the answer, so every number here is read from the
 * keystroke log instead. The arithmetic is the timed-writing standard: a word
 * is five keystrokes, whatever was typed.
 *
 *   GWAM        keystrokes that put a character in the box / 5 / minutes
 *   corrections runs of Backspace, one run = one correction. A run that used
 *               Option+Backspace or Command+Backspace is a REVISION instead:
 *               a change of mind, counted apart and never as an error. In a
 *               composed round (no reference passage) a plain Backspace run
 *               that takes out a whole word, or reaches back over a space, is
 *               a revision too: only a fix inside the word he is typing is a
 *               typo correction
 *   uncorrected tokens of the final text the lexicon does not know
 *   NWAM        GWAM minus errors per minute (uncorrected when a lexicon is
 *               given; corrections stand in until one is, and the result says so)
 *   accuracy    1 - (corrections + uncorrected) / gross words
 *
 * The principle, for composed rounds: thinking is never punished; only typos
 * are. GWAM counts every character he produced, including text a revision
 * later took out, so deleting a thought he does not want the expert to see
 * never costs speed, accuracy, the band or the star. Uncorrected unknown words
 * in the final text still cost NWAM. `kept` reports the final text apart, and
 * the final text is all that is ever kept. A copy round keeps strict reference
 * scoring: transcription accuracy is the point there.
 *
 * Pure. No DOM, no clock of its own: the page hands it the events it saw.
 * Loaded as an ES module by the page and by node --test.
 */

import { copyErrors } from "./copy.js";

export const WORD_KEYSTROKES = 5;
export const ACCURACY_GATE = 0.96;
export const PAUSE_MS = 2000;
export const SLOW_FACTOR = 2;

/** Rating bands on NWAM. Accuracy under the gate drops one band. The bands
 *  above Professional were added 2026-09-23 from his own numbers (median 89
 *  NWAM over 31 drills, best 100), so there is always a next band to climb.
 *  Old records keep the band name they were given. */
export const BANDS = Object.freeze([
  { min: 125, name: "Stenographer" },
  { min: 115, name: "Virtuoso" },
  { min: 105, name: "Master" },
  { min: 95, name: "Elite" },
  { min: 85, name: "Expert" },
  { min: 75, name: "Professional" },
  { min: 60, name: "Fluent" },
  { min: 45, name: "Intermediate" },
  { min: 35, name: "Average" },
  { min: 0, name: "Amateur" },
]);

/**
 * @typedef {{ t: number, kind: "char"|"backspace"|"enter", key?: string,
 *   via?: "word"|"line", shift?: "L"|"R"|"B", hand?: "L"|"R" }} DrillEvent
 *   t is milliseconds from the first keystroke. A char event carries the
 *   character it placed; enter places a newline; backspace removes one. A
 *   backspace with `via` is one character of an Option+Backspace (word) or
 *   Command+Backspace (line) delete. A char typed with Shift held carries which
 *   Shift (`shift`, B = both) and which hand the key belongs to (`hand`).
 */

/**
 * @param {object} args
 * @param {DrillEvent[]} args.events
 * @param {string} args.text       the box's final contents
 * @param {number} args.minutes    the clock the drill ran on
 * @param {Set<string>|null} [args.lexicon]  lower-case words the drill knows
 * @param {string} [args.reference]  a copy round's passage: errors are then the
 *   words that do not line up with it, not the words the lexicon lacks
 */
export function scoreDrill({ events, text, minutes, lexicon, reference } = {}) {
  const evs = Array.isArray(events) ? events.filter(isEvent) : [];
  const mins = Number.isFinite(minutes) && minutes > 0 ? minutes : 1;
  const placed = evs.filter((e) => e.kind !== "backspace").length;
  const grossWords = placed / WORD_KEYSTROKES;
  const gwam = grossWords / mins;

  const compose = !reference;
  const { corrections, revisions, revisedKeys } = deleteRuns(evs, { compose });
  const copied = reference ? copyErrors(text || "", reference) : null;
  const unknown = copied ? [] : lexicon ? unknownWords(text || "", lexicon) : null;
  const uncorrected = copied ? copied.errors : unknown ? unknown.length : null;
  const errorsForNet = uncorrected === null ? corrections : uncorrected;
  const nwam = Math.max(0, gwam - errorsForNet / mins);
  const errorsAll = corrections + (uncorrected || 0);
  const accuracy = grossWords > 0 ? clamp01(1 - errorsAll / grossWords) : 0;

  const rating = rate(nwam, accuracy);
  const tricky = trickyKeys(evs, { compose });
  const timing = timingProfile(evs);
  const habits = deleteHabits(evs);
  const shift = shiftStats(evs);
  const think = thinkProfile(evs, mins);
  const tips = formTips({ grossWords, corrections, tricky, timing, habits, shift });
  const keys = keyStats(evs, tricky.all);
  const pace = paceSeries(evs, mins);

  return {
    minutes: mins,
    keystrokes: placed,
    grossWords: round(grossWords, 1),
    gwam: round(gwam, 1),
    corrections,
    revisions,
    revisedKeys,
    kept: keptOf(text),
    uncorrected,
    unknownWords: unknown || [],
    netBasis: copied ? "reference" : uncorrected === null ? "corrections" : "uncorrected",
    copy: copied,
    nwam: round(nwam, 1),
    accuracy: round(accuracy, 3),
    rating,
    tricky,
    timing,
    tips,
    keys,
    pace,
    habits,
    shift,
    think,
  };
}

/**
 * Per letter: how often you pressed it and how often it was the key you hit
 * by mistake. Stored per drill (numbers only), so the panel can show each
 * tricky key's miss rate moving over time.
 */
export function keyStats(events, misses) {
  const out = {};
  for (const e of events) {
    if (e.kind !== "char" || !isLetterish(e.key)) continue;
    const k = e.key.toLowerCase();
    (out[k] || (out[k] = { presses: 0, misses: 0 })).presses += 1;
  }
  for (const [k, n] of Object.entries(misses || {})) {
    const key = k.toLowerCase();
    (out[key] || (out[key] = { presses: 0, misses: 0 })).misses += n;
  }
  return out;
}

/** Words per minute in five-second buckets across the drill, for the pace line. */
export function paceSeries(events, minutes) {
  const bucketMs = 5000;
  const n = Math.max(1, Math.ceil((minutes * 60000) / bucketMs));
  const counts = new Array(n).fill(0);
  for (const e of events) {
    if (e.kind === "backspace") continue;
    const i = Math.min(n - 1, Math.max(0, Math.floor(e.t / bucketMs)));
    counts[i] += 1;
  }
  return counts.map((c) => round(c / WORD_KEYSTROKES / (bucketMs / 60000), 1));
}

/* ---- pieces, each small enough to test on its own ---------------------- */

/**
 * Backspace runs, split in two. A run with any Option or Command delete in it
 * is a revision (he changed his mind on a word or a line); every other run is
 * a correction. With `compose`, a plain run is a revision as well when it took
 * out more than one word, or took out one whole word (three letters or more,
 * back to a space or the start) and what he typed next is a different word.
 * "teh " taken back and retyped "the" is a typo fixed; "wrong" taken back and
 * retyped "right" is a changed mind. The keystroke cost is the same; only
 * corrections are errors. revisedKeys counts the characters the revisions
 * removed: typed, counted in GWAM, not kept.
 */
export function deleteRuns(events, { compose = false } = {}) {
  let corrections = 0, revisions = 0, revisedKeys = 0;
  for (const run of runKinds(events, { compose })) {
    if (run.revised) { revisions += 1; revisedKeys += run.removed.length; } else corrections += 1;
  }
  return { corrections, revisions, revisedKeys };
}

/** Every Backspace run in order: what it removed, and whether it was a revision. */
export function runKinds(events, { compose = false } = {}) {
  const out = [];
  const buf = [];
  let run = null; // { via, removed: [], atBoundary, next: [] }
  let pending = null; // the last closed run, still reading the word typed after it
  const decide = (r) => {
    const removed = r.removed.join("");
    const body = removed.replace(/\s+$/, "");
    let revised = !!r.via;
    if (!revised && compose && body) {
      if (/\s/.test(body)) revised = true;
      else if (r.atBoundary && /^[A-Za-z]/.test(body) && body.replace(/[^A-Za-z]/g, "").length >= 3) {
        const retyped = r.next.join("").trim();
        revised = !retyped || !nearWord(body.toLowerCase(), retyped.toLowerCase());
      }
    }
    out.push({ removed, revised, via: r.via });
  };
  const close = () => {
    if (!run) return;
    run.atBoundary = buf.length === 0 || /\s/.test(buf[buf.length - 1]);
    pending = run;
    run = null;
  };
  for (const e of events) {
    if (e.kind === "backspace") {
      if (pending) { decide(pending); pending = null; }
      if (!run) run = { via: false, removed: [], next: [] };
      if (e.via) run.via = true;
      const ch = buf.pop();
      if (ch !== undefined) run.removed.unshift(ch);
      continue;
    }
    close();
    const ch = e.kind === "enter" ? "\n" : String(e.key || "");
    buf.push(ch);
    if (pending) {
      if (/\s/.test(ch) && pending.next.join("").trim()) { decide(pending); pending = null; }
      else pending.next.push(ch);
    }
  }
  close();
  if (pending) decide(pending);
  return out;
}

/** Two spellings of the same word: a slip apart, a transposition counting once. */
export function nearWord(a, b) {
  const limit = Math.max(a.length, b.length) <= 4 ? 1 : 2;
  if (Math.abs(a.length - b.length) > limit) return false;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length] <= limit;
}

/** The final text, the part that is kept: its words and characters. */
export function keptOf(text) {
  const t = String(text || "");
  const words = t.trim() ? t.trim().split(/\s+/).length : 0;
  return { words, chars: t.length };
}

/**
 * How he deletes. wordByHand counts plain Backspace runs that took out a whole
 * word of three letters or more, letter by letter, back to a space: the case
 * Option+Backspace does in one stroke. keysSpent is what those runs cost.
 */
export function deleteHabits(events) {
  const buf = [];
  let wordByHand = 0, keysSpent = 0, wordDeletes = 0, lineDeletes = 0;
  let run = null; // { n, via, removed }
  const close = () => {
    if (!run) return;
    if (run.via === "word") wordDeletes += 1;
    else if (run.via === "line") lineDeletes += 1;
    else {
      const removed = run.removed.join("");
      const atBoundary = buf.length === 0 || /\s/.test(buf[buf.length - 1]);
      const letters = removed.replace(/[^A-Za-z]/g, "").length;
      if (atBoundary && letters >= 3 && /[A-Za-z]/.test(removed[0] || "")) { wordByHand += 1; keysSpent += run.n; }
    }
    run = null;
  };
  for (const e of events) {
    if (e.kind === "backspace") {
      if (!run) run = { n: 0, via: null, removed: [] };
      run.n += 1;
      if (e.via) run.via = e.via;
      const ch = buf.pop();
      if (ch !== undefined) run.removed.unshift(ch);
      continue;
    }
    close();
    buf.push(e.kind === "enter" ? "\n" : String(e.key || ""));
  }
  close();
  return { wordByHand, keysSpent, wordDeletes, lineDeletes };
}

/**
 * Shift side. Touch typing shifts with the hand OPPOSITE the key: a capital T
 * (left hand) takes the right Shift. `same` counts the ones taken with the
 * shift on the key's own side, split by the hand of the key.
 */
export function shiftStats(events) {
  const out = { ok: 0, same: 0, sameLeft: 0, sameRight: 0 };
  for (const e of events) {
    if (e.kind !== "char" || !e.shift || !e.hand || e.shift === "B") continue;
    if (e.shift !== e.hand) out.ok += 1;
    else { out.same += 1; if (e.hand === "L") out.sameLeft += 1; else out.sameRight += 1; }
  }
  return out;
}

/**
 * Thinking, read apart from typing. A drill is composed, so some stops are
 * thought and not a fumble. Every gap over PAUSE_MS between keys is a
 * thinking stop, filed by what came just before it:
 *   sentence  after . ! ? or a new line (planning the next point)
 *   clause    after , ; : or a dash
 *   word      after a space (finding the next word)
 *   mid       inside a word (hesitation)
 * The idle stretch after the last key (`tailMs`) is not counted as a stop: it
 * may be thinking, or he may simply be done. flowWpm is the gross speed over
 * the time left once the stops and the tail are taken out.
 * `stops` lists where each one fell (characters into the text at that moment),
 * so a kept answer can show the expert where he stopped to think.
 */
export function thinkProfile(events, minutes) {
  const totalMs = (Number.isFinite(minutes) && minutes > 0 ? minutes : 1) * 60000;
  const out = { ms: 0, count: 0, sentence: 0, clause: 0, word: 0, mid: 0, tailMs: 0, flowWpm: 0, share: 0, stops: [] };
  const buf = [];
  let placed = 0;
  let lastT = null;
  const file = (gap) => {
    const prev = buf.length ? buf[buf.length - 1] : "\n";
    const kind = /[.!?\n]/.test(prev) ? "sentence" : /[,;:\u2013-]/.test(prev) ? "clause" : /\s/.test(prev) ? "word" : "mid";
    out[kind] += 1; out.count += 1; out.ms += gap;
    out.stops.push({ at: buf.length, ms: Math.round(gap), kind });
  };
  for (const e of events) {
    if (lastT !== null && e.t - lastT > PAUSE_MS) file(e.t - lastT);
    lastT = e.t;
    if (e.kind === "backspace") { buf.pop(); continue; }
    placed += 1;
    buf.push(e.kind === "enter" ? "\n" : String(e.key || ""));
  }
  if (lastT !== null && totalMs - lastT > PAUSE_MS) out.tailMs = Math.round(totalMs - lastT);
  const typingMs = Math.max(1000, totalMs - out.ms - out.tailMs);
  out.flowWpm = placed ? round(placed / WORD_KEYSTROKES / (typingMs / 60000), 1) : 0;
  out.share = round(Math.min(1, out.ms / totalMs), 2);
  out.ms = Math.round(out.ms);
  return out;
}

const isEvent = (e) => e && Number.isFinite(e.t)
  && (e.kind === "char" || e.kind === "backspace" || e.kind === "enter");

/** Consecutive events of one kind count once. */
export function countRuns(events, kind) {
  let runs = 0;
  let inRun = false;
  for (const e of events) {
    if (e.kind === kind) { if (!inRun) runs += 1; inRun = true; }
    else inRun = false;
  }
  return runs;
}

/** Tokens the lexicon does not know. Proper nouns, numbers and brackets are
 *  left alone: a name is not a typo and a bracket is a deliberate unknown. */
export function unknownWords(text, lexicon) {
  const out = [];
  const tokens = String(text).match(/[A-Za-z][A-Za-z'\u2019-]*/g) || [];
  for (const tok of tokens) {
    if (/^[A-Z]/.test(tok)) continue;
    const w = tok.toLowerCase().replace(/\u2019/g, "'").replace(/^'+|-+$/g, "");
    if (!w || isKnown(w, lexicon)) continue;
    out.push(w);
  }
  return out;
}

/**
 * The Mac's word list (/usr/share/dict/words) holds base forms only: "model"
 * and "name" are in it, "modeled" and "named" are not. So a word is known when
 * it is in the set, or when stripping one ordinary English ending leaves a
 * word that is. Whole words in the set always win; the rules only widen.
 */
export function isKnown(word, lexicon) {
  if (!word) return false;
  word = word.replace(/\u2019/g, "'");
  if (lexicon.has(word)) return true;
  // Possessives and contractions are standard English, never typos:
  // "gambler's", "clients'", "don't", "they're", "we've", "it'll", "she'd".
  if (word.includes("'")) {
    const special = CONTRACTIONS[word];
    if (special) return isKnown(special, lexicon);
    for (const end of ["n't", "'re", "'ve", "'ll", "'d", "'m", "'s", "'"]) {
      if (word.endsWith(end) && word.length > end.length) return isKnown(word.slice(0, -end.length), lexicon);
    }
    return false;
  }
  // A hyphenated compound is known when every part is: "task-analysis", "follow-up".
  if (word.includes("-")) {
    const parts = word.split("-").filter(Boolean);
    return parts.length > 1 && parts.every((w) => isKnown(w, lexicon));
  }
  if (word.length < 4) return false;
  const tryBase = (b) => b.length >= 2 && lexicon.has(b);
  for (const [suffix, adds] of SUFFIXES) {
    if (!word.endsWith(suffix) || word.length - suffix.length < 2) continue;
    const stem = word.slice(0, -suffix.length);
    for (const add of adds) {
      if (tryBase(stem + add)) return true;
    }
    // A doubled final consonant before the ending: "stopped", "running".
    if (/([b-df-hj-np-tv-z])\1$/.test(stem) && tryBase(stem.slice(0, -1))) return true;
  }
  return false;
}

/** Contractions whose stem is not a word on its own. */
const CONTRACTIONS = { "can't": "can", "won't": "will", "shan't": "shall", "ain't": "is", "y'all": "you", "o'clock": "clock", "ma'am": "madam" };

/** ending -> what the base may need back: "" (nothing), "e" (named -> name), "y" (families -> family). */
const SUFFIXES = [
  ["ies", ["y"]], ["ied", ["y"]], ["ier", ["y"]], ["iest", ["y"]], ["ily", ["y"]],
  ["ing", ["", "e"]], ["ed", ["", "e"]], ["es", ["", "e"]], ["s", [""]], ["d", ["e"]],
  ["er", ["", "e"]], ["est", ["", "e"]], ["ly", [""]], ["ness", [""]], ["ment", [""]], ["ful", [""]], ["less", [""]],
  ["ally", ["al"]], ["tion", ["te"]], ["ers", ["", "e"]], ["ings", ["", "e"]],
];

export function rate(nwam, accuracy) {
  let i = BANDS.findIndex((b) => nwam >= b.min);
  if (i < 0) i = BANDS.length - 1;
  const gated = accuracy < ACCURACY_GATE && i < BANDS.length - 1;
  if (gated) i += 1;
  return { name: BANDS[i].name, nwam: round(nwam, 1), accuracyGated: gated };
}

/**
 * What you hit instead. A run of Backspaces removes a stretch of text; what
 * you type next replaces it. The two stretches are lined up from the start and
 * the first place they differ is the error: hit = the removed character there,
 * meant = the typed one. That reads "teh" corrected to "the" as e for h, and
 * "wprd" corrected to "word" as p for o, where "last removed versus first
 * typed" would call both wrong.
 */
export function trickyKeys(events, { compose = false } = {}) {
  // Under compose, a run the classifier calls a changed mind is not a miss either.
  const kinds = compose ? runKinds(events, { compose }) : null;
  let runIdx = -1;
  const buffer = [];
  const hits = new Map();   // hit char -> count
  const pairs = new Map();  // "hit>meant" -> count
  let removed = null;       // the run being removed, in typed order
  let replacement = null;   // what has been typed since the run ended
  let revising = false;     // the run used Option or Command: a change of mind, not a miss
  let inRun = false;
  const settle = () => {
    if (!removed || !replacement || revising) { removed = null; replacement = null; revising = false; return; }
    const n = Math.min(removed.length, replacement.length);
    for (let i = 0; i < n; i++) {
      if (removed[i] === replacement[i]) continue;
      const hit = removed[i], meant = replacement[i];
      if (isLetterish(hit)) {
        hits.set(hit, (hits.get(hit) || 0) + 1);
        if (isLetterish(meant)) { const k = hit + ">" + meant; pairs.set(k, (pairs.get(k) || 0) + 1); }
      }
      break;
    }
    removed = null; replacement = null; revising = false;
  };
  for (const e of events) {
    if (e.kind === "backspace") {
      if (replacement) settle();              // a new run starts: close the last one
      if (!inRun) { runIdx += 1; inRun = true; if (kinds && kinds[runIdx] && kinds[runIdx].revised) revising = true; }
      if (e.via) revising = true;
      const ch = buffer.pop();
      if (ch !== undefined) removed = [ch].concat(removed || []);
      continue;
    }
    inRun = false;
    const ch = e.kind === "enter" ? "\n" : String(e.key || "");
    if (!ch) continue;
    if (removed) {
      replacement = (replacement || []).concat([ch]);
      if (replacement.length >= removed.length) settle();
    }
    buffer.push(ch);
  }
  settle();
  const top = [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([key, count]) => ({ key, count }));
  const confusions = [...pairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, count]) => ({ hit: k[0], meant: k[2], count }));
  return { keys: top, confusions, all: Object.fromEntries(hits) };
}

const isLetterish = (c) => typeof c === "string" && c.length === 1 && /[A-Za-z]/.test(c);

/**
 * Where you slow down. Intervals between placed characters, against your own
 * median for this drill. Pauses over PAUSE_MS are composing, not typing, and
 * are counted separately rather than folded into the rhythm.
 */
export function timingProfile(events) {
  const placed = events.filter((e) => e.kind !== "backspace");
  const intervals = [];
  const inWord = [];         // letter to letter: the fingers, with the thinking left out
  const digraph = new Map(); // "ab" -> [ms, ...]
  let afterShift = [];
  let punct = [];
  let pauses = 0;
  for (let i = 1; i < placed.length; i++) {
    const dt = placed[i].t - placed[i - 1].t;
    if (!(dt >= 0)) continue;
    if (dt > PAUSE_MS) { pauses += 1; continue; }
    intervals.push(dt);
    const a = placed[i - 1].kind === "enter" ? "\n" : String(placed[i - 1].key || "");
    const b = placed[i].kind === "enter" ? "\n" : String(placed[i].key || "");
    if (isLetterish(a) && isLetterish(b)) {
      const k = a.toLowerCase() + b.toLowerCase();
      if (!digraph.has(k)) digraph.set(k, []);
      digraph.get(k).push(dt);
      inWord.push(dt);
    }
    if (/[A-Z]/.test(b)) afterShift.push(dt);
    if (/[,.;:!?]/.test(b)) punct.push(dt);
  }
  const med = median(intervals);
  const mean = intervals.length ? intervals.reduce((s, x) => s + x, 0) / intervals.length : 0;
  const sd = intervals.length > 1
    ? Math.sqrt(intervals.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (intervals.length - 1))
    : 0;
  const slow = [...digraph.entries()]
    .map(([k, xs]) => ({ pair: k, n: xs.length, ms: Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) }))
    .filter((d) => d.n >= 2 && med > 0 && d.ms > SLOW_FACTOR * med)
    .sort((a, b) => b.ms - a.ms).slice(0, 5);
  return {
    intervals: intervals.length,
    medianMs: Math.round(med),
    cv: mean > 0 ? round(sd / mean, 2) : 0,
    wordIntervals: inWord.length,
    wordCv: cvOf(inWord),
    pauses,
    afterShiftMs: afterShift.length ? Math.round(median(afterShift)) : null,
    punctuationMs: punct.length ? Math.round(median(punct)) : null,
    slowPairs: slow,
  };
}

/** A tip appears only when its trigger fired. */
export function formTips({ grossWords, corrections, tricky, timing, habits, shift }) {
  const tips = [];
  if (grossWords >= 10 && corrections / grossWords > 0.1) {
    tips.push({ id: "pace", why: `${corrections} corrections in ${Math.round(grossWords)} words`,
      tip: "You are out-typing your eyes. Take five percent off the pace; NWAM goes up when the corrections stop, not when the fingers speed up." });
  }
  const med = timing.medianMs || 0;
  if (med && timing.afterShiftMs && timing.afterShiftMs > SLOW_FACTOR * med) {
    tips.push({ id: "shift", why: `${timing.afterShiftMs}ms after Shift against a ${med}ms median`,
      tip: "Capitals cost you. Shift with the hand opposite the letter, and hold it only as long as the letter takes." });
  }
  if (med && timing.punctuationMs && timing.punctuationMs > SLOW_FACTOR * med) {
    tips.push({ id: "punctuation", why: `${timing.punctuationMs}ms on commas and full stops against a ${med}ms median`,
      tip: "Punctuation is breaking your rhythm. Type the mark and the space as one motion; the space is part of the key." });
  }
  const neighbours = tricky.confusions.filter((c) => NEIGHBOURS.has(c.hit + c.meant) || NEIGHBOURS.has(c.meant + c.hit));
  if (neighbours.length) {
    tips.push({ id: "drift", why: neighbours.map((c) => `${c.hit} for ${c.meant}`).join(", "),
      tip: "Home-row drift. Re-anchor on F and J at every space for one drill and see the pairs disappear." });
  }
  if (shift && shift.same >= 3 && shift.same / (shift.same + shift.ok) >= 0.2) {
    const worse = shift.sameLeft >= shift.sameRight ? "left" : "right";
    const other = worse === "left" ? "right" : "left";
    tips.push({ id: "shiftSide", why: `${shift.same} of ${shift.same + shift.ok} capitals took the Shift on the key's own side, ${shift.sameLeft} left and ${shift.sameRight} right`,
      tip: `Opposite hand on Shift. A ${worse}-hand letter wants the ${other} Shift, pressed by the ${other} pinky while the ${worse} hand stays home.` });
  }
  if (habits && habits.wordByHand >= 2) {
    tips.push({ id: "optionDelete", why: `${habits.wordByHand} words backspaced letter by letter, ${habits.keysSpent} keys`,
      tip: "Changed your mind on a word? Option+Backspace takes the whole word in one stroke, and Command+Backspace takes the line. A changed mind is a revision either way, never an error; the shortcut saves the keys." });
  }
  // Cadence reads the fingers only: letter to letter inside words. The gaps
  // between words and sentences are thinking, and the drill wants the thinking.
  if (timing.wordIntervals >= 20 && timing.wordCv > 0.6) {
    tips.push({ id: "cadence", why: `letter-to-letter timing inside words varies ${Math.round(timing.wordCv * 100)}%`,
      tip: "Uneven fingers, not uneven thinking. Pick the two slow pairs above and type each ten times slowly and evenly; the rhythm inside words is the part practice fixes." });
  }
  return tips;
}

const NEIGHBOURS = new Set(["er", "io", "nm", "ui", "op", "as", "sd", "df", "jk", "kl", "cv", "vb", "tr", "ty", "gh", "fg"]);

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function cvOf(xs) {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
  return m > 0 ? round(sd / m, 2) : 0;
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round = (x, d) => { const p = 10 ** d; return Math.round(x * p) / p; };
