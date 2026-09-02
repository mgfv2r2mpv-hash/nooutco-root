import { test, expect } from '@playwright/test';
import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// __dirname rather than import.meta, matching expert-vs-catalog-bench.spec.js:
// Playwright loads these specs through a transpiler where import.meta is not
// available.
const APP = join(__dirname, '..');
const ALL = ['bt', 'sap', 'sup', 'parent', 'assess'];

/* SUP, PARENT AND ASSESS GAINED A RESPONSE SCHEMA on 2026-08-30, on his
 * instruction: extend the expert to all three.
 *
 * WHY A SCHEMA IS WHAT THAT INSTRUCTION COMES DOWN TO. engine.jsx fires the
 * expert only when expertSectionIds() returns a list, and that function reads
 * the section enum out of the tool's responseSchema. A tool without one is
 * opted out by construction, which is the design the comment there states.
 *
 * SO THE CHANGE IS TWO CHANGES, and these tests exist because of the second
 * one. Declaring a schema also constrains the DRAFT: /api/llm-call serializes
 * the note against it on every turn, first draft and revision alike. Three
 * things could go wrong there and none of them would look like a broken
 * expert:
 *
 *   1. A sealed object that omits "answer" turns a question into an edit. The
 *      engine sends REVISION_RULES to every tool on every turn, and one of
 *      them says to answer in "answer" and change nothing. Under
 *      additionalProperties:false a tool that cannot emit that key rewrites the
 *      note instead - the exact fault the rule was written to prevent.
 *   2. An enum the normalizer does not recognise silently drops a value. The
 *      schema decides what the model MAY say; normalizeOutput decides what the
 *      tool KEEPS. If those two lists drift, a legal answer disappears between
 *      them and nothing errors.
 *   3. A section id the schema publishes that the renderer does not draw sends
 *      the expert an id it will file findings under and no section will show.
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

function sectionEnum(tool, win) {
  const list = tool.responseSchema.properties.hints.items.properties.section.enum;
  return list.filter((id) => id !== win.NoteToolsUtil.HINT_WHOLE_NOTE);
}

/* A draft that uses every option the schema allows, built from the schema
   itself rather than typed out here - a hand-written sample would only ever
   test the values whoever wrote it thought of. */
function maximalDraft(schema) {
  const out = {};
  for (const key of schema.required) {
    if (key === 'hints') { out.hints = []; continue; }
    const p = schema.properties[key];
    if (p.type === 'array' && p.items.type === 'string') out[key] = [...p.items.enum];
    else if (p.type === 'array') out[key] = [rowFor(p.items)];
    else if (p.enum) out[key] = p.enum.filter(Boolean)[0];
    else out[key] = 'prose for ' + key;
  }
  return out;
}

function rowFor(items) {
  const row = {};
  for (const k of items.required) row[k] = 'row ' + k;
  return row;
}

test('every note tool opts into the expert, and does it through its schema', () => {
  for (const id of ALL) {
    const { tool, win } = loadTool(id);
    expect(tool.responseSchema, `${id} declares no responseSchema`).toBeTruthy();
    const sections = sectionEnum(tool, win);
    expect(sections.length, `${id} would send the expert an empty section list`).toBeGreaterThan(0);
  }
});

/* Fault 3 is asserted in expert-vs-catalog-bench.spec.js, which is where the
   schema-versus-formSections question already lives, rather than a second time
   here. */

/* Fault 1, AT BOTH LAYERS, because measuring it showed one layer was not enough.

   The first version of this test read schemas only, and reported sap as the
   single tool that could not answer a question. That was true and incomplete.
   A tool answers a question only if BOTH halves hold: its schema lets the model
   emit `answer`, and its normalizeOutput hands that key onward to the engine,
   which reads `normalized.answer` and nothing else. sup, parent and assess
   passed the schema half the moment they gained a schema and failed the second
   half in exactly the way fault 2 below describes - so giving them a schema
   alone left them where sap already was, and the schema-only test could not
   see it.

   Both halves are asserted per tool now, and the engine's own reader is the
   authority for which keys count. */
const REVISION_KEYS = ['answer', 'bcbaQuestion', 'crossSection'];

test('every tool can answer a question, in its schema and through its normalizer', () => {
  for (const id of ALL) {
    const { tool } = loadTool(id);
    const props = tool.responseSchema.properties;
    for (const key of REVISION_KEYS) {
      expect(props[key], `${id} seals its object without "${key}", so the model cannot send one`)
        .toBeTruthy();
      expect(tool.responseSchema.required, `${id} requires "${key}", so every draft must carry one`)
        .not.toContain(key);
    }
  }
});

test('the keys that carry an answer survive the tool normalizer', () => {
  for (const id of ALL) {
    const { tool, win } = loadTool(id);
    const section = sectionEnum(tool, win)[0];
    const out = tool.normalizeOutput({
      answer: 'Yes, that meets the operational definition.',
      bcbaQuestion: 'Should the escape program pause while she is ill?',
      crossSection: [{ section, confident: true, why: 'the detail moved here' }],
    });
    expect(out.answer, `${id} drops "answer", so a question comes back as an edit`)
      .toBe('Yes, that meets the operational definition.');
    expect(out.bcbaQuestion, `${id} drops "bcbaQuestion", so the offer never reaches the panel`)
      .toBe('Should the escape program pause while she is ill?');
    expect(out.crossSection, `${id} drops "crossSection", so every off-target change asks`)
      .toEqual([{ section, confident: true, why: 'the detail moved here' }]);
  }
});

