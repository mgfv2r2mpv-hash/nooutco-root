/* goal-names.js - is each goal name in the note one the intake actually named?
 *
 * Approved 2026-10-02, from a production Supervision note whose Goals Analyzed
 * table carried goal names the BCBA never wrote. Nothing compared the model's
 * goal names with the input; normalizeOutput dropped a row only when all three
 * of its fields were empty.
 *
 * WHAT COUNTS AS A MATCH. The goal name, folded to lowercase with every run of
 * punctuation and whitespace read as one space, appears as a run of whole
 * words somewhere in one of the intake texts folded the same way. So "Motor
 * Imitation" matches "- 3-step motor imitation: initiating", and "otor imit"
 * does not.
 *
 * TOKENS. The caller passes the intake twice, as typed and as the model was
 * sent it, scrubbed and then restored. A goal name the page restored from a
 * [[Tn]] token matches the words as typed. A goal name still carrying a role
 * token ([CLIENT]) matches the scrubbed intake, where the same token sits in
 * the same place, and folding drops the brackets on both sides alike.
 *
 * IT ONLY ANSWERS. The engine draws the notice and the clinician corrects or
 * confirms the name. Nothing here rewrites a goal, because a guessed
 * correction in a signed note is worse than a visible question.
 *
 * Plain JS, no page state, so it can be read on its own. */
(function () {
  function normalise(text) {
    return String(text == null ? "" : text)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  }

  function namedIn(goal, intakes) {
    var want = normalise(goal);
    if (!want) return true;
    var needle = " " + want + " ";
    return (intakes || []).some(function (t) {
      return (" " + normalise(t) + " ").indexOf(needle) !== -1;
    });
  }

  /* Indices of the names with no match. A blank name is not checked: there is
     no name to have invented, and a row with nothing in it is its own problem. */
  function unmatched(goals, intakes) {
    var out = [];
    (goals || []).forEach(function (g, i) {
      if (!namedIn(g, intakes)) out.push(i);
    });
    return out;
  }

  window.GoalNames = { normalise: normalise, namedIn: namedIn, unmatched: unmatched };
})();
