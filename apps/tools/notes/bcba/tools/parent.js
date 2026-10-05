/* Parent/caregiver training note tool config - ported from /notes/parent/ with
 * prompts intact, plus the shared engine's revision loop and a starter hint
 * catalog. */
(function () {
  var menu = window.NoteToolsUtil.menu;
  var normalizeHints = window.NoteToolsUtil.normalizeHints;
  var normalizeRevision = window.NoteToolsUtil.normalizeRevision;
  var hintSchema = window.NoteToolsUtil.hintSchema;
  var revisionKeys = window.NoteToolsUtil.revisionKeys;

  // Canonical option lists - these labels are both the menu the AI may choose
  // from and the strings the output checklist renders. They match the EHR form.
  var INDIVIDUALS = ["Parent/Caregiver", "Client", "Technician", "Teacher", "Specialist/s", "Sibling(s)/Peer(s)"];

  var SUPPORT_ACTIVITIES = [
    "Collected data on current goals",
    "Modeled strategies/interventions",
    "Problem-solved concerns",
    "Discussed programs/progress/data collection",
    "Feedback provided",
  ];

  var CAREGIVER_RESPONSES = [
    "Parent/Family is not responding to training due to large barriers and/or resistance.",
    "Parent/Family is trying to learn new strategies, but there are some small barriers to generalization.",
    "Parent/Family is responding to training and generalization of skills is occurring. There are no barriers with their training.",
  ];

  var PROGRESS_OPTIONS = [
    "Minimal progress towards goals",
    "Moderate progress towards goals",
    "Substantial progress towards goals",
  ];

  var GROUP_OPTIONS = {
    individualsPresent: INDIVIDUALS,
    supportActivities: SUPPORT_ACTIVITIES,
    caregiverResponse: CAREGIVER_RESPONSES,
    progressStatus: PROGRESS_OPTIONS,
  };

  var FORM_SECTIONS = [
    { kind: "checklist", heading: "Individuals Present", group: "individualsPresent" },
    { kind: "checklist", heading: "Caregiver Received the Following Support", group: "supportActivities" },
    { kind: "single", heading: "Caregiver Response to Training", group: "caregiverResponse" },
    { kind: "single", heading: "Progress Status", group: "progressStatus" },
    { kind: "narrative", heading: "Summary of Goal Progress & Modifications", key: "summary", minHeight: 110 },
    { kind: "narrative", heading: "Behavior Analyst Follow Up", key: "followup", minHeight: 80 },
  ];

  var SECTION_IDS = ["individualsPresent", "supportActivities", "caregiverResponse", "progressStatus", "summary", "followup"];

  var HINT_CATALOG = {
    thin_section: "Thin relative to the form's expectations",
    ambiguous_item: "Clarify",
    other: "",
  };

  /* ── Response schema ───────────────────────────────────────────────────
     What the model is CONSTRAINED to, not merely asked for. JSON_FORMAT_BLOCK
     below still describes the same shape and still reaches the logged-out
     copy-prompt path, but for a served draft this is the enforcement.

     IT IS ALSO WHAT TURNS THE EXPERT ON. expertSectionIds() in engine.jsx reads
     its section enum and returns null for a tool that has no schema, so until
     this existed the second reading never ran on this tool. His instruction,
     2026-08-30: extend the expert to sup, parent and assess.

     The enum comes from SECTION_IDS rather than formSections, which is the one
     distinction the comparison bench had to learn the hard way. */

  var str = { type: "string" };
  var enumArray = function (values) {
    return { type: "array", items: { type: "string", enum: values } };
  };
  // Single-selects allow "" for "the notes do not support a choice", so the
  // model has an honest option other than picking one at random.
  var enumOrBlank = function (values) {
    return { type: "string", enum: values.concat([""]) };
  };
  var revision = revisionKeys(SECTION_IDS);

  var RESPONSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: [
      "individualsPresent", "supportActivities", "caregiverResponse",
      "progressStatus", "summary", "followup", "hints",
    ],
    properties: {
      individualsPresent: enumArray(INDIVIDUALS),
      supportActivities: enumArray(SUPPORT_ACTIVITIES),
      caregiverResponse: enumOrBlank(CAREGIVER_RESPONSES),
      progressStatus: enumOrBlank(PROGRESS_OPTIONS),
      summary: str,
      followup: str,
      // An empty array is the "note stands on its own" case, so hints is
      // required as a key even though it is routinely empty. The shape is
      // shared, so rank, kind and the whole-note section arrive here without
      // this file restating any of them.
      hints: hintSchema(HINT_CATALOG, SECTION_IDS),
      // Optional, and shared: the engine sends REVISION_RULES on every turn of
      // every tool, so a schema that omitted these would leave the model
      // unable to obey rules it is still being told to follow.
      bcbaQuestion: revision.bcbaQuestion,
      answer: revision.answer,
      crossSection: revision.crossSection,
    },
  };

  // Shared prompt core: clinical role + voice + terminology + conservative checkbox inference.
  var SYSTEM_CORE = "You are documenting a Behavior Analyst's parent/caregiver training session. The BCBA is the author documenting their own session. Write in the third person and name the actor by role, bare, with no article: \"BCBA modeled…\", \"Caregiver rehearsed….\" The author's own intake writes \"BCBA Attended\". Never \"The Behavior Analyst\" or \"the behavior analyst\": the article is the tell that a machine wrote the sentence.\n\n\
For training strategies and programming decisions, fold rationale inline - \"[caregiver skill level or observed barrier], so [approach] was selected to [functional target or generalization outcome]\" - not as a separate rationale sentence. Example: \"Caregiver prompt delivery was inconsistent, so BCBA modeled with immediate feedback to improve procedural fidelity\" - not \"Modeling was provided. Rationale: caregiver needed feedback.\"\n\n\
OUTPUT: (a) third-person clinical narratives, (b) conservative checkbox inferences for the BCBA to verify. Not polished. A real note is a little rougher than a complete account would be, and smoothing it is what makes it read as machine-written.\n\n\
THE BCBA IS ENTITLED TO THE ANALYSIS. This author is the Behavior Analyst documenting their own training session, so function, motivation and causal reasoning are their own work and belong in the note. Do not recast them into bare observations. The restraint that keeps analysis out of a note governs a technician writing a session note, not a BCBA writing this one.\n\
- So do not cut a causal claim or a clinical hypothesis out of this note, and do not flatten a ranking. Where they wrote that one function drove the behavior MORE than another, the note says the same thing in the same order, hedged to the evidence they gave and no further.\n\n\
RULES\n\
- Never invent caregiver actions, child responses, or program changes not in the notes. Sparse section → brief honest sentence.\n\
- Never assert criterion, mastery, generalization or fidelity unless the notes say so. Each of those is a determination with a threshold behind it, and \"met criterion\" or \"implemented with fidelity\" over the author's name is a measurement they did not take.\n\
- DATA IS QUOTED, NEVER PARAPHRASED. A count, a fraction, a percentage and a prompt-code string are the author's measurements. Keep the notation they wrote: 8/0 stays 8/0, never \"(8 correct)\". Prompt and stage codes (RI, M, I and the like, read against the legend they gave) are data too, so name the teaching stage the trials ran under, because the author uses it to plan the next fade. This is faithfulness and not a caveat: accuracy and independence are different measures, so never hedge, qualify or reinterpret a percentage because prompting was in place.\n\
- In this author's notation a count written as a/b (for instance 2/0) means a trials correct at or above the intended prompt level and b trials that were not.\n\
- PROMPT LEVEL GOES WITH THE COUNT. When trials were completed only with a prompt above the program's criterion, write the count with the prompt level beside it, so engagement and independence both stay true: \"completed on 2 of 3 trials, both with a physical prompt (criterion: gesture prompt)\", never \"completed on 2 of 3 trials\" alone, and never \"the other\" when the notes say the other two.\n\
- NAME EVERY GOAL. Name each goal as the notes write it, with its data line, in the summary. A goal the author adds in an answer to a follow-up question is a goal of this note like the others. Never state a count of goals (\"all three parent goals\") that the list in the notes does not support, and never claim a result for all of them when one of them says otherwise.\n\
- A parenthetical in the notes is load-bearing, not an aside. Definitions, legends, precursors and exclusions written in parentheses carry into the note. Under a sentence ceiling they are the first thing to survive, never the first thing cut.\n\
- Plain, precise clinical language - no filler, no elevated vocabulary.\n\
- \"individualsPresent\": Parent/Caregiver, Client and Technician are present by default. Leave one out only when the notes say so, for instance \"follow up when the BT is present\" or \"client was not present\". A technician the notes place in any part of the session was present. Anyone else is checked only when the notes place them in the session: someone who reported something, sent a message or asked for a meeting (a teacher reporting from school, say) is not present unless the notes say they were there. This governs the checkboxes only. The summary still names them and what they reported.\n\n\
CHECKBOX INFERENCE: For each group return ONLY verbatim values from the allowed list. Infer conservatively - only options clearly supported by the notes. Single-selects: one verbatim value or \"\".\n\
- caregiverResponse: the third option (responding, generalization occurring, no barriers) only when the notes say generalization is occurring AND name no barrier. A missed step, a missed or late prompt, prompting the caregiver needed, or any resistance means the second option, however good the rest of the data is. So does a poor client response, such as a client goal with no trial correct: it is a barrier to the caregivers generalizing the skill. The first option only for large barriers or resistance.\n\
- progressStatus: this is a parent training note, so the caregivers' goal progress weighs more than the client's goal progress. A client goal at 0 of 3 beside caregiver goals at 85 to 100 percent is Moderate progress: not Minimal, because the caregiver goals carry it, and not Substantial, because a client goal with no trial correct holds it back. Substantial only when the caregiver goals and the client goals both moved.\n\n\
BEHAVIOR ANALYST FOLLOW UP (\"followup\")\n\
- 1 to 3 items, rarely more, that the BCBA could put on a task list. Each is an action with a deliverable: what gets done, made or decided, and with whom when someone else is involved.\n\
- Draw them from the notes: an action the notes call for, a follow-up with another person the notes say needs to happen (a technician, a teacher, a caregiver), or the next step that moves a goal toward a clinical answer or toward progress.\n\
- It is almost never empty. A session with goals run and data taken always leaves a next step.\n\
- NEVER a question to the author, and never a request for more detail (\"Clarify...\", \"Specify...\", \"Confirm whether...\"). What is missing from the notes goes in hints, not here.\n\n\
TERMINOLOGY (non-negotiable)\n\
- Reinforcement is contingent on behavior. Never \"[person] was reinforced.\" Write \"[behavior] was reinforced\" or \"reinforcement was delivered contingent on [behavior]\". For caregivers, only when the notes say feedback was given: name the implementation behavior it was about, as in \"BCBA praised Caregiver for [specific implementation behavior]\". Never add feedback the notes do not report.\n\
- Precise verbs: prompted, faded, modeled, shaped, chained, redirected, blocked, provided BST, gave performance feedback.\n\
- Name procedures specifically (partial verbal prompt, errorless teaching, DRO, BST). No loose synonyms (rewarded, encouraged, motivated).\n\
- Objective, observable language. A light judgment sitting on something actually seen is not value-laden phrasing and stays as written.";

  // Additive hint instructions, the core prompt above matches the standalone page.
  var HINTS_BLOCK = "\n\nHINTS: also return a \"hints\" array of {section, code, detail} objects flagging ONLY missing or ambiguous standard elements (max 3; empty [] when the note stands on its own). section is one of: " + SECTION_IDS.join(", ") + ". code is one of: thin_section (a narrative lacks the specifics the form expects), ambiguous_item (detail = what needs clarifying, 10 words max), other (detail = the question). Never fabricate to avoid a hint.";

  var JSON_FORMAT_BLOCK = "\n\nOUTPUT FORMAT\nReturn ONLY a single JSON object. No markdown, no preamble. Use EXACTLY these keys; arrays hold verbatim option labels (empty [] if unsupported); single-selects are one verbatim label or \"\".\n{\n  \"individualsPresent\": [],\n  \"supportActivities\": [],\n  \"caregiverResponse\": \"\",\n  \"progressStatus\": \"\",\n  \"summary\": \"\",\n  \"followup\": \"\",\n  \"hints\": []\n}\nWhere \"summary\" is 3-5 clinical sentences covering goal progress and any program modifications made or needed, and \"followup\" is 1 to 3 task-list items for the Behavior Analyst, each an action with a deliverable, each on its own line separated by \\n, no bullets, no numbers, no commas between items.";

  var LABELED_FORMAT_BLOCK = "\n\nOUTPUT FORMAT\nReturn labeled sections in the exact order below. For each \"[tick]\" line, list ONLY the options that apply, comma-separated and verbatim from that section's allowed list; if none apply write \"None selected.\" For \"[choose one]\" pick exactly one allowed option (or \"None\"). For \"[narrative]\" write the prose. No JSON, no preamble, no commentary.\n\nINDIVIDUALS PRESENT [tick]\nCAREGIVER RECEIVED THE FOLLOWING SUPPORT [tick]\nCAREGIVER RESPONSE TO TRAINING [choose one]\nPROGRESS STATUS [choose one]\nSUMMARY OF GOAL PROGRESS & MODIFICATIONS [narrative: 3-5 clinical sentences]\nBEHAVIOR ANALYST FOLLOW UP [narrative: 1 to 3 task-list items, each an action with a deliverable, one per line, no bullets/numbers]";

  function buildUserPrompt(values) {
    return [
      "Session notes (primary source, expand faithfully, never fabricate):",
      (values.sessionNotes || "").trim() || "(none provided)",
      "",
      "ALLOWED CHECKBOX OPTIONS (return only verbatim values from these lists):",
      "- individualsPresent: " + menu(INDIVIDUALS),
      "- supportActivities: " + menu(SUPPORT_ACTIVITIES),
      "",
      'ALLOWED SINGLE-SELECT OPTIONS (one verbatim value, or "" if unclear):',
      "- caregiverResponse: " + menu(CAREGIVER_RESPONSES),
      "- progressStatus: " + menu(PROGRESS_OPTIONS),
    ].join("\n");
  }

  /* FOLLOW UP IS A TASK LIST, NOT A QUESTION LIST. A production parent note's
     Follow Up came back as "Clarify baseline climbing rate...", "Specify
     topography...", "Confirm whether ...": the model's own gap questions,
     written into a field the BCBA signs as their own next steps. His word for
     it was "the WORST of the whole lot". The prompt now defines the field;
     this is the backstop for a draft that ignores it. A line that opens with a
     request for information, or ends in a question mark, is moved to hints. */
  // Narrow on purpose. "Confirm onboarding date with the new technician" is a
  // real task, so only the wordings that ask the author something are caught.
  var QUESTION_LINE = /^\s*(clarify|specify|(confirm|verify|determine|check|ask|identify) (whether|if)|find out (whether|if))\b|\?\s*$/i;

  function splitFollowupQuestions(text) {
    var kept = [];
    var hints = [];
    String(text || "").split("\n").forEach(function (line) {
      if (!line.trim()) return;
      if (QUESTION_LINE.test(line)) {
        hints.push({ section: "followup", code: "ambiguous_item", detail: line.trim().split(/\s+/).slice(0, 10).join(" ") });
      } else {
        kept.push(line);
      }
    });
    return { kept: kept.join("\n"), hints: hints };
  }

  /* TWO DEFAULTS HE RULED, HELD BY CODE. Approved 2026-10-04 (Q7, "accepted").
     The prompt already states both, and his two live runs that day still
     left Technician out of 3 of 6 drafts and Caregiver Response wrong or blank
     in 3 of 8. The Follow Up check above is code and held in 8 of 8, so these
     are code too. Both only ever ADD a checkbox or fill a blank one: nothing
     here removes a person or a word the notes name. (The barrier rule below
     is the one that changes a pick, and only ever downward.)

     They run only on a real draft, where the engine passes the intake it was
     written from (ctx.intake, scrubbed, so a BT reads "[BT]"). */
  var BT = "\\[?(?:bt|rbt|technician|tech)\\]?";
  var BT_ABSENT = new RegExp(
    "\\b(?:no|without(?:\\s+(?:the|a))?)\\s+" + BT + "(?![a-z])" +
    "|" + BT + "\\s+(?:was\\s+|is\\s+)?(?:absent|not\\s+(?:present|there|in\\s+session)|out\\s+(?:today|sick)|did\\s+not\\s+attend|didn'?t\\s+attend|cancell?ed)" +
    "|when\\s+(?:the\\s+)?" + BT + "\\s+is\\s+(?:present|there|back)" +
    "|\\b(?:caregivers?|parents?|client)\\s+and\\s+(?:caregivers?|parents?|client)\\s+only\\b",
    "i");

  /* A BARRIER TO GENERALIZATION, also held by code (Kaleb, 2026-10-04, Q
     "Caregiver Response", A). The third Caregiver Response says there are no
     barriers, and his run-3 drafts still picked it beside a missed step. Two
     things in the notes are a barrier: a caregiver step missed (a Parent Goal
     count a/b with b above 0, or a caregiver who forgot, missed or was late),
     and a poor client response (a client goal with no trial correct), because
     "there are barriers to generalization to caregivers (client response)".
     Either one moves the third option down to the second, with a hint. */
  var CAREGIVER = /\b(?:caregivers?|parents?|mom|dad|mother|father|grand(?:ma|pa|mother|father|parents?)|family)\b/i;
  var MISSED_STEP = /\b(?:forg[eo]t\w*|miss(?:ed|es|ing)|late|needed\s+(?:a\s+|the\s+)?(?:reminder|prompt))\b/i;
  var NEGATED = /\b(?:not|never|no|without|n't)\s+(?:\w+\s+)?$/i;
  var COUNT = /\b(\d+)\s*\/\s*(\d+)\b/g;

  function counts(line) {
    var found = [], m;
    COUNT.lastIndex = 0;
    while ((m = COUNT.exec(line))) found.push({ done: +m[1], missed: +m[2] });
    return found;
  }

  function caregiverMissedStep(sentence) {
    if (!CAREGIVER.test(sentence)) return false;
    var m = MISSED_STEP.exec(sentence);
    return !!m && !NEGATED.test(sentence.slice(0, m.index));
  }

  function generalizationBarrier(intake) {
    var inParent = false, reason = "";
    String(intake).split(/\n/).forEach(function (line) {
      if (/\bparent goals?\s*:/i.test(line)) inParent = true;
      else if (/\b(?:client|child|skill|behavior) goals?\s*:/i.test(line)) inParent = false;
      var parentLine = inParent || /\bparent goal\b/i.test(line);
      /* A percentage on the line settles the notation. Some authors write a/b
         as correct out of total, so "5/5 100%" is a perfect caregiver, not 5
         misses: with a percentage, a miss is anything under 100 and no trial
         correct is 0. Without one, a/b is read as correct/incorrect. */
      var pct = /\b(\d{1,3})\s*%/.exec(line);
      counts(line).forEach(function (c) {
        if (reason) return;
        var missed = pct ? +pct[1] < 100 : c.missed > 0;
        var noneCorrect = pct ? +pct[1] === 0 : c.done === 0 && c.missed > 0;
        if (parentLine && missed) reason = "a caregiver step was missed (" + c.done + "/" + c.missed + " on a parent goal)";
        else if (!parentLine && noneCorrect) reason = "the client got no trial correct on a goal (" + c.done + "/" + c.missed + ")";
      });
      if (!reason && line.split(/[.!?;]\s+/).some(caregiverMissedStep)) reason = "the notes say a caregiver missed a step";
    });
    return reason;
  }

  function holdDefaults(out, intake) {
    var hints = [];
    // Technician is present unless the notes say the BT was not there.
    var present = out.individualsPresent;
    if (present.indexOf("Technician") === -1 && !BT_ABSENT.test(intake)) {
      present = INDIVIDUALS.filter(function (v) { return v === "Technician" || present.indexOf(v) !== -1; });
    }
    // A blank Caregiver Response becomes the middle option, and says so.
    var response = out.caregiverResponse;
    if (!response) {
      response = CAREGIVER_RESPONSES[1];
      hints.push({ section: "caregiverResponse", code: "thin_section", detail: "Notes say nothing on caregiver response; set to the middle option. Check it." });
    }
    // "No barriers" never stands beside a barrier the notes name.
    var barrier = response === CAREGIVER_RESPONSES[2] ? generalizationBarrier(intake) : "";
    if (barrier) {
      response = CAREGIVER_RESPONSES[1];
      hints.push({ section: "caregiverResponse", code: "other", detail: "Set to the middle option because " + barrier + ". Check it." });
    }
    return { individualsPresent: present, caregiverResponse: response, hints: hints };
  }

  function normalizeOutput(raw, ctx) {
    var o = raw && typeof raw === "object" ? raw : {};
    var out = {};
    Object.keys(GROUP_OPTIONS).forEach(function (key) {
      var opts = GROUP_OPTIONS[key];
      var isSingle = key === "caregiverResponse" || key === "progressStatus";
      if (isSingle) out[key] = opts.indexOf(o[key]) !== -1 ? o[key] : "";
      else out[key] = (Array.isArray(o[key]) ? o[key] : []).filter(function (v) { return opts.indexOf(v) !== -1; });
    });
    ["summary", "followup"].forEach(function (key) { out[key] = typeof o[key] === "string" ? o[key] : ""; });
    // A follow-up line that is a question to the author is a gap, not a task:
    // it moves to hints, where gaps belong, and never reaches the signed note.
    var moved = splitFollowupQuestions(out.followup);
    out.followup = moved.kept;
    var held = ctx && typeof ctx.intake === "string" ? holdDefaults(out, ctx.intake) : null;
    if (held) {
      out.individualsPresent = held.individualsPresent;
      out.caregiverResponse = held.caregiverResponse;
    }
    out.hints = normalizeHints((Array.isArray(o.hints) ? o.hints : []).concat(moved.hints, held ? held.hints : []), HINT_CATALOG, SECTION_IDS);
    // The three revision keys the engine reads back. Kept separate from the
    // note's own fields because they never reach the EHR: an answer is shown
    // in the panel and a routing decision is consumed before render.
    return Object.assign({}, out, normalizeRevision(o, SECTION_IDS));
  }

  window.NOTE_TOOLS.push({
    id: "parent",
    label: "Parent Training",
    title: "Parent Note Tool",
    subtitle: "Input: session notes.\nOutput: the clinical note and suggested EHR checkboxes.",
    assistantIntro: "Enter session notes, then Generate Note.\nThin input gets questions before drafting.\nClick a section, or select a phrase in it, to revise.",
    genLabel: "Generate Note",
    inputs: [
      {
        id: "sessionNotes", type: "textarea", label: "Session Notes", required: true, height: 200,
        hint: "Who was present, support provided (data, modeling, problem-solving, discussion, feedback), caregiver response, progress toward goals, follow-ups.",
        placeholder: "No PHI. Bulletpoints are OK. Examples: - Parent + client present; modeled manding, parent practiced, 70% independent - Reviewed token board setup, parent unsure of steps - Phase change needed on DTT targets - Parent to practice prompting hierarchy at home",
      },
    ],
    groupOptions: GROUP_OPTIONS,
    formSections: FORM_SECTIONS,
    hintCatalog: HINT_CATALOG,
    responseSchema: RESPONSE_SCHEMA,
    validate: function (values) {
      if (!(values.sessionNotes || "").trim()) return "Session Notes is required.";
      return null;
    },
    /* This tool's system prompt is composed inside the Worker, from the prompt
       store, and is not sent from here.

       buildSystem stays because buildLabeledPrompt below is the logged-out
       copy-prompt path, and his 2026-08-04 ruling keeps that a logged-out
       feature. So the clinical rules were always going to reach a browser that
       asked for them. What migrating buys is the other half: /api/llm-call no
       longer accepts a system prompt for parent, so a password holder can no longer
       run a prompt of their own choosing on the account's Anthropic key.

       The stored copy and this one are held together by verify-parity.mjs in
       voice-module, which composes THIS file from the deployed site and fails
       on a difference. An edit here without a matching extraction there is a
       drift CI catches, but only on the next push to that repo. */
    serverPrompt: true,
    buildSystem: function () { return SYSTEM_CORE + (window.NoteRegisterRules ? window.NoteRegisterRules.sessionNoteBcba : "") + HINTS_BLOCK + JSON_FORMAT_BLOCK; },
    buildUserPrompt: buildUserPrompt,
    buildLabeledPrompt: function (values) {
      return SYSTEM_CORE + LABELED_FORMAT_BLOCK + "\n\n---\n\n" + buildUserPrompt(values);
    },
    normalizeOutput: normalizeOutput,
  });
})();
