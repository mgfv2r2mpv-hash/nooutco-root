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

  function avg(xs) {
    return xs.length ? xs.reduce(function (a, b) { return a + b; }, 0) / xs.length : 0;
  }

  function stdev(xs) {
    if (xs.length < 2) return 0;
    var mean = avg(xs);
    var v = xs.reduce(function (a, b) { return a + Math.pow(b - mean, 2); }, 0) / (xs.length - 1);
    return Math.sqrt(v);
  }

  /* A SECTION is a blank-line block, which is not a guess: the caller builds the
     text it hands us by joining the tool's own form sections with "\n\n". So a
     block here is a section of the note as the tool defines one, and a bullet
     list stays inside its block rather than becoming a section per bullet.

     WHY SECTIONS ARE MEASURED SEPARATELY AT ALL. burstiness, the whole-note
     figure, is a MIXTURE of two nearly unrelated things. Across 108 human
     documents it correlates 0.448 with variability inside a section and 0.384
     with the step between them, while those two correlate only 0.096 with each
     other. So a note can hold a healthy whole-note number while every section
     reads flat, by swinging the average from one section to the next. 21 human
     documents sit at a whole-note figure of 0.60 give or take 0.03, and among
     just those, variability inside a section runs 0.373 to 0.583. One number
     does not identify a shape, and measuring only the whole note cannot see the
     difference. */
  var MIN_SECTION_SENTS = 3; // Below three, a coefficient of variation is noise.

  /* Blank lines only, and the single newlines inside a block are deliberately
     left alone. sentencesOf treats a newline as a sentence boundary, so a
     bulleted line counts as its own short sentence here exactly as it does in
     the whole-document numbers. Collapsing the whitespace first would glue
     bullets into one long sentence and quietly put the two measurements in
     different dialects. */
  function sectionsOf(text) {
    return String(text || "").split(/\n[ \t]*\n+/)
      .map(function (p) { return p.trim(); })
      .filter(Boolean);
  }

  /* Returns null for either number that the text cannot support, rather than a
     zero. A zero here would be folded into a technician's running profile as a
     real observation of perfect flatness. */
  function sectionShape(text) {
    var lensBySection = [];
    var blocks = sectionsOf(text);
    for (var i = 0; i < blocks.length; i++) {
      var lens = sentencesOf(blocks[i]).map(function (s) { return wordsOf(s).length; })
        .filter(function (n) { return n > 0; });
      if (lens.length >= MIN_SECTION_SENTS) lensBySection.push(lens);
    }
    if (!lensBySection.length) return { sectionCv: null, sectionStep: null, sections: 0 };

    // Pooled by sentence count, so a three sentence section does not weigh as
    // much as a twenty sentence one.
    var weighted = [];
    var means = [];
    for (var j = 0; j < lensBySection.length; j++) {
      var L = lensBySection[j];
      var m = avg(L);
      means.push(m);
      var cv = m ? stdev(L) / m : 0;
      for (var k = 0; k < L.length; k++) weighted.push(cv);
    }

    var step = null;
    if (means.length >= 2) {
      var steps = [];
      for (var t = 1; t < means.length; t++) steps.push(Math.abs(means[t] - means[t - 1]));
      var grand = avg(means);
      if (grand) step = avg(steps) / grand;
    }
    return { sectionCv: avg(weighted), sectionStep: step, sections: lensBySection.length };
  }

  function round(x, places) {
    var p = Math.pow(10, places == null ? 3 : places);
    return Math.round(x * p) / p;
  }


  /* Constructions that a detector reacts to and a length measure cannot see.
     Derived from a real minimal pair: the same narrative scored 53% and then 0%
     after the clinician edited it, with sentence count, length, burstiness and
     opener variety all unchanged. Six things moved and four of them are these. */
  var EMPTY_ADVERB = /\b(proactively|actively|effectively|appropriately|successfully|systematically|thoroughly|carefully)\b/gi;
  var PARTICIPIAL_CAUSAL = /\bby (ensuring|providing|allowing|offering|delivering|maintaining|utilizing|promoting)\b/gi;
  var ABSTRACT_STATE = /\b(motivational state|behavioral response|behavioral presentation|emotional state|engagement level|response pattern|behavioral pattern|activity level)\b/gi;
  var VAGUE_VERB = /\b(support|supported|supports|facilitate[sd]?|promote[sd]?|enhance[sd]?|address(?:ed|es)?)\b/gi;

  function constructions(text) {
    var s = String(text || "");
    var n = function (re) { return (s.match(re) || []).length; };
    return {
      emptyAdverbs: n(EMPTY_ADVERB),
      participialCausals: n(PARTICIPIAL_CAUSAL),
      abstractStates: n(ABSTRACT_STATE),
      vagueVerbs: n(VAGUE_VERB),
    };
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

    var shape = sectionShape(text);

    var m2 = {
      sentences: sents.length,
      words: words.length,
      meanLen: round(mean, 2),
      burstiness: round(burstiness),
      sections: shape.sections,
      typeTokenRatio: round(typeTokenRatio),
      entropy: round(entropy),
      repeatRate: round(repeatRate),
      openerVariety: round(openerVariety),
      commaRate: round(commaRate, 2),
      actorRate: round(sents.length ? actorSents / sents.length : 0),
      clientRate: round(sents.length ? clientSents / sents.length : 0),
      topOpenerRepeat: maxRepeat,
    };
    /* Variability INSIDE a section, and how far the average moves BETWEEN them.
       These two are what the shape profile is learned from. burstiness above is
       kept because the score and the weekly report both read it, but it is the
       whole-note figure and it is a mixture of these two: across 108 human
       documents it correlates 0.448 and 0.384 with them while they correlate
       only 0.096 with each other. It cannot tell the two apart.

       ABSENT rather than null when the text cannot support them, so every value
       this returns stays a number. That invariant is what proves no fragment of
       a note can ride out in an audit payload, and it is worth more than the
       convenience of a placeholder. */
    if (shape.sectionCv !== null) m2.sectionCv = round(shape.sectionCv);
    if (shape.sectionStep !== null) m2.sectionStep = round(shape.sectionStep);

    var flags = constructions(text);
    var per100 = function (n) { return round((100 * n) / Math.max(words.length, 1), 2); };
    m2.emptyAdverbs = flags.emptyAdverbs;
    m2.participialCausals = flags.participialCausals;
    m2.abstractStates = flags.abstractStates;
    m2.vagueVerbs = flags.vagueVerbs;
    // One number for the weekly report. Counted per 100 words, since the
    // question is density rather than total.
    m2.flaggedPer100 = per100(flags.emptyAdverbs + flags.participialCausals
      + flags.abstractStates + flags.vagueVerbs);
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
      clamp(m.repeatRate * 8) * 10;
    // The comma term is gone here too, and must stay gone: this mirrors
    // scripts/style-score.mjs deliberately so a number in the Friday email
    // means the same as one from the command line. It correlated -0.05 with
    // the real detector and penalised six of seven human plans. commaRate is
    // still measured and reported, it just no longer scores.
    return Math.round(parts);
  }

  window.NoteMetrics = { measure: measure, score: score, constructions: constructions };
})();
