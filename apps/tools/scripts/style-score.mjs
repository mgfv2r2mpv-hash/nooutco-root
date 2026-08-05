#!/usr/bin/env node
/**
 * style-score - a deterministic, dependency-free scorer for the signals AI
 * detectors actually key on.
 *
 * WHY THIS AND NOT PERPLEXITY. Real perplexity needs token log-probabilities.
 * Anthropic's API does not expose them, so "perplexity in CI" would mean
 * shipping an open model into the test job - a ~500MB download and a new
 * dependency, in a repo that has no build step at all. These heuristics
 * correlate with what the public detectors report because they measure the same
 * surface property: uniformity.
 *
 * WHAT IT IS NOT. It is not Grammarly and it is not Scribbr, and it cannot tell
 * you what either of them will say. It is a regression gate: it tells you
 * whether a prompt change made the prose more uniform than it was yesterday.
 * The absolute number is only meaningful once calibrated against the real
 * detectors by hand - see docs/ai-detection-baseline.md.
 *
 *   node scripts/style-score.mjs tests/fixtures/notes/*.txt
 *   node scripts/style-score.mjs --json tests/fixtures/notes/*.txt
 *
 * Higher score = more machine-uniform = worse.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const sentencesOf = (text) =>
  text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 1);

const wordsOf = (text) =>
  (text.toLowerCase().match(/[a-z][a-z'-]*/g) || []);

// Function words carry style rather than content; a narrow, evenly-shaped
// distribution across them is one of the loudest machine-writing signals.
const FUNCTION_WORDS = [
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'was', 'were', 'is', 'are', 'be', 'been', 'this', 'that', 'these',
  'which', 'as', 'by', 'from', 'during', 'while', 'when', 'after', 'before',
];

function stdev(xs) {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
}

export function metrics(text) {
  const sents = sentencesOf(text);
  const words = wordsOf(text);
  const lens = sents.map((s) => wordsOf(s).length).filter((n) => n > 0);
  const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;

  // Burstiness: human prose varies sentence length a lot; generated prose
  // converges on a house length. Expressed as coefficient of variation.
  const burstiness = mean ? stdev(lens) / mean : 0;

  // Lexical variety over a fixed window, so a long note is not flattered by
  // length alone.
  const window = words.slice(0, 400);
  const typeTokenRatio = window.length ? new Set(window).size / window.length : 0;

  // How evenly the function words are spread - normalised entropy.
  const counts = FUNCTION_WORDS.map((w) => words.filter((x) => x === w).length);
  const total = counts.reduce((a, b) => a + b, 0);
  let entropy = 0;
  if (total) {
    for (const c of counts) {
      if (!c) continue;
      const p = c / total;
      entropy -= p * Math.log2(p);
    }
    entropy /= Math.log2(FUNCTION_WORDS.length);
  }

  // Repeated 4-grams - the phrase-level tic that survives paraphrasing.
  const grams = new Map();
  for (let i = 0; i + 4 <= words.length; i++) {
    const g = words.slice(i, i + 4).join(' ');
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  const repeated = [...grams.values()].filter((n) => n > 1).length;
  const repeatRate = grams.size ? repeated / grams.size : 0;

  // How many sentences open the same way. "The behavior technician…" five times
  // running is the single most recognisable tell in these notes.
  const openers = sents.map((s) => wordsOf(s).slice(0, 2).join(' ')).filter(Boolean);
  const openerVariety = openers.length ? new Set(openers).size / openers.length : 0;

  // Commas per sentence stands in for clause complexity.
  const commaRate = sents.length ? (text.match(/,/g) || []).length / sents.length : 0;

  return { sentences: sents.length, words: words.length, meanLen: mean, burstiness, typeTokenRatio, entropy, repeatRate, openerVariety, commaRate };
}

// Weighted into a single 0-100 "machine-uniformity" figure. The weights are a
// judgement call, not a fitted model - burstiness and opener variety dominate
// because they are what the public detectors visibly react to.
export function score(m) {
  const clamp = (x) => Math.max(0, Math.min(1, x));
  const parts = {
    burstiness: clamp(1 - m.burstiness / 0.6) * 30,
    openers: clamp(1 - m.openerVariety) * 25,
    variety: clamp(1 - m.typeTokenRatio / 0.55) * 20,
    entropy: clamp(m.entropy) * 10,
    repeats: clamp(m.repeatRate * 8) * 10,
    // The comma term is GONE, on his question "I am not sure how commas factor
    // in". Tested against the seven human plans in the calibration fixture:
    //   * commaRate correlates -0.05 with the real detector. No signal at all.
    //   * SIX OF SEVEN human plans sat inside the band this term called most
    //     machine-like, so it was docking human writing 2 to 5 points each for
    //     nothing.
    // Its own comment called the weights "a judgement call, not a fitted
    // model", and 1.1 commas per sentence had nothing behind it. Removing it
    // moved the correlation with QuillBot from +0.08 to +0.21: still weak,
    // still not a detector, but no longer penalising the thing it was meant to
    // reward. The 5 points are dropped rather than redistributed, because
    // reweighting on five scored documents would just be a new invented number.
  };
  return {
    total: Math.round(Object.values(parts).reduce((a, b) => a + b, 0)),
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 10) / 10])),
  };
}

// Guarded so the calibration test can import score() and re-derive the recorded
// totals. Without this, importing the module would run the CLI and exit(2).
function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const files = args.filter((a) => !a.startsWith('--'));

  if (!files.length) {
    console.error('usage: node scripts/style-score.mjs [--json] <file...>');
    process.exit(2);
  }

  const rows = files.map((f) => {
    const text = readFileSync(f, 'utf8');
    const m = metrics(text);
    const s = score(m);
    return { file: basename(f), score: s.total, parts: s.parts, metrics: m };
  });

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    const num = (x, n = 2) => Number(x).toFixed(n).padStart(6);
    console.log(pad('file', 34), 'score', ' burst', ' opener', '  ttr', ' repeat');
    console.log('-'.repeat(76));
    for (const r of rows) {
      console.log(
        pad(r.file, 34),
        String(r.score).padStart(5),
        num(r.metrics.burstiness),
        num(r.metrics.openerVariety),
        num(r.metrics.typeTokenRatio),
        num(r.metrics.repeatRate),
      );
    }
    const avg = rows.reduce((a, r) => a + r.score, 0) / rows.length;
    console.log('-'.repeat(76));
    console.log(pad('MEAN', 34), String(Math.round(avg)).padStart(5));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
