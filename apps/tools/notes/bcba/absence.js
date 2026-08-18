/* A note records what was done, never what was not done - enforced rather than asked for.
 *
 * WHY THIS EXISTS AT ALL. The rule has been in the prompt since 2026-08-15, in
 * three places: NEVER DOCUMENT AN ABSENCE in the shared register rules, the
 * conditional on the rate comparison in bt's narrative guidance, and the explicit
 * "never state that the comparison is missing". All three are live. The note
 * still came back saying "no recent session information was provided for
 * comparison", which is how he found out.
 *
 * A fourth sentence in the prompt would not have been a fix, it would have been
 * a wish. This runs after the model returns and cuts the sentence, so the
 * guarantee does not depend on the model agreeing.
 *
 * THE TEST IS WHAT THE SENTENCE IS ABOUT, which the prompt already states: if
 * the subject is the record rather than the client, the staff or the session,
 * cut it. Two things follow, and both are the reason this is not a word list.
 *
 *   A ZERO IS AN OBSERVATION AND IT STAYS. "No instances of aggression occurred"
 *   describes the session. So does "No new questions or concerns for the BCBA at
 *   this time", which is the default the tool itself supplies. Both open with
 *   "no" and neither is an absence sentence, so opening with "no" cannot be the
 *   trigger. What separates them is the verb: occurred is something that
 *   happened, was reported is something the paperwork did.
 *
 *   A PERSON AS SUBJECT IS LEFT ALONE. "The client was not provided with a
 *   break" uses one of the seven banned participles and is a perfectly good
 *   clinical sentence. Sentences whose subject is a person are flagged and never
 *   cut, because the cost of being wrong is a deleted clinical fact and the cost
 *   of leaving it is a sentence he has already seen.
 */
(function () {
  // His seven, verbatim from the register rule: "not reported, not documented,
  // not provided, not specified, not available, not included, or unclear".
  // Nothing has been added. The list is his ruling, not a guess at his ruling.
  var REPORTING = "reported|documented|provided|specified|available|included|unclear";

  // A sentence only qualifies if the thing that is absent is a documentation
  // artifact. This is the half that keeps "no instances of aggression occurred"
  // and "the client was not provided with a break" out of the net.
  var RECORD_NOUN = new RegExp(
    "\\b(information|data|documentation|record|records|notes?|intake|paperwork|comparison|" +
    "details?|specifics?|rate|rates|count|counts|frequency|duration|percentage|percentages|" +
    "level|levels|baseline|measure|measures|measurement|measurements|metric|metrics|" +
    "figures?|numbers?|trial data|session notes)\\b",
    "i"
  );

  // Anything with a person in the subject position is flagged, never cut.
  var PERSON_SUBJECT = new RegExp(
    "^(the\\s+)?(client|behavior technician|technician|bt|rbt|caregiver|parent|guardian|" +
    "sibling|peer|staff member|behavior analyst|bcba|he|she|they|i|we)\\b",
    "i"
  );

  var NEGATED = new RegExp(
    // "was not reported", "were not documented", "is not available", "not specified"
    "\\b(?:was|were|is|are|been|be)\\s+not\\s+(?:" + REPORTING + ")\\b" +
    // "no X was provided", "nothing was documented"
    "|\\b(?:no|nothing|none)\\b[^.!?]*\\b(?:was|were|is|are)\\s+(?:" + REPORTING + ")\\b" +
    // "not reported" standing alone, and "remains unclear"
    "|\\bnot\\s+(?:" + REPORTING + ")\\b" +
    // The same seven in the active voice: "the technician did not report a rate".
    // Almost always a person subject, so almost always flagged rather than cut.
    "|\\b(?:did|does|do)\\s+not\\s+(?:report|document|provide|specify|include)\\b" +
    "|\\b(?:remains?|remained|is|was)\\s+unclear\\b",
    "i"
  );

  /* Sentence splitting that keeps its delimiter, so a rebuilt narrative reads
     exactly as it did minus the sentences that were cut. Abbreviations a
     clinical note actually uses are protected, because splitting "8 of 10 w/
     gest. prompt" mid-sentence would hand the checker half a sentence and the
     other half would survive on its own. */
  var ABBREV = new RegExp(
    "\\b(?:" + [
      // Prompt and procedure shorthand a technician actually types.
      "gest", "phys", "verb", "indep", "mod", "part", "prox", "beh", "resp", "reinf",
      "freq", "dur", "int", "obs", "prog", "sess", "tx", "pt", "ct", "trial",
      // Quantities and time.
      "approx", "avg", "max", "min", "sec", "hr", "hrs", "no", "No", "pct",
      // Ordinary prose.
      "e\\.g", "i\\.e", "vs", "etc", "cf", "Dr", "Mr", "Ms", "Mrs", "St",
    ].join("|") + ")\\.$"
  );

  function sentences(text) {
    var out = [];
    var buf = "";
    var parts = String(text || "").split(/([.!?]+["')\]]*\s*)/);
    for (var i = 0; i < parts.length; i += 2) {
      buf += parts[i] + (parts[i + 1] || "");
      if (!parts[i + 1]) { if (buf) out.push(buf); buf = ""; continue; }
      if (ABBREV.test(buf.trim())) continue;
      out.push(buf);
      buf = "";
    }
    if (buf) out.push(buf);
    return out;
  }

  // "cut" - the sentence is about the paperwork and goes.
  // "flag" - it reads like one but a person is doing the acting, so it stays.
  // null  - ordinary clinical prose.
  function classify(sentence) {
    var s = String(sentence || "").trim();
    if (!s) return null;
    if (!NEGATED.test(s)) return null;
    if (!RECORD_NOUN.test(s)) return null;
    return PERSON_SUBJECT.test(s) ? "flag" : "cut";
  }

  /* Returns { text, cut, flagged }. `cut` and `flagged` are COUNTS, never the
     sentences: this result is audited, and a clinical sentence must not travel
     to the audit endpoint because a rule fired on it. */
  function scrub(text) {
    var kept = [];
    var cut = 0;
    var flagged = 0;
    sentences(text).forEach(function (s) {
      var verdict = classify(s);
      if (verdict === "cut") { cut++; return; }
      if (verdict === "flag") flagged++;
      kept.push(s);
    });
    return { text: kept.join("").replace(/\s+$/, ""), cut: cut, flagged: flagged };
  }

  /* Every string value in a drafted note, scrubbed. Arrays are checkbox values
     and are left alone: an option label is not prose and cutting one would
     change what the technician is asked to verify. */
  function scrubNote(output) {
    var o = output && typeof output === "object" ? output : {};
    var out = {};
    var cut = 0;
    var flagged = 0;
    Object.keys(o).forEach(function (k) {
      if (typeof o[k] !== "string") { out[k] = o[k]; return; }
      var r = scrub(o[k]);
      out[k] = r.text;
      cut += r.cut;
      flagged += r.flagged;
    });
    return { output: out, cut: cut, flagged: flagged };
  }

  window.NoteAbsence = {
    sentences: sentences,
    classify: classify,
    scrub: scrub,
    scrubNote: scrubNote,
  };
})();
