import test from "node:test";
import assert from "node:assert/strict";

import {
  accumulate, summarise, targetFor, renderShapeBlock,
  HUMAN_WITHIN_CV_MEAN, HUMAN_WITHIN_CV_SD, WITHIN_CV_FLOOR, WITHIN_CV_CEILING,
  HUMAN_STEP_MEAN, HUMAN_STEP_SD, STEP_FLOOR, STEP_CEILING,
  MIN_NOTES, MIN_WITHIN_CV_SD, MIN_STEP_SD,
} from "../src/shape.js";

/* Two things are being guarded here and they are different.
 *
 * The first is the original point of the feature: a hundred notes must not all
 * land on the same number, so the tests that matter are about the DISTRIBUTION
 * of many targets rather than about any single one.
 *
 * The second is what this version added. The model now aims at two quantities
 * instead of one, because the single whole-note figure it used to aim at is a
 * mixture of them: across 108 human documents it correlates 0.448 and 0.384
 * with the two, while they correlate only 0.096 with EACH OTHER. Two targets
 * that move together would be one target wearing a disguise, so the
 * independence tests below are load bearing rather than thorough. */

const feed = (rows) => rows.reduce(
  (acc, [len, cv, step]) => ({ ...acc, ...accumulate(acc, len, cv, step) }), null);

const stats = (xs) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length - 1));
  return { mean, sd, distinct: new Set(xs).size };
};

test("running sums reproduce both means and both sds without keeping any history", () => {
  const cvs = [0.40, 0.45, 0.50, 0.55, 0.60];
  const steps = [0.20, 0.25, 0.30, 0.35, 0.40];
  const s = summarise(feed(cvs.map((cv, i) => [15, cv, steps[i]])));

  assert.equal(s.n, 5);
  assert.ok(Math.abs(s.meanLen - 15) < 1e-9);
  assert.ok(Math.abs(s.cvMean - 0.50) < 1e-9);
  assert.ok(Math.abs(s.stepMean - 0.30) < 1e-9);

  const sampleSd = (xs, m) =>
    Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
  assert.ok(Math.abs(s.cvSd - sampleSd(cvs, 0.50)) < 1e-9, `cv sd ${s.cvSd}`);
  assert.ok(Math.abs(s.stepSd - sampleSd(steps, 0.30)) < 1e-9, `step sd ${s.stepSd}`);
});

test("a variance that should be zero never comes back negative, for either measure", () => {
  // Identical values: floating point on the running sums can otherwise drive
  // sum_sq / n - mean^2 slightly below zero and produce NaN through sqrt.
  const s = summarise(feed(Array.from({ length: 40 }, () => [17, 0.46, 0.30])));
  for (const [k, v] of [["cvSd", s.cvSd], ["stepSd", s.stepSd]]) {
    assert.ok(v >= 0 && Number.isFinite(v) && v < 1e-6, `${k} is ${v}`);
  }
});

test("a technician with no history gets the human baseline, not a blank", () => {
  const t = targetFor(null, "sap", "note-1");
  assert.equal(t.source, "human baseline");
  assert.equal(t.n, 0);
  assert.ok(t.withinCv >= WITHIN_CV_FLOOR && t.withinCv <= WITHIN_CV_CEILING);
  assert.ok(t.stepRel >= STEP_FLOOR && t.stepRel <= STEP_CEILING);
  assert.ok(t.meanLen > 0);
});

test("their own numbers displace the baseline once there is enough evidence", () => {
  const thin = feed(Array.from({ length: MIN_NOTES - 1 }, () => [25, 0.58, 0.45]));
  assert.equal(targetFor(thin, "sap", "n").source, "human baseline");

  const enough = feed(Array.from({ length: MIN_NOTES }, () => [25, 0.58, 0.45]));
  const t = targetFor(enough, "sap", "n");
  assert.equal(t.source, "learned");
  assert.equal(t.meanLen, 25);
});

test("the spread waits for more evidence than the mean does", () => {
  // A standard deviation needs more data than an average. With exactly
  // MIN_NOTES the means are theirs but both spreads are still the human ones,
  // so a technician whose first five notes happened to be identical does not
  // get a spread of zero locked in.
  const five = feed(Array.from({ length: MIN_NOTES }, () => [20, 0.47, 0.31]));
  const cvs = Array.from({ length: 200 }, (_, i) => targetFor(five, "sap", "note" + i).withinCv);
  assert.ok(stats(cvs).distinct > 20, `spread collapsed to ${stats(cvs).distinct} targets`);
});

test("a hundred notes do NOT all land on the same target, which is the whole point", () => {
  const row = feed(Array.from({ length: 30 }, (_, i) => [18, 0.42 + (i % 7) * 0.02, 0.24 + (i % 5) * 0.03]));
  const targets = Array.from({ length: 100 }, (_, i) => targetFor(row, "bt", "note-" + i));

  for (const [label, xs] of [["withinCv", targets.map((t) => t.withinCv)],
                             ["stepRel", targets.map((t) => t.stepRel)]]) {
    const s = stats(xs);
    assert.ok(s.sd > 0.02, `${label} targets are too flat, sd ${s.sd}`);
    assert.ok(s.distinct > 50, `${label} targets repeat far too often`);
  }
});

test("every draw stays inside the range the corpus actually produced", () => {
  // A wide learned spread must not be allowed to emit a target no human wrote.
  const wild = feed(Array.from({ length: 40 }, (_, i) =>
    [18, i % 2 ? 0.34 : 0.68, i % 2 ? 0.11 : 0.57]));
  for (let i = 0; i < 500; i++) {
    const t = targetFor(wild, "sap", "x" + i);
    assert.ok(t.withinCv >= WITHIN_CV_FLOOR && t.withinCv <= WITHIN_CV_CEILING,
      `withinCv ${t.withinCv} outside the human range`);
    assert.ok(t.stepRel >= STEP_FLOOR && t.stepRel <= STEP_CEILING,
      `stepRel ${t.stepRel} outside the human range`);
  }
});

