/* Two faults the prompt has asked about and cannot guarantee, enforced after
 * the model returns.
 *
 * absence.js is the pattern, and its discipline is the part worth copying: act
 * only where being wrong costs nothing, count everything else, and never delete
 * a clinical fact to win a style point. NEITHER RULE HERE CUTS ANYTHING.
 *
 * THE ATTACHED ZERO IS A RECAST. His mark on a shipped antecedent narrative:
 * "'without exhibiting' dodges a clean zero into a participial. A zero is an
 * observation and gets stated as one." So
 *
 *   The client completed programming without exhibiting behaviors of concern.
 *
 * becomes
 *
 *   The client completed programming. No behaviors of concern occurred.
 *
 * Nothing is lost and nothing is added. The finding moves out of a modifier and
 * into a sentence of its own, which is the entire complaint.
 *
 * It fires only on a participial that runs to the END of its sentence. "...
 * without exhibiting aggression, and transitioned smoothly" has a clause after
 * it, and splitting there would leave the second half with no subject.
 *
 * THE CONTENTLESS SENTENCE IS A FLAG. "These strategies supported the client's
 * participation across the session" has a category for a subject, a banned
 * vague verb, and no observable anywhere in it. That is B1's case and it is the
 * one these notes carry most often. It is counted rather than cut, because a
 * sentence that looks empty to a regular expression is sometimes the one
 * sentence carrying the technician's own summary, and the cost of being wrong
 * is a deleted clinical fact against a saved style point.
 *
 * FAILS OPEN, twice over. It reuses absence.js's sentence splitter rather than
 * carrying a second copy that could drift from it, so with absence.js missing
 * this returns the note untouched and its counts as zero. A note with neither
 * pass is worth more than no note.
 */
