#!/usr/bin/env node
/* Carry one Mac's drills over to another, without either side losing a day.
 *
 *   node app/carry-over.mjs <the other Mac's folder> [--into <folder>] [--dry]
 *
 * He drills on two Macs. A plain copy would make one of them the loser, and a
 * lost day breaks a streak he can see on the calendar, so this merges instead:
 * every round, every kept answer, every game run from both sides, deduplicated
 * by the timestamp each one already carries. Run it in either direction, as
 * often as the two machines drift apart.
 *
 * What it merges, and by what key:
 *   history.json        rounds, by `at` (ISO, milliseconds: unique in practice)
 *   lexicon.json        his clinical words, a set
 *   settings.json       words (set), tame log and shelf and game runs (by `at`
 *                       or id), earned game trophies (the earlier date wins),
 *                       and the plain preferences from whichever Mac he used
 *                       last, since the fresh install's defaults are not a choice
 *   kept/               the answers themselves: a file that is already there is
 *                       never overwritten, because the name carries its timestamp
 *   expert-queue.jsonl  a set of lines, in timestamp order
 *   expert-sent.json    the stamps already proposed to the expert, a set: miss
 *                       this and the other Mac's app proposes them all again
 *
 * oracle/ is not carried: it is an empty folder the CLI is run in, so that no
 * project's CLAUDE.md is read, and it holds nothing of his.
 *
 * app.log is left alone: each Mac keeps its own.
 *
 * The destination is backed up before anything is written, and every write
 * lands through a temporary file, so an interrupted run cannot leave half a
 * history behind.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, renameSync, cpSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";

import { HISTORY_MAX } from "../web/store.js";
import { RUNS_KEPT } from "../web/minigames.js";
import { TAME_LOG_MAX } from "../web/tame.js";

export const DEFAULT_SUPPORT = join(homedir(), "Library", "Application Support", "ClickClackOracle");

/* The files the app owns. A folder with none of them is not a data folder. */
const FILES = ["history.json", "lexicon.json", "settings.json", "expert-queue.jsonl", "expert-sent.json"];

/* Preferences that are one choice, not a list: they come from one side whole. */
const SCALAR_KEYS = ["mode", "minutes", "strictShift", "copyDefault", "bandsNoted", "v"];

// ------------------------------------------------------------------ reading

/** Read JSON, or the fallback when the file is missing or not what it claims. */
export function readJSON(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    const v = JSON.parse(readFileSync(path, "utf8"));
    if (Array.isArray(fallback)) return Array.isArray(v) ? v : fallback;
    if (fallback && typeof fallback === "object") return v && typeof v === "object" && !Array.isArray(v) ? v : fallback;
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

/** Every line of a jsonl file that is not blank. */
export function readLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
}

// ------------------------------------------------------------------ merging

/** The timestamp a record sorts by, or "" when it carries none. */
const atOf = (r) => (r && typeof r.at === "string" ? r.at : "");

/**
 * Both lists as one, a record per `at`, oldest first. Where the same `at`
 * appears on both Macs it is the same round, so the fuller record wins: a
 * round the other side scored and this one did not keeps its scores.
 */
export function mergeByAt(mine, theirs, cap = 0) {
  const by = new Map();
  for (const r of [...(mine || []), ...(theirs || [])]) {
    if (!r || typeof r !== "object") continue;
    const key = atOf(r) || JSON.stringify(r);
    const seen = by.get(key);
    if (!seen || Object.keys(r).length > Object.keys(seen).length) by.set(key, r);
  }
  const all = [...by.values()].sort((a, b) => (atOf(a) < atOf(b) ? -1 : atOf(a) > atOf(b) ? 1 : 0));
  return cap > 0 ? all.slice(-cap) : all;
}

/** Both word lists as one set, in a settled order. */
export function mergeWords(mine, theirs) {
  const words = [...(mine || []), ...(theirs || [])].filter((w) => typeof w === "string" && w.trim());
  return [...new Set(words)].sort();
}

/** One shelf entry per passage, the later one kept: it holds the newer count. */
export function mergeShelf(mine, theirs) {
  const by = new Map();
  for (const e of [...(mine || []), ...(theirs || [])]) {
    if (!e || typeof e !== "object" || !e.id) continue;
    const seen = by.get(e.id);
    if (!seen || atOf(e) > atOf(seen)) by.set(e.id, e);
  }
  return [...by.values()];
}

