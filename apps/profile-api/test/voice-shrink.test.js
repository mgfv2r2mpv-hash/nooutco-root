import test from "node:test";
import assert from "node:assert/strict";

import {
  housePrior, buildHousePrior, HOUSE_FEATURES, HOUSE_PRIOR, HOUSE_PROVENANCE,
  HOUSE_DIRECTION,
} from "../src/house-prior.js";
import {
  accumulateLevel, summariseLevel, authorTarget, authorTargets, planStyleMoves,
  countInBandMoves, OUT_OF_BAND, MOVES_PER_NOTE, BAND_SDS, GREAT_DAY_SDS,
} from "../src/voice-shrink.js";

/* What is being guarded, and it is three separate things.
 *
 * The arithmetic. Every shrinkage figure below is written out as a literal that
 * was computed away from this module, with the working in the comment above it.
 * Recomputing the formula inside the test and comparing the two would pin the
 * module against itself and would agree with any sign error made twice.
 *
 * The order of the three stages. Shrink, then clamp, then budget. The clamp
 * test does not merely assert that a clamp happened; it asserts the value the
 * OTHER order would have produced is not what came back, because both orders
 * clamp and only one of them is right.
 *
 * The ruling. A technician's observations move that technician's own estimate
 * and nothing else. The tests at the bottom drive every route an observation
 * could take into a house number and watch each one refuse.
 */

const near = (actual, expected, tol = 1e-12) =>
  assert.ok(Math.abs(actual - expected) < tol,
    `expected ${expected}, got ${actual}, difference ${Math.abs(actual - expected)}`);

const rowOf = (values) => values.reduce((acc, v) => accumulateLevel(acc, v), null);

/* ---- stage 1, shrinkage --------------------------------------------------- */

test("k is the ratio of the two variances, and it differs per feature on purpose", () => {
  // 0.004356 / 0.008712, 0.0144 / 0.0036, 0.09 / 0.09, 0.0004 / 0.0016
  assert.equal(housePrior("within_cv").k, 0.5);
  assert.equal(housePrior("step_rel").k, 4);
  assert.equal(housePrior("actor_naming").k, 1);
  assert.equal(housePrior("hedging").k, 0.25);

  // Four distinct values, so a test that passed by reading k as a constant
  // would fail on three of the four features.
  assert.equal(new Set(HOUSE_FEATURES.map((f) => housePrior(f).k)).size, 4);
});

test("shrinkage is pinned against arithmetic done by hand", () => {
  /* within_cv. house 0.465, k 0.5, this author n = 3 at mean 0.58.
   *   w  = 3 / (3 + 0.5) = 6/7 = 0.8571428571428571
   *   d  = 0.58 - 0.465  = 0.115
   *   wd = 0.115 * 6 / 7 = 0.69 / 7 = 0.09857142857142857
   *   0.465 + 0.09857142857142857 = 0.5635714285714285         */
  const cv = authorTarget("within_cv", { n: 3, sum: 1.74, sum_sq: 1.0092 });
  near(cv.w, 0.8571428571428571);
  near(cv.shrunk, 0.5635714285714285);
  near(cv.value, 0.5635714285714285); // inside [0.336, 0.600], nothing to clamp
  assert.equal(cv.clamped, false);

  /* step_rel. house 0.309, k 4, this author n = 4 at mean 0.20.
   *   w = 4 / (4 + 4) = 0.5
   *   0.309 + 0.5 * (0.20 - 0.309) = 0.309 - 0.0545 = 0.2545                  */
  const step = authorTarget("step_rel", { n: 4, sum: 0.8, sum_sq: 0.17 });
  near(step.w, 0.5);
  near(step.shrunk, 0.2545);

  /* actor_naming. house 0.85, k 1, this author n = 2 at mean 1.05.
   *   w = 2 / (2 + 1) = 0.6666666666666666
   * This is the ONE feature with a better end, so since 2026-09-21 its author
   * term is their great day and not their mean. The three features around it
   * in this test still pin the plain arithmetic, which is the no-offset
   * property checked by literal rather than by assertion.
   *   pop var  = 2.25 / 2 - 1.05^2 = 1.125 - 1.1025 = 0.0225
   *   sample sd = sqrt(0.0225 * 2 / 1) = sqrt(0.045) = 0.21213203435596426
   *   offset   = 1 * w * sd = (2/3) * 0.21213203435596426 = 0.1414213562373095
   *   greatDay = 1.05 + 0.1414213562373095 = 1.1914213562373095
   *   0.85 + (2/3) * (1.1914213562373095 - 0.85) = 1.0776142374915396
   * Before the term existed this read 0.9833333333333333; the difference is
   * (2/3)^2 * sd, the offset bought with evidence twice.                    */
  const actor = authorTarget("actor_naming", { n: 2, sum: 2.1, sum_sq: 2.25 });
  near(actor.w, 0.6666666666666666);
  near(actor.offset, 0.1414213562373095);
  near(actor.shrunk, 1.0776142374915396);
  assert.notEqual(actor.shrunk, 0.9833333333333333);

  /* hedging. house 0.012, k 0.25, this author n = 1 at mean 0.030.
   *   w = 1 / 1.25 = 0.8
   *   0.012 + 0.8 * 0.018 = 0.012 + 0.0144 = 0.0264                           */
  const hedge = authorTarget("hedging", { n: 1, sum: 0.03, sum_sq: 0.0009 });
  near(hedge.w, 0.8);
  near(hedge.shrunk, 0.0264);
});

