/* A function claim is the one expert finding a technician can answer with a
 * click instead of a paragraph.
 *
 * The expert flags the sentence: "he wanted attention" claims a function nobody
 * watched happen. What the finding hands back today is a rewrite instruction,
 * so the technician reads the finding, opens the panel, and retypes a fact they
 * already hold. His reading on 2026-09-02: the tool should ask "did you say
 * this because attention occurred afterward, or because there was lack of
 * attention before the behavior, or both, or another reason".
 *
 * That question is answerable in one click AND it routes. Attention that
 * followed the behavior is something a person delivered, and it belongs with
 * the behavior and the response. Attention that was missing before it is a
 * condition that was already in the room, and it belongs with the antecedent
 * modifications. So one answer settles both the sentence and the section, and
 * the section is the half a free-text rewrite gets wrong most often.
 *
 * THE EXPERT HAS ALREADY DECIDED THE SENTENCE IS A CLAIM. Nothing here judges
 * that. Every quote reaching read() is one the model flagged, so these patterns
 * only choose WHICH question to ask. A quote with no mentalistic frame in it
 * gets no control, and that finding behaves exactly as it did before.
 *
 * AUTOMATIC AND SENSORY GET NO CONTROL, deliberately. "He was seeking sensory
 * input" is a claim too, and a common one, but the before-and-after question
 * does not fit it: nobody delivered the consequence and nobody removed the
 * condition. Offering the same four answers there would collect a wrong one,
 * and a wrong answer here writes a sentence into the note. Those findings keep
 * the rewrite they have.
 *
 * IT NAMES NO FUNCTION IN THE OUTPUT. The instruction this builds tells the
 * model what the technician observed and forbids the word for what it means.
 * Reading a function out of an antecedent and a consequence is the BCBA's job,
 * and the note is the evidence they read it from.
 */
