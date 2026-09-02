#!/usr/bin/env node
/**
 * expert-vs-catalog - run one intake past both channels and print what each
 * one said, side by side.
 *
 * WHY IT EXISTS. The note pages now carry two sources of advice: the tool's own
 * hint catalog, which is a fixed list of codes the drafting model picks from,
 * and the expert pass, which reads the same intake and answers in prose it
 * composes itself. The question that decides whether the expert earns its place
 * is not answerable by reading either one alone. It is "on this intake, did the
 * expert say anything the catalog could not". This script puts the two answers
 * next to each other so that question has an artifact behind it.
 *
 * IT CALLS PRODUCTION, and there is no local alternative. Both routes fetch the
 * system prompt through the PROMPTS service binding and spend the account's API
 * key, and neither exists on this machine. A local run would compare two
 * failures.
 *
 * IT DOES NOT SCRUB, AND THAT IS THE ONE THING TO KNOW BEFORE USING IT.
 * The browser runs NotesScrub over every textarea before either call, so what
 * production sends is de-identified. That scrubber lives inside notes-gate.js
 * behind a modal built for a person, not for a script. Rather than reimplement
 * it here and risk a second copy drifting from the real one, this script sends
 * the intake exactly as written. So write the intake the way the placeholders
 * already tell you to: no names, no dates of birth, no addresses. The comparison
 * is still faithful in the way that matters, because both channels receive the
 * same text as each other.
 *
 *   node scripts/expert-vs-catalog.mjs --describe --tool bt
 *   node scripts/expert-vs-catalog.mjs --tool bt --intake intake.json
 *   node scripts/expert-vs-catalog.mjs --tool bt --intake intake.json --json out.json
 *
 * THE TOKEN comes from a file and never from an argument, because an argument
 * lands in shell history. Default ~/.config/nooutco/tools-token, override with
 * NOOUTCO_TOOLS_TOKEN_FILE. It is never printed, never logged, and never
 * written to the --json output.
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

/* Only the tools whose section list the expert can actually read. See
   expertSectionIds() in notes/bcba/engine.jsx: a tool without a responseSchema
   returns null there and the pass is never fired, so listing it here would
   promise a comparison that cannot run. */
const TOOL_FILES = {
  bt: ['notes/bcba/register-rules.js', 'notes/bcba/note-tools-util.js', 'notes/bcba/tools/bt.js'],
  sap: ['notes/bcba/register-rules.js', 'notes/bcba/note-tools-util.js', 'notes/bcba/tools/sap.js'],
  sup: ['notes/bcba/register-rules.js', 'notes/bcba/note-tools-util.js', 'notes/bcba/tools/sup.js'],
  parent: ['notes/bcba/register-rules.js', 'notes/bcba/note-tools-util.js', 'notes/bcba/tools/parent.js'],
  assess: ['notes/bcba/register-rules.js', 'notes/bcba/note-tools-util.js', 'notes/bcba/tools/assess.js'],
};

class BenchError extends Error {}

function parseArgs(argv) {
  const out = { host: DEFAULT_HOST };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--describe') out.describe = true;
    else if (a === '--tool') out.tool = argv[++i];
    else if (a === '--intake') out.intake = argv[++i];
    else if (a === '--host') out.host = argv[++i];
    else if (a === '--json') out.json = argv[++i];
    else throw new BenchError(`Unknown argument ${JSON.stringify(a)}.`);
  }
  return out;
}

/* Load the browser's own tool config rather than restating it here.
   The tool files are IIFEs that register on window.NOTE_TOOLS, so a bare vm
   context with the two globals they reach for is enough to read them. This is
   the same shim prompt-api/scripts/live-compose.mjs uses, for the same reason:
   a second copy of a schema is a copy that drifts. */
function loadTool(toolId) {
  const files = TOOL_FILES[toolId];
  if (!files) {
    throw new BenchError(
      `${JSON.stringify(toolId)} is not a tool this bench knows.\n` +
        `Known: ${Object.keys(TOOL_FILES).join(', ')}.`
    );
  }
  const win = {};
  const ctx = createContext({ window: win, console });
  win.NOTE_TOOLS = [];
  for (const f of files) {
    const path = resolve(APP, f);
    try {
      runInContext(readFileSync(path, 'utf8'), ctx, { filename: f });
    } catch (err) {
      throw new BenchError(`Could not load ${f}: ${err.message}`);
    }
  }
  const tool = (win.NOTE_TOOLS || []).find((t) => t && t.id === toolId);
  if (!tool) throw new BenchError(`${files[files.length - 1]} did not register a tool with id ${toolId}.`);
  return { tool, win };
}

