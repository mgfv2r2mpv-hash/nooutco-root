/* The nemesis drill: thirty seconds on the one thing his own numbers say is
 * costing him, offered and never forced (his ask of 2026-09-23: "fun and
 * genuinely instructive"). Pure: nemeses and passages in, a drill out.
 * node --test reads it.
 *
 * The drill is a word list made of real words from the passages, heavy on the
 * target, with a line that teaches the fingering. Its numbers live in their
 * own log (settings.tame), never in history: a word list is easier than prose,
 * so it must not move his bests, his bands, the copy picker or the nemesis
 * engine. A nemesis is tamed in real rounds only; the drill is the practice.
 */
import { nemeses } from "./nemeses.js";

export const TAME_SECONDS = 30;
export const TAME_WORDS = 45;
/* The log is numbers only, and short: enough for trophies and a trend. */
export const TAME_LOG_MAX = 300;

const ROWS = [["top", "qwertyuiop"], ["home", "asdfghjkl"], ["bottom", "zxcvbnm"]];
const FINGERS = ["left pinky", "left ring finger", "left middle finger", "left index finger", "left index finger",
  "right index finger", "right index finger", "right middle finger", "right ring finger", "right pinky"];
const up = (s) => String(s).toUpperCase();

/** Where a letter lives: { finger, row, col, hand } on a US keyboard, or null. */
export function fingerOf(letter) {
  const k = String(letter || "").toLowerCase();
  for (const [row, keys] of ROWS) {
    const col = keys.indexOf(k);
    if (col >= 0) return { finger: FINGERS[col], row, col, hand: col <= 4 ? "left" : "right" };
  }
  return null;
}
const where = (k) => { const f = fingerOf(k); return f ? `${f.finger}, ${f.row} row` : "?"; };

/**
 * The nemesis to drill: the most recently spotted one not yet tamed. With none,
 * his trickiest key lately (from the copy picker's profile), so the offer is
 * there from the first week. Null when there is nothing to aim at.
 */
export function tameTarget(history, trickyKeys = []) {
  const open = nemeses(history || []).filter((n) => !n.unlocked);
  const n = open[open.length - 1];
  if (n) {
    const letter = n.kind === "pair" ? n.key : n.kind === "confuse" ? n.meant : n.key;
    return { id: n.id, kind: n.kind, key: n.key, letter, hit: n.kind === "confuse" ? String(n.key).split(">")[1] : null, name: n.name };
  }
  const k = (trickyKeys || []).find((x) => /^[a-z]$/.test(x));
  return k ? { id: `tricky-${k}`, kind: "key", key: k, letter: k, hit: null, name: `your trickiest key lately, ${up(k)}` } : null;
}

/** One teaching line: which finger, which row, what to do about it. */
export function tameLesson(t) {
  if (!t) return "";
  if (t.kind === "pair") {
    const [a, b] = [...t.key];
    const same = fingerOf(a) && fingerOf(b) && fingerOf(a).finger === fingerOf(b).finger;
    return `${up(t.key)}: ${up(a)} is your ${where(a)}, ${up(b)} is your ${where(b)}.`
      + (same ? " One finger does both, so the second key waits for it to travel: make that one smooth motion, not two stabs." : " Two fingers: have the second one already moving while the first key goes down.");
  }
  if (t.kind === "confuse") {
    return `You have been hitting ${up(t.hit)} for ${up(t.letter)}. ${up(t.letter)} is your ${where(t.letter)}; ${up(t.hit)} is your ${where(t.hit)}. Say the letter to yourself as the finger goes, slow enough to be right.`;
  }
  if (t.kind === "refused") {
    const f = fingerOf(t.key);
    const other = f && f.hand === "left" ? "right" : "left";
    return `Capital ${up(t.key)}: ${up(t.key)} is a ${f ? f.hand : "?"}-hand key, so your ${other} pinky holds the ${other} Shift. Every word here starts with it.`;
  }
  return `${up(t.key)} is your ${where(t.key)}. Reach for it from home and come straight back after each one; clean first, then fast.`;
}

