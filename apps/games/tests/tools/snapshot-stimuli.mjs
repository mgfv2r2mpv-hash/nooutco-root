#!/usr/bin/env node
/**
 * Regenerate tests/fixtures/stimulus-baseline.json.
 *
 * The baseline records how much REAL art each game served, per category, at a
 * known-good tree. tests/stimulus-integrity.spec.js then fails if a later
 * change makes any category serve less real art than the baseline - which is
 * the specific regression the shared-stimulus-library work risks introducing.
 *
 * Reads from the working tree (not over HTTP) so it can be regenerated from a
 * `git stash`/`git worktree` of any revision:
 *
 *   node tests/tools/snapshot-stimuli.mjs                 # rewrite the baseline
 *   node tests/tools/snapshot-stimuli.mjs --check         # diff without writing
 *
 * Raising a baseline number is legitimate (more art landed). LOWERING one is
 * the thing this file exists to make visible, so it is never automatic - * rerun deliberately and explain the drop in the commit message.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { STIMULUS_SOURCES, entriesFor, classify, needsBodyToClassify, summarize } from '../lib/stimuli.mjs';

const GAMES_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE_PATH = path.join(GAMES_ROOT, 'tests/fixtures/stimulus-baseline.json');

/** Turn a served URL path ("/clock/manifest.json") into a working-tree path. */
function toDiskPath(urlPath) {
  return path.join(GAMES_ROOT, urlPath.replace(/^\//, ''));
}

/** Resolve an index-relative asset path against its source base, URL-style. */
export function resolveUrlPath(base, relative) {
  return new URL(relative, `http://localhost${base}`).pathname;
}

async function loadIndex(source) {
  if (!source.index) return null;
  return JSON.parse(await readFile(toDiskPath(source.index), 'utf8'));
}

async function classifyRow(source, entry) {
  const urlPath = resolveUrlPath(source.base, entry.path);
  const diskPath = toDiskPath(urlPath);
  let body = null;
  if (needsBodyToClassify(urlPath)) {
    body = await readFile(diskPath, 'utf8');
  } else {
    await readFile(diskPath); // presence check - throws if the index points at nothing
  }
  return { ...entry, urlPath, classification: classify(urlPath, body) };
}

export async function snapshot() {
  const games = {};
  for (const source of STIMULUS_SOURCES) {
    const index = await loadIndex(source);
    const entries = entriesFor(source, index);
    const rows = [];
    for (const entry of entries) rows.push(await classifyRow(source, entry));
    const byCategory = summarize(rows);
    games[source.game] = Object.fromEntries(
      Object.entries(byCategory).map(([category, bucket]) => [
        category,
        { art: bucket.art, emoji: bucket.emoji, total: bucket.art + bucket.emoji },
      ]));
  }
  return { note: 'Per-category counts of REAL art vs generated emoji placeholders, as indexed by each game. Regenerate with: node tests/tools/snapshot-stimuli.mjs', games };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const next = await snapshot();
  const serialized = JSON.stringify(next, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const current = await readFile(BASELINE_PATH, 'utf8').catch(() => '');
    if (current === serialized) {
      console.log('baseline is up to date');
    } else {
      console.log('baseline DIFFERS from the working tree; rerun without --check to update');
      process.exitCode = 1;
    }
  } else {
    await writeFile(BASELINE_PATH, serialized);
    const total = Object.values(next.games).reduce(
      (sum, cats) => sum + Object.values(cats).reduce((s, c) => s + c.art, 0), 0);
    console.log(`wrote ${path.relative(GAMES_ROOT, BASELINE_PATH)} - ${total} real art files indexed`);
  }
}
