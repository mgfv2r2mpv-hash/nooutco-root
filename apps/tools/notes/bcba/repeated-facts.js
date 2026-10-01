/* Repeat check for the supervision tool's narrative sections.
 *
 * WHAT THIS IS. One fact belongs in one section. This reads the drafted
 * narrative sections, finds a sentence that restates a sentence in another
 * section, and returns an ambiguous_item hint on the section holding the
 * repeat. It is a hint source only: it never edits a section, and it calls no
 * model.
 *
 * HOW IT DECIDES. Each sentence is cut to its content words (stopwords out,
 * a light plural and tense stem), and two sentences from different sections
 * match when the Jaccard overlap of those word sets reaches OVERLAP_MIN. A
 * sentence with fewer than CONTENT_MIN content words never matches, so a short
 * "It went well." cannot flag. A goal name or an antecedent strategy that two
 * sections legitimately both name shares a few words inside long, different
 * sentences, which stays under the threshold.
 *
 * WHERE THE HINT LANDS. On the later section in `order`, one hint per section,
 * with the earlier section's label in the detail ("Repeats Progress").
 *
 * The sentence counter is here too, so the section budgets can be tested
 * against canned outputs with the same splitting rule.
 */
(function () {
  "use strict";

  var OVERLAP_MIN = 0.5;
  var CONTENT_MIN = 4;
  var CODE = "ambiguous_item";

  var STOPWORDS = new Set(
    ("a an and are as at be been but by did do does for from had has have he her him his i in into is it its " +
      "no not of on or our she so that the their them then there they this to was we were what when which while " +
      "with would client both also very after before during again first about over under up out off than too").split(" ")
  );

  // A sentence ends at . ! ? (and any closing quote or bracket) when what
  // follows starts a new one. Lowercase after the stop is an abbreviation or a
  // quoted line continuing ("e.g. a day", '"Not now." and he left').
  var SENTENCE_END = /([.!?]["')\]]*)\s+(?=["'(\[]?[A-Z0-9])/g;
  var BULLET = /^\s*(?:[-*•◦]|\d+[.)])\s+/;

  function sentences(text) {
    if (typeof text !== "string") return [];
    var out = [];
    text.split(/\n+/).forEach(function (line) {
      var clean = line.replace(BULLET, "").trim();
      if (!clean) return;
      clean.replace(SENTENCE_END, "$1\u0000").split("\u0000").forEach(function (s) {
        var t = s.trim();
        if (t) out.push(t);
      });
    });
    return out;
  }

  function countSentences(text) {
    return sentences(text).length;
  }

  function stem(word) {
    if (word.length > 5 && /ing$/.test(word)) return word.slice(0, -3);
    if (word.length > 4 && /ed$/.test(word)) return word.slice(0, -2);
    if (word.length > 3 && /s$/.test(word) && !/ss$/.test(word)) return word.slice(0, -1);
    return word;
  }

  function contentWords(sentence) {
    var set = new Set();
    (sentence.toLowerCase().match(/[a-z]+/g) || []).forEach(function (w) {
      if (!STOPWORDS.has(w)) set.add(stem(w));
    });
    return set;
  }

  function jaccard(a, b) {
    var shared = 0;
    a.forEach(function (w) {
      if (b.has(w)) shared += 1;
    });
    return shared / (a.size + b.size - shared);
  }

  function profile(text) {
    return sentences(text)
      .map(contentWords)
      .filter(function (set) {
        return set.size >= CONTENT_MIN;
      });
  }

  function repeatsOf(later, earlier) {
    return later.some(function (a) {
      return earlier.some(function (b) {
        return jaccard(a, b) >= OVERLAP_MIN;
      });
    });
  }

  /* check(sections, { order, labels }) -> [{ section, code, detail }]
     `sections` maps a section id to its text. `order` lists the ids to compare,
     earliest first. `labels` maps an id to the wording used in the detail. */
  function check(sections, opts) {
    if (!sections || typeof sections !== "object") return [];
    var order = (opts && opts.order) || Object.keys(sections);
    var labels = (opts && opts.labels) || {};
    var profiles = order.map(function (id) {
      return { id: id, sets: profile(sections[id]) };
    });
    var hints = [];
    profiles.forEach(function (later, i) {
      if (!later.sets.length) return;
      var hit = profiles.slice(0, i).find(function (earlier) {
        return repeatsOf(later.sets, earlier.sets);
      });
      if (hit) hints.push({ section: later.id, code: CODE, detail: "Repeats " + (labels[hit.id] || hit.id) });
    });
    return hints;
  }

  window.RepeatedFacts = { check: check, countSentences: countSentences, sentences: sentences };
})();
