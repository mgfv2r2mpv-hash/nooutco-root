#!/usr/bin/env node
/**
 * draft-before-after - draft one intake against production and report what the
 * post-passes had to do to the result.
 *
 * WHY IT EXISTS. Every rule on his bar is now either in a prompt or in a pass
 * that runs after the model returns, and every one of them has a test. A test
 * proves the rule fires on prose written to trip it. It does not prove the
 * model was writing that prose in the first place, and it cannot say whether
 * the note a technician actually receives got better. That question has one
 * honest answer shape: the same intake, drafted twice, with the counts beside
 * each draft.
 *
 * IT CALLS PRODUCTION, for the reason expert-vs-catalog.mjs calls production:
 * bt is a migrated tool, so its system prompt lives in a store with no public
 * URL and is fetched inside the Worker. A local run would be measuring a prompt
 * nobody uses.
 *
 * WHICH HALF IS "BEFORE" IS A PROPERTY OF THE DEPLOY, NOT OF THIS SCRIPT.
 * The user prompt comes from the local tools/bt.js; the system prompt comes
 * from whatever the store holds. So run this from a checkout of the commit you
 * want measured, against the host that has the matching prompt deployed, and
 * write down which is which. Running the new user prompt against the old stored
 * system prompt measures a build that never shipped.
 *
 * IT DOES NOT SCRUB. Same as the other bench and for the same reason: the
 * scrubber lives behind a modal built for a person. Write the intake the way
 * the placeholders say to. No names, no dates of birth, no addresses.
 *
 *   node scripts/draft-before-after.mjs --intake intake.json --out before.json
 *   node scripts/draft-before-after.mjs --intake intake.json --out after.json
 *
 * THE TOKEN comes from a file and never from an argument, because an argument
 * lands in shell history. It is never printed and never written to --out.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const DEFAULT_HOST = 'https://tools.nooutco.me';
const DEFAULT_TOKEN_FILE = resolve(homedir(), '.config/nooutco/tools-token');

/* The same load order the page uses, plus the two post-passes. absence.js has
   to come before hollow.js: hollow reuses its sentence splitter rather than
   carrying a second copy, and fails open when it is missing - which here would
   silently report zero for every count this script exists to print. */
const FILES = [
  'notes/bcba/register-rules.js',
  'notes/bcba/note-tools-util.js',
  'notes/bcba/note-metrics.js',
  'notes/bcba/absence.js',
  'notes/bcba/hollow.js',
  'notes/bcba/tools/bt.js',
];

/* A CHECKOUT OLDER THAN A PASS IS THE POINT OF THIS SCRIPT, so a missing pass
   file is a fact to report rather than an error to stop on. It is announced on
   stderr and recorded in passesLoaded, because the failure this guards against
   is a run that reports zero for a count nobody was taking. Everything else is
   still required: a missing tool file means there is no note to measure. */
const OPTIONAL = new Set(['notes/bcba/hollow.js', 'notes/bcba/absence.js', 'notes/bcba/note-metrics.js']);

class RunError extends Error {}

function parseArgs(argv) {
  const out = { host: DEFAULT_HOST };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--intake') out.intake = argv[++i];
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--label') out.label = argv[++i];
    else if (a === '--raw-out') out.rawOut = argv[++i];
    else if (a === '--raw-in') out.rawIn = argv[++i];
    else throw new RunError(`Unknown argument ${JSON.stringify(a)}.`);
  }
  return out;
}

function load() {
  const win = {};
  const ctx = createContext({ window: win, console });
  win.NOTE_TOOLS = [];
  const missing = [];
  for (const f of FILES) {
    let src;
    try {
      src = readFileSync(resolve(APP, f), 'utf8');
    } catch (err) {
      if (OPTIONAL.has(f)) { missing.push(f); continue; }
      throw new RunError(`Could not load ${f}: ${err.message}`);
    }
    try {
      runInContext(src, ctx, { filename: f });
    } catch (err) {
      throw new RunError(`Could not run ${f}: ${err.message}`);
    }
  }
  if (missing.length) {
    console.error(`This checkout has no ${missing.join(', ')}. Those counts will read 0 because nothing took them, not because the model stopped. Rescore this draft with --raw-in from a checkout that has them.`);
  }
  const tool = (win.NOTE_TOOLS || []).find((t) => t && t.id === 'bt');
  if (!tool) throw new RunError('tools/bt.js did not register a tool with id bt.');
  /* Named rather than assumed. hollow.js is the newest of the three and the one
     a checkout of an older commit will not have, which is exactly the run where
     a silent zero would read as "the model stopped doing it". */
  const passes = {
    metrics: !!win.NoteMetrics,
    absence: !!win.NoteAbsence,
    hollow: !!win.NoteHollow,
  };
  return { tool, win, passes };
}

function readToken() {
  const file = process.env.NOOUTCO_TOOLS_TOKEN_FILE || DEFAULT_TOKEN_FILE;
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new RunError(`No token at ${file}. See scripts/expert-vs-catalog.mjs for how to make one.`);
  }
  const token = raw.trim();
  if (!token) throw new RunError(`${file} is empty.`);
  return token;
}

