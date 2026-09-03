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
            /* AMBER, NOT RED, and that is his call of 2026-09-02 on a live note:
               "if the expert moved something it can put an amber/yellow bubble,
               red is aggressive. The information is present and can be moved so
               it isn't a catastrophe."

               Red is reserved for what a funder could refuse the claim over,
               which is what the legend above the note promises it means. A
               strategy sitting under the wrong heading is a whole sentence of
               real clinical content in the wrong place, and moving it costs the
               technician one drag. It still ranks first; see below. */
            kind: "thin",
            /* FIRST, not last. rank carries the model's own ordering and an
               unranked hint sinks below every ranked one, which is right for a
               model declining to order and wrong for this: every other hint on
               the list is a judgement and this one is a match against the
               tool's own two lists. It is the hint most likely to be true. */
            rank: 0,
            detail: s.label + " belongs with the " + own[home].label + " strategies.",
            /* CARRIED FOR THE PRE-DRAFT CALLER, and dropped on the post-draft
               one. normalizeHints rebuilds every hint from five named keys, so
               these two ride along to misplacedInput below and never reach the
               panel as a hint. A second copy of the search, written to return a
               richer shape, is a second copy that drifts. */
            home: home,
            label: s.label,
          });
        });
      });
    });
    return out;
  }

  /* ── An antecedent strategy named with nothing said about what it did ─────
     His "critical, first priority", and the second hint this file injects
     rather than asks the model for. The prompt already tells the model to raise
     antecedent_effect_unstated when a strategy is named without its effect. On
     a live note it did not, so the tool stops depending on that judgement for
     something its own published table can check.

     THE SUPPRESSOR IS DELIBERATELY GENEROUS, and that asymmetry is the whole
     design. A hint on a note that DID state its effect is worse than missing
     one that did not, because it teaches a technician to distrust the panel;
     misplaced() carries the same reasoning for its unmatched strategies. So any
     effect language anywhere in the section silences this, and a stated failure
     silences it exactly as a stated success does. Telling someone who honestly
     documented "it did not help" that they documented nothing would be the
     worst version of this check.

     A TERM, NOT A LABEL, inherited from the same table misplaced reads. The
     three strategies whose only phrase is ordinary English carry no term and so
     are never counted here either: a check that fired on the word "break"
     would fire on most notes.

     ONE HINT PER SECTION rather than one per strategy, because the hint ceiling
     is shared with everything the model found and three strategies in one
     section is a common note, not an unusual one. `detail` names a canonical
     label and never a word the technician wrote. */
  var EFFECT_STATED = new RegExp(
    "\\b(?:" +
    // Said in so many words.
    "work(?:s|ed|ing)?|help(?:s|ed|ful|ing)?|effective(?:ly)?|ineffective|" +
    "success(?:ful|fully)?|unsuccessful|" +
    // Said as a direction of change.
    "reduc\\w*|decreas\\w*|increas\\w*|prevent\\w*|avoid\\w*|eliminat\\w*|" +
    "minimi[sz]\\w*|improv\\w*|" +
    // Said as what the client then did. A refusal is an effect.
    "de-?escalat\\w*|escalat\\w*|calm\\w*|settl\\w*|compli\\w*|refus\\w*|" +
    "accept\\w*|declin\\w*|engag\\w*|disengag\\w*|transition\\w*|resist\\w*|" +
    "tolerat\\w*|protest\\w*|continu\\w*|stopped|stopping|ceas\\w*|persist\\w*|" +
    "remain\\w*" +
    ")\\b|" +
    // Said as a link between the strategy and what followed.
    "\\b(?:in response|as a result|resulting in|which led to|after which|" +
    "no effect|little effect|without incident)\\b",
    "i",
  );

  /* THE SECOND SUPPRESSOR, AND THE ONE THAT MAKES THIS SAFE. An effect
     vocabulary alone was not enough, and the repo's own tests are what proved
     it: "A DRO ran on a two minute interval and the client earned the
     reinforcer at each one" and "A visual schedule was posted at the table and
     the client checked it between tasks" both state an effect plainly, and
     neither uses a word any reasonable list would hold. Chasing that list is
     unwinnable, because the effect of an antecedent strategy is whatever the
     client then did, and that is the open set of everything a person can do.

     So the rule is structural instead of lexical. An antecedent narrative that
     never mentions the client at all has not said what the strategy did to
     them; the moment it does, this goes quiet and leaves the judgement to the
     model, which is the half of the job a model is actually better at. That
     makes the check narrow on purpose: it fires on the shape of the live note
     that started this, a strategy and nothing else, and stays silent on
     anything with a person in it. Missing a real gap is the acceptable way for
     this to be wrong. */
  var SUBJECT_PRESENT = new RegExp(
    "\\b(?:client|patient|student|learner|child|kid|he|him|his|she|her|hers|they|them|their)\\b",
    "i",
  );

  function effectUnstated(output, ownership) {
    var o = output && typeof output === "object" ? output : {};
    var own = ownership && ownership.sections;
    if (!own) return [];
    var already = Array.isArray(o.hints) ? o.hints : [];
    var out = [];
    Object.keys(own).forEach(function (section) {
      var code = own[section].effectCode;
      if (!code) return;
      var text = String(o[section] || "");
      if (!text.trim() || EFFECT_STATED.test(text) || SUBJECT_PRESENT.test(text)) return;
      var named = (own[section].strategies || []).filter(function (s) {
        return s && s.term && s.term.test(text);
      });
      if (!named.length) return;
      // The model raising it first is the good case, not a collision.
      var raised = already.some(function (h) {
        return h && h.section === section && h.code === code;
      });
      if (raised) return;
      out.push({
        section: section,
        code: code,
        /* Amber, for the reason misplaced is amber: his call of 2026-09-02 that
           red is what a funder could refuse the claim over. A missing effect is
           a sentence the technician can still add. */
        kind: "thin",
        /* One below misplaced rather than level with it. misplaced is a
           positive match on a published term; this is an ABSENCE of language,
           which is the weaker of the two claims, so it sorts second when a note
           carries both. */
        rank: 1,
        detail: named.length === 1
          ? named[0].label + " is named with no stated effect. Say whether it helped."
          : "The " + own[section].label + " strategies are named with no stated effect. Say whether they helped.",
      });
    });
    return out;
  }

  /* ── The same check, one model call earlier ───────────────────────────────
     His upgrade 01, and it adds no clinical judgement of its own: it reads the
     table above through the intake boxes instead of through the drafted note.

     THE MISPLACEMENT STARTS IN THE INPUT. A technician types a consequence
     procedure into the Antecedent Strategies box, the model carries it
     faithfully into the antecedent narrative, and misplaced() finds it there
     after a full draft has been paid for. The text that gave it away was
     already on screen before the first call went out.

     NO SECOND SEARCH. This builds the section-keyed object misplaced() already
     takes and hands it over. Which section owns a DRO has moved once already;
     it must never be answerable two ways in one file.

     WHICH BOX FEEDS WHICH SECTION IS THE TOOL'S TO DECLARE, like the filing and
     like effectCode, so a section with no `input` is simply not searched. That
     is the quiet failure to watch for: an unmapped section finds nothing and
     reads exactly like a clean note. tests/wrong-section-pre-draft.spec.js
     pins the mapping for that reason.

     THE INPUT IS ROUGHER THAN THE OUTPUT. The post-draft check reads model
     prose; this reads bullet scraps and shorthand. The terms are unchanged, so
     the three labels with no safe phrase still match nothing, which is the same
     way this is allowed to be wrong. */
  function misplacedInput(values, ownership) {
    var v = values && typeof values === "object" ? values : {};
    var own = ownership && ownership.sections;
    if (!own) return [];
    var bySection = {};
    var mapped = 0;
    Object.keys(own).forEach(function (section) {
      var input = own[section].input;
      if (!input) return;
      mapped += 1;
      bySection[section] = String(v[input] || "");
    });
    if (!mapped) return [];
    return misplaced(bySection, ownership).map(function (h) {
      return {
        section: h.section,
        home: h.home,
        code: h.code,
        label: h.label,
        input: own[h.section].input,
        homeInput: own[h.home].input,
        homeLabel: own[h.home].label,
      };
    }).filter(function (h) {
      // A home section the tool declared no box for cannot be pointed at.
      return !!h.homeInput;
    });
  }

  window.NoteHollow = {
    recastZero: recastZero,
    isHollow: isHollow,
    pass: pass,
    passNote: passNote,
    misplaced: misplaced,
    misplacedInput: misplacedInput,
    effectUnstated: effectUnstated,
  };
})();
