import { test, expect } from '@playwright/test';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// __dirname rather than import.meta, matching asset-cache-lockstep.spec.js:
// Playwright loads these specs through a transpiler where import.meta is not
// available.
const APP = join(__dirname, '..');

/* The comparison bench, scripts/expert-vs-catalog.mjs.
 *
 * WHAT THESE PIN, AND WHY THESE. The bench reaches into two contracts it does
 * not own: the browser's tool config, and the response shape of /api/llm-call.
 * Both of them broke it once already during its first run, and both broke it
 * SILENTLY, which is the only reason they are worth a suite.
 *
 *   1. The draft's hints live in an upstream API response, not in a parsed note.
 *      The Worker returns the upstream body verbatim. Reading response.hints
 *      gets undefined, and the bench printed "the catalog said nothing" against
 *      an intake the catalog had plenty to say about. A zero that means "not
 *      parsed" and a zero that means "nothing found" are indistinguishable in
 *      the output, so only a test can tell them apart.
 *
 *   2. The expert's section ids come out of responseSchema, never formSections.
 *      engine.jsx says so in a comment and the bench copies it. If a tool's
 *      schema changes shape, the bench sends ids the schema enum will reject.
 *
 * The network is not exercised here on purpose. "Does production answer" is not
 * a claim a unit test can make honestly, and the bench itself is the thing that
 * asks it.
 */

function loadTool(toolId) {
  const win = {};
  const ctx = createContext({ window: win, console });
  win.NOTE_TOOLS = [];
  for (const f of [
    'notes/bcba/register-rules.js',
    'notes/bcba/note-tools-util.js',
    `notes/bcba/tools/${toolId}.js`,
  ]) {
    runInContext(readFileSync(join(APP, f), 'utf8'), ctx, { filename: f });
  }
  return { tool: win.NOTE_TOOLS.find((t) => t.id === toolId), win };
}

/* Copied from the bench, which copied it from engine.jsx. Three copies is two
   too many, and there is no module system between a Worker, a browser IIFE and a
   node script to fix that - so the drift is caught here instead. */
function expertSectionIds(tool, win) {
  let enumList = null;
  try {
    enumList = tool.responseSchema.properties.hints.items.properties.section.enum;
  } catch (e) {
    return null;
  }
  if (!Array.isArray(enumList)) return null;
  const whole = win.NoteToolsUtil?.HINT_WHOLE_NOTE || 'note';
  return enumList.filter((id) => id !== whole);
}

test('the bench can load every tool config it offers', () => {
  for (const id of ['bt', 'sap', 'sup', 'parent', 'assess']) {
    const { tool } = loadTool(id);
    expect(tool, `${id} did not register on window.NOTE_TOOLS`).toBeTruthy();
    expect(typeof tool.buildUserPrompt, `${id}.buildUserPrompt`).toBe('function');
    expect(Array.isArray(tool.inputs), `${id}.inputs`).toBe(true);
  }
});

/* The tools the bench will actually run, stated as a fact rather than a hope.
   A tool gaining a responseSchema is a real change in what the expert covers,
   and it should break this line so somebody updates the bench's own list. */
test('the expert runs for bt and sap, and for no other note tool', () => {
  const runs = [];
  for (const id of ['bt', 'sap', 'sup', 'parent', 'assess']) {
    const { tool, win } = loadTool(id);
    if (expertSectionIds(tool, win)) runs.push(id);
  }
  expect(runs.sort()).toEqual(['bt', 'sap']);
});

test('section ids come from the schema enum and never include the whole-note id', () => {
  const { tool, win } = loadTool('bt');
  const sections = expertSectionIds(tool, win);
  expect(sections.length).toBeGreaterThan(0);
  expect(sections).not.toContain('note');
  // Same source the schema enum is built from, so the two cannot disagree.
  const enumList = tool.responseSchema.properties.hints.items.properties.section.enum;
  expect(enumList).toContain('note');
  expect(sections).toEqual(enumList.filter((s) => s !== 'note'));
});

test('formSections is NOT the section list, which is why the bench reads the schema', () => {
  const { tool, win } = loadTool('sap');
  const fromSchema = expertSectionIds(tool, win);
  const fromForm = (tool.formSections || []).map((s) => (typeof s === 'string' ? s : s.id));
  // If these ever coincide the comment in engine.jsx has stopped being true and
  // this test should be re-read rather than deleted.
  expect(fromSchema).not.toEqual(fromForm);
});

/* The regression that actually happened. */
test('a draft response is parsed out of content blocks, not read off the body', () => {
  const note = { hints: [{ section: 'note', code: 'no_rate_comparison', detail: '' }] };
  const upstream = {
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(note) }],
  };
  // The shape the bench used to read, and the reason it reported a silent zero.
  expect(upstream.hints).toBeUndefined();
  // The shape it reads now.
  const raw = upstream.content.map((b) => b.text || '').join('');
  expect(JSON.parse(raw).hints).toHaveLength(1);
});

test('a truncated draft is distinguishable from a draft with no hints', () => {
  const truncated = {
    stop_reason: 'max_tokens',
    content: [{ type: 'text', text: '{"hints":[{"section":"note","co' }],
  };
  const empty = {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '{"hints":[]}' }],
  };
  const parse = (r) => {
    try {
      return { ok: true, value: JSON.parse(r.content.map((b) => b.text).join('')) };
    } catch {
      return { ok: false, stop: r.stop_reason };
    }
  };
  const a = parse(truncated);
  const b = parse(empty);
  expect(a.ok).toBe(false);
  expect(a.stop).toBe('max_tokens');
  expect(b.ok).toBe(true);
  expect(b.value.hints).toEqual([]);
});

/* bt is the tool his comparison is about, and "eight catalog codes" is the
   claim the whole bench was built to test. Pinned so the number in the
   conversation and the number in the code stay the same number. */
test('bt carries eight catalog codes', () => {
  const { tool } = loadTool('bt');
  expect(Object.keys(tool.hintCatalog)).toHaveLength(8);
});
