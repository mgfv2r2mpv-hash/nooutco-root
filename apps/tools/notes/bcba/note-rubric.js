/* What the note is graded against, and why it is not a tally.
 *
 * The pill used to say "3 spots could use more detail". That number is the one
 * thing about a hint list that carries no instruction: it tells a technician
 * that work remains without telling them what the work is, so the only way to
 * act on it is to open the panel and read all three. A rubric names the thing
 * that is missing, in the words the technician would use to fix it.
 *
 * The dimensions are the regional handout's, not invented here. Attempts carry
 * their outcome is completeness B4. Direction against recent sessions is
 * behavior-per-behavior-progress. Saying more than the numbers is B7 and
 * do-not-repeat-the-data, which is also the only dimension measured on the
 * prose rather than read off the model's own hints: the EHR attaches this
 * session's counts already, so a sentence that carries a number and little
 * else is a sentence the record already had.
 *
 * A tool declares its own dimensions because the hint codes are per tool. One
 * that declares none is graded by hint severity instead, which is weaker but
 * never wrong - it beats hardcoding four other tools' catalogs in here.
 */
(function () {
  "use strict";

  /* Content words left in a sentence once its quantities are removed. Below
     this, deleting the sentence costs a reader nothing they did not already
     have from the data table. Four is deliberately low: the measure exists to
     catch "Tacting was 80% across 20 trials", not to police terse writing. */
  var MIN_OBSERVATION_WORDS = 4;

  /* THE SEVERITY VOCABULARY IS THE BUDGET'S, and it is written out here rather
     than imported because this file is loaded before alert-budget.js on both
     pages and a grade must never depend on load order. The three tiers are the
     maintainer's: 1 the note says something wrong, 2 the note is missing
     something a supervisor will ask about, 3 the note could read better.
     alert-budget.js reads the same three off the same three hint kinds, and
     tests/alert-budget.spec.js pins that the two agree. */
  var TIER_OF_KIND = { "blocks-claim": 1, thin: 2, register: 3 };
  var WORST_TIER = 1;
  var NO_TIER = 9;

  function tierOfHints(hints) {
    var t = NO_TIER;
    (hints || []).forEach(function (h) {
      var k = h && TIER_OF_KIND[h.kind];
      if (k && k < t) t = k;
    });
    return t;
  }

  var QUANTITY = /^(?:\d+(?:\.\d+)?%?|\d+\/\d+|\d+(?:st|nd|rd|th))$/;

  var QUANTITY_WORDS = words(
    "trial trials percent percentage time times occurrence occurrences " +
    "instance instances session sessions minute minutes second seconds " +
    "opportunity opportunities out total average rate count counts"
  );

  var STOP = words(
    "the a an and or but to in on at for with was were is are be been this " +
    "that these those which as by from during while when after before across " +
    "over it he she they them his her their had has have did does do of"
  );

  /* Rank 0 is a real rank - the empty-section dimension claims it so nothing
     can outrank a blank narrative - so a falsy coalesce here would silently
     demote the loudest fault in the note. */
  function rankOf(x) {
    return x && typeof x.rank === "number" ? x.rank : 99;
  }

  function words(s) {
    var set = {};
    s.split(" ").forEach(function (w) { if (w) set[w] = true; });
    return set;
  }

  /* Readable split, not the byte-exact one diff.js needs for reconstruction.
     Two contracts, two functions: a change made for the diff's sake must not
     be able to move a grade. */
  function sentences(text) {
    return String(text || "")
      .split(/(?<=[.!?])\s+|\n+/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  /* Dots and slashes survive the scrub so "3.5" and "16/20" stay one token,
     which means a sentence-final period rides along and has to come back off
     or "75%." never reads as a quantity. */
  function tokens(sentence) {
    return sentence
      .toLowerCase()
      .replace(/[^a-z0-9%/.\s]/g, " ")
      .split(/\s+/)
      .map(function (w) { return w.replace(/^[./]+|[./]+$/g, ""); })
      .filter(Boolean);
  }

  /* True when the sentence carries a number and almost nothing else. No
     number at all is never data-shaped, however thin the sentence is - that is
     a different fault, and the hints are what report it. */
  function restatesData(sentence) {
    var t = tokens(sentence);
    var hasNumber = t.some(function (w) { return QUANTITY.test(w); });
    if (!hasNumber) return false;
    var content = t.filter(function (w) {
      return !QUANTITY.test(w) && !QUANTITY_WORDS[w] && !STOP[w] && w.length > 1;
    });
    return content.length < MIN_OBSERVATION_WORDS;
  }

  function countRestatements(narratives) {
    var n = 0;
    Object.keys(narratives).forEach(function (id) {
      sentences(narratives[id]).forEach(function (s) { if (restatesData(s)) n += 1; });
    });
    return n;
  }

  // ---------------------------------------------------------------- grading

  function emptyDimension(narratives, ids) {
    var empties = ids.filter(function (id) { return !String(narratives[id] || "").trim(); });
    return {
      id: "sections",
      label: "Every narrative written",
      state: empties.length ? "gap" : "met",
      blocking: empties.length > 0,
      rank: 0,
      /* An empty narrative is the note not saying something, which is tier 2 by
         the maintainer's wording. It keeps blocking and rank 0 regardless: a
         blank section is the loudest fault on the page whatever tier it sits
         in, and the two facts answer different questions. */
      tier: empties.length ? 2 : NO_TIER,
      detail: empties.length
        ? empties.length + " narrative section" + (empties.length > 1 ? "s are" : " is") + " empty"
        : "",
      sections: empties,
    };
  }

  function hintDimension(spec, hints, catalog) {
    var mine = spec.codes
      ? hints.filter(function (h) { return spec.codes.indexOf(h.code) !== -1; })
      : hints.slice();
    mine.sort(function (a, b) { return rankOf(a) - rankOf(b); });
    var top = mine[0];
    return {
      id: spec.id,
      label: spec.label,
      state: mine.length ? "gap" : "met",
      /* BLOCKING IS READ OFF THE TIER rather than off the kinds a second time.
         Both spellings pick out the same hints, which is exactly the problem: a
         change to one leaves the other still answering, and nothing in the tree
         says which answer is the real one. Tier is the definition now. */
      blocking: tierOfHints(mine) === WORST_TIER,
      tier: tierOfHints(mine),
      rank: top ? rankOf(top) : 99,
      detail: top ? (catalog[top.code] || spec.label) : "",
      sections: mine.map(function (h) { return h.section; }),
    };
  }

  function measureDimension(spec, narratives) {
    var n = countRestatements(narratives);
    return {
      id: spec.id,
      label: spec.label,
      state: n ? "gap" : "met",
      blocking: false,
      /* Tier 2, not tier 3. A sentence that restates the count is not a
         sentence that reads badly, it is the observation a supervisor was
         looking for and did not get. */
      tier: n ? 2 : NO_TIER,
      rank: 98,
      detail: n
        ? n + " sentence" + (n > 1 ? "s restate" : " restates") + " data the EHR already attaches, say what the numbers cannot"
        : "",
      sections: [],
      count: n,
    };
  }

  /* No declared rubric, so grade by the severity the model already assigned.
     Weaker than named dimensions and honestly so: it says how bad, not what.

     IT TAKES THE CATALOG NOW, AND THAT IS THE FIX RATHER THAN A TIDY-UP. Its
     detail used to read "1 flagged", which becomes the pill's whole reason on
     the four tools that declare no rubric - a tally, on the surface this file
     exists to keep tallies off. The top hint's catalog text says the same thing
     in the words that fix it, which is what the named dimensions have always
     done one function above. */
  function bySeverity(hints, catalog) {
    var KINDS = [
      { kind: "blocks-claim", label: "Nothing a funder would reject" },
      { kind: "thin", label: "Clinical detail is there" },
      { kind: "register", label: "Reads like a clinician wrote it" },
    ];
    var cat = catalog || {};
    return KINDS.map(function (k) {
      var mine = hints.filter(function (h) { return h.kind === k.kind; });
      mine.sort(function (a, b) { return rankOf(a) - rankOf(b); });
      var top = mine[0];
      return {
        id: k.kind,
        label: k.label,
        state: mine.length ? "gap" : "met",
        blocking: mine.length > 0 && TIER_OF_KIND[k.kind] === WORST_TIER,
        tier: mine.length ? TIER_OF_KIND[k.kind] : NO_TIER,
        rank: mine.length ? rankOf(top) : 99,
        detail: top ? (cat[top.code] || k.label) : "",
        sections: mine.map(function (h) { return h.section; }),
      };
    });
  }

  /* Hints no declared dimension claims. Without this a code the rubric forgot
     to list would grade as though the model had never raised it - the same
     silent-drop shape as a hint code missing from the schema enum, and just as
     invisible from anywhere near the mistake. */
  var OTHER_SPEC = { id: "other", label: "Other flags" };

  function uncovered(hints, specs) {
    var claimed = {};
    specs.forEach(function (spec) {
      (spec.codes || []).forEach(function (c) { claimed[c] = true; });
    });
    return hints.filter(function (h) { return !claimed[h.code]; });
  }

  /* THE BAND, and why the grade carries one now.
   *
   * "One serious finding and five nitpicks must not score the same" was already
   * half true here: a claim-blocking hint grades missing and a register hint
   * grades thin. What was NOT true is anything downstream being able to tell a
   * thin note from a tidy note with three register flags on it. Both come back
   * level "thin", and the only thing that distinguished them was a count of
   * hints, which is the reading this file exists to refuse.
   *
   * So the grade reports the severity it graded on. `band` is the number of
   * GAP DIMENSIONS at each tier, never the number of hints - five register
   * findings inside one dimension are one thing wrong with the note, and
   * counting them five times is the tally again wearing a different hat.
   *
   * THE NUMERIC BAR IS NOT MINE TO PICK AND NONE IS PICKED. `level` still comes
   * off severity alone, exactly as it did: a blocking gap is missing, any other
   * gap is thin, no gap is good. Nothing here turns a count into a level. The
   * band is the input a learned bar would read when the maintainer rules on
   * one, and until then it is a reading and not a rule. */
  function bandOf(gaps) {
    var band = { 1: 0, 2: 0, 3: 0 };
    var worst = NO_TIER;
    gaps.forEach(function (d) {
      var t = typeof d.tier === "number" ? d.tier : NO_TIER;
      if (t === NO_TIER) return;
      band[t] = (band[t] || 0) + 1;
      if (t < worst) worst = t;
    });
    return { band: band, worstTier: worst === NO_TIER ? null : worst };
  }

  /* input: { output, narrativeIds, rubric, hintCatalog }
     returns { level, reason, dimensions, band, worstTier } */
  function grade(input) {
    var output = (input && input.output) || null;
    if (!output) return { level: "idle", reason: "", dimensions: [] };

    var ids = (input.narrativeIds || []);
    var narratives = {};
    ids.forEach(function (id) { narratives[id] = output[id]; });

    var hints = Array.isArray(output.hints) ? output.hints : [];
    var catalog = input.hintCatalog || {};
    var specs = input.rubric || null;

    var dimensions = [emptyDimension(narratives, ids)];
    if (specs) {
      specs.forEach(function (spec) {
        dimensions.push(spec.measure === "restates_data"
          ? measureDimension(spec, narratives)
          : hintDimension(spec, hints, catalog));
      });
      var residual = uncovered(hints, specs);
      if (residual.length) dimensions.push(hintDimension(OTHER_SPEC, residual, catalog));
    } else {
      dimensions = dimensions.concat(bySeverity(hints, catalog));
    }

    var gaps = dimensions.filter(function (d) { return d.state === "gap"; });
    var reading = bandOf(gaps);
    if (!gaps.length) {
      return {
        level: "good",
        reason: "Nothing flagged. Review it before you file it.",
        dimensions: dimensions,
        band: reading.band,
        worstTier: reading.worstTier,
      };
    }
    var blocking = gaps.filter(function (d) { return d.blocking; });
    var worst = (blocking.length ? blocking : gaps)
      .slice()
      .sort(function (a, b) { return rankOf(a) - rankOf(b); })[0];
    return {
      /* A blocking gap reds the pill, and blocking now MEANS tier 1 for every
         dimension read off hints. The empty-section dimension is the one that
         blocks at tier 2, because a blank narrative is a different fault from a
         rejectable claim and has always outranked both. Neither is a count. */
      level: blocking.length ? "missing" : "thin",
      reason: worst.detail || worst.label,
      dimensions: dimensions,
      band: reading.band,
      worstTier: reading.worstTier,
    };
  }

  window.NoteRubric = {
    grade: grade,
    restatesData: restatesData,
    sentences: sentences,
    MIN_OBSERVATION_WORDS: MIN_OBSERVATION_WORDS,
  };
})();
