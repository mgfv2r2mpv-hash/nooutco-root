// Serial-dependence and cyclicity diagnostics.
//
// These exist for two jobs the rest of the engine cannot do on its own.
//
// First, a slope reversal across a phase line is a correlation signal in
// clinical work, and a cyclical series can manufacture one that is not there.
// A behavior that runs in a weekly cycle will show a "reversal" wherever the
// phase line happens to fall, so the tool has to be able to say when an
// apparent reversal sits inside an oscillation it cannot distinguish from one.
//
// Second, Fisher, Kelley & Lomas (2003) built the conservative dual-criteria
// variant precisely because serial dependence inflates the plain method's Type I
// error, citing Crosbie (1987) that "the accuracy of the binomial test is
// decreased markedly by the presence of serial dependence". A lag-1
// autocorrelation on the baseline is therefore a direct statement about how far
// the CDC verdict can be trusted.
(function () {
  "use strict";

  var S = window.GVA_STATS;

  // Kendall's turning point test needs enough points to have an expectation
  // worth comparing against. Below this it reports unavailable rather than a
  // z-score computed from three points.
  var MIN_TURNING_POINTS_N = 8;
  var MIN_AUTOCORR_N = 6;
  var Z_95 = 1.959963985;

  // A turning point is a local peak or trough. In a random series the count has
  // a known expectation, so an excess of them is rapid alternation rather than
  // noise around a trend.
  function turningPoints(values) {
    var n = values.length;
    if (n < MIN_TURNING_POINTS_N) {
      return { available: false, reason: "needs at least " + MIN_TURNING_POINTS_N + " points" };
    }
    var count = 0;
    for (var i = 1; i < n - 1; i++) {
      var a = values[i - 1];
      var b = values[i];
      var c = values[i + 1];
      if ((b > a && b > c) || (b < a && b < c)) count++;
    }
    var expected = (2 * (n - 2)) / 3;
    var variance = (16 * n - 29) / 90;
    var sd = variance > 0 ? Math.sqrt(variance) : NaN;
    var z = S.isNum(sd) && sd > 0 ? (count - expected) / sd : NaN;
    return {
      available: true,
      count: count,
      expected: expected,
      sd: sd,
      z: z,
      // More turning points than chance is alternation; fewer is a trend or a
      // run structure. Only the excess side concerns a reversal reading.
      oscillating: S.isNum(z) && z > Z_95,
    };
  }

  // Sample autocorrelation at a given lag.
  function autocorrelation(values, lag) {
    var n = values.length;
    if (n < MIN_AUTOCORR_N || lag < 1 || lag >= n) {
      return { available: false, reason: "series too short for lag " + lag };
    }
    var m = S.mean(values);
    var denom = 0;
    for (var i = 0; i < n; i++) denom += (values[i] - m) * (values[i] - m);
    if (denom === 0) return { available: false, reason: "no variance" };
    var num = 0;
    for (var j = 0; j < n - lag; j++) num += (values[j] - m) * (values[j + lag] - m);
    var r = num / denom;
    // Bartlett's approximate standard error under the white-noise null.
    var se = 1 / Math.sqrt(n);
    return {
      available: true,
      lag: lag,
      r: r,
      se: se,
      significant: Math.abs(r) > Z_95 * se,
    };
  }

  // Does this phase look cyclical enough that a slope reversal at its boundary
  // could be an artifact of where the phase line fell?
  //
  // Two independent signatures, either of which is enough to warrant the
  // caution: an excess of turning points, or the alternation signature of a
  // negative lag-1 with a positive lag-2.
  function cyclicality(values) {
    var tp = turningPoints(values);
    var r1 = autocorrelation(values, 1);
    var r2 = autocorrelation(values, 2);

    // Any short series of noise around a level produces a negative lag-1, so
    // the bare sign is not evidence of a cycle. Reading it as one told a flat
    // baseline of 20,22,19,21,20,23 that it "swings fast enough" to fake a
    // reversal, which suspended a clean correlational claim for nothing. The
    // signature now needs the same length floor the turning-point test uses and
    // a lag-1 that clears Bartlett, on top of the period-2 lag-2 term.
    var alternating =
      r1.available && r2.available &&
      values.length >= MIN_TURNING_POINTS_N &&
      r1.r < 0 && r1.significant && r2.r > 0.3;

    var available = tp.available || r1.available;
    return {
      available: available,
      turningPoints: tp,
      lag1: r1,
      lag2: r2,
      alternating: alternating,
      cyclical: !!(tp.oscillating || alternating),
      // Serial dependence in its own right, which is what undermines the CDC
      // binomial rather than what fakes a reversal.
      seriallyDependent: r1.available && r1.significant,
    };
  }

  // Caution entries, composed from whichever signature fired. Each carries a
  // stable `kind` so callers and tests can name the signature without matching
  // on prose, a reading written for an analyst, and the arithmetic behind it.
  // The caller decides whether to show them; this only says what is true.
  function describe(cyc, phaseName) {
    if (!cyc.available) return [];
    var r2 = function (v) { return Math.round(v * 100) / 100; };
    var out = [];
    if (cyc.turningPoints.available && cyc.turningPoints.oscillating) {
      out.push({
        kind: "oscillation",
        text: phaseName + " swings up and down " + cyc.turningPoints.count + " times where about " +
          (Math.round(cyc.turningPoints.expected * 10) / 10) + " would be ordinary. A behavior that bounces " +
          "this fast will appear to turn around wherever a phase line happens to be drawn, so treat the turn " +
          "above as provisional.",
        detail: "Kendall turning points " + cyc.turningPoints.count + " against " +
          (Math.round(cyc.turningPoints.expected * 10) / 10) + " expected, z = " + r2(cyc.turningPoints.z) + ".",
      });
    }
    if (cyc.alternating) {
      out.push({
        kind: "alternation",
        text: phaseName + " runs high, then low, then high again in a regular beat. Where a behavior cycles like " +
          "that, on a weekly pattern or a rotating schedule, an apparent turn can be the cycle arriving rather " +
          "than the plan working.",
        detail: "Alternation signature: lag-1 autocorrelation " + r2(cyc.lag1.r) + ", lag-2 " + r2(cyc.lag2.r) + ".",
      });
    }
    if (cyc.seriallyDependent && !cyc.cyclical) {
      out.push({
        kind: "serial-dependence",
        text: "Each session in " + phaseName + " predicts the next one fairly well, so its sessions are not " +
          "independent of one another. The two-line check assumes they are, so read its verdict with some slack.",
        detail: "Lag-1 autocorrelation " + r2(cyc.lag1.r) + "; Crosbie (1987) on binomial accuracy under serial dependence.",
      });
    }
    return out;
  }

  window.GVA_CYCLES = {
    turningPoints: turningPoints,
    autocorrelation: autocorrelation,
    cyclicality: cyclicality,
    describe: describe,
    CONST: { MIN_TURNING_POINTS_N: MIN_TURNING_POINTS_N, MIN_AUTOCORR_N: MIN_AUTOCORR_N },
  };
})();
