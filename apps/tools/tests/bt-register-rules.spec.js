import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// style-score.mjs is ESM and this spec is transpiled as CJS, so it loads
// dynamically. Same pattern as sap-detector-calibration.spec.js.
let score, metrics;

// BT's register rules, ported from the SAP tool because SAP works and BT did not.
//
// He reported SAP scoring 0% on QuillBot for the body, generalization and error
// correction sections with minimal input from him. Reading the two prompts side
// by side found a direct contradiction:
//
//   SAP: "NAME ONCE AT THE SHIFT, THEN LET IT RIDE ... Re-naming the same actor
//         sentence after sentence is the single loudest machine-writing tell."
//   BT:  "Every sentence about a procedure should be attributable to someone in
//         the room."
//
// BT was instructing the model to do the exact thing SAP identifies as the
// loudest tell, and the measured output showed it: nearly every sentence opened
// "The behavior technician".
//
// Measured on the same intake with scripts/style-score.mjs: 26 before the port,
// 10 after. A first draft under these rules beats two rounds of hand revision,
// which scored 16.

const ROOT = join(__dirname, '..');
const fixture = (n) => readFileSync(join(ROOT, 'tests/fixtures/notes', n), 'utf8');

test.describe('the prompt carries the rules that made SAP work', () => {
  let system;
  test.beforeEach(async ({ page }) => {
    await page.goto('/notes/bt/');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    system = await page.evaluate(() => window.NOTE_TOOLS.find((t) => t.id === 'bt').buildSystem());
  });

  test('it says to name the actor once and then stop', async () => {
    expect(system).toMatch(/LET IT RIDE/);
    expect(system).toMatch(/must not restate the actor/i);
  });

  test('the old instruction to name an actor every sentence is gone', async () => {
    // This is the rule that caused it. Its removal is the fix, so its absence
    // is the thing worth pinning.
    expect(system).not.toMatch(/every sentence about a procedure should be attributable/i);
  });

  test('it carries countable ceilings, not preferences', async () => {
    expect(system).toMatch(/HARD CEILINGS/);
    expect(system).toMatch(/AT MOST half the sentences/);
    // The measured human rate, which is what makes the ceiling defensible.
    expect(system).toMatch(/one sentence in five/i);
    expect(system).toMatch(/no more than TWO sentences .* same first two words/is);
  });

  test('it distinguishes repeated terms from repeated sentence shape', async () => {
    // Clinical writing repeats clinical terms and must be allowed to. The thing
    // to avoid is the shape.
    expect(system).toMatch(/repetition of SENTENCE SHAPE/i);
  });

  test('it bans the empty openers', async () => {
    expect(system).toMatch(/It is important to/);
    expect(system).toMatch(/This ensures/);
  });

  test('it asks for completeness rather than brevity', async () => {
    // Mandating terseness is what produced the flagged sections on SAP. The
    // measured lesson was that the opposite of terse is specificity, not padding.
    expect(system).toMatch(/Length follows completeness, not brevity/i);
    expect(system).toMatch(/neither is padding/i);
  });
});

test.describe('the rules measurably work', () => {
  test.beforeAll(async () => {
    // The real scorer, not a copy of it. An earlier version of this spec
    // reimplemented metrics() by hand and drifted from it immediately, which is
    // the exact fragility sap-detector-calibration.spec.js exists to warn about.
    ({ score, metrics } = await import(pathToFileURL(join(__dirname, '../scripts/style-score.mjs')).href));
  });

  test('a draft written to the ported rules varies far more than the one before it', () => {
    const before = metrics(fixture('bt-before-port.txt'));
    const after = metrics(fixture('bt-ported-rules.txt'));
    // Burstiness carries 30 of the 100 points and the literature calls it the
    // most reliable mechanical signal there is.
    expect(after.burstiness).toBeGreaterThan(before.burstiness * 1.5);
    expect(after.openerVariety).toBeGreaterThan(before.openerVariety);
    // Human writing measures around 0.55 type-token, machine text around 0.45.
    expect(after.typeTokenRatio).toBeGreaterThan(0.6);
  });

  test('and it scores better than the version that named an actor every sentence', () => {
    const before = score(metrics(fixture('bt-before-port.txt'))).total;
    const after = score(metrics(fixture('bt-ported-rules.txt'))).total;
    expect(after).toBeLessThan(before);
    // Recorded so a prompt change that quietly undoes this is visible. Measured
    // 26 before the port and 10 after, on the same intake.
    expect(after, `ported-rules draft scored ${after}, was 10 when this was written`)
      .toBeLessThanOrEqual(14);
    expect(before, `pre-port draft scored ${before}, was 26 when this was written`)
      .toBeGreaterThanOrEqual(20);
  });
});
