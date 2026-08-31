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
    { kind: "table", heading: "Goals Analyzed", fullWidth: true, key: "goalsAnalyzed", columns: [
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
    no_ioa_result: "IOA mentioned but no result, include the agreement % if it was collected",
    no_fidelity: "No IOA or procedural fidelity check noted, add one if it was run",
    no_pf: "No performance feedback or coaching noted, add what feedback was delivered, if any",
    no_review: "Nothing noted as reviewed (session notes, data sheets, written materials), add if anything was reviewed",
    no_pending_items: "No pending items or follow-ups noted, add any if they exist",
    parent_concerns_unrouted: "Caregiver concerns are mentioned but no follow-up is routed for them, confirm where they land",
    disposition_unclear: "Clarify whether this change was made in session or is still pending",
    no_goal_data: "No performance data for this goal, add counts, percentages, or trial results if collected",
    thin_behavior: "Behavior noted without topography, intensity, or frequency, add specifics for the support description",
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

  var SYSTEM_CORE = "You are documenting a Behavior Analyst's supervision session. The BCBA is the author documenting their own session. Write in third-person clinical prose: \"The Behavior Analyst reviewed…\", \"The behavior technician demonstrated….\"\n\n\
YOUR JOB: put what the BCBA entered into the permitted format while preserving clinical intent - NOT to capture everything a session could contain. Expand faithfully; NEVER fabricate activities, programs, data, staff actions, or results not in the notes. When a standard element is missing or ambiguous, say so through a hint code (below) instead of inventing or padding. Sparse input → brief honest sentences.\n\n\
For programming changes and clinical decisions, fold rationale into the decision sentence - \"[data observation or trend], so [decision] was made to [expected clinical outcome]\" - not as a separate rationale sentence. Example: \"Stalled progress data prompted a phase line addition to enable comparison before and after BST retraining\" - not \"A phase line was added. Rationale: to track BST impact.\"\n\n\
SECTION SPECIFICATIONS\n\
- goalsAnalyzed: one row per goal/program actually named or clearly identifiable in the notes (max 6; empty array if none - never pad or invent goals). \"goal\" = the short program name as the BCBA wrote it. \"progress\" = the observed performance for that goal this session, anchored to data when given (e.g. \"On two of four opportunities the client independently requested a turn - an improvement from recent trends of 0-1\"). \"nextSteps\" = the disposition with its rationale folded in (e.g. \"Placed on hold to introduce the prerequisite of waiting before responding; will be re-introduced once mastered\" or \"Continue current teaching strategies and re-assess at the next protocol modification session\").\n\
- overallProgress: EXACTLY one of the allowed strings, inferred conservatively from the progress data across goals. Mixed or unclear picture → choose the moderate option. Insufficient information → \"\".\n\
- progress (Summary of Progress and Findings): up to 10 sentences narrating the session arc - what data or trends were reviewed, which goals were focused on and why, what was observed during the session, what was modified in response to those observations, and any probes or assessments run. Anchor claims to the notes.\n\
- programming (Summary of Protocol Modifications Made/Needed): up to 5 sentences. Explicitly separate modifications MADE this session from modifications still NEEDED/pending.\n\
- behavior (Description of Behavior and Support): ONLY when behaviors of concern appear in the notes - otherwise return \"\". up to 6 sentences covering topography, intensity, and frequency; the support provided (antecedent/consequence strategies implemented); and next steps for the behavior plan.\n\
- feedback (Feedback Notes): up to 5 sentences summarizing feedback provided to staff regarding programs, performance, progress, and any error correction procedures. Fold IOA results and procedural fidelity findings into this section. NEVER use the word \"supervision\" anywhere in this section.\n\
- reviewedNotes: \"Yes\" ONLY if the notes explicitly mention reviewing last week's (or the prior period's) session notes; otherwise \"No\".\n\
- followup (Follow-Up Items): pending protocol changes not yet completed PLUS any explicit follow-up items from either notes section. One item per line separated by \\n - no bullets, no numbers.\n\
- sessionChecks: ONLY verbatim values from the allowed list, only when clearly supported (performance feedback delivered, IOA run, last week's notes reviewed, follow-up items raised). Empty array if none.\n\n\
ROUTING RULE - when the BCBA notes a skill is flagging or needs revision:\n\
- revision described as done in-session → programming (as a modification MADE)\n\
- revision described as pending → programming (as a modification NEEDED) AND followup\n\
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
- other (any section): something else genuinely unclear - put the question in detail\n\
Codes marked \"technician present\" fire only when a BT/RBT attended. Hints are advisory nudges, not demands - do not hint when the BCBA plainly had nothing to report for that element.\n\n\
TERMINOLOGY (non-negotiable)\n\
- Reinforcement is contingent on behavior. Never write that a person \"was reinforced.\" Write \"[behavior] was reinforced\" or \"reinforcement was delivered contingent on [behavior].\" For staff: \"performance feedback was delivered,\" \"the BT contacted reinforcement for [specific behavior].\"\n\
- Precise verbs: prompted, faded, modeled, shaped, chained, redirected, blocked, delivered/withheld reinforcement, presented the SD, provided BST, gave performance feedback, conducted IOA.\n\
- Name prompt types and procedures specifically. No loose synonyms (rewarded, encouraged, motivated).\n\
- Objective, observable language. Cut staff opinion, causal claims and clinical hypotheses. A light judgment sitting on something actually seen is not value-laden phrasing and stays as written.";

  var JSON_FORMAT_BLOCK = "\n\nOUTPUT FORMAT\nReturn ONLY a single JSON object. No markdown, no preamble. Use EXACTLY these keys. \"sessionChecks\" holds verbatim option labels (empty [] if none); \"goalsAnalyzed\" is an array of row objects (empty [] if no goals identifiable); \"overallProgress\" and \"reviewedNotes\" are one verbatim allowed value or \"\"; narratives are strings per the section specifications; \"hints\" is the hint array (empty [] if none).\n{\n  \"sessionChecks\": [],\n  \"goalsAnalyzed\": [{ \"goal\": \"\", \"progress\": \"\", \"nextSteps\": \"\" }],\n  \"overallProgress\": \"\",\n  \"progress\": \"\",\n  \"programming\": \"\",\n  \"behavior\": \"\",\n  \"feedback\": \"\",\n  \"reviewedNotes\": \"\",\n  \"followup\": \"\",\n  \"hints\": [{ \"section\": \"\", \"code\": \"\", \"detail\": \"\" }]\n}";

  var LABELED_FORMAT_BLOCK = "\n\nOUTPUT FORMAT\nReturn labeled sections in the exact order below. For \"[tick]\" lines, list ONLY the values that apply, comma-separated and verbatim from the allowed list; if none apply write \"None selected.\" For \"[choose one]\" pick exactly one allowed value (or \"None\"). For GOALS ANALYZED write one block per goal: \"Goal: …\" / \"Progress: …\" / \"Next Steps: …\" on separate lines (or \"None identified\"). For each \"[narrative]\" follow the section specification. Do NOT output hints. No JSON, no preamble, no commentary.\n\nSESSION CHECKS COMPLETED [tick]\nGOALS ANALYZED [table]\nOVERALL CLIENT PROGRESS [choose one]\nSUMMARY OF PROGRESS AND FINDINGS [narrative]\nSUMMARY OF PROTOCOL MODIFICATIONS MADE/NEEDED [narrative]\nDESCRIPTION OF BEHAVIOR AND SUPPORT [narrative, omit if no behaviors of concern]\nFEEDBACK NOTES [narrative]\nBCBA REVIEWED ALL SESSION NOTES FOR LAST WEEK [choose one: Yes | No]\nFOLLOW-UP ITEMS [one per line]";

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
    ].join("\n");
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
    subtitle: "Two focused inputs, clinical observations and staff feedback, drafted into your EHR supervision form's fields, with AI revision help after the first pass.",
    assistantIntro: "Enter your clinical observations and staff feedback, then press Generate Note. I'll ask about anything that looks thin before drafting, then you can click any section, or select a phrase inside one, to revise it.",
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
        hint: "Client skill progress and goal data, behavior observations, protocol changes made or still needed, probe/baseline/generalization findings. Name the goals you analyzed, each becomes a row in the Goals Analyzed table.",
        placeholder: "No PHI. Bullets are fine, e.g.:\n- 3-step motor imitation: initiating before full SD most of observation, minimal progress, placed on hold, teaching wait-before-responding first\n- FCT \"my turn\" with peers: independent 2 of 4 opportunities, up from 0-1\n- Reviewed data trends; expressive/receptive goals variable since last protocol mod\n- Elopement x2, blocked, no escalation\n- Updated PECS lesson plan to contrive more opportunities (done today)",
      },
      {
        id: "staffNotes", type: "textarea", label: "Staff Feedback, Training & Fidelity", height: 150,
        hint: "Feedback given to staff, skills trained or modeled, anything reviewed (last week's notes, data sheets, written materials), IOA or procedural fidelity checks and their results, caregiver concerns raised.",
        placeholder: "No PHI. e.g.:\n- Observed RBT run teaching strategies; gave feedback on assent-withdrawal signs\n- BST on the new prompting procedure after the change\n- Ran IOA on tact data - 92% agreement\n- Reviewed last week's session notes\n- Parent asked about morning routine, follow up Thursday",
      },
    ],
    groupOptions: GROUP_OPTIONS,
    formSections: FORM_SECTIONS,
    hintCatalog: HINT_CATALOG,
    responseSchema: RESPONSE_SCHEMA,
    validate: function (values) {
      if (!(values.clinicalNotes || "").trim()) return "Please enter Session Notes / Clinical Observations.";
      if (values.btPresent === null || values.btPresent === undefined) return "Please indicate whether a BT/RBT was present.";
      return null;
    },
    // Old single-textarea drafts carry over into the clinical notes box.
    migrateDraft: function (saved) {
      if (saved && saved.notes && !saved.clinicalNotes) {
        return { btPresent: saved.btPresent, clinicalNotes: saved.notes, staffNotes: saved.staffNotes || "" };
      }
      return saved;
    },
    /* This tool's system prompt is composed inside the Worker, from the prompt
       store, and is not sent from here. buildSystem stays for now because the
       copy-prompt path below still uses SYSTEM_CORE, and because
       scripts/verify-parity.mjs in the prompt repo composes it to prove the two
       copies have not drifted. Both go when the last tool migrates. */
    serverPrompt: true,
    buildSystem: function () { return SYSTEM_CORE + (window.NoteRegisterRules ? window.NoteRegisterRules.sessionNote : "") + JSON_FORMAT_BLOCK; },
    buildUserPrompt: buildUserPrompt,
    buildLabeledPrompt: function (values) {
      return SYSTEM_CORE + LABELED_FORMAT_BLOCK + "\n\n---\n\n" + buildUserPrompt(values);
    },
    normalizeOutput: normalizeOutput,
  });
})();
