/* Measuring how a technician rewrote a draft, without keeping what they wrote.
 *
 * When a technician revises a generated note -- either by asking for a revision
 * or by typing over it -- the difference between the two versions says something
 * about how they write. This turns that difference into a handful of numbers.
 *
 * WHAT LEAVES THE PAGE: a feature name from a closed list, a direction (-1 or
 * 1), and a magnitude between 0 and 1. Nothing else. Not the words that
 * changed, not the sentence they appeared in, not a length in characters that
 * could be correlated back to anything. The text being measured is already
 * de-identified -- it is generated from scrubbed input -- but that is a second
 * line of defence, not the reason this is safe.
 *
 * SIGN CONVENTION: direction is always sign(after - before). Every rule template
 * in apps/profile-api/src/features.js is written to match, so "-1" always means
 * the technician moved that measure down.
 *
 * Exposes window.NoteStyleFeatures.compare(before, after, source)
 *   -> [{feature, direction, magnitude, source}]
 */
(function () {
  "use strict";

  // Below this there is not enough text for a mean to mean anything, and a
  // one-line tweak should not cast a vote about someone's whole voice.
  var MIN_WORDS = 25;

  // A relative change smaller than this is noise -- reflowing a sentence moves
  // most of these measures a little.
  var NOISE_FLOOR = 0.08;

  // Phrases that name who performed a step. The single loudest register signal
  // in these notes: actorless procedural prose is what reads as machine-written,
  // and it is also worse documentation.
  var ACTOR = /\b(the\s+(behavior\s+technician|technician|bcba|caregiver|parent|client|learner|therapist|rbt)|i|we)\b/gi;

  var HEDGE = /\b(appeared?\s+to|seem(?:ed|s)?\s+to|somewhat|perhaps|possibly|apparently|may\s+have|might\s+have|tended\s+to|relatively|fairly)\b/gi;

  var CONTRACTION = /\b\w+['’](?:s|t|re|ve|ll|d|m)\b/gi;

  // Stands in for clause complexity: commas plus the words that introduce a
  // subordinate clause.
  var SUBORDINATOR = /\b(because|although|though|while|whereas|since|after|before|when|which|that|who|if|unless|until)\b/gi;

  // Digits and written cardinals -- the counts, trial totals and durations a
  // payer actually reads.
  var NUMERAL = /\b(\d+(?:\.\d+)?%?|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi;

  function countOf(text, re) {
    var m = text.match(re);
    return m ? m.length : 0;
  }

  function sentencesOf(text) {
    return text
      .split(/(?<=[.!?])\s+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 1; });
  }

  function wordsOf(text) {
    return text.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  }

  /* Opener variety: the share of sentence openings that are distinct, keyed on
   * the first two words. A passage whose every sentence starts "The technician"
   * sits near zero; one that changes where each sentence enters sits at one.
   *
   * Two words rather than one, because "The technician" and "The client" are
   * genuinely different openings while a one-word key would call them the same.
   * Two rather than three, because a third word starts tracking the content of
   * the sentence rather than its construction.
   *
   * This is already a proportion, so unlike the other measures it is not divided
   * by anything afterwards. It rises when repeated openings are rewritten apart,
   * which is the direction the sign convention has to preserve: a technician who
   * removes repeated openings has moved this measure UP. */
  function openerVariety(sentences) {
    var seen = Object.create(null);
    var distinct = 0;
    var counted = 0;
    for (var i = 0; i < sentences.length; i++) {
      var key = wordsOf(sentences[i]).slice(0, 2).join(" ").toLowerCase();
      if (!key) continue; // a fragment of digits or punctuation opens on nothing
      counted++;
      if (!seen[key]) {
        seen[key] = true;
        distinct++;
      }
    }
    // Nothing to repeat is not evidence of repetition, so the empty case sits at
    // the neutral end rather than reading as maximum sameness.
    return counted ? distinct / counted : 1;
  }

  /* Reduce a passage to the measures we compare. Everything is a rate or a mean
   * so that a longer rewrite is not mistaken for a change in style. */
  function measure(text) {
    var clean = String(text == null ? "" : text);
    var sentences = sentencesOf(clean);
    var words = wordsOf(clean);
    var n = words.length;
    if (!n || !sentences.length) return null;

    var longWords = words.filter(function (w) { return w.length >= 9; }).length;
    var commas = countOf(clean, /,/g);

    return {
      words: n,
      sentence_length: n / sentences.length,
      // Long words are a rough proxy for Latinate register. Rough is fine: it
      // only ever has to detect a consistent direction of travel.
      plain_wording: longWords / n,
      actor_naming: countOf(clean, ACTOR) / sentences.length,
      hedging: countOf(clean, HEDGE) / n,
      contractions: countOf(clean, CONTRACTION) / n,
      clause_density: (commas + countOf(clean, SUBORDINATOR)) / sentences.length,
      quantification: countOf(clean, NUMERAL) / n,
      opener_variety: openerVariety(sentences),
    };
  }

  var FEATURES = [
    "sentence_length",
    "plain_wording",
    "actor_naming",
    "hedging",
    "contractions",
    "clause_density",
    "quantification",
    "opener_variety",
  ];

  /* Relative change, guarding the case where the measure started at zero --
   * going from "no hedges at all" to "one hedge" is a real signal but not an
   * infinite one. */
  function relativeChange(before, after) {
    if (before === after) return 0;
    var base = Math.max(before, 0.02);
    return (after - before) / base;
  }

  /**
   * @param {string} before  the text as generated
   * @param {string} after   the text as the technician left it
   * @param {"revision"|"manual"} source
   * @returns {Array<{feature, direction, magnitude, source}>}
   */
  function compare(before, after, source) {
    var a = measure(before);
    var b = measure(after);
    if (!a || !b) return [];

    // Judge on the shorter of the two: a note that was barely written, or an
    // edit that gutted it, gives a mean too unstable to learn from.
    if (Math.min(a.words, b.words) < MIN_WORDS) return [];

    var out = [];
    for (var i = 0; i < FEATURES.length; i++) {
      var f = FEATURES[i];
      var rel = relativeChange(a[f], b[f]);
      if (!isFinite(rel) || Math.abs(rel) < NOISE_FLOOR) continue;

      // Saturate at a doubling/halving. Beyond that it is emphatic, not more
      // informative, and one dramatic edit should not outweigh five ordinary
      // ones -- the evidence count is what carries that.
      var magnitude = Math.min(1, Math.abs(rel));

      out.push({
        feature: f,
        direction: rel > 0 ? 1 : -1,
        magnitude: Math.round(magnitude * 100) / 100,
        source: source === "manual" ? "manual" : "revision",
      });
    }
    return out;
  }

  window.NoteStyleFeatures = { compare: compare, _measure: measure, FEATURES: FEATURES };
})();