test("n = 0 returns the house mean exactly, for every feature", () => {
  for (const feature of HOUSE_FEATURES) {
    const cold = authorTarget(feature, null);
    // Strict equality, not a tolerance. A cold author has bought no distance at
    // all, so the answer is the house number itself and not a float near it.
    assert.equal(cold.value, housePrior(feature).mean, feature);
    assert.equal(cold.shrunk, housePrior(feature).mean, feature);
    assert.equal(cold.w, 0, feature);
    assert.equal(cold.n, 0, feature);
    assert.equal(cold.authorMean, null, feature);
    assert.equal(cold.source, "house", feature);
  }
});

test("an empty row and a row of zeroes are both cold rather than an author at zero", () => {
  for (const row of [null, undefined, {}, { n: 0, sum: 0, sum_sq: 0 }, { n: -4 }, { n: "3" }]) {
    const cold = authorTarget("hedging", row);
    assert.equal(cold.value, 0.012, JSON.stringify(row));
    assert.equal(cold.source, "house", JSON.stringify(row));
    /* n and w are what a nonsense count actually corrupts. The VALUE survives a
       negative n by accident, because the house mean stands in whenever n is
       not above zero, so asserting only the value lets a count of -4 through
       carrying a weight of 1.07. */
    assert.equal(cold.n, 0, JSON.stringify(row));
    assert.equal(cold.w, 0, JSON.stringify(row));
  }
});

test("a fractional note count is truncated rather than used as it stands", () => {
  // 2.7 notes is not a thing. Truncated, this is two notes at a mean of 0.75.
  const t = authorTarget("actor_naming", { n: 2.7, sum: 1.5, sum_sq: 1.125 });
  assert.equal(t.n, 2);
  near(t.authorMean, 0.75);
  // w = 2 / (2 + 1) = 0.6666666666666666, and 0.85 + (2/3) * (0.75 - 0.85) =
  // 0.85 - 0.06666666666666667 = 0.7833333333333333
  near(t.shrunk, 0.7833333333333333);
});

test("large n returns the author's own mean within tolerance, and is still shrunk", () => {
  const many = authorTarget("within_cv", { n: 10000, sum: 5800, sum_sq: 3364 });
  near(many.value, 0.58, 1e-4);
  // w = 10000 / 10000.5 = 0.999950002499875, so 0.5799942502874855. Close to the
  // author's mean but not equal to it: shrinkage never stops, it only gets
  // cheap. An implementation that switched to the raw author mean past a
  // threshold would pass the line above and fail this one.
  assert.notEqual(many.value, 0.58);
  near(many.value, 0.5799942502874855);
  assert.equal(many.source, "shrunk");
});

/* ---- stage 2, the envelope ------------------------------------------------ */

test("a value outside the envelope clamps, in both directions", () => {
  // within_cv ceiling 0.600. n = 1000 at mean 0.95 shrinks to 0.9497576...,
  // which is above it.
  const high = authorTarget("within_cv", { n: 1000, sum: 950, sum_sq: 902.5 });
  near(high.shrunk, 0.9497576211894052, 1e-9);
  assert.equal(high.value, 0.600);
  assert.equal(high.clamped, true);

  /* hedging floor 0.004, and it is load bearing: an author whose every note is
     flat assertion must not be able to teach the tool never to mark an
     uncertain observation as uncertain. n = 1000 at mean 0 shrinks to about
     0.000003, well under the floor. */
  const flat = authorTarget("hedging", { n: 1000, sum: 0, sum_sq: 0 });
  assert.ok(flat.shrunk < 0.004, `shrunk ${flat.shrunk}`);
  assert.equal(flat.value, 0.004);
  assert.equal(flat.clamped, true);

  // actor_naming floor 0.40, the reporting barrier in numeric form.
  const actorless = authorTarget("actor_naming", { n: 500, sum: 0, sum_sq: 0 });
  assert.equal(actorless.value, 0.40);
});