/* The validation half, which is what makes dropping the keys unsafe to fix by
   simply passing them through. A section the tool does not draw must not be
   able to route a change, and a model that returns the wrong type must not be
   able to put an object where the engine expects a string. */
test('a normalizer keeps the answer keys without trusting them', () => {
  for (const id of ALL) {
    const { tool, win } = loadTool(id);
    const real = sectionEnum(tool, win)[0];
    const out = tool.normalizeOutput({
      answer: { not: 'a string' },
      bcbaQuestion: 42,
      crossSection: [
        { section: 'a-section-no-tool-draws', confident: true, why: 'fabricated' },
        { section: real, confident: 'yes', why: 'confident is not a boolean here' },
      ],
    });
    expect(out.answer, `${id} passes a non-string answer through to the engine`).toBe('');
    expect(out.bcbaQuestion, `${id} passes a non-string question through`).toBe('');
    expect(out.crossSection.map((c) => c.section),
      `${id} lets a fabricated section id route a change`).toEqual([real]);
    expect(out.crossSection[0].confident,
      `${id} treats a non-boolean as confident, which applies a change silently`).toBe(false);
  }
});

/* Fault 2. The schema says what the model MAY return and normalizeOutput says
   what the tool KEEPS, and nothing between them errors when they disagree. */
test('every value the schema permits survives the tool normalizer', () => {
  for (const id of ['sup', 'parent', 'assess']) {
    const { tool } = loadTool(id);
    const draft = maximalDraft(tool.responseSchema);
    const kept = tool.normalizeOutput(draft);
    for (const key of Object.keys(draft)) {
      if (key === 'hints') continue;
      expect(kept[key], `${id}.${key} was dropped by normalizeOutput`).toEqual(draft[key]);
    }
  }
});

/* The empty draft is the other end of the same question. Every single-select
   allows "", which is the model's honest option when the notes do not support a
   choice, and the normalizer has to keep that rather than substitute a guess. */
test('the blank a single-select is allowed to return is a blank the tool keeps', () => {
  for (const id of ['sup', 'parent']) {
    const { tool } = loadTool(id);
    const singles = Object.entries(tool.responseSchema.properties)
      .filter(([, p]) => p.type === 'string' && Array.isArray(p.enum));
    expect(singles.length, `${id} has no single-select to check`).toBeGreaterThan(0);
    for (const [key, p] of singles) {
      expect(p.enum, `${key} gives the model no way to decline`).toContain('');
    }
    const blank = {};
    for (const [key] of singles) blank[key] = '';
    expect(tool.normalizeOutput(blank), `${id} turned a declined choice into something else`)
      .toMatchObject(blank);
  }
});

/* The required list is the tool's own contract and nothing else. hints is on it
   because an empty array is a real answer - "this note stands on its own" has
   to be distinguishable from the model forgetting to reply - while the three
   revision keys are off it because a first draft has nothing to answer.

   IT IS NOT THE SECTION LIST, and bt is why, in both directions.

   A `kind: "facts"` band is drawn on the page and carries a section id, but the
   model does not fill a key by that name: bt's sessionFacts band renders three
   rows, two of them quick-picks the clinician already answered and one -
   servicePaused - a top-level key the model does decide. So sessionFacts is a
   section with no key, and servicePaused is a key with no section. The four
   other tools have no facts band and the two lists coincide for them, which is
   exactly how a rule stated as "required equals the sections" passes four
   times and is still wrong.

   Derived from the tool's own structure rather than listed, so a fifth tool
   growing a facts band does not have to be added here by hand. */
const isModelSection = (s) => s.kind !== 'facts';

function modelKeys(tool) {
  const keys = [];
  for (const sec of tool.formSections) {
    if (isModelSection(sec)) { keys.push(sec.key || sec.group); continue; }
    // A facts row the model fills is a key; one the clinician already answered
    // is echoed back from the inputs and never travels in the response.
    for (const row of sec.rows || []) if (row.from === 'output') keys.push(row.id);
  }
  return keys;
}

test('a schema requires exactly the keys the model fills, plus hints', () => {
  for (const id of ALL) {
    const { tool } = loadTool(id);
    expect([...tool.responseSchema.required].sort(), `${id} requires the wrong keys`)
      .toEqual([...modelKeys(tool), 'hints'].sort());
    expect(tool.responseSchema.additionalProperties, `${id} does not seal its object`).toBe(false);
  }
});

/* And the corollary, which is the thing that would actually hurt: a key the
   engine expects back but the schema does not describe cannot be returned at
   all under additionalProperties:false, and the failure would surface to the
   clinician as a section that silently stopped updating. */
test('every key the engine expects back is a key the schema describes', () => {
  for (const id of ALL) {
    const { tool } = loadTool(id);
    for (const key of tool.formSections.filter(isModelSection).map((s) => s.key || s.group)) {
      expect(tool.responseSchema.properties[key], `${id}.${key} is expected back but sealed out`).toBeTruthy();
    }
  }
});
