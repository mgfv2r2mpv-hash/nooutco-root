/* Supervision note checks that read the draft against the BCBA's own notes.
 *
 * WHERE THIS CAME FROM. Kaleb's Supervision bench run, 2026-10-09 (card
 * sup-note-accuracy). The prompt now asks for each fix (sup.js,
 * FIDELITY_RULES); this file is the part that can be checked exactly:
 *
 *   OVERALL PROGRESS IS CAPPED AT MODERATE when the notes report a stalled
 *   program or a new behavior of concern. The pick is changed, not only
 *   flagged, because it is a checkbox copied into the EHR as it stands, and a
 *   hint says the tool moved it. This is the most judgment-based rule in the
 *   card: Atlas's call, "no higher than moderate".
 *
 *   A NAMED PROCEDURE THE NOTE DROPPED, and A PROMPT LEVEL THE NOTES NEVER
 *   NAMED, are flagged and the prose is left alone. "changed to errorless w
 *   immediate echoic prompt" came back without "errorless", and thin feedback
 *   came back with "full physical prompting" nobody wrote. Rewriting a
 *   clinical sentence from a pattern is a guess; a hint reaches the BCBA, who
 *   can fix it in one look.
 *
 * Pure and fail-open: sup.js runs it only on a real draft (one that carries
 * the intake), and a page where this file did not load drafts as before.
 *
 * Exposes window.SupChecks.
 */
(function () {
  "use strict";

  var STEADY = "Client is making steady, substantial progress towards meeting goals (see summary below)";
  var MODERATE = "Client is making moderate progress towards meeting goals (see summary below)";

  var NARRATIVES = ["progress", "programming", "behavior", "feedback", "followup"];

  var STALLED = /\bstall(?:ed|ing|s)?\b|\bplateau\w*\b|\bflat\b|\bno progress\b|\bnot (?:progressing|making progress)\b|\bregress\w*\b/i;

  /* A behavior the notes call new: "new" next to a behavior word, or the plain
     ways a clinician says it. A new target, a new sibling or a new material is
     not a new behavior, which is why this is narrower than /new/. */
  var BEHAVIOR_WORDS = "behaviou?rs?|bxs?|aggression|elopement|eloping|self[- ]injur\\w*|SIB|tantrums?|flopping|dropping|biting|hitting|kicking|scratching|spitting|screaming|yelling|throwing|property destruction|mouthing|pica|head[- ]?banging";
  var NEW_BEHAVIOR = new RegExp(
    "\\bnew\\s+(?:\\w+\\s+){0,2}(?:" + BEHAVIOR_WORDS + ")\\b" +
    "|\\b(?:" + BEHAVIOR_WORDS + ")\\b[^.\\n]{0,30}\\b(?:is|was|are|were)\\s+new\\b" +
    "|\\bfirst time\\b|\\bnever (?:seen|done|happened|did)\\b" +
    "|\\b(?:started|began|new onset of)\\s+(?:" + BEHAVIOR_WORDS + ")\\b",
    "i"
  );

  /* Procedures a supervision note must keep by name. Each is looked for in the
     intake and in the note by the same pattern, with the abbreviation and the
     long form both counting, so "BST" in the notes is kept by "behavioral
     skills training" in the note. */
  var PROCEDURES = [
    { name: "errorless", re: /\berrorless\b/i },
    { name: "most-to-least", re: /\bmost[-\s]+to[-\s]+least\b|\bMTL\b/ },
    { name: "least-to-most", re: /\bleast[-\s]+to[-\s]+most\b|\bLTM\b/ },
    { name: "time delay", re: /\btime[-\s]+delay\b/i },
    { name: "BST", re: /\bBST\b|\bbehaviou?ral skills training\b/i },
    { name: "task analysis", re: /\btask analys[ie]s\b/i },
    { name: "chaining", re: /\bchain(?:s|ing|ed)?\b/i },
    // "shape" alone is a program target (shapes ID), so only the verb forms count.
    { name: "shaping", re: /\bshap(?:ed|ing)\b/i },
    { name: "DRA", re: /\bDRA\b|\bdifferential reinforcement of (?:an? )?alternative\b/i },
    { name: "DRO", re: /\bDRO\b|\bdifferential reinforcement of other\b/i },
  ];

  var PROMPT_LEVELS = [
    { name: "full physical", re: /\bfull[-\s]+physical\b/i },
    { name: "partial physical", re: /\bpartial[-\s]+physical\b/i },
    { name: "hand over hand", re: /\bhand[-\s]+over[-\s]+hand\b|\bHOH\b/ },
    { name: "full verbal", re: /\bfull[-\s]+verbal\b/i },
    { name: "partial verbal", re: /\bpartial[-\s]+verbal\b/i },
    { name: "gestural", re: /\bgestur(?:e|es|al|ally)\b/i },
    { name: "positional", re: /\bpositional\b/i },
  ];

  function text(v) {
    return typeof v === "string" ? v : "";
  }

  // Each place prose lives, as [section id, text], goal rows included.
  function places(out) {
    var rows = (Array.isArray(out.goalsAnalyzed) ? out.goalsAnalyzed : []).map(function (r) {
      return ["goalsAnalyzed", [text(r && r.goal), text(r && r.progress), text(r && r.nextSteps)].join(" ")];
    });
    return NARRATIVES.map(function (k) { return [k, text(out[k])]; }).concat(rows);
  }

  function sectionNaming(out, re) {
    var hit = places(out).filter(function (p) { return re.test(p[1]); })[0];
    return hit ? hit[0] : "";
  }

  function capProgress(out, intake) {
    if (out.overallProgress !== STEADY) return { changes: {}, hints: [] };
    var why = STALLED.test(intake) ? "a stalled program" : NEW_BEHAVIOR.test(intake) ? "a new behavior of concern" : "";
    if (!why) return { changes: {}, hints: [] };
    return {
      changes: { overallProgress: MODERATE },
      hints: [{ section: "overallProgress", code: "other", detail: "Set to moderate: the notes report " + why + "." }],
    };
  }

  function droppedProcedureHints(out, intake) {
    var all = places(out).map(function (p) { return p[1]; }).join("\n");
    return PROCEDURES.filter(function (p) {
      return p.re.test(intake) && !p.re.test(all);
    }).map(function (p) {
      return { section: "note", code: "ambiguous_item", detail: "Notes name \"" + p.name + "\"; the note dropped it." };
    });
  }

  function promptLevelHints(out, intake) {
    return PROMPT_LEVELS.filter(function (p) {
      return !p.re.test(intake) && sectionNaming(out, p.re);
    }).map(function (p) {
      return {
        section: sectionNaming(out, p.re),
        code: "ambiguous_item",
        detail: "Notes never say \"" + p.name + "\"; use your own prompt words.",
      };
    });
  }

  /* The whole check. Returns a NEW output and the hints to add; the caller
     concatenates them before its hint normalizer runs, so they take the same
     validation as every other hint. */
  function apply(out, intake) {
    var o = out && typeof out === "object" ? out : {};
    var src = text(intake);
    var capped = capProgress(o, src);
    var next = Object.assign({}, o, capped.changes);
    return {
      output: next,
      hints: capped.hints.concat(droppedProcedureHints(next, src), promptLevelHints(next, src)),
    };
  }

  window.SupChecks = {
    apply: apply,
    STALLED: STALLED,
    NEW_BEHAVIOR: NEW_BEHAVIOR,
  };
})();