/** A trophy is earned the first time, so the earlier of the two dates stands. */
export function mergeEarned(mine, theirs) {
  const out = { ...(theirs || {}) };
  for (const [id, at] of Object.entries(mine || {})) {
    if (!out[id] || String(at) < String(out[id])) out[id] = at;
  }
  return out;
}

/** The mini games: runs by `at`, per pair and per game, under the same cap. */
export function mergeGames(mine, theirs) {
  const m = mine && typeof mine === "object" ? mine : {};
  const t = theirs && typeof theirs === "object" ? theirs : {};
  const pairKeys = new Set([...Object.keys(m.pairs || {}), ...Object.keys(t.pairs || {})]);
  const pairs = Object.fromEntries(
    [...pairKeys].map((k) => [k, mergeByAt((m.pairs || {})[k], (t.pairs || {})[k], RUNS_KEPT)]),
  );
  return {
    pairs,
    shifty: mergeByAt(m.shifty, t.shifty, RUNS_KEPT),
    river: mergeByAt(m.river, t.river, RUNS_KEPT),
    earned: mergeEarned(m.earned, t.earned),
  };
}

/** The newest round on a side, so the tool can tell which Mac he used last. */
export const newestAt = (history) => (history || []).reduce((n, r) => (atOf(r) > n ? atOf(r) : n), "");

/**
 * Both settings as one. The lists merge; the plain preferences come from the
 * Mac with the newer round, because a fresh install's defaults are not a
 * choice he made. A key only one side has is taken from that side either way.
 */
export function mergeSettings(mine, theirs, { mineNewer = true } = {}) {
  const m = mine && typeof mine === "object" ? mine : {};
  const t = theirs && typeof theirs === "object" ? theirs : {};
  const first = mineNewer ? m : t;
  const second = mineNewer ? t : m;
  const out = { ...second, ...first };
  for (const k of SCALAR_KEYS) {
    if (k in first) out[k] = first[k];
    else if (k in second) out[k] = second[k];
  }
  out.words = mergeWords(m.words, t.words);
  out.tame = mergeByAt(m.tame, t.tame, TAME_LOG_MAX);
  out.shelf = mergeShelf(m.shelf, t.shelf);
  out.games = mergeGames(m.games, t.games);
  if (!out.words.length) delete out.words;
  if (!out.tame.length) delete out.tame;
  if (!out.shelf.length) delete out.shelf;
  return out;
}

/** The expert queue as a set of lines, oldest first, order kept where it ties. */
export function mergeQueue(mine, theirs) {
  const lines = [...new Set([...(mine || []), ...(theirs || [])])];
  const at = (l) => {
    try { return String(JSON.parse(l).at || ""); } catch (e) { return ""; }
  };
  return lines.map((l, i) => ({ l, i, at: at(l) }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.i - b.i))
    .map((x) => x.l);
}

// ------------------------------------------------------------------ the run

const writeJSON = (path, value) => {
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
};

const writeLines = (path, lines) => {
  const tmp = path + ".tmp";
  writeFileSync(tmp, lines.length ? lines.join("\n") + "\n" : "", "utf8");
  renameSync(tmp, path);
};

const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "").replace(/(\d{8})/, "$1-");

/** Is this a ClickClackOracle data folder? A wrong path must not be merged. */
export function looksLikeData(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  return FILES.some((f) => existsSync(join(dir, f))) || existsSync(join(dir, "kept"));
}

/**
 * Merge `from` into `into`. Returns what it did, in counts, so the caller can
 * print it or a test can read it. With `dry`, nothing is written at all.
 */
