import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

/* docs/ai-detection-baseline.md records a measured claim: style-score.mjs does
 * NOT predict what the real detector reports on real clinical prose, r = 0.08.
 * That number is the reason the file tells you not to gate the scorer in CI.
 *
 * A claim like that rots silently. Someone retunes the weights in six months to
 * make a fixture look better, the doc still says 0.08, and the "don't gate it"
 * conclusion is now resting on a measurement of a scorer that no longer exists.
 *
 * So this recomputes rather than restates. The anchors hold raw metrics and the
 * clinician's QuillBot scores; the current weights are applied to those metrics
 * here. Change the weights and the recorded totals stop matching, which is the
 * signal that the calibration needs rerunning before the doc can be trusted.
 *
 * No clinical text is involved - see the fixture's own note on why. These are
 * pure Node assertions; there is no page under test, they just run once per
 * configured browser project. */

const DATA = JSON.parse(readFileSync(join(__dirname, 'fixtures/notes/sap-detector-anchors.json'), 'utf8'));
const ANCHORS = DATA.anchors;
const SCORED = ANCHORS.filter((a) => a.quillbot !== null);

// style-score.mjs is ESM and this spec is transpiled to CJS, so it has to come
// in through a dynamic import rather than a require. Loading the real module
// (not a copy of its weights) is the whole point - a copy would drift.
let scoreFn;
const score = async (m) => {
  if (!scoreFn) {
    ({ score: scoreFn } = await import(pathToFileURL(join(__dirname, '../scripts/style-score.mjs')).href));
  }
  return scoreFn(m);
};

function pearson(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const dx = xs.map((x) => x - mx);
  const dy = ys.map((y) => y - my);
  const num = dx.reduce((a, _, i) => a + dx[i] * dy[i], 0);
  const den = Math.sqrt(dx.reduce((a, v) => a + v * v, 0) * dy.reduce((a, v) => a + v * v, 0));
  return den ? num / den : 0;
}

test.describe('SAP detector calibration', () => {
  test('the recorded totals still match what the scorer produces', async () => {
    // The staleness guard. Recomputed from the stored metrics with today's
    // weights, so a retune surfaces here rather than in a stale doc.
    for (const a of ANCHORS) {
      expect((await score(a.metrics)).total, `plan ${a.plan}: style-score.mjs no longer produces the recorded total. `
        + 'If the weights changed deliberately, rerun the calibration and update both this fixture '
        + 'and docs/ai-detection-baseline.md - the r=0.08 finding describes the OLD weights.')
        .toBe(a.recordedScore);
    }
  });

  test('style-score does not predict the real detector, which is why it is not a CI gate', async () => {
    const totals = [];
    for (const a of SCORED) totals.push((await score(a.metrics)).total);
    const r = pearson(totals, SCORED.map((a) => a.quillbot));

    // The documented figure. Loose tolerance: the point is "indistinguishable
    // from no relationship", not the third decimal place.
    //
    // Was 0.08. Moved to 0.21 on 2026-08-04 when the comma term was removed
    // from the scorer: it correlated -0.05 with the detector and penalised six
    // of these seven human plans, so it was noise pulling in the wrong
    // direction. Better, and still nowhere near a predictor - which is the
    // whole reason this stays out of CI.
    expect(r).toBeCloseTo(0.21, 1);

    // The claim that actually matters, stated as a bound rather than a value.
    // If a future scorer clears this, gating becomes arguable again - and that
    // is a conversation to have deliberately, not a threshold to drift into.
    expect(Math.abs(r), 'the scorer now tracks the detector well enough that the "do not gate it" '
      + 'guidance in docs/ai-detection-baseline.md should be revisited').toBeLessThan(0.5);
  });

  test('the two heaviest signals sit high on these seven plans', async () => {
    // Scoped deliberately to THESE PLANS. An earlier version of this test was
    // named "...on real clinical prose" and the doc drew the matching
    // conclusion: the signals are saturated on human writing, therefore the
    // scorer has nothing left to discriminate with, therefore the null result
    // was inevitable.
    //
    // Measuring 104 documents of the same author's ABA coursework refuted that.
    // Opener variety there runs down to 0.62 with a median of 0.86, and 73% of
    // the documents fall at or below the 0.90 floor every plan clears; the
    // scorer spans 8 to 38 rather than 12 to 24. Real human writing is not
    // saturated, so the scorer is not out of range - it simply does not spend
    // its range in a direction that tracks the detector. That is a worse result
    // for the proxy than the story this test used to tell, not a better one.
    for (const a of ANCHORS) {
      expect(a.metrics.openerVariety, `plan ${a.plan} opener variety`).toBeGreaterThan(0.9);
      expect(a.metrics.burstiness, `plan ${a.plan} burstiness`).toBeGreaterThan(0.5);
    }

    // Detector spread dwarfs scorer spread: 49 points against single digits.
    const totals = [];
    for (const a of SCORED) totals.push((await score(a.metrics)).total);
    const spread = (xs) => Math.max(...xs) - Math.min(...xs);
    expect(spread(SCORED.map((a) => a.quillbot))).toBeGreaterThan(40);
    expect(spread(totals), 'the scorer has almost no room to discriminate real plans').toBeLessThan(15);
  });

  test('ranking by style-score puts the detector\'s best and worst in the wrong order', async () => {
    // The concrete failure, kept as its own assertion because it is the single
    // most persuasive argument against gating and the easiest to forget.
    const worstByDetector = SCORED.reduce((a, b) => (a.quillbot > b.quillbot ? a : b));
    const best = SCORED.filter((a) => a.quillbot > 0).reduce((a, b) => (a.quillbot < b.quillbot ? a : b));

    expect(worstByDetector.plan).toBe(3);
    expect(best.plan).toBe(5);
    expect((await score(worstByDetector.metrics)).total,
      'the plan the detector flagged hardest still scores BETTER locally than one it nearly cleared')
      .toBeLessThan((await score(best.metrics)).total);
  });
});
