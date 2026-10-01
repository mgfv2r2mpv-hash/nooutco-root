/* Supervision note tool config. Two focused inputs (clinical observations vs.
 * staff feedback/fidelity) mapped onto the EHR supervision form's fields,
 * including the Goals Analyzed table. Registered on window.NOTE_TOOLS; the
 * shared engine (../engine.jsx) renders it and runs the conversation loop. */
(function () {
  var menu = window.NoteToolsUtil.menu;
  var normalizeHints = window.NoteToolsUtil.normalizeHints;
  var normalizeRevision = window.NoteToolsUtil.normalizeRevision;
  var hintSchema = window.NoteToolsUtil.hintSchema;
  var revisionKeys = window.NoteToolsUtil.revisionKeys;

  // Canonical session-check options the AI may infer from the notes.
  var SESSION_CHECKS = ["Performance Feedback (PF)", "IOA check", "Reviewed last week's notes", "Follow-up items"];

  // Exact EHR checkbox strings - the model must return one verbatim or "".
  var PROGRESS_LEVELS = [
    "Client is making steady, substantial progress towards meeting goals (see summary below)",
    "Client is making moderate progress towards meeting goals (see summary below)",
    "Client is making minimal progress towards goals and/or is demonstrating barriers (see summary below)",
  ];
  var YES_NO = ["Yes", "No"];

  var GROUP_OPTIONS = {
    sessionChecks: SESSION_CHECKS,
    overallProgress: PROGRESS_LEVELS,
    reviewedNotes: YES_NO,
  };

  // Output render config - mirrors the EHR form top-to-bottom.
  var FORM_SECTIONS = [
    // His layout, 2026-08-04: Goals Analyzed is the wide one and leads, with
    // the two short cards side by side underneath it rather than above.
    // checkAgainstIntake: each goal name is compared with the intake, and one
    // the BCBA never wrote is flagged on its row (goal-names.js, 2026-10-02).
    { kind: "table", heading: "Goals Analyzed", fullWidth: true, key: "goalsAnalyzed", checkAgainstIntake: "goal", columns: [
      { id: "goal", label: "Goal" },
      { id: "progress", label: "Progress" },
      { id: "nextSteps", label: "Next Steps" },
    ] },
    { kind: "checklist", heading: "Session Checks Completed", group: "sessionChecks" },
    { kind: "single", heading: "Overall Client Progress", group: "overallProgress" },
    { kind: "narrative", heading: "Summary of Progress and Findings", key: "progress", minHeight: 130 },
    { kind: "narrative", heading: "Summary of Protocol Modifications Made/Needed", key: "programming", minHeight: 100 },
    { kind: "narrative", heading: "Description of Behavior and Support", key: "behavior", minHeight: 90,
      emptyNote: "(empty, no behaviors of concern documented)" },
    { kind: "narrative", heading: "Feedback Notes", key: "feedback", minHeight: 100 },
    // One yes or no. Full width and on a single band, rather than a tall
    // half-card carrying three lines of explanation for a two-letter answer.
    { kind: "single", heading: "BCBA Reviewed All Session Notes for Last Week", group: "reviewedNotes", fullWidth: true, compact: true },
    { kind: "narrative", heading: "Follow-Up Items", key: "followup", minHeight: 80 },
  ];

  /* FORM_SECTIONS order, exactly. These two held the same nine ids in a
     different order (his 2026-08-04 layout moved Goals Analyzed to lead, and
     this list was not moved with it), which cost nothing while the list stayed
     private. The schema publishes it as an enum now, and "a tool agrees with
     itself about its own sections" is a claim the bench suite makes for every
     tool carrying both. Order has no other effect: normalizeHints matches by
     indexOf and the enum is a set. */
  var SECTION_IDS = ["goalsAnalyzed", "sessionChecks", "overallProgress", "progress", "programming", "behavior", "feedback", "reviewedNotes", "followup"];

  // Canonical hint wording lives HERE, client-side; the model returns only the
  // code (+ optional short detail). Consistent phrasing, nothing fabricated.
  var HINT_CATALOG = {
    no_ioa_result: "IOA mentioned without a result (agreement %)",
    no_fidelity: "No IOA or procedural fidelity check noted",
    no_pf: "No performance feedback or coaching noted",
    no_review: "Nothing noted as reviewed (session notes, data sheets, written materials)",
    no_pending_items: "No pending items or follow-ups noted",
    parent_concerns_unrouted: "Caregiver concerns mentioned without a follow-up",
    disposition_unclear: "Clarify whether this change was made in session or is still pending",
    no_goal_data: "No performance data for this goal (counts, percentages or trial results)",
    thin_behavior: "Behavior noted without topography, intensity or frequency",
    /* Same gap bt had. The shared register rules tell every session tool to
       emit this code for an opinion with no observation and for a feeling with
       nothing attached, and `code` is an enum built from this object, so the
       instruction was unobeyable here. This tool's own prompt also enumerates
       the codes under "code MUST be from this list", so the line there moves
       with this entry: a catalog that accepts a code the prompt forbids is the
       same defect pointing the other way. */
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
      "sessionChecks", "goalsAnalyzed", "overallProgress", "progress",
      "programming", "behavior", "feedback", "reviewedNotes", "followup", "hints",
    ],
    properties: {
      sessionChecks: enumArray(SESSION_CHECKS),
      // One row per goal actually named in the notes. The cap of six lives in
      // the prompt and in normalizeOutput; a schema maxItems would turn a
      // seventh goal into a refusal rather than into a trimmed table.
      goalsAnalyzed: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["goal", "progress", "nextSteps"],
          properties: { goal: str, progress: str, nextSteps: str },
        },
      },
      overallProgress: enumOrBlank(PROGRESS_LEVELS),
      progress: str,
      programming: str,
      // "" when the notes carry no behaviours of concern, which the renderer
      // draws as its empty note rather than as a missing section.
      behavior: str,
      feedback: str,
      reviewedNotes: enumOrBlank(YES_NO),
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

  /* ONE OWNER PER FACET, approved 2026-10-02 from a production note that said
     the same facts in several sections. The specs overlapped, a whole nextSteps
     example sentence was copied verbatim into rows it did not fit, and the
     ROUTING RULE sent a pending change to programming AND followup. His nuance:
     "a fact may have more than one facet", so each section owns a facet rather
     than a fact (sup-one-owner-per-facet.spec.js). The live model reads this
     text from the voice-module prompt store; re-extract it there after a change.
     The sup tuning rules (sentence budgets, the goal-row rule, verbatim goal
     names, qualitative goal progress, the BT-toggle rule and the quotes rule)
     sit beside it. Where the two met, the facet rule stands: no stock nextSteps
     wording, followup carries only the next action, and the one-section rule
     names facets, not facts (sup-prompt-rules.spec.js). */
  var SYSTEM_CORE = "You are documenting a Behavior Analyst's supervision session. The BCBA is the author documenting their own session. Write in third-person clinical prose and name the BCBA by role, bare, with no article: \"BCBA reviewed…\", \"The behavior technician demonstrated….\" Never \"The Behavior Analyst\" or \"the behavior analyst\": the article is the tell that a machine wrote the sentence.\n\n\
YOUR JOB: put what the BCBA entered into the permitted format while preserving clinical intent - NOT to capture everything a session could contain. Expand faithfully; NEVER fabricate activities, programs, data, staff actions, or results not in the notes. When a standard element is missing or ambiguous, say so through a hint code (below) instead of inventing or padding. Sparse input → brief honest sentences.\n\n\
For programming changes and clinical decisions, fold rationale into the decision sentence - \"[data observation or trend], so [decision] was made to [expected clinical outcome]\" - not as a separate rationale sentence. Example: \"Stalled progress data prompted a phase line addition to enable comparison before and after BST retraining\" - not \"A phase line was added. Rationale: to track BST impact.\"\n\n\
SECTION SPECIFICATIONS\n\
ONE OWNER PER FACET. A fact can have more than one facet, and each section below owns one facet. Write each section's own facet and nothing else, and never restate a fact in the same terms in a second section. A section may still cover a DIFFERENT facet of a fact that another section covers. A protocol change is the usual case: programming says what changes, and followup says who does what next. When two sections would say the same thing in the same words, keep it in the section that owns it and cut it from the other.\n\
- goalsAnalyzed (owns each goal's data and its disposition): one row per goal/program per WHAT IS A GOAL ROW (max 6 skill rows; a reduction target always gets its row on top of that; empty array if none - never pad or invent goals). \"goal\" = the program name copied verbatim from the bullet (see GOAL NAMES). \"progress\" = how the skill went over the session, per GOAL PROGRESS IS QUALITATIVE, 2 sentences at most. \"nextSteps\" = what happens to that goal next (continue, modify, hold, mastered or discontinued) with the reason from that goal's own data folded in, in the BCBA's terms, 1 sentence. There is no stock wording for it. Write it from what the notes say about that goal, so two goals with the same disposition still read differently because their reasons differ.\n\
- overallProgress: EXACTLY one of the allowed strings, inferred conservatively from the progress data across goals. Mixed or unclear picture → choose the moderate option. Insufficient information → \"\".\n\
- progress (Summary of Progress and Findings; owns the session arc): sized by SENTENCE BUDGETS, on what data or trends were reviewed, which goals were the focus and why, what was observed that the goal rows do not carry, and any probes or assessments run. Each goal's figures and disposition are already in goalsAnalyzed: name the goal and say what its data meant for the session, without repeating the row. A protocol change belongs to programming: say what observation led to it, and leave the change itself to programming. Anchor claims to the notes.\n\
- programming (Summary of Protocol Modifications Made/Needed; owns what changes in the protocol): 4 sentences, never above 6. Explicitly separate modifications MADE this session from modifications still NEEDED/pending. Each change is stated here once, with its data reason folded into the sentence, and this includes a change to a behavior plan.\n\
- behavior (Description of Behavior and Support; owns the behavior and the response to it): ONLY when a reduction target is listed or a behavior of concern occurred - otherwise return \"\", and never invent a behavior. 4 sentences, never above 6, covering topography, intensity, and frequency, and the support provided (antecedent/consequence strategies implemented). A change to the behavior plan is a protocol change: programming states it, and this section does not.\n\
- feedback (Feedback Notes; owns what staff were told and how they performed): 4 sentences, never above 6, summarizing feedback provided to staff regarding programs, performance, progress, and any error correction procedures. Fold IOA results and procedural fidelity findings into this section. NEVER use the word \"supervision\" anywhere in this section.\n\
- reviewedNotes: \"Yes\" ONLY if the notes explicitly mention reviewing last week's (or the prior period's) session notes; otherwise \"No\".\n\
- followup (Follow-Up Items; owns who does what next): one action per line, saying who does what next, and when if the notes say. Explicit follow-up items from either notes section go here. A pending protocol change appears here only as the next action toward it, for example who updates the plan, trains staff or re-checks the data, and never as the change described again in programming's terms. One item per line separated by \\n - no bullets, no numbers.\n\
- sessionChecks: ONLY verbatim values from the allowed list, only when clearly supported (performance feedback delivered, IOA run, last week's notes reviewed, follow-up items raised). Empty array if none.\n\n\
SENTENCE BUDGETS. How much each section says.\n\
- Summary of Progress and Findings: 4 to 6 sentences at two goals or fewer, plus 2 for each goal beyond two.\n\
- Summary of Protocol Modifications, Description of Behavior and Support, and Feedback Notes: 4 sentences each, never above 6.\n\
- Goals Analyzed rows: Progress is 2 sentences, Next Steps is 1 sentence.\n\
Never pad to reach the floor: a section with little to say stays short, and a short honest section is correct output.\n\
Floor override: every goal bulleted as a reduction goal gets at least one sentence in the Description of Behavior and Support section, not in the skills narrative. If reduction goals alone exceed the Behavior ceiling, the floor wins and the draft says so in one clause.\n\n\
WHAT IS A GOAL ROW. An item is a goal row when it is bulleted with data, or when a bullet or label describes it as behavior targeted for reduction, behavior of concern, behavior goal, maladaptive behavior, challenging behavior, or interfering behavior. A reduction target gets its row even at zero occurrences. Incidental teaching, natural teaching, skill probes, and anything told as a story with no program name and no data are NOT goal rows: put them in the Summary of Progress narrative in a sentence or two.\n\n\
GOAL NAMES. Copy each goal name verbatim from the bullet: no renaming, no merging, order kept. That includes apostrophes, quotation marks, slashes and dashes inside the name (for example Tolerate 'No' or Alternative to Denied Item/Activity), which are copied character for character. A goal name is the one place single quotes stay as the BCBA wrote them.\n\n\
GOAL PROGRESS IS QUALITATIVE. The EHR already stores the counts and percentages, so a goal row does not restate them. No counts, no percentages, and no raw prompt-code strings in a goal row, unless one number is the only way to say it. Say how the skill went over the session: whether prompting reduced, whether the errors fell into a pattern, whether prompting went back to a more intrusive level for the rest of the session. Read Raw Data(Correct/Incorrect) as correct then incorrect, so 5/3 is 5 correct and 3 incorrect. Do not assume a rule such as \"two errors in a row, then a more intrusive prompt\", because it varies by skill, child and clinician. Say a prompt level went back up only when the sequence shows it. Give a reason only when the notes give one. Do not guess what a code the notes never explain means (for example - or F2): say nothing about it and emit an ambiguous_item hint naming the code.\n\n\
ONE FACET, ONE SECTION. Each of these facets is written in the section that owns it and nowhere else.\n\
- The occurrence or non-occurrence of each reduction target, any behavior event and how it was handled, and the antecedent supports that prevented it: Behavior section only. It is written whenever a reduction target is listed, including at zero occurrences.\n\
- Caregiver or staff observed, practiced, was coached, or implemented a strategy: Feedback Notes only.\n\
- Progress states neither.\n\
Antecedent strategies go in Behavior, not Protocol Modifications, unless the strategy itself changed. A facet repeated in a second section is a defect.\n\n\
NEVER STATE A FACT THE NOTES DO NOT STATE. When the BT-present toggle disagrees with the notes, do not assert BT presence either way: not when the toggle says No and the notes say a BT was present, and not when the toggle says Yes and the notes say only the BCBA was there. Emit an ambiguous_item hint on feedback naming the disagreement.\n\n\
QUOTES. A spoken line and any scare quote uses double quotes, never single. Escape each one as \\\" so the JSON stays valid. An apostrophe inside a spoken line (don't) stays as it is. A quote inside a quote takes single quotes on the inner one only.\n\n\
ROUTING RULE - when the BCBA notes a skill is flagging or needs revision:\n\
- revision described as done in-session → programming (as a modification MADE)\n\
- revision described as pending → programming (as a modification NEEDED). followup takes only who does what next to get it done, in its own terms, and never the change restated\n\
- disposition not stated → place in programming as NEEDED and emit hint code disposition_unclear for programming with the goal name as detail\n\n\
HINTS - return an array of {section, code, detail} objects flagging ONLY missing or ambiguous standard elements (max 4; empty array when the note stands on its own). \"section\" is one of the JSON keys; \"code\" MUST be from this list; \"detail\" is an optional specifier of 10 words or fewer:\n\
- no_ioa_result (feedback): IOA/fidelity check mentioned but no result given\n\
- no_fidelity (feedback): technician present but no IOA or fidelity check mentioned at all\n\
- no_pf (feedback): technician present but no performance feedback or coaching mentioned\n\
- no_review (feedback): technician present but nothing mentioned as reviewed\n\
- no_pending_items (followup): nothing pending and no follow-ups mentioned anywhere\n\
- parent_concerns_unrouted (followup): caregiver/parent concerns mentioned but no follow-up action for them\n\
- disposition_unclear (programming): a flagged skill's change isn't stated as done vs. pending - detail = the goal name\n\
- no_goal_data (goalsAnalyzed): a goal is discussed with no counts/percentages/trial data - detail = the goal name\n\
- thin_behavior (behavior): behavior of concern mentioned without topography/intensity/frequency\n\
- ambiguous_item (any section): something in the note needs clarifying before it is signed, including an unexplained prompt code or a BT-present toggle that disagrees with the notes - put what, in detail\n\
- other (any section): something else genuinely unclear - put the question in detail\n\
Codes marked \"technician present\" fire only when a BT/RBT attended. Hints are advisory nudges, not demands - do not hint when the BCBA plainly had nothing to report for that element.\n\
\n\
TERMINOLOGY (non-negotiable)\n\
- Reinforcement is contingent on behavior. Never write that a person \"was reinforced.\" Write \"[behavior] was reinforced\" or \"reinforcement was delivered contingent on [behavior].\" For staff: \"performance feedback was delivered,\" \"the BT contacted reinforcement for [specific behavior].\"\n\
- Precise verbs: prompted, faded, modeled, shaped, chained, redirected, blocked, delivered/withheld reinforcement, presented the SD, provided BST, gave performance feedback, conducted IOA.\n\
- Name prompt types and procedures specifically. No loose synonyms (rewarded, encouraged, motivated).\n\
- Objective, observable language. A light judgment sitting on something actually seen is not value-laden phrasing and stays as written.";

  var JSON_FORMAT_BLOCK = "\n\nOUTPUT FORMAT\nReturn ONLY a single JSON object. No markdown, no preamble. Use EXACTLY these keys. \"sessionChecks\" holds verbatim option labels (empty [] if none); \"goalsAnalyzed\" is an array of row objects (empty [] if no goals identifiable); \"overallProgress\" and \"reviewedNotes\" are one verbatim allowed value or \"\"; narratives are strings per the section specifications; \"hints\" is the hint array (empty [] if none).\n{\n  \"sessionChecks\": [],\n  \"goalsAnalyzed\": [{ \"goal\": \"\", \"progress\": \"\", \"nextSteps\": \"\" }],\n  \"overallProgress\": \"\",\n  \"progress\": \"\",\n  \"programming\": \"\",\n  \"behavior\": \"\",\n  \"feedback\": \"\",\n  \"reviewedNotes\": \"\",\n  \"followup\": \"\",\n  \"hints\": [{ \"section\": \"\", \"code\": \"\", \"detail\": \"\" }]\n}";

  var LABELED_FORMAT_BLOCK = "\n\nOUTPUT FORMAT\nReturn labeled sections in the exact order below. For \"[tick]\" lines, list ONLY the values that apply, comma-separated and verbatim from the allowed list; if none apply write \"None selected.\" For \"[choose one]\" pick exactly one allowed value (or \"None\"). For GOALS ANALYZED write one block per goal: \"Goal: …\" / \"Progress: …\" / \"Next Steps: …\" on separate lines (or \"None identified\"). For each \"[narrative]\" follow the section specification. Do NOT output hints. No JSON, no preamble, no commentary.\n\nSESSION CHECKS COMPLETED [tick]\nGOALS ANALYZED [table]\nOVERALL CLIENT PROGRESS [choose one]\nSUMMARY OF PROGRESS AND FINDINGS [narrative]\nSUMMARY OF PROTOCOL MODIFICATIONS MADE/NEEDED [narrative]\nDESCRIPTION OF BEHAVIOR AND SUPPORT [narrative, omit if no behaviors of concern]\nFEEDBACK NOTES [narrative]\nBCBA REVIEWED ALL SESSION NOTES FOR LAST WEEK [choose one: Yes | No]\nFOLLOW-UP ITEMS [one per line]";

  // The goal picker's choices, as plain names. Anything that is not a non-empty
  // string is dropped, so a hand-edited draft cannot put an object in the prompt.
  function cleanGoalNames(list) {
    return (Array.isArray(list) ? list : []).filter(function (n) { return typeof n === "string" && n.trim() !== ""; });
  }

  function describeRow(row) {
    var counts = row.correct === null ? "no counts" : row.correct + " correct, " + row.incorrect + " incorrect";
    var parts = [row.program, row.target, counts];
    if (row.sequence.length) parts.push("sequence: " + row.sequence.join(" "));
    if (row.mismatch) parts.push("stated percent disagrees with the counts; the counts stand");
    if (row.unexplained.length) parts.push("unexplained codes: " + row.unexplained.join(", "));
    return parts.join(" | ");
  }

  // Goal names the technician chose, then the data rows the notes carry in
  // bracket form, parsed so the model reads the trial sequence as a sequence.
  // Both are reference: a goal row still never restates counts or a percent.
  function goalBlocks(values) {
    var blocks = [];
    var chosen = cleanGoalNames(values.chosenGoals);
    if (chosen.length) {
      blocks.push([
        "CHOSEN GOALS (one Goals Analyzed row each, names exactly as written here, in this order):",
        chosen.map(function (n, i) { return (i + 1) + ". " + n; }).join("\n"),
        "",
      ].join("\n"));
    }
    var rows = window.GoalCandidates ? window.GoalCandidates.parseRows(values.clinicalNotes) : [];
    if (rows.length) {
      blocks.push([
        "PARSED DATA ROWS (for reading the session only; do not restate counts or percents in a goal row):",
        rows.map(describeRow).join("\n"),
        "",
      ].join("\n"));
    }
    return blocks;
  }

  function buildUserPrompt(values) {
    var btPresent = values.btPresent;
    return [
      "BT/RBT present during session: " + (btPresent ? "Yes" : "No"),
      "",
      "CLINICAL OBSERVATIONS, client skill progress, goal data, behavior observations, protocol changes made or still needed, probe/baseline/generalization findings (primary source, expand faithfully, never fabricate):",
      (values.clinicalNotes || "").trim() || "(none provided)",
      "",
      "STAFF FEEDBACK, TRAINING & FIDELITY, feedback given to staff, skills trained or modeled, anything reviewed, IOA/procedural fidelity checks and results:",
      (values.staffNotes || "").trim() || "(none provided)",
      "",
    ].concat(goalBlocks(values), [
      "ALLOWED VALUES (return only verbatim strings from these lists):",
      "- sessionChecks: " + menu(SESSION_CHECKS),
      "- overallProgress: " + menu(PROGRESS_LEVELS),
      "- reviewedNotes: " + menu(YES_NO),
      "",
      "SOURCE MAPPING",
      "- goalsAnalyzed, overallProgress, progress, programming, behavior ← CLINICAL OBSERVATIONS",
      "- feedback, reviewedNotes ← STAFF FEEDBACK, TRAINING & FIDELITY",
      "- followup ← both (pending protocol changes + explicit follow-up items)",
      "",
      "Feedback section framing: " + (btPresent
        ? "Feedback provided to direct service staff (BT/RBT) regarding implementation, skill acquisition targets, or behavior intervention."
        : "No technician was present. Describe Behavior Analyst-only activities: what was run, evaluated, modeled, or explained. Begin with: 'No technician was present; Behavior Analyst performed…'. Staff-related hint codes do not apply."),
    ]).join("\n");
  }

  function normalizeOutput(raw) {
    var o = raw && typeof raw === "object" ? raw : {};
    var out = {};
    out.sessionChecks = (Array.isArray(o.sessionChecks) ? o.sessionChecks : []).filter(function (v) { return SESSION_CHECKS.indexOf(v) !== -1; });
    out.goalsAnalyzed = (Array.isArray(o.goalsAnalyzed) ? o.goalsAnalyzed : [])
      .map(function (r) {
        r = r && typeof r === "object" ? r : {};
        return {
          goal: typeof r.goal === "string" ? r.goal : "",
          progress: typeof r.progress === "string" ? r.progress : "",
          nextSteps: typeof r.nextSteps === "string" ? r.nextSteps : "",
        };
      })
      .filter(function (r) { return (r.goal + r.progress + r.nextSteps).trim() !== ""; })
      .slice(0, 6);
    out.overallProgress = PROGRESS_LEVELS.indexOf(o.overallProgress) !== -1 ? o.overallProgress : "";
    out.reviewedNotes = YES_NO.indexOf(o.reviewedNotes) !== -1 ? o.reviewedNotes : "";
    ["progress", "programming", "behavior", "feedback", "followup"].forEach(function (k) {
      out[k] = typeof o[k] === "string" ? o[k] : "";
    });
    out.hints = normalizeHints(o.hints, HINT_CATALOG, SECTION_IDS);
    // The three revision keys the engine reads back. Kept separate from the
    // note's own fields because they never reach the EHR: an answer is shown
    // in the panel and a routing decision is consumed before render.
    return Object.assign({}, out, normalizeRevision(o, SECTION_IDS));
  }

  window.NOTE_TOOLS.push({
    id: "sup",
    label: "Supervision",
    title: "Supervision Note Tool",
    subtitle: "Inputs: clinical observations and staff feedback.\nOutput: the EHR supervision form fields.\nRevisions available after the first draft.",
    assistantIntro: "Enter clinical observations and staff feedback, then Generate Note.\nThin input gets questions before drafting.\nClick a section, or select a phrase in it, to revise.",
    genLabel: "Generate Note",
    // The widest output of any tool here: up to 6 goal rows of three prose fields
    // each, five narratives, follow-ups, and hints - and every revision turn
    // re-emits the whole object, so the cap has to cover a full note, not a diff.
    // 4500 sat close enough to a dense session's output that a long note could be
    // truncated mid-JSON, which surfaced to the clinician as a parse error.
    // Well under both the non-streaming ceiling (~16k) and the model's own (64k
    // for Haiku 4.5); the real bound is GEN_TIMEOUT_MS in notes-gate.js, raised
    // alongside this - a cap the request can't reach before the client aborts
    // just trades a truncated note for a timed-out one.
    maxTokens: 8000,
    inputs: [
      {
        id: "btPresent", type: "toggle", label: "BT / RBT Present?",
        options: [
          { value: true, label: "Yes" },
          { value: false, label: "No, Behavior Analyst only" },
        ],
      },
      {
        id: "clinicalNotes", type: "textarea", label: "Session Notes / Clinical Observations", required: true, height: 190,
        hint: "Client skill progress and goal data, behavior observations, protocol changes made or still needed, probe/baseline/generalization findings.\nEach named goal becomes a row in Goals Analyzed.",
        placeholder: "No PHI.\nBullets OK. Examples:\n- 3-step motor imitation: initiating before full SD most of observation, minimal progress, placed on hold, teaching wait-before-responding first\n- FCT \"my turn\" with peers: independent 2 of 4 opportunities, up from 0-1\n- Reviewed data trends; expressive/receptive goals variable since last protocol mod\n- Elopement x2, blocked, no escalation\n- Updated PECS lesson plan to contrive more opportunities (done today)",
      },
      {
        id: "staffNotes", type: "textarea", label: "Staff Feedback, Training & Fidelity", height: 150,
        hint: "Feedback given to staff, skills trained or modeled, anything reviewed (last week's notes, data sheets, written materials), IOA or procedural fidelity checks and their results, caregiver concerns raised.",
        placeholder: "No PHI.\nExamples:\n- Observed RBT run teaching strategies; gave feedback on assent-withdrawal signs\n- BST on the new prompting procedure after the change\n- Ran IOA on tact data - 92% agreement\n- Reviewed last week's session notes\n- Parent asked about morning routine, follow up Thursday",
      },
    ],
    groupOptions: GROUP_OPTIONS,
    formSections: FORM_SECTIONS,
    // The narrative sections the repeat check compares, in note order.
    repeatSections: ["progress", "programming", "behavior", "feedback"],
    hintCatalog: HINT_CATALOG,
    responseSchema: RESPONSE_SCHEMA,
    validate: function (values) {
      if (!(values.clinicalNotes || "").trim()) return "Session Notes / Clinical Observations is required.";
      if (values.btPresent === null || values.btPresent === undefined) return "BT / RBT Present is required.";
      return null;
    },
    // Old single-textarea drafts carry over into the clinical notes box. Every
    // draft leaves with a chosenGoals list, the picker's choices, empty when the
    // technician has not picked.
    migrateDraft: function (saved) {
      if (!saved) return saved;
      var base = saved.notes && !saved.clinicalNotes
        ? { btPresent: saved.btPresent, clinicalNotes: saved.notes, staffNotes: saved.staffNotes || "" }
        : saved;
      return Object.assign({}, base, { chosenGoals: cleanGoalNames(saved.chosenGoals) });
    },
    /* This tool's system prompt is composed inside the Worker, from the prompt
       store, and is not sent from here. buildSystem stays for now because the
       copy-prompt path below still uses SYSTEM_CORE, and because
       scripts/verify-parity.mjs in the prompt repo composes it to prove the two
       copies have not drifted. Both go when the last tool migrates. */
    serverPrompt: true,
    buildSystem: function () { return SYSTEM_CORE + (window.NoteRegisterRules ? window.NoteRegisterRules.sessionNoteBcba : "") + JSON_FORMAT_BLOCK; },
    buildUserPrompt: buildUserPrompt,
    buildLabeledPrompt: function (values) {
      return SYSTEM_CORE + LABELED_FORMAT_BLOCK + "\n\n---\n\n" + buildUserPrompt(values);
    },
    normalizeOutput: normalizeOutput,
  });
})();
