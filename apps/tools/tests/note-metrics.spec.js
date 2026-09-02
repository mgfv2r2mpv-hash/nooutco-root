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

  test('the register signals the Friday report trends are all measured', async ({ page }) => {
    /* The four banned constructions have been counted here since the bans
     * shipped and never reached the audit payload, so the report could not say
     * whether the change that took a real note from 53% to 0% was holding.
     * Imperative rate is measured too: of everything tried against the real
     * detector it is the one that kept both its sign and its magnitude. */
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!window.NoteMetrics);

    const out = await page.evaluate(() => window.NoteMetrics.measure(
      // Two of the four banned constructions, one imperative opener, one actor.
      'Deliver the reinforcer within three seconds of an independent response. '
      + 'The technician altered the motivational state by providing attention on a '
      + 'fixed schedule. Prompting was most to least across the block. '
      + 'She recorded every trial rather than a first trial probe. '
      + 'Generalisation ran in the kitchen with the caregiver present.'));

    expect(out.abstractStates, '"motivational state" is one of the four').toBe(1);
    expect(out.participialCausals, '"by providing" is another').toBe(1);
    expect(out.flaggedPer100).toBeGreaterThan(0);
    // One of five sentences opens on a procedural verb.
    expect(out.imperativeRate).toBeCloseTo(0.2, 1);
    expect(out.actorRate).toBeGreaterThan(0);
  });

  test('a clean note reports zero for the banned constructions rather than omitting them', async ({ page }) => {
    // Zero is the signal the report needs most: it is what "the ban is holding"
    // looks like, and a missing key would read as no data instead.
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!window.NoteMetrics);

    const out = await page.evaluate(() => window.NoteMetrics.measure(
      'The client selected the correct bill in eight of twelve trials. '
      + 'She faded the prompt to a gesture once he began orienting unassisted. '
      + 'Two errors came near the end of the block. '
      + 'The session ran in the kitchen with his mother present throughout.'));

    for (const k of ['emptyAdverbs', 'participialCausals', 'abstractStates', 'vagueVerbs']) {
      expect(out[k], `${k} must be a reported zero, not an absent key`).toBe(0);
    }
    expect(out.flaggedPer100).toBe(0);
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

/* THE BAN LISTS CAUGHT A BASE FORM AND MISSED ITS NEIGHBOURS.
 *
 * A draft that wrote "supporting" instead of "supported", or "proactive"
 * instead of "proactively", scored clean on a rule it broke. Since the second
 * pass now fires on these counts, the miss was not only a wrong number in the
 * Friday report - it was a note the tool declined to revise.
 *
 * The four exclusions below have mechanisms behind them and each one is pinned,
 * because the widening is exactly the change that invites somebody to complete
 * the pattern later.
 */
test.describe('the constructions the lists used to walk past', () => {
  const M = async (page, text) => {
    await page.goto('/notes/bcba/index.html?tool=sap');
    await page.waitForFunction(() => !!window.NoteMetrics);
    return page.evaluate((t) => ({
      c: window.NoteMetrics.constructions(t),
      flagged: window.NoteMetrics.flagged(t),
    }), text);
  };

  test('the -ing forms of the vague verbs count, where only the -ed form used to', async ({ page }) => {
    const { c } = await M(page, 'The technician was supporting the transition while facilitating a choice and promoting engagement.');
    expect(c.vagueVerbs).toBe(3);
  });

  test('the adjective is as empty as the adverb it came from', async ({ page }) => {
    const { c } = await M(page, 'A proactive plan and careful setup made for a successful, thorough session.');
    expect(c.emptyAdverbs).toBe(4);
  });

  test('the causal participial covers the gerunds that explain rather than name', async ({ page }) => {
    const { c } = await M(page, 'She helped by encouraging him, by facilitating the trade, and by establishing the routine.');
    expect(c.participialCausals).toBe(3);
  });

  test('the abstract compound is a pattern now, not a list of eight', async ({ page }) => {
    const { c } = await M(page, 'His sensory profile, social pattern and communication level were all noted.');
    expect(c.abstractStates).toBe(3);
  });

  test('the eight it already caught are still caught', async ({ page }) => {
    // A widening that drops a case it used to hold is a regression wearing an
    // improvement's clothes.
    const { c } = await M(page, 'His motivational state, behavioral response, behavioral presentation, emotional state, engagement level, response pattern, behavioral pattern and activity level were noted.');
    expect(c.abstractStates).toBe(8);
  });

  test('"effective" and "addressing" stay off, because they are the tool\'s own label', async ({ page }) => {
    // consequenceEffectiveness reads "Highly effective at addressing behaviors",
    // and the register measurement runs over every keyed section. Banning either
    // would count the tool's own words on every note ever drafted.
    const { flagged } = await M(page, 'Highly effective at addressing behaviors and mitigating future incidents.');
    expect(flagged).toEqual([]);
  });

  test('"appropriate" and "systematic" stay off, because both name real procedures', async ({ page }) => {
    // A rule that flags a technician for writing "appropriate replacement
    // behavior" is teaching them to write around their own vocabulary.
    const { flagged } = await M(page, 'Systematic desensitization ran alongside teaching of an appropriate replacement behavior.');
    expect(flagged).toEqual([]);
  });

  test('"by prompting" and "by reinforcing" stay off, because a prompt is what happened', async ({ page }) => {
    const { c } = await M(page, 'The technician answered by prompting the mand and followed by reinforcing the response.');
    expect(c.participialCausals).toBe(0);
  });

  test('flagged names the phrases and never the sentence they sat in', async ({ page }) => {
    const { flagged } = await M(page, 'The technician proactively supported the money program by providing a warning before each trial.');
    expect(flagged).toEqual(['proactively', 'by providing', 'supported']);
    for (const f of flagged) {
      expect(f).not.toMatch(/money program|trial|technician/);
    }
  });

  test('a clean clinical sentence still flags nothing at all', async ({ page }) => {
    const { flagged } = await M(page, 'The client said "break" on four occasions and the technician gave one each time.');
    expect(flagged).toEqual([]);
  });
});
