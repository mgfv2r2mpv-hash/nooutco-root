/* BT note checks that read the draft against the technician's own notes.
 *
 * WHERE THIS CAME FROM. Kaleb's bench run of a telehealth parent-coaching case,
 * 2026-10-09 (card bt-coaching-actor). The intake said "dad ran trials w me
 * coaching on video ... 'sit down' needed dad to guide him", and the answer to
 * a follow-up was "I told dad to wait 3 seconds before guiding; he did it on
 * the next 3 trials." The note wrote that "the parent waited three seconds
 * before delivering a full physical prompt ... and the client completed the
 * direction on the next three trials". Three faults in one sentence: the
 * technician's coaching was gone, dad's follow-through had become the
 * client's, and "full physical" was a level nobody wrote.
 *
 * The prompt now asks for each of those (bt.js, buildUserPrompt). This file is
 * the part that can be checked exactly rather than asked for:
 *
 *   two ticks are UNDONE when the notes cannot support them ("Contact family,
 *   new behavior" with no new behavior, "Visual schedule" with no schedule),
 *   because a wrong tick is copied into the EHR as it stands;
 *
 *   four gaps are FLAGGED and the prose is left alone (a prompt level the notes
 *   never named, coaching the note dropped, a support called a visual schedule,
 *   and "indep" or "errorless" lost), because rewriting a clinical sentence
 *   from a pattern is a guess, and a hint reaches the technician who can fix it.
 *
 * Pure and fail-open: bt.js runs it only on a real draft (one that carries the
 * intake), and a page where this file did not load drafts exactly as before.
 *
 * Exposes window.BtChecks.
 */
