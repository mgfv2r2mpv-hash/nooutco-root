/* Clinical typing drills: the scorer.
 *
 * A typing test scores you against a passage you copy. A drill has no passage,
 * because you compose the answer, so every number here is read from the
 * keystroke log instead. The arithmetic is the timed-writing standard: a word
 * is five keystrokes, whatever was typed.
 *
 *   GWAM        keystrokes that put a character in the box / 5 / minutes
 *   corrections runs of Backspace, one run = one correction
 *   uncorrected tokens of the final text the lexicon does not know
 *   NWAM        GWAM minus errors per minute (uncorrected when a lexicon is
 *               given; corrections stand in until one is, and the result says so)
 *   accuracy    1 - (corrections + uncorrected) / gross words
 *
 * Pure. No DOM, no clock of its own: the page hands it the events it saw.
 * Loaded as an ES module by the page and by node --test.
 */

export const WORD_KEYSTROKES = 5;
export const ACCURACY_GATE = 0.96;
export const PAUSE_MS = 2000;
export const SLOW_FACTOR = 2;

/** Rating bands on NWAM. Accuracy under the gate drops one band. */
export const BANDS = Object.freeze([
  { min: 75, name: "Professional" },
  { min: 60, name: "Fluent" },
  { min: 45, name: "Intermediate" },
  { min: 35, name: "Average" },
  { min: 0, name: "Amateur" },
]);

/**
 * @typedef {{ t: number, kind: "char"|"backspace"|"enter", key?: string }} DrillEvent
 *   t is milliseconds from the first keystroke. A char event carries the
 *   character it placed; enter places a newline; backspace removes one.
 */

/**
 * @param {object} args
 * @param {DrillEvent[]} args.events
 * @param {string} args.text       the box's final contents
 * @param {number} args.minutes    the clock the drill ran on
 * @param {Set<string>|null} [args.lexicon]  lower-case words the drill knows
 */
export function scoreDrill({ events, text, minutes, lexicon } = {}) {
  const evs = Array.isArray(events) ? events.filter(isEvent) : [];
  const mins = Number.isFinite(minutes) && minutes > 0 ? minutes : 1;
  const placed = evs.filter((e) => e.kind !== "backspace").length;
  const grossWords = placed / WORD_KEYSTROKES;
  const gwam = grossWords / mins;

  const corrections = countRuns(evs, "backspace");
  const unknown = lexicon ? unknownWords(text || "", lexicon) : null;
  const uncorrected = unknown ? unknown.length : null;
  const errorsForNet = uncorrected === null ? corrections : uncorrected;
  const nwam = Math.max(0, gwam - errorsForNet / mins);
  const errorsAll = corrections + (uncorrected || 0);
  const accuracy = grossWords > 0 ? clamp01(1 - errorsAll / grossWords) : 0;

  const rating = rate(nwam, accuracy);
  const tricky = trickyKeys(evs);
  const timing = timingProfile(evs);
  const tips = formTips({ grossWords, corrections, tricky, timing });
  const keys = keyStats(evs, tricky.all);
  const pace = paceSeries(evs, mins);

  return {
    minutes: mins,
    keystrokes: placed,
    grossWords: round(grossWords, 1),
    gwam: round(gwam, 1),
    corrections,
    uncorrected,
    unknownWords: unknown || [],
    netBasis: uncorrected === null ? "corrections" : "uncorrected",
    nwam: round(nwam, 1),
    accuracy: round(accuracy, 3),
    rating,
    tricky,
    timing,
    tips,
    keys,
    pace,
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
  const tokens = String(text).match(/[A-Za-z][A-Za-z'-]*/g) || [];
  for (const tok of tokens) {
    if (/^[A-Z]/.test(tok)) continue;
    const w = tok.toLowerCase().replace(/^'+|'+$/g, "");
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
  if (lexicon.has(word)) return true;
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
export function trickyKeys(events) {
  const buffer = [];
  const hits = new Map();   // hit char -> count
  const pairs = new Map();  // "hit>meant" -> count
  let removed = null;       // the run being removed, in typed order
  let replacement = null;   // what has been typed since the run ended
  const settle = () => {
    if (!removed || !replacement) { removed = null; replacement = null; return; }
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
    removed = null; replacement = null;
  };
  for (const e of events) {
    if (e.kind === "backspace") {
      if (replacement) settle();              // a new run starts: close the last one
      const ch = buffer.pop();
      if (ch !== undefined) removed = [ch].concat(removed || []);
      continue;
    }
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
    pauses,
    afterShiftMs: afterShift.length ? Math.round(median(afterShift)) : null,
    punctuationMs: punct.length ? Math.round(median(punct)) : null,
    slowPairs: slow,
  };
}

/** A tip appears only when its trigger fired. */
export function formTips({ grossWords, corrections, tricky, timing }) {
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
  if (timing.pauses >= 3) {
    tips.push({ id: "composing", why: `${timing.pauses} pauses over two seconds`,
      tip: "Those are composing pauses, not typing. Fine for the clinic; for the typing number on its own, run a copy drill." });
  }
  if (timing.intervals >= 20 && timing.cv > 0.6) {
    tips.push({ id: "cadence", why: `timing varies ${Math.round(timing.cv * 100)}% around its median`,
      tip: "Cadence, not speed. Try a drill at a pace you can hold evenly; even cadence is where the next ten words a minute come from." });
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
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round = (x, d) => { const p = 10 ** d; return Math.round(x * p) / p; };
