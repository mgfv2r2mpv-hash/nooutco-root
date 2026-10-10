/* SAP draft checks: the draft read against the BCBA's own intake, and against
 * itself.
 *
 * WHERE THIS CAME FROM. Kaleb's SAP bench run, 2026-10-09 (card
 * sap-note-accuracy). The bench passed 3 of 3 and the drafts still had real
 * errors. The prompt now asks for each fix (sap.js, ACCURACY_RULES). This file
 * is the part that can be checked in code:
 *
 *   A PROMPT DIRECTION HE STATED STANDS. "use most-to-least for 'help'" came
 *   back as least-to-most on both buttons. Flagged where the draft disagrees.
 *   A 2-STEP INSTRUCTION IS ONE SD. Reinforcing step 1, or giving step 2 as a
 *   new SD, teaches two 1-step instructions. Flagged where it is written.
 *   THE REFINED GOAL ADDS NOTHING. A deadline, setting, person or count the
 *   goal and intake never named is flagged ("by the end of 1 authorization
 *   period" on a goal that had none).
 *   REINFORCERS HE NAMED STAY. "Tablet for 30 seconds" was lost, and "tablet"
 *   came to mean only the AAC device. Flagged.
 *   THE HIERARCHY AGREES WITH ITSELF AND WITH ERROR CORRECTION. "five distinct
 *   levels" over four, and error correction starting at a level the hierarchy
 *   no longer has. Flagged.
 *   READINESS NEVER WAITS FOR THE BEHAVIOR BEING REPLACED. "has grabbed in the
 *   last 30 seconds" is flagged.
 *   THE DRAFT DOES NOT ASK HIM TO SETTLE ITS OWN CONTRADICTION. A conflict whose
 *   quoted sides are all the draft's own words is flagged.
 *   The numbers (sap-numbers.js): fractions against percentages, baseline
 *   claims, step plans, re-entry counts.
 *
 * Every check only adds a hint. None rewrites a block: the BCBA wrote the plan
 * and reads the flag, and a pattern is not sure enough to change a clinical
 * sentence on its own.
 *
 * On a revision (mergeRevision) only the checks that read the draft against
 * itself run. A revision can carry his newer instruction ("switch help to
 * least-to-most"), so a check against the first intake would argue with him.
 *
 * Pure and fail-open: a page where this file or sap-numbers.js did not load
 * drafts exactly as before. Exposes window.SapChecks.
 */
