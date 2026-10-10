/* THE EXPERT'S QUESTIONS, ASKED IN THE NOME PANEL.
 *
 * Kaleb, 2026-10-04, asking a second time: "WHERE ARE THE EXPERT QUESTION CHIPS
 * IN THE NOME PANEL?" The expert's asks sat in a block under the note and under
 * each section, and its function-claim questions sat two clicks deep under
 * "phrases to reword", so the questions it raised were read, if at all, a long
 * way from the box that answers them. His ruling on what moves, the same night
 * ("Claims + asks"): every ask, whole-note and per section, and every finding
 * the function-claim reader can ask about, are asked in the panel. What is not
 * a question (the abbreviation readings, the phrases to reword) stays above the
 * note.
 *
 * Pure: it reads the expert's result and returns plain rows, and composes the
 * one revision their answers send. The engine draws nothing here and the panel
 * decides nothing here. */
(function () {
  "use strict";

  var WHOLE_LABEL = "Whole note";

  // A finding the expert itself marked "keep" asks nothing, as everywhere else.
  function shownClaims(register) {
    return (register || []).filter(function (r) {
      return r && String(r.quote || "").trim() && (r.action || "ask") !== "keep";
    });
  }

  /* Every question the expert asked, in the order it ranked them: its asks
   * first, then the claims. An ask about a section edited since the reading
   * stays, marked `stale`: his ruling of 2026-09-02 is that an edit folds a
   * finding and never retires it, because nothing knows whether the edit
   * answered it. A claim is a question only when
   * `claimFor` can read it, so a phrase to reword that asks nothing stays a
   * phrase to reword.
   *
   *   opts.headingFor(sectionId) -> heading, or null
   *   opts.whole                 -> the id the expert uses for the whole note
   *   opts.claimFor(quote)       -> a claim, or null (FunctionClaim.read)
   */
  function list(expert, opts) {
    var o = opts || {};
    if (!expert || expert.status !== "done") return [];
    var revised = expert.revised || [];
    var whole = o.whole || "note";
    var out = [];
    (expert.hints || []).forEach(function (f, i) {
      var ask = String((f && f.ask) || "").trim();
      var why = String((f && f.why) || "").trim();
      /* A finding with a reason and no ask is still a finding (the review of
         #337, MEDIUM 3): its reason is what the row says. Skipping it left
         the block reading "Expert: no unobserved claims" over a real one. */
      if (!ask && !why) return;
      var id = String(f.section || whole);
      var stale = id !== whole && revised.indexOf(id) !== -1;
      var heading = id === whole ? WHOLE_LABEL : ((o.headingFor && o.headingFor(id)) || id);
      out.push({ key: "ask:" + id + ":" + i, kind: "ask", section: id, heading: heading, question: ask || why, why: ask ? why : "", stale: stale });
    });
    shownClaims(expert.register).forEach(function (r) {
      // The wire quote is what the model is answered with; the shown one is
      // the clinician's own word (expertForReader in engine.jsx).
      var wire = String(r.quoteForModel || r.quote || "").trim();
      if (!o.claimFor || !o.claimFor(wire)) return;
      out.push({
        key: "claim:" + wire,
        kind: "claim",
        heading: "",
        quote: String(r.quote || wire),
        quoteForModel: wire,
        why: String(r.why || "").trim(),
        question: "You wrote \"" + String(r.quote || wire) + "\". Did that come from something you saw, or is it your reading of it?",
      });
    });
    return out;
  }

  /* The one revision the typed answers send. Each answer rides under the
   * question it answers, with the section the question points at, so the model
   * puts it where it belongs and nowhere else. Null when nothing was typed. */
  function instruction(rows, answers) {
    var a = answers || {};
    var lines = [];
    (rows || []).forEach(function (q) {
      var said = String(a[q.key] || "").trim();
      if (!said) return;
      lines.push("Q (" + (q.heading || WHOLE_LABEL) + "): " + q.question);
      lines.push("A: " + said);
      lines.push("");
    });
    if (!lines.length) return null;
    return [
      "The clinician answered the expert's questions about this note. Each A: answers the Q: above it.",
      "Put each answer into the section its question names (\"" + WHOLE_LABEL + "\" means wherever it belongs), in the note's voice, and change nothing the answers do not touch.",
      "",
    ].concat(lines).join("\n").trim();
  }

  window.ExpertQuestions = { list: list, instruction: instruction, WHOLE_LABEL: WHOLE_LABEL };
})();