(function () {
  "use strict";

  /* The four verbs that actually appear in this slot in these notes. A wider
     "without <any gerund>" would catch "without prompting", which is a prompt
     level and a clinical fact rather than a dodged zero.

     NO COMMA INSIDE WHAT IS BEING MOVED, which is what keeps the split honest.
     "transitioned without exhibiting aggression, and then sat down" ends in a
     clause of its own, and a rule that swallowed it would emit "No aggression,
     and then sat down occurred." It costs the compound case, "without
     exhibiting aggression, elopement or refusal", and that is the right way to
     be wrong: a zero left in a modifier is the sentence he already sees, and a
     mangled one is a sentence nobody wrote. */
  var ATTACHED_ZERO = new RegExp(
    ",?\\s+without\\s+(?:exhibiting|displaying|demonstrating|engaging\\s+in)\\s+([^.!?;:,]+?)\\s*$",
    "i"
  );

  // "any" and "any of the" are quantifiers on a zero, and "No any behaviors"
  // is not a sentence.
  var LEADING_QUANTIFIER = /^any\s+(?:of\s+the\s+)?/i;

  /* A subject that names a category rather than a person. The optional two
     words in the middle are the adjectives a note puts there: "these
     antecedent strategies", "the teaching procedures". */
  var CATEGORY_SUBJECT = new RegExp(
    "^(?:these|those|this|the)\\s+(?:[a-z]+\\s+){0,2}" +
    "(?:strateg(?:y|ies)|intervention|interventions|approach|approaches|technique|techniques|" +
    "modification|modifications|procedure|procedures|session|program|programming|support|supports)\\b",
    "i"
  );

  // The vague support verbs the register rules already ban, in every form.
  var VAGUE_VERB = new RegExp(
    "\\b(?:support(?:s|ed|ing)?|facilitat(?:e|es|ed|ing)|promot(?:e|es|ed|ing)|" +
    "enhanc(?:e|es|ed|ing)|address(?:es|ed|ing)?|assist(?:s|ed|ing)?|help(?:s|ed|ing)?)\\b",
    "i"
  );

  /* Anything that makes the sentence report something. A number, a thing the
     client did, or a unit of measurement. This is the half that keeps a real
     sentence out of the net, so it is deliberately generous: a false negative
     here costs a count, and a false positive costs a technician a flag on a
     sentence that was fine. */
  var OBSERVABLE = new RegExp(
    "\\d|\\b(?:said|says|asked|requested|manded|tacted|labeled|labelled|imitated|reached|pointed|" +
    "handed|gave|walked|sat|stood|moved|threw|hit|kicked|bit|screamed|cried|eloped|left|returned|" +
    "completed|finished|responded|complied|initiated|transitioned|waited|tolerated|independently|" +
    "prompt|prompts|prompted|prompting|trial|trials|opportunit(?:y|ies)|minute|minutes|second|seconds)\\b",
    "i"
  );

  function split(text) {
    if (!window.NoteAbsence || typeof window.NoteAbsence.sentences !== "function") return null;
    return window.NoteAbsence.sentences(text);
  }

  /* The recast, or null when the sentence is not one. Returns the replacement
     text INCLUDING whatever trailing whitespace the original carried, so a
     rebuilt narrative reads exactly as it did with the one clause moved. */
  function recastZero(sentence) {
    var raw = String(sentence || "");
    var trail = (raw.match(/\s*$/) || [""])[0];
    var s = raw.slice(0, raw.length - trail.length);
    // The terminator has to come off before the participial can be at the end.
    var end = (s.match(/[.!?]+["')\]]*$/) || [""])[0];
    var body = s.slice(0, s.length - end.length);
    var m = body.match(ATTACHED_ZERO);
    if (!m) return null;

    var head = body.slice(0, m.index).replace(/[\s,]+$/, "");
    // A head that is not a sentence on its own has nothing to be split from.
    if (!/\s/.test(head)) return null;

    var what = m[1].replace(LEADING_QUANTIFIER, "").trim();
    if (!what) return null;

    return head + ". No " + what + " occurred." + trail;
  }

  function isHollow(sentence) {
    var s = String(sentence || "").trim().replace(/^[^A-Za-z]+/, "");
    if (!s) return false;
    if (!CATEGORY_SUBJECT.test(s)) return false;
    if (!VAGUE_VERB.test(s)) return false;
    return !OBSERVABLE.test(s);
  }

  /* Returns { text, recast, hollow }. The two numbers are COUNTS and never the
     sentences: this result is audited, and a clinical sentence must not travel
     to the audit endpoint because a rule fired on it. */
  function pass(text) {
    var parts = split(text);
    if (!parts) return { text: String(text || ""), recast: 0, hollow: 0 };
    var recast = 0;
    var hollow = 0;
    var out = parts.map(function (s) {
      var moved = recastZero(s);
      if (moved !== null) { recast++; s = moved; }
      if (isHollow(s)) hollow++;
      return s;
    });
    return { text: out.join(""), recast: recast, hollow: hollow };
  }

  /* Every string value in a drafted note. Arrays are checkbox values and are
     left alone, for the same reason absence.js leaves them alone: an option
     label is not prose.

     `keys` NARROWS IT TO THE PROSE, and the caller should pass it. absence.js
     can afford to read every string because it only ever cuts a whole sentence
     and its test needs a record noun, which no option label has. This pass
     REWRITES text, and a single-select's value is matched against a verbatim
     label - a recast that touched one would blank the control rather than
     showing a changed sentence. Without `keys` it reads every string, which is
     what makes it testable on its own. */
  function passNote(output, keys) {
    var o = output && typeof output === "object" ? output : {};
    var only = Array.isArray(keys) ? keys : null;
    var out = {};
    var recast = 0;
    var hollow = 0;
    Object.keys(o).forEach(function (k) {
      if (typeof o[k] !== "string" || (only && only.indexOf(k) === -1)) { out[k] = o[k]; return; }
      var r = pass(o[k]);
      out[k] = r.text;
      recast += r.recast;
      hollow += r.hollow;
    });
    return { output: out, recast: recast, hollow: hollow };
  }

  /* ── B9: a strategy narrated in the section that does not own it ──────────
     The one item on his bar that is checkable rather than judged, because the
     tool publishes both lists.

     WHICH LIST A PROCEDURE BELONGS ON IS NOT DECIDED HERE, and the DRO case is
     why that matters: he ruled it a consequence procedure, this check shipped on
     that reading, and on 2026-09-02 he reversed it to an antecedent one. Nothing
     in this file changed. Read tools/<tool>.js for the current filing rather
     than trusting a clinical claim written down in the mechanism.

     ONLY IN THE WRONG SECTION, which is his exception verbatim: "A strategy
     that genuinely ran in both roles in one session is narrated in both, and
     that is not an error." So a term found in its own section is never
     reported, whatever else it also appears in.

     A TERM, NOT A LABEL. "Allowed break" is a checkbox label and no narrative
     contains it, because the narrative says "gave him a break". Each strategy
     the tool wants checked therefore carries the phrase a note actually uses,
     and the strategies whose only phrase is ordinary English carry none. The
     tool decides which those are; this only reads what it was handed.

     Returns raw hints in the model's own shape, so they go through the tool's
     normalizeHints with everything else rather than around it. `detail` names
     a canonical strategy label and never a word the technician wrote. */
  function misplaced(output, ownership) {
    var o = output && typeof output === "object" ? output : {};
    var own = ownership && ownership.sections;
    if (!own || !ownership.code) return [];
    var keys = Object.keys(own);
    var out = [];
    keys.forEach(function (home) {
      var elsewhere = keys.filter(function (k) { return k !== home; });
      (own[home].strategies || []).forEach(function (s) {
        if (!s || !s.term || s.term.test(String(o[home] || ""))) return;
        elsewhere.forEach(function (away) {
          if (!s.term.test(String(o[away] || ""))) return;
          out.push({
            section: away,
            code: ownership.code,
            kind: "blocks-claim",
            /* FIRST, not last. rank carries the model's own ordering and an
               unranked hint sinks below every ranked one, which is right for a
               model declining to order and wrong for this: every other hint on
               the list is a judgement and this one is a match against the
               tool's own two lists. It is the hint most likely to be true. */
            rank: 0,
            detail: s.label + " belongs with the " + own[home].label + " strategies.",
          });
        });
      });
    });
    return out;
  }

  window.NoteHollow = {
    recastZero: recastZero,
    isHollow: isHollow,
    pass: pass,
    passNote: passNote,
    misplaced: misplaced,
  };
})();