(function () {
  "use strict";

  var NEW_BEHAVIOR_ITEM = "Contact family, new behavior";
  var VISUAL_SCHEDULE = "Visual schedule";

  var NARRATIVES = [
    "clinicalStatusNarrative", "lessonProgressNarrative",
    "antecedentNarrative", "behaviorPlanNarrative", "followUpNarrative",
  ];

  /* A behavior the notes call new. "new" next to a behavior word, or the plain
     ways a technician says it ("first time", "never seen before", "started
     biting"). A caregiver's question, a new target or a new material is not a
     new behavior, which is the whole reason this is narrower than /new/. */
  var BEHAVIOR_WORDS = "behaviou?rs?|bxs?|aggression|elopement|eloping|self[- ]injur\\w*|SIB|tantrums?|flopping|dropping|biting|hitting|kicking|scratching|spitting|screaming|yelling|throwing|property destruction|mouthing|pica|head[- ]?banging";
  var NEW_BEHAVIOR = new RegExp(
    "\\bnew\\s+(?:\\w+\\s+){0,2}(?:" + BEHAVIOR_WORDS + ")\\b" +
    "|\\b(?:" + BEHAVIOR_WORDS + ")\\b[^.\\n]{0,30}\\b(?:is|was|are|were)\\s+new\\b" +
    "|\\bfirst time\\b|\\bnever (?:seen|done|happened|did)\\b" +
    "|\\b(?:started|began|new onset of)\\s+(?:" + BEHAVIOR_WORDS + ")\\b",
    "i"
  );

  var SCHEDULE_WORD = /\bschedule\b/i;
  var NOTE_VISUAL_SCHEDULE = /\bvisual schedule\b/i;

  /* Prompt levels a note can name. Each is matched in the note and looked for
     in the intake by the same pattern, so a level counts as the technician's
     only when they wrote that level. "guide" never matches "full physical",
     which is the case that started this. */
  var PROMPT_LEVELS = [
    { name: "full physical", re: /\bfull[-\s]+physical\b/i },
    { name: "partial physical", re: /\bpartial[-\s]+physical\b/i },
    { name: "hand over hand", re: /\bhand[-\s]+over[-\s]+hand\b|\bHOH\b/ },
    { name: "full verbal", re: /\bfull[-\s]+verbal\b/i },
    { name: "partial verbal", re: /\bpartial[-\s]+verbal\b/i },
    { name: "gestural", re: /\bgestur(?:e|es|al|ally)\b/i },
    { name: "positional", re: /\bpositional\b/i },
  ];

  /* Coaching. In the intake: the technician says they coached, told a
     caregiver to do something, or showed or modeled it for them. "Asked mom
     about sleep" is a conversation, not coaching, which is why told and asked
     need the "to". In the note: any wording that reports
     it. A coaching session whose note says nothing of the coaching has lost
     the service it was billed as. */
  var CAREGIVER = "(?:the\\s+)?(?:dad|mom|father|mother|parent|parents|caregiver|caregivers|grandma|grandmother|grandpa|grandfather|aunt|uncle|guardian)";
  var COACH_INTAKE = new RegExp(
    "\\bcoach\\w*\\b" +
    "|\\b(?:told|instructed|reminded|taught|asked)\\s+" + CAREGIVER + "\\s+(?:how\\s+)?to\\b" +
    "|\\b(?:showed|modell?ed for)\\s+" + CAREGIVER + "\\b",
    "i"
  );
  var COACH_NOTE = /\bcoach\w*\b|\bfeedback\b|\binstruct\w*\b|\bmodell?ed for\b|\b(?:told|showed|directed|reminded|asked) the (?:caregiver|parent|father|mother)\b/i;

  /* Words the technician wrote that must survive in some form. "indep on most"
     came back without "independent", and the result of a trial went with it. */
  var KEPT_TERMS = [
    { word: "independent", intake: /\bindep(?:endent(?:ly)?|endence)?\b/i, note: /\bindependen/i, section: "lessonProgressNarrative" },
    { word: "errorless", intake: /\berrorless\b/i, note: /\berrorless\b/i, section: "lessonProgressNarrative" },
  ];

  function text(v) {
    return typeof v === "string" ? v : "";
  }

  function noteText(out) {
    return NARRATIVES.map(function (k) { return text(out[k]); }).join("\n");
  }

  function without(list, label) {
    return (Array.isArray(list) ? list : []).filter(function (v) { return v !== label; });
  }

  function has(list, label) {
    return Array.isArray(list) && list.indexOf(label) !== -1;
  }

  // Ticks the notes cannot support, undone, each with a hint saying so.
  function untick(out, intake) {
    var changes = {};
    var hints = [];
    if (has(out.actionItems, NEW_BEHAVIOR_ITEM) && !NEW_BEHAVIOR.test(intake)) {
      changes.actionItems = without(out.actionItems, NEW_BEHAVIOR_ITEM);
      hints.push({ section: "actionItems", code: "other", detail: "Unticked \"new behavior\": the notes name no new behavior." });
    }
    if (has(out.antecedentStrategies, VISUAL_SCHEDULE) && !SCHEDULE_WORD.test(intake)) {
      changes.antecedentStrategies = without(out.antecedentStrategies, VISUAL_SCHEDULE);
      hints.push({ section: "antecedentStrategies", code: "other", detail: "Unticked \"Visual schedule\": the notes name no schedule." });
    }
    return { changes: changes, hints: hints };
  }

  // The first narrative that names a pattern, so a hint lands where the words are.
  function sectionNaming(out, re) {
    for (var i = 0; i < NARRATIVES.length; i++) {
      if (re.test(text(out[NARRATIVES[i]]))) return NARRATIVES[i];
    }
    return "";
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

  function gapHints(out, intake) {
    var hints = [];
    var all = noteText(out);
    if (COACH_INTAKE.test(intake) && !COACH_NOTE.test(all)) {
      hints.push({ section: "lessonProgressNarrative", code: "ambiguous_item", detail: "Your coaching of the caregiver is missing from the note." });
    }
    var scheduleAt = SCHEDULE_WORD.test(intake) ? "" : sectionNaming(out, NOTE_VISUAL_SCHEDULE);
    if (scheduleAt) {
      hints.push({ section: scheduleAt, code: "ambiguous_item", detail: "Notes name no visual schedule; name the support you used." });
    }
    KEPT_TERMS.forEach(function (t) {
      if (t.intake.test(intake) && !t.note.test(all)) {
        hints.push({ section: t.section, code: "ambiguous_item", detail: "Notes say \"" + t.word + "\"; the note dropped it." });
      }
    });
    return hints;
  }

  /* The whole check. Returns a NEW output and the hints to add; the caller
     concatenates them before its own hint normalizer runs, so they take the
     same validation as every other hint. */
  function apply(out, intake) {
    var o = out && typeof out === "object" ? out : {};
    var src = text(intake);
    var ticks = untick(o, src);
    var next = Object.assign({}, o, ticks.changes);
    return {
      output: next,
      hints: ticks.hints.concat(promptLevelHints(next, src), gapHints(next, src)),
    };
  }

  window.BtChecks = {
    apply: apply,
    NEW_BEHAVIOR: NEW_BEHAVIOR,
    PROMPT_LEVELS: PROMPT_LEVELS,
  };
})();
