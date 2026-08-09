// Design structure for single-case records.
//
// This file answers three questions that the v3 workbench could not ask:
// which design is on the page, which phase changes are real condition changes,
// and how many of those changes are eligible to count as a demonstration of
// effect. Nothing here computes a statistic - it computes the structure that
// decides which statistics are allowed to speak.
//
// Scope: one series at a time. Multiple baseline across tiers needs several
// concurrent series and is reported as out of scope rather than mis-analyzed as
// a reversal.
(function () {
  "use strict";

  var S = window.GVA_STATS;

  // WWC v5.0: a phase with fewer than 3 points cannot be used to demonstrate
  // the existence or the absence of an effect, so a transition touching one is
  // not eligible to count.
  var MIN_PHASE_POINTS = 3;

  // WWC v5.0 raised the initial baseline requirement from 5 to 6.
  var WWC_INITIAL_BASELINE = 6;
  var WWC_SUBSEQUENT_PHASE = 5;
  var WWC_WITH_RESERVATIONS = 3;

  // Three demonstrations at three different points in time. WWC 2010 is candid
  // that this is "a conceptual norm" with no formal basis.
  var DEMONSTRATIONS_REQUIRED = 3;

  function parseValues(raw) {
    if (Array.isArray(raw)) return S.clean(raw.map(Number));
    return S.clean(
      String(raw || "")
        .split(/[^0-9.\-]+/)
        .filter(function (v) { return v !== "" && v !== "-"; })
        .map(Number)
    );
  }

  // A phase is baseline unless it is explicitly marked as intervention.
  function normalizePhase(phase, index) {
    var values = parseValues(phase.data);
    return {
      index: index,
      name: String(phase.name || "Phase " + (index + 1)),
      cond: phase.cond === "tx" ? "tx" : "base",
      note: String(phase.note || ""),
      values: values,
      n: values.length,
    };
  }

  // Consecutive phases sharing a condition form one block. The six baseline
  // segments in a staffing-churn record are one condition, not six, and
  // collapsing them is what stops the tool reading five staffing changes as
  // five demonstrations of effect.
  function toBlocks(phases) {
    var blocks = [];
    phases.forEach(function (p) {
      var last = blocks[blocks.length - 1];
      if (last && last.cond === p.cond) {
        last.phases.push(p);
        last.values = last.values.concat(p.values);
        last.n = last.values.length;
        return;
      }
      blocks.push({
        cond: p.cond,
        phases: [p],
        values: p.values.slice(),
        n: p.n,
      });
    });
    return blocks.map(function (b, i) {
      b.index = i;
      b.letter = b.cond === "base" ? "A" : "B";
      return b;
    });
  }

  // The design label is literally the block letter sequence, so an ABAB reads
  // as "ABAB" and a staffing-churned baseline followed by one plan reads "AB"
  // however many baseline segments were drawn.
  function detectDesign(blocks) {
    var letters = blocks.map(function (b) { return b.letter; }).join("");
    var changes = Math.max(0, blocks.length - 1);

    var known = {
      "": "No data",
      A: "Baseline only",
      B: "Intervention only, no baseline",
      AB: "AB",
      BA: "BA",
      ABA: "ABA (withdrawal)",
      BAB: "BAB",
      ABAB: "ABAB (reversal)",
    };

    var family;
    if (letters.length <= 1) family = "none";
    else if (/^(AB)+A?$/.test(letters) && letters.length >= 4) family = "reversal";
    else if (letters === "AB") family = "ab";
    else family = "other";

    return {
      letters: letters,
      label: known[letters] || (letters.length > 4 ? letters + " (extended reversal)" : letters),
      family: family,
      conditionChanges: changes,
      blocks: blocks.length,
    };
  }

  // A transition is one condition change. Its comparison pair is the phase
  // immediately before the boundary and the phase immediately after it, not the
  // pooled blocks - WWC compares adjacent phases, and pooling a baseline across
  // six technicians would hide exactly the confound the analyst needs to see.
  function buildTransitions(phases, blocks) {
    var transitions = [];
    for (var i = 1; i < blocks.length; i++) {
      var prev = blocks[i - 1];
      var next = blocks[i];
      var from = prev.phases[prev.phases.length - 1];
      var to = next.phases[0];
      var eligible = from.n >= MIN_PHASE_POINTS && to.n >= MIN_PHASE_POINTS;

      transitions.push({
        index: transitions.length,
        fromBlock: prev.index,
        toBlock: next.index,
        from: from,
        to: to,
        // Pooled view of the whole preceding condition, offered as an
        // alternative comparison basis rather than the default.
        fromPooled: prev.values.slice(),
        letters: prev.letter + next.letter,
        direction: next.cond === "tx" ? "onset" : "withdrawal",
        eligible: eligible,
        ineligibleReason: eligible
          ? null
          : (from.n < MIN_PHASE_POINTS ? from.name : to.name) +
            " has fewer than " + MIN_PHASE_POINTS + " points",
      });
    }
    return transitions;
  }

  // Within-condition changes are drawn, and they are drawn differently. A
  // staffing change must not carry the same visual authority as a phase change.
  function buildWithinChanges(phases) {
    var out = [];
    for (var i = 1; i < phases.length; i++) {
      if (phases[i].cond === phases[i - 1].cond) {
        out.push({ afterPhase: i - 1, beforePhase: i, name: phases[i].name });
      }
    }
    return out;
  }

  // WWC v5.0 evidence tier for the record as graphed. Sequential eligibility
  // only: "nonsequential phases cannot serve as demonstrations of an
  // intervention's effect", so a record can carry plenty of points overall and
  // still fail on where they sit.
  function wwcRating(phases, transitions, design) {
    var eligible = transitions.filter(function (t) { return t.eligible; });
    var demonstrations = eligible.length;

    if (design.family === "ab" || design.conditionChanges < DEMONSTRATIONS_REQUIRED) {
      return {
        tier: "does-not-meet",
        demonstrations: demonstrations,
        required: DEMONSTRATIONS_REQUIRED,
        reason:
          design.family === "ab"
            ? "An AB design has one phase change, so it can produce at most one demonstration. WWC lists AB, ABA and BAB among the designs that do not meet standards."
            : "The record carries " + demonstrations + " eligible demonstration" +
              (demonstrations === 1 ? "" : "s") + " of a required " + DEMONSTRATIONS_REQUIRED + ".",
      };
    }

    var initial = phases[0];
    var subsequent = phases.slice(1);
    var initialOk = initial && (initial.n >= WWC_INITIAL_BASELINE || zeroVar(initial));
    var subsequentOk = subsequent.every(function (p) {
      return p.n >= WWC_SUBSEQUENT_PHASE || zeroVar(p);
    });
    var reservationOk = phases.every(function (p) { return p.n >= WWC_WITH_RESERVATIONS; });

    if (initialOk && subsequentOk) {
      return {
        tier: "meets",
        demonstrations: demonstrations,
        required: DEMONSTRATIONS_REQUIRED,
        reason: "Initial baseline carries at least " + WWC_INITIAL_BASELINE +
          " points and every subsequent phase at least " + WWC_SUBSEQUENT_PHASE + ".",
      };
    }
    if (reservationOk) {
      return {
        tier: "meets-with-reservations",
        demonstrations: demonstrations,
        required: DEMONSTRATIONS_REQUIRED,
        reason: "Every phase carries at least " + WWC_WITH_RESERVATIONS +
          " points, short of the " + WWC_INITIAL_BASELINE + "/" + WWC_SUBSEQUENT_PHASE +
          " needed to meet without reservations.",
      };
    }
    return {
      tier: "does-not-meet",
      demonstrations: demonstrations,
      required: DEMONSTRATIONS_REQUIRED,
      reason: "At least one phase carries fewer than " + WWC_WITH_RESERVATIONS + " points.",
    };
  }

  function zeroVar(phase) {
    if (phase.n < MIN_PHASE_POINTS) return false;
    var spread = S.sd(phase.values);
    return spread === 0 || spread < 1e-12;
  }

  // The causal claim the structure permits, independent of how strong the
  // numbers are. This is the half of the verdict that no nonoverlap index can
  // answer, and it is computed from structure alone on purpose.
  function causalStrength(design, rating, transitions) {
    var d = rating.demonstrations;
    var drawn = (transitions || []).length;
    if (d === 0) {
      // A comparison can still be shown while being ineligible to *count* as a
      // demonstration. Those are different claims and conflating them tells a
      // clinician their graph is unreadable when it is merely unreplicated.
      if (drawn > 0) {
        var short = (transitions || [])
          .filter(function (t) { return !t.eligible; })
          .map(function (t) { return t.ineligibleReason; })
          .filter(Boolean);
        return {
          level: "ineligible",
          headline: "Not eligible as a demonstration",
          body:
            "The comparison is drawn and you can read it. It does not count toward a demonstration of effect, " +
            "because " + (short[0] || "a phase falls below the " + MIN_PHASE_POINTS + "-point minimum") + ".",
        };
      }
      return {
        level: "none",
        headline: "No comparison available",
        body: "This record contains no condition change, so there is no phase pair to compare.",
      };
    }
    if (d === 1) {
      return {
        level: "correlation",
        headline: "Correlation only",
        body:
          "The change lines up with the start of the plan. " +
          // "A AB design" otherwise, since every design label opens with a vowel sound.
          (/^[AEIOU]/.test(design.letters) ? "An " : "A ") + design.letters +
          " design has one condition change, so it can carry correlation and it cannot demonstrate a functional " +
          "relation, which takes " + DEMONSTRATIONS_REQUIRED + " demonstrations at " + DEMONSTRATIONS_REQUIRED +
          " different points in time. History, maturation and regression to the mean all stay on the table.",
      };
    }
    if (d < DEMONSTRATIONS_REQUIRED) {
      return {
        level: "partial",
        headline: "Partial replication",
        body:
          d + " of " + DEMONSTRATIONS_REQUIRED + " demonstrations. The effect has replicated once, which is " +
          "stronger than a single condition change and short of a functional relation.",
      };
    }
    return {
      level: "functional",
      headline: "Functional relation supported",
      body:
        d + " demonstrations at " + d + " different points in time, which meets the three-demonstration " +
        "convention. A complete return to baseline, and like phases that resemble each other, would firm it further.",
    };
  }

  // Design-appropriateness warning. WWC: if the dependent variable is unlikely
  // to reverse once it has responded, a reversal design is the wrong choice and
  // a multiple baseline is the right one.
  function designWarnings(design, phases, targetKind) {
    var out = [];
    if (design.family === "reversal" && targetKind === "acquisition") {
      out.push(
        "This is a reversal design on an acquisition target, so a phase that does not return to baseline is not " +
        "evidence against the plan here."
      );
    }
    if (design.letters === "B" || design.letters.charAt(0) === "B") {
      out.push("The record opens in an intervention condition, so there is no pretreatment comparison to reason from.");
    }
    var withinCount = buildWithinChanges(phases).length;
    if (withinCount >= 2) {
      out.push(
        withinCount + " phase changes fall inside a single condition, drawn as light dotted lines. None of them " +
        "counts as a demonstration of effect. Where one of them is a change in who took the data, a shift at that " +
        "line may be a recording change rather than a behavior change."
      );
    }
    return out;
  }

  function analyze(rawPhases, options) {
    var opts = options || {};
    var phases = (rawPhases || []).map(normalizePhase).filter(function (p) { return p.n > 0; });
    var blocks = toBlocks(phases);
    var detected = detectDesign(blocks);
    var design = opts.designOverride
      ? Object.assign({}, detected, { label: opts.designOverride, overridden: true })
      : detected;
    var transitions = buildTransitions(phases, blocks);
    var rating = wwcRating(phases, transitions, design);

    return {
      phases: phases,
      blocks: blocks,
      design: design,
      transitions: transitions,
      withinChanges: buildWithinChanges(phases),
      rating: rating,
      causal: causalStrength(design, rating, transitions),
      warnings: designWarnings(design, phases, opts.targetKind),
      // The pair the verdict speaks to: the last condition change with data on
      // both sides, falling back to the last one drawn.
      terminalTransition:
        transitions.filter(function (t) { return t.eligible; }).slice(-1)[0] ||
        transitions.slice(-1)[0] ||
        null,
    };
  }

  window.GVA_DESIGN = {
    analyze: analyze,
    parseValues: parseValues,
    normalizePhase: normalizePhase,
    toBlocks: toBlocks,
    detectDesign: detectDesign,
    buildTransitions: buildTransitions,
    CONST: {
      MIN_PHASE_POINTS: MIN_PHASE_POINTS,
      WWC_INITIAL_BASELINE: WWC_INITIAL_BASELINE,
      WWC_SUBSEQUENT_PHASE: WWC_SUBSEQUENT_PHASE,
      WWC_WITH_RESERVATIONS: WWC_WITH_RESERVATIONS,
      DEMONSTRATIONS_REQUIRED: DEMONSTRATIONS_REQUIRED,
    },
  };
})();
