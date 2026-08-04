/* Register measurement for a generated note, computed in the browser.
 *
 * WHAT LEAVES THE PAGE: numbers. Sentence and word counts, ratios, and one
 * weighted total. Never a word, never a phrase, never a length in characters
 * that could be lined up against anything. The text measured here is already
 * de-identified, because it was generated from scrubbed input, but that is a
 * second line of defence rather than the reason this is safe.
 *
 * WHY THIS EXISTS. The SAP tool's output was flagged as AI written. Measuring
 * the first real post-change draft showed the mechanism: it named the client in
 * 64% of its sentences against 10 to 23% across seven human-written plans, its
 * opener variety was 0.76 and burstiness 0.43, both outside the entire human
 * range. None of that needed a detector to see. It needed somebody to look.
 * These numbers are what the weekly audit looks at so nobody has to remember to.
 *
 * The weighting mirrors scripts/style-score.mjs deliberately, so a number in the
 * Friday email means the same thing as a number from the command line. Change
 * one and you must change the other; tests/note-metrics.spec.js pins them
 * together.
 */
(function () {
  "use strict";

  // Function words carry style rather than content. A narrow, evenly shaped
  // distribution across them is one of the loudest machine writing signals.
  var FUNCTION_WORDS = [
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "for",
    "with", "was", "were", "is", "are", "be", "been", "this", "that", "these",
    "which", "as", "by", "from", "during", "while", "when", "after", "before",
  ];

  // Roles that count as naming an actor. Kept deliberately narrow: a false
  // positive here inflates a number the maintainer reads on a Friday.
  var ACTOR = /\b(technician|rbt|bcba|therapist|clinician|analyst|caregiver|parent|mother|father|guardian|teacher|staff|instructor|trainer|implementer)\b/i;

  // The placeholder the tools emit. Counted separately from actors because the
  // ceiling in the SAP prompt is specifically about this.
  var CLIENT = /\[?CLIENT\]?|\bclient\b|\blearner\b/i;

  function sentencesOf(text) {
    return String(text || "")
      .split(/(?<=[.!?])\s+|\n+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.split(/\s+/).length > 2; });
  }

  function wordsOf(text) {
    return String(text || "").toLowerCase().match(/[a-z][a-z'-]*/g) || [];
  }

  function stdev(xs) {
    if (xs.length < 2) return 0;
    var mean = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
    var v = xs.reduce(function (a, b) { return a + Math.pow(b - mean, 2); }, 0) / (xs.length - 1);
    return Math.sqrt(v);
  }

  function round(x, places) {
    var p = Math.pow(10, places == null ? 3 : places);
    return Math.round(x * p) / p;
  }

  function measure(text) {
    var sents = sentencesOf(text);
    var words = wordsOf(text);
    if (!sents.length || words.length < 30) return null;

    var lens = sents.map(function (s) { return wordsOf(s).length; })
      .filter(function (n) { return n > 0; });
    var mean = lens.length
      ? lens.reduce(function (a, b) { return a + b; }, 0) / lens.length
      : 0;

    // Human prose varies sentence length a lot; generated prose converges on a
    // house length. Expressed as a coefficient of variation.
    var burstiness = mean ? stdev(lens) / mean : 0;

    var window = words.slice(0, 400);
    var seen = {};
    var uniq = 0;
    for (var i = 0; i < window.length; i++) {
      if (!seen[window[i]]) { seen[window[i]] = 1; uniq++; }
    }
    var typeTokenRatio = window.length ? uniq / window.length : 0;

    var counts = FUNCTION_WORDS.map(function (w) {
      return words.filter(function (x) { return x === w; }).length;
    });
    var total = counts.reduce(function (a, b) { return a + b; }, 0);
    var entropy = 0;
    if (total) {
      for (var j = 0; j < counts.length; j++) {
        if (!counts[j]) continue;
        var p = counts[j] / total;
        entropy -= p * (Math.log(p) / Math.log(2));
      }
      entropy /= Math.log(FUNCTION_WORDS.length) / Math.log(2);
    }

    var grams = {};
    var gramCount = 0;
    for (var k = 0; k + 4 <= words.length; k++) {
      var g = words.slice(k, k + 4).join(" ");
      if (!grams[g]) { grams[g] = 0; gramCount++; }
      grams[g]++;
    }
    var repeated = 0;
    for (var key in grams) { if (grams[key] > 1) repeated++; }
    var repeatRate = gramCount ? repeated / gramCount : 0;

    // How many sentences open the same way. "The technician..." five times
    // running is the most recognisable tic in these documents.
    var openers = sents.map(function (s) { return wordsOf(s).slice(0, 2).join(" "); })
      .filter(Boolean);
    var openerSeen = {};
    var openerUniq = 0;
    var maxRepeat = 0;
    for (var m = 0; m < openers.length; m++) {
      if (!openerSeen[openers[m]]) { openerSeen[openers[m]] = 0; openerUniq++; }
      openerSeen[openers[m]]++;
      if (openerSeen[openers[m]] > maxRepeat) maxRepeat = openerSeen[openers[m]];
    }
    var openerVariety = openers.length ? openerUniq / openers.length : 0;

    var actorSents = sents.filter(function (s) { return ACTOR.test(s); }).length;
    var clientSents = sents.filter(function (s) { return CLIENT.test(s); }).length;
    var commaRate = sents.length
      ? (String(text).match(/,/g) || []).length / sents.length
      : 0;

    var m2 = {
      sentences: sents.length,
      words: words.length,
      meanLen: round(mean, 2),
      burstiness: round(burstiness),
      typeTokenRatio: round(typeTokenRatio),
      entropy: round(entropy),
      repeatRate: round(repeatRate),
      openerVariety: round(openerVariety),
      commaRate: round(commaRate, 2),
      actorRate: round(sents.length ? actorSents / sents.length : 0),
      clientRate: round(sents.length ? clientSents / sents.length : 0),
      topOpenerRepeat: maxRepeat,
    };
    m2.score = score(m2);
    return m2;
  }

  // Same weights as scripts/style-score.mjs. Higher means more machine uniform,
  // which is worse. The absolute number only means something next to the
  // measured human band, which runs 12 to 24 on the seven plans.
  function score(m) {
    var clamp = function (x) { return Math.max(0, Math.min(1, x)); };
    var parts =
      clamp(1 - m.burstiness / 0.6) * 30 +
      clamp(1 - m.openerVariety) * 25 +
      clamp(1 - m.typeTokenRatio / 0.55) * 20 +
      clamp(m.entropy) * 10 +
      clamp(m.repeatRate * 8) * 10 +
      clamp(1 - Math.abs(m.commaRate - 1.1) / 1.1) * 5;
    return Math.round(parts);
  }

  window.NoteMetrics = { measure: measure, score: score };
})();
