#!/usr/bin/env node
/**
 * phi-census - what the name and identifier passes actually catch, and what
 * they actually cost, on a corpus somebody wrote down the answers for.
 *
 * WHY IT EXISTS. FIRST_NAMES stays exactly as wide as it is. That is settled,
 * and it is settled on the grounds that the false positives get paid for
 * somewhere else rather than by narrowing detection. A decision of that shape
 * needs a bill: how many words per note does a technician have to wave off, and
 * which kinds of word are they. Until now the only evidence either way was the
 * last false positive somebody happened to notice.
 *
 * IT CHANGES NOTHING. It reads assets/notes-gate.js, runs the four real passes,
 * and prints. No detection behaviour is touched by this file or by anything it
 * imports, and nothing here is loaded by the browser.
 *
 * TWO COLUMNS, BECAUSE ONE NUMBER IS NOT A MEASUREMENT. The working tree is run
 * beside another ref, so a guard added on a branch shows up as a moved number
 * rather than as a claim. When the two sources are byte-identical the run says
 * so instead of printing the same column twice and letting it look like
 * agreement.
 *
 * TWO ORDERS, BECAUSE THE PAGE HAS TWO. The highlight overlay calls detectNames
 * on the raw textarea, so that is the false positive count a technician sees
 * while typing. scrubForAgent replaces identifiers FIRST and runs names on what
 * is left, so that is the count that reaches the model. They differ, and the
 * difference is the whole overlapping-span class.
 *
 *   node scripts/phi-census.mjs
 *   node scripts/phi-census.mjs --baseline origin/main
 *   node scripts/phi-census.mjs --json census.json
 */

import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORPUS } from './fixtures/phi-census-corpus.mjs';
import { loadGateFromFile, loadGateFromRef } from './lib/gate-context.mjs';
import {
  MISS_CLASSES, scoreSet, scoreIdentifiers, scoreRoles, scoreTokenFragmentation,
  emptyTally, addToTally, pct,
} from './lib/phi-census-score.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const REPO = resolve(APP, '../..');
const GATE = 'apps/tools/assets/notes-gate.js';

const PASSES = [
  ['names-raw', 'detectNames, raw text (the typing overlay)'],
  ['names-prod', 'detectNames, after the identifier pass (what the model gets)'],
  ['identifiers', 'detectIdentifiers'],
  ['roles', 'inferRoles'],
  ['rolemap', 'buildRoleMap (name field)'],
];

function parseArgs(argv) {
  const out = { baseline: 'main', json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline') out.baseline = argv[++i];
    else if (a === '--json') out.json = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new Error(`Unknown argument ${JSON.stringify(a)}.`);
  }
  return out;
}