/* Byte-identical in intent to expertSectionIds() in engine.jsx, and the comment
   there is the reason this does not read formSections: not that the two lists
   disagree - measured, they very nearly always match - but that formSections is
   a render order nothing binds to the contract the response is serialized
   against. A caller reading the render order gets findings filed under ids the
   page cannot draw the first time somebody reorders a card. */
function expertSectionIds(tool, win) {
  let enumList = null;
  try {
    enumList = tool.responseSchema.properties.hints.items.properties.section.enum;
  } catch (e) {
    return null;
  }
  if (!Array.isArray(enumList)) return null;
  const whole = win.NoteToolsUtil && win.NoteToolsUtil.HINT_WHOLE_NOTE ? win.NoteToolsUtil.HINT_WHOLE_NOTE : 'note';
  return enumList.filter((id) => id !== whole);
}

/* Which tools the expert covers, measured rather than listed. The line that
   reported this used to read "bt, sap" in a string literal, and it would have
   started lying the moment a tool gained a schema - which is exactly what
   happened on 2026-08-30. */
function runnableTools() {
  return Object.keys(TOOL_FILES).filter((id) => {
    try {
      const { tool, win } = loadTool(id);
      return !!expertSectionIds(tool, win);
    } catch (err) {
      return false;
    }
  });
}

/* The two channels are handed different bodies in production and this bench
   keeps that difference rather than tidying it away. The expert reads the
   labelled textareas; the draft reads whatever the tool's own buildUserPrompt
   composes, which for most tools is more than the textareas. */
function intakeBody(tool, values) {
  return tool.inputs
    .filter((f) => f.type === 'textarea')
    .map((f) => `[${f.label}]${f.required ? ' (required)' : ''}\n${(values[f.id] || '').trim() || '(empty)'}`)
    .join('\n\n');
}

function readToken() {
  const file = process.env.NOOUTCO_TOOLS_TOKEN_FILE || DEFAULT_TOKEN_FILE;
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new BenchError(
      `No token at ${file}.\n` +
        `Create a tool-scoped password in /admin/ -> API Passwords, log in with it in a\n` +
        `private window, and run copy(localStorage.notes_auth_token) in that window's console.`
    );
  }
  const token = raw.trim();
  if (!token) throw new BenchError(`${file} is empty.`);
  return token;
}

/* The bare path, not the .js one the browser uses. The browser suffixes API
   paths so a static-looking extension slips past Super Bot Fight Mode; a script
   has no such cover and relies on the edge rule, which matches the bare path
   exactly. */
async function post(host, path, token, body) {
  const res = await fetch(host + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    /* Falls through to the diagnosis below. An HTML body here is the edge
       answering instead of the Worker, which is a different problem from any
       error the Worker could report, and saying so saves the reader from
       reading a challenge page as a bug in their intake. */
  }
  if (!parsed) {
    const looksLikeChallenge = /just a moment|<!DOCTYPE html/i.test(text);
    throw new BenchError(
      looksLikeChallenge
        ? `${path} was answered by Cloudflare rather than by the Worker (${res.status}).\n` +
          `The edge skip rule does not cover this path. It has to match ${path} exactly.`
        : `${path} returned ${res.status} and a body this bench could not parse:\n${text.slice(0, 300)}`
    );
  }
  if (!res.ok) throw new BenchError(`${path} returned ${res.status}: ${parsed.error || text.slice(0, 200)}`);
  return parsed;
}

function describe(toolId) {
  const { tool, win } = loadTool(toolId);
  const sections = expertSectionIds(tool, win);
  console.log(`tool     : ${tool.id} - ${tool.label}`);
  console.log(`inputs   : write an intake JSON with these keys`);
  for (const f of tool.inputs) {
    const req = f.required ? ' (required)' : '';
    console.log(`             ${f.id}: ${f.type}${req} - ${f.label}`);
  }
  const codes = Object.keys(tool.hintCatalog || {});
  console.log(`catalog  : ${codes.length} codes - ${codes.join(', ') || '(none)'}`);
  console.log(
    sections
      ? `expert   : runs, ${sections.length} sections - ${sections.join(', ')}`
      : `expert   : DOES NOT RUN for this tool. It has no responseSchema, so\n` +
        `             expertSectionIds() returns null and engine.jsx never fires the pass.`
  );
}

