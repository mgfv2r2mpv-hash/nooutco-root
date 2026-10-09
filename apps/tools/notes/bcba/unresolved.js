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
 *               phrase, and nothing else in the sentence moves.
 *   hints       a clause that says a behavior stopped, when the notes say that
 *               behavior did not, is an amber hint on its section. The sentence
 *               is not rewritten: which condition it describes is a finding,
 *               and a regular expression does not get to decide a finding.
 *   dropExpert  an expert ask or replacement sentence that assumes the
 *               behavior stopped is dropped before the panel reads it.
 *
 * WHAT IT CANNOT SEE. A pronoun ("and they stopped"), a behavior the notes
 * name only by a word with a different stem ("eloped" against "elopement"),
 * and a behavior the notes say both stopped and did not (two conditions, and
 * no way here to tell which sentence is about which). Each of those is left
 * alone rather than guessed at.
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
    /\b(?:kept|continued)\s+([a-z]+ing)\b/gi,
    /\bcontinued\s+to\s+([a-z]+)\b/gi,
    /\b([a-z][a-z'-]*)\s+persisted\b/gi,
  ];

  // Words that sit in the behavior slot and are not a behavior.
  var NOT_A_BEHAVIOR = /^(?:the|a|an|it|this|that|they|he|she|client|child|learner|bcba|bt|rbt|staff|technician|therapist|session|trials?|going|doing|working|playing|engaging|participating|attending)$/i;

  // A claim that a behavior stopped. "no longer" is one with no verb in it.
  var STOPPED = /\b(?:stopped|stops|stop|ceased|ceases|cease|resolved|resolves|resolve|subsided|subsides|subside|ended|extinguished|terminated)\b|\bno\s+longer\b/gi;
  // "n't" carries no word boundary in front of it ("didn't"), so it is not
  // anchored the way the whole words are.
  var NEGATED = /(?:\bnot|\bnever|\bwithout|\bfailed\s+to|n't)\s+(?:\w+\s+){0,2}$/i;

  /* Clauses, so "Crying stopped and the vocalizations continued" is two
     claims about two behaviors rather than one sentence holding both words. */
  var CLAUSE = /[.;:!?,\n]+|\s+(?:and|but|or|while|whereas|although|though|until)\s+/i;

  /* "did not resolve" as an intransitive verb. Followed by an object it
     means something else ("attention did not resolve the crying"), and
     "fully" or "completely" makes it a partial claim; both are left alone. */
  var RECAST = /\b(?:did\s+not|didn't|failed\s+to)\s+resolve\b(?!\s+(?:the|a|an|it|this|that|these|those|his|her|their|them|its)\b)|\b(?:was|were)\s+not\s+resolved\b|\bremained\s+unresolved\b/gi;

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

  // True when the clause says something stopped, and the verb is not negated.
  function saysStopped(clause) {
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

  /* The behaviors the notes say did not stop, as typed (lower case), minus
     any the notes also say stopped. */
  function behaviors(intake) {
    var said = [];
    clauses(intake).forEach(function (c) {
      NOT_STOPPED.forEach(function (re) {
        var r = new RegExp(re.source, "gi");
        var m;
        while ((m = r.exec(c))) {
          var w = m[1].toLowerCase();
          if (!NOT_A_BEHAVIOR.test(w) && said.indexOf(w) === -1) said.push(w);
        }
      });
    });
    if (!said.length) return [];
    var stopped = [];
    clauses(intake).forEach(function (c) {
      if (saysStopped(c)) stopped = stopped.concat(words(c).map(stem));
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

  function recast(s) {
    var n = 0;
    var out = text(s).replace(RECAST, function () { n += 1; return "continued"; });
    return { text: out, n: n };
  }

  /* Recast every named narrative. Returns the note with a count, the shape
     NoteHollow.passNote returns, so finalize can read both the same way. */
  function passNote(output, ids) {
    if (!output || typeof output !== "object") return { output: output, recast: 0 };
    var out = {};
    for (var k in output) if (Object.prototype.hasOwnProperty.call(output, k)) out[k] = output[k];
    var total = 0;
    (ids || []).forEach(function (id) {
      if (typeof out[id] !== "string") return;
      var r = recast(out[id]);
      out[id] = r.text;
      total += r.n;
    });
    return { output: out, recast: total };
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
    var hintsIn = Array.isArray(found.hints) ? found.hints : [];
    var registerIn = Array.isArray(found.register) ? found.register : [];
    var keptHints = hintsIn.filter(function (h) { return !(h && wrong(text(h.ask) + ". " + text(h.why))); });
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
    hints: hints,
    dropExpert: dropExpert,
  };
})();