test("the clamp is applied after shrinkage and not before", () => {
  /* Both orders clamp on this fixture, so "it clamped" proves nothing and the
     two answers are what separates them.
       shrink then clamp: 0.465 + (1/1.5) * (0.95 - 0.465) = 0.788333..., over
                          the 0.600 ceiling, so 0.600.
       clamp then shrink: 0.95 clamps to 0.600 first, then 0.465 + (1/1.5) *
                          (0.600 - 0.465) = 0.465 + 0.09 = 0.555.
     0.555 is inside the envelope and would never look wrong. */
  const one = authorTarget("within_cv", { n: 1, sum: 0.95, sum_sq: 0.9025 });
  near(one.shrunk, 0.7883333333333333);
  assert.equal(one.value, 0.600);
  assert.notEqual(Math.round(one.value * 1000) / 1000, 0.555);
});

test("every house mean sits inside its own envelope, so a cold author is never clamped", () => {
  for (const feature of HOUSE_FEATURES) {
    const p = housePrior(feature);
    assert.ok(p.floor <= p.mean && p.mean <= p.ceiling, feature);
    assert.equal(authorTarget(feature, null).clamped, false, feature);
  }
});

test("the band is clipped to the envelope, so a draft outside it is never called fine", () => {
  // Target on the ceiling. Unclipped, the band would reach 0.666 and a draft at
  // 0.65, which is outside anything the house writes, would read as in band.
  const high = authorTarget("within_cv", { n: 1000, sum: 950, sum_sq: 902.5 });
  assert.equal(high.value, 0.600);
  assert.equal(high.band[1], 0.600);
  near(high.band[0], 0.534); // 0.600 - 0.066

  const plan = planStyleMoves({ targets: [high], measured: { within_cv: 0.65 } });
  assert.equal(plan.spent, 1);
  assert.equal(plan.moves[0].direction, -1);
});

/* ---- stage 3, the style budget -------------------------------------------- */

const profileRows = {
  within_cv: { n: 20, sum: 20 * 0.52, sum_sq: 20 * 0.52 * 0.52 },
  step_rel: { n: 20, sum: 20 * 0.26, sum_sq: 20 * 0.26 * 0.26 },
  actor_naming: { n: 20, sum: 20 * 0.95, sum_sq: 20 * 0.95 * 0.95 },
  hedging: { n: 20, sum: 20 * 0.02, sum_sq: 20 * 0.02 * 0.02 },
};

test("a draft already matching the profile spends nothing and the in band counter is zero", () => {
  const targets = authorTargets(profileRows);
  const measured = {};
  for (const t of targets) measured[t.feature] = t.value;

  const plan = planStyleMoves({ targets, measured });
  assert.deepEqual(plan.moves, []);
  assert.equal(plan.spent, 0);
  assert.equal(plan.inBandMoves, 0);
  assert.deepEqual(plan.inBand.slice().sort(), HOUSE_FEATURES.slice().sort());
  assert.deepEqual(plan.unmeasured, []);
});

test("a draft sitting anywhere inside the band is left alone too", () => {
  const targets = authorTargets(profileRows);
  const measured = {};
  // Just inside each edge, alternating, so the test is not passing on the
  // centre point alone.
  targets.forEach((t, i) => {
    const edge = i % 2 ? t.band[1] : t.band[0];
    measured[t.feature] = edge + (i % 2 ? -1e-6 : 1e-6);
  });

  const plan = planStyleMoves({ targets, measured });
  assert.equal(plan.spent, 0);
  assert.equal(plan.inBandMoves, 0);
});

test("a move is spent only where the draft sits outside the band", () => {
  const targets = authorTargets(profileRows);
  const byName = Object.fromEntries(targets.map((t) => [t.feature, t]));
  const measured = {
    within_cv: byName.within_cv.value,               // in band
    step_rel: byName.step_rel.band[1] + 0.05,        // over
    actor_naming: byName.actor_naming.band[0] - 0.2, // under
    hedging: byName.hedging.value,                   // in band
  };

  const plan = planStyleMoves({ targets, measured });
  assert.equal(plan.spent, 2);
  assert.equal(plan.inBandMoves, 0);
  assert.deepEqual(plan.moves.map((m) => m.feature).sort(), ["actor_naming", "step_rel"]);
  assert.deepEqual(plan.inBand.slice().sort(), ["hedging", "within_cv"]);

  const step = plan.moves.find((m) => m.feature === "step_rel");
  assert.equal(step.direction, -1);
  assert.equal(plan.moves.find((m) => m.feature === "actor_naming").direction, 1);
});

