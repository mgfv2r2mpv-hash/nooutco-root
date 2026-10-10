/* Assessment note checks that read the draft against the BCBA's own notes.
 *
 * WHERE THIS CAME FROM. Kaleb's Assessment bench run, 2026-10-10 (card
 * assess-note-accuracy). The prompt now asks for each fix (assess.js,
 * ACCURACY_RULES); this file is the part that can be checked in code:
 *
 *   COUNTS ADD UP (assess-counts.js). 7 hits became 9 when the note added a
 *   group of hits with "unclear antecedents" the notes never gave, and 4 goals
 *   became 5 when the note regrouped them.
 *   A DOCUMENT KEEPS ITS NAME. "parents signed off on goals" became "parents
 *   signed authorization", and "neuropsych eval from may" became "assessment
 *   report from May". Flagged both ways: a document word the notes never use,
 *   and a document the notes name that the note does not.
 *   PLANNED STAYS PLANNED. "will add a parent training goal" became "was
 *   added". Flagged where the note writes a planned action as done.
 *   AN UNSURE DETAIL STAYS. "mand at 6 items w full echoic" lost "w full
 *   echoic". Flagged when a prompt level the notes give is dropped.
 *   A STATEMENT IS CREDITED TO WHO MADE IT. A teacher interview ticked as
 *   "Caregiver/Guardian interview", and "Collateral report from mother and
 *   father" when dad only joined for the bath-time part. Flagged.
 *
 * Every check only adds a hint. None changes a pick or rewrites a sentence:
 * the BCBA wrote the notes and reads the flag, and a pattern is not sure
 * enough to change a clinical sentence on its own.
 *
 * Pure and fail-open: assess.js runs it only on a real draft (one that carries
 * the intake), and a page where this file did not load drafts as before.
 * Exposes window.AssessChecks.
 */