(function () {
  "use strict";

  function nums() {
    return window.SapNumbers || null;
  }

  function text(v) {
    return typeof v === "string" ? v : "";
  }

  function hint(section, detail) {
    return { section: section, code: "ambiguous_item", kind: "thin", rank: 0, detail: detail };
  }

  function sentences(str) {
    return nums() ? nums().sentences(str) : text(str).split(/\n+/).filter(Boolean);
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /* The BCBA's own words. Q: lines are the tool's questions, not his, so they
     are dropped; A: answers are his and keep their text. */
  function clinicianWords(intake) {
    return text(intake).split("\n").filter(function (line) {
      return !/^\s*Q:/.test(line) && !/^\s*A:\s*\(not refined\)\s*$/i.test(line);
    }).map(function (line) { return line.replace(/^\s*A:\s*/, ""); }).join("\n");
  }

  /* ── Prompt direction ───────────────────────────────────────────────── */
  var DIRECTIONS = [
    { id: "mtl", name: "most-to-least", src: "\\bmost[-\\s]+to[-\\s]+least\\b|\\bmtl\\b" },
    { id: "ltm", name: "least-to-most", src: "\\bleast[-\\s]+to[-\\s]+most\\b|\\bltm\\b" },
  ];
  var NEGATED_BEFORE = /\b(?:not|never|no|instead of|rather than|avoid\w*|without|(?:switch\w*|chang\w*|away|moved?) from|than)\s+(?:\w+\s+){0,2}$/i;
  var SCOPE_STOP = /^(?:all|every|both|each|everything|targets?|skills?|programs?|the|this|now|acquisition)$/i;

  function hits(str, dir) {
    var out = [];
    var re = new RegExp(dir.src, "gi");
    var m;
    while ((m = re.exec(str))) {
      if (!NEGATED_BEFORE.test(str.slice(Math.max(0, m.index - 30), m.index))) out.push({ dir: dir, index: m.index });
    }
    return out;
  }

  function statedDirections(clinician) {
    var out = [];
    sentences(clinician).forEach(function (s) {
      DIRECTIONS.forEach(function (dir) {
        hits(s, dir).forEach(function (h) {
          var rest = s.slice(h.index).replace(new RegExp("^(?:" + dir.src + ")", "i"), "");
          var m = /^\s*(?:prompting\s+)?(?:for|on)\s+(?:the\s+)?["'\u201c\u2018]?([a-z][a-z'-]*)/i.exec(rest);
          var scope = m && !SCOPE_STOP.test(m[1]) ? m[1].toLowerCase() : "";
          out.push({ dir: dir, scope: scope });
        });
      });
    });
    return out;
  }

  function draftLines(out, sections) {
    var lines = [];
    sections.forEach(function (id) {
      text(out[id]).split("\n").forEach(function (l) { if (l.trim()) lines.push({ section: id, text: l }); });
    });
    (Array.isArray(out.design) ? out.design : []).forEach(function (d) {
      if (d && sections.indexOf(d.section) !== -1) lines.push({ section: d.section, text: text(d.choice) });
    });
    return lines;
  }

  /* A clause is the unit a direction governs: "MtL for help; LtM for more" is
     two clauses, and each says which direction its own target gets. */
  function clauses(lines) {
    return lines.reduce(function (acc, l) {
      return acc.concat(l.text.split(/[;.!?]\s+|,\s+|\s+-\s+/).map(function (c) { return { section: l.section, text: c }; }));
    }, []);
  }

  function firstHierarchyLine(lines) {
    return lines.filter(function (l) { return l.section === "promptHierarchy"; })[0] || null;
  }

  function directionOffence(lines, stated, opposite) {
    if (stated.scope) {
      var scopeRe = new RegExp("\\b" + escapeRe(stated.scope) + "\\b", "i");
      var relevant = clauses(lines).filter(function (c) {
        return scopeRe.test(c.text) && (hits(c.text, stated.dir).length || hits(c.text, opposite).length);
      });
      if (relevant.length) {
        return relevant.filter(function (c) { return hits(c.text, opposite).length && !hits(c.text, stated.dir).length; })[0] || null;
      }
    }
    // Unscoped, or the draft never ties the target to a direction: the
    // direction line at the top of the Prompt Hierarchy is the plan's answer.
    var top = firstHierarchyLine(lines);
    return top && hits(top.text, opposite).length && !hits(top.text, stated.dir).length ? top : null;
  }

  function directionHints(out, clinician, sections) {
    var lines = draftLines(out, sections);
    var seen = {};
    return statedDirections(clinician).map(function (stated) {
      var key = stated.dir.id + "|" + stated.scope;
      if (seen[key]) return null;
      seen[key] = true;
      var opposite = DIRECTIONS.filter(function (d) { return d !== stated.dir; })[0];
      var said = "Your notes say " + stated.dir.name + (stated.scope ? " for \"" + stated.scope + "\"" : "");
      if (!lines.some(function (l) { return hits(l.text, stated.dir).length; })) {
        return hint("promptHierarchy", said + "; the draft never uses it.");
      }
      var bad = directionOffence(lines, stated, opposite);
      return bad ? hint(bad.section, said + "; the draft uses " + opposite.name + ".") : null;
    }).filter(Boolean);
  }

  /* ── A 2-step instruction is one SD ─────────────────────────────────── */
  var MULTI_STEP = /\b(?:2|two|3|three|multi)[-\s]?step\b/i;
  var STEP_ONE = /\bstep (?:1|one)\b|\bfirst (?:step|instruction|direction|part)\b/i;
  var STEP_TWO_AS_SD = /\b(?:new|separate)\s+(?:SD|instruction|demand|direction|trial)\b|\bthen\s+(?:says|presents|delivers|gives|issues|states)\b|\b(?:presents?|delivers?|gives?|issues?|says?)\s+(?:step (?:2|two)|the second (?:step|instruction|direction|part))\b/i;
  var STEP_TWO = /\bstep (?:2|two)\b|\bsecond (?:step|instruction|direction|part)\b/i;
  var REINFORCE = /\breinforc\w*|\bprais\w*|\btokens?\b|\bdeliver\w* (?:the )?(?:edible|item|preferred)/i;
  var NEGATED_REINFORCE = /\b(?:do not|don't|never|not|no|withh[oe]ld\w*|without)\s+(?:\w+\s+){0,2}(?:reinforc|prais|deliver|token)/i;
  var WHOLE_INSTRUCTION = /\b(?:both|all|every|each)\s+(?:of the\s+)?(?:\w+\s+)?(?:steps|parts|instructions|directions|components)\b|\b(?:full|entire|whole|complete)\s+(?:2-step\s+)?(?:instruction|sequence)\b/i;
  var STEP_SECTIONS = ["sd", "teachingStrategy", "lessonSetUp", "correctResponse", "incorrectResponse", "promptHierarchy", "errorCorrectionInitial", "errorCorrectionMaintenance"];

  function twoStepHints(out, clinician) {
    if (!MULTI_STEP.test(clinician) && !MULTI_STEP.test(text(out.refinedGoal))) return [];
    var hints = [];
    STEP_SECTIONS.forEach(function (id) {
      var ss = sentences(text(out[id]));
      var early = ss.filter(function (s) {
        return REINFORCE.test(s) && STEP_ONE.test(s) && !NEGATED_REINFORCE.test(s) && !WHOLE_INSTRUCTION.test(s);
      })[0];
      if (early) hints.push(hint(id, "Reinforcement after step 1 teaches two 1-step instructions; reinforce after both steps."));
      var split = ss.filter(function (s) {
        return STEP_TWO.test(s) && STEP_TWO_AS_SD.test(s) && !/\b(?:do not|don't|never|not)\b/i.test(s);
      })[0];
      if (split) hints.push(hint(id, "Step 2 is given as its own SD; a 2-step instruction is one SD with both steps."));
    });
    return hints;
  }

  /* ── The refined goal adds nothing ──────────────────────────────────── */
  var MONTHS = "january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec|may(?=\\s+\\d)";
  var DEADLINES = [
    /\b(?:by the end of|within|during|over)\s+(?:\w+\s+){0,2}authori[sz]ation period\b|\bauthori[sz]ation period\b/i,
    /\bby the end of [^,.;]{1,30}/i,
    /\b(?:within|in|over|by) (?:the next )?(?:\d+|one|two|three|six|twelve) (?:days?|weeks?|months?|years?)\b/i,
    new RegExp("\\b(?:by|before) (?:" + MONTHS + ")\\b", "i"),
    /\b(?:by|before) \d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i,
    /\b(?:per|each|this|by the end of the) (?:quarter|year|school year|semester)\b/i,
  ];
  /* Any timeframe in HIS words makes the deadline his, however he wrote it:
     "auth", "within 1 auth period", "in 6 months", "by 6/30/2027". Reviewer
     R334-H1: the long forms alone flagged his own shorthand as an addition.
     "for 4 weeks" is a maintenance schedule, not a deadline, so "for" is not
     read as one. */
  var HIS_TIMEFRAME = [
    /\bauth(?:ori[sz]ation)?\b/i,
    /\b(?:within|in|over|by|before) (?:the next |the end of )?(?:\d+|one|two|three|four|five|six|nine|twelve) (?:days?|weeks?|months?|years?)\b/i,
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,
    new RegExp("\\b(?:by|before|until|through) (?:the end of )?(?:" + MONTHS + ")\\b", "i"),
    /\b(?:quarter|semester|school year)\b/i,
  ];

  function hasHisTimeframe(clinician) {
    return HIS_TIMEFRAME.concat(DEADLINES).some(function (re) { return re.test(clinician); });
  }
  var PEOPLE = [
    { name: "staff", re: /\b(?:staff|therapists?|technicians?|RBTs?|BTs?|instructors?|providers?|shadows?|aides?|paras?|paraprofessionals?|clinicians?|BCBAs?)\b/i },
    { name: "caregiver", re: /\b(?:mom|mother|dad|father|parents?|caregivers?|guardians?|family)\b/i },
    { name: "teacher", re: /\bteachers?\b/i },
    { name: "peer", re: /\b(?:peers?|siblings?|brothers?|sisters?|classmates?|friends?)\b/i },
  ];
  var ADULT = /\badults?\b/i;
  var SETTINGS = [
    { name: "home", re: /\bhomes?\b|\bhouse\b/i },
    { name: "school", re: /\bschools?\b|\bclassrooms?\b/i },
    { name: "clinic", re: /\bclinics?\b|\bcent(?:er|re)s?\b/i },
    { name: "community", re: /\bcommunity\b|\bstores?\b|\bparks?\b|\bplaygrounds?\b|\brestaurants?\b|\blibrar(?:y|ies)\b/i },
    { name: "snack", re: /\bsnacks?\b|\bmeals?\b|\bmealtimes?\b|\blunch\b|\bbreakfast\b|\bdinner\b/i },
    { name: "play", re: /\bplay\b|\bleisure\b|\bfree time\b/i },
  ];
  var WORD_DIGITS = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10" };

  function numbersIn(str) {
    var digits = (str.match(/\d+(?:\.\d+)?/g) || []);
    var words = (str.toLowerCase().match(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b/g) || []).map(function (w) { return WORD_DIGITS[w]; });
    return digits.concat(words);
  }

  // A percentage he could have meant by one of his own fractions: "8 of 10" is 80%.
  function fractionPercents(str) {
    var out = [];
    str.replace(/\b(\d+)\s*(?:of|out of|\/)\s*(\d+)\b/gi, function (_, x, y) {
      if (+y) out.push(String(Math.round((100 * +x) / +y)));
      return _;
    });
    return out;
  }

  function refinedGoalHints(out, clinician) {
    var goal = text(out.refinedGoal);
    if (!goal) return [];
    var added = [];
    // A deadline he wrote may be reworded; one he never wrote may not appear.
    var deadline = DEADLINES.map(function (re) { return re.exec(goal); }).filter(Boolean)[0];
    var deadlineText = deadline ? deadline[0] : "";
    if (deadline && !hasHisTimeframe(clinician)) {
      added.push("\"" + deadlineText.trim() + "\"");
    }
    PEOPLE.forEach(function (p) {
      var m = p.re.exec(goal);
      if (m && !p.re.test(clinician)) added.push(m[0]);
    });
    if (ADULT.test(goal) && !ADULT.test(clinician) && !PEOPLE.some(function (p) { return p.re.test(clinician); })) added.push("adults");
    SETTINGS.forEach(function (s) {
      var m = s.re.exec(goal);
      if (m && !s.re.test(clinician)) added.push(m[0]);
    });
    var have = numbersIn(clinician).concat(fractionPercents(clinician));
    numbersIn(goal.replace(deadlineText, "")).forEach(function (n) {
      if (have.indexOf(n) === -1 && added.indexOf(n) === -1) added.push(n);
    });
    if (!added.length) return [];
    var detail = "Refined goal adds what your goal does not say: " + added.join(", ");
    return [hint("refinedGoal", detail.length > 118 ? detail.slice(0, 115) + "..." : detail + ".")];
  }

  /* ── Reinforcers he named stay ──────────────────────────────────────── */
  var REINFORCER_Q = /reinforc|prefer|motivat|work for|reward|earn/i;
  var REINFORCER_TRIGGER = /\b(?:works? for|will work for|reinforcers?(?:\s+(?:are|is|include))?:?|prefers|favou?rites?(?:\s+are)?)\s+([^.;\n]+)/i;
  var HEAD_STOP = /^(?:the|a|an|one|two|three|some|his|her|their|more|per|for|of|to|with|any|just|small|big|pieces?|bites?|access|minutes?|seconds?|time|on|in|at|and|or|\d+)$/i;
  var AAC_NEAR = /\bAAC\b|\bdevice\b|\bSGD\b|speech[- ]generating|communication|\bbuttons?\b|\bicons?\b/i;
  var REINFORCER_NEAR = /reinforc|access|\bbreak\b|\bplay\b|\bearn|\bpreferred\b|\bdeliver|\bcontingent\b/i;

  function itemsFrom(phrase) {
    return phrase.split(/,|;|\bor\b|\band\b/i).map(function (chunk) {
      var words = chunk.trim().toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter(Boolean);
      var head = words.filter(function (w) { return !HEAD_STOP.test(w); })[0] || "";
      var amount = /\bfor\s+(\d+)\s*(seconds?|secs?|s|minutes?|mins?|min)\b/i.exec(chunk);
      return {
        item: /^[a-z][a-z-]{2,}$/.test(head) ? head : "",
        seconds: amount ? (/^m/i.test(amount[2]) ? +amount[1] * 60 : +amount[1]) : null,
      };
    }).filter(function (r) { return r.item; });
  }

  function namedReinforcers(intake) {
    var found = [];
    var lastQ = "";
    text(intake).split("\n").forEach(function (line) {
      if (/^\s*Q:/.test(line)) { lastQ = line; return; }
      var isAnswer = /^\s*A:/.test(line);
      var body = line.replace(/^\s*A:\s*/, "");
      if (isAnswer && REINFORCER_Q.test(lastQ) && !/^\(not refined\)$/i.test(body.trim())) {
        found = found.concat(itemsFrom(body.replace(/[.!]+\s*$/, "")));
        return;
      }
      sentences(body).forEach(function (s) {
        var m = REINFORCER_TRIGGER.exec(s.replace(/[.!]+\s*$/, ""));
        if (m) found = found.concat(itemsFrom(m[1]));
      });
    });
    // One entry per item. Named twice ("works for the tablet", then "Tablet
    // for 30 seconds"), the entry keeps the amount.
    return found.reduce(function (list, r) {
      var at = list.map(function (x) { return x.item; }).indexOf(r.item);
      if (at === -1) return list.concat(r);
      if (list[at].seconds !== null || r.seconds === null) return list;
      return list.slice(0, at).concat({ item: r.item, seconds: r.seconds }, list.slice(at + 1));
    }, []);
  }

  /* Each mention is read inside its own sentence. A mention counts as the
     reinforcer when its sentence delivers something, or when no AAC word sits
     right beside it; "the AAC tablet" alone is the device. */
  function itemUse(draft, item) {
    var re = new RegExp("\\b" + escapeRe(item) + "(?:s|es)?\\b", "i");
    var said = sentences(draft).filter(function (s) { return re.test(s); });
    return {
      any: said.length > 0,
      asReinforcer: said.some(function (s) {
        var at = s.search(re);
        var close = s.slice(Math.max(0, at - 25), at + item.length + 25);
        return REINFORCER_NEAR.test(s) || !AAC_NEAR.test(close);
      }),
    };
  }

  function reinforcerHints(out, intake, sections) {
    var draft = sections.map(function (id) { return text(out[id]); }).join("\n");
    var durations = nums() ? nums().durations(draft).map(function (d) { return d.seconds; }) : [];
    var hints = [];
    namedReinforcers(intake).forEach(function (r) {
      var use = itemUse(draft, r.item);
      if (!use.any) {
        hints.push(hint("note", "You named " + r.item + " as a reinforcer; the draft never uses it."));
      } else if (!use.asReinforcer) {
        hints.push(hint("note", "\"" + r.item + "\" now only means the AAC device; the " + r.item + " reinforcer is gone."));
      } else if (r.seconds !== null && nums() && durations.indexOf(r.seconds) === -1) {
        hints.push(hint("note", "You gave " + r.item + " for " + nums().fmt(r.seconds) + "; the draft never says how long."));
      }
    });
    return hints;
  }

  /* ── The hierarchy agrees with itself and with error correction ─────── */
  var LEVELS = [
    { name: "independent", src: "independen\\w*" },
    { name: "full physical", src: "full[-\\s]+physical" },
    { name: "partial physical", src: "partial[-\\s]+physical" },
    { name: "gestural", src: "gestur\\w*" },
    { name: "model", src: "model(?:ing|ed)?" },
    { name: "full verbal", src: "full[-\\s]+verbal" },
    { name: "partial verbal", src: "partial[-\\s]+verbal" },
    { name: "positional", src: "positional" },
    { name: "visual", src: "visual" },
    { name: "hand-over-hand", src: "hand[-\\s]+over[-\\s]+hand" },
  ];
  var LEVEL_LEAD = "(?:at|to|from|with|using|drop(?:s|ping)?\\s+to|return(?:s|ing)?\\s+to|revert(?:s|ing)?\\s+to|back\\s+to|start(?:s|ing)?\\s+(?:at|with|from)|begin(?:s|ning)?\\s+(?:at|with|from))";
  var NOT_A_LEVEL = "(?!\\s+(?:responses?|correct\\w*|mands?|requests?|performance|responding|completion))";

  /* "five distinct levels" over a list of four. Only a count of three or more
     stated as the size of the hierarchy is read, so "drop back one level" in
     an error correction step is not mistaken for one. */
  var LEVEL_MOVE_BEFORE = /\b(?:back|down|up|by|drop\w*|fad\w*|mov\w*|increas\w*|decreas\w*|skip\w*)\s*$/i;

  function levelCountHints(out, sections) {
    var bullets = text(out.promptHierarchy).split("\n").filter(function (l) { return /^\s*(?:[*\-\u2022+]|\d+[.)])\s+\S/.test(l); }).length;
    if (!bullets || !nums()) return [];
    var NUM = nums().NUM;
    var re = new RegExp("\\b" + NUM + "[-\\s]+(?:distinct\\s+|separate\\s+)?(?:prompt(?:ing)?\\s+)?levels\\b|\\b" + NUM + "[-\\s]+(?:level|step)\\s+(?:prompt(?:ing)?\\s+)?hierarchy\\b", "gi");
    for (var i = 0; i < sections.length; i++) {
      var body = text(out[sections[i]]);
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(body))) {
        var n = nums().toNumber(m[1] || m[2]);
        if (n < 3 || LEVEL_MOVE_BEFORE.test(body.slice(Math.max(0, m.index - 16), m.index))) continue;
        if (n !== bullets) return [hint(sections[i], "Says " + n + " levels; the Prompt Hierarchy lists " + bullets + ".")];
      }
    }
    return [];
  }

  function hierarchyHints(out) {
    var hierarchy = text(out.promptHierarchy);
    if (!hierarchy.trim()) return [];
    var hints = [];
    ["errorCorrectionInitial", "errorCorrectionMaintenance"].forEach(function (id) {
      var body = text(out[id]);
      var missing = LEVELS.filter(function (l) {
        var used = new RegExp("\\b" + LEVEL_LEAD + "\\s+(?:an?\\s+|the\\s+)?(?:" + l.src + ")\\b" + NOT_A_LEVEL, "i").test(body) ||
          new RegExp("\\b(?:" + l.src + ")\\s+(?:prompt|level|opportunity|trial)s?\\b", "i").test(body);
        return used && !new RegExp("\\b(?:" + l.src + ")\\b", "i").test(hierarchy);
      })[0];
      if (missing) hints.push(hint(id, "Error correction uses \"" + missing.name + "\", which the Prompt Hierarchy does not list."));
    });
    return hints;
  }

  /* ── Readiness never waits for the behavior being replaced ──────────── */
  var BEHAVIORS = [
    /\bgrab\w*/i, /\bscream\w*/i, /\byell\w*/i, /\bcr(?:y|ies|ying|ied)\b/i, /\bhit(?:s|ting)?\b/i,
    /\bbit(?:e|es|ing)\b/i, /\bkick\w*/i, /\bscratch\w*/i, /\belop\w*/i, /\bwalk(?:s|ing|ed)? (?:off|away)\b/i,
    /\bwander\w*/i, /\btantrum\w*/i, /\bflop\w*/i, /\bthr(?:ow|ows|owing|ew)\b/i, /\baggress\w*/i,
    /\bspit\w*/i, /\bpush(?:es|ing|ed)?\b/i, /\bswip\w*/i, /\bwhin\w*/i, /\bself[- ]injur\w*|\bSIB\b/i,
  ];
  var READINESS = /\bready\b|readiness|motivat|\bMO\b|establishing operation|\bwhen to run|\b(?:run|begin|start|initiate|present)\b[^.]{0,30}\bwhen\b|signs? of (?:interest|motivation)|\b(?:within|in) the (?:last|past|previous)\b/i;
  var BEHAVIOR_NEGATED = /\b(?:no|not|cannot|can't|won't|without|absent|free of|stops?|stopped|instead of|rather than|before|calm|refrain\w*|avoid\w*|never|prevent\w*|block\w*|paus\w*|halt\w*|interrupt\w*)\b[^.]{0,25}$/i;

  function readinessHints(out, clinician) {
    var targets = BEHAVIORS.filter(function (re) { return re.test(clinician); });
    if (!targets.length) return [];
    var hit = null;
    sentences(text(out.lessonSetUp)).filter(function (s) { return READINESS.test(s); }).some(function (s) {
      return targets.some(function (re) {
        var g = new RegExp(re.source, "gi");
        var m;
        while ((m = g.exec(s))) {
          if (!BEHAVIOR_NEGATED.test(s.slice(0, m.index))) { hit = m[0]; return true; }
        }
        return false;
      });
    });
    return hit ? [hint("lessonSetUp", "Readiness waits for \"" + hit + "\", a behavior targeted for reduction.")] : [];
  }

  /* ── The draft does not ask him to settle its own contradiction ─────── */
  function norm(s) {
    return s.toLowerCase().replace(/\s+/g, " ").trim();
  }

  function quotesIn(question) {
    var out = [];
    question.replace(/["\u201c]([^"\u201d]{4,160})["\u201d]|(?:^|[\s(])'([^']{4,160})'(?=[\s.,;:?!)]|$)/g, function (_, a, b) {
      out.push(a || b);
      return _;
    });
    return out;
  }

  function selfConflictHints(out, clinician) {
    var mine = norm(clinician);
    return (Array.isArray(out.conflicts) ? out.conflicts : []).filter(function (c) {
      var quotes = quotesIn(text(c && c.question));
      return quotes.length >= 2 && quotes.every(function (q) { return mine.indexOf(norm(q)) === -1; });
    }).slice(0, 1).map(function (c) {
      return hint((c.sections && c.sections[0]) || "note", "This question is about two rules the draft wrote itself; the draft should make them agree.");
    });
  }

  /* The whole check. Returns the hints to add; the caller concatenates them
     with the model's own before its hint normalizer runs, so they take the
     same validation as every other hint. The output is never changed. */
  function apply(out, intake, opts) {
    var o = out && typeof out === "object" ? out : {};
    var options = opts || {};
    var sections = Array.isArray(options.sections) ? options.sections : [];
    var revision = !!options.revision;
    var clinician = revision ? "" : clinicianWords(intake);
    var hints = twoStepHints(o, clinician)
      .concat(levelCountHints(o, sections), hierarchyHints(o))
      .concat(nums() ? nums().check(o, clinician, sections) : []);
    if (!revision && clinician.trim()) {
      hints = hints.concat(
        directionHints(o, clinician, sections),
        refinedGoalHints(o, clinician),
        reinforcerHints(o, intake, sections),
        readinessHints(o, clinician),
        selfConflictHints(o, clinician)
      );
    }
    var seen = {};
    return {
      hints: hints.filter(function (h) {
        var key = h.section + "|" + h.detail;
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      }),
    };
  }

  window.SapChecks = {
    apply: apply,
    clinicianWords: clinicianWords,
    statedDirections: statedDirections,
    namedReinforcers: namedReinforcers,
  };
})();
