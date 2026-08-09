// The verdict: two axes, computed separately.
//
// Axis 1, the finding, answers "is this client progressing" and is governed by
// the treatment phase. Axis 2, causal strength, answers "did the intervention
// cause it" and is computed in design.js from structure alone. Keeping them
// apart is the whole point: a strong nonoverlap statistic on an AB graph is
// evidence of change, and it is not evidence of a functional relation.
//
// All rationale text is composed from computed facts. No model call is made
// here, so the same record always yields the same words.
//
// Every rationale entry carries two registers. `text` is the reading, written
// for an analyst who works in visual analysis and not in statistics: it names
// what the data did and what that licenses, and it can be read end to end
// without meeting an index name or a p-value. `detail` is the arithmetic that
// produced it, kept for anyone defending the record to a funder or a reviewer.
// The tool never explains behavior-analytic practice back to the analyst.
(function () {
  "use strict";

  var S = window.GVA_STATS;
  var D = window.GVA_DESIGN;

  // Below 3 treatment points nothing inferential renders. Below 5 the CDC
  // binomial cannot reach p < .05 even at perfect separation, so the finding
  // stays "In Treatment" and the tool shows the interval instead of a verdict.
  var TX_REFUSE_HARD = 3;
  var TX_REFUSE_SOFT = S.CONST.CDC_MIN_TX_POINTS;

  // Parker & Vannest (2009) put the weak/medium boundary here. Used as a
  // supporting signal, never on its own.
  var NAP_MEDIUM = 0.66;
  var NAP_STRONG = 0.93;
  var NAP_NULL = 0.5;

  var FINDING = {
    PROGRESSING: "Progressing",
    NOT_PROGRESSING: "Not Progressing",
    IN_TREATMENT: "In Treatment",
    NONE: "No finding",
  };

  function r1(v) { return S.isNum(v) ? (Math.round(v * 10) / 10).toFixed(1) : "n/a"; }
  function r2(v) { return S.isNum(v) ? (Math.round(v * 100) / 100).toFixed(2) : "n/a"; }
  function r3(v) { return S.isNum(v) ? (Math.round(v * 1000) / 1000).toFixed(3) : "n/a"; }
  function pct(v) { return S.isNum(v) ? Math.round(v * 100) + "%" : "n/a"; }
  function signed(v, f) { return S.isNum(v) ? (v > 0 ? "+" : "") + (f || r1)(v) : "n/a"; }

  // Small slopes vanish at one decimal, so the precision follows the size.
  function mag(v) {
    if (!S.isNum(v)) return "n/a";
    var m = Math.abs(v);
    return m >= 1 ? r1(m) : r2(m);
  }

  // A p-value said as a frequency. "1 record in 340" is a quantity an analyst
  // can weigh; ".003" is a quantity a statistician can weigh.
  function oneIn(p) {
    if (!S.isNum(p) || p <= 0) return "fewer than 1 record in 1000";
    if (p >= 0.5) return "about 1 record in 2";
    var n = Math.round(1 / p);
    if (n >= 1000) return "fewer than 1 record in 1000";
    if (n >= 100) n = Math.round(n / 10) * 10;
    return "about 1 record in " + n;
  }

  function sessions(n) { return n + " session" + (n === 1 ? "" : "s"); }

  // One rationale entry: the reading, and optionally the arithmetic under it.
  function line(text, detail) {
    return detail ? { text: text, detail: detail } : { text: text };
  }

  // A method's own `reason` string opens lowercase, because it was written to
  // sit after a colon. It now opens a sentence of its own.
  function sentence(s) {
    return s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : s;
  }

  // --- per-phase description -----------------------------------------------

  function describePhase(phase, direction, options) {
    var opts = options || {};
    var v = phase.values;
    var ts = S.theilSen(v);
    var flat = S.stability(v, { width: opts.stabilityWidth });
    var trended = ts ? S.stability(v, { width: opts.stabilityWidth, trendLine: ts }) : null;
    var rng = S.range(v);

    return {
      phase: phase,
      n: phase.n,
      mean: S.mean(v),
      median: S.median(v),
      sd: S.sd(v),
      mad: S.mad(v),
      cv: S.cv(v),
      min: rng.min,
      max: rng.max,
      theilSen: ts,
      ols: S.ols(v),
      splitMiddle: S.splitMiddle(v),
      slope: ts ? ts.slope : NaN,
      slopeTherapeutic: ts ? (direction === "dec" ? ts.slope < 0 : ts.slope > 0) : false,
      signConflict: S.trendSignConflict(v),
      stability: flat,
      stabilityTrended: trended,
      // A reduction target already sitting at zero has nowhere to go, and a
      // percentage target at 100 likewise. Overlap indices ceiling here and the
      // rationale needs to say so rather than reporting a weak effect.
      atFloor: direction === "dec" && rng.max === 0,
      atCeiling: direction === "inc" && S.isNum(opts.ceiling) && rng.min >= opts.ceiling,
    };
  }

  // How many opening intervention sessions count as "near-immediate" for the
  // purpose of seeing the flip. Beyond this the reversal may be real and it is
  // no longer immediate, which is a different claim.
  var IMMEDIATE_WINDOW = 4;

  // A directional slope reversal across a phase line.
  //
  // Requires the baseline to have been running the WRONG way and the
  // intervention phase to run the right way. A flat-to-therapeutic change is a
  // trend change, not a reversal, and calling it one would overstate.
  function assessReversal(a, b, direction, baselineValues) {
    var counterBaseline = S.isNum(a.slope) && (direction === "dec" ? a.slope > 0 : a.slope < 0);
    var therapeuticTx = S.isNum(b.slope) && (direction === "dec" ? b.slope < 0 : b.slope > 0);
    var present = counterBaseline && therapeuticTx;

    // Is the flip visible in the opening sessions, or only once the whole phase
    // is in? The early window gets its own robust slope rather than assuming
    // the phase-level one holds from the first session.
    var early = b.phase.values.slice(0, Math.min(IMMEDIATE_WINDOW, b.n));
    var earlyLine = early.length >= 2 ? S.theilSen(early) : null;
    var immediate = !!earlyLine &&
      (direction === "dec" ? earlyLine.slope < 0 : earlyLine.slope > 0);

    var cyc = window.GVA_CYCLES
      ? window.GVA_CYCLES.cyclicality(baselineValues)
      : { available: false, cyclical: false, seriallyDependent: false };

    return {
      present: present,
      counterBaseline: counterBaseline,
      therapeuticTx: therapeuticTx,
      immediate: immediate,
      earlySlope: earlyLine ? earlyLine.slope : NaN,
      window: early.length,
      cycles: cyc,
      // The reversal still happened; the caution is about what may explain it.
      cyclicalCaution: present && cyc.cyclical,
    };
  }

  // --- the six WWC features for one transition -----------------------------

  function analyzeTransition(transition, direction, options) {
    var opts = options || {};
    var A = transition.from;
    var B = transition.to;
    var a = describePhase(A, direction, opts);
    var b = describePhase(B, direction, opts);

    var better = function (x, y) { return direction === "dec" ? x < y : x > y; };

    var levelMedian = b.median - a.median;
    var levelMean = b.mean - a.mean;
    var nap = S.nap(A.values, B.values, direction);
    var imm = S.immediacy(A.values, B.values, direction);
    var cdc = S.cdc(A.values, B.values, direction, {
      conservative: opts.conservative !== false,
      criticalMode: opts.criticalMode,
    });
    var lrr = S.lrr(A.values, B.values, direction, { D: opts.D });
    var baseTrend = S.wwcBaselineTrend(A.values, direction);

    // Slope sign inversion. Descriptive only - no methodological source
    // formalizes it, and the construct WWC does formalize is the reversibility
    // NAP below. Theil-Sen slopes are used so one spike cannot flip a sign.
    var inversion =
      S.isNum(a.slope) && S.isNum(b.slope) && a.slope !== 0 && b.slope !== 0
        ? (a.slope > 0) !== (b.slope > 0)
        : null;

    // The clinically load-bearing case, per his ruling: a behavior climbing in
    // the wrong direction through baseline, flipping at or near the phase line.
    // In a practice where reversals are deliberately not run, this is one of the
    // few correlation signals actually available, so it is named rather than
    // buried. The cyclicity guard is his caveat: a series that oscillates fast
    // enough will show a reversal wherever the phase line happens to fall.
    var reversal = assessReversal(a, b, direction, A.values);

    return {
      transition: transition,
      direction: direction,
      from: a,
      to: b,
      level: {
        deltaMedian: levelMedian,
        deltaMean: levelMean,
        therapeutic: better(b.median, a.median),
      },
      trend: {
        fromSlope: a.slope,
        toSlope: b.slope,
        delta: b.slope - a.slope,
        therapeutic: b.slopeTherapeutic,
        signInversion: inversion,
        signConflict: a.signConflict || b.signConflict,
        reversal: reversal,
      },
      variability: {
        fromStable: a.stability.stable,
        toStable: b.stability.stable,
        fromProportion: a.stability.proportion,
        toProportion: b.stability.proportion,
        width: a.stability.width,
      },
      immediacy: imm,
      overlap: {
        nap: nap,
        pnd: S.pnd(A.values, B.values, direction),
        pem: S.pem(A.values, B.values, direction),
        tauU: S.tauU(A.values, B.values, direction),
        inside: S.overlapProportion(A.values, B.values),
      },
      cdc: cdc,
      lrr: lrr,
      wwcBaselineTrend: baseTrend,
    };
  }

  // Feature six, which only exists once a condition has repeated. High overlap
  // *within* a condition is the desirable result here, the inverse of what is
  // wanted between conditions.
  function analyzeConsistency(blocks, direction) {
    var byCond = { base: [], tx: [] };
    blocks.forEach(function (blk) { byCond[blk.cond].push(blk); });

    var pairs = [];
    ["base", "tx"].forEach(function (cond) {
      var list = byCond[cond];
      for (var i = 1; i < list.length; i++) {
        var first = list[0].values;
        var later = list[i].values;
        if (!first.length || !later.length) continue;
        var value = S.napValue(first, later, direction);
        pairs.push({
          cond: cond,
          label: (cond === "base" ? "A1 vs A" : "B1 vs B") + (i + 1),
          nap: value,
          // Consistent means the two phases look alike, i.e. NAP near 0.5.
          consistent: Math.abs(value - NAP_NULL) <= 0.25,
        });
      }
    });

    return {
      available: pairs.length > 0,
      pairs: pairs,
      allConsistent: pairs.length > 0 && pairs.every(function (p) { return p.consistent; }),
    };
  }

  // WWC v5.0 reversibility, run against every return-to-baseline phase.
  function analyzeReversibility(structure, direction) {
    var blocks = structure.blocks;
    if (!blocks.length || blocks[0].cond !== "base") return { available: false, phases: [] };
    var initial = blocks[0].values;
    var out = [];
    for (var i = 1; i < blocks.length; i++) {
      if (blocks[i].cond !== "base") continue;
      var res = S.wwcReversibility(initial, blocks[i].values, direction);
      if (!res.available) continue;
      out.push({
        blockIndex: i,
        name: blocks[i].phases[0].name,
        nap: res.nap,
        reversed: res.reversed,
        threshold: res.threshold,
      });
    }
    return { available: out.length > 0, phases: out };
  }

  // --- the finding ---------------------------------------------------------

  // The finding speaks to the most recent *onset* of intervention. A record
  // sitting in a withdrawal has no current treatment condition to judge, so the
  // tool says which phase it spoke to rather than silently using the last pair.
  function pickOnsetTransition(structure) {
    var onsets = structure.transitions.filter(function (t) { return t.direction === "onset"; });
    return onsets.slice(-1)[0] || null;
  }

  function decideFinding(analysis) {
    if (!analysis) {
      return { finding: FINDING.NONE, reasons: [line("This record has no intervention phase to speak to.")] };
    }
    var txN = analysis.to.n;
    var nap = analysis.overlap.nap.value;

    if (txN < TX_REFUSE_HARD) {
      return {
        finding: FINDING.IN_TREATMENT,
        severity: "hard",
        reasons: [
          line(
            analysis.to.phase.name + " holds " + sessions(txN) + ". Nothing this tool computes would mean " +
            "anything on that, in either direction, so it reports no finding rather than a weak one.",
            "WWC v5.0: a phase with fewer than " + TX_REFUSE_HARD +
            " points cannot demonstrate the presence or the absence of an effect."
          ),
        ],
      };
    }
    if (txN < TX_REFUSE_SOFT) {
      var short = TX_REFUSE_SOFT - txN;
      return {
        finding: FINDING.IN_TREATMENT,
        severity: "soft",
        reasons: [
          line(
            analysis.to.phase.name + " holds " + sessions(txN) + ", which is enough to see something and not " +
            "enough to say it is holding. Another " + sessions(short) + " would let every check on this page run.",
            "Below " + TX_REFUSE_SOFT + " intervention points the dual-criteria binomial cannot reach p < .05 " +
            "at any degree of separation."
          ),
        ],
      };
    }

    var supports = {
      level: analysis.level.therapeutic,
      immediacy: analysis.immediacy.available && analysis.immediacy.therapeutic,
      overlap: S.isNum(nap) && nap >= NAP_MEDIUM,
      trend: analysis.trend.therapeutic || analysis.to.atFloor,
    };
    var count = Object.keys(supports).filter(function (k) { return supports[k]; }).length;
    var cdcPositive = analysis.cdc.available && analysis.cdc.positive;
    var progressing = cdcPositive || (supports.overlap && count >= 3);

    if (progressing) {
      return { finding: FINDING.PROGRESSING, supports: supports, count: count, cdcPositive: cdcPositive };
    }

    var counter = (S.isNum(nap) && nap < NAP_NULL) || !analysis.level.therapeutic;
    return {
      finding: FINDING.NOT_PROGRESSING,
      supports: supports,
      count: count,
      cdcPositive: cdcPositive,
      // These are different clinical claims and the text must not blur them.
      mode: counter ? "countertherapeutic" : "no-effect-yet",
    };
  }

  // --- rationale -----------------------------------------------------------

  function buildRationale(analysis, decision, structure, opts) {
    var out = [];
    if (!analysis) return decision.reasons || [];

    var a = analysis.from;
    var b = analysis.to;
    var nap = analysis.overlap.nap;
    var unit = (opts && opts.ordinate) || "the measure";

    out.push(line(
      "This reads " + a.phase.name + ", " + sessions(a.n) + ", against " + b.phase.name + ", " +
      sessions(b.n) + ", measured as " + String(unit).toLowerCase() + "."
    ));

    if (decision.reasons) {
      out = out.concat(decision.reasons);
    }

    // Level, said as where a typical session sat rather than as a median.
    var dMed = analysis.level.deltaMedian;
    var aim = analysis.level.therapeutic ? "the way the plan is aiming" : "the wrong way for this target";
    out.push(line(
      dMed === 0
        ? "A typical session sat at " + r1(a.median) + " in both phases, so the level did not move."
        : "A typical session moved from " + r1(a.median) + " to " + r1(b.median) + ", " + mag(dMed) + " " +
          (dMed > 0 ? "higher" : "lower") + ", " + aim + ".",
      "Median " + r1(a.median) + " → " + r1(b.median) + " (" + signed(dMed) + "). " +
      "Mean " + r1(a.mean) + " → " + r1(b.mean) + " (" + signed(analysis.level.deltaMean) + ")."
    ));

    if (decision.severity !== "hard") {
      // At complete separation the Hanley-McNeil standard error is exactly
      // zero, so the interval collapses to a point. Printing it there would
      // read as enormous precision at exactly the moment there is least of it.
      if (nap.ciDegenerate) {
        out.push(line(
          "Every intervention session came out better than every baseline session, with no overlap anywhere. " +
          "There is no range to put around a clean sweep, so the chance figure below carries the weight instead.",
          "NAP " + r2(nap.value) + ", complete separation. Hanley-McNeil SE is 0 at the boundary, so no interval exists."
        ));
      } else {
        out.push(line(
          "Pair every baseline session with every intervention session, one pair at a time, and " +
          pct(nap.value) + " of those pairs came out better under the plan. Chance alone would sit near 50%. " +
          "This record is short enough that the true figure could sit anywhere from " + pct(nap.ciLow) +
          " to " + pct(nap.ciHigh) + ".",
          "NAP " + r2(nap.value) + ", 95% CI " + r2(nap.ciLow) + " to " + r2(nap.ciHigh) +
          (nap.ciClamped ? ", nudged off the boundary to compute the interval" : "") + "."
        ));
      }

      if (nap.exact && nap.exact.available) {
        var sig = nap.exact.p < S.CONST.ALPHA;
        out.push(line(
          "If the plan had changed nothing at all, a separation this clean would turn up by luck in " +
          oneIn(nap.exact.p) + " of this size. " +
          (sig ? "That is rare enough to take seriously." : "That is common enough that luck remains a live account."),
          "Exact Mann-Whitney p = " + (nap.exact.p < 0.001 ? "<.001" : r3(nap.exact.p)) +
          ", one-tailed, from the full null distribution."
        ));
        // An In Treatment finding sitting above a significant p reads as
        // self-contradiction unless the tool says which question each answers.
        if (decision.finding === FINDING.IN_TREATMENT && sig) {
          out.push(line(
            "Those two readings do not conflict. The separation is already too clean to be luck, and the phase is " +
            "still too short to describe. Read it as promising and unfinished."
          ));
        }
        // The load-bearing sentence for short phases.
        if (nap.exact.pFloor >= S.CONST.ALPHA) {
          out.push(line(
            "At " + a.n + " sessions against " + b.n + ", no result here can clear the usual bar, not even a clean " +
            "sweep. The best this pairing could ever produce is " + oneIn(nap.exact.pFloor) + ". " +
            "Nothing on this line counts against the plan; the record is simply too short to test.",
            "Best achievable one-tailed p for these phase lengths = " + r3(nap.exact.pFloor) + "."
          ));
        }
      }
    }

    if (analysis.immediacy.available && decision.severity !== "hard") {
      var im = analysis.immediacy;
      out.push(line(
        (im.therapeutic ? "The change showed up straight away. " : "The change did not show up straight away. ") +
        "The last " + sessions(im.lastThree.length) + " of baseline averaged " + r1(im.lastMean) +
        " and the first " + sessions(im.firstThree.length) + " under the plan averaged " + r1(im.firstMean) +
        (im.partial ? ", fewer sessions than the three-and-three this normally compares" : "") + ".",
        "Immediacy delta " + signed(im.delta) + " on the 3-vs-3 window."
      ));
    }

    if (analysis.cdc.available) {
      out.push(line(
        "Two lines run across the intervention phase, carried forward from baseline: where baseline sat, and " +
        "where baseline was heading. " + analysis.cdc.k + " of the " + analysis.cdc.n +
        " intervention sessions landed on the better side of both. " +
        (analysis.cdc.positive
          ? "That clears the " + analysis.cdc.critical + " this check wants, so the change reads as more than noise."
          : "This check wants " + analysis.cdc.critical + " before it will call a change, so it stops short here."),
        "Conservative dual-criteria (Fisher, Kelley & Lomas, 2003), criterion lines shifted " +
        S.CONST.CDC_SHIFT_SD + " baseline SD; binomial p = " +
        (analysis.cdc.p < 0.001 ? "<.001" : r3(analysis.cdc.p)) +
        " against the " + analysis.cdc.criticalMode + " critical value."
      ));
      if (a.n <= 5 && b.n <= 5) {
        out.push(line(
          "At five sessions a side, that check only catches very large changes, so its stopping short says little.",
          "Fisher, Kelley & Lomas (2003): power reaches 0.79 at 5/5 only at d = 3.0."
        ));
      }
    } else if (analysis.cdc.reason) {
      // The method's own reason is written in the method's language, so it is
      // restated here and kept verbatim in the detail.
      out.push(line(
        "The two lines carried forward from baseline were not drawn, because " +
        (b.n < S.CONST.CDC_MIN_TX_POINTS
          ? b.phase.name + " is too short for that check to land either way"
          : a.n < S.CONST.CDC_MIN_BASE_POINTS
            ? a.phase.name + " is too short to carry a trend line forward"
            : "this record does not meet its requirements") + ".",
        sentence(analysis.cdc.reason) + "."
      ));
    }

    if (decision.cdcPositive === false && decision.supports && decision.supports.overlap) {
      out.push(line(
        "The two checks disagree here. The sessions separate cleanly, and the two-line check still refuses, " +
        "because its lines are drawn a deliberate step harder to beat. Read the disagreement as a reason to keep " +
        "collecting rather than as a result either way.",
        "NAP clears " + r2(NAP_MEDIUM) + " while the conservative CDC, offset 0.25 baseline SD, does not."
      ));
    }

    if (analysis.lrr.available) {
      // pctChange is signed on the raw scale, so a reduction target reads as a
      // negative number. Naming the direction in words stops "a change of 73%"
      // being read as improvement on a record where behavior rose.
      var moved = analysis.lrr.pctChange;
      var helped = (analysis.direction === "dec") === (moved < 0);
      out.push(line(
        "Behavior is running " + Math.abs(Math.round(moved)) + "% " + (moved >= 0 ? "higher" : "lower") +
        " than it did in baseline, " + (helped ? "which is the direction the plan wants." : "which is the wrong way for this target."),
        "Log response ratio " + r2(analysis.lrr.value) + ", 95% CI " +
        r2(analysis.lrr.ciLow) + " to " + r2(analysis.lrr.ciHigh) + "."
      ));
    } else if (analysis.lrr.reason) {
      out.push(line(
        "How large the change is, as a percentage, was not computed on this record. " +
        "That figure needs a measure with a true zero and a phase average above it.",
        sentence(analysis.lrr.reason) + "."
      ));
    }

    if (!a.stability.stable) {
      if (a.stability.subGrain) {
        // The envelope is narrower than one count, so nothing but the median
        // itself can fall inside it. Reporting the proportion alone would blame
        // the client for an artifact of the criterion.
        out.push(line(
          "The steadiness check will not work on " + a.phase.name + ". A typical session there is " +
          r1(a.stability.median) + " on whole counts, and a band of " + Math.round(a.stability.width * 100) +
          "% around that is narrower than a single count, so only an exact " + r1(a.stability.median) +
          " could ever land inside it. Read the range instead: this phase runs " + r1(a.min) + " to " +
          r1(a.max) + ".",
          "Envelope ±" + r2(a.stability.halfWidth) + " on integer data, so the proportion within is an artifact. " +
          "SD " + r1(a.sd) + ", MAD " + r1(a.mad) + "."
        ));
      } else {
        out.push(line(
          a.phase.name + " never settled. Only " + pct(a.stability.proportion) + " of its sessions sit close to " +
          "its own typical value, where " + Math.round(a.stability.threshold * 100) + "% is the usual bar. " +
          "That weakens every comparison below, because a moving baseline gives the plan nothing fixed to differ from.",
          pct(a.stability.proportion) + " within " + Math.round(a.stability.width * 100) +
          "% of the median, against a " + Math.round(a.stability.threshold * 100) + "% criterion."
        ));
      }
    }

    if (analysis.wwcBaselineTrend.available && !analysis.wwcBaselineTrend.minimalTrend) {
      out.push(line(
        "Behavior was already improving before the plan started. Improvement across the phase line cannot be " +
        "credited to the plan on its own when it was already under way.",
        "WWC v5.0 baseline trend screen: NAP " + r2(analysis.wwcBaselineTrend.nap) + " against the 0.85 threshold."
      ));
    }

    if (analysis.trend.signConflict) {
      out.push(line(
        "One session is steering the trend line in at least one phase. Two ways of drawing that line point in " +
        "opposite directions, which happens when a single outlying session carries it. The line drawn on the " +
        "chart is the one that resists outliers.",
        "OLS and Theil-Sen slopes disagree in sign."
      ));
    }

    // A slope across two points is one line segment. Narrating a turn there
    // contradicted the refusal printed directly above it, which said nothing
    // computed on this phase means anything in either direction.
    var rev = decision.severity === "hard" ? null : analysis.trend.reversal;
    var wrongWay = analysis.direction === "dec" ? "climbing" : "sliding";
    var rightWay = analysis.direction === "dec" ? "falls" : "climbs";
    if (rev && rev.present) {
      out.push(line(
        "Behavior was " + wrongWay + " through " + a.phase.name + ", about " + mag(a.slope) +
        " a session, and it turned at the phase line: under " + b.phase.name + " it " + rightWay + " about " +
        mag(b.slope) + " a session. " +
        (rev.immediate
          ? "The turn is already visible across the first " + sessions(rev.window) + " of the plan."
          : "The first " + sessions(rev.window) + " of the plan do not show it yet, so the turn built up rather than arriving with the change."),
        "Theil-Sen slope " + signed(a.slope, r2) + " → " + signed(b.slope, r2) +
        "; early-window slope " + signed(rev.earlySlope, r2) + " over " + rev.window + " points."
      ));
      if (rev.cyclicalCaution) {
        // His caveat, and it is the one that keeps this signal honest.
        pushCycleLines(out, rev.cycles, a.phase.name);
      }
    } else if (rev && rev.therapeuticTx && !rev.counterBaseline) {
      // Trend only. Saying "behavior improved" here was wrong on any record
      // whose level rose while its within-phase slope ran the right way.
      out.push(line(
        "Within " + b.phase.name + " the line runs the way the plan wants, and it was not running the wrong way " +
        "through " + a.phase.name + " beforehand. That makes this a bend in the line rather than a turnaround, " +
        "and a bend carries less weight than a turn.",
        "Theil-Sen slope " + signed(a.slope, r2) + " → " + signed(b.slope, r2) + "; no counter-therapeutic baseline slope to invert."
      ));
    }

    // Serial dependence undermines the binomial the dual-criteria method rests
    // on, so it belongs next to that verdict rather than in a footnote.
    if (rev && rev.cycles && rev.cycles.seriallyDependent && !rev.cyclicalCaution && analysis.cdc.available) {
      pushCycleLines(out, rev.cycles, a.phase.name);
    }

    if (b.atFloor) {
      out.push(line(
        "Behavior sat at zero for the whole of " + b.phase.name + ". The comparison figures max out there and " +
        "stop saying anything about how large the change was."
      ));
    }

    return out;
  }

  function pushCycleLines(out, cycles, phaseName) {
    if (!window.GVA_CYCLES) return;
    window.GVA_CYCLES.describe(cycles, phaseName).forEach(function (entry) {
      out.push(line(entry.text, entry.detail));
    });
  }

  // --- top level -----------------------------------------------------------

  function evaluate(rawPhases, options) {
    var opts = options || {};
    var direction = opts.direction === "inc" ? "inc" : "dec";
    var structure = D.analyze(rawPhases, opts);

    var onset = pickOnsetTransition(structure);
    var analysis = onset ? analyzeTransition(onset, direction, opts) : null;
    var decision = decideFinding(analysis);

    var transitions = structure.transitions.map(function (t) {
      return analyzeTransition(t, direction, opts);
    });

    var endsInWithdrawal =
      structure.transitions.length > 0 &&
      structure.transitions[structure.transitions.length - 1].direction === "withdrawal";

    return {
      structure: structure,
      direction: direction,
      finding: decision.finding,
      decision: decision,
      primary: analysis,
      transitions: transitions,
      consistency: analyzeConsistency(structure.blocks, direction),
      reversibility: analyzeReversibility(structure, direction),
      causal: structure.causal,
      rating: structure.rating,
      warnings: structure.warnings,
      endsInWithdrawal: endsInWithdrawal,
      rationale: buildRationale(analysis, decision, structure, opts),
      // Same reason the reversal paragraph is withheld below three points: the
      // note argues about attribution, and there is nothing yet to attribute.
      // Where a reversal is not available, a clean directional flip at the
      // phase line is the strongest correlational evidence a record can carry.
      // It sits on the causal axis because it argues about attribution, and it
      // never promotes correlation to a functional relation.
      causalNote: causalNote(analysis, decision),
    };
  }

  function causalNote(analysis, decision) {
    if (!analysis) return null;
    if (decision && decision.severity === "hard") return null;
    var rev = analysis.trend.reversal;
    if (!rev || !rev.present) return null;
    if (rev.cyclicalCaution) {
      return "Behavior turned at the phase line, and this baseline swings fast enough that the turn could be the swing " +
        "arriving rather than the plan working. Treat it as unresolved until a longer settled stretch, or a second " +
        "phase change, tells the two apart.";
    }
    return "Behavior was heading the wrong way and turned at the phase line" +
      (rev.immediate ? ", visibly within the opening sessions" : "") +
      ". With one phase change this does not establish a functional relation, and a turn that lines up this closely " +
      "makes history and maturation harder accounts to sustain.";
  }

  window.GVA_VERDICT = {
    evaluate: evaluate,
    describePhase: describePhase,
    analyzeTransition: analyzeTransition,
    decideFinding: decideFinding,
    FINDING: FINDING,
    CONST: {
      TX_REFUSE_HARD: TX_REFUSE_HARD,
      TX_REFUSE_SOFT: TX_REFUSE_SOFT,
      NAP_MEDIUM: NAP_MEDIUM,
      NAP_STRONG: NAP_STRONG,
    },
  };
})();
