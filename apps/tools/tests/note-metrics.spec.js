import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* notes/bcba/note-metrics.js measures a generated note in the browser so the
 * weekly audit has numbers to trend. scripts/style-score.mjs measures a file on
 * disk so a person can check one by hand. They implement the same weighting on
 * purpose, and if they ever drift then a number in the Friday email stops
 * meaning what the same number means at the command line.
 *
 * The anchors are the seven human-written plans, whose recorded totals were
 * produced by the .mjs scorer. Feeding those same stored signals through the
 * browser scorer must reproduce them exactly. */

const ANCHORS = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/notes/sap-detector-anchors.json'), 'utf8'),
).anchors;

test.describe('note metrics in the browser', () => {
  test('the browser scorer reproduces the command-line totals exactly', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!window.NoteMetrics);

    const got = await page.evaluate((anchors) =>
      anchors.map((a) => ({
        plan: a.plan,
        expected: a.recordedScore,
        actual: window.NoteMetrics.score({
          burstiness: a.metrics.burstiness,
          openerVariety: a.metrics.openerVariety,
          typeTokenRatio: a.metrics.typeTokenRatio,
          entropy: a.metrics.entropy,
          repeatRate: a.metrics.repeatRate,
          commaRate: a.metrics.commaRate,
        }),
      })), ANCHORS);

    for (const r of got) {
      expect(r.actual, `plan ${r.plan}: browser and CLI scorers disagree, so the `
        + 'weekly email no longer means what style-score.mjs means').toBe(r.expected);
    }
  });

  test('measuring returns numbers only, never a fragment of the text', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!window.NoteMetrics);

    const out = await page.evaluate(() => window.NoteMetrics.measure(
      'The technician presents the array and waits five seconds. The technician '
      + 'delivers the prompt. The technician records the response. The client '
      + 'selects an item. The client is reinforced for a correct selection. '
      + 'Sessions run daily in the kitchen with the caregiver present.'));

    expect(out).toBeTruthy();
    for (const [k, v] of Object.entries(out)) {
      expect(typeof v, `${k} is not a number, so text could leak into the audit`).toBe('number');
    }
  });

  test('it detects the saturation that went unnoticed on the SAP tool', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!window.NoteMetrics);

    // Same shape as the real 47% draft: every sentence names the client and
    // opens the same way. The measure has to see it without a detector.
    const out = await page.evaluate(() => window.NoteMetrics.measure(
      Array.from({ length: 8 }, (_, i) =>
        `The technician prompts the client to select item ${i} within five seconds.`).join(' ')));

    expect(out.clientRate).toBeGreaterThan(0.9);
    expect(out.openerVariety).toBeLessThan(0.3);
    expect(out.topOpenerRepeat).toBeGreaterThan(2);
  });

  test('a note too short to measure returns nothing rather than a wrong number', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!window.NoteMetrics);
    const out = await page.evaluate(() => window.NoteMetrics.measure('Too short.'));
    expect(out).toBeNull();
  });
});