test("the budget caps the moves and spends them on what is furthest out", () => {
  const targets = authorTargets(profileRows);
  const byName = Object.fromEntries(targets.map((t) => [t.feature, t]));
  // All four out of band, at 4, 3, 2 and 1 band widths past the edge, so the
  // ranking has a known answer rather than whatever the scales happen to give.
  const measured = {
    within_cv: byName.within_cv.band[1] + 2 * byName.within_cv.halfWidth,
    step_rel: byName.step_rel.band[1] + 4 * byName.step_rel.halfWidth,
    actor_naming: byName.actor_naming.band[0] - 3 * byName.actor_naming.halfWidth,
    hedging: byName.hedging.band[1] + 1 * byName.hedging.halfWidth,
  };

  /* Furthest out first, by band widths: step_rel 4, actor_naming 3,
     within_cv 2, hedging 1. The claim under test is the ranking and the cap,
     not the size of the budget, so the expectation is SLICED by the constant
     rather than written out. Spelling the answer as a literal made this test
     fail the day Kaleb ruled the budget down, which told him nothing about the
     ranking and cost a suite run to read. */
  const ranked = ["step_rel", "actor_naming", "within_cv", "hedging"];

  const plan = planStyleMoves({ targets, measured });
  assert.equal(plan.budget, MOVES_PER_NOTE);
  assert.equal(plan.spent, MOVES_PER_NOTE);
  assert.equal(plan.inBandMoves, 0);
  assert.deepEqual(plan.moves.map((m) => m.feature), ranked.slice(0, MOVES_PER_NOTE));
  assert.deepEqual(plan.withheld, ranked.slice(MOVES_PER_NOTE));
});

test("ranking is by band widths out and not by the raw distance", () => {
  /* hedging is measured in hedges per word and moves in thousandths;
     actor_naming is per sentence and moves in tenths. A raw distance would put
     actor_naming first every time regardless of how far out either really is.
     Here hedging is 3 band widths out (0.06 raw) and actor_naming is 1 (0.30
     raw), so a raw sort and a normalised sort disagree. */
  const targets = authorTargets(profileRows);
  const byName = Object.fromEntries(targets.map((t) => [t.feature, t]));
  const measured = {
    hedging: byName.hedging.band[1] + 3 * byName.hedging.halfWidth,
    actor_naming: byName.actor_naming.band[1] + 1 * byName.actor_naming.halfWidth,
  };

  const plan = planStyleMoves({ targets, measured, budget: 1 });
  assert.equal(plan.moves[0].feature, "hedging");
  assert.ok(plan.moves[0].excess < 0.30, `raw excess ${plan.moves[0].excess}`);
});

test("a feature the draft did not measure gets no move and is not called in band", () => {
  const targets = authorTargets(profileRows);
  const plan = planStyleMoves({ targets, measured: { within_cv: NaN, step_rel: 0.26 } });

  assert.deepEqual(plan.unmeasured.slice().sort(), ["actor_naming", "hedging", "within_cv"]);
  assert.ok(!plan.inBand.includes("within_cv"));
  assert.ok(!plan.moves.some((m) => m.feature === "within_cv"));
});

test("a target with an unusable band is refused with a reason, not dropped", () => {
  /* Found by reading rather than by a test. Every comparison against NaN is
     false, so such a target earned no move, was not in band and was not
     unmeasured: it was in no list at all, and a plan missing a feature entirely
     looks exactly like a plan that had nothing to say about it. */
  const good = { feature: "aaa", value: 0.5, band: [0.4, 0.6], halfWidth: 0.1 };
  const nanBand = { feature: "bbb", value: 0.5, band: [NaN, NaN], halfWidth: NaN };
  const noBand = { feature: "ccc", value: 0.5, halfWidth: 0.1 };

  const plan = planStyleMoves({
    targets: [good, nanBand, noBand, null],
    measured: { aaa: 0.9, bbb: 0.9, ccc: 0.9 },
  });

  assert.deepEqual(plan.moves.map((m) => m.feature), ["aaa"]);
  assert.deepEqual(plan.refused.map((r) => r.feature), ["bbb", "ccc", null]);
  for (const r of plan.refused) assert.match(r.why, /band/);
  // And a clean plan says nothing was refused, so the list is readable as a
  // fault rather than as noise.
  assert.deepEqual(planStyleMoves({ targets: [good], measured: { aaa: 0.5 } }).refused, []);
});

test("an unmeasured feature earns no move even under a rule that spends everywhere", () => {
  /* Under the real rule a NaN fails the band comparison anyway, so the skip
     looks redundant and its removal broke nothing. It is not redundant: the
     spend rule decides among features the draft actually measured, and a rule
     that says yes to everything would otherwise emit a move against a number
     that does not exist. */
  const targets = authorTargets(profileRows);
  const measured = {};
  for (const t of targets) measured[t.feature] = t.value;
  delete measured.hedging;

  const plan = planStyleMoves({ targets, measured, budget: 9, spendWhere: () => true });
  assert.deepEqual(plan.unmeasured, ["hedging"]);
  assert.ok(!plan.moves.some((m) => m.feature === "hedging"));
  assert.equal(plan.spent, 3);
});

