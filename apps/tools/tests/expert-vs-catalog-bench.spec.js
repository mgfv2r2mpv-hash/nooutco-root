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
 *      The two sources agree today for all five tools, and that agreement is
 *      maintained by hand rather than by anything structural, which is why it
 *      is asserted below rather than assumed.
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
   A tool gaining OR losing a responseSchema is a real change in what the expert
   covers, and either direction should break this line.

   It read ['bt', 'sap'] until 2026-08-30, when his instruction extended the
   expert to sup, parent and assess. The assertion is written against the same
   list the loop walks, so a tool dropping out breaks it just as loudly. */
test('the expert runs for every note tool, not a subset of them', () => {
  const all = ['bt', 'sap', 'sup', 'parent', 'assess'];
  const runs = [];
  for (const id of all) {
    const { tool, win } = loadTool(id);
    if (expertSectionIds(tool, win)) runs.push(id);
  }
  expect(runs.sort()).toEqual([...all].sort());
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

/* THIS TEST USED TO ASSERT THE OPPOSITE, and it passed for a bad reason. It
   read `s.id` off each formSection, and a formSection carries `key` or `group`
   and never `id` - so it compared four real ids against four undefineds and
   would have passed for any tool in the file, including one whose two lists
   were identical. The claim it was defending is also false: measured across all
   five tools at 6f38ff0d, four matched exactly and sup matched as a set in a
   different order.

   What is true, and worth a test, is the opposite. A tool states its sections
   twice - once as a render order, once as the schema enum the response is
   serialized against - and nothing but hand makes those agree. Where they
   diverge, the expert files findings under ids the page cannot draw. The
   every(Boolean) line is the guard that would have caught the original bug. */
test('a tool states its sections twice, and the two statements must agree', () => {
  for (const id of ['bt', 'sap', 'sup', 'parent', 'assess']) {
    const { tool, win } = loadTool(id);
    const fromForm = (tool.formSections || []).map((s) => s.key || s.group);
    expect(fromForm.every(Boolean), `${id}: a formSection has neither key nor group`).toBe(true);
    expect(expertSectionIds(tool, win), `${id} disagrees with itself about its own sections`)
      .toEqual(fromForm);
  }
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

/* bt is the tool his comparison is about, and the size of its catalog is the
   claim the whole bench was built to test. Pinned so the number in the
   conversation and the number in the code stay the same number.

   IT WAS EIGHT UNTIL 2026-08-31, when ambiguous_item was added. That was not a
   new idea about what bt should flag: the shared register rules had been telling
   every session tool to emit that code since they were written, and bt's catalog
   did not hold it, so the schema enum and normalizeHints both dropped it. The
   count moved because a code that was already being asked for started being
   accepted. A future change that moves it again should say which of those two
   things happened. */
test('bt carries eleven catalog codes', () => {
  const { tool } = loadTool('bt');
  const codes = Object.keys(tool.hintCatalog);
  expect(codes).toHaveLength(11);
  expect(codes, 'the code the shared register rules name').toContain('ambiguous_item');

  /* 2026-09-02, and this is a FOURTH kind of move, which is why the count
     changed rather than a code being swapped: strategy_in_wrong_section is not
     a gap the model reports. The post-pass checks completeness B9 against the
     tool's own two strategy lists and injects the hint itself. It still has to
     live in this catalog, because normalizeHints drops any code the tool does
     not declare and a hint nobody declared is a hint nobody sees. So the
     catalog now holds codes from two sources, and a future reader counting
     "what the model can emit" will be off by this one. */
  expect(codes, 'the code the post-pass injects rather than the model emitting')
    .toContain('strategy_in_wrong_section');

  // 2026-09-01, and this is the third kind of move: the catalog and the
  // knowledge base disagreed, and the catalog was wrong.
  //
  // OUT. no_behavior_count told the technician to "add how many times it
  // occurred, even if zero". necessity's do-not-repeat-the-data says the EHR
  // already attaches this session's counts and that a note reciting them has
  // spent its space on what the record already has, and completeness B7 says
  // the same. The catalog was asking for the one thing the handout forbids.
  // What survives is the comparison, which no_rate_comparison already carried.
  expect(codes, 'the catalog asked for what do-not-repeat-the-data forbids').not.toContain('no_behavior_count');
  expect(codes, 'the comparison is what a number is read for').toContain('no_rate_comparison');

  // IN. Two rules the knowledge base states and no code could reach.
  // completeness B4 wants a strategy's outcome; necessity's lesson-what-worked
  // wants which strategies did not work. Neither had a channel.
  expect(codes).toContain('no_strategy_outcome');
  // Nothing carried a help that worked and is not in the written plan, which is
  // a candidate plan revision and the most supervision-relevant thing a
  // technician can notice.
  expect(codes).toContain('helped_not_in_plan');
});
