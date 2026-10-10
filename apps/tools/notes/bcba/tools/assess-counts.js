/* Assessment note counts: the numbers a draft reports, read against the
 * numbers in the BCBA's notes.
 *
 * WHERE THIS CAME FROM. Kaleb's Assessment bench run, 2026-10-10 (card
 * assess-note-accuracy). Two of its errors were arithmetic:
 *
 *   THE FBA. He logged 7 hits, 5 after demands and 2 at recess. The note added
 *   "Two hits had unclear antecedents" in one draft and "The remaining
 *   episodes had unclear antecedents" in another, so the hits came to 9. It
 *   had asked about the antecedents and got no answer.
 *   THE REPORT WRITING. His 4 goals ("2 communication, 1 social, 1 behavior
 *   reduction") were regrouped so a fifth social goal appeared.
 *
 * Each check only reports. assess-checks.js turns what this file finds into
 * hints; nothing here changes the note. Every matcher errs toward silence: a
 * wrong hint teaches the BCBA to skip hints.
 *
 * Exposes window.AssessCounts.
 */
(function () {
  "use strict";

  var NUMBER_WORDS = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  };
  var ORDINAL_WORDS = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  };
  var NUM = "\\d+|" + Object.keys(NUMBER_WORDS).join("|");
  var ORD = Object.keys(ORDINAL_WORDS).join("|");

  // What a count of episodes is counted in. "3 breaks" or "6 items" is not one.
  var COUNT_NOUN = "episodes?|instances?|incidents?|occurrences?|events?|hits?|bouts?|tantrums?|attempts?";
  // Up to two words between a number and its noun, none of them a number or
  // "of", so "3 of 4 instances" is read as 4 instances and not as 3.
  var BETWEEN = "(?:(?!of\\b)(?!(?:" + NUM + ")\\b)[a-z][a-z'-]*\\s+){0,2}?";
  var TOTAL = new RegExp("\\b(" + NUM + ")\\s+" + BETWEEN + "(" + COUNT_NOUN + ")\\b", "gi");
  /* A part of a total: a number followed by a count noun, or by a word that
     opens a breakdown ("5 after teacher said", "Two occurred at recess"). A
     number followed by a unit ("2 hrs", "10 am") never matches, because the
     word after it must be one of these. */
  var PART = new RegExp(
    "\\b(" + NUM + ")\\b(?!\\s+of\\b)(?=\\s+(?:" + BETWEEN + "(?:" + COUNT_NOUN + ")\\b|" +
    "(?:followed|occurred|happened|came|were|was|had|took|after|at|during|when|in|on|involved|preceded)\\b))",
    "gi"
  );
  var REMAINDER = new RegExp("\\b(?:the\\s+)?(?:remaining|other)\\s+(?:[a-z]+\\s+)?(?:" + COUNT_NOUN + ")\\b|\\b(?:the\\s+)?(?:remaining|remainder)\\b|\\bthe rest\\b", "i");
  var WINDOW = 4; // the total's sentence and the three after it

  var DOMAINS = [
    ["behavior reduction", /^(?:behaviou?r[- ]reduction|reduction)$/i],
    ["communication", /^(?:communication|language)$/i],
    ["social", /^social$/i],
    ["play", /^play$/i],
    ["adaptive", /^(?:adaptive|self[- ]help|daily living)$/i],
    ["academic", /^academic$/i],
    ["motor", /^motor$/i],
    ["toileting", /^toileting$/i],
    ["parent training", /^parent[- ]training$/i],
    ["listener", /^listener$/i],
  ];
  var DOMAIN = "behaviou?r[- ]reduction|communication|language|social|play|adaptive|self[- ]help|daily living|academic|motor|toileting|parent[- ]training|listener|reduction";
  var DOMAIN_COUNT = new RegExp("\\b(" + NUM + ")\\s+(?:new\\s+)?(" + DOMAIN + ")\\b", "gi");
  // "In 2 sessions goals were..." is not a count of goals, so no unit word
  // sits between the number and "goals".
  var UNIT = "(?:sessions?|visits?|days?|weeks?|wks?|months?|hours?|hrs?|minutes?|mins?|years?)\\b";
  var GOAL_TOTAL = new RegExp("\\b(" + NUM + ")\\s+((?:(?!of\\b)(?!" + UNIT + ")[a-z][a-z'-]*\\s+){0,2}?)goals?\\b", "gi");
  var GOAL_ORDINAL = new RegExp("\\b(" + ORD + ")\\s+(?:[a-z][a-z'-]*\\s+){0,2}?goals?\\b", "gi");
  var DOMAIN_WORD = new RegExp("\\b(?:" + DOMAIN + ")\\b", "i");

  function text(v) {
    return typeof v === "string" ? v : "";
  }

  function toNumber(token) {
    var t = String(token).toLowerCase();
    return /^\d+$/.test(t) ? parseInt(t, 10) : NUMBER_WORDS[t];
  }

  /* Sentences, split at a full stop, question mark or line break followed by
     space or the end. "11.5" stays whole. */
  function sentences(str) {
    return text(str).split(/[.!?]+(?=\s|$)|\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function matches(re, str) {
    var out = [];
    var r = new RegExp(re.source, re.flags);
    var m;
    while ((m = r.exec(str)) !== null) {
      out.push(m);
      if (m.index === r.lastIndex) r.lastIndex++;
    }
    return out;
  }

  function sum(list) {
    return list.reduce(function (a, b) { return a + b; }, 0);
  }

  function domainKey(word) {
    var w = String(word).toLowerCase();
    var hit = DOMAINS.filter(function (d) { return d[1].test(w); })[0];
    return hit ? hit[0] : w;
  }

  // ── Episode counts ─────────────────────────────────────────────────────

  function totalsIn(str) {
    return matches(TOTAL, text(str)).map(function (m) { return toNumber(m[1]); });
  }

  function startsCount(piece, known) {
    return matches(TOTAL, piece).some(function (m) { return known.indexOf(toNumber(m[1])) !== -1; });
  }

  /* A rate is not a part: "3 instances in 3 sessions" is a count over time,
     not a share of the total before it. */
  var RATE = new RegExp(
    "^\\s+(?:[a-z][a-z'-]*\\s+){0,2}?(?:in|across|over|per|during)\\s+(?:(?:" + NUM + ")\\s+)?" +
    "(?:sessions?|days?|weeks?|wks?|hours?|hrs?|minutes?|mins?|visits?|observations?|periods?|intervals?)\\b",
    "i"
  );

  /* A part that restates the episodes by consequence ("Five were followed by
     the teacher removing the demand") opens its own breakdown: the same 7 hits
     counted a second way, never more hits. Only a word or two may sit between
     the number and the consequence, and none of them a word that places an
     antecedent, so "2 after peer play ended" stays an antecedent. */
  var CONSEQUENCE = new RegExp(
    "^\\s+(?:(?!(?:after|at|during|when|before|in|on|while|once)\\b)[a-z][a-z'-]*\\s+){0,2}?" +
    "(?:followed\\s+by|ended|resulted\\s+in|maintained\\s+by|led\\s+to)\\b",
    "i"
  );

  /* Each part as { n, consequence }. */
  function partsIn(str, total) {
    var s = text(str);
    return matches(PART, s).filter(function (m) {
      return !RATE.test(s.slice(m.index + m[0].length));
    }).map(function (m) {
      return { n: toNumber(m[1]), consequence: CONSEQUENCE.test(s.slice(m.index + m[0].length)) };
    }).filter(function (p) {
      return p.n !== total;
    });
  }

  /* Adds one part to the breakdowns, as new objects. The first consequence
     part after an antecedent breakdown starts a new breakdown. */
  function addPart(groups, p) {
    var cur = groups[groups.length - 1];
    if (p.consequence && !cur.consequence && cur.parts.length) {
      return groups.concat([{ parts: [p.n], consequence: true, remainder: "" }]);
    }
    var next = { parts: cur.parts.concat([p.n]), consequence: cur.consequence || p.consequence, remainder: cur.remainder };
    return groups.slice(0, -1).concat([next]);
  }

  /* A "remaining" group written once the current breakdown already accounts
     for the total. */
  function addRemainder(groups, piece, total) {
    var cur = groups[groups.length - 1];
    var r = REMAINDER.exec(piece);
    if (cur.remainder || !r || sum(cur.parts) < total) return groups;
    return groups.slice(0, -1).concat([Object.assign({}, cur, { remainder: r[0] })]);
  }

  /* The breakdowns written after a total: its own sentence's rest and the
     next few sentences, until a sentence gives another of the notes' totals
     ("2 elopement attempts" after "12 incidents"). */
  function breakdowns(after, known, total) {
    var groups = [{ parts: [], consequence: false, remainder: "" }];
    var stopped = false;
    after.forEach(function (piece, k) {
      if (stopped || (k > 0 && startsCount(piece, known))) { stopped = true; return; }
      groups = addRemainder(partsIn(piece, total).reduce(addPart, groups), piece, total);
    });
    return groups;
  }

  function groupFinding(section, m, total, g) {
    var added = sum(g.parts);
    if (g.parts.length >= 2 && added > total) {
      return { section: section, kind: "sum", total: total, noun: m[2], parts: g.parts, added: added };
    }
    if (g.remainder && g.parts.length >= 1) {
      return { section: section, kind: "remainder", phrase: g.remainder, total: total, noun: m[2], parts: g.parts, added: added };
    }
    return null;
  }

  /* For one section: each total the notes also give, and each breakdown
     written after it (by antecedent, then by consequence, counted apart):
     parts adding past the total, or a "remaining" group added once the parts
     already account for it. */
  function episodeFindings(section, prose, intake) {
    var known = totalsIn(intake);
    if (!known.length) return [];
    var list = sentences(prose);
    var found = [];
    list.forEach(function (sentence, i) {
      matches(TOTAL, sentence).forEach(function (m) {
        var total = toNumber(m[1]);
        if (known.indexOf(total) === -1) return;
        var after = [sentence.slice(m.index + m[0].length)].concat(list.slice(i + 1, i + WINDOW));
        breakdowns(after, known, total).forEach(function (g) {
          var f = groupFinding(section, m, total, g);
          if (f) found.push(f);
        });
      });
    });
    return found;
  }

  // ── Goal counts ────────────────────────────────────────────────────────

  function goalSentences(str) {
    return sentences(str).filter(function (s) { return /\bgoals?\b/i.test(s); });
  }

  // "4 new goals" is a total; "2 communication goals" is a domain count.
  function goalTotalsIn(sentence) {
    return matches(GOAL_TOTAL, sentence).filter(function (m) {
      return !DOMAIN_WORD.test(m[2] || "");
    }).map(function (m) { return toNumber(m[1]); });
  }

  function domainCountsIn(sentence) {
    return matches(DOMAIN_COUNT, sentence).map(function (m) {
      return { domain: domainKey(m[2]), n: toNumber(m[1]) };
    });
  }

  function intakeGoals(intake) {
    var totals = [];
    var domains = {};
    goalSentences(intake).forEach(function (s) {
      totals = totals.concat(goalTotalsIn(s));
      domainCountsIn(s).forEach(function (d) { domains[d.domain] = d.n; });
    });
    var domainSum = sum(Object.keys(domains).map(function (k) { return domains[k]; }));
    if (!totals.length && domainSum) totals = [domainSum];
    return { totals: totals, domains: domains };
  }

  /* For one section, each way its goal count disagrees with his: a total he
     did not give, an ordinal past his count ("a fifth social goal"), a domain
     count that differs from his, or domain counts adding past his total. */
  function goalFindings(section, prose, intake) {
    var his = intakeGoals(intake);
    if (!his.totals.length) return [];
    var max = Math.max.apply(null, his.totals);
    var found = [];
    goalSentences(prose).forEach(function (s) {
      goalTotalsIn(s).forEach(function (n) {
        if (his.totals.indexOf(n) === -1) found.push({ section: section, kind: "total", n: n, his: his.totals });
      });
      matches(GOAL_ORDINAL, s).forEach(function (m) {
        var n = ORDINAL_WORDS[m[1].toLowerCase()];
        if (n > max) found.push({ section: section, kind: "ordinal", n: n, his: his.totals });
      });
      var counts = domainCountsIn(s);
      counts.forEach(function (d) {
        var theirs = his.domains[d.domain];
        if (typeof theirs === "number" && theirs !== d.n) {
          found.push({ section: section, kind: "domain", domain: d.domain, n: d.n, hisN: theirs });
        }
      });
      var added = sum(counts.map(function (d) { return d.n; }));
      if (counts.length >= 2 && added > max) found.push({ section: section, kind: "domainSum", n: added, his: his.totals });
    });
    return found;
  }

  window.AssessCounts = {
    sentences: sentences,
    episodeFindings: episodeFindings,
    goalFindings: goalFindings,
    intakeGoals: intakeGoals,
    toNumber: toNumber,
  };
})();
