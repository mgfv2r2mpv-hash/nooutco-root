/* SAP number checks: the figures in a SAP draft read against each other and
 * against the BCBA's own numbers.
 *
 * WHERE THIS CAME FROM. Kaleb's SAP bench run, 2026-10-09 (card
 * sap-note-accuracy). The waiting draft started at 15 seconds while saying it
 * "starts below current baseline (10 seconds)", planned 15-second steps that
 * cannot reach 2 minutes by the session it named, and called maintenance
 * "pass 2 of 3" at 80%. The bench passed all three cases anyway, because the
 * bench reads for phrases and none of these is a missing phrase.
 *
 * WHAT IT DOES. Five exact checks, each over the draft's own text:
 *   a fraction ("2 of 3 trials") beside a percentage it does not equal;
 *   a percentage of a trial count that is not a whole number of trials;
 *   a start value called below (or above) baseline that is not;
 *   a step plan that cannot reach its target by the session it names;
 *   two different re-entry counts in the maintenance rules.
 *
 * WHAT IT NEVER DOES. Rewrite. Each check raises a hint that names the numbers,
 * and the BCBA decides. A number rule that silently "fixes" a plan is a plan
 * the clinician did not write and did not see change.
 *
 * Pure: no DOM, no network. Exposes window.SapNumbers. sap-checks.js calls it
 * and also borrows its text helpers.
 */