test("a budget of zero spends nothing and reports everything it withheld", () => {
  const targets = authorTargets(profileRows);
  const byName = Object.fromEntries(targets.map((t) => [t.feature, t]));
  const measured = { within_cv: byName.within_cv.band[1] + 0.2 };

  const plan = planStyleMoves({ targets, measured, budget: 0 });
  assert.equal(plan.spent, 0);
  assert.deepEqual(plan.withheld, ["within_cv"]);
  assert.equal(plan.inBandMoves, 0);
});

test("an exact tie is broken by the name, so the order targets arrive in cannot decide it", () => {
  /* A tie has to be exact to test a tie break, and two real features never are:
     an earlier version of this test put two features "two band widths out" and
     the float residue separated them, so it was passing on an accident and the
     tie break could be deleted without a test moving. These two are built to
     produce byte identical arithmetic. */
  const a = { feature: "aaa", value: 0.5, band: [0.4, 0.6], halfWidth: 0.1 };
  const z = { feature: "zzz", value: 0.5, band: [0.4, 0.6], halfWidth: 0.1 };
  const measured = { aaa: 0.75, zzz: 0.75 };

  const forward = planStyleMoves({ targets: [a, z], measured, budget: 1 });
  const backward = planStyleMoves({ targets: [z, a], measured, budget: 1 });

  assert.equal(forward.moves[0].excess, backward.moves[0].excess); // a real tie
  assert.equal(forward.moves[0].feature, "aaa");
  assert.equal(backward.moves[0].feature, "aaa");
});

test("the same plan comes back twice, so a move is reproducible", () => {
  const targets = authorTargets(profileRows);
  const byName = Object.fromEntries(targets.map((t) => [t.feature, t]));
  const measured = {
    within_cv: byName.within_cv.band[1] + 2 * byName.within_cv.halfWidth,
    hedging: byName.hedging.band[1] + 2 * byName.hedging.halfWidth,
  };
  const first = planStyleMoves({ targets, measured, budget: 1 });
  const second = planStyleMoves({ targets, measured, budget: 1 });
  assert.deepEqual(first.moves.map((m) => m.feature), second.moves.map((m) => m.feature));
});

test("the audit the caller reads is wired to the moves, shown by making it fire", () => {
  /* Every real plan reports zero here, so "it reported zero" cannot tell a live
     counter from the literal zero. Replacing the whole expression with 0 broke
     no test until this one existed. Injecting a spend rule that spends
     everywhere is the only way to put a move that was already fine into the
     list and watch the number the caller reads notice. */
  const targets = authorTargets(profileRows);
  const measured = {};
  for (const t of targets) measured[t.feature] = t.value; // every one already right

  const honest = planStyleMoves({ targets, measured });
  assert.equal(honest.spent, 0);
  assert.equal(honest.inBandMoves, 0);

  const spendthrift = planStyleMoves({ targets, measured, spendWhere: () => true });
  assert.equal(spendthrift.spent, MOVES_PER_NOTE);
  assert.equal(spendthrift.inBandMoves, MOVES_PER_NOTE);
  // Which is the reading that matters: three moves spent, three of them wasted
  // on a note that already read like the person about to sign it.
});

test("the spend rule is out of band and nothing else", () => {
  assert.equal(OUT_OF_BAND(0.5, [0.4, 0.6]), false);
  assert.equal(OUT_OF_BAND(0.4, [0.4, 0.6]), false); // on the edge is in
  assert.equal(OUT_OF_BAND(0.6, [0.4, 0.6]), false);
  assert.equal(OUT_OF_BAND(0.39, [0.4, 0.6]), true);
  assert.equal(OUT_OF_BAND(0.61, [0.4, 0.6]), true);
});

test("the in band audit can come back non zero, which is what makes its zero worth reading", () => {
  /* The counter used to live inside planStyleMoves, where the filter above it
     guaranteed the answer. Deleting its body broke no test, because a check
     that can only report zero reads exactly like one that never ran. */
  const inBand = { feature: "aaa", measured: 0.5, band: [0.4, 0.6] };
  const outside = { feature: "zzz", measured: 0.9, band: [0.4, 0.6] };

  assert.equal(countInBandMoves([inBand]), 1);
  assert.equal(countInBandMoves([inBand, outside, inBand]), 2);
  assert.equal(countInBandMoves([outside]), 0);
  assert.equal(countInBandMoves([]), 0);
  assert.equal(countInBandMoves(), 0);

  // On the edge is in band, the same rule the planner applies.
  assert.equal(countInBandMoves([{ measured: 0.4, band: [0.4, 0.6] }]), 1);
  assert.equal(countInBandMoves([{ measured: 0.6, band: [0.4, 0.6] }]), 1);
});

test("planStyleMoves survives being called with nothing", () => {
  const plan = planStyleMoves();
  assert.deepEqual(plan.moves, []);
  assert.equal(plan.inBandMoves, 0);
  assert.equal(plan.budget, MOVES_PER_NOTE);
});

