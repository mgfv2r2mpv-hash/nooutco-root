/* A BEHAVIOR THE NOTES SAY DID NOT STOP, WRITTEN AS ONE THAT DID (issue #118).
 *
 * Kaleb, pointing at an attention-test sentence in an Assessment note: "if the
 * vocalizations didn't resolve, then the client kept making the vocalizations."
 * His reading, confirmed on the board on 2026-10-09: the write-up treated
 * vocalizations that never resolved as if they had stopped. When the data says
 * a behavior did not resolve, the write-up says it continued.
 *
 * The drafting prompt already asks for that (assess.js, 36e4e863). A prompt
 * cannot guarantee it, so this checks it after the model returns. It only
 * ever raises a hint or holds back an expert finding. It never rewrites the
 * note: Kaleb's clinical rule is that an automatic check raises hints and
 * never rewrites a correct sentence or changes a tick or a pick.
 *
 *   hints       a clause that says a behavior stopped, when the notes say that
 *               behavior did not, is an amber hint on its section. The sentence
 *               is the clinician's to correct.
 *   tagExpert   an expert ask or replacement sentence that assumes the
 *               behavior stopped keeps its place and carries an amber tag,
 *               "Assumes crying stopped; the notes say it did not.", and is
 *               counted. Nothing the expert said is dropped or applied: a
 *               check raises a hint and never acts on its own (Atlas, 10 Oct).
 *
 * WHY THERE IS NO REWRITE. #328 recast "did not resolve" to "continued". The
 * review of #337 (10 Oct) found it flipped correct sentences: "did not resolve
 * once during the session" became "continued once", "did not resolve or
 * escalate" became "continued or escalate", and a caregiver's quoted words
 * were rewritten. A draft that says "did not resolve" already agrees with the
 * notes, so the check leaves it alone.
 *
 * WHAT IT CANNOT SEE. A behavior named only by a word with a different stem
 * ("eloped" against "elopement"), a subject the draft leaves out ("He eloped
 * twice and then stopped"), a behavior the notes say both stopped and did not
 * (it is left alone), and a skill the notes say kept going ("kept eating").
 * Each is a missed hint rather than a guess: this is clinical text for a
 * BCBA, and a false flag is worse than a miss (Pollux's hold on #328).
 *
 * Pure. Every function returns a new value and edits nothing it was given. */
