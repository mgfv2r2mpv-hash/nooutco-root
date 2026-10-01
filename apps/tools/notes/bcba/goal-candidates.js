/* Goal candidates for the supervision tool, found in the clinical notes.
 *
 * WHAT THIS IS. A pure function over the masked notes text. It lists the named
 * items that could become a row in Goals Analyzed, scores how strongly the notes
 * specify each one, and says which the tool preselects. It calls no model and
 * reads nothing but its argument, so what it returns can be shown to the
 * technician as is: every `source` is a line of the text it was given.
 *
 * WHAT IT RECEIVES. The caller passes text that has already been through the
 * name scrub. This file does not mask anything and must never be handed the
 * unmasked box, because `source` is drawn in a popover.
 *
 * SCORING. One tier per line, strongest marker first:
 *   6  the name sits beside goal / target / program / objective
 *   5  the name sits inside a reduction frame (behavior of concern, ...)
 *   4  a bracket row, or a bullet carrying a count, a percent or a prompt string
 *   3  a Title Case label after a bullet, or a name in double quotes or bold
 *   2  a defined term ("defined as")
 *   1  an item in a heading line such as "Treatment goals assessed:"
 * A name that turns up in two or more places gains half a point, which never
 * moves it across a tier. Only 4 and above are preselected, and a probe or
 * incidental teaching item never is. An item with no marker at all is not a
 * candidate, which is how a story with no program name and no data stays in the
 * narrative.
 */