async function post(host, path, token, body) {
  const res = await fetch(host + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* diagnosed below */ }
  if (!parsed) {
    const challenge = /just a moment|<!DOCTYPE html/i.test(text);
    throw new RunError(challenge
      ? `${path} was answered by Cloudflare rather than by the Worker (${res.status}). The edge skip rule has to match ${path} exactly.`
      : `${path} returned ${res.status} and an unparseable body:\n${text.slice(0, 300)}`);
  }
  if (!res.ok) throw new RunError(`${path} returned ${res.status}: ${parsed.error || text.slice(0, 200)}`);
  return parsed;
}

function parseDraft(reply) {
  const text = (reply.content || []).map((c) => (c && c.type === 'text' ? c.text : '')).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new RunError(`The model did not return a JSON object:\n${text.slice(0, 300)}`);
  return JSON.parse(m[0]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.intake) throw new RunError('--intake is required.');

  const { tool, win, passes } = load();
  const values = JSON.parse(readFileSync(args.intake, 'utf8'));
  const invalid = tool.validate ? tool.validate(values) : null;
  if (invalid) throw new RunError(`The intake is not complete for bt: ${invalid}`);

  /* --raw-in RESCORES A DRAFT THIS SCRIPT ALREADY TOOK, and it is the half that
     makes the comparison mean anything. The old build had no post-passes, so
     running it reports zero for every count - which reads as "the model was not
     doing it" when it means "nobody was looking". Take the draft on the old
     checkout with --raw-out, then score that same draft here with the new
     passes loaded. The improvement is the difference between the two scorings
     of two drafts, not between two rows of zeros. It costs no API call. */
  let raw;
  if (args.rawIn) {
    raw = JSON.parse(readFileSync(args.rawIn, 'utf8'));
  } else {
    const token = readToken();
    const reply = await post(args.host, '/api/llm-call', token, {
      tool: 'bt',
      system_suffix: '',
      messages: [{ role: 'user', content: tool.buildUserPrompt(values) }],
      maxTokens: tool.maxTokens || 3000,
      output_config: tool.responseSchema
        ? { format: { type: 'json_schema', schema: tool.responseSchema } }
        : undefined,
    });
    raw = parseDraft(reply);
    if (args.rawOut) writeFileSync(args.rawOut, JSON.stringify(raw, null, 2));
  }

  /* The same order finalize() runs them in, and the order matters: the strip
     was written against what the model returns, and the recast writes sentences
     no model wrote. Restore is skipped because this script never scrubbed. */
  const misplaced = passes.hollow && tool.strategyOwnership
    ? win.NoteHollow.misplaced(raw, tool.strategyOwnership) : [];
  const withHints = misplaced.length
    ? { ...raw, hints: (Array.isArray(raw.hints) ? raw.hints : []).concat(misplaced) }
    : raw;
  const normalized = tool.normalizeOutput(withHints);
  const stripped = passes.absence
    ? win.NoteAbsence.scrubNote(normalized) : { output: normalized, cut: 0, flagged: 0 };
  const narrative = tool.formSections.filter((s) => s.kind === 'narrative' && s.key).map((s) => s.key);
  const filled = passes.hollow
    ? win.NoteHollow.passNote(stripped.output, narrative)
    : { output: stripped.output, recast: 0, hollow: 0 };

  const prose = narrative.map((k) => String(filled.output[k] || '')).filter(Boolean).join('\n\n');
  const m = passes.metrics ? win.NoteMetrics.measure(prose) : null;

  const report = {
    label: args.label || null,
    host: args.rawIn ? `rescored from ${args.rawIn}` : args.host,
    passesLoaded: passes,
    counts: {
      absenceCut: stripped.cut,
      absenceFlagged: stripped.flagged,
      zeroRecast: filled.recast,
      hollowSaid: filled.hollow,
      misplacedStrategy: misplaced.length,
    },
    register: m && {
      words: m.words, sentences: m.sentences, meanLen: m.meanLen,
      burstiness: m.burstiness, sectionCv: m.sectionCv === undefined ? null : m.sectionCv,
      emptyAdverbs: m.emptyAdverbs, participialCausals: m.participialCausals,
      abstractStates: m.abstractStates, vagueVerbs: m.vagueVerbs,
      flaggedPer100: m.flaggedPer100, score: m.score,
    },
    /* flagged() arrived with the widened lists, so a checkout older than that
       has measure() and not this. Feature-detected rather than version-checked:
       the point of the script is to run on both sides of the change. */
    flaggedPhrases: passes.metrics && typeof win.NoteMetrics.flagged === 'function'
      ? win.NoteMetrics.flagged(prose) : null,
    hints: (filled.output.hints || []).map((h) => `${h.section}: ${h.code}${h.detail ? ` (${h.detail})` : ''}`),
    narrative: narrative.reduce((a, k) => Object.assign(a, { [k]: filled.output[k] || '' }), {}),
  };

  console.log(JSON.stringify(report, null, 2));
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(report, null, 2));
    console.error(`\nWrote ${args.out}.`);
  }
}

main().catch((err) => {
  console.error(err instanceof RunError ? err.message : err);
  process.exit(1);
});
