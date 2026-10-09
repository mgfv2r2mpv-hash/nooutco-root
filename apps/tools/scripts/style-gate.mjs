#!/usr/bin/env node
/**
 * style-gate - fail the build when the committed note fixtures drift toward
 * machine-uniform prose (issue #86).
 *
 * WHAT IT GATES. Every .txt under tests/fixtures/notes/, including a future
 * live/ folder of captured drafts, scored with scripts/style-score.mjs and
 * checked against tests/fixtures/notes/style-baseline.json. Three checks:
 *
 *   1. Every fixture has a baseline entry. A new file fails until someone says
 *      what it is ("draft" or "pole") and what it scored, so nothing joins the
 *      set unread.
 *   2. Drift, both ways. A fixture whose score moves more than DRIFT_POINTS
 *      from its recorded score fails. Up means the prose got more uniform. Down
 *      on a pole fixture means the scorer stopped telling the poles apart.
 *   3. A ceiling on drafts. A "draft" fixture over CEILING fails outright,
 *      whatever its baseline says, so a recapture cannot re-baseline a
 *      collapsed note into a pass.
 *
 * WHAT IT IS NOT. Not a detector proxy. docs/ai-detection-baseline.md measured
 * style-score against QuillBot at r = 0.08 to 0.21, so this gate makes no claim
 * about what a detector will report. It is the drift alarm that doc calls
 * defensible: it catches prose collapsing toward the formulaic pole.
 *
 * It cannot see a prompt change by itself. CI has no model call, so the gate
 * bites when someone recaptures drafts into the fixture set after a prompt
 * change, or retunes the scorer.
 *
 *   node scripts/style-gate.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { metrics, score } from './style-score.mjs';

/* CEILING 40. The highest score measured on any human document is 38 (104
 * coursework documents, docs/ai-detection-baseline.md); the seven human
 * clinical plans run 12 to 24. The formulaic pole fixtures score 48 and 52.
 * 40 sits above every human document measured and below the pole, so a draft
 * only fails when it reads more uniform than anything a person wrote. */
export const CEILING = 40;

/* DRIFT 8. The five QuillBot-scored human plans span 8 points of style-score
 * (12 to 20). A move smaller than the spread between real clinicians' plans is
 * not evidence of anything, so the gate allows it. */
export const DRIFT_POINTS = 8;

export const ROLES = ['draft', 'pole'];

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const FIXTURE_DIR = join(HERE, '..', 'tests', 'fixtures', 'notes');
export const BASELINE_FILE = join(FIXTURE_DIR, 'style-baseline.json');

/** Score one text with the real scorer, not a copy of its weights. */
export function scoreText(text) {
  return score(metrics(text)).total;
}

/**
 * Check one fixture's score against its baseline entry.
 * Returns a list of problems; empty means it passes.
 */
export function checkFixture(name, total, entry) {
  if (!entry) {
    return [`${name}: no entry in style-baseline.json. Add it with its role (draft or pole) and score ${total}.`];
  }
  if (!ROLES.includes(entry.role)) {
    return [`${name}: role "${entry.role}" is not one of ${ROLES.join(', ')}.`];
  }
  if (!Number.isFinite(entry.score)) {
    return [`${name}: baseline score is missing or not a number.`];
  }
  const problems = [];
  const moved = total - entry.score;
  if (Math.abs(moved) > DRIFT_POINTS) {
    problems.push(`${name}: scored ${total}, baseline ${entry.score}, moved ${moved > 0 ? '+' : ''}${moved} (limit ${DRIFT_POINTS}).`);
  }
  if (entry.role === 'draft' && total > CEILING) {
    problems.push(`${name}: a draft scored ${total}, over the ceiling of ${CEILING}.`);
  }
  return problems;
}

/** Every .txt under the fixture folder, as a forward-slash path relative to it. */
export function listFixtures(dir = FIXTURE_DIR) {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.split(sep).join('/'))
    .sort();
}

/** Run the whole gate. Returns rows for printing and the list of problems. */
export function runGate({ dir = FIXTURE_DIR, baseline } = {}) {
  const base = baseline || JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
  const entries = base.fixtures || {};
  const files = listFixtures(dir);
  const rows = files.map((name) => {
    const total = scoreText(readFileSync(join(dir, name), 'utf8'));
    return { name, total, entry: entries[name], problems: checkFixture(name, total, entries[name]) };
  });
  // A baseline entry with no file behind it is a fixture someone deleted
  // without saying so; the gate would otherwise go quietly smaller.
  const orphans = Object.keys(entries)
    .filter((name) => !files.includes(name))
    .map((name) => `${name}: listed in style-baseline.json but the file is gone.`);
  return { rows, problems: [...rows.flatMap((r) => r.problems), ...orphans] };
}

function main() {
  const { rows, problems } = runGate();
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('fixture', 34), pad('role', 6), 'score', 'baseline');
  console.log('-'.repeat(60));
  for (const r of rows) {
    console.log(pad(r.name, 34), pad(r.entry ? r.entry.role : '?', 6),
      String(r.total).padStart(5), String(r.entry ? r.entry.score : '-').padStart(8));
  }
  console.log('-'.repeat(60));
  console.log(`ceiling ${CEILING} on drafts, drift limit ${DRIFT_POINTS} points either way`);
  if (problems.length) {
    for (const p of problems) console.log(`::error title=Style gate::${p}`);
    console.log(`\nFAIL: ${problems.length} problem(s). See docs/ai-detection-baseline.md before changing a baseline.`);
    process.exit(1);
  }
  console.log(`PASS: ${rows.length} fixture(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
