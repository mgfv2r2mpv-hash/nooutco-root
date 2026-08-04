import test from "node:test";
import assert from "node:assert/strict";

import {
  accumulate, summarise, targetFor, renderShapeBlock,
  HUMAN_CV_MEAN, HUMAN_CV_SD, CV_FLOOR, CV_CEILING, MIN_NOTES, MIN_CV_SD,
} from "../src/shape.js";

/* The point of this feature is that a hundred notes should not all land on the
 * same number. So the tests that matter are the ones about the DISTRIBUTION of
 * many targets, not about any single one. */

const feed = (values) => values.reduce(
  (row, [len, cv]) => ({ ...row, ...accumulate(row, len, cv) }), null);

test("running sums reproduce mean and sd without keeping any history", () => {
  const cvs = [0.50, 0.55, 0.60, 0.65, 0.70];
  const row = feed(cvs.map((cv) => [15, cv]));
  const s = summarise(row);

  assert.equal(s.n, 5);
  assert.ok(Math.abs(s.cvMean - 0.60) < 1e-9);
  assert.ok(Math.abs(s.meanLen - 15) < 1e-9);

  // Sample sd of that set, computed independently.
  const m = 0.60;
  const expected = Math.sqrt(cvs.reduce((a, x) => a + (x - m) ** 2, 0) / (cvs.length - 1));
  assert.ok(Math.abs(s.cvSd - expected) < 1e-9, `${s.cvSd} vs ${expected}`);
});

test("a variance that should be zero never comes back negative", () => {
  // Identical values: floating point on the running sums can otherwise drive
  // sum_cv_sq / n - mean^2 slightly below zero and produce NaN through sqrt.
  const s = summarise(feed(Array.from({ length: 40 }, () => [17, 0.6])));
  assert.ok(s.cvSd >= 0);
  assert.ok(Number.isFinite(s.cvSd));
  assert.ok(s.cvSd < 1e-6);
});

test("a technician with no history gets the human baseline, not a blank", () => {
  const t = targetFor(null, "sap", "note-1");
  assert.equal(t.source, "human baseline");
  assert.equal(t.n, 0);
  assert.ok(t.cv >= CV_FLOOR && t.cv <= CV_CEILING);
  assert.ok(t.meanLen > 0);
});

test("their own numbers displace the baseline once there is enough evidence", () => {
  const thin = feed(Array.from({ length: MIN_NOTES - 1 }, () => [25, 0.9]));
  assert.equal(targetFor(thin, "sap", "n").source, "human baseline");

  const enough = feed(Array.from({ length: MIN_NOTES }, () => [25, 0.9]));
  const t = targetFor(enough, "sap", "n");
  assert.equal(t.source, "learned");
  assert.equal(t.meanLen, 25);
});

test("the spread waits for more evidence than the mean does", () => {
  // A standard deviation needs more data than an average. With exactly
  // MIN_NOTES the mean is theirs but the spread is still the human one, so a
  // technician whose first five notes happened to be identical does not get a
  // spread of zero locked in.
  const five = feed(Array.from({ length: MIN_NOTES }, () => [20, 0.7]));
  const targets = Array.from({ length: 200 }, (_, i) => targetFor(five, "sap", "note" + i).cv);
  const distinct = new Set(targets).size;
  assert.ok(distinct > 20, `spread collapsed to ${distinct} distinct targets`);
});

test("a hundred notes do NOT all land on the same target, which is the whole point", () => {
  const row = feed(Array.from({ length: 30 }, (_, i) => [18, 0.55 + (i % 7) * 0.02]));
  const cvs = Array.from({ length: 100 }, (_, i) => targetFor(row, "bt", "note-" + i).cv);

  const mean = cvs.reduce((a, b) => a + b, 0) / cvs.length;
  const sd = Math.sqrt(cvs.reduce((a, b) => a + (b - mean) ** 2, 0) / (cvs.length - 1));

  assert.ok(sd > 0.02, `targets are too flat, sd ${sd}`);
  assert.ok(new Set(cvs).size > 50, "targets repeat far too often");
});

test("every draw stays inside the observed human range", () => {
  // A wide spread must not be allowed to emit a target no human produced.
  const wild = feed(Array.from({ length: 40 }, (_, i) => [18, i % 2 ? 0.40 : 0.95]));
  for (let i = 0; i < 500; i++) {
    const t = targetFor(wild, "sap", "x" + i);
    assert.ok(t.cv >= CV_FLOOR, `${t.cv} below floor`);
    assert.ok(t.cv <= CV_CEILING, `${t.cv} above ceiling`);
  }
});

test("the same note always draws the same target", () => {
  // Reproducibility: a bug that only appears on some draws is not debuggable,
  // and a test cannot be written against Math.random.
  const row = feed(Array.from({ length: 20 }, (_, i) => [19, 0.5 + (i % 5) * 0.05]));
  assert.deepEqual(targetFor(row, "sap", "note-abc"), targetFor(row, "sap", "note-abc"));
  assert.notEqual(targetFor(row, "sap", "note-abc").cv, targetFor(row, "sap", "note-xyz").cv);
});

test("mean length is kept per tool, because it belongs to the document class", () => {
  // The same person writes 20.9 words a sentence academically and 13.0 in a
  // plan. One number per technician would learn the average of two things they
  // never write.
  const plan = feed(Array.from({ length: 10 }, () => [13, 0.6]));
  const note = feed(Array.from({ length: 10 }, () => [21, 0.6]));
  assert.equal(targetFor(plan, "sap", "s").meanLen, 13);
  assert.equal(targetFor(note, "bt", "s").meanLen, 21);
});

test("the instruction is in words, not in a coefficient", () => {
  const block = renderShapeBlock(targetFor(null, "sap", "seed"));
  assert.match(block, /words per sentence/);
  assert.match(block, /between roughly \d+ and \d+ words/);
  // A model cannot write toward a CV, so the number must never appear as one.
  assert.doesNotMatch(block, /coefficient/i);
  assert.doesNotMatch(block, /\bCV\b/);
  assert.equal(renderShapeBlock(null), "");
});

test("the baseline constants are the measured ones", () => {
  // If these drift, every target drifts with them and the corpus they came from
  // is no longer what is being reproduced.
  assert.equal(HUMAN_CV_MEAN, 0.583);
  assert.equal(HUMAN_CV_SD, 0.088);
  assert.ok(CV_FLOOR < HUMAN_CV_MEAN && HUMAN_CV_MEAN < CV_CEILING);
});

test("a technician whose own spread is zero still gets a varied target", () => {
  // The degenerate case that would otherwise reintroduce the exact flatness
  // this feature exists to remove: identical inputs, so a measured sd of zero,
  // so every note landing on one number.
  const flat = feed(Array.from({ length: 40 }, () => [19, 0.6]));
  assert.ok(summarise(flat).cvSd < 1e-6, "the profile really is degenerate");

  const cvs = Array.from({ length: 100 }, (_, i) => targetFor(flat, "sap", "n" + i).cv);
  const mean = cvs.reduce((a, b) => a + b, 0) / cvs.length;
  const sd = Math.sqrt(cvs.reduce((a, b) => a + (b - mean) ** 2, 0) / (cvs.length - 1));

  assert.ok(sd > MIN_CV_SD / 2, `targets collapsed to a single value, sd ${sd}`);
  assert.ok(new Set(cvs).size > 40, "targets repeat far too often");
});