(function () {
  "use strict";

  /* The mentalism, not the function. "Wanted", "trying to" and "in order to"
     are what make a sentence a claim about a mind rather than a report of a
     room, and one of them has to be present before any control appears. */
  var FRAME = new RegExp(
    "\\b(?:" +
      "want(?:ed|s|ing)?|desire[sd]?|seek(?:ing|s)?|sought|looking for|" +
      "tr(?:y|ies|ied|ying) to|in order to|so (?:he|she|they|client) could|" +
      "to get|to gain|to obtain|to avoid|to escape|" +
      "attention[-\\s]?(?:seeking|maintained)|escape[-\\s]?maintained|" +
      "because (?:he|she|they|client) (?:want|like|enjoy|did not want)" +
    ")\\b",
    "i",
  );

  var ATTENTION = /\battention\b/i;
  var ESCAPE = /\b(?:escap\w*|avoid\w*|get(?:ting)? out of|demand|task)\b/i;

  /* One entry per kind: the two chip labels the technician reads, and the two
     clauses the model is given. The chips are short because they sit on the
     finding row, and the clauses are long because the model has to write a
     sentence from one of them without inventing the rest. */
  var KINDS = {
    attention: {
      after: "Attention came after it",
      before: "Attention was missing before it",
      afterSaid: "attention followed the behavior, and somebody gave it",
      beforeSaid: "attention was absent or reduced before the behavior",
    },
    escape: {
      after: "The demand stopped after it",
      before: "The demand was there before it",
      afterSaid: "the demand or activity stopped after the behavior",
      beforeSaid: "the demand or activity was already in place before the behavior",
    },
    tangible: {
      // "The client got it after" was the first wording and it is a landmine:
      // saidFor only ever reaches the thread today, but a role label followed
      // by a word is exactly what the name gate rewrites, so the moment anyone
      // sends one of these labels it would go out mangled. None of them names a
      // role now.
      after: "The item arrived after",
      before: "It was unavailable before",
      afterSaid: "the item was handed over after the behavior",
      beforeSaid: "the item was unavailable, or had just been taken away, before the behavior",
    },
  };

  /* Where each answer sends the sentence. These are JSON keys rather than
     headings on purpose: the instruction goes through the same scrub gate every
     typed revision does, and a heading full of capitalised words is exactly the
     shape that gate is built to stop. */
  var AFTER_SECTION = "behaviorPlanNarrative";
  var BEFORE_SECTION = "antecedentNarrative";

  function read(quote) {
    var q = String(quote || "");
    if (!q.trim() || !FRAME.test(q)) return null;
    var kind = ATTENTION.test(q) ? "attention" : ESCAPE.test(q) ? "escape" : "tangible";
    return { kind: kind, quote: q };
  }

  function optionsFor(claim) {
    if (!claim || !KINDS[claim.kind]) return [];
    var k = KINDS[claim.kind];
    return [
      { id: "after", label: k.after },
      { id: "before", label: k.before },
      { id: "both", label: "Both" },
      { id: "other", label: "Something else", pencil: true },
    ];
  }

  /* The section the answer lands in, so the caller can target the revision
     without re-deriving the routing. "Both" targets neither: the instruction
     names both sections and every change it makes is applied. */
  function sectionFor(optionId) {
    if (optionId === "after") return AFTER_SECTION;
    if (optionId === "before") return BEFORE_SECTION;
    return null;
  }

  // What the technician sees in their own conversation thread afterwards, so
  // the exchange reads as a question they answered rather than as a revision
  // that arrived from nowhere.
  function saidFor(claim, optionId, detail) {
    var k = claim && KINDS[claim.kind];
    if (!k) return "";
    if (optionId === "after") return k.after + ".";
    if (optionId === "before") return k.before + ".";
    if (optionId === "both") return k.after + ", and " + lower(k.before) + ".";
    return String(detail || "").trim();
  }

  function lower(s) {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }

  var PREAMBLE =
    "The clinician has answered a question about what they actually observed behind the phrase above. " +
    "Their answer settles both the sentence and the section it belongs in.";

  /* EVERY WORD OF THIS GOES THROUGH THE SCRUB, AND THE SCRUB REWROTE IT.
   *
   * The first draft of this line read "do not write what the client wanted".
   * notes-gate.js has a context pass that reads a role label followed by a
   * capitalised word as a person, and it carries the i flag, so "client wanted"
   * matched and the technician's revision went out saying "do not write what
   * the client Client 2". A second entry took the bare word "want" for a name
   * and replaced it with an opaque token.
   *
   * So a fixed instruction is not safe merely because a human wrote it. Nothing
   * composed here may put a word after "client", "caregiver", "mom", "dad",
   * "guardian", "bt", "rbt", "technician" or "teacher", and nothing may put one
   * after "with", "for" or "beside". The gate stays in the path either way,
   * because the pencil answer is genuinely the technician's own free text.
   *
   * function-claim-question.spec.js compares what reaches the model against
   * what this function returned, so any future wording that trips the same pass
   * fails there rather than in somebody's note. */
  var CLOSING = [
    "Name no function. Do not state a motive, a desire, or the reason the behavior happened.",
    "Where the note already carries one of those, replace it with the observation.",
    "Add nothing the clinician did not just tell you, and take nothing else out.",
  ].join(" ");

  function afterClause(k) {
    return (
      "They observed that " + k.afterSaid + ". That is something a person did after the behavior, " +
      'so write it into the "' + AFTER_SECTION + '" section as what happened next and who responded.'
    );
  }

  function beforeClause(k) {
    return (
      "They observed that " + k.beforeSaid + ". That is a condition that was already in place, " +
      'so write it into the "' + BEFORE_SECTION + '" section as what preceded the behavior.'
    );
  }

  function instructionFor(claim, optionId, detail) {
    var k = claim && KINDS[claim.kind];
    if (!k) return "";
    var body;
    if (optionId === "after") body = afterClause(k);
    else if (optionId === "before") body = beforeClause(k);
    else if (optionId === "both") {
      body = afterClause(k) + " " + beforeClause(k) +
        " Write one sentence in each of those two sections, and do not repeat the same sentence in both.";
    } else {
      var said = String(detail || "").trim();
      if (!said) return "";
      body = "They answered in their own words: " + said +
        " Put what they said where it belongs, and if that is a different section than the one shown, say so in crossSection.";
    }
    return [PREAMBLE, body, CLOSING].join("\n");
  }

  window.FunctionClaim = {
    read: read,
    optionsFor: optionsFor,
    sectionFor: sectionFor,
    saidFor: saidFor,
    instructionFor: instructionFor,
    AFTER_SECTION: AFTER_SECTION,
    BEFORE_SECTION: BEFORE_SECTION,
  };
})();
