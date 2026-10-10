/* A BEHAVIOR THE NOTES SAY DID NOT STOP, WRITTEN AS ONE THAT DID (issue #118).
 *
 * Kaleb, pointing at an attention-test sentence in an Assessment note: "if the
 * vocalizations didn't resolve, then the client kept making the vocalizations."
 * His reading, confirmed on the board on 2026-10-09: the write-up treated
 * vocalizations that never resolved as if they had stopped. When the data says
 * a behavior did not resolve, the write-up says it continued.
 *
 * The drafting prompt already asks for that (assess.js, 36e4e863). A prompt
 * cannot guarantee it, so this enforces it after the model returns, with the
 * discipline absence.js and hollow.js keep: act only where being wrong costs
 * nothing, and flag the rest for the clinician.
 *
 *   recast      "did not resolve" -> "continued". His own reading of the
 *               phrase, and nothing else in the sentence moves. Only where
 *               the word before it is a behavior the notes say did not
 *               resolve, and only where nothing after it changes what it
 *               means; the section then says what was changed.
 *   hints       a clause that says a behavior stopped, when the notes say that
 *               behavior did not, is an amber hint on its section. The sentence
 *               is not rewritten: which condition it describes is a finding,
 *               and a regular expression does not get to decide a finding.
 *   dropExpert  an expert ask or replacement sentence that assumes the
 *               behavior stopped is dropped before the panel reads it.
 *
 * WHAT IT CANNOT SEE. A pronoun ("and they stopped"), a behavior the notes
 * name only by a word with a different stem ("eloped" against "elopement"),
 * a behavior the notes say both stopped and did not (two conditions, and
 * no way here to tell which sentence is about which), and a skill the notes
 * say kept going ("kept eating") that is not on the problem list below. Each
 * of those is left alone rather than guessed at.
 *
 * POLLUX'S HOLD ON #328 (9 Oct) set the direction for every guard below: this
 * is clinical text for a BCBA, and a wrong automatic rewrite or a false flag
 * is worse than a miss.
 *
 * THE LATE HOLD ON #328 (10 Oct) restates Kaleb's clinical rule: automatic
 * checks raise hints and never rewrite a correct sentence. So a subject
 * counts only when it is a behavior (a problem behavior below, or one the
 * notes name as a target), "failed to resolve" and a passive "was not
 * resolved" are never rewritten, a stop claim needs the behavior as its
 * subject, and a behavior the notes say did not stop in one condition is not
 * flagged where a sentence says it stopped in another.
 *
 * Pure. Every function returns a new value and edits nothing it was given. */
