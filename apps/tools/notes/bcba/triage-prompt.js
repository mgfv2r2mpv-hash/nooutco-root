/* The triage prompt, in a file of its own.
 *
 * WHY IT LEFT engine.jsx. Triage is a call to the model like any other, and a
 * migrated tool never sends prompt text: its prompt is fetched inside the Worker
 * from a store with no public URL. For that to be possible the triage prompt has
 * to be somewhere the extractor can reach, and a const inside a React component
 * is not. Moving it here keeps exactly one authored copy - the browser reads it
 * for the tools that have not migrated, and voice-module extracts it from this
 * same deployed file for the ones that have.
 *
 * So do not inline this back into the component, and do not keep a second copy
 * anywhere. Two copies of a prompt do not fail loudly. They write a slightly
 * different note.
 */
(function () {
  var TRIAGE_SYSTEM =
    "You are reviewing a clinician's raw session notes BEFORE they are turned into a formal note.\n\n" +
    "Your ONLY job: decide whether anything is too thin to write from, and if so ask at most 3 short, specific questions that would materially improve the finished note.\n\n" +
    "RULES\n" +
    "- Ask only about what a payer or supervisor would notice missing: counts or rates for a behavior, the prompt level used, whether a strategy worked, how this session compared to recent ones.\n" +
    "- Be specific and quote back what they wrote. \"You mentioned elopement - how many times, and what did you do?\" NOT \"Can you add more detail?\"\n" +
    "- NEVER ask for a name, a date, an address, or any other identifying detail. The notes are deliberately de-identified.\n" +
    "- Do not ask about something they plainly had nothing to report. A session with no behaviors of concern is a normal session, not a gap.\n" +
    "- If the notes are adequate, return sufficient=true and an empty array. Fewer questions is better than more; three is a ceiling, not a target.\n" +
    "- Return ONLY a JSON object: {\"sufficient\": boolean, \"questions\": [{\"field\": \"\", \"question\": \"\"}]}";

  /* Appended to WHICHEVER triage prompt runs, the default above or a tool's own.
     It lives apart from both so there is exactly one place to change what counts
     as ready, which is the reason he chose a model-judged number over counting
     the questions: "the readiness number determination can be adjusted as
     needed." Counting questions would have put that judgement in arithmetic,
     where tuning it means editing code and re-reading tests.

     The number drives how long the skip button stays locked. It never gates
     anything and it is never shown, so a badly calibrated reading costs a few
     seconds either way and nothing else. */
  var TRIAGE_READINESS =
    "\n\nREADINESS\n" +
    "Alongside those fields, return `readiness`: an integer from 0 to 100 for how close this input already is to something a clinician could sign, judged BEFORE any of your questions are answered.\n" +
    "  85-100  Everything a reviewer needs is present. Your questions would sharpen the note rather than rescue it.\n" +
    "  60-84   One real gap - a behavior with no count, a strategy with no outcome. The note can be written and would be visibly thinner.\n" +
    "  30-59   Several gaps, or a single one the note rests on. Writing from this means inventing or omitting.\n" +
    "  0-29    Too thin to write from at all.\n" +
    "Judge what is on the page, not how well it is written. Terse but complete scores high; fluent but hollow scores low.\n" +
    "So the object you return is {\"sufficient\": boolean, \"readiness\": integer, \"questions\": [{\"field\": \"\", \"question\": \"\"}]}.";

  window.NoteTriagePrompt = {
    system: TRIAGE_SYSTEM,
    readiness: TRIAGE_READINESS,
    // What actually runs for a tool with no triage prompt of its own, and what
    // the store publishes under the key "triage".
    full: TRIAGE_SYSTEM + TRIAGE_READINESS,
  };
})();
