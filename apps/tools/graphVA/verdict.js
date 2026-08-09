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
      return { finding: FINDING.NONE, reasons: ["No intervention phase in this record."] };
    }
    var txN = analysis.to.n;
    var nap = analysis.overlap.nap.value;

    if (txN < TX_REFUSE_HARD) {
      return {
        finding: FINDING.IN_TREATMENT,
        severity: "hard",
        reasons: [
          "The intervention phase carries " + txN + " data point" + (txN === 1 ? "" : "s") +
          ". Per WWC a phase with fewer than " + TX_REFUSE_HARD +
          " points cannot be used to demonstrate the existence or the absence of an effect.",
        ],
      };
    }
    if (txN < TX_REFUSE_SOFT) {
      return {
        finding: FINDING.IN_TREATMENT,
        severity: "soft",
        reasons: [
          "The intervention phase carries " + txN + " data points. Three points cannot establish a phase's level, " +
          "trend and variability, which is what visual analysis compares, and the dual-criteria test needs " +
          TX_REFUSE_SOFT + " before its binomial can reach p < .05.",
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

    out.push(
      "Comparison runs " + a.phase.name + " (n = " + a.n + ") against " +
      b.phase.name + " (n = " + b.n + ") on " + unit + "."
    );

    if (decision.reasons) {
      out = out.concat(decision.reasons);
    }

    out.push(
      "Median moved from " + r1(a.median) + " to " + r1(b.median) + " (" +
      signed(analysis.level.deltaMedian) + "), mean from " + r1(a.mean) + " to " + r1(b.mean) + "."
    );

    if (decision.severity !== "hard") {
      // At complete separation the Hanley-McNeil standard error is exactly
      // zero, so the interval collapses to a point. Printing it there would
      // read as enormous precision at exactly the moment there is least of it.
      if (nap.ciDegenerate) {
        out.push(
          "NAP is " + r2(nap.value) + ", complete separation. No usable confidence interval exists at the boundary, " +
          "so the exact test below carries the inference instead."
        );
      } else {
        out.push(
          "NAP is " + r2(nap.value) + ", 95% CI " + r2(nap.ciLow) + " to " + r2(nap.ciHigh) +
          (nap.ciClamped ? " (nudged off the boundary to compute the interval)" : "") + "."
        );
      }

      if (nap.exact && nap.exact.available) {
        out.push(
          "Exact Mann-Whitney p = " + (nap.exact.p < 0.001 ? "<.001" : r3(nap.exact.p)) +
          " one-tailed, computed from the full null distribution rather than a normal approximation."
        );
        // An In Treatment finding sitting above a significant p reads as
        // self-contradiction unless the tool says which question each answers.
        // This is the "promising, keep collecting" case and it is worth naming,
        // because a clinician who reads only the finding would stop here.
        if (decision.finding === FINDING.IN_TREATMENT && nap.exact.p < S.CONST.ALPHA) {
          out.push(
            "Those two statements do not conflict. The exact test asks whether these " + b.n +
            " points could have come from the baseline distribution, and answers no. The finding asks whether the phase " +
            "has enough sessions to characterize its level, trend and variability, and answers not yet. " +
            "Read this as promising and unfinished: continue the phase and re-analyze."
          );
        }
        // The load-bearing sentence for short phases.
        if (nap.exact.pFloor >= S.CONST.ALPHA) {
          out.push(
            "These phase lengths (" + a.n + " against " + b.n + ") cannot reach p < .05 however clean the separation. " +
            "The best result this pairing could produce is p = " + r3(nap.exact.pFloor) +
            ", so an absence of significance here is a statement about the record, not about the intervention."
          );
        }
      }
    }

    if (analysis.immediacy.available && decision.severity !== "hard") {
      var im = analysis.immediacy;
      out.push(
        (im.therapeutic ? "Immediacy is present: " : "Immediacy is absent: ") +
        "the last " + im.lastThree.length + " baseline points average " + r1(im.lastMean) +
        " against " + r1(im.firstMean) + " for the first " + im.firstThree.length + " intervention points" +
        (im.partial ? ", short of the three-and-three WWC compares" : "") + "."
      );
    }

    if (analysis.cdc.available) {
      out.push(
        "Dual-criteria: " + analysis.cdc.k + " of " + analysis.cdc.n +
        " intervention points beat both criterion lines, against a critical value of " +
        analysis.cdc.critical + " (" + analysis.cdc.criticalMode + " binomial, exact p = " +
        r2(analysis.cdc.p) + "). " + (analysis.cdc.positive ? "That is a reliable effect by this method." : "That falls short.")
      );
      if (a.n <= 5 && b.n <= 5) {
        out.push(
          "At five and five, this method reaches 0.79 power only at d = 3.0 (Fisher, Kelley & Lomas, 2003), so a negative result here is weak evidence of absence."
        );
      }
    } else if (analysis.cdc.reason) {
      out.push("Dual-criteria was not run: " + analysis.cdc.reason + ".");
    }

    if (decision.cdcPositive === false && decision.supports && decision.supports.overlap) {
      out.push(
        "Note the disagreement: overlap reads as a real separation while the dual-criteria test does not. " +
        "The conservative variant sits 0.25 baseline SD inside the criterion lines and is deliberately hard to satisfy."
      );
    }

    if (analysis.lrr.available) {
      // pctChange is signed on the raw scale, so a reduction target reads as a
      // negative number. Naming the direction in words stops "a change of 73%"
      // being read as improvement on a record where behavior rose.
      var moved = analysis.lrr.pctChange;
      var word = moved >= 0 ? "rose" : "fell";
      var helped = (analysis.direction === "dec") === (moved < 0);
      out.push(
        "Behavior " + word + " " + Math.abs(Math.round(moved)) + "% against baseline" +
        (helped ? ", in the therapeutic direction" : ", against the therapeutic direction") +
        " (log response ratio " + r2(analysis.lrr.value) + ", 95% CI " +
        r2(analysis.lrr.ciLow) + " to " + r2(analysis.lrr.ciHigh) + ")."
      );
    } else if (analysis.lrr.reason) {
      out.push("Magnitude was not computed: " + analysis.lrr.reason + ".");
    }

    if (!a.stability.stable) {
      if (a.stability.subGrain) {
        // The envelope is narrower than one count, so nothing but the median
        // itself can fall inside it. Reporting the proportion alone would blame
        // the client for an artifact of the criterion.
        out.push(
          "The stability criterion does not apply cleanly here. At a median of " + r1(a.stability.median) +
          " on whole counts, a " + Math.round(a.stability.width * 100) + "% envelope is plus or minus " +
          r2(a.stability.halfWidth) + ", which is narrower than one count, so only values exactly at the median can sit inside it. " +
          "Read the range (" + r1(a.min) + " to " + r1(a.max) + ") and the standard deviation (" + r1(a.sd) + ") for variability instead."
        );
      } else {
        out.push(
          "The preceding phase did not meet the stability criterion (" + pct(a.stability.proportion) +
          " of points within " + Math.round(a.stability.width * 100) + "% of its median, against a " +
          Math.round(a.stability.threshold * 100) + "% requirement), so baseline logic is not satisfied and the phase change was premature on the data as graphed."
        );
      }
    }

    if (analysis.wwcBaselineTrend.available && !analysis.wwcBaselineTrend.minimalTrend) {
      out.push(
        "The baseline was already moving in the therapeutic direction before the change (WWC trend screen NAP " +
        r2(analysis.wwcBaselineTrend.nap) + ", above the 0.85 bar), so improvement across the boundary cannot be credited to the intervention alone."
      );
    }

    if (analysis.trend.signConflict) {
      out.push(
        "Least-squares and Theil-Sen slopes disagree on sign in at least one phase, which means a single point is driving the trend. The robust slope is the one drawn."
      );
    }

    var rev = analysis.trend.reversal;
    if (rev && rev.present) {
      out.push(
        "Slope reversed across the phase line: the baseline was running at " + signed(a.slope, r2) +
        " per session, against the target, and the intervention phase runs at " + signed(b.slope, r2) +
        (rev.immediate
          ? ", with the flip already visible across the first " + rev.window + " intervention sessions."
          : ", though the first " + rev.window + " intervention sessions do not yet show it, so the reversal is not immediate.")
      );
      if (rev.cyclicalCaution) {
        // His caveat, and it is the one that keeps this signal honest.
        (window.GVA_CYCLES ? window.GVA_CYCLES.describe(rev.cycles, "The baseline") : [])
          .forEach(function (line) { out.push(line); });
      }
    } else if (rev && rev.therapeuticTx && !rev.counterBaseline) {
      out.push(
        "This is a trend change rather than a reversal. The baseline was not running against the target, so there was no direction to flip."
      );
    }

    // Serial dependence undermines the binomial the dual-criteria method rests
    // on, so it belongs next to that verdict rather than in a footnote.
    if (rev && rev.cycles && rev.cycles.seriallyDependent && !rev.cyclicalCaution && analysis.cdc.available) {
      (window.GVA_CYCLES ? window.GVA_CYCLES.describe(rev.cycles, "The baseline") : [])
        .forEach(function (line) { out.push(line); });
    }

    if (b.atFloor) {
      out.push("The intervention phase sits at zero throughout. Overlap indices ceiling here and carry no information about magnitude.");
    }

    return out;
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
      // Where a reversal is not available, a clean directional flip at the
      // phase line is the strongest correlational evidence a record can carry.
      // It sits on the causal axis because it argues about attribution, and it
      // never promotes correlation to a functional relation.
      causalNote: causalNote(analysis),
    };
  }

  function causalNote(analysis) {
    if (!analysis) return null;
    var rev = analysis.trend.reversal;
    if (!rev || !rev.present) return null;
    if (rev.cyclicalCaution) {
      return "A directional flip at the phase line would ordinarily strengthen the correlational case here, and this baseline " +
        "oscillates fast enough that a flip could fall out of the cycle rather than the intervention. Treat it as unresolved " +
        "until a longer stable stretch or a second phase change separates the two.";
    }
    return "The baseline was running against the target and flipped at the phase line" +
      (rev.immediate ? ", visibly within the opening sessions" : "") +
      ". Where a reversal is deliberately withheld, that flip is the strongest correlational evidence the record can carry. " +
      "It still does not establish a functional relation, and it does raise the cost of explaining the change by history or maturation alone.";
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