function wrap(text, width, indent) {
  const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && line.length + 1 + w.length > width) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.map((l, i) => (i === 0 ? l : indent + l)).join('\n');
}

/* The same join-and-parse notes-gate.js does, and the same refusal to guess.
   A truncated response is named as a truncation rather than reported as a note
   with no hints, because those two look identical from the outside and only one
   of them is a result. */
function parseDraft(response) {
  const blocks = response && Array.isArray(response.content) ? response.content : [];
  const raw = blocks.map((b) => (b && typeof b.text === 'string' ? b.text : '')).join('');
  if (!raw.trim()) {
    throw new BenchError('The draft came back with no text content. Nothing to compare.');
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    const stop = response.stop_reason || 'unknown';
    throw new BenchError(
      `The draft did not parse as JSON (stop_reason=${stop}, ${raw.length} chars).\n` +
        (stop === 'max_tokens'
          ? 'That is a truncation at the token cap, not malformed output. Raise maxTokens for this tool.'
          : `First failure: ${err.message}`)
    );
  }
}

function reportCatalog(tool, draft) {
  console.log('\n' + '='.repeat(78));
  console.log('CATALOG  - the codes the drafting model chose, and their catalog wording');
  console.log('='.repeat(78));
  const hints = draft && Array.isArray(draft.hints) ? draft.hints : [];
  if (!hints.length) {
    console.log('  (none - the draft returned no hints on this intake)');
    return hints;
  }
  for (const h of hints) {
    const code = h.code || '(no code)';
    const wording = (tool.hintCatalog || {})[code];
    console.log(`\n  [${h.section || 'note'}] ${code}`);
    if (h.detail) console.log(`     detail : ${h.detail}`);
    console.log(`     says   : ${wrap(wording === '' ? '(the "other" code carries no fixed wording)' : wording || '(not in this tool\'s catalog)', 66, '              ')}`);
  }
  return hints;
}

function reportExpert(expert) {
  console.log('\n' + '='.repeat(78));
  console.log('EXPERT   - the same intake, read by the expert pass');
  console.log('='.repeat(78));

  const hints = Array.isArray(expert.hints) ? expert.hints : [];
  console.log(`\n  ASKS (${hints.length}${expert.hintsDropped ? `, ${expert.hintsDropped} dropped as unrankable` : ''})`);
  if (!hints.length) console.log('    (none)');
  for (const h of hints) {
    console.log(`\n    ${h.rank}. [${h.section}] (${h.kind})`);
    console.log(`       ask : ${wrap(h.ask, 62, '             ')}`);
    console.log(`       why : ${wrap(h.why, 62, '             ')}`);
  }

  const register = Array.isArray(expert.register) ? expert.register : [];
  console.log(`\n  REGISTER (${register.length}) - claims nobody watched happen`);
  if (!register.length) console.log('    (none)');
  for (const r of register) {
    console.log(`\n    "${wrap(r.quote, 60, '     ')}"`);
    console.log(`       action : ${r.action}`);
    console.log(`       why    : ${wrap(r.why, 60, '                ')}`);
    console.log(`       move   : ${wrap(r.move, 60, '                ')}`);
  }

  const terms = Array.isArray(expert.terms) ? expert.terms : [];
  console.log(`\n  TERMS (${terms.length}) - abbreviations and the reading it used`);
  if (!terms.length) console.log('    (none)');
  for (const t of terms) {
    const reading = t.reading ? ` -> ${t.reading}` : '';
    console.log(`    ${String(t.status).toUpperCase().padEnd(9)} ${t.token}${reading}`);
    if (t.why) console.log(`              ${wrap(t.why, 60, '              ')}`);
  }
}

/* The question the bench exists to answer, stated as plainly as the data allows.
   It counts rather than judges: a register finding or a term reading has no
   catalog counterpart by construction, because the catalog is a fixed list of
   codes about missing elements. */
