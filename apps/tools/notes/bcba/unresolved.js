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
    "elope bang headbang flop injure mouth lick smear flap script stim growl")
    .split(" ");
  /* Words that name a target behavior in the notes. A word in the same
     sentence counts as named. */
  var TARGET = /\b(?:target(?:ed)?\s+behaviou?rs?|behaviou?rs?\s+of\s+concern|problem\s+behaviou?rs?|challenging\s+behaviou?rs?|maladaptive|bocs?|reduction\s+goals?)\b/i;

  // Words that sit in the behavior slot and are not a behavior.
  var NOT_A_BEHAVIOR = /^(?:the|a|an|it|this|that|they|he|she|client|child|learner|bcba|bt|rbt|staff|technician|therapist|session|trials?|going|doing|working|playing|engaging|participating|attending)$/i;

  // A claim that a behavior stopped. "no longer" is one with no verb in it.
  var STOPPED = /\b(?:stopped|stops|stop|ceased|ceases|cease|resolved|resolves|resolve|subsided|subsides|subside|ended|extinguished|terminated)\b|\bno\s+longer\b/gi;
  // "n't" carries no word boundary in front of it ("didn't"), so it is not
  // anchored the way the whole words are.
  /* Four words back, so "did not appear to have stopped" reads as negated
     (Pollux, finding 2). */
  var NEGATED = /(?:\bnot|\bnever|\bwithout|\bfailed\s+to|n't)\s+(?:\w+\s+){0,4}$/i;
  /* A clause that says the behavior went on is not a stop claim, whatever
     else stopped in it: "Crying continued after the BT told him to stop" is
     about the BT (Pollux, finding 2). */
  var CONTINUING = /\b(?:continu(?:e|ed|es|ing)|kept|keeps|persist(?:ed|s|ing)?|remain(?:ed|s|ing)?|still|did\s+not|didn't|does\s+not|doesn't)\b/i;
  /* A clause whose subject is left out or is a pronoun ("..., but stopped
     within a minute") is about the clause before it. */
  var SUBJECTLESS = /^(?:(?:it|they|he|she|this|then|eventually|later|finally|soon|quickly)\s+){0,2}(?:stopped|ceased|resolved|subsided|ended)\b/i;

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
  var RECAST = /\b([a-z][a-z'-]*)\s+((?:did\s+not|didn't|failed\s+to)\s+resolve|(?:was|were)\s+not\s+resolved|remained\s+unresolved)(?=\s*(?:$|[.,;:!?)\n])|\s+(?:until|when|whenever|while|once|after|following|during|across|throughout|despite|in|for|and|but|or|so|although|though|even|as|because|since)\b)/gi;
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

  function words(clause) {
    return clause.toLowerCase().match(/[a-z][a-z'-]*/g) || [];
  }

  /* True when the clause says something stopped, the verb is not negated,
     and nothing in the clause says it went on. */
  function saysStopped(clause) {
    if (CONTINUING.test(clause)) return false;
    var re = new RegExp(STOPPED.source, "gi");
    var m;
    while ((m = re.exec(clause))) {
      if (!NEGATED.test(clause.slice(0, m.index))) return true;
    }
    return false;
  }

  function mentions(clause, stems) {
    var ws = words(clause).map(stem);
    return stems.filter(function (s) { return ws.indexOf(s) !== -1; });
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

  /* The behaviors the notes say did not stop, as typed (lower case), minus
     any the notes also say stopped. */
  function behaviors(intake) {
    var cs = clauses(intake);
    var problem = PROBLEM.map(stem).concat(targets(intake));
    var said = [];
    cs.forEach(function (c) {
      var kept = captured(c, KEPT_GOING).filter(function (w) { return problem.indexOf(stem(w)) !== -1; });
      captured(c, NOT_STOPPED).concat(kept).forEach(function (w) {
        if (said.indexOf(w) === -1) said.push(w);
      });
    });
    if (!said.length) return [];
    /* "Crying did not stop during demands, but stopped within a minute of the
       break." The second clause has no subject, so it takes the one before
       it, and crying counts as both stopped and not (Pollux, finding 2). */
    var stopped = [];
    cs.forEach(function (c, i) {
      if (!saysStopped(c)) return;
      var ws = SUBJECTLESS.test(c) && i > 0 ? words(cs[i - 1]).concat(words(c)) : words(c);
      stopped = stopped.concat(ws.map(stem));
    });
    return said.filter(function (w) { return stopped.indexOf(stem(w)) === -1; });
  }

  // The behaviors a passage says stopped, out of the ones given.
  function stoppedIn(passage, said) {
    var stems = said.map(stem);
    var found = [];
    clauses(passage).forEach(function (c) {
      if (!saysStopped(c)) return;
      mentions(c, stems).forEach(function (s) {
        var w = said[stems.indexOf(s)];
        if (found.indexOf(w) === -1) found.push(w);
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
    var said = behaviors(intake);
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
    var said = behaviors(intake);
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
