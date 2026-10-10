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
 * the part that can be read off the text, and every finding is a HINT. Nothing
 * here changes a tick or a word of prose:
 *
 *   two ticks get a "check this" hint when the notes do not support them
 *   ("Contact family, new behavior" with no new behavior, "Visual schedule"
 *   with no schedule). They used to be unticked, and the reviewer (R331-H1)
 *   found real new behaviors unticked in 13 of 25 phrasings. Atlas's call: a
 *   wrong untick removes the BCBA's alert, a wrong tick costs the technician
 *   one look, so the tick stays and the hint asks;
 *
 *   four gaps are flagged (a prompt level the notes never named, coaching the
 *   note dropped, a support called a visual schedule, and "indep" or
 *   "errorless" lost), because rewriting a clinical sentence from a pattern is
 *   a guess, and a hint reaches the technician who can fix it.
 *
 * Every matcher errs toward silence: a phrase that might be the technician's
 * own way of saying it counts as said.
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

  /* A behavior the notes call new. Built from the ways the reviewer's 25
     phrasings say it (R331-H1): "new" beside a behavior word or set off by
     punctuation ("new: hair pulling", "biting (new)", "kicking - new",
     "pinching is new"), "first time" or "first instance", "never ... before" or
     "not seen before", and a behavior that "started" or "began". Erring wide is
     the safe side here: the tick stays either way, and a match only keeps the
     "check this" hint quiet. "new behavior plan" and its kin are a document,
     not a behavior, so they do not count. */
  var BEHAVIOR_WORDS = "behaviou?rs?|bxs?|aggression|elopement|eloping|self[- ]injur\\w*|SIB|tantrums?|flopping|dropping|biting|hitting|kicking|scratching|spitting|screaming|yelling|throwing|pinching|pushing|grabbing|pulling|hair pulling|crying|bolting|property destruction|mouthing|pica|head[- ]?banging";
  var BEHAVIOR_VERBS = "hit|hits|bite|bit|bites|kick|kicked|kicks|scratch|scratched|spit|spat|pinch|pinched|push|pushed|throw|threw|scream|screamed|yell|yelled|elope|eloped|bolt|bolted|flop|flopped|grab|grabbed|pull|pulled|bang|banged|cry|cried";
  var NOT_A_BEHAVIOR = "(?!\\s+(?:plan|support|intervention|goal|program|protocol|sheet|data|target)s?\\b)";
  var NEW_BEHAVIOR = new RegExp(
    "\\b(?:brand\\s+)?new\\s+(?:\\w+\\s+){0,2}(?:" + BEHAVIOR_WORDS + ")\\b" + NOT_A_BEHAVIOR +
    "|\\bnew\\s*:" +
    "|\\(\\s*new\\s*\\)" +
    "|\\s[-\\u2013]\\s*new\\b" +
    "|\\b(?:is|was|are|were)\\s+(?:brand\\s+)?new\\b" +
    "|\\bfirst\\s+(?:time|instance|occurrence|episode)\\b" +
    "|\\bnever\\s+(?:\\w+\\s+){0,5}before\\b|\\bnot\\s+seen\\s+before\\b|\\bnever\\s+(?:seen|done|happened|did)\\b" +
    "|\\b(?:started|began|starting|beginning|new onset of)\\s+(?:to\\s+)?(?:" + BEHAVIOR_WORDS + "|" + BEHAVIOR_VERBS + ")\\b" +
    "|\\b(?:" + BEHAVIOR_WORDS + ")\\s+(?:\\w+\\s+){0,2}(?:started|began)\\b",
    "i"
  );

  var SCHEDULE_WORD = /\bschedule\b/i;
  var NOTE_VISUAL_SCHEDULE = /\bvisual schedule\b/i;

  /* Prompt levels a note can name. `note` is how the level reads in a note;
     `intake` adds the shorthand a technician writes for that same level (FP,
     PP, "full phys", hoh, "used a point"). A level counts as the technician's
     only when they wrote that level, in either form, so "guide" never counts
     as "full physical", which is the case that started this. The capitals-only
     codes (FP, PP, FV, PV) are case-sensitive, so "app" or "fp" in passing are
     not read as a level. */
  var PROMPT_LEVELS = [
    { name: "full physical", note: /\bfull[-\s]+physical\b/i, intake: [/\bfull[-\s]*phys\w*/i, /\bFPP?\b/] },
    { name: "partial physical", note: /\bpartial[-\s]+physical\b/i, intake: [/\bpartial[-\s]*phys\w*/i, /\bPPP?\b/] },
    { name: "hand over hand", note: /\bhand[-\s]+over[-\s]+hand\b|\bHOH\b/i, intake: [/\bhand[-\s]+over[-\s]+hand\b/i, /\bhoh\b/i] },
    { name: "full verbal", note: /\bfull[-\s]+verbal\b/i, intake: [/\bfull[-\s]*verb\w*/i, /\bFV\b/] },
    { name: "partial verbal", note: /\bpartial[-\s]+verbal\b/i, intake: [/\bpartial[-\s]*verb\w*/i, /\bPV\b/] },
    { name: "gestural", note: /\bgestur(?:e|es|al|ally)\b/i, intake: [/\bgestur\w*/i, /\bpoint(?:s|ed|ing)?\b/i] },
    { name: "positional", note: /\bpositional\b/i, intake: [/\bpositional\b/i] },
  ];

  function wrote(level, intake) {
    return level.intake.some(function (re) { return re.test(intake); });
  }

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
  // In the note, the caregiver words count as well as "the caregiver" (R331).
  var COACH_NOTE = new RegExp(
    "\\bcoach\\w*\\b|\\bfeedback\\b|\\binstruct\\w*\\b|\\bmodell?ed for\\b" +
    "|\\b(?:told|showed|directed|reminded|asked|taught|guided)\\s+" + CAREGIVER + "\\b",
    "i"
  );

  /* Words the technician wrote that must survive in some form. "indep on most"
     came back without "independent", and the result of a trial went with it. */
  var KEPT_TERMS = [
    // "on his own", "without prompts" and "unprompted" say independent too (R331).
    { word: "independent", intake: /\bindep(?:endent(?:ly)?|endence)?\b/i, note: /\bindependen|\bon (?:his|her|their) own\b|\bwithout (?:a |any )?prompt(?:s|ing)?\b|\bunprompted\b/i, section: "lessonProgressNarrative" },
    { word: "errorless", intake: /\berrorless\b/i, note: /\berrorless\b/i, section: "lessonProgressNarrative" },
  ];

  function text(v) {
    return typeof v === "string" ? v : "";
  }

  function noteText(out) {
    return NARRATIVES.map(function (k) { return text(out[k]); }).join("\n");
  }

  function has(list, label) {
    return Array.isArray(list) && list.indexOf(label) !== -1;
  }

  /* Ticks the notes do not support, each with a hint asking the technician
     to check it. The tick itself is never changed (R331-H1). */
  function tickHints(out, intake) {
    var hints = [];
    if (has(out.actionItems, NEW_BEHAVIOR_ITEM) && !NEW_BEHAVIOR.test(intake)) {
      hints.push({ section: "actionItems", code: "other", detail: "Check \"new behavior\": the notes name no new behavior." });
    }
    if (has(out.antecedentStrategies, VISUAL_SCHEDULE) && !SCHEDULE_WORD.test(intake)) {
      hints.push({ section: "antecedentStrategies", code: "other", detail: "Check \"Visual schedule\": the notes name no schedule." });
    }
    return hints;
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
      return !wrote(p, intake) && sectionNaming(out, p.note);
    }).map(function (p) {
      return {
        section: sectionNaming(out, p.note),
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

  /* The whole check. Returns the output unchanged, as a NEW object, and the
     hints to add; the caller concatenates them before its own hint normalizer
     runs, so they take the same validation as every other hint. */
  function apply(out, intake) {
    var o = out && typeof out === "object" ? out : {};
    var src = text(intake);
    var next = Object.assign({}, o);
    return {
      output: next,
      hints: tickHints(next, src).concat(promptLevelHints(next, src), gapHints(next, src)),
    };
  }

  window.BtChecks = {
    apply: apply,
    NEW_BEHAVIOR: NEW_BEHAVIOR,
    PROMPT_LEVELS: PROMPT_LEVELS,
  };
})();
