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

  /* THE CASE THE WHOLE-NOTE NUMBER CANNOT SEE.
   *
   * burstiness is a mixture of two things: how much sentence length moves
   * inside a section, and how far the average moves between sections. Across
   * 108 human documents those two correlate 0.096 with each other, and 21 human
   * documents that all sit at a whole-note figure of 0.60 range from 0.373 to
   * 0.583 inside their sections. So a note can post a healthy whole-note number
   * while every section reads at one flat pace, and that is the shape a model
   * reaches for when it is handed a single target.
   *
   * The fixture below is that shape on purpose: three sections, each one
   * internally uniform, with the averages far apart. */
  const FLAT_SECTIONS = [
    'The technician sets up the array. The technician waits five seconds. '
      + 'The technician records the trial. The technician resets the table.',
    'Reinforcement was delivered on a fixed ratio of one for every correct independent '
      + 'response across the full teaching block, and the schedule was held constant. '
      + 'Prompting followed a most to least hierarchy with a five second transfer interval '
      + 'between the model prompt and the independent opportunity that followed it. '
      + 'Data were collected on every trial rather than on a first trial probe basis.',
    'Generalisation runs in the kitchen. Generalisation runs in the living room. '
      + 'Generalisation runs at the table. Generalisation runs on the rug.',
  ].join('\n\n');

  test('flat sections are caught even when the whole-note figure looks healthy', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!window.NoteMetrics);

    const out = await page.evaluate((t) => window.NoteMetrics.measure(t), FLAT_SECTIONS);

    expect(out.sections, 'all three sections should have been measurable').toBe(3);
    // The whole-note figure clears the human 10th percentile of 0.506 with room
    // to spare, purely because the section averages are far apart. Nothing in
    // the old measurement could tell that from real variety.
    expect(out.burstiness).toBeGreaterThan(0.5);
    // The within-section figure is what gives it away, against a measured human
    // 10th percentile of 0.383 and a mean of 0.465.
    expect(out.sectionCv, 'flat sections should measure well under the human floor')
      .toBeLessThan(0.3);
    // All the movement lives between the sections instead of inside them: the
    // human 99th percentile for the step is 0.584.
    expect(out.sectionStep).toBeGreaterThan(0.584);
  });

  /* The other side of it. A gate that fires on everything is not a gate, and
   * within-section variability is not something to maximise either: the human
   * band runs 0.383 at the 10th percentile to 0.600 at the 99th. Both of these
   * sections were written to sit inside it. */
  const HUMAN_SCALE = [
    'The array was ready first. She waited five seconds before delivering the model '
      + 'prompt. Reinforcement followed every correct independent response for the first '
      + 'block of the whole session. Trials ran to ten today without a break. The client '
      + 'responded independently on most, and the two errors came near the end of the block.',
    'Prompting was most to least throughout. The transfer interval sat at five seconds. '
      + 'That was long enough for the client to answer before the model came in. Data went '
      + 'on every trial rather than a probe, and nothing was estimated after the fact. '
      + 'No generalisation targets ran today.',
  ].join('\n\n');

  test('human-scale variety inside a section reads as variety, so the check is two-sided', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!window.NoteMetrics);

    const out = await page.evaluate((t) => window.NoteMetrics.measure(t), HUMAN_SCALE);
    expect(out.sections).toBe(2);
    expect(out.sectionCv, 'genuine within-section variety must not be flagged as flat')
      .toBeGreaterThan(0.383);
    expect(out.sectionCv, 'nor should the measure reward variety no human produces')
      .toBeLessThan(0.6);
  });

  test('a note with no measurable section omits the keys rather than sending a zero', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!window.NoteMetrics);

    // One block of two sentences: below the three sentence floor, so there is
    // no honest number to report. A zero here would be folded into the
    // technician's running profile as a real observation of perfect flatness.
    const out = await page.evaluate(() => window.NoteMetrics.measure(
      'The technician ran the session in the kitchen with the caregiver present and '
      + 'recorded every trial on the paper sheet rather than the tablet. '
      + 'Reinforcement was delivered on the schedule written into the plan.'));

    expect(out).toBeTruthy();
    expect(out.sections).toBe(0);
    expect('sectionCv' in out, 'an unmeasurable section must be absent, not zero').toBe(false);
    expect('sectionStep' in out).toBe(false);
    for (const [k, v] of Object.entries(out)) {
      expect(typeof v, `${k} is not a number, so text could leak into the audit`).toBe('number');
    }
  });
});
