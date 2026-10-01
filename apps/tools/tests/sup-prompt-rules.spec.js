import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import vm from 'node:vm';

/* The sup tool's SYSTEM_CORE must carry the same tuned rules as the voice-module
 * prompt (prompt-api/src/prompts/sup.js, sup-tuning spec section A). Parity is
 * judged there by the sha256 of the composed prompt, so this runs the real
 * files in a bare vm exactly as live-compose.mjs does and pins the same hash.
 * The phrase checks say WHICH rule went missing when the hash moves. No model
 * is called. */

const ROOT = join(__dirname, '..', 'notes/bcba');
// Composed sup prompt (SYSTEM_CORE + register rules + JSON block). The tuning met
// the one-owner-per-facet rules on dev, so this is the merged prompt: the
// voice-module store holds the older text until it is re-extracted from here.
const SUP_SYSTEM_SHA256 = 'dc09f94706bd60e21a5d2100ee123daaa315e08034f0ee97bcad4f317e22fa21';

function compose() {
  const win = {};
  const ctx = vm.createContext({ window: win, console });
  for (const f of ['note-tools-util.js', 'register-rules.js', 'tools/sup.js']) {
    vm.runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  const tool = win.NOTE_TOOLS.find((t) => t.id === 'sup');
  return { system: tool.buildSystem() };
}

const { system } = compose();

const block = (heading) => {
  const start = system.indexOf(`\n\n${heading}.`);
  expect(start, `the prompt has no "${heading}" block`).not.toBe(-1);
  const next = system.indexOf('\n\n', start + 2);
  return system.slice(start + 2, next === -1 ? undefined : next);
};

test.describe('sup SYSTEM_CORE: parity with the voice-module prompt', () => {
  test('the composed prompt hashes to the voice-module constant', () => {
    expect(createHash('sha256').update(system).digest('hex')).toBe(SUP_SYSTEM_SHA256);
  });

  test('no em dash reaches the prompt', () => {
    expect(system).not.toContain('\u2014');
  });

  test('sentence budgets carry their numbers and the ceiling', () => {
    const b = block('SENTENCE BUDGETS');
    expect(b).toMatch(/Summary of Progress[^\n]*4 to 6 sentences at two goals or fewer, plus 2 for each goal beyond two/);
    for (const s of ['Protocol Modifications', 'Behavior', 'Feedback Notes']) {
      expect(b).toMatch(new RegExp(`${s}[^\\n]*4 sentences`));
    }
    expect(b).toMatch(/never above 6/);
    expect(b).toMatch(/Progress is 2 sentences/);
    expect(b).toMatch(/Next Steps is 1 sentence/);
    expect(b).toMatch(/Never pad to reach the floor/);
    expect(b).toMatch(/reduction goals alone exceed the Behavior ceiling, the floor wins and the draft says so in one clause/);
  });

  test('old per-section ceilings are gone', () => {
    expect(system).not.toMatch(/up to (10|5|6) sentences/);
  });

  test('goal-row signal rule', () => {
    const b = block('WHAT IS A GOAL ROW');
    expect(b).toMatch(/bulleted with data/);
    for (const label of ['behavior targeted for reduction', 'behavior of concern', 'behavior goal', 'maladaptive behavior', 'challenging behavior', 'interfering behavior']) {
      expect(b).toContain(label);
    }
    expect(b).toMatch(/A reduction target gets its row even at zero occurrences/);
    expect(b).toMatch(/anything told as a story with no program name and no data are NOT goal rows/);
  });

  test('goalsAnalyzed cap: up to 6 skill rows, and every reduction target is a row on top of that', () => {
    expect(system).toMatch(/goalsAnalyzed \(owns[^)]*\): [^\n]*up to 6 skill rows, and every reduction target gets its row in addition, so up to 6 plus the number of reduction targets/);
    expect(system).not.toMatch(/max 6 skill rows/);
  });

  test('a reduction-target row says what it carries: trajectory or empty, never the count', () => {
    const b = block('WHAT IS A GOAL ROW');
    expect(b).toMatch(/reduction target's Progress is one sentence about the trajectory of the behavior across the session, with no pointer to another section, or is left empty/);
    expect(b).toMatch(/never the occurrence count, which lives only in Description of Behavior and Support/);
    expect(b).toMatch(/its Next Steps is one sentence/);
  });

  test('the who-writes-this paragraph keeps the shared ceiling sentence, and the floor/ceiling meaning lives in SENTENCE BUDGETS', () => {
    const w = block('WHO WRITES THIS AND WHEN');
    expect(w).toMatch(/any sentence range given below is a CEILING, never a target/);
    expect(w).not.toMatch(/SENTENCE BUDGETS/);
    const b = block('SENTENCE BUDGETS');
    expect(b).toMatch(/The ranges in this block are ceilings, and a stated minimum is a floor only for a section that has content/);
  });

  test('goal names are copied verbatim, punctuation included', () => {
    const b = block('GOAL NAMES');
    expect(b).toMatch(/verbatim from the bullet/);
    expect(b).toMatch(/no renaming, no merging, order kept/);
    expect(b).toMatch(/Tolerate 'No'/);
    expect(b).toMatch(/Alternative to Denied Item\/Activity/);
  });

  test('goal progress is qualitative and unexplained codes raise ambiguous_item', () => {
    const b = block('GOAL PROGRESS IS QUALITATIVE');
    expect(b).toMatch(/The EHR already stores the counts and percentages/);
    expect(b).toMatch(/5\/3 is 5 correct and 3 incorrect/);
    expect(b).toMatch(/emit an ambiguous_item hint/);
  });

  test('one facet lives in one section', () => {
    const b = block('ONE FACET, ONE SECTION');
    expect(b).toMatch(/Behavior section only/);
    expect(b).toMatch(/Feedback Notes only/);
    expect(b).toMatch(/A facet repeated in a second section is a defect/);
  });

  test('BT toggle conflict rule', () => {
    const b = block('NEVER STATE A FACT THE NOTES DO NOT STATE');
    expect(b).toMatch(/toggle says No and the notes say a BT was present/);
    expect(b).toMatch(/toggle says Yes and the notes say only the BCBA was there/);
    expect(b).toMatch(/do not assert BT presence either way/);
    expect(b).toMatch(/ambiguous_item hint on feedback/);
  });

  test('quotes rule', () => {
    const b = block('QUOTES');
    expect(b).toMatch(/spoken line and any scare quote uses double quotes/);
    expect(b).toMatch(/Escape each one as \\" so the JSON stays valid/);
  });

  test('rules sit before the output format', () => {
    expect(system.indexOf('SENTENCE BUDGETS')).toBeLessThan(system.indexOf('OUTPUT FORMAT'));
  });
});