(function () {
  "use strict";

  /* "<behavior> did not resolve", "<behavior> didn't stop", "<behavior>
     remained unresolved", "<behavior> continued", "kept <behavior>ing",
     "continued <behavior>ing", "continued to <behavior>". The behavior is the
     captured word, and it counts only when it is a behavior (isBehavior). */
  var NOT_STOPPED = [
    /\b([a-z][a-z'-]*)\s+(?:did\s+not|didn't|does\s+not|doesn't|never|failed\s+to)\s+(?:resolve|stop|subside|cease|end)\b/gi,
    /\b([a-z][a-z'-]*)\s+(?:was|were|is|are|remained|stayed)\s+(?:not\s+resolved|unresolved)\b/gi,
    /\b([a-z][a-z'-]*)\s+(?:persisted|continued)\b/gi,
  ];
  // "kept eating" and "continued requesting" are skills (Pollux, finding 4).
  var KEPT_GOING = [
    /\b(?:kept|continued)\s+([a-z]+ing)\b/gi,
    /\bcontinued\s+to\s+([a-z]+)\b/gi,
  ];
  /* Problem behaviors, by stem. The second line is the review of #337
     (MEDIUM 2): meltdown, stereotypy, property destruction, self-injury,
     echolalia, pica and dropping were missing. A hyphenated word matches on
     either half, so "head-banging" and "hand-flapping" read. */
  var PROBLEM = ("cry sob wail whine whimper fuss scream shriek squeal yell shout " +
    "curse swear protest refuse tantrum vocalize hit kick bite scratch pinch " +
    "spit slap punch push grab swipe elbow headbutt aggress throw destroy " +
    "elope bang headbang flop injure mouth lick smear flap script stim growl " +
    "aggression elopement disrupt noncompliance sib " +
    "meltdown stereotyp destruct injury echolalia pica drop")
    .split(" ");
  var PROBLEM_STEMS = PROBLEM.map(stem);
  // A problem stem matches a longer word from this length on: "elop" reads
  // "elopement", "aggress" reads "aggression".
  var PREFIX_MIN = 4;
  /* Words that name a target behavior in the notes. A word in the same
     sentence counts as named. */
  var TARGET = /\b(?:target(?:ed)?\s+behaviou?rs?|behaviou?rs?\s+of\s+concern|problem\s+behaviou?rs?|challenging\s+behaviou?rs?|maladaptive|bocs?|reduction\s+goals?)\b/i;

  /* Words that sit in the behavior slot and are not a behavior ("The data
     did not resolve whether ...", "The FA failed to resolve which ..."). */
  var NOT_A_BEHAVIOR = /^(?:the|a|an|it|this|that|they|he|she|client|child|learner|bcba|bt|rbt|staff|technician|therapist|session|trials?|going|doing|working|playing|engaging|participating|attending|data|fa|fba|function|assessment|analysis|question|hypothesis|pattern|results?|conditions?|issue|concern|problem|conflict|disagreement|team|plan|intervention|reinforcement|attention|prompting|prompts?|demands?|behaviou?rs?|targets?|targeted|stimulus|stimuli|mom|dad|mother|father|caregiver|parent|teacher)$/i;

  // A claim that something stopped. "no longer" is one with no verb in it.
  var STOPPED = /\b(?:stopped|stops|stop|ceased|ceases|cease|resolved|resolves|resolve|subsided|subsides|subside|ended|extinguished|terminated)\b|\bno\s+longer\b/gi;
  /* Negated: the negation and the verb, with only the words of a verb group
     between them, so "were not at any point observed to have stopped" and
     "did not appear to have stopped" are negated and "Not long after the
     break crying stopped" and "Without the iPad present crying stopped" are
     not (the review of #337, LOW). "n't" carries no word boundary in front of
     it ("didn't"). */
  var NEGATED = /(?:\bnot|\bno|\bnever|\bwithout|\bunlikely|\bfailed\s+to|n't)\s+(?:(?:be|been|being|have|has|had|to|appear|appeared|appears|seem|seemed|seems|likely|observed|reported|noted|seen|at|any|point|yet|fully|completely|entirely|totally|ever|always|really|actually|truly|immediately|quickly|get|got)\s+){0,6}$/i;
  /* An infinitive or a modal is not a claim that it stopped: "asked him to
     stop crying", "led the BT to stop the trial" (the review of #337, MEDIUM 5). */
  var NOT_A_CLAIM = /\b(?:to|will|would|could|should|might|may|can|must)\s+$/i;
  /* A clause that opens by denying it, anywhere before the verb: "At no point
     did crying stop", "Nothing suggested crying stopped", "There was no
     indication that crying stopped" (the pass on #337). */
  var DENIED = /\b(?:at\s+no\s+(?:point|time)|no\s+(?:indication|evidence|sign)|nothing\s+suggest\w*)\b/i;
  /* A plan or a condition in the present tense is not a report that it
     stopped: "When crying stops, the BT will provide praise." */
  var PRESENT = /^(?:stops?|ceases?|resolves?|subsides?)$/i;
  var CONDITIONAL = /\b(?:when|whenever|if|once|unless|until|as\s+soon\s+as)\b/i;
  // Someone else's words: "The note says crying stopped", "Mom reports ...".
  var REPORTED = /\b(?:says?|said|states?|stated|reads|claims?|claimed|writes?|wrote|reports?|reported|describes?|described|labels?|labell?ed)\b/i;
  /* A clause that says the behavior went on is not a stop claim, whatever
     else stopped in it: "Crying continued after the BT told him to stop" is
     about the BT (Pollux, finding 2). */
  var CONTINUING = /\b(?:continu(?:e|ed|es|ing)|kept|keeps|persist(?:ed|s|ing)?|remain(?:ed|s|ing)?|still|did\s+not|didn't|does\s+not|doesn't)\b/i;
  /* A clause of the notes whose subject is left out or is a pronoun ("...,
     but stopped within a minute", "but did stop", "they stopped") is about a
     clause before it. */
  var SUBJECTLESS = /^(?:(?:it|they|he|she|this|then|eventually|later|finally|soon|quickly|did|had|has|was|were)\s+){0,3}(?:stopped|stop|ceased|cease|resolved|resolve|subsided|subside|ended|end)\b/i;

  /* What follows the stop verb decides whose stop it is.
       an object       "Elopement ended the session", "Hitting stopped the
                       game": the object stopped, not the behavior.
       a behavior      "stopped crying", "stopped his crying": the behavior.
       anything else   "Crying stopped after the break": the subject. */
  var OBJECT = /^(?:the|a|an|his|her|their|its|this|that|these|those|him|them|it|all|any|some|every|each|my|our|your)$/;
  /* A time phrase after the verb is not its object: "Crying stopped a few
     minutes after the break", "the moment he got the iPad", "each time",
     "all at once", "that afternoon" (the pass on #337). Session, interval
     and trial are times only after this, that, each, every or all, because
     "Elopement ended the session early" is the session ending. */
  var TIME = /^(?:minutes?|seconds?|moments?|times?|point|days?|afternoon|morning|evening|night|hours?|weeks?|once)$/;
  var TIME_AFTER_DEMONSTRATIVE = /^(?:sessions?|intervals?|trials?)$/;
  var DEMONSTRATIVE = /^(?:this|that|each|every|all)$/;
  var TIME_FILLER = /^(?:few|couple|of|at|same|very|first|last|next)$/;
  var PREP_ING = /^(?:during|following|including|regarding|concerning|according|considering|pending)$/;
  var NO_LONGER_REACH = 3;
  /* The subject is the few words just before the verb, back to a word that
     opens another clause, past auxiliaries and adverbs. "SIB occurred twice
     before the BT stopped" stops at "before" (the review of #337, MEDIUM 5). */
  var SUBJECT_REACH = 4;
  var VERB_GROUP = /^(?:was|were|had|has|have|been|is|are|did|does|do|eventually|finally|then|quickly|gradually|also|completely|fully|immediately|soon|later|all|both|largely|mostly|nearly|abruptly|suddenly|briefly|only|just)$/;
  var OPENS_CLAUSE = /^(?:before|after|when|until|while|once|because|since|as|if|that|which|who|whom|where|whenever|so|than)$/;
  var PRONOUN = /^(?:it|they|this|these)$/;

  /* The FA conditions a clause names, folded to one name each: the escape
     condition presents demands, the alone condition is also called ignore,
     and play is the control. */
  var CONDITION = /\b(attention|escape|demands?|tangibles?|play|alone|ignore|control)\b/gi;
  var SAME_CONDITION = { demand: "escape", ignore: "alone", control: "play" };

  var SENTENCE = /[.;!?\n]+/;
  /* Clauses, so "Crying stopped and the vocalizations continued" is two
     claims about two behaviors rather than one sentence holding both words. */
  var CLAUSE = /[.;:!?,\n]+|\s+(?:and|but|or|while|whereas|although|though|until)\s+/i;

  // Someone's words in quotes are theirs, and are not read as a claim.
  var QUOTED = /"[^"]*"|“[^”]*”|(^|[\s(])'[^']*'(?=[\s.,;:!?)]|$)/g;

  // An expert ask that is a question or a correction is not an assertion.
  var OPEN_QUESTION = /\b(?:continu\w*|persist\w*|whether)\b/i;
  var YES_NO = /^(?:did|does|do|was|were|is|are|has|had|have|could|can|will|would|should)\b/i;
  var AGREES = /\b(?:did\s+not|didn't|does\s+not|doesn't|not\s+stop\w*|never\s+stopped|correct\w*|rewrite|revise|fix)\b/i;

  function text(v) {
    return typeof v === "string" ? v : "";
  }

  /* One stem for one behavior across its forms: vocalizations, vocalizing,
     vocalized and vocalize are "vocaliz"; crying, cried and cries are "cry". */
  function stem(word) {
    var w = String(word || "").toLowerCase().replace(/'s$/, "");
    var cut = w.replace(/(?:ations?|ings?|ed|es|s|e)$/, "");
    if (cut.length >= 3) w = cut;
    if (/([b-df-hj-np-tv-z])\1$/.test(w)) w = w.slice(0, -1);
    return w.replace(/i$/, "y");
  }

  function unquote(s) {
    return text(s).replace(QUOTED, function (all, lead) { return (lead || "") + " "; });
  }

  function split(s, re) {
    return text(s).split(re).map(function (c) { return c.trim(); }).filter(Boolean);
  }

  function clauses(s) { return split(s, CLAUSE); }
  function sentences(s) { return split(s, SENTENCE); }

  function words(clause) {
    return text(clause).toLowerCase().match(/[a-z][a-z'-]*/g) || [];
  }

  function hasAny(ws, stems) {
    return ws.map(stem).some(function (s) { return stems.indexOf(s) !== -1; });
  }

  function conditionsIn(s) {
    var out = [];
    var re = new RegExp(CONDITION.source, "gi");
    var m;
    while ((m = re.exec(text(s)))) {
      var c = m[1].toLowerCase().replace(/s$/, "");
      c = SAME_CONDITION[c] || c;
      if (out.indexOf(c) === -1) out.push(c);
    }
    return out;
  }

  /* The conditions of a clause, else of its sentence. Never the whole line:
     an ordinary "play" or "attention" elsewhere in it would hide a real hint
     (the review of #337, MEDIUM 1). None found is null, which means any. */
  function conditionsFor(clause, sentence) {
    var own = conditionsIn(clause);
    if (own.length) return own;
    var around = conditionsIn(sentence);
    return around.length ? around : null;
  }

  // True when the stop verb found at `m` is a claim that something stopped.
  function claimAt(clause, m) {
    var pre = clause.slice(0, m.index);
    if (NEGATED.test(pre) || NOT_A_CLAIM.test(pre) || REPORTED.test(pre) || DENIED.test(pre)) return false;
    return !(PRESENT.test(m[0]) && CONDITIONAL.test(pre));
  }

  // True when the words after the verb open a time phrase, not an object.
  function timePhrase(rest) {
    var det = rest[0] || "";
    for (var i = 1; i < rest.length && i <= 3; i++) {
      if (TIME.test(rest[i])) return true;
      if (DEMONSTRATIVE.test(det) && TIME_AFTER_DEMONSTRATIVE.test(rest[i])) return true;
      if (!TIME_FILLER.test(rest[i])) return false;
    }
    return false;
  }

  /* True when a clause of the notes says something stopped. Read loosely:
     here a wider reading only means fewer behaviors are checked. */
  function saysStopped(clause) {
    var c = unquote(clause);
    if (CONTINUING.test(c)) return false;
    var re = new RegExp(STOPPED.source, "gi");
    var m;
    while ((m = re.exec(c))) {
      if (claimAt(c, m)) return true;
    }
    return false;
  }

  // The words just before the verb that can be its subject.
  function subjectWords(pre) {
    var ws = words(pre);
    var i = ws.length - 1;
    while (i >= 0 && VERB_GROUP.test(ws[i])) i -= 1;
    var out = [];
    for (; i >= 0 && out.length < SUBJECT_REACH && !OPENS_CLAUSE.test(ws[i]); i--) out.push(ws[i]);
    return out;
  }

  /* The stems, out of the ones given, that a clause of the draft says
     stopped. `before` is the clauses ahead of it in the same sentence, for a
     pronoun subject: "Elopement occurred three times, but it stopped". */
  function stoppedSubjects(clause, stems, before) {
    var c = unquote(clause);
    if (CONTINUING.test(c)) return [];
    var re = new RegExp(STOPPED.source, "gi");
    var out = [];
    var add = function (ws) {
      ws.map(stem).forEach(function (s) {
        if (stems.indexOf(s) !== -1 && out.indexOf(s) === -1) out.push(s);
      });
    };
    var m;
    while ((m = re.exec(c))) {
      if (!claimAt(c, m)) continue;
      var rest = words(c.slice(m.index + m[0].length));
      if (/^no\s/i.test(m[0])) {
        add(rest.slice(0, NO_LONGER_REACH));
        continue;
      }
      var next = rest[0] || "";
      if (OBJECT.test(next) && !timePhrase(rest)) {
        add(rest.slice(1, 3));
        continue;
      }
      if (hasAny([next], stems)) {
        add([next]);
        continue;
      }
      if (/ing$/.test(next) && !PREP_ING.test(next)) continue;
      var subject = subjectWords(c.slice(0, m.index));
      if (subject.length && PRONOUN.test(subject[0])) {
        var named = (before || []).filter(function (b) { return hasAny(words(b), stems); });
        if (named.length) add(words(named[named.length - 1]));
        continue;
      }
      add(subject);
      /* "Crying, hitting and kicking all stopped": the clauses before this
         one that only name behaviors are the rest of its subject. */
      if (hasAny(subject, stems)) {
        for (var j = (before || []).length - 1; j >= 0 && bareList(before[j], stems); j--) add(words(before[j]));
      }
    }
    return out;
  }

  // A clause that is nothing but behaviors: one item of a list.
  function bareList(clause, stems) {
    var ws = words(clause);
    return ws.length > 0 && ws.length <= 3 && ws.every(function (w) {
      return stems.indexOf(stem(w)) !== -1 || /^(?:the|his|her|their)$/.test(w);
    });
  }

  // The words a set of patterns captured in one clause, minus the non-behaviors.
  function captured(c, patterns) {
    var out = [];
    patterns.forEach(function (re) {
      var r = new RegExp(re.source, "gi");
      var m;
      while ((m = r.exec(c))) {
        var w = m[1].toLowerCase();
        if (!NOT_A_BEHAVIOR.test(w)) out.push(w);
      }
    });
    return out;
  }

  /* Stems the notes name as a target: every word of a sentence that says
     "target behavior" and the like. */
  function targets(intake) {
    var out = [];
    sentences(intake).forEach(function (s) {
      if (TARGET.test(s)) out = out.concat(words(s).map(stem));
    });
    return out;
  }

  /* A behavior, not a subject that only sits where one could: a problem
     behavior, by stem or by a longer word on the same stem, on the whole
     word or either half of a hyphenated one, or a word the notes name as a
     target. "data", "FA" and "function" never are. */
  function isBehavior(word, named) {
    if (named.indexOf(stem(word)) !== -1) return true;
    return [word].concat(word.split("-")).some(function (part) {
      var s = stem(part);
      return s.length > 0 && PROBLEM_STEMS.some(function (p) {
        return s === p || (p.length >= PREFIX_MIN && s.indexOf(p) === 0);
      });
    });
  }

  /* Every clause of the notes, with the sentence it sits in, so a clause can
     reach back for its subject. */
  function clauseList(intake) {
    var out = [];
    sentences(intake).forEach(function (sent, n) {
      clauses(sent).forEach(function (c) { out.push({ text: c, sentence: n }); });
    });
    return out;
  }

  /* A subjectless clause of the notes is about the nearest clause before it
     in the same sentence that names one of the behaviors, else the clause
     just before. */
  function subjectBefore(cs, i, stems) {
    for (var j = i - 1; j >= 0 && cs[j].sentence === cs[i].sentence; j--) {
      if (hasAny(words(cs[j].text), stems)) return cs[j].text;
    }
    return i > 0 ? cs[i - 1].text : "";
  }

  function mergeConditions(a, b) {
    if (!a || !b) return null;
    return a.concat(b.filter(function (x) { return a.indexOf(x) === -1; }));
  }

  /* The behaviors the notes say did not stop, each with the conditions it
     was said of (null for any), minus any the notes also say stopped. */
  function unresolved(intake) {
    var named = targets(intake);
    var said = [];
    sentences(intake).forEach(function (sent) {
      clauses(sent).forEach(function (c) {
        captured(c, NOT_STOPPED).concat(captured(c, KEPT_GOING)).forEach(function (w) {
          if (!isBehavior(w, named)) return;
          var conds = conditionsFor(c, sent);
          var prior = said.filter(function (e) { return e.word === w; })[0];
          said = prior
            ? said.map(function (e) { return e.word === w ? { word: w, conds: mergeConditions(e.conds, conds) } : e; })
            : said.concat([{ word: w, conds: conds }]);
        });
      });
    });
    if (!said.length) return [];
    /* "Vocalizations did not stop in attention but stopped in escape." The
       second clause takes the subject of the first, and the behavior counts
       as both stopped and not, so it is left alone. */
    var stems = said.map(function (e) { return stem(e.word); });
    var cs = clauseList(intake);
    var stopped = [];
    cs.forEach(function (c, i) {
      if (!saysStopped(c.text)) return;
      var ws = words(c.text);
      if (SUBJECTLESS.test(c.text)) ws = ws.concat(words(subjectBefore(cs, i, stems)));
      stopped = stopped.concat(ws.map(stem));
    });
    return said.filter(function (e) { return stopped.indexOf(stem(e.word)) === -1; });
  }

  // The behaviors the notes say did not stop, as typed (lower case).
  function behaviors(intake) {
    return unresolved(intake).map(function (e) { return e.word; });
  }

  /* The behaviors a passage says stopped, out of the ones given (from
     unresolved). A clause that names a condition the behavior was never said
     of is about that other condition, and is not counted: "Vocalizations
     stopped in escape but not attention". */
  function stoppedIn(passage, said) {
    var stems = said.map(function (e) { return stem(e.word); });
    var found = [];
    sentences(passage).forEach(function (sent) {
      var cs = clauses(sent);
      cs.forEach(function (c, i) {
        var here = conditionsFor(c, sent);
        stoppedSubjects(c, stems, cs.slice(0, i)).forEach(function (s) {
          var e = said[stems.indexOf(s)];
          if (e.conds && here && !e.conds.some(function (x) { return here.indexOf(x) !== -1; })) return;
          if (found.indexOf(e.word) === -1) found.push(e.word);
        });
      });
    });
    return found;
  }

  // "crying", "crying and hitting", "crying, hitting and kicking".
  function listOf(ws) {
    return ws.length < 2 ? ws.join("") : ws.slice(0, -1).join(", ") + " and " + ws[ws.length - 1];
  }

  function plural(ws) {
    return ws.length > 1 || /[^s]s$/.test(ws[0] || "");
  }

  function detailFor(hit) {
    var they = plural(hit);
    var long = "Notes say the " + listOf(hit) + " did not stop; this says " + (they ? "they" : "it") + " did. Say " + (they ? "they" : "it") + " continued.";
    var short = "Notes say the " + listOf(hit) + " did not stop; this says " + (they ? "they" : "it") + " did.";
    return (long.length <= 120 ? long : short).slice(0, 120);
  }

  /* One amber hint per section that says a behavior stopped when the notes
     say it did not. ambiguous_item is in every tool's catalog. Rank 0, as
     misplaced is ranked: it is a match against the notes, not a judgement. */
  function hints(output, intake, ids) {
    var said = unresolved(intake);
    if (!said.length || !output || typeof output !== "object") return [];
    var out = [];
    (ids || []).forEach(function (id) {
      var hit = stoppedIn(text(output[id]), said);
      if (!hit.length) return;
      out.push({
        section: id,
        code: "ambiguous_item",
        kind: "thin",
        rank: 0,
        detail: detailFor(hit),
      });
    });
    return out;
  }

  /* The behavior an expert sentence takes as having stopped, or "". A yes/no
     question ("Did crying stop before the break?"), one that offers continue
     or whether, and a correction that already says it did not stop ask the
     right thing, and take nothing as given (the review of #337, MEDIUM 4). */
  function assumedStop(s, said) {
    var t = unquote(s).trim();
    if (!t || YES_NO.test(t) || OPEN_QUESTION.test(t) || AGREES.test(t)) return "";
    return stoppedIn(t, said)[0] || "";
  }

  // "Assumes crying stopped; the notes say it did not."
  function tagFor(word) {
    return "Assumes " + word + " stopped; the notes say " + (plural([word]) ? "they" : "it") + " did not.";
  }

  /* The expert's result with every finding kept, and the ones that take a
     stop as given when the notes say it did not tagged, with a count. Only
     the ask and the replacement sentence are read: a reason given alone is
     the expert explaining a finding, and a quote is the clinician's own
     words. A tagged replacement sentence is shown, never applied. */
  function tagExpert(found, intake) {
    if (!found || typeof found !== "object") return found;
    var said = unresolved(intake);
    var out = {};
    for (var k in found) if (Object.prototype.hasOwnProperty.call(found, k)) out[k] = found[k];
    var tagged = 0;
    var mark = function (item, sentence) {
      var word = item && said.length ? assumedStop(text(sentence), said) : "";
      if (!word) return item;
      tagged += 1;
      var copy = {};
      for (var key in item) if (Object.prototype.hasOwnProperty.call(item, key)) copy[key] = item[key];
      copy.assumes = tagFor(word);
      return copy;
    };
    if (Array.isArray(found.hints)) out.hints = found.hints.map(function (h) { return mark(h, h && h.ask); });
    if (Array.isArray(found.register)) out.register = found.register.map(function (r) { return mark(r, r && r.move); });
    out.unresolvedTagged = tagged;
    return out;
  }

  window.NoteUnresolved = {
    behaviors: behaviors,
    hints: hints,
    tagExpert: tagExpert,
  };
})();