(function () {
  "use strict";

  var PRESELECT_CAP = 6;
  var PRESELECT_MIN = 4;
  var SOURCE_MAX = 160;
  var NAME_WORDS_MAX = 6;
  var REPEAT_BONUS = 0.5;
  var LINE_MAX = 400;

  var TIER = { goalWord: 6, reduction: 5, data: 4, label: 3, defined: 2, heading: 1 };

  // The prompt codes the parser can name. Anything else in a trial sequence is
  // reported, never interpreted: a code the notes do not explain is not guessed.
  var KNOWN_CODES = ["I", "M", "P", "FP", "PP", "GP", "VP", "TP", "G", "V", "T", "+"];

  var GOAL_WORDS = "goal|target|program|objective";
  var REDUCTION_FRAME = /\b(?:behaviou?rs? (?:targeted )?(?:for reduction|of concern)|targeted for reduction|behaviou?r goal|maladaptive behaviou?r|challenging behaviou?r|interfering behaviou?r)\b/i;
  var PROBE_WORDS = /\b(?:probe|probes|incidental|natural(?:istic)? (?:environment )?teaching|baseline|generali[sz]ation)\b|\bNET\b/i;
  var DATA_PATTERN = /\d+\s*%|\b\d+\s*(?:\/|of|out of)\s*\d+\b|\bx\s?\d+\b|\b\d+\s*x\b|\b(?:FP|PP|GP|VP|TP)\b|\b[IMP](?:\s+[IMP])+\b/;
  var HEADING = /^(?:[A-Za-z ]*\b)?(?:goals?|targets?|programs?) (?:assessed|addressed|targeted|worked on|reviewed|run|covered)\s*:\s*(.+)$/i;
  var DEFINED = /([A-Z][^.:;\n]{0,60}?)\s+(?:is |was )?(?:operationally )?defined as\b/;
  var BULLET = /^\s*(?:[-*•◦]|\d+[.)])\s+/;

  // Words that start a sentence about the session rather than name a goal.
  var NOT_A_NAME = /^(?:client|he|she|they|we|mom|dad|mother|father|parent|caregiver|bt|rbt|bcba|staff|today|session|notes?|summary|plan|overall|feedback|the|a|an|his|her|their)$/i;
  var NARRATIVE_WORDS = /\b(?:did|didn't|not|ran|ate|was|were|had|has|met|engaged|reported|played|said|asked)\b/i;
  var CONNECTORS = /^(?:to|of|for|with|in|and|the|a|on|at|or|from|by)$/;
  var LEADING_FILLER = /^(?:the|a|an|his|her|their|our|this|that|new|current|per|and)$/i;

  function normalizeKey(name) {
    return name
      .toLowerCase()
      .replace(/[‘’‛′]/g, "'")
      .replace(/[“”‟″]/g, '"')
      .replace(/[‐-―−]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  }

  function stripBullet(line) { return line.replace(BULLET, ""); }

  function cleanName(raw) {
    return raw
      .replace(/^[\s*_]+|[\s*_]+$/g, "")
      .replace(/[\s:,;.\-\u2013\u2014]+$/g, "")
      .replace(/^[\s:,;\-\u2013\u2014]+/g, "")
      .trim();
  }

  function wordCount(s) { return s.split(/\s+/).filter(Boolean).length; }

  // A name is not a sentence fragment. Shape signals count only together: a
  // subject word AND a narrative verb ("He did not ..."), or a trailing
  // connector or article ("... meet his"). One signal alone is a real name:
  // "Said Hello", "Parent Training", "Tolerating Not Getting Item". A name that
  // is nothing but a subject or note word ("Plan", "Notes") is not a name.
  function isUsableName(name) {
    if (name === "" || wordCount(name) > NAME_WORDS_MAX || !/[A-Za-z0-9]/.test(name)) return false;
    var words = name.split(/\s+/);
    var first = words[0].replace(/[^A-Za-z]/g, "");
    var last = words[words.length - 1].replace(/[^A-Za-z]/g, "");
    var subjectFirst = NOT_A_NAME.test(first);
    if (subjectFirst && words.length === 1) return false;
    // Lowercase only: "Target Number A" ends on a letter, "he did not meet his" on a word.
    if (last === last.toLowerCase() && (CONNECTORS.test(last) || LEADING_FILLER.test(last) || NOT_A_NAME.test(last))) return false;
    return !(subjectFirst && NARRATIVE_WORDS.test(name));
  }

  // The part of `s` before the first delimiter that ends a name.
  function untilDelimiter(s) {
    var cut = s.search(/[,;.(]|\s[-\u2013\u2014]\s/);
    return cut === -1 ? s : s.slice(0, cut);
  }

  function parseRow(line) {
    var body = stripBullet(String(line == null ? "" : line)).trim();
    if (body.charAt(0) !== "[" || body.charAt(body.length - 1) !== "]") return null;
    var fields = body.slice(1, -1).split("|").map(function (f) { return f.trim(); });
    if (fields.length < 2 || fields[0] === "") return null;

    var counts = /^(\d+)\s*\/\s*(\d+)$/.exec(fields[2] || "");
    var pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(fields[3] || "");
    var correct = counts ? Number(counts[1]) : null;
    var incorrect = counts ? Number(counts[2]) : null;
    var percent = pct ? Number(pct[1]) : null;
    var total = counts ? correct + incorrect : 0;
    var computedPercent = total > 0 ? Math.round((correct / total) * 100) : null;
    var details = fields.slice(4).join(" | ");

    // A trial sequence is the details cell when it holds nothing but short
    // codes. Extra pipes inside Details mean free text, so no sequence.
    var sequence = [];
    if (fields.length === 5 && details !== "") {
      var tokens = details.split(/[\s,]+/).filter(Boolean);
      // A code is a known one in any case, or an unexplained one written the
      // way codes are (capitals and digits, or a bare + or -). A lowercase or
      // capitalised word such as "Did well" is free text.
      var isCodes = tokens.every(function (t) {
        return KNOWN_CODES.indexOf(t.toUpperCase()) !== -1 || /^(?:[A-Z]{1,4}\d?|[A-Z]?\d{1,3}|[+\-])$/.test(t);
      });
      if (isCodes) sequence = tokens;
    }
    var unexplained = [];
    sequence.forEach(function (t) {
      if (KNOWN_CODES.indexOf(t.toUpperCase()) === -1 && unexplained.indexOf(t) === -1) unexplained.push(t);
    });

    return {
      program: fields[0],
      target: fields[1],
      correct: correct,
      incorrect: incorrect,
      percent: percent,
      computedPercent: computedPercent,
      // The counts are the record. A percent that disagrees is flagged, and the
      // caller raises a hint rather than choosing a side.
      mismatch: percent !== null && computedPercent !== null && Math.abs(computedPercent - percent) > 1,
      sequence: sequence,
      unexplained: unexplained,
      details: details,
    };
  }

  function parseRows(text) {
    return String(text == null ? "" : text).split(/\r?\n/).map(parseRow).filter(Boolean);
  }

  // "Elopement goal: ..." names the words before the marker; "Goal: Elopement"
  // names the words after it.
  function goalWordName(body) {
    // A goal word can itself open the name ("Target Number A goal"), so every
    // marker is tried and the first one with a usable name before it wins.
    var marker = new RegExp("\\b(?:" + GOAL_WORDS + ")s?\\b", "gi");
    var hit = marker.exec(body);
    while (hit) {
      // "behavior goal" is a reduction frame, so its goal word is not a marker
      // here. A post-match check, because lookbehind throws on Safari < 16.4.
      if (/behaviou?r\s$/i.test(body.slice(0, hit.index))) {
        hit = marker.exec(body);
        continue;
      }
      var lead = body.slice(0, hit.index).split(/[:;,.()]|\s[-\u2013\u2014]\s/).pop();
      var words = lead.trim().split(/\s+/).filter(Boolean).slice(-5);
      while (words.length && LEADING_FILLER.test(words[0])) words.shift();
      var name = cleanName(words.join(" "));
      if (isUsableName(name)) return name;
      hit = marker.exec(body);
    }
    var after = new RegExp("\\b(?:" + GOAL_WORDS + ")s?\\s*[:\\-\\u2013\\u2014]\\s*(.+)$", "i").exec(body);
    if (after) {
      var named = cleanName(untilDelimiter(after[1]));
      if (isUsableName(named)) return named;
    }
    return "";
  }

  function reductionName(body, frame) {
    var afterColon = /^\s*:\s*(.+)$/.exec(body.slice(frame.index + frame[0].length));
    if (afterColon) {
      var colonName = cleanName(untilDelimiter(afterColon[1]));
      if (isUsableName(colonName)) return colonName;
    }
    var lead = body.slice(0, frame.index).replace(/[\s(:\-\u2013\u2014]+$/, "");
    var name = cleanName(lead);
    if (isUsableName(name)) return name;
    var rest = body.slice(frame.index + frame[0].length).replace(/^[\s):\-\u2013\u2014]+/, "");
    name = cleanName(untilDelimiter(rest));
    if (isUsableName(name)) return name;
    return nounPhraseBefore(lead);
  }

  // "Client engaged in elopement, a behavior of concern": the lead is garbled,
  // so the name is the noun phrase ahead of the comma, after its last
  // preposition. Verbatim casing, nothing added.
  function nounPhraseBefore(lead) {
    var head = lead.split(/[,;]/)[0];
    var after = /^(?:.*\s)?(?:in|with|of|for|during|to|by|from|at|on)\s+(.+)$/i.exec(head);
    var phrase = cleanName(after ? after[1] : head);
    return isUsableName(phrase) ? phrase : "";
  }

  function dataName(body) {
    var colon = body.indexOf(":");
    if (colon > 0 && wordCount(body.slice(0, colon)) <= 8) {
      var named = cleanName(body.slice(0, colon));
      return isUsableName(named) ? named : "";
    }
    var lead = body.split(/\s[-\u2013\u2014]\s|\(/)[0].split(/\s+/);
    var words = [];
    for (var i = 0; i < lead.length; i += 1) {
      if (/\d/.test(lead[i])) break;
      words.push(lead[i]);
    }
    var name = cleanName(words.join(" "));
    return /^[A-Z]/.test(name) && isUsableName(name) ? name : "";
  }

  // A run of capitalised words, small connectors allowed inside, that ends the
  // line or is followed by a colon, dash or bracket. A sentence is not a label.
  function labelName(body) {
    if (/\.\s*$/.test(body)) return "";
    var m = /^((?:[A-Z][\w'’\/-]*)(?:\s+(?:[A-Z][\w'’\/-]*|to|of|for|with|in|and|the|a|on|at|or|from|by))*)\s*(?::|[-\u2013\u2014(]|$)/.exec(body);
    if (!m) return "";
    var words = m[1].split(/\s+/);
    while (words.length && CONNECTORS.test(words[words.length - 1])) words.pop();
    var hasColon = /^\s*:/.test(body.slice(m[1].length));
    if (!words.length || /^[A-Za-z]+ed$/.test(words[0])) return "";
    if (!hasColon && NOT_A_NAME.test(words[0])) return "";
    var name = words.join(" ");
    return isUsableName(name) ? name : "";
  }

  function emphasisName(body) {
    var m = /\*\*([^*]{2,60})\*\*/.exec(body) || /[“"]([A-Z][^"”]{1,58})[”"]/.exec(body);
    if (!m) return "";
    var name = cleanName(m[1]);
    return isUsableName(name) ? name : "";
  }

  function definedName(body) {
    var m = DEFINED.exec(body);
    if (!m) return "";
    var name = cleanName(m[1]);
    return isUsableName(name) ? name : "";
  }

  function kindOf(line, name) {
    if (PROBE_WORDS.test(line) || PROBE_WORDS.test(name)) return "probe";
    return REDUCTION_FRAME.test(line) ? "reduction" : "skill";
  }

  function candidate(name, tier, line, why, extra) {
    return Object.assign({
      name: name,
      score: tier,
      source: line.length > SOURCE_MAX ? line.slice(0, SOURCE_MAX) : line,
      why: why,
      kind: kindOf(line, name),
    }, extra || {});
  }

  // The candidates one line yields, strongest marker first. Only a heading line
  // yields more than one.
  function fromLine(line) {
    var body = stripBullet(line).trim();
    var row = parseRow(body);
    if (row) {
      return [candidate(row.program, TIER.data, line, "A data row for this program.", { row: row, rows: [row] })];
    }
    var heading = HEADING.exec(body);
    if (heading) {
      return heading[1].split(/\s*(?:,|;|\band\b)\s*/).map(cleanName).filter(isUsableName).map(function (n) {
        return candidate(n, TIER.heading, line, "Listed in a line naming the goals assessed.");
      });
    }
    var name = goalWordName(body);
    if (name) return [candidate(name, TIER.goalWord, line, "Named next to a goal, target, program or objective word.")];
    var frame = REDUCTION_FRAME.exec(body);
    name = frame ? reductionName(body, frame) : "";
    if (name) return [candidate(name, TIER.reduction, line, "Named inside a behavior-reduction frame.")];
    name = DATA_PATTERN.test(body) ? dataName(body) : "";
    if (name) return [candidate(name, TIER.data, line, "A bullet with a count, a percent or a prompt string.")];
    name = labelName(body) || emphasisName(body);
    if (name) return [candidate(name, TIER.label, line, "A Title Case label, or a name in quotes or bold.")];
    name = definedName(body);
    if (name) return [candidate(name, TIER.defined, line, "Given a definition in the notes.")];
    return [];
  }

  function countIn(haystack, needle) {
    var n = 0;
    var at = haystack.indexOf(needle);
    while (at !== -1) {
      n += 1;
      at = haystack.indexOf(needle, at + needle.length);
    }
    return n;
  }

  function score(text) {
    var input = typeof text === "string" ? text : "";
    var byKey = {};
    var order = [];
    input.split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim().slice(0, LINE_MAX);
      if (line === "") return;
      fromLine(line).forEach(function (c) {
        var key = normalizeKey(c.name);
        var held = byKey[key];
        if (!held) {
          byKey[key] = c;
          order.push(key);
          return;
        }
        var rows = (held.rows || []).concat(c.rows || []);
        var winner = c.score > held.score ? c : held;
        byKey[key] = rows.length
          ? Object.assign({}, winner, { row: rows[0], rows: rows })
          : winner;
      });
    });
    var flat = normalizeKey(input);
    var list = order.map(function (key, i) {
      var c = byKey[key];
      var repeated = countIn(flat, key) >= 2;
      return {
        i: i,
        c: repeated
          ? Object.assign({}, c, { score: c.score + REPEAT_BONUS, why: c.why + " Named in more than one place." })
          : c,
      };
    });
    list.sort(function (a, b) { return b.c.score - a.c.score || a.i - b.i; });
    return list.map(function (x) { return x.c; });
  }

  // At most PRESELECT_CAP in all, skills and reduction targets together.
  // Reduction targets have first claim on the places; skills fill what is left,
  // and the result keeps the strip order.
  function preselect(candidates) {
    var eligible = (candidates || []).filter(function (c) {
      return c.kind !== "probe" && c.score >= PRESELECT_MIN;
    });
    var reduction = eligible.filter(function (c) { return c.kind === "reduction"; }).slice(0, PRESELECT_CAP);
    var skills = eligible.filter(function (c) { return c.kind !== "reduction"; })
      .slice(0, PRESELECT_CAP - reduction.length);
    return eligible.filter(function (c) { return reduction.indexOf(c) !== -1 || skills.indexOf(c) !== -1; });
  }

  window.GoalCandidates = {
    score: score,
    preselect: preselect,
    parseRow: parseRow,
    parseRows: parseRows,
    PRESELECT_CAP: PRESELECT_CAP,
  };
})();