(function () {
  "use strict";

  var NARRATIVES = ["narrative", "results"];
  var CAREGIVER_INTERVIEW = "Caregiver/Guardian interview";

  var STOP = /^(?:the|a|an|and|or|of|for|to|with|w|at|in|on|by|from|before|after|about|into|his|her|their|its|this|that|these|those|more|next|some|any|each|all|who|which|then|also|be|is|are|was|were|it|them|they|he|she|we|i|up|out|new|so|but)$/i;

  function text(v) {
    return typeof v === "string" ? v : "";
  }

  function counts() {
    return window.AssessCounts || null;
  }

  function hint(section, detail) {
    return { section: section, code: "ambiguous_item", kind: "thin", rank: 0, detail: detail };
  }

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function sentences(str) {
    return counts() ? counts().sentences(str) : text(str).split(/\n+/).filter(Boolean);
  }

  function prose(out) {
    return NARRATIVES.map(function (k) { return [k, text(out[k])]; });
  }

  function allProse(out) {
    return prose(out).map(function (p) { return p[1]; }).join("\n");
  }

  function quote(str, max) {
    var s = text(str).trim();
    if (s.length <= max) return s;
    return s.slice(0, max).replace(/\s\S*$/, "") + "...";
  }

  // A word counts as present when its first six letters start a word, so
  // "neuropsych" is kept by "neuropsychological". Short words match whole.
  function wordPattern(word) {
    var w = String(word).toLowerCase();
    return w.length >= 6 ? "\\b" + escapeRe(w.slice(0, 6)) + "[a-z'-]*" : "\\b" + escapeRe(w) + "\\b";
  }

  function present(word, str) {
    return new RegExp(wordPattern(word), "i").test(str);
  }

  function contentWords(str) {
    return (text(str).toLowerCase().match(/[a-z][a-z'-]+/g) || []).filter(function (w) {
      return w.length >= 3 && !STOP.test(w);
    });
  }

  // ── 1 and 3: counts (assess-counts.js) ─────────────────────────────────

  function plus(list) {
    return list.join(" + ");
  }

  function episodeHints(out, intake) {
    if (!counts()) return [];
    return prose(out).reduce(function (acc, p) {
      return acc.concat(counts().episodeFindings(p[0], p[1], intake).map(function (f) {
        if (f.kind === "sum") {
          return hint(f.section, "Counts add to " + f.added + " (" + plus(f.parts) + "), but the notes give " + f.total + " " + f.noun + "; check for an added group.");
        }
        return hint(f.section, "\"" + f.phrase + "\" adds a group: the notes' " + f.total + " " + f.noun + " are already " + plus(f.parts) + ".");
      }));
    }, []);
  }

  var ORDINAL_NAMES = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

  function goalHint(f) {
    var his = f.his ? f.his.join(" or ") : "";
    if (f.kind === "total") return hint(f.section, "The note says " + f.n + " goals; the notes give " + his + ".");
    if (f.kind === "ordinal") return hint(f.section, "The note has a " + ORDINAL_NAMES[f.n] + " goal; the notes give " + his + ".");
    if (f.kind === "domain") return hint(f.section, "The note says " + f.n + " " + f.domain + " goal" + (f.n === 1 ? "" : "s") + "; the notes give " + f.hisN + ".");
    return hint(f.section, "Goal groups add to " + f.n + "; the notes give " + his + ".");
  }

  function goalHints(out, intake) {
    if (!counts()) return [];
    return prose(out).reduce(function (acc, p) {
      return acc.concat(counts().goalFindings(p[0], p[1], intake).map(goalHint));
    }, []);
  }

  // ── 2 and 3: a document keeps its name ─────────────────────────────────

  /* A document word the note uses and the notes never do. The note side is
     strict (a word used as a document) and the notes side is loose (any form
     of the word), so a hint fires only when the notes have no trace of it.
     "authorization period" is a span of time, not a document. */
  var DOCUMENT_WORDS = [
    { name: "authorization", note: /\bauthori[sz]ations?\b(?!\s+period)/i, notes: /\bauth/i },
    { name: "consent", note: /\bconsent(?:s|ed| form)?\b/i, notes: /\bconsent/i },
    { name: "treatment plan", note: /\b(?:treatment|behaviou?r|intervention|support|care|service|safety)\s+plans?\b|\bBIP\b/i, notes: /\bplan|\bBIP\b/i },
    { name: "report", note: /\b(?:a|an|the|this|that|their|his|her|written|final|assessment|evaluation|progress|psychological|neuropsych\w*|speech|collateral|school|medical|treatment)\s+reports?\b/i, notes: /\breport/i },
    { name: "evaluation", note: /\bevals?\b|\bevaluations?\b/i, notes: /\beval/i },
  ];

  function introducedDocumentHints(out, intake) {
    return DOCUMENT_WORDS.filter(function (d) { return !d.notes.test(intake); }).reduce(function (acc, d) {
      var where = prose(out).filter(function (p) { return d.note.test(p[1]); })[0];
      return where ? acc.concat([hint(where[0], "The notes never say \"" + d.name + "\"; check which document this was.")]) : acc;
    }, []);
  }

  /* A document the notes name by a qualifier ("neuropsych eval", "speech
     eval", "prior treatment plan") that the note never names. Only known
     qualifiers count, so "the plan" or "I plan to" is never read as one. */
  var QUALIFIER = /^(?:neuro\w*|psych\w*|speech|ot|pt|slp|occupational|physical|medical|school|treatment|behaviou?r|intervention|developmental|diagnostic|progress|discharge|educational|audiology|hearing|vision|genetic|feeding|teacher|iep|fba)$/i;
  var NAMED_DOCUMENT = /\b([a-z][a-z'-]*)\s+(eval(?:uation)?s?|reports?|plans?)\b/gi;
  var ACRONYM_DOCUMENT = /\b(IEP|BIP|IFSP)\b/g;

  function namedDocuments(intake) {
    var found = {};
    var m;
    var re = new RegExp(NAMED_DOCUMENT.source, NAMED_DOCUMENT.flags);
    while ((m = re.exec(intake)) !== null) {
      var q = m[1].replace(/'s$/i, "").toLowerCase();
      if (QUALIFIER.test(q) && !found[q]) found[q] = q + " " + m[2].toLowerCase();
    }
    var acr = new RegExp(ACRONYM_DOCUMENT.source, ACRONYM_DOCUMENT.flags);
    while ((m = acr.exec(intake)) !== null) {
      var a = m[1].toLowerCase();
      if (!found[a]) found[a] = m[1];
    }
    return found;
  }

  function droppedDocumentHints(out, intake) {
    var docs = namedDocuments(intake);
    var all = allProse(out);
    return Object.keys(docs).filter(function (q) { return !present(q, all); }).map(function (q) {
      return hint("note", "The notes name the \"" + docs[q] + "\"; the note does not.");
    });
  }

  // ── 2: planned stays planned ───────────────────────────────────────────

  var FUTURE = /\b(?:will|plans? to|planning to|going to|(?:still\s+)?needs? to|intends? to|next (?:visit|session|time|week)(?:\s+to)?)\s+(?:also\s+|then\s+)?([a-z]+)((?:\s+[a-z0-9'-]+){0,6})/gi;
  var NOT_ACTIONS = /^(?:be|have|need|try|also|then|still|not)$/i;
  var OBJECT_END = /\s(?:for|before|after|with|w|to|at|in|on|by|from|and|so|but|once|when|until|if)\s/i;
  var FUTURE_MARK = /\b(?:will|would|shall|plans?|planned|planning|going to|to be|needs?|next|intends?|scheduled|yet|still|not|never)\b/i;
  var IRREGULAR = {
    write: ["wrote", "written"], send: ["sent"], make: ["made"], do: ["did", "done"], run: ["ran"],
    give: ["gave", "given"], take: ["took", "taken"], begin: ["began", "begun"], get: ["got", "gotten"],
    meet: ["met"], teach: ["taught"], build: ["built"], bring: ["brought"], find: ["found"], hold: ["held"],
    see: ["saw", "seen"], tell: ["told"], choose: ["chose", "chosen"], draw: ["drew", "drawn"], go: ["went", "gone"],
  };
  var SAME_ACT = { finish: ["complete"], complete: ["finish"] };

  function pastForms(verb) {
    var v = verb.toLowerCase();
    if (IRREGULAR[v]) return IRREGULAR[v];
    if (/e$/.test(v)) return [v + "d"];
    if (/[^aeiou]y$/.test(v)) return [v.slice(0, -1) + "ied"];
    var forms = [v + "ed"];
    if (/[^aeiou][aeiou][bdgklmnprt]$/.test(v)) forms.push(v + v.slice(-1) + "ed");
    return forms;
  }

  /* The objects of a planned act. A number keeps the word before it, so
     "finish level 2" is about "level 2" and a past act on "Level 1" is about
     something else. */
  var QUALIFIER_NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  var QUALIFIER_NUMBER = new RegExp("^(?:\\d+|" + QUALIFIER_NUMBERS.join("|") + ")$");

  function isObjectWord(w) {
    return /^[a-z][a-z'-]+$/.test(w) && w.length >= 3 && !STOP.test(w) && !QUALIFIER_NUMBER.test(w);
  }

  function numberKey(t) {
    var i = QUALIFIER_NUMBERS.indexOf(t);
    return i === -1 ? String(parseInt(t, 10)) : String(i);
  }

  function actObjects(str) {
    var tokens = text(str).toLowerCase().match(/[a-z][a-z'-]*|\d+/g) || [];
    return tokens.reduce(function (acc, t, i) {
      if (!QUALIFIER_NUMBER.test(t)) return isObjectWord(t) ? acc.concat([t]) : acc;
      var prev = tokens[i - 1];
      return prev && isObjectWord(prev) ? acc.slice(0, -1).concat([prev + " " + numberKey(t)]) : acc;
    }, []);
  }

  // "level 2" is present as "Level 2" or "level two", never as "Level 1".
  function objectPresent(object, str) {
    var parts = object.split(" ");
    if (parts.length === 1) return present(object, str);
    var n = parseInt(parts[1], 10);
    var alts = [String(n)].concat(QUALIFIER_NUMBERS[n] ? [QUALIFIER_NUMBERS[n]] : []);
    return new RegExp(wordPattern(parts[0]) + "\\s+(?:" + alts.join("|") + ")\\b", "i").test(str);
  }

  function plannedActs(intake) {
    var acts = [];
    var re = new RegExp(FUTURE.source, FUTURE.flags);
    var m;
    while ((m = re.exec(intake)) !== null) {
      var verb = m[1].toLowerCase();
      if (NOT_ACTIONS.test(verb)) continue;
      var tail = (" " + m[2] + " ").split(OBJECT_END)[0];
      var objects = actObjects(tail).slice(0, 4);
      if (!objects.length) continue;
      var forms = [verb].concat(SAME_ACT[verb] || []).reduce(function (acc, v) { return acc.concat(pastForms(v)); }, []);
      acts.push({ said: quote((m[0] + " ").split(OBJECT_END)[0], 40), verb: verb, forms: forms, objects: objects });
    }
    return acts;
  }

  /* A past time names an earlier event, not this visit's: "the BIP was
     updated last month" is not the BIP update still planned. Only spans of
     time count: "prior authorization" is a document, and "previously planned"
     can describe this visit. */
  var PAST_TIME = /\b(?:last|previous|prior|past)\s+(?:week|month|year|visit|session|semester|quarter|school\s+year)\b|\byesterday\b|\b(?:\d+|a|an|one|two|three|four|five|six|several|few)\s+(?:days?|weeks?|months?|years?)\s+ago\b|\bearlier\s+this\s+(?:week|month|year)\b/i;

  // The clause around a match: the act and its object, between commas or
  // semicolons, so "Level 1 was completed, and Level 2 is partial" is two.
  function clauseAt(sentence, index) {
    var start = Math.max(sentence.lastIndexOf(",", index), sentence.lastIndexOf(";", index), sentence.lastIndexOf(":", index)) + 1;
    var rest = sentence.slice(index).search(/[,;:]/);
    return sentence.slice(start, rest === -1 ? sentence.length : index + rest);
  }

  function pastHits(sentence, act) {
    return act.forms.reduce(function (acc, f) {
      return acc.concat(matchIndexes(new RegExp("\\b" + f + "\\b", "gi"), sentence));
    }, []);
  }

  function matchIndexes(re, str) {
    var out = [];
    var m;
    while ((m = re.exec(str)) !== null) out.push(m.index);
    return out;
  }

  function writtenAsDone(sentence, act) {
    if (PAST_TIME.test(sentence)) return false;
    var need = Math.min(2, act.objects.length);
    return pastHits(sentence, act).some(function (index) {
      if (FUTURE_MARK.test(sentence.slice(0, index))) return false;
      var clause = clauseAt(sentence, index);
      return act.objects.filter(function (o) { return objectPresent(o, clause); }).length >= need;
    });
  }

  function tenseHints(out, intake) {
    var acts = plannedActs(intake);
    if (!acts.length) return [];
    var hints = [];
    prose(out).forEach(function (p) {
      sentences(p[1]).forEach(function (s) {
        acts.forEach(function (act) {
          if (writtenAsDone(s, act)) {
            hints.push(hint(p[0], "The notes say \"" + act.said + "\"; the note says it was done. Keep it planned."));
          }
        });
      });
    });
    return hints;
  }

  // ── 4: an unsure detail stays ──────────────────────────────────────────

  var PROMPT_DETAIL = /\b(full|partial)[-\s]+(echoic|verbal|physical|model(?:ing)?|gestural|vocal)\b/gi;

  function droppedPromptHints(out, intake) {
    var all = allProse(out);
    var seen = {};
    var hints = [];
    var re = new RegExp(PROMPT_DETAIL.source, PROMPT_DETAIL.flags);
    var m;
    while ((m = re.exec(intake)) !== null) {
      var said = m[1].toLowerCase() + " " + m[2].toLowerCase();
      if (seen[said]) continue;
      seen[said] = true;
      var kept = new RegExp("\\b" + m[1] + "[-\\s]+" + m[2].slice(0, 5), "i");
      if (!kept.test(all)) hints.push(hint("results", "The notes say \"" + said + "\"; the note dropped it. Keep the notes' words, or ask."));
    }
    return hints;
  }

  // ── 5: a statement is credited to who made it ──────────────────────────

  var CAREGIVER = /\b(?:parents?|caregivers?|guardians?|mom|dad|mother|father|grand(?:ma|pa|mother|father|parents?)|family|families)\b/i;
  var STAFF = /\b(teachers?|aides?|paras?|paraprofessionals?|staff|principal|counselor|therapists?|RBTs?|BTs?)\b/i;

  function clauses(str) {
    return text(str).split(/[.;\n]+/).map(function (c) { return c.trim(); }).filter(Boolean);
  }

  function interviewClauses(intake) {
    return clauses(intake).filter(function (c) { return /\binterview/i.test(c); });
  }

  function interviewHints(out, intake) {
    var picked = Array.isArray(out.activities) ? out.activities : [];
    if (picked.indexOf(CAREGIVER_INTERVIEW) === -1) return [];
    var heard = interviewClauses(intake);
    if (!heard.length || heard.some(function (c) { return CAREGIVER.test(c); })) return [];
    var staff = heard.map(function (c) { return STAFF.exec(c); }).filter(Boolean)[0];
    if (!staff) return [];
    return [hint("activities", CAREGIVER_INTERVIEW + " is ticked, but the interview in the notes was with the " + staff[1].toLowerCase() + ".")];
  }

  var PARENTS = [
    { name: "mom", re: /\b(?:mom|mother|mum)\b/i },
    { name: "dad", re: /\b(?:dad|father)\b/i },
  ];
  var BOTH_PARENTS = /\b(?:mother and father|father and mother|mom and dad|dad and mom|both parents|parents|caregivers)\b/i;
  var GENERIC = /^(?:interview\w*|joined|last|min|mins|minutes|about|agreed|part|said|says|also|for|the|and|that|this|was|were|mom|mother|mum|dad|father)$/i;

  /* Who the notes say was interviewed, and the other parent who only joined
     for part of it: { main, other, heard, said } or null. */
  function partialParent(intake) {
    var heard = interviewClauses(intake);
    if (!heard.length || heard.some(function (c) { return /\bparents\b/i.test(c); })) return null;
    var main = PARENTS.filter(function (p) { return heard.some(function (c) { return p.re.test(c); }); });
    if (main.length !== 1) return null;
    var other = PARENTS.filter(function (p) { return p !== main[0]; })[0];
    var said = clauses(intake).filter(function (c) { return other.re.test(c) && !main[0].re.test(c); });
    if (!said.length) return null;
    return { main: main[0], other: other, heard: heard.filter(function (c) { return main[0].re.test(c); }), said: said };
  }

  /* A sentence crediting both parents with something only the interviewed
     parent said: a word from that parent's interview that the other parent's
     part never has ("eats 6 foods" when dad only spoke about bath time). */
  function creditHints(out, intake) {
    var partial = partialParent(intake);
    if (!partial) return [];
    var theirs = partial.said.join(" ");
    var onlyMain = contentWords(partial.heard.join(" ")).filter(function (w) {
      return !GENERIC.test(w) && !present(w, theirs);
    });
    var hints = [];
    prose(out).forEach(function (p) {
      sentences(p[1]).forEach(function (s) {
        if (!BOTH_PARENTS.test(s)) return;
        if (!onlyMain.some(function (w) { return present(w, s); })) return;
        hints.push(hint(p[0], "Credits both parents, but the notes give " + partial.other.name + " only this: \"" + quote(partial.said[0], 50) + "\""));
      });
    });
    return hints;
  }

  // ── The whole check ────────────────────────────────────────────────────

  function dedupe(hints) {
    var seen = {};
    return hints.filter(function (h) {
      var key = h.section + "|" + h.detail;
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  /* Returns the output unchanged, as a NEW object, and the hints to add; the
     caller concatenates them before its hint normalizer runs, so they take
     the same validation as every other hint. */
  function apply(out, intake) {
    var o = out && typeof out === "object" ? out : {};
    var src = text(intake);
    var next = Object.assign({}, o);
    if (!src.trim()) return { output: next, hints: [] };
    var hints = episodeHints(next, src).concat(
      goalHints(next, src),
      introducedDocumentHints(next, src),
      droppedDocumentHints(next, src),
      tenseHints(next, src),
      droppedPromptHints(next, src),
      interviewHints(next, src),
      creditHints(next, src)
    );
    return { output: next, hints: dedupe(hints) };
  }

  window.AssessChecks = {
    apply: apply,
    pastForms: pastForms,
    plannedActs: plannedActs,
    namedDocuments: namedDocuments,
  };
})();