export function carryOver(from, into, { dry = false } = {}) {
  if (!looksLikeData(from)) throw new Error(`${from} does not hold a ClickClackOracle data folder`);
  mkdirSync(into, { recursive: true });

  const mine = {
    history: readJSON(join(into, "history.json"), []),
    lexicon: readJSON(join(into, "lexicon.json"), []),
    settings: readJSON(join(into, "settings.json"), {}),
    queue: readLines(join(into, "expert-queue.jsonl")),
    sent: readJSON(join(into, "expert-sent.json"), []),
  };
  const theirs = {
    history: readJSON(join(from, "history.json"), []),
    lexicon: readJSON(join(from, "lexicon.json"), []),
    settings: readJSON(join(from, "settings.json"), {}),
    queue: readLines(join(from, "expert-queue.jsonl")),
    sent: readJSON(join(from, "expert-sent.json"), []),
  };

  const history = mergeByAt(mine.history, theirs.history, HISTORY_MAX);
  const lexicon = mergeWords(mine.lexicon, theirs.lexicon);
  const settings = mergeSettings(mine.settings, theirs.settings, {
    mineNewer: newestAt(mine.history) >= newestAt(theirs.history),
  });
  const queue = mergeQueue(mine.queue, theirs.queue);
  // The same set merge as the words: these are `at` stamps, and an answer both
  // Macs have already proposed must never be proposed a second time.
  const sent = mergeWords(mine.sent, theirs.sent);

  const theirKept = existsSync(join(from, "kept")) ? readdirSync(join(from, "kept")) : [];
  const copied = theirKept.filter((f) => !f.startsWith(".") && !existsSync(join(into, "kept", f)));

  const report = {
    from, into, dry,
    backup: null,
    rounds: { mine: mine.history.length, theirs: theirs.history.length, after: history.length },
    words: { mine: mine.lexicon.length, theirs: theirs.lexicon.length, after: lexicon.length },
    kept: { theirs: theirKept.length, copied: copied.length },
    queue: { mine: mine.queue.length, theirs: theirs.queue.length, after: queue.length },
    sent: { mine: mine.sent.length, theirs: theirs.sent.length, after: sent.length },
    usedPreferencesFrom: newestAt(mine.history) >= newestAt(theirs.history) ? "this Mac" : "the other Mac",
  };
  if (dry) return report;

  // The backup first: everything below can be undone by putting it back.
  const backup = `${into}-backup-carryover-${stamp()}`;
  cpSync(into, backup, { recursive: true });
  report.backup = backup;

  writeJSON(join(into, "history.json"), history);
  writeJSON(join(into, "lexicon.json"), lexicon);
  writeJSON(join(into, "settings.json"), settings);
  writeLines(join(into, "expert-queue.jsonl"), queue);
  if (sent.length) writeJSON(join(into, "expert-sent.json"), sent);
  mkdirSync(join(into, "kept"), { recursive: true });
  for (const f of copied) copyFileSync(join(from, "kept", f), join(into, "kept", f));
  return report;
}

// ------------------------------------------------------------------ the shell

/** The arguments, read: which folder comes in, which it goes into, and dry or not. */
export function parseArgs(args) {
  const dry = args.includes("--dry");
  const intoAt = args.indexOf("--into");
  const into = intoAt >= 0 ? args[intoAt + 1] : DEFAULT_SUPPORT;
  // Only skip the word after --into, never index 0 when there is no --into.
  const taken = intoAt >= 0 ? intoAt + 1 : -1;
  const from = args.filter((a, i) => !a.startsWith("--") && i !== taken)[0];
  return { from, into, dry };
}

function main(argv) {
  const { from, into, dry } = parseArgs(argv.slice(2));
  if (!from) {
    console.error("usage: node app/carry-over.mjs <the other Mac's folder> [--into <folder>] [--dry]");
    process.exit(2);
  }
  if (!into) {
    console.error("--into needs a folder");
    process.exit(2);
  }
  const r = carryOver(from, into, { dry });
  const lines = [
    `${r.dry ? "would merge" : "merged"} ${basename(r.from)} into ${r.into}`,
    `  rounds     ${r.rounds.mine} here + ${r.rounds.theirs} there -> ${r.rounds.after}`,
    `  words      ${r.words.mine} here + ${r.words.theirs} there -> ${r.words.after}`,
    `  kept       ${r.kept.copied} of their ${r.kept.theirs} answers came over`,
    `  queue      ${r.queue.mine} here + ${r.queue.theirs} there -> ${r.queue.after}`,
    `  proposed   ${r.sent.mine} here + ${r.sent.theirs} there -> ${r.sent.after} already with the expert`,
    `  preferences from ${r.usedPreferencesFrom}`,
  ];
  if (r.backup) lines.push(`  backup     ${r.backup}`);
  if (r.dry) lines.push("  (nothing was written)");
  console.log(lines.join("\n"));
}

if (process.argv[1] && process.argv[1].endsWith("carry-over.mjs")) main(process.argv);