(function () {
  "use strict";

  var WORD_NUMBERS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    single: 1,
  };
  var NUM = "(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|single)";
  var UNIT = "(seconds?|secs?|s|minutes?|mins?|min)";
  var DURATION_SRC = "\\b" + NUM + "[-\\s]*" + UNIT + "\\b";

  // A fraction counted in sessions, probes or people is a schedule, not an
  // accuracy: "80% on 2 of 3 probes" is two numbers about two things.
  var COUNT_NOUNS = /^(?:sessions?|probes?|days?|weeks?|months?|visits?|settings?|staff|people|adults?|caregivers?|environments?|routines?|consecutive|different|data)$/i;

  var REENTRY_WORDS = /re-?ent(?:er|ry|ers)|return(?:s|ed)? to (?:teaching|acquisition|instruction)|back to (?:teaching|acquisition)|contact (?:the )?BCBA|re-?teach|reintroduc\w*/i;

  function text(v) {
    return typeof v === "string" ? v : "";
  }

  function toNumber(raw) {
    var w = String(raw).toLowerCase();
    return Object.prototype.hasOwnProperty.call(WORD_NUMBERS, w) ? WORD_NUMBERS[w] : parseFloat(w);
  }

  function toSeconds(n, unit) {
    return /^m/i.test(unit) ? n * 60 : n;
  }

  function fmt(seconds) {
    return seconds >= 60 && seconds % 60 === 0 ? seconds / 60 + " min" : seconds + " s";
  }

  function pct(n) {
    return Math.round(n * 10) / 10 + "%";
  }

  /* Lines first, then sentences inside a line. A clinician's shorthand starts
     sentences in lower case ("at snack. grabs items when..."), so any full stop
     and space ends one, except after the abbreviations a plan actually uses. */
  var ABBREV_END = /\b(?:e\.g|i\.e|vs|etc|approx|cf)\.$/i;

  function sentences(str) {
    return text(str).split(/\n+/).reduce(function (acc, line) {
      var parts = line.split(/(?<=[.!?])\s+/).reduce(function (out, piece) {
        if (out.length && ABBREV_END.test(out[out.length - 1])) {
          return out.slice(0, -1).concat(out[out.length - 1] + " " + piece);
        }
        return out.concat(piece);
      }, []);
      return acc.concat(parts);
    }, []).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function durations(str) {
    var out = [];
    var re = new RegExp(DURATION_SRC, "gi");
    var m;
    while ((m = re.exec(text(str)))) {
      out.push({ seconds: toSeconds(toNumber(m[1]), m[2]), index: m.index, text: m[0] });
    }
    return out;
  }

  function firstDuration(str) {
    var d = durations(str);
    return d.length ? d[0].seconds : null;
  }

  function hint(section, detail) {
    return { section: section, code: "ambiguous_item", kind: "thin", rank: 0, detail: detail };
  }

  /* 1. "2 of 3" beside "80%". The fraction must equal one of the percentages in
     its own sentence, unless it counts sessions, probes or people. */
  function fractionMismatch(sentence) {
    var percents = [];
    sentence.replace(/(\d{1,3}(?:\.\d+)?)\s?%/g, function (_, p) { percents.push(parseFloat(p)); return _; });
    if (!percents.length) return null;
    var re = /\b(\d+)\s*(?:of|out of|\/)\s*(\d+)\b((?:\s+[a-z]+){0,2})/gi;
    var m;
    while ((m = re.exec(sentence))) {
      var x = parseInt(m[1], 10);
      var y = parseInt(m[2], 10);
      var nouns = m[3].trim().split(/\s+/).filter(Boolean);
      if (!y || x > y || nouns.some(function (w) { return COUNT_NOUNS.test(w); })) continue;
      var value = (100 * x) / y;
      var matches = percents.some(function (p) { return Math.abs(p - value) < 1; });
      if (!matches) return x + " of " + y + " is " + pct(value) + ", but the same sentence says " + percents[0] + "%.";
    }
    return null;
  }

  /* 2. "80%" of a "3-trial" probe. A trial count stated as a minimum is left
     alone, because the real count can be higher. */
  function trialCounts(str) {
    var out = [];
    var re = new RegExp("\\b" + NUM + "[-\\s]+(?:[a-z]+[-\\s]+)?trials?\\b", "gi");
    var m;
    while ((m = re.exec(str))) {
      var before = str.slice(Math.max(0, m.index - 16), m.index);
      if (/(?:minimum(?: of)?|at least|min\.?)\s*$/i.test(before)) continue;
      out.push(toNumber(m[1]));
    }
    return out;
  }

  function percentsIn(str) {
    var out = [];
    str.replace(/(\d{1,3}(?:\.\d+)?)\s?%/g, function (_, p) { out.push(parseFloat(p)); return _; });
    return out;
  }

  function uniq(list) {
    return list.filter(function (v, i) { return list.indexOf(v) === i; });
  }

  /* A percentage is a whole count of n trials when it sits within half a point
     of 100k/n for some whole k: 67%, 66.7% and 33% are 2 of 3, 2 of 3 and 1 of
     3, as written. Reviewer R334-H1: the first cut demanded an exact product
     and flagged every rounded percentage, including the one the prompt itself
     tells the drafter to write. */
  var ROUNDING = 0.5;

  function wholeTrialsMessage(p, n) {
    var exact = (p * n) / 100;
    var nearest = Math.round(exact);
    if (Math.abs(p - (100 * nearest) / n) <= ROUNDING) return null;
    var lo = Math.floor(exact);
    var hi = Math.ceil(exact);
    return p + "% of " + n + " trials is " + Math.round(exact * 10) / 10 + " trials. Say " +
      lo + " of " + n + " (" + pct((100 * lo) / n) + ") or " + hi + " of " + n + " (" + pct((100 * hi) / n) + ").";
  }

  function trialPercentMismatch(sectionText) {
    var bySentence = sentences(sectionText).map(function (s) {
      var n = uniq(trialCounts(s));
      var p = uniq(percentsIn(s));
      return n.length === 1 && p.length === 1 ? wholeTrialsMessage(p[0], n[0]) : null;
    }).filter(Boolean)[0];
    if (bySentence) return bySentence;
    var n = uniq(trialCounts(sectionText));
    var p = uniq(percentsIn(sectionText));
    return n.length === 1 && p.length === 1 ? wholeTrialsMessage(p[0], n[0]) : null;
  }

  /* 3. Below or above baseline. The baseline is the figure the draft quotes
     beside the word, else the BCBA's own figure from the intake. The start is
     the figure the draft says it starts at. */
  var BASELINE_CLAIM = /\b(below|under|less than|shorter than|lower than|beneath|above|over|longer than|more than|higher than)\s+(?:(?:the|his|her|their|its|current|present|measured|\[CLIENT\]'s)\s+)*baseline\b/i;

  function startValue(str) {
    var re = new RegExp("\\b(?:start\\w*|initial\\w*|begin\\w*|first)\\b([^.\\n\\d]{0,40}?)" + NUM + "[-\\s]*" + UNIT + "\\b", "gi");
    var m;
    while ((m = re.exec(str))) {
      if (/baseline/i.test(m[1])) continue;
      return toSeconds(toNumber(m[2]), m[3]);
    }
    return null;
  }

  // The BCBA's own current figure: a duration in a sentence that describes now,
  // not the goal ("will tolerate a 2-minute wait" is where he is going).
  function clinicianBaseline(clinician) {
    var hit = sentences(clinician).filter(function (s) {
      return !/\bwill\b/i.test(s) && /baseline|current|right now|\bnow\b|\bwaits?\b|tolerat|lasts?|before|about|usually/i.test(s) && durations(s).length;
    })[0];
    return hit ? firstDuration(hit) : null;
  }

  function baselineMismatch(sectionText, clinician) {
    var claimSentence = sentences(sectionText).filter(function (s) { return BASELINE_CLAIM.test(s); })[0];
    if (!claimSentence) return null;
    var claim = claimSentence.match(BASELINE_CLAIM);
    var after = claimSentence.slice(claim.index + claim[0].length, claim.index + claim[0].length + 40);
    var base = firstDuration(after);
    if (base === null) base = clinicianBaseline(clinician);
    var start = startValue(sectionText);
    if (start === null) {
      var others = durations(claimSentence).filter(function (d) { return d.seconds !== base; });
      start = others.length ? others[0].seconds : null;
    }
    if (base === null || start === null) return null;
    var below = /^(below|under|less|shorter|lower|beneath)/i.test(claim[1]);
    if (below && start >= base) return "Says below baseline (" + fmt(base) + ") but starts at " + fmt(start) + ".";
    if (!below && start <= base) return "Says above baseline (" + fmt(base) + ") but starts at " + fmt(start) + ".";
    return null;
  }

  /* 4. A step plan that cannot reach its target by the session it names. Each
     step takes at least one session, or the number of sessions the draft says
     a step needs. The plan's parts can sit in different blocks, so this reads
     the whole draft and reports where the step size is written. */
  function stepSize(str) {
    var a = new RegExp("\\b(?:increas\\w*|add\\w*|extend\\w*|lengthen\\w*|rais\\w*|advanc\\w*)\\b[^.\\n\\d]{0,30}?\\bby\\s+" + NUM + "[-\\s]*" + UNIT + "\\b", "i").exec(str);
    if (a) return toSeconds(toNumber(a[1]), a[2]);
    var b = new RegExp("\\b" + NUM + "[-\\s]*" + UNIT + "[-\\s]+(?:steps?|increments?)\\b", "i").exec(str);
    if (b) return toSeconds(toNumber(b[1]), b[2]);
    var c = new RegExp("\\bincrements?\\s+of\\s+" + NUM + "[-\\s]*" + UNIT + "\\b", "i").exec(str);
    return c ? toSeconds(toNumber(c[1]), c[2]) : null;
  }

  function targetValue(draft, clinician) {
    var re = new RegExp("\\b(?:up to|to reach|reaching|reaches|until|target(?:\\s+of)?|terminal\\s+\\w+(?:\\s+of)?|goal(?:\\s+of)?|to)\\s+(?:a\\s+|the\\s+)?" + NUM + "[-\\s]*" + UNIT + "\\b", "gi");
    var best = null;
    var m;
    while ((m = re.exec(draft))) {
      var v = toSeconds(toNumber(m[1]), m[2]);
      if (best === null || v > best) best = v;
    }
    if (best !== null) return best;
    var goal = sentences(clinician).filter(function (s) { return /\bwill\b/i.test(s); }).join(" ");
    var all = durations(goal);
    return all.length ? Math.max.apply(null, all.map(function (d) { return d.seconds; })) : null;
  }

  function deadlineSession(str) {
    var m = new RegExp("\\bby\\s+(?:the\\s+end\\s+of\\s+)?session\\s+" + NUM + "\\b|\\bby\\s+the\\s+(\\d+)(?:st|nd|rd|th)\\s+session\\b|\\bwithin\\s+(?:the\\s+first\\s+)?" + NUM + "\\s+sessions\\b", "i").exec(str);
    if (!m) return null;
    return toNumber(m[1] || m[2] || m[3]);
  }

  function sessionsPerStep(str) {
    var m = new RegExp("\\b(?:after|following|once|upon)\\s+(?:\\w+\\s+){0,3}?" + NUM + "\\s+(?:consecutive\\s+)?(?:successful\\s+)?sessions?\\b", "i").exec(str);
    return m ? toNumber(m[1]) : 1;
  }

  function stepPlanMismatch(draft, clinician) {
    var step = stepSize(draft);
    var start = startValue(draft);
    var target = targetValue(draft, clinician);
    var deadline = deadlineSession(draft);
    if (!step || start === null || target === null || deadline === null || target <= start) return null;
    var steps = Math.ceil((target - start) / step);
    var earliest = 1 + steps * sessionsPerStep(draft);
    if (deadline >= earliest) return null;
    return fmt(step) + " steps from " + fmt(start) + " reach " + fmt(target) + " at session " + earliest +
      " at the earliest, not session " + deadline + ".";
  }

  /* 5. Two re-entry counts. Only sentences about re-entry are read, so a
     booster rule after one low probe is not mistaken for the re-entry rule. */
  function reentryCounts(str) {
    var out = [];
    sentences(str).filter(function (s) { return REENTRY_WORDS.test(s); }).forEach(function (s) {
      var a = new RegExp("\\b" + NUM + "\\s+(?:consecutive\\s+)?(?:maintenance\\s+)?(?:probes?|sessions?|probe sessions?)\\b[^.\\n]{0,50}?\\b(?:below|under|fail\\w*|miss\\w*)", "gi");
      var b = new RegExp("\\b(?:below|under|fail\\w*|miss\\w*)\\b[^.\\n]{0,60}?\\b(?:on|for|in|across)\\s+" + NUM + "\\s+(?:consecutive\\s+)?(?:maintenance\\s+)?(?:probes?|sessions?)", "gi");
      var m;
      while ((m = a.exec(s))) out.push(toNumber(m[1]));
      while ((m = b.exec(s))) out.push(toNumber(m[1]));
    });
    return out;
  }

  function reentryMismatch(out) {
    var counts = uniq(reentryCounts(text(out.maintenanceCriteria)).concat(reentryCounts(text(out.errorCorrectionMaintenance))));
    if (counts.length < 2) return null;
    var probes = function (n) { return n + (n === 1 ? " low probe" : " low probes"); };
    return "One block re-enters after " + probes(counts[0]) + ", another after " + counts[1] + "; the plan should say one.";
  }

  /* The whole check. `sections` is the tool's own list, so a hint can only name
     a block the page draws. */
  function check(out, clinician, sections) {
    var o = out && typeof out === "object" ? out : {};
    var ids = Array.isArray(sections) ? sections : [];
    var hints = [];
    ids.forEach(function (id) {
      var body = text(o[id]);
      if (!body) return;
      var flaggedFraction = false;
      sentences(body).forEach(function (s) {
        var msg = fractionMismatch(s);
        if (msg) {
          flaggedFraction = true;
          hints.push(hint(id, msg));
        }
      });
      var trials = flaggedFraction ? null : trialPercentMismatch(body);
      if (trials) hints.push(hint(id, trials));
      var base = baselineMismatch(body, clinician);
      if (base) hints.push(hint(id, base));
    });
    var draft = ids.map(function (id) { return text(o[id]); }).join("\n");
    var plan = stepPlanMismatch(draft, text(clinician));
    if (plan) {
      var where = ids.filter(function (id) { return stepSize(text(o[id])); })[0] || "note";
      hints.push(hint(where, plan));
    }
    var reentry = reentryMismatch(o);
    if (reentry) hints.push(hint("errorCorrectionMaintenance", reentry));
    return hints;
  }

  window.SapNumbers = {
    check: check,
    sentences: sentences,
    durations: durations,
    fmt: fmt,
    hint: hint,
    toNumber: toNumber,
    NUM: NUM,
  };
})();
