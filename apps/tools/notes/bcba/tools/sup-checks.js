/* Supervision note checks that read the draft against the BCBA's own notes.
 *
 * WHERE THIS CAME FROM. Kaleb's Supervision bench run, 2026-10-09 (card
 * sup-note-accuracy). The prompt now asks for each fix (sup.js,
 * FIDELITY_RULES); this file is the part that can be checked exactly:
 *
 *   A SUBSTANTIAL PROGRESS PICK NEXT TO A STALL OR A NEW BEHAVIOR gets a hint
 *   that quotes the phrase it read and asks the BCBA to check it. It used to
 *   change the pick to moderate, and the reviewer (R332-H1) found it capping
 *   all 15 substantial notes tried ("no new bx", "no regression", "elopement
 *   flat at zero", "flat affect"). Atlas's call: the pick stays the BCBA's,
 *   and the matcher reads negation, a reduction target at zero, and
 *   maintenance, so the hint is rarely wrong. The rule itself ("no higher than
 *   moderate") stays in the prompt.
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

  var NARRATIVES = ["progress", "programming", "behavior", "feedback", "followup"];

  /* WHAT A STALL OR A NEW BEHAVIOR LOOKS LIKE, read one clause at a time so
     a phrase is judged with the words around it. Each matcher errs toward
     silence: a hint that is wrong teaches the BCBA to skip the hint. */
  var STALLED = /\bstall(?:ed|ing|s)?\b|\bplateau\w*\b|\bflat\b|\bno progress\b|\bnot (?:progressing|making progress|improving)\b|\bregress\w*\b|\bstuck\b|\bno (?:gains?|improvement)\b|\blevell?ed off\b|\bhas(?:n't| not) (?:moved|improved)\b/i;

  // A clause about a reduction target at zero, or about maintenance, is good
  // news when it says "flat". "Flat affect" is a presentation, not a program.
  var AT_ZERO = /\bat\s+(?:zero|0)\b|\bzero\b|\b0\s*(?:x|times|occurrences|per)\b/i;
  var MAINTENANCE = /\bmaint\w*|\bmastered\b|\b100\s*%/i;
  var STALL_NOT_AFFECT = new RegExp("(?!flat\\s+affect\\b)(?:" + STALLED.source + ")", "i");

  var BEHAVIOR_WORDS = "behaviou?rs?|bxs?|aggression|elopement|eloping|self[- ]injur\\w*|SIB|tantrums?|flopping|dropping|biting|hitting|kicking|scratching|spitting|screaming|yelling|throwing|pinching|pushing|grabbing|hair pulling|bolting|property destruction|mouthing|pica|head[- ]?banging";
  var BEHAVIOR_VERBS = "hit|bite|bit|kick|kicked|scratch|scratched|spit|spat|pinch|pinched|push|pushed|throw|threw|scream|screamed|elope|eloped|bolt|bolted|flop|flopped";

  /* Card tool-hint-polish, after the #336 review. A behavior word followed
     by a program word ("behavior data", "bx graphing", "hitting criterion")
     is about the program, not a behavior, as in bt-checks.js. */
  // A score is a digit with a unit ("80%", "80 percent", "9 of 10 trials");
  // a bare count ("3x", "4 times") is a frequency and keeps the alert.
  var SCORE = "\\d+\\s*(?:%|percent\\b|trials?\\b|of\\b)";
  var NOT_A_BEHAVIOR = "(?!\\s+(?:(?:plan|support|intervention|goal|program|protocol|sheet|data|target|criterion|mastery|percent|graph\\w*|chart\\w*|probe)s?\\b|" + SCORE + "))";

  // Climbing is a behavior only onto something not meant for climbing.
  // "Climbing the stairs" in OT, a "climbing wall" and a "climbing program"
  // are skills (R336 MEDIUM).
  // One whitespace run per gap, so a long run of spaces cannot backtrack.
  // Up to two prepositions ("up on") and two modifiers ("the kitchen counter").
  var CLIMBING = "climb(?:ing|ed|s)?\\s+(?:(?:on|onto|up|over|in)\\s+){0,2}(?:(?:the|a|his|her|their)\\s+)?(?:\\w+\\s+){0,2}?(?:furniture|counters?|shel(?:f|ves)|bookshel(?:f|ves)|tables?|fences?|chairs?|couch(?:es)?|cabinets?|dressers?|desks?|windows?)\\b";

  var BEHAVIOR = "(?:\\b(?:" + BEHAVIOR_WORDS + ")\\b" + NOT_A_BEHAVIOR + "|\\b" + CLIMBING + ")";

  // What a skill is done to: "threw the ball", "hit criterion", "hit 80
  // percent", "hit her goal". A behavior or verb before one of these is good
  // news (R336 HIGH).
  // An object thrown "at" someone is aggression, so "at" after it keeps the
  // alert ("throwing the ball at staff").
  var SKILL_OBJECT = "(?!\\s+(?:\\w+\\s+){0,2}?(?:(?:ball|cart|clothespin|wall|stairs?|steps?|gum|car|criterion|mastery|goal|target|percent|data|bubble|button|ladder|slide|swing|mark|benchmark)s?\\b(?!\\s+at\\b)|" + SCORE + "))";

  /* "For the first time" counts only after a behavior noun, or after a harm
     verb with a person as its object ("hit mom", "threw a toy at a peer").
     "Hit criterion", "kicked the ball" and "talked a bit louder" are a
     client's success, the very notes where a BCBA picks substantial. */
  // Bare "her" is a person only when no noun follows it: "hit her for" is,
  // "kicked her shoes off" is not. A person object wins over a skill object
  // after it ("pushed the peer off the swing").
  var PERSON = "(?:(?:(?:his|her|their|a|the|another|other)\\s+)?(?:mom|dad|mother|father|sister|brother|siblings?|peers?|staff|RBT|BT|teacher|therapist|aide|parents?|caregivers?|grandma|grandpa|grandmother|grandfather|friend|classmate|child|kid|baby|him|them|me|us|self|himself|herself|themselves)\\b" +
    "|her\\b(?!\\s+(?!(?:for|on|in|at|and|with|again|today|during|when|while|after|before|twice|once|then|so|but|hard)\\b)\\w))";
  // Self-injury: "hit his head", "banged her head", "bit his hand".
  var SELF_INJURY = "(?:hit|hits|bang(?:s|ed)?|bit|bites?|scratch(?:es|ed)?)\\s+(?:his|her|their)\\s+(?:own\\s+)?(?:head|face|hands?|arms?|legs?)\\b";
  var HARM_VERBS = "hit|hits|bit|bites?|kick(?:s|ed)?|push(?:es|ed)?|pinch(?:es|ed)?|scratch(?:es|ed)?|(?:threw|throws?)\\s+(?:\\w+\\s+){0,2}at|(?:spit|spat|spits)\\s+(?:at|on)";
  var FIRST_TIME = "(?:" + BEHAVIOR + SKILL_OBJECT + "|\\b(?:" + HARM_VERBS + ")\\s+" + PERSON + "|\\b" + SELF_INJURY + ")(?:\\s+\\w+){0,3}?\\s+for\\s+the\\s+first\\s+time\\b";

  // A behavior verb after "started" or "first time", unless a skill object
  // follows it. "A bit" is an amount, not a bite.
  var VERB = "\\b(?:" + BEHAVIOR_VERBS + ")\\b" + SKILL_OBJECT;

  var NEW_BEHAVIOR = new RegExp(
    "\\bnew\\s+(?:\\w+\\s+){0,2}" + BEHAVIOR +
    "|" + BEHAVIOR + "\\s+(?:\\w+\\s+){0,2}(?:started|began)\\b" +
    "|\\b(?:started|began|new onset of)\\s+(?:to\\s+)?(?:" + BEHAVIOR + SKILL_OBJECT + "|" + VERB + ")" +
    "|\\bfirst\\s+(?:time|instance|occurrence)\\s+(?:of\\s+)?(?:(?!a\\s+bit\\b)\\w+\\s+){0,2}(?:" + BEHAVIOR + SKILL_OBJECT + "|" + VERB + ")" +
    "|" + FIRST_TIME +
    // "pinching is new" (tool-hint-polish).
    "|" + BEHAVIOR + "\\s+(?:is|was|are|were)\\s+(?:brand\\s+)?new\\b",
    "i"
  );
  // A behavior PLAN is a document. "New behavior plan implemented" is news
  // about the protocol, not a new behavior of concern.
  var BEHAVIOR_DOCUMENT = /\bbehaviou?r\s+(?:support\s+|intervention\s+)?plan\b|\bBIP\b|\bBSP\b/i;

  // A negator in the three words before a match turns it around: "no new bx",
  // "no regression", "no stalls".
  var NEGATOR = /\b(?:no|not|without|zero|never|nor|none)\b/i;
  var CLAUSE_BREAK = /[.;,\n]|\s(?:so|but|and then|then)\s/i;
  var QUOTE_MAX = 50;

  function negated(clause, index) {
    var before = clause.slice(0, index).trim().split(/\s+/).slice(-3).join(" ");
    return NEGATOR.test(before);
  }

  // The first un-negated match of `re` in a clause, or -1.
  function hit(clause, re) {
    var m = re.exec(clause);
    if (!m) return -1;
    return negated(clause, m.index) ? -1 : m.index;
  }

  // The clause, or a window of it around the match, short enough to quote.
  function quote(clause, at) {
    if (clause.length <= QUOTE_MAX) return clause;
    var start = Math.max(0, at - 20);
    var piece = clause.slice(start, start + QUOTE_MAX);
    if (start > 0) piece = piece.replace(/^\S*\s/, "");
    return piece.replace(/\s\S*$/, "").trim();
  }

  // What in the notes a substantial pick should be checked against, quoted.
  function concern(intake) {
    var clauses = String(intake || "").split(CLAUSE_BREAK).map(function (c) { return (c || "").trim(); }).filter(Boolean);
    for (var i = 0; i < clauses.length; i++) {
      var c = clauses[i];
      if (!AT_ZERO.test(c) && !MAINTENANCE.test(c)) {
        var at = hit(c, STALL_NOT_AFFECT);
        if (at !== -1) return quote(c, at);
      }
      if (!BEHAVIOR_DOCUMENT.test(c)) {
        var nb = hit(c, NEW_BEHAVIOR);
        if (nb !== -1) return quote(c, nb);
      }
    }
    return "";
  }

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

  /* Never changes the pick (R332-H1). A substantial pick beside a stall or a
     new behavior gets one hint that quotes what was read. */
  function progressHints(out, intake) {
    if (out.overallProgress !== STEADY) return [];
    var said = concern(intake);
    if (!said) return [];
    return [{
      section: "overallProgress",
      code: "other",
      detail: "Progress picked substantial, but the notes mention \"" + said + "\"; check it.",
    }];
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

  /* The whole check. Returns the output unchanged, as a NEW object, and the
     hints to add; the caller concatenates them before its hint normalizer
     runs, so they take the same validation as every other hint. */
  function apply(out, intake) {
    var o = out && typeof out === "object" ? out : {};
    var src = text(intake);
    var next = Object.assign({}, o);
    return {
      output: next,
      hints: progressHints(next, src).concat(droppedProcedureHints(next, src), promptLevelHints(next, src)),
    };
  }

  window.SupChecks = {
    apply: apply,
    STALLED: STALLED,
    NEW_BEHAVIOR: NEW_BEHAVIOR,
  };
})();
