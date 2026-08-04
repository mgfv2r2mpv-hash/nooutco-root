/* The technician's own voice, measured from what they typed today.
 *
 * WHY THIS EXISTS. Measuring the tool on 2026-08-04 produced an uncomfortable
 * result: rewriting the register did not move the uniformity score at all. Both
 * the old prompt and the new one scored 26 on the same intake. What moved it,
 * to 16, was two rounds of the technician revising by hand.
 *
 * The reason is that the old prompt said "one idea per sentence" and produced
 * 8.2-word sentences, and the new one said "name the actor" and produced
 * 20.1-word sentences. Both obeyed. Both were UNIFORM, and uniformity is the
 * signal, not length. An instruction to "vary sentence length" does not survive
 * contact with a first draft, because it is a preference with nothing to
 * measure it against.
 *
 * So this measures something real instead: the shape of the technician's own
 * writing, in this note, today. Their mean sentence length, how much they mix,
 * whether they use contractions, whether they write fragments. That becomes a
 * target the draft can be held to and, more importantly, revised against.
 *
 * WHAT IT IS NOT. It is not a house style and not a stored profile. That is the
 * style card, which is slow, cross-session and content-free. This is fast,
 * local and thrown away when the page reloads: "the energy they brought to this
 * note", in his words, rather than who they are as a writer.
 *
 * NOTHING LEAVES THE PAGE. The numbers here are used to build a sentence of
 * prompt text that travels with the intake it was derived from. No metric is
 * stored, transmitted separately, or attached to anyone.
 */
(function () {
  "use strict";

  /* Clinical documentation has a floor. A technician typing "elopement x2,
     blocked" is writing shorthand for themselves, not prose for a payer, so
     copying a 4-word mean into the note would produce something unusable.
     These bounds are where a professional note actually lives; his rule was
     "pegged from the BT, but inflated a bit if the technician is too brief". */
  var FLOOR = 12;   // below this a note reads as clipped and machine-terse
  var CEILING = 24; // above this it reads as padded and machine-fluent
  var MIN_WORDS = 25;

  function sentencesOf(text) {
    return String(text || "")
      // Shorthand is line-broken as often as it is punctuated, so a newline
      // ends a thought here even without a full stop. Measuring intake as one
      // 90-word sentence would report a mean nobody wrote.
      .split(/(?<=[.!?])\s+|\n+/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 1; });
  }

  function wordsOf(text) {
    return String(text || "").toLowerCase().match(/[a-z][a-z'-]*/g) || [];
  }

  function median(xs) {
    if (!xs.length) return 0;
    var s = xs.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /** Measure the raw intake. Returns null when there is too little to read. */
  function measure(text) {
    var sents = sentencesOf(text);
    var words = wordsOf(text);
    if (sents.length < 2 || words.length < MIN_WORDS) return null;

    var lens = sents.map(function (s) { return wordsOf(s).length; })
      .filter(function (n) { return n > 0; });
    if (lens.length < 2) return null;

    var mean = lens.reduce(function (a, b) { return a + b; }, 0) / lens.length;
    var sorted = lens.slice().sort(function (a, b) { return a - b; });

    // Median rather than mean for the target, because one long run-on line in
    // otherwise clipped shorthand should not drag the whole note long.
    var mid = median(lens);

    return {
      sentences: lens.length,
      words: words.length,
      mean: Math.round(mean * 10) / 10,
      median: mid,
      shortest: sorted[0],
      longest: sorted[sorted.length - 1],
      // Their own mixing, as a coefficient of variation. If they already mix,
      // say so and let the note follow; if they do not, the note still should.
      spread: mean ? Math.round((stdev(lens) / mean) * 100) / 100 : 0,
      contractions: /\b\w+'(s|t|re|ve|ll|d|m)\b/i.test(text),
      // A technician who types "no SIB today" writes fragments. That is a real
      // feature of their voice and a note may echo it once or twice.
      fragments: lens.filter(function (n) { return n <= 5; }).length,
      thin: words.length < 60,
    };
  }

  function stdev(xs) {
    var m = xs.reduce(function (a, b) { return a + b; }, 0) / xs.length;
    var v = xs.reduce(function (a, b) { return a + Math.pow(b - m, 2); }, 0) / xs.length;
    return Math.sqrt(v);
  }

  /** The target shape for the drafted note, derived from theirs. */
  function target(m) {
    if (!m) return null;
    // Peg to their median, then pull it inside the professional band. A
    // technician writing 6-word shorthand gets 12; one writing 30-word
    // run-ons gets 24. Neither is copied literally.
    var centre = Math.max(FLOOR, Math.min(CEILING, Math.round(m.median * 1.6)));
    return {
      centre: centre,
      // The band is what stops the draft converging. Deliberately wide.
      low: Math.max(5, Math.round(centre * 0.45)),
      high: Math.round(centre * 1.7),
      contractions: m.contractions,
      echoFragments: m.fragments >= 2,
      thin: m.thin,
    };
  }

  /** The prompt text. Empty string when there is nothing measurable, which is
   *  what makes this fail open: the note drafts exactly as it did before. */
  function block(text) {
    var m = measure(text);
    var t = target(m);
    if (!t) return "";

    var lines = [
      "",
      "VOICE OF THIS TECHNICIAN, TODAY",
      "Measured from the notes they just typed, not from a style guide. Match the",
      "shape of their writing while keeping the clinical register.",
      "- Aim for a MEDIAN sentence of about " + t.centre + " words.",
      "- Vary genuinely around it: some sentences near " + t.low + " words, some near " +
        t.high + ". Do not settle on one length. A note where every sentence is the same",
      "  length reads as machine-written whether that length is short or long, and that is",
      "  the single strongest signal there is.",
    ];
    if (t.contractions) {
      lines.push("- They use contractions. One or two in the narrative is in their voice; do not force them.");
    }
    if (t.echoFragments) {
      lines.push("- They write in fragments when the fact is small (\"no SIB today\"). Echoing that once or twice is theirs, not sloppiness.");
    }
    if (t.thin) {
      lines.push("- Their notes are SHORT today. Do not pad to reach a length. Write what is supported, stop, and raise a hint asking for the missing detail. Filler is worse than a brief note.");
    }
    return lines.join("\n") + "\n";
  }

  window.IntakeVoice = { measure: measure, target: target, block: block };
})();