/** Real words from the passages: lowercase letters only, three or more. */
export function wordPool(texts) {
  const out = new Set();
  for (const t of texts || []) for (const w of String(t).match(/[A-Za-z]+/g) || []) if (w.length >= 3) out.add(w.toLowerCase());
  return [...out];
}

/**
 * The drill text: TAME_WORDS words, two with the target to one without, never
 * the same word twice in a row. For a refused capital, the target words are
 * capitalised, since the capital is the thing being drilled.
 */
export function tameText(t, pool, rand = Math.random) {
  if (!t || !pool || !pool.length) return "";
  const has = t.kind === "pair" ? (w) => w.includes(t.key)
    : t.kind === "refused" ? (w) => w.startsWith(t.key)
    : t.kind === "confuse" ? (w) => w.includes(t.letter)
    : (w) => w.includes(t.key);
  const hits = pool.filter(has), rest = pool.filter((w) => !has(w));
  if (!hits.length) return "";
  const draw = (list, last) => {
    for (let i = 0; i < 5; i++) { const w = list[Math.floor(rand() * list.length)]; if (w !== last) return w; }
    return list[Math.floor(rand() * list.length)];
  };
  const words = [];
  for (let i = 0; i < TAME_WORDS; i++) {
    const useHit = !rest.length || i % 3 !== 2;
    let w = draw(useHit ? hits : rest, words[words.length - 1]);
    if (useHit && t.kind === "refused") w = up(w[0]) + w.slice(1);
    words.push(w);
  }
  return words.join(" ");
}

/** The drill as a passage the copy round can run. */
export function tameDrill(t, texts, rand = Math.random) {
  const text = tameText(t, wordPool(texts), rand);
  if (!text) return null;
  return {
    id: `tame-${t.id}`, kind: "tame", target: t, title: `Nemesis drill: ${t.name}`, text, outline: null,
    source: "Words from the passages, heavy on the target. Practice only: stays out of your bests and bands.",
    lesson: tameLesson(t),
  };
}

/**
 * How the target went this round, from the score (numbers, never text):
 * { line, clean } where clean says the target cost nothing.
 */
export function tameReport(t, s) {
  if (!t || !s) return { line: "", clean: false };
  if (t.kind === "pair") {
    const slow = (s.timing && s.timing.slowPairs || []).find((p) => p.pair === t.key);
    return slow ? { line: `${up(t.key)} still ran slow, ${slow.ms} ms. Smooth first; the speed comes after.`, clean: false }
      : { line: `${up(t.key)} did not run slow this time.`, clean: true };
  }
  if (t.kind === "confuse") {
    const c = (s.tricky && s.tricky.confusions || []).find((x) => x.meant === t.letter && x.hit === t.hit);
    return c ? { line: `${up(t.hit)} for ${up(t.letter)} ${c.count} time${c.count === 1 ? "" : "s"}. Slower, and say it as you go.`, clean: false }
      : { line: `Not one ${up(t.hit)} for ${up(t.letter)}.`, clean: true };
  }
  if (t.kind === "refused") {
    const r = (s.refused && s.refused.keys || []).find((x) => String(x.key).toLowerCase() === t.key);
    return r ? { line: `Capital ${up(t.key)} refused ${r.count} time${r.count === 1 ? "" : "s"}: the other pinky, every time.`, clean: false }
      : { line: `Every capital ${up(t.key)} with the right Shift.`, clean: true };
  }
  const k = s.keys && s.keys[t.key];
  const presses = Number(k && k.presses) || 0, misses = Number(k && k.misses) || 0;
  if (!presses) return { line: `No ${up(t.key)} typed.`, clean: false };
  return { line: `${up(t.key)}: ${misses} missed of ${presses} presses (${Math.round((misses / presses) * 1000) / 10}%).`, clean: misses === 0 && presses >= 10 };
}

/** The log entry for a finished drill: numbers and the target's id only. */
export function tameEntry(t, s, at, minutes = TAME_SECONDS / 60) {
  return { at, mode: "tame", minutes, target: t.id, kind: t.kind, nwam: s.nwam, gwam: s.gwam, accuracy: s.accuracy, clean: tameReport(t, s).clean };
}

export const appendTame = (log, entry) => [...(Array.isArray(log) ? log : []), entry].slice(-TAME_LOG_MAX);