/* ---- the accumulators ----------------------------------------------------- */

test("running sums reproduce the mean and the sample sd without keeping history", () => {
  const values = [0.40, 0.45, 0.50, 0.55, 0.60];
  const s = summariseLevel(rowOf(values));

  assert.equal(s.n, 5);
  near(s.mean, 0.50);
  // Sample sd of that set, written out: deviations -0.10 -0.05 0 0.05 0.10,
  // squares 0.01 0.0025 0 0.0025 0.01, sum 0.025, over n-1 = 4 is 0.00625,
  // square root 0.07905694150420949.
  near(s.sd, 0.07905694150420949, 1e-9);
});

test("a single note has no spread, and an identical run never comes back negative", () => {
  assert.equal(summariseLevel(rowOf([0.5])).sd, 0);

  /* 0.1 three times is the fixture, and it had to be hunted for. sum_sq / n -
     mean * mean lands at -1.7e-18 there, so an unguarded square root returns
     NaN. Driven through planStyleMoves, a NaN band puts the feature in NEITHER
     list: not in band, not moved, not unmeasured. It vanishes from the plan
     without a word. Four notes at 0.47 happened to come out at exactly zero, so
     the first version of this test was watching a fixture that could not
     fail. */
  const flat = summariseLevel(rowOf([0.1, 0.1, 0.1]));
  assert.ok(Number.isFinite(flat.sd), `sd ${flat.sd}`);
  assert.ok(flat.sd >= 0, `sd ${flat.sd}`);
  assert.ok(flat.sd < 1e-9);
});

test("a measurement that is not a number is dropped rather than counted as zero", () => {
  let row = null;
  for (const v of [0.5, NaN, 0.5, undefined, null, "0.9", Infinity]) row = accumulateLevel(row, v);
  assert.equal(row.n, 2);
  near(summariseLevel(row).mean, 0.5);
});

test("an empty row summarises as cold rather than as a mean of zero", () => {
  assert.deepEqual(summariseLevel(null), { n: 0, mean: null, sd: null });
  assert.deepEqual(summariseLevel({}), { n: 0, mean: null, sd: null });
});

/* ---- the ruling: technician observations cannot reach the house prior ------ */

test("housePrior takes a feature name and nothing else", () => {
  assert.equal(housePrior.length, 1);

  // Every route an observation could ride in on.
  assert.throws(() => housePrior("within_cv", { kid: "abc", observations: [0.9] }), /nothing else/);
  assert.throws(() => housePrior("within_cv", 0.9), /nothing else/);
  assert.throws(() => housePrior({ feature: "within_cv", authorMean: 0.9 }), /feature name/);
  assert.throws(() => housePrior(["within_cv"]), /feature name/);
  assert.throws(() => housePrior(null), /feature name/);
  assert.throws(() => housePrior(), /nothing else/);
  assert.throws(() => housePrior("technician_mean"), /no house prior/);
});

test("the prior a caller gets back cannot be edited", () => {
  const p = housePrior("within_cv");
  assert.throws(() => { p.mean = 0.9; }, TypeError);
  assert.throws(() => { HOUSE_PRIOR.within_cv = { mean: 0.9 }; }, TypeError);
  assert.equal(housePrior("within_cv").mean, 0.465);
});

test("a corpus entry sourced from a technician is refused, by provenance", () => {
  const legal = {
    feature: "made_up", label: "x", mean: 0.5, within_var: 0.01, between_var: 0.01,
    floor: 0, ceiling: 1, provenance: "bcba_authored", basis: "test",
    direction: "none",
  };
  // The control: this entry builds, so every refusal below is about the one
  // thing it changed and not about the entry being malformed.
  assert.equal(buildHousePrior([legal]).made_up.mean, 0.5);

  for (const provenance of ["technician", "technician_mean", "pooled", "", null, undefined]) {
    assert.throws(
      () => buildHousePrior([{ ...legal, provenance }]),
      /provenance is not one the house accepts/,
      String(provenance));
  }
  assert.ok(!HOUSE_PROVENANCE.includes("technician"));
});

test("a corpus entry carrying an author is refused, whatever it calls the field", () => {
  const legal = {
    feature: "made_up", label: "x", mean: 0.5, within_var: 0.01, between_var: 0.01,
    floor: 0, ceiling: 1, provenance: "bcba_authored", basis: "test",
    direction: "none",
  };
  /* The allowlist is what makes this work on a field nobody has thought of yet.
     A denylist would have to already know the name. */
  for (const key of ["kid", "author", "technician", "observations", "events", "n", "sum", "whatever"]) {
    assert.throws(
      () => buildHousePrior([{ ...legal, [key]: "x" }]),
      /key the house does not define/,
      key);
  }
});