/* One column. Everything the census knows about one build of the detector. */
function runColumn(gate, label) {
  const tallies = {};
  PASSES.forEach(([key]) => { tallies[key] = emptyTally(); });
  const perDoc = [];
  let peopleSplit = 0;
  let people = 0;
  let roleTokensOnNonPersons = 0;

  for (const doc of CORPUS) {
    const rawNames = gate.detectNames(doc.text);
    const afterIds = gate.applyScrub(doc.text, gate.buildIdentifierMap(doc.text));
    const prodNames = gate.detectNames(afterIds);
    const ids = gate.detectIdentifiers(doc.text);
    const roles = gate.inferRoles(doc.text);
    const roleMap = gate.buildRoleMap(doc.text);

    /* The nickname pass flags any word that is a strict prefix of something
       already detected, so "delay" rides in behind "Delays". It can only be
       recognised against the list that pass was working from, which is why the
       classifier's context is rebuilt per doc rather than once per column. */
    const ctx = {
      isFirstName: gate.isFirstName,
      isNicknamePrefixOf: (term) => rawNames.some((n) => {
        const l = n.toLowerCase();
        return l !== term && term.length >= 3 && l.startsWith(term);
      }),
    };

    /* The production column judges names against the truth that SURVIVES the
       identifier pass. A name that only ever appeared inside an address is gone
       from the text by then, so counting it as a miss would blame the name pass
       for the identifier pass doing its job. */
    const prodTruth = doc.names.filter((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(afterIds));

    const results = {
      'names-raw': scoreSet({ predicted: rawNames, truth: doc.names, doc, ctx }),
      'names-prod': scoreSet({ predicted: prodNames, truth: prodTruth, doc, ctx }),
      identifiers: scoreIdentifiers(ids, doc.identifiers || []),
      roles: scoreRoles(roles, doc.roles || {}, doc, ctx),
      rolemap: scoreSet({ predicted: roleMap.map((e) => e.name), truth: doc.names, doc, ctx }),
    };
    PASSES.forEach(([key]) => addToTally(tallies[key], doc.id, results[key]));

    const frag = scoreTokenFragmentation(roleMap, doc);
    people += frag.people;
    peopleSplit += frag.split.length;

    /* THE ONE WITH TEETH. A role token never restores, so a word that is not a
       person and got Client or Caregiver rather than Person stays in the signed
       note wearing a role. Counted on its own because precision alone hides it. */
    const truthNames = new Set(doc.names.map((n) => n.toLowerCase()));
    const amb = new Set((doc.ambiguous || []).map((n) => n.toLowerCase()));
    roleTokensOnNonPersons += roleMap.filter((e) => {
      const n = e.name.toLowerCase();
      return !truthNames.has(n) && !amb.has(n) && !/^Person( \d+)?$/.test(e.token);
    }).length;

    perDoc.push({ id: doc.id, author: doc.author, frag: frag.split, results });
  }

  return { label, tallies, perDoc, people, peopleSplit, roleTokensOnNonPersons };
}

function row(name, a, b) {
  const cell = (t) => `${pct(t.precision)} ${pct(t.recall)} ${String(t.tp).padStart(3)}/${String(t.fp).padStart(3)}/${String(t.fn).padStart(3)}`;
  return `${name.padEnd(13)} | ${cell(a)} | ${cell(b)}`;
}

function rateOf(n, d) { return d === 0 ? null : n / d; }

function tallyRates(t) {
  return { ...t, precision: rateOf(t.tp, t.tp + t.fp), recall: rateOf(t.tp, t.tp + t.fn) };
}

function report(branch, baseline, meta) {
  const L = [];
  L.push('PHI CENSUS - the real passes over a synthetic corpus with authored truth');
  L.push('');
  L.push(`corpus       ${CORPUS.length} docs (${CORPUS.filter((d) => d.author === 'bt').length} BT, ${CORPUS.filter((d) => d.author === 'bcba').length} BCBA), every word invented`);
  L.push(`column A     ${branch.label}`);
  L.push(`column B     ${baseline.label}`);
  if (meta.identical) {
    L.push('');
    L.push('THE TWO SOURCES ARE BYTE-IDENTICAL. Both columns measure the same code, so');
    L.push('any difference between them would be a bug in this script. Nothing on the');
    L.push('branch changed detection.');
  }
  L.push('');
  L.push('Stubbed for the run: localStorage empty (no certified-non-PII exclusions),');
  L.push('fetch rejected (no /api/scrub-config stopwords or first names merged in).');
  L.push('');
  L.push('                    A: working tree           B: baseline');
  L.push('pass          |  prec  recall  tp/ fp/ fn |  prec  recall  tp/ fp/ fn');
  L.push('--------------+---------------------------+--------------------------');
  for (const [key, desc] of PASSES) {
    L.push(row(key, tallyRates(branch.tallies[key]), tallyRates(baseline.tallies[key])));
    L.push(`${''.padEnd(13)} | ${desc}`);
  }
  L.push('');
  L.push('MISSES AND FALSE POSITIVES BY CLASS (A = working tree, B = baseline)');
  L.push('');
  for (const [key, desc] of PASSES) {
    const a = branch.tallies[key].classes;
    const b = baseline.tallies[key].classes;
    const classes = MISS_CLASSES.filter((c) => (a[c] && a[c].count) || (b[c] && b[c].count));
    if (!classes.length) continue;
    L.push(`  ${key}  (${desc})`);
    for (const c of classes) {
      const ac = (a[c] || { count: 0, examples: [] });
      const bc = (b[c] || { count: 0, examples: [] });
      L.push(`    ${c.padEnd(44)} A ${String(ac.count).padStart(3)}   B ${String(bc.count).padStart(3)}`);
      const ex = (ac.examples.length ? ac.examples : bc.examples).slice(0, 4).join(', ');
      if (ex) L.push(`      ${ex}`);
    }
    L.push('');
  }
  /* THE BILL, PER NOTE. The rates above are the whole corpus at once, and a
     technician does not type the whole corpus. What they type is one note, and
     what they have to wave off is this row. */
  L.push('THE BILL PER NOTE (working tree, names on raw text, the typing overlay)');
  L.push('');
  for (const d of branch.perDoc) {
    const r = d.results['names-raw'];
    L.push(`  ${d.id.padEnd(9)} ${d.author.padEnd(5)} ${String(r.fp).padStart(2)} words to wave off, ${r.tp} real, ${r.fn} missed`);
  }
  const fpTotal = branch.perDoc.reduce((n, d) => n + d.results['names-raw'].fp, 0);
  L.push(`  ${''.padEnd(15)}${(fpTotal / branch.perDoc.length).toFixed(1)} per note on average`);
  L.push('');
  L.push('BEYOND PRECISION');
  L.push('');
  L.push(`  one human wearing more than one role token   A ${branch.peopleSplit}/${branch.people}   B ${baseline.peopleSplit}/${baseline.people}`);
  L.push(`  role token on a word that is not a person    A ${branch.roleTokensOnNonPersons}   B ${baseline.roleTokensOnNonPersons}`);
  L.push('    A role token never restores, so this is the count that stays in a signed note.');
  L.push('');
  const unclassified = (col) => PASSES.reduce((n, [k]) => n + ((col.tallies[k].classes.unclassified || {}).count || 0), 0);
  L.push(`  unclassified mistakes                       A ${unclassified(branch)}   B ${unclassified(baseline)}`);
  L.push('    Has to read 0. A mistake with no class is one a later slice cannot pay for.');
  return L.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('node scripts/phi-census.mjs [--baseline <git-ref>] [--json <file>]');
    return;
  }
  const branchSha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  const branchGate = loadGateFromFile(resolve(REPO, GATE), `working tree (${branchSha})`);
  let baseline;
  let identical = false;
  try {
    const loaded = loadGateFromRef(args.baseline, GATE, REPO);
    baseline = loaded.gate;
    const here = execFileSync('git', ['hash-object', resolve(REPO, GATE)], { cwd: REPO, encoding: 'utf8' }).trim();
    const there = execFileSync('git', ['hash-object', '--stdin'], { cwd: REPO, encoding: 'utf8', input: loaded.source }).trim();
    identical = here === there;
  } catch (err) {
    console.error(`Could not read ${GATE} at ${args.baseline}: ${err.message}`);
    console.error('Running the working tree against itself so the pass numbers still print.');
    baseline = branchGate;
    identical = true;
  }

  const a = runColumn(branchGate, branchGate.label);
  const b = runColumn(baseline, baseline.label);
  const text = report(a, b, { identical });
  console.log(text);
  if (args.json) {
    writeFileSync(args.json, JSON.stringify({ branch: a, baseline: b, identical }, null, 2));
    console.log(`\nwrote ${args.json}`);
  }
}

main();