(function () {
  "use strict";

  /* "<behavior> did not resolve", "<behavior> didn't stop", "<behavior>
     remained unresolved", "kept <behavior>ing", "continued <behavior>ing",
     "continued to <behavior>". The behavior is the captured word. */
  var NOT_STOPPED = [
    /\b([a-z][a-z'-]*)\s+(?:did\s+not|didn't|does\s+not|doesn't|never|failed\s+to)\s+(?:resolve|stop|subside|cease|end)\b/gi,
    /\b([a-z][a-z'-]*)\s+(?:was|were|is|are|remained|stayed)\s+(?:not\s+resolved|unresolved)\b/gi,
    /\b([a-z][a-z'-]*)\s+persisted\b/gi,
  ];
  /* "kept <x>ing" and "continued <x>ing / to <x>" say only that something went
     on, and a skill goes on too: "kept eating", "continued requesting"
     (Pollux, finding 4). These count only when the word is a problem
     behavior below, or the notes name it a target elsewhere. A behavior
     missing from both is missed, on purpose: a missed case costs a hint, and
     a skill read as a behavior puts a false flag on a correct sentence. */
  var KEPT_GOING = [
    /\b(?:kept|continued)\s+([a-z]+ing)\b/gi,
    /\bcontinued\s+to\s+([a-z]+)\b/gi,
  ];
  var PROBLEM = ("cry sob wail whine whimper fuss scream shriek squeal yell shout " +
    "curse swear protest refuse tantrum vocalize hit kick bite scratch pinch " +
    "spit slap punch push grab swipe elbow headbutt aggress throw destroy " +
    "elope bang headbang flop injure mouth lick smear flap script stim growl " +
    "aggression elopement disrupt noncompliance sib")
    .split(" ");
  var PROBLEM_STEMS = PROBLEM.map(stem);
  /* Words that name a target behavior in the notes. A word in the same
     sentence counts as named. */
  var TARGET = /\b(?:target(?:ed)?\s+behaviou?rs?|behaviou?rs?\s+of\s+concern|problem\s+behaviou?rs?|challenging\s+behaviou?rs?|maladaptive|bocs?|reduction\s+goals?)\b/i;

  /* Words that sit in the behavior slot and are not a behavior. The second
     line is the late hold's: "The data did not resolve whether ...", "The FA
     failed to resolve which ...". The behavior gate below already keeps them
     out; naming them here keeps a target sentence that holds them from
     letting one in. */
  var NOT_A_BEHAVIOR = /^(?:the|a|an|it|this|that|they|he|she|client|child|learner|bcba|bt|rbt|staff|technician|therapist|session|trials?|going|doing|working|playing|engaging|participating|attending|data|fa|fba|function|assessment|analysis|question|hypothesis|pattern|results?|conditions?|issue|concern|problem|conflict|disagreement|team|plan|intervention|reinforcement|attention|prompting|prompts?|demands?|behaviou?rs?|targets?|targeted|stimulus|stimuli)$/i;

  // A claim that a behavior stopped. "no longer" is one with no verb in it.
  var STOPPED = /\b(?:stopped|stops|stop|ceased|ceases|cease|resolved|resolves|resolve|subsided|subsides|subside|ended|extinguished|terminated)\b|\bno\s+longer\b/gi;
  // "n't" carries no word boundary in front of it ("didn't"), so it is not
  // anchored the way the whole words are.
  /* Six words back, so "did not appear to have stopped" (Pollux, finding 2)
     and "were not at any point observed to have stopped" (the late hold)
     read as negated. "unlikely" negates the same way. */
  var NEGATED = /(?:\bnot|\bnever|\bwithout|\bunlikely|\bfailed\s+to|n't)\s+(?:\w+\s+){0,6}$/i;
  /* A clause that says the behavior went on is not a stop claim, whatever
     else stopped in it: "Crying continued after the BT told him to stop" is
     about the BT (Pollux, finding 2). */
  var CONTINUING = /\b(?:continu(?:e|ed|es|ing)|kept|keeps|persist(?:ed|s|ing)?|remain(?:ed|s|ing)?|still|did\s+not|didn't|does\s+not|doesn't)\b/i;
  /* A clause whose subject is left out or is a pronoun ("..., but stopped
     within a minute") is about the clause before it. */
  var SUBJECTLESS = /^(?:(?:it|they|he|she|this|then|eventually|later|finally|soon|quickly|did|had|has|was|were)\s+){0,3}(?:stopped|stop|ceased|cease|resolved|resolve|subsided|subside|ended|end)\b/i;

  /* After the stop verb, the behavior counts only as its object: "stopped
     crying", "stopped his crying", "no longer cried". "The interval ended
     with vocalizations occurring" is the interval ending (the late hold). */
  var DETERMINER = /^(?:his|her|their|the|all)$/;
  var NO_LONGER_REACH = 3;
  // A problem behavior's stem matches a longer word from this length on:
  // "elop" reads "elopement", "aggress" reads "aggression".
  var PREFIX_MIN = 4;

  /* The FA conditions a sentence names. A behavior the notes say did not stop
     in attention is not flagged where a sentence says it stopped in escape
     (the late hold, finding 2). */
  var CONDITION = /\b(attention|escape|demands?|tangibles?|play|alone|ignore|control)\b/gi;

  // Sentences, for the conditions a clause sits in.
  var SENTENCE = /[.;!?\n]+/;

  /* Clauses, so "Crying stopped and the vocalizations continued" is two
     claims about two behaviors rather than one sentence holding both words. */
  var CLAUSE = /[.;:!?,\n]+|\s+(?:and|but|or|while|whereas|although|though|until)\s+/i;

  /* "did not resolve" as an intransitive verb, with the word before it
     captured as its subject. What may follow is a closed list, because
     anything else can change what the sentence says (Pollux, finding 1):
       an object        "Attention did not resolve crying."
       a partial claim  "did not resolve completely / fully / entirely / partly"
       an agent         "was not resolved by the team"
       a timing         "did not resolve immediately / within 2 minutes"
       a cause          "did not resolve on its own / with redirection"
     So only the end of a clause, or a word that keeps "continued" true. */
  /* "failed to resolve" and a passive "was not resolved" are not here (the
     late hold, finding 1): "failed to resolve to prompting" and "was not
     resolved by planned ignoring" say something "continued" does not, and a
     miss costs nothing. Whether, which, what, how, if, to, into and by are
     not on the list after it, so each blocks the rewrite. */
  var RECAST = /\b([a-z][a-z'-]*)\s+((?:did\s+not|didn't)\s+resolve|remained\s+unresolved)(?=\s*(?:$|[.,;:!?)\n])|\s+(?:until|when|whenever|while|once|after|following|during|across|throughout|despite|for|and|but|or|although|though|even|because)\b)/gi;
  var OPEN_QUESTION = /\b(?:continu\w*|persist\w*|whether)\b/i;
  var RECAST_NOTE = 'Changed "did not resolve" to "continued" to match the notes.';

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

  function clauses(s) {
    return text(s).split(CLAUSE).map(function (c) { return c.trim(); }).filter(Boolean);
  }

  function sentences(s) {
    return text(s).split(SENTENCE).map(function (c) { return c.trim(); }).filter(Boolean);
  }

  function words(clause) {
    return clause.toLowerCase().match(/[a-z][a-z'-]*/g) || [];
  }

  // The conditions a passage names, singular: "demands" is "demand".
  function conditionsIn(s) {
    var out = [];
    var re = new RegExp(CONDITION.source, "gi");
    var m;
    while ((m = re.exec(text(s)))) {
      var c = m[1].toLowerCase().replace(/s$/, "");
      if (out.indexOf(c) === -1) out.push(c);
    }
    return out;
  }

  function overlaps(a, b) {
    return a.some(function (x) { return b.indexOf(x) !== -1; });
  }

  /* True when the clause says something stopped, the verb is not negated,
     and nothing in the clause says it went on. Read on the notes, where a
     wider reading of "stopped" only means fewer behaviors are checked. */
  function saysStopped(clause) {
    if (CONTINUING.test(clause)) return false;
    var re = new RegExp(STOPPED.source, "gi");
    var m;
    while ((m = re.exec(clause))) {
      if (!NEGATED.test(clause.slice(0, m.index))) return true;
    }
    return false;
  }

  // "stopped crying", "stopped his crying": the one word the verb takes.
  function objectOf(ws) {
    var i = DETERMINER.test(ws[0] || "") ? 1 : 0;
    return ws.slice(i, i + 1);
  }

  /* The stems, out of the ones given, that a clause says stopped: as the
     subject before the verb, or as its object right after. Read on the
     draft and the expert, where a wider reading would be a false flag. */
  function stoppedSubjects(clause, stems) {
    if (CONTINUING.test(clause)) return [];
    var re = new RegExp(STOPPED.source, "gi");
    var out = [];
    var m;
    while ((m = re.exec(clause))) {
      if (NEGATED.test(clause.slice(0, m.index))) continue;
      var rest = words(clause.slice(m.index + m[0].length));
      var after = /^no\s/i.test(m[0]) ? rest.slice(0, NO_LONGER_REACH) : objectOf(rest);
      words(clause.slice(0, m.index)).concat(after).map(stem).forEach(function (s) {
        if (stems.indexOf(s) !== -1 && out.indexOf(s) === -1) out.push(s);
      });
    }
    return out;
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
    text(intake).split(/[.;!?\n]+/).forEach(function (s) {
      if (TARGET.test(s)) out = out.concat(words(s).map(stem));
    });
    return out;
  }

  /* A behavior, not a subject that only sits where one could (the late hold,
     finding 1): a problem behavior below, by stem or by a longer word on the
     same stem, or a word the notes name as a target. */
  function isBehavior(word, named) {
    var s = stem(word);
    if (named.indexOf(s) !== -1) return true;
    return PROBLEM_STEMS.some(function (p) {
      return s === p || (p.length >= PREFIX_MIN && s.indexOf(p) === 0);
    });
  }

  /* Every clause of the notes, with the sentence it sits in, so a clause can
     reach back for its subject without crossing into another sentence. */
  function clauseList(intake) {
    var out = [];
    sentences(intake).forEach(function (sent, n) {
      clauses(sent).forEach(function (c) { out.push({ text: c, sentence: n }); });
    });
    return out;
  }

  /* A clause with no subject of its own ("but stopped in escape", "but did
     stop", "they stopped") is about the nearest clause before it in the same
     sentence that names one of the behaviors, else the clause just before. */
  function subjectBefore(cs, i, stems) {
    for (var j = i - 1; j >= 0 && cs[j].sentence === cs[i].sentence; j--) {
      if (words(cs[j].text).map(stem).some(function (s) { return stems.indexOf(s) !== -1; })) return cs[j].text;
    }
    return i > 0 ? cs[i - 1].text : "";
  }

  /* The conditions one statement about a behavior sits in: its clause, else
     its sentence, else its line. None found is null, which means any. */
  function conditionsFor(clause, sentence, line) {
    var found = [conditionsIn(clause), conditionsIn(sentence), conditionsIn(line)]
      .filter(function (c) { return c.length; });
    return found.length ? found[0] : null;
  }

  /* The behaviors the notes say did not stop, each with the conditions it
     was said of, minus any the notes also say stopped. Lower case, as typed. */
  function unresolved(intake) {
    var named = targets(intake);
    var said = [];
    text(intake).split(/\n+/).forEach(function (line) {
      sentences(line).forEach(function (sent) {
        clauses(sent).forEach(function (c) {
          captured(c, NOT_STOPPED).concat(captured(c, KEPT_GOING)).forEach(function (w) {
            if (!isBehavior(w, named)) return;
            var conds = conditionsFor(c, sent, line);
            var prior = said.filter(function (e) { return e.word === w; })[0];
            if (!prior) {
              said = said.concat([{ word: w, conds: conds }]);
              return;
            }
            // Said of no condition once is said of all of them.
            var merged = prior.conds && conds
              ? prior.conds.concat(conds.filter(function (x) { return prior.conds.indexOf(x) === -1; }))
              : null;
            said = said.map(function (e) { return e.word === w ? { word: w, conds: merged } : e; });
          });
        });
      });
    });
    if (!said.length) return [];
    /* "Vocalizations did not stop in attention but stopped in escape." The
       second clause takes the subject of the first, and the behavior counts
       as both stopped and not, so it is left alone (Pollux, finding 2, and
       the late hold, finding 2). */
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

  /* The behaviors a passage says stopped, out of the ones given (each a word,
     or { word, conds } from unresolved). A sentence that names a condition
     the behavior was never said of is about that other condition, and is
     not counted. */
  function stoppedIn(passage, said) {
    var entries = said.map(function (e) { return typeof e === "string" ? { word: e, conds: null } : e; });
    var stems = entries.map(function (e) { return stem(e.word); });
    var found = [];
    sentences(passage).forEach(function (sent) {
      var here = conditionsIn(sent);
      clauses(sent).forEach(function (c) {
        stoppedSubjects(c, stems).forEach(function (s) {
          var e = entries[stems.indexOf(s)];
          if (e.conds && here.length && !overlaps(e.conds, here)) return;
          if (found.indexOf(e.word) === -1) found.push(e.word);
        });
      });
    });
    return found;
  }

  /* "did not resolve" -> "continued", only where its subject is one of the
     behaviors given (behaviors(intake)). With none given, nothing moves. */
  function recast(s, said) {
    var stems = (Array.isArray(said) ? said : []).map(stem);
    var n = 0;
    var out = text(s).replace(RECAST, function (all, subject) {
      if (stems.indexOf(stem(subject)) === -1) return all;
      n += 1;
      return subject + " continued";
    });
    return { text: out, n: n };
  }

  /* Recast every named narrative against the behaviors the intake says did
     not resolve. Returns the note with a count, the shape NoteHollow.passNote
     returns, and the sections it changed, so finalize can say so on each. */
  function passNote(output, ids, intake) {
    if (!output || typeof output !== "object") return { output: output, recast: 0, sections: [] };
    var said = behaviors(intake);
    var out = {};
    for (var k in output) if (Object.prototype.hasOwnProperty.call(output, k)) out[k] = output[k];
    var total = 0;
    var sections = [];
    (ids || []).forEach(function (id) {
      if (typeof out[id] !== "string") return;
      var r = recast(out[id], said);
      out[id] = r.text;
      total += r.n;
      if (r.n) sections.push(id);
    });
    return { output: out, recast: total, sections: sections };
  }

  /* The clinician is told when a sentence was recast, on the section it was
     recast in, rather than only the audit counting it (Pollux, finding 1).
     A grey "register" note under the code "other", which every tool's
     catalog has and which shows the detail as written. */
  function recastHints(output, intake, ids) {
    if (!output || typeof output !== "object") return [];
    return passNote(output, ids, intake).sections.map(function (id) {
      return { section: id, code: "other", kind: "register", rank: 0, detail: RECAST_NOTE };
    });
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
        detail: ("Notes say the " + hit[0] + " did not stop; this says it did. Say it continued.").slice(0, 120),
      });
    });
    return out;
  }

  /* The expert's result without the findings that assume a behavior stopped
     when the notes say it did not, and a count of what went. The quote is
     the clinician's own words and is not read; the ask, its reason and the
     replacement sentence are. */
  function dropExpert(found, intake) {
    if (!found || typeof found !== "object") return found;
    var said = unresolved(intake);
    var out = {};
    for (var k in found) if (Object.prototype.hasOwnProperty.call(found, k)) out[k] = found[k];
    if (!said.length) {
      out.unresolvedDropped = 0;
      return out;
    }
    var wrong = function (s) { return stoppedIn(s, said).length > 0; };
    /* An ask that offers "continue" or "whether" as the other answer is the
       right question, not an assumption: "Did the crying stop or continue by
       the end?" (Pollux, finding 3). It stays. */
    var asksWhich = function (h) { return OPEN_QUESTION.test(text(h.ask)); };
    var hintsIn = Array.isArray(found.hints) ? found.hints : [];
    var registerIn = Array.isArray(found.register) ? found.register : [];
    var keptHints = hintsIn.filter(function (h) { return !(h && !asksWhich(h) && wrong(text(h.ask) + ". " + text(h.why))); });
    var keptRegister = registerIn.filter(function (r) { return !(r && wrong(text(r.move))); });
    if (Array.isArray(found.hints)) out.hints = keptHints;
    if (Array.isArray(found.register)) out.register = keptRegister;
    out.unresolvedDropped = (hintsIn.length - keptHints.length) + (registerIn.length - keptRegister.length);
    return out;
  }

  window.NoteUnresolved = {
    behaviors: behaviors,
    recast: recast,
    passNote: passNote,
    recastHints: recastHints,
    hints: hints,
    dropExpert: dropExpert,
  };
})();