test("the house prior cannot be built out of author rows at all", () => {
  // A plausible attempt: hand it the shape the per author store actually holds.
  const authorRows = [
    { kid: "a", tool: "bt", feature: "within_cv", n: 20, sum: 10.4, sum_sq: 5.4 },
    { kid: "b", tool: "bt", feature: "within_cv", n: 14, sum: 7.0, sum_sq: 3.5 },
  ];
  assert.throws(() => buildHousePrior(authorRows), TypeError);

  // And the collection forms a pooling implementation would reach for.
  assert.throws(() => buildHousePrior(null), /must be an array/);
  assert.throws(() => buildHousePrior({ within_cv: [0.5, 0.6] }), /must be an array/);
  assert.throws(() => buildHousePrior([[0.5, 0.6]]), /plain object/);
  assert.throws(() => buildHousePrior([null]), /plain object/);
  assert.throws(() => buildHousePrior(["within_cv"]), /plain object/);
});

test("a malformed house entry is refused rather than defaulted", () => {
  const legal = {
    feature: "made_up", label: "x", mean: 0.5, within_var: 0.01, between_var: 0.01,
    floor: 0, ceiling: 1, provenance: "bcba_authored", basis: "test",
    direction: "none",
  };
  assert.throws(() => buildHousePrior([{ ...legal, between_var: 0 }]), /between_var must be above zero/);
  assert.throws(() => buildHousePrior([{ ...legal, within_var: -1 }]), /within_var must be above zero/);
  assert.throws(() => buildHousePrior([{ ...legal, mean: "0.5" }]), /must be a finite number/);
  assert.throws(() => buildHousePrior([{ ...legal, mean: NaN }]), /must be a finite number/);
  assert.throws(() => buildHousePrior([{ ...legal, mean: 2 }]), /outside its own envelope/);
  assert.throws(() => buildHousePrior([{ ...legal, feature: "" }]), /non empty string/);
  assert.throws(() => buildHousePrior([legal, legal]), /declared twice/);

  const { label, ...noLabel } = legal;
  assert.throws(() => buildHousePrior([noLabel]), /missing label/);
});

test("one author's history moves that author's estimate and nobody else's", () => {
  const busy = { n: 5000, sum: 5000 * 0.59, sum_sq: 5000 * 0.59 * 0.59 };
  const loud = authorTarget("within_cv", busy);
  near(loud.value, 0.59, 1e-3);

  // Same feature, a second author with nothing. The house number they start
  // from is untouched by the five thousand notes above.
  const cold = authorTarget("within_cv", null);
  assert.equal(cold.value, 0.465);
  assert.equal(cold.houseMean, loud.houseMean);
  assert.equal(housePrior("within_cv").mean, 0.465);
});

test("the house prior is the same numbers whichever order authors are read in", () => {
  const before = HOUSE_FEATURES.map((f) => housePrior(f).mean);
  authorTargets({ within_cv: { n: 900, sum: 900 * 0.59, sum_sq: 900 * 0.59 * 0.59 } });
  authorTargets({ hedging: { n: 900, sum: 0, sum_sq: 0 } });
  const after = HOUSE_FEATURES.map((f) => housePrior(f).mean);
  assert.deepEqual(after, before);
});

test("every house feature declares a house provenance and a basis a reader can check", () => {
  assert.deepEqual(HOUSE_FEATURES.slice().sort(),
    ["actor_naming", "hedging", "step_rel", "within_cv"]);
  for (const feature of HOUSE_FEATURES) {
    const p = housePrior(feature);
    assert.ok(HOUSE_PROVENANCE.includes(p.provenance), feature);
    assert.ok(p.basis && p.basis.length > 10, feature);
  }
  assert.equal(BAND_SDS, 1);
});


/* ---- them on a great work day ----------------------------------------------
 *
 * Kaleb's ask, 2026-09-21. A great day is their own upper end, and ONLY for a
 * feature the house says has a better end. Every figure below was worked by
 * hand from the actor_naming entry (mean 0.85, k = 1, envelope [0.40, 1.30]).
 *
 * Rows are built so summariseLevel returns a chosen mean and SAMPLE sd exactly:
 * for n = 4, sum = 4m and sum_sq = 4 * (s^2 * 3/4) + 4 * m^2.
 */

const rowFor = (m, s) => ({ n: 4, sum: 4 * m, sum_sq: 4 * (s * s * 3 / 4) + 4 * m * m });

test("a first note buys no great-day offset at all, because one note has no spread", () => {
  const t = authorTarget("actor_naming", { n: 1, sum: 0.70, sum_sq: 0.49 });
  assert.equal(t.direction, "higher");
  assert.equal(t.offset, 0);
  // w = 1 / (1 + 1) = 0.5; shrunk = 0.85 + 0.5 * (0.70 - 0.85) = 0.775, unchanged
  // from the arithmetic before the great-day term existed.
  near(t.value, 0.775);
});