test("the two targets are drawn independently, because the corpus says they are", () => {
  /* THE TEST THIS VERSION EXISTS FOR. Within-section variability and the step
     between sections correlate at 0.096 across 108 human documents. If one draw
     moved the other, the model would be aiming at one quantity again and the
     whole change would be cosmetic. Hold everything constant except the step
     accumulators and the within-section target must not move at all, and then
     the same in reverse. */
  const base = Array.from({ length: 20 }, () => [18, 0.46, 0.30]);
  const shiftedStep = Array.from({ length: 20 }, () => [18, 0.46, 0.50]);
  const shiftedCv = Array.from({ length: 20 }, () => [18, 0.60, 0.30]);

  for (let i = 0; i < 40; i++) {
    const seed = "note-" + i;
    const a = targetFor(feed(base), "sap", seed);
    const b = targetFor(feed(shiftedStep), "sap", seed);
    const c = targetFor(feed(shiftedCv), "sap", seed);

    assert.equal(a.withinCv, b.withinCv,
      "moving the step profile moved the within-section target");
    assert.equal(a.stepRel, c.stepRel,
      "moving the within-section profile moved the step target");
    assert.notEqual(a.stepRel, b.stepRel, "the step target ignored its own profile");
    assert.notEqual(a.withinCv, c.withinCv, "the within-section target ignored its own profile");
  }
});

test("the same note always draws the same target", () => {
  // Reproducibility: a bug that only appears on some draws is not debuggable,
  // and a test cannot be written against Math.random.
  const row = feed(Array.from({ length: 20 }, (_, i) => [19, 0.40 + (i % 5) * 0.04, 0.20 + (i % 4) * 0.05]));
  assert.deepEqual(targetFor(row, "sap", "note-abc"), targetFor(row, "sap", "note-abc"));
  assert.notEqual(targetFor(row, "sap", "note-abc").withinCv, targetFor(row, "sap", "note-xyz").withinCv);
  assert.notEqual(targetFor(row, "sap", "note-abc").stepRel, targetFor(row, "sap", "note-xyz").stepRel);
});

test("mean length is kept per tool, because it belongs to the document class", () => {
  // The same person writes around 21 words a sentence academically and 12 in a
  // plan. One number per technician would learn the average of two things they
  // never write.
  const plan = feed(Array.from({ length: 10 }, () => [13, 0.46, 0.30]));
  const note = feed(Array.from({ length: 10 }, () => [21, 0.46, 0.30]));
  assert.equal(targetFor(plan, "sap", "s").meanLen, 13);
  assert.equal(targetFor(note, "bt", "s").meanLen, 21);
});

test("the instruction names BOTH halves, in words rather than coefficients", () => {
  /* Fails against the version this replaced, which is the point. That one only
     ever spoke about the note as a whole, and a note can satisfy a whole-note
     instruction while every section reads flat. */
  const block = renderShapeBlock(targetFor(null, "sap", "seed"));
  assert.match(block, /words per sentence/);
  assert.match(block, /INSIDE one section/);
  assert.match(block, /BETWEEN sections/);
  assert.match(block, /between roughly \d+ and \d+ words/);
  assert.match(block, /\d+(\.\d+)? words longer or shorter/);
  // A model cannot write toward a coefficient of variation, so it must never
  // appear as one.
  assert.doesNotMatch(block, /coefficient/i);
  assert.doesNotMatch(block, /\bCV\b/);
  assert.equal(renderShapeBlock(null), "");
});

test("the baseline constants are the measured ones", () => {
  /* If these drift, every target drifts with them and the corpus they came from
     is no longer what is being reproduced. All of them were computed with the
     exact tokenizer, word rule and section rule in note-metrics.js: measuring
     the corpus a second way is how the wrong numbers get shipped. */
  assert.equal(HUMAN_WITHIN_CV_MEAN, 0.465);
  assert.equal(HUMAN_WITHIN_CV_SD, 0.066);
  assert.equal(HUMAN_STEP_MEAN, 0.309);
  assert.equal(HUMAN_STEP_SD, 0.120);
  assert.ok(WITHIN_CV_FLOOR < HUMAN_WITHIN_CV_MEAN && HUMAN_WITHIN_CV_MEAN < WITHIN_CV_CEILING);
  assert.ok(STEP_FLOOR < HUMAN_STEP_MEAN && HUMAN_STEP_MEAN < STEP_CEILING);
});

test("a technician whose own spread is zero still gets a varied target", () => {
  // The degenerate case that would otherwise reintroduce the exact flatness
  // this feature exists to remove: identical inputs, so a measured sd of zero,
  // so every note landing on one number. Both measures need the floor.
  const flat = feed(Array.from({ length: 40 }, () => [19, 0.46, 0.30]));
  const s = summarise(flat);
  assert.ok(s.cvSd < 1e-6 && s.stepSd < 1e-6, "the profile really is degenerate");

  const targets = Array.from({ length: 100 }, (_, i) => targetFor(flat, "sap", "n" + i));
  for (const [label, xs, floor] of [
    ["withinCv", targets.map((t) => t.withinCv), MIN_WITHIN_CV_SD],
    ["stepRel", targets.map((t) => t.stepRel), MIN_STEP_SD],
  ]) {
    const st = stats(xs);
    assert.ok(st.sd > floor / 2, `${label} collapsed to a single value, sd ${st.sd}`);
    assert.ok(st.distinct > 40, `${label} repeats far too often`);
  }
});