function reportVerdict(catalogHints, expert) {
  const register = Array.isArray(expert.register) ? expert.register : [];
  const terms = Array.isArray(expert.terms) ? expert.terms : [];
  const ambiguous = terms.filter((t) => t.status !== 'resolved');
  const expertHints = Array.isArray(expert.hints) ? expert.hints : [];

  console.log('\n' + '='.repeat(78));
  console.log('WHAT THE CATALOG COULD NOT HAVE SAID');
  console.log('='.repeat(78));
  console.log(`  catalog codes returned      : ${catalogHints.length}`);
  console.log(`  expert asks returned        : ${expertHints.length}`);
  console.log(`  register findings           : ${register.length}   (no catalog code exists for these)`);
  console.log(`  abbreviations flagged       : ${ambiguous.length} of ${terms.length} read as ambiguous or unknown`);
  const uncoverable = register.length + ambiguous.length;
  console.log(
    `\n  ${uncoverable} finding(s) on this intake are outside what a fixed code list can reach.` +
      (uncoverable === 0 ? '\n  On this intake the expert said nothing the catalog could not have.' : '')
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.describe) {
    if (!args.tool) throw new BenchError('--describe needs --tool.');
    describe(args.tool);
    return;
  }
  if (!args.tool) throw new BenchError('Missing --tool. Try --describe --tool bt.');
  if (!args.intake) throw new BenchError('Missing --intake <file.json>. Try --describe --tool ' + args.tool + '.');

  const { tool, win } = loadTool(args.tool);
  const sections = expertSectionIds(tool, win);
  if (!sections) {
    throw new BenchError(
      `The expert does not run for ${tool.id}.\n` +
        `It has no responseSchema, so expertSectionIds() returns null in engine.jsx and the\n` +
        `pass is never fired. There is nothing to compare.\n` +
        `Tools that do run: ${runnableTools().join(', ') || '(none)'}.`
    );
  }

  let values;
  try {
    values = JSON.parse(readFileSync(resolve(process.cwd(), args.intake), 'utf8'));
  } catch (err) {
    throw new BenchError(`Could not read --intake ${args.intake} as JSON: ${err.message}`);
  }
  const invalid = tool.validate ? tool.validate(values) : null;
  if (invalid) throw new BenchError(`The intake is not complete for ${tool.id}: ${invalid}`);

  const token = readToken();
  const expertIntake = intakeBody(tool, values);
  const userMsg = tool.buildUserPrompt(values);

  console.log(`Running both channels against ${args.host} for tool ${tool.id}.`);
  console.log(`Sections: ${sections.join(', ')}`);
  console.log('The intake is sent as written. This bench does not scrub.');

  /* Both calls go out together. They are independent in production too - the
     expert is fired and never awaited - and running them in series here would
     only make the bench slower without making it more faithful. */
  const [expert, draft] = await Promise.all([
    post(args.host, '/api/expert-pass', token, {
      tool: tool.id,
      intake: expertIntake,
      sections,
    }),
    post(args.host, '/api/llm-call', token, {
      tool: tool.id,
      system_suffix: '',
      messages: [{ role: 'user', content: userMsg }],
      maxTokens: tool.maxTokens || 3000,
      output_config: tool.responseSchema
        ? { format: { type: 'json_schema', schema: tool.responseSchema } }
        : undefined,
    }),
  ]);

  /* /api/llm-call returns the upstream response verbatim, not a parsed note -
     the parsing lives in the browser. Doing it here rather than reading
     draft.hints is the difference between the catalog channel reporting what it
     said and reporting a silent zero, which is what the first run of this bench
     did before the shape was checked. */
  const parsedDraft = parseDraft(draft);
  const catalogHints = reportCatalog(tool, parsedDraft);
  reportExpert(expert);
  reportVerdict(catalogHints, expert);

  if (args.json) {
    /* The token is not in here and neither is anything derived from it. The
       intake is, because a comparison you cannot re-read the input of is not
       evidence of anything. */
    writeFileSync(
      resolve(process.cwd(), args.json),
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          host: args.host,
          tool: tool.id,
          sections,
          intake: { expert: expertIntake, draft: userMsg },
          catalog: { hints: catalogHints, catalogWording: tool.hintCatalog || {} },
          expert,
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
    console.log(`\nWrote ${args.json}`);
  }
}

main().catch((err) => {
  if (err instanceof BenchError) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
  throw err;
});