test("TWO AUTHORS WITH DIFFERENT MEANS GET DIFFERENT TARGETS at the same n, and the offset is off their OWN spread", () => {
  // The adversary this exists to catch: an offset pointed at the house mean
  // would pull the same way shrinkage does and converge everyone on the house.
  const a = authorTarget("actor_naming", rowFor(0.70, 0.10));
  const b = authorTarget("actor_naming", rowFor(0.95, 0.10));
  // w = 4 / (4 + 1) = 0.8; offset = 1 * 0.8 * 0.10 = 0.08 for both
  near(a.offset, 0.08);
  near(b.offset, 0.08);
  near(a.greatDay, 0.78);
  near(b.greatDay, 1.03);
  // a: 0.85 + 0.8 * (0.78 - 0.85) = 0.794     b: 0.85 + 0.8 * (1.03 - 0.85) = 0.994
  near(a.value, 0.794);
  near(b.value, 0.994);
  assert.notEqual(a.value, b.value);
  // And neither collapsed onto the house.
  assert.notEqual(a.value, 0.85);
  assert.notEqual(b.value, 0.85);
});

test("the offset is bought with evidence: same spread, fewer notes, smaller offset", () => {
  const four = authorTarget("actor_naming", rowFor(0.70, 0.10));
  // n = 2 with the same sample sd 0.10: sum_sq = 2 * (0.01 * 1/2) + 2 * 0.49 = 0.99
  const two = authorTarget("actor_naming", { n: 2, sum: 1.40, sum_sq: 0.99 });
  // w(2) = 2 / 3; offset = 0.10 * 2/3 = 0.0666...
  near(two.offset, 0.10 * 2 / 3);
  assert.ok(two.offset < four.offset, "fewer notes must buy a smaller offset");
});

test("A PERSONAL FEATURE GETS NO OFFSET, so its target is the arithmetic from before, to the digit", () => {
  for (const feature of ["hedging", "within_cv", "step_rel"]) {
    const prior = housePrior(feature);
    assert.equal(prior.direction, "none", feature);
    const row = rowFor(prior.mean + 0.5 * Math.sqrt(prior.within_var), Math.sqrt(prior.within_var));
    const t = authorTarget(feature, row);
    assert.equal(t.offset, 0, feature + " must carry no great-day offset");
    // Recomputed the OLD way, independently, with no offset in it.
    const w = 4 / (4 + prior.k);
    const old = prior.mean + w * (t.authorMean - prior.mean);
    near(t.shrunk, old);
  }
});

test("the clamp is still last: a great day past the ceiling is clamped, and the other order gives a different number", () => {
  const t = authorTarget("actor_naming", rowFor(1.25, 0.30));
  // offset = 0.8 * 0.30 = 0.24; greatDay = 1.49; shrunk = 0.85 + 0.8 * 0.64 = 1.362
  near(t.greatDay, 1.49);
  near(t.shrunk, 1.362);
  assert.equal(t.value, 1.30);
  assert.equal(t.clamped, true);
  // Clamping the author term FIRST and shrinking second would give
  // 0.85 + 0.8 * (1.30 - 0.85) = 1.21, which is not what came back.
  assert.notEqual(t.value, 1.21);
});

test("the great-day width is one band, so a great day sits at the top of the range already called theirs", () => {
  assert.equal(GREAT_DAY_SDS, BAND_SDS);
});

test("direction is a closed enum, and a third value is refused rather than admitted with a sign flip", () => {
  assert.deepEqual([...HOUSE_DIRECTION], ["higher", "none"]);
  const base = { ...HOUSE_PRIOR.actor_naming };
  delete base.k;
  for (const bad of ["lower", "up", 1, true, null, undefined]) {
    assert.throws(() => buildHousePrior([{ ...base, direction: bad }]),
      /direction is not one the house accepts/, "direction " + String(bad));
  }
  // And it cannot be left off: the allowlist requires every key.
  const missing = { ...base };
  delete missing.direction;
  assert.throws(() => buildHousePrior([missing]), /missing direction/);
});

test("every house feature declares a direction, and exactly one of them has a better end", () => {
  const higher = HOUSE_FEATURES.filter((f) => housePrior(f).direction === "higher");
  assert.deepEqual(higher, ["actor_naming"]);
  for (const f of HOUSE_FEATURES) assert.ok(HOUSE_DIRECTION.includes(housePrior(f).direction), f);
});

test("a cold author reports no great day, and a warm one reports the term the target was built from", () => {
  assert.equal(authorTarget("actor_naming", null).greatDay, null);
  assert.equal(authorTarget("actor_naming", null).offset, 0);
  const t = authorTarget("actor_naming", rowFor(0.70, 0.10));
  near(t.greatDay, t.authorMean + t.offset);
});
