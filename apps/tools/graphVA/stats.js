// Pure statistics for single-case design visual analysis.
//
// Everything here is a total function over arrays of numbers: no DOM, no state,
// no direction defaults. Every index that has a published expected value is
// pinned in tests/graphva.spec.js against that published value rather than
// against a number this file produced.
//
// Direction convention, used by every comparison in this file:
//   "inc" - an increase is therapeutic (acquisition target)
//   "dec" - a decrease is therapeutic (reduction target)
//
// Sources are named at each function. Where sources disagree, the disagreement
// is encoded as an option rather than resolved silently.
(function () {
  "use strict";

  // --- constants -----------------------------------------------------------

  // Fisher, Kelley & Lomas (2003) raised both criterion lines by this many
  // baseline SDs to build the *conservative* dual-criteria variant, after the
  // plain DC method showed "unacceptably high" Type I error under
  // autocorrelation.
  var CDC_SHIFT_SD = 0.25;

  // Below this many treatment points the binomial cannot reach p < .05 even at
  // perfect separation, so CDC refuses rather than reporting a null result.
  var CDC_MIN_TX_POINTS = 5;

  // Fisher's OLS baseline line is unstable below this; scan's bisplit/trisplit
  // variants require it outright.
  var CDC_MIN_BASE_POINTS = 5;

  var ALPHA = 0.05;
  var Z_95 = 1.959963985;

  // Stability envelope half-width, as a proportion of the phase median.
  // Ledford & Gast (2018) is the most-cited version at 25%; published
  // applications also use 20% and 15%. Exposed as an option for that reason.
  var STABILITY_WIDTH = 0.25;
  var STABILITY_THRESHOLD = 0.8;

  // WWC v5.0 uses this NAP value for both its baseline-trend and its
  // reversibility screen. The handbook calls it "relatively arbitrary and
  // novel", intended as a low bar catching only egregious design problems.
  var WWC_NAP_THRESHOLD = 0.85;

  // --- descriptive ---------------------------------------------------------

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }

  function clean(values) {
    return (values || []).filter(isNum);
  }

  function sum(values) {
    return values.reduce(function (a, b) { return a + b; }, 0);
  }

  function mean(values) {
    return values.length ? sum(values) / values.length : NaN;
  }

  function median(values) {
    if (!values.length) return NaN;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // Sample SD (n-1). Fisher does not specify the divisor for the CDC shift;
  // n-1 is used here and named in the tool's output so the choice is visible.
  function sd(values) {
    if (values.length < 2) return NaN;
    var m = mean(values);
    var ss = values.reduce(function (acc, v) { return acc + (v - m) * (v - m); }, 0);
    return Math.sqrt(ss / (values.length - 1));
  }

  // Median absolute deviation, scaled to be a consistent SD estimator under
  // normality. Robust companion to the Theil-Sen slope.
  function mad(values) {
    if (!values.length) return NaN;
    var med = median(values);
    var devs = values.map(function (v) { return Math.abs(v - med); });
    return 1.4826 * median(devs);
  }

  function range(values) {
    if (!values.length) return { min: NaN, max: NaN };
    return { min: Math.min.apply(null, values), max: Math.max.apply(null, values) };
  }

  // Only meaningful on ratio-scale strictly-positive data, and explosive as the
  // mean approaches zero. Callers gate on scale before displaying it.
  function cv(values) {
    var m = mean(values);
    return m === 0 ? NaN : sd(values) / m;
  }

  // --- trend ---------------------------------------------------------------

  function line(slope, intercept) {
    return {
      slope: slope,
      intercept: intercept,
      at: function (t) { return intercept + slope * t; },
    };
  }

  // Ordinary least squares over t = 0..n-1. Zero breakdown point: one outlier
  // moves it arbitrarily far. Retained because Fisher et al. (2003) used OLS
  // for the CDC trend line, so CDC fidelity requires it.
  function ols(values) {
    var n = values.length;
    if (n < 2) return null;
    var tBar = (n - 1) / 2;
    var yBar = mean(values);
    var num = 0;
    var den = 0;
    for (var i = 0; i < n; i++) {
      num += (i - tBar) * (values[i] - yBar);
      den += (i - tBar) * (i - tBar);
    }
    if (den === 0) return null;
    var slope = num / den;
    return line(slope, yBar - slope * tBar);
  }

  // Theil-Sen: median of all pairwise slopes. ~29.3% breakdown point, ~0.86
  // asymptotic efficiency against OLS under normal errors. This is the default
  // drawn trend because behavioral series are short, bounded and spiky, and it
  // is the estimator underneath Tarlow's (2017) baseline-corrected Tau.
  function theilSen(values) {
    var n = values.length;
    if (n < 2) return null;
    var slopes = [];
    for (var i = 0; i < n - 1; i++) {
      for (var j = i + 1; j < n; j++) {
        slopes.push((values[j] - values[i]) / (j - i));
      }
    }
    var slope = median(slopes);
    var intercepts = values.map(function (v, i) { return v - slope * i; });
    return line(slope, median(intercepts));
  }

  // Split-middle (White, 1974; White & Haring, 1980). Halves by time with the
  // middle point excluded when n is odd, median x and median y per half, then
  // the vertical slide that puts at least half the points on each side - here
  // by zeroing the median residual, which is what the slide achieves.
  // Offered for familiarity; it is not the inferential estimator.
  function splitMiddle(values) {
    var n = values.length;
    if (n < 4) return null;
    var half = Math.floor(n / 2);
    var xs1 = [];
    var xs2 = [];
    for (var i = 0; i < half; i++) xs1.push(i);
    for (var j = n - half; j < n; j++) xs2.push(j);
    var x1 = median(xs1);
    var x2 = median(xs2);
    if (x1 === x2) return null;
    var y1 = median(values.slice(0, half));
    var y2 = median(values.slice(n - half));
    var slope = (y2 - y1) / (x2 - x1);
    var raw = y1 - slope * x1;
    var residuals = values.map(function (v, k) { return v - (raw + slope * k); });
    return line(slope, raw + median(residuals));
  }

  // Cheap leverage detector: when the robust and least-squares slopes disagree
  // on sign, a single point is probably driving the trend.
  function trendSignConflict(values) {
    var ts = theilSen(values);
    var o = ols(values);
    if (!ts || !o) return false;
    if (ts.slope === 0 || o.slope === 0) return false;
    return (ts.slope > 0) !== (o.slope > 0);
  }

  // --- overlap -------------------------------------------------------------

  // Nonoverlap of All Pairs (Parker & Vannest, 2009), scored in the
  // therapeutic direction. Ties score 0.5. This is the index WWC v5.0 itself
  // uses for its baseline-trend and reversibility screens.
  function napValue(baseline, treatment, direction) {
    var m = baseline.length;
    var n = treatment.length;
    if (!m || !n) return NaN;
    var better = 0;
    for (var i = 0; i < m; i++) {
      for (var j = 0; j < n; j++) {
        var b = treatment[j];
        var a = baseline[i];
        if (b === a) better += 0.5;
        else if (direction === "dec" ? b < a : b > a) better += 1;
      }
    }
    return better / (m * n);
  }

  // Hanley & McNeil (1982) SE for the area under the curve, which NAP is.
  function napSeHanley(nap, m, n) {
    if (!isNum(nap) || !m || !n) return NaN;
    var q1 = nap / (2 - nap);
    var q2 = (2 * nap * nap) / (1 + nap);
    var v = (nap * (1 - nap) + (n - 1) * (q1 - nap * nap) + (m - 1) * (q2 - nap * nap)) / (m * n);
    return v > 0 ? Math.sqrt(v) : 0;
  }

  // Null-hypothesis SE, used for the significance screen rather than the CI.
  function napSeNull(m, n) {
    if (!m || !n) return NaN;
    return Math.sqrt((m + n + 1) / (12 * m * n));
  }

  // CI on the logit scale so the interval respects the [0,1] bound - a Wald
  // interval on a NAP near 1.0 runs past it. NAP is nudged off the boundary by
  // half a pair before transforming, and `clamped` records that it happened.
  function napCI(nap, m, n) {
    var se = napSeHanley(nap, m, n);
    if (!isNum(se) || !m || !n) return { low: NaN, high: NaN, clamped: false };
    var step = 0.5 / (m * n);
    var p = Math.min(1 - step, Math.max(step, nap));
    var clamped = p !== nap;
    var seLogit = se / (p * (1 - p));
    var l = Math.log(p / (1 - p));
    var lo = l - Z_95 * seLogit;
    var hi = l + Z_95 * seLogit;
    var inv = function (x) { return 1 / (1 + Math.exp(-x)); };
    return { low: inv(lo), high: inv(hi), clamped: clamped };
  }

  // Exact one-tailed Mann-Whitney p-value by dynamic programming over the null
  // distribution of U. This exists because the Hanley-McNeil standard error is
  // exactly zero at complete separation, which collapses the interval to a
  // point precisely when the phases are shortest and the reader most needs to
  // see sampling noise. The exact p does not degenerate, and on short phases it
  // makes the argument the interval cannot: three baseline points against three
  // treatment points cannot beat p = .05 even when every pair separates.
  //
  // Exact only when there are no ties across phases; with ties the rank
  // distribution is not the untied one, so this reports unavailable rather than
  // a p-value that looks exact and is not.
  var MW_MAX_CELLS = 2000;

  function mannWhitneyExact(baseline, treatment, direction) {
    var m = baseline.length;
    var n = treatment.length;
    if (!m || !n) return { available: false, reason: "empty phase" };
    if (m * n > MW_MAX_CELLS) {
      return { available: false, reason: "phase product above the exact-test limit" };
    }
    var tied = baseline.some(function (a) {
      return treatment.some(function (b) { return a === b; });
    });
    if (tied) return { available: false, reason: "tied values across phases" };

    // U counts treatment-beats-baseline pairs in the therapeutic direction.
    var U = 0;
    for (var i = 0; i < m; i++) {
      for (var j = 0; j < n; j++) {
        var beats = direction === "dec" ? treatment[j] < baseline[i] : treatment[j] > baseline[i];
        if (beats) U += 1;
      }
    }

    // Null distribution of U by the standard recurrence
    //   f(i, j, u) = f(i-1, j, u-j) + f(i, j-1, u)
    // which counts partitions of u into at most j parts each at most i. Only
    // two baseline layers are held at once, so memory stays flat in m.
    var maxU = m * n;
    var prev = [];
    var cur = [];
    var j;
    var u;
    // i = 0: one arrangement, U = 0, for every j.
    for (j = 0; j <= n; j++) {
      var row = new Float64Array(maxU + 1);
      row[0] = 1;
      prev.push(row);
    }
    for (var i = 1; i <= m; i++) {
      cur = [];
      var zero = new Float64Array(maxU + 1);
      zero[0] = 1; // j = 0
      cur.push(zero);
      for (j = 1; j <= n; j++) {
        var next = new Float64Array(maxU + 1);
        var top = Math.min(maxU, i * j);
        for (u = 0; u <= top; u++) {
          var fromBaseline = u - j >= 0 ? prev[j][u - j] : 0;
          next[u] = fromBaseline + cur[j - 1][u];
        }
        cur.push(next);
      }
      prev = cur;
    }
    var counts = prev[n];

    var total = 0;
    for (var q = 0; q <= maxU; q++) total += counts[q];
    if (!(total > 0) || !isFinite(total)) {
      return { available: false, reason: "null distribution underflowed" };
    }

    var tail = 0;
    for (var w = U; w <= maxU; w++) tail += counts[w];

    return {
      available: true,
      U: U,
      p: Math.min(1, tail / total),
      // The best p this phase pairing could ever produce, i.e. at perfect
      // separation. When this is above .05 the phases are too short to speak,
      // whatever the data look like.
      pFloor: counts[maxU] / total,
    };
  }

  function nap(baseline, treatment, direction) {
    var m = baseline.length;
    var n = treatment.length;
    var value = napValue(baseline, treatment, direction);
    var ci = napCI(value, m, n);
    var se = napSeHanley(value, m, n);
    // Complete separation drives the Hanley SE to zero. The interval is then
    // not informative and must not be printed as though it were tight.
    var degenerate = !isNum(se) || se === 0 || value === 0 || value === 1;
    return {
      value: value,
      m: m,
      n: n,
      se: se,
      seNull: napSeNull(m, n),
      ciLow: ci.low,
      ciHigh: ci.high,
      ciClamped: ci.clamped,
      ciDegenerate: degenerate,
      exact: mannWhitneyExact(baseline, treatment, direction),
      // Rescaling only. Same properties, same limitations.
      tau: isNum(value) ? 2 * value - 1 : NaN,
    };
  }

  // Percentage of Nonoverlapping Data (Scruggs, Mastropieri & Casto, 1987).
  // Depends entirely on one order statistic, so a single extreme baseline point
  // destroys it, and its expected value shrinks as the baseline lengthens even
  // when nothing else changes. No sampling distribution exists, so no CI.
  function pnd(baseline, treatment, direction) {
    if (!baseline.length || !treatment.length) return NaN;
    var r = range(baseline);
    var bound = direction === "dec" ? r.min : r.max;
    var beyond = treatment.filter(function (v) {
      return direction === "dec" ? v < bound : v > bound;
    }).length;
    return beyond / treatment.length;
  }

  // Percent Exceeding the Median (Ma, 2006). Ceilings almost immediately and
  // ignores baseline variability entirely.
  function pem(baseline, treatment, direction) {
    if (!baseline.length || !treatment.length) return NaN;
    var med = median(baseline);
    var score = treatment.reduce(function (acc, v) {
      if (v === med) return acc + 0.5;
      return acc + ((direction === "dec" ? v < med : v > med) ? 1 : 0);
    }, 0);
    return score / treatment.length;
  }

  // Proportion of treatment points inside the baseline range. Descriptive.
  function overlapProportion(baseline, treatment) {
    if (!baseline.length || !treatment.length) return NaN;
    var r = range(baseline);
    var inside = treatment.filter(function (v) { return v >= r.min && v <= r.max; }).length;
    return inside / treatment.length;
  }

  // Tau-U with baseline trend correction (Parker, Vannest, Davis & Sauber,
  // 2011). Computed because clinicians expect it from singlecaseresearch.org,
  // and reported behind its own warning: Tarlow (2017) showed the trend control
  // yields unacceptable Type I error, the statistic is not bounded to [-1,1]
  // because its feasible range moves with phase length, it has no valid
  // sampling distribution, and it cannot be drawn on the graph.
  function tauU(baseline, treatment, direction) {
    var m = baseline.length;
    var n = treatment.length;
    if (!m || !n) return NaN;
    var sgn = function (x) { return x > 0 ? 1 : x < 0 ? -1 : 0; };
    var flip = direction === "dec" ? -1 : 1;
    var ab = 0;
    for (var i = 0; i < m; i++) {
      for (var j = 0; j < n; j++) ab += sgn(treatment[j] - baseline[i]) * flip;
    }
    var aa = 0;
    for (var p = 0; p < m - 1; p++) {
      for (var q = p + 1; q < m; q++) aa += sgn(baseline[q] - baseline[p]) * flip;
    }
    return (ab - aa) / (m * n);
  }

  // --- magnitude -----------------------------------------------------------

  // Log response ratio (Pustejovsky, 2018). Preferred magnitude index for
  // count/rate data because it is insensitive to session length and sample
  // size, where every nonoverlap index is not.
  //
  // `D` is Pustejovsky's truncation constant, which depends on outcome scale
  // and measurement procedure. I could not verify its per-scale numeric
  // definitions to primary source, so it is a caller-supplied parameter and the
  // tool prints the value in use. When a phase mean is zero and no D was
  // supplied, this returns unavailable rather than inventing a floor.
  function lrr(baseline, treatment, direction, options) {
    var opts = options || {};
    var m = baseline.length;
    var n = treatment.length;
    if (m < 1 || n < 1) return { available: false, reason: "empty phase" };

    var mA = mean(baseline);
    var mB = mean(treatment);
    if (mA < 0 || mB < 0) {
      return { available: false, reason: "LRR requires a ratio scale with a true zero" };
    }

    var D = isNum(opts.D) && opts.D > 0 ? opts.D : null;
    if ((mA === 0 || mB === 0) && !D) {
      return {
        available: false,
        reason: "a phase mean is zero and no truncation constant was supplied",
      };
    }

    var floorA = D ? 1 / (2 * D * m) : 0;
    var floorB = D ? 1 / (2 * D * n) : 0;
    var yA = Math.max(mA, floorA);
    var yB = Math.max(mB, floorB);
    if (yA <= 0 || yB <= 0) {
      return { available: false, reason: "truncated mean is not positive" };
    }

    var vA = m > 1 ? Math.pow(sd(baseline), 2) : 0;
    var vB = n > 1 ? Math.pow(sd(treatment), 2) : 0;
    if (D) {
      vA = Math.max(vA, 1 / (D * D * Math.pow(m, 3)));
      vB = Math.max(vB, 1 / (D * D * Math.pow(n, 3)));
    }

    // Delta-method bias correction, as in SingleCaseES's default.
    var est = Math.log(yB) + vB / (2 * n * yB * yB) - Math.log(yA) - vA / (2 * m * yA * yA);
    var se = Math.sqrt(vA / (m * yA * yA) + vB / (n * yB * yB));

    // LRRi is signed so that positive means improvement; LRRd flips it. For
    // counts and rates the two differ only in sign.
    var signed = direction === "dec" ? -est : est;

    return {
      available: true,
      raw: est,
      value: signed,
      se: se,
      ciLow: signed - Z_95 * se,
      ciHigh: signed + Z_95 * se,
      // Same interpretation as raw percent change from baseline, but it
      // inherits the CI and the bias correction, so it replaces it.
      pctChange: 100 * (Math.exp(est) - 1),
      D: D,
    };
  }

  // --- binomial and CDC ----------------------------------------------------

  function logChoose(n, k) {
    var s = 0;
    for (var i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
    return s;
  }

  // P(X >= k | n, p = 0.5)
  function binomTailGE(k, n) {
    var s = 0;
    for (var i = k; i <= n; i++) s += Math.exp(logChoose(n, i) - n * Math.LN2);
    return Math.min(1, s);
  }

  // Smallest k with an exact one-tailed p < alpha. Returns null when no k
  // qualifies, which is every n below 5 - that null is the tool's refusal
  // trigger, and it is arithmetic rather than a chosen threshold.
  function cdcCriticalExact(n, alpha) {
    var a = isNum(alpha) ? alpha : ALPHA;
    for (var k = 0; k <= n; k++) {
      if (binomTailGE(k, n) < a) return k;
    }
    return null;
  }

  // Fisher, Kelley & Lomas (2003) Table 1 as published, for n = 5..23. These
  // track a normal approximation (z = 1.645, no continuity correction) rather
  // than an exact test, and they disagree with the exact test at n = 7, 10, 12,
  // 17, 19, 20, 21, 22 and 23. Offered so a reader reproducing the paper gets
  // the paper's numbers; the exact test is the default.
  var FISHER_TABLE_1 = {
    5: 5, 6: 6, 7: 6, 8: 7, 9: 8, 10: 8, 11: 9, 12: 9, 13: 10, 14: 11,
    15: 12, 16: 12, 17: 12, 18: 13, 19: 13, 20: 14, 21: 14, 22: 15, 23: 15,
  };

  function cdcCritical(n, mode, alpha) {
    if (mode === "fisher") {
      return Object.prototype.hasOwnProperty.call(FISHER_TABLE_1, n) ? FISHER_TABLE_1[n] : null;
    }
    return cdcCriticalExact(n, alpha);
  }

  // Conservative dual-criteria method (Fisher, Kelley & Lomas, 2003).
  //
  // Both criterion lines come from the baseline: its mean, and its OLS trend
  // extended forward across the treatment phase. The conservative variant
  // shifts both by 0.25 baseline SD toward the therapeutic direction. A
  // treatment point counts only when it beats BOTH lines.
  //
  // Returns the lines as well as the verdict so the chart can draw exactly what
  // the statistic tested - the visual and the number never disagree.
  function cdc(baseline, treatment, direction, options) {
    var opts = options || {};
    var conservative = opts.conservative !== false;
    var mode = opts.criticalMode === "fisher" ? "fisher" : "exact";
    var m = baseline.length;
    var n = treatment.length;

    var out = {
      available: false,
      reason: null,
      m: m,
      n: n,
      conservative: conservative,
      criticalMode: mode,
    };

    if (m < CDC_MIN_BASE_POINTS) {
      out.reason = "needs at least " + CDC_MIN_BASE_POINTS + " baseline points for a stable trend line";
      return out;
    }
    if (n < CDC_MIN_TX_POINTS) {
      out.reason = "below " + CDC_MIN_TX_POINTS + " treatment points the binomial cannot reach p < .05 even at perfect separation";
      return out;
    }

    var trend = ols(baseline);
    if (!trend) {
      out.reason = "baseline trend line is undefined";
      return out;
    }

    var baseSd = sd(baseline);
    var shift = conservative && isNum(baseSd) ? CDC_SHIFT_SD * baseSd : 0;
    var toward = direction === "dec" ? -1 : 1;
    var meanLine = mean(baseline) + toward * shift;

    // Baseline occupies t = 0..m-1, so treatment point j sits at t = m + j.
    var trendAt = function (j) { return trend.at(m + j) + toward * shift; };

    var beats = function (v, j) {
      return direction === "dec"
        ? v < meanLine && v < trendAt(j)
        : v > meanLine && v > trendAt(j);
    };

    var k = treatment.reduce(function (acc, v, j) { return acc + (beats(v, j) ? 1 : 0); }, 0);
    var critical = cdcCritical(n, mode, opts.alpha);

    out.available = critical !== null;
    if (critical === null) {
      out.reason = "no critical value is available for n = " + n + " in " + mode + " mode";
    }
    out.k = k;
    out.critical = critical;
    out.p = binomTailGE(k, n);
    out.positive = critical !== null && k >= critical;
    out.shift = toward * shift;
    out.meanLine = meanLine;
    out.trendSlope = trend.slope;
    out.trendAt = trendAt;
    out.baselineSd = baseSd;
    return out;
  }

  // --- stability -----------------------------------------------------------

  // Envelope criterion (Ledford & Gast, 2018). Default half-width is 25% of the
  // phase median with an 80% threshold; published applications also use 20% and
  // 15%, so width is a parameter and the tool displays the value in use.
  //
  // When `trendLine` is supplied the envelope rides the trend instead of a flat
  // median (Gast & Spriggs, 2014), because a strongly trending phase can be
  // perfectly predictable and still fail the flat-median rule.
  function stability(values, options) {
    var opts = options || {};
    var width = isNum(opts.width) ? opts.width : STABILITY_WIDTH;
    var threshold = isNum(opts.threshold) ? opts.threshold : STABILITY_THRESHOLD;
    var n = values.length;
    if (!n) return { available: false, reason: "empty phase" };

    var med = median(values);
    var half = Math.abs(med) * width;
    var trendLine = opts.trendLine || null;

    var within = values.filter(function (v, i) {
      var center = trendLine ? trendLine.at(i) : med;
      return Math.abs(v - center) <= half + 1e-9;
    }).length;

    var spread = sd(values);
    // WWC v5.0: a phase of 3+ points with no within-phase variability carries
    // enough information on its own, and it is the one case where n = 3 earns
    // the top rating.
    var zeroVariability = n >= 3 && (spread === 0 || (n > 1 && spread < 1e-12));

    // A percentage-of-median envelope collapses below the measurement grain on
    // low integer counts: a median of 3 gives a half-width of 0.75, so no value
    // other than the median itself can sit inside it and the criterion reports
    // near-zero stability for reasons that have nothing to do with the
    // behavior. Callers surface this instead of printing the proportion alone.
    var integerData = values.every(function (v) { return Math.floor(v) === v; });
    var subGrain = integerData && half < 1;

    return {
      available: true,
      median: med,
      halfWidth: half,
      width: width,
      threshold: threshold,
      integerData: integerData,
      subGrain: subGrain,
      lower: (trendLine ? null : med - half),
      upper: (trendLine ? null : med + half),
      trended: !!trendLine,
      proportion: within / n,
      stable: zeroVariability || within / n >= threshold,
      zeroVariability: zeroVariability,
    };
  }

  // WWC v5.0 baseline-trend screen: NAP of the last three baseline points
  // against the rest of that baseline, scored in the therapeutic direction.
  // At or below 0.85 means minimal therapeutic trend.
  function wwcBaselineTrend(baseline, direction) {
    var n = baseline.length;
    if (n < 4) {
      return { available: false, reason: "needs at least 4 baseline points to split last-3 against the rest" };
    }
    var rest = baseline.slice(0, n - 3);
    var last = baseline.slice(n - 3);
    var value = napValue(rest, last, direction);
    return {
      available: true,
      nap: value,
      threshold: WWC_NAP_THRESHOLD,
      minimalTrend: value <= WWC_NAP_THRESHOLD,
    };
  }

  // WWC v5.0 reversibility screen: NAP of the initial baseline against a
  // return-to-baseline phase, in the direction of the expected effect. At or
  // below 0.85 means minimal reversibility was achieved. Failing it does not
  // disqualify a record, it caps the rating.
  function wwcReversibility(initialBaseline, returnPhase, direction) {
    if (!initialBaseline.length || !returnPhase.length) {
      return { available: false, reason: "empty phase" };
    }
    var value = napValue(initialBaseline, returnPhase, direction);
    return {
      available: true,
      nap: value,
      threshold: WWC_NAP_THRESHOLD,
      reversed: value <= WWC_NAP_THRESHOLD,
    };
  }

  // WWC's own operationalization of immediacy: the last three points of one
  // phase against the first three of the next.
  function immediacy(baseline, treatment, direction) {
    if (baseline.length < 1 || treatment.length < 1) {
      return { available: false, reason: "empty phase" };
    }
    var last = baseline.slice(-3);
    var first = treatment.slice(0, 3);
    var mLast = mean(last);
    var mFirst = mean(first);
    var delta = mFirst - mLast;
    return {
      available: true,
      lastThree: last,
      firstThree: first,
      lastMean: mLast,
      firstMean: mFirst,
      delta: delta,
      therapeutic: direction === "dec" ? delta < 0 : delta > 0,
      // WWC flags a long latency between onset and change as a *non-effect*.
      partial: last.length < 3 || first.length < 3,
    };
  }

  window.GVA_STATS = {
    // descriptive
    isNum: isNum,
    clean: clean,
    mean: mean,
    median: median,
    sd: sd,
    mad: mad,
    range: range,
    cv: cv,
    // trend
    ols: ols,
    theilSen: theilSen,
    splitMiddle: splitMiddle,
    trendSignConflict: trendSignConflict,
    // overlap
    nap: nap,
    napValue: napValue,
    napCI: napCI,
    mannWhitneyExact: mannWhitneyExact,
    pnd: pnd,
    pem: pem,
    overlapProportion: overlapProportion,
    tauU: tauU,
    // magnitude
    lrr: lrr,
    // binomial / CDC
    logChoose: logChoose,
    binomTailGE: binomTailGE,
    cdcCritical: cdcCritical,
    cdcCriticalExact: cdcCriticalExact,
    cdc: cdc,
    FISHER_TABLE_1: FISHER_TABLE_1,
    // phase screens
    stability: stability,
    immediacy: immediacy,
    wwcBaselineTrend: wwcBaselineTrend,
    wwcReversibility: wwcReversibility,
    // constants, exported so the UI can print the value it used
    CONST: {
      CDC_SHIFT_SD: CDC_SHIFT_SD,
      CDC_MIN_TX_POINTS: CDC_MIN_TX_POINTS,
      CDC_MIN_BASE_POINTS: CDC_MIN_BASE_POINTS,
      STABILITY_WIDTH: STABILITY_WIDTH,
      STABILITY_THRESHOLD: STABILITY_THRESHOLD,
      WWC_NAP_THRESHOLD: WWC_NAP_THRESHOLD,
      ALPHA: ALPHA,
    },
  };
})();
