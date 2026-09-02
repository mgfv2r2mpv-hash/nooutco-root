/* Assessment note tool config - ported from /notes/assess/ with prompts intact,
 * plus the shared engine's revision loop and a starter (generic) hint catalog. */
(function () {
  var menu = window.NoteToolsUtil.menu;
  var normalizeHints = window.NoteToolsUtil.normalizeHints;
  var normalizeRevision = window.NoteToolsUtil.normalizeRevision;
  var hintSchema = window.NoteToolsUtil.hintSchema;
  var revisionKeys = window.NoteToolsUtil.revisionKeys;

  // Canonical option lists - both the menu the AI may choose from and the
  // strings the output checklist renders. They match the EHR form.
  var ACTIVITIES = [
    "Administration of assessment tool",
    "Caregiver/Guardian interview",
    "Functional Behavior Assessment",
    "Functional Analysis",
    "Client Observation",
    "Review results with parent",
  ];

  var REPORTING = [
    "Medical Record Review",
    "Analysis of past data",
    "Assessment Scoring / Interpretation of results",
    "Treatment plan / goal development",
    "Report Review and Edits",
  ];

  var GROUP_OPTIONS = { activities: ACTIVITIES, reporting: REPORTING };

  var FORM_SECTIONS = [
    { kind: "checklist", heading: "Activities Performed", group: "activities" },
    { kind: "checklist", heading: "Assessment Reporting Tasks", group: "reporting" },
    { kind: "narrative", heading: "Brief Summary of Activities Completed", key: "narrative", minHeight: 130 },
    /* The form's SECOND required rich-text field, taken from his screenshot of
       the live EHR on 2026-08-31. It is a separate field holding separate
       content: the summary above says what the Behavior Analyst did, and this
       one says what the assessment found. Until now the tool drafted one of the
       two and the BCBA wrote the other by hand.

       It is a new SECTION_ID rather than more sentences inside `narrative`, and
       that is what makes the engine treat it as its own field: it becomes
       revisable on its own, the empty-section gate counts it, and the expert
       reads it. All three derive from the schema's section enum rather than
       from anything written per tool, so the id is the whole integration. */
    { kind: "narrative", heading: "Results of Assessment", key: "results", minHeight: 170 },
  ];

  var SECTION_IDS = ["activities", "reporting", "narrative", "results"];

  var HINT_CATALOG = {
    thin_section: "This section is thin relative to the form's expectations, add specifics if you have them",
    ambiguous_item: "Clarify",
    /* Both of these belong to the results field, and both are a failure a
       one-narrative tool could not have had: the intake says what was run and
       never what it showed. That leaves a REQUIRED field on the form with
       nothing to put in it, which is a different thing from a thin section and
       needs its own code to be worth acting on. */
    no_results: "The activities are described and the findings are not, so the Results of Assessment field has nothing to fill it",
    unscored_instrument: "An instrument is named with no score, level or result given for it",
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
  var revision = revisionKeys(SECTION_IDS);

  var RESPONSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: [
      "activities", "reporting", "narrative", "results", "hints",
    ],
    properties: {
      activities: enumArray(ACTIVITIES),
      reporting: enumArray(REPORTING),
      narrative: str,
      // Required rather than optional, because the EHR field is required. A
      // draft that came back without it would leave the BCBA staring at a blank
      // box the form will not let them submit, which is the exact hand-work
      // this field was added to remove.
      results: str,
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

  var SYSTEM_CORE = "You are documenting a Behavior Analyst's assessment session. The BCBA is the author documenting their own work. Write in third-person clinical prose: \"The Behavior Analyst administered…\", \"Results indicated….\"\n\n\
Frame all content for medical necessity. Embed clinical purpose inline - \"[instrument] was administered to identify [deficit or function], [how findings inform planning]\" - not as a separate purpose sentence. Example: \"The VB-MAPP was administered to identify language repertoire gaps informing skill acquisition targets for the upcoming authorization period\" - not \"The VB-MAPP was administered. Purpose: assess language skills.\"\n\n\
OUTPUT: (a) a up to 8 sentence third-person clinical narrative for the \"Brief Summary of Activities Completed\" field, (b) a up to 10 sentence third-person clinical narrative for the \"Results of Assessment\" field, (c) conservative checkbox inferences for the BCBA to verify.\n\n\
THE TWO NARRATIVES ARE SEPARATE FIELDS ON THE FORM AND THE SPLIT IS STRICT.\n\
- \"Brief Summary of Activities Completed\" is what the Behavior Analyst DID: the instruments administered and the repertoire or domains each one covers, how data were collected, what was manipulated and in what order, and the clinical purpose of each. Purpose belongs here (\"administered to assess X\", \"to eliminate confounds for behavioral function\"). It carries no findings.\n\
- \"Results of Assessment\" is what the assessment FOUND: scores, strengths and deficits by domain, the topography of any target behavior, what happened under each condition that was run, and what the findings indicate for treatment.\n\
- Do not repeat one field's content in the other. A finding in the summary field, or an activity re-narrated in the results field, is a misfiled note. Where the intake gives activities and no findings, draft the summary and emit the no_results hint rather than padding results out of the activities.\n\n\
RESULTS OF ASSESSMENT CARRIES THE NUMBERS. It is the one narrative here that reports scores, and it reports them in the instrument's own units: a VB-MAPP level and milestone point total, an EESA-R score per group, percent correct, a preference assessment's rank order. Where the intake gives a score it belongs here. Where the intake names an instrument and gives no score, say it was administered and its scoring is pending, and emit the unscored_instrument hint. Never invent a score.\n\
- Report strengths and deficits BY DOMAIN and carry the boundary, because the boundary is the finding. \"Imitation showed generalized instances but not across functional tasks or vocal instruction to imitate\" is a finding. \"Imitation was a relative weakness\" is not.\n\
- Where a function was assessed, report it condition by condition before naming it: what the behavior looked like, what occasioned it, what was delivered in each condition, and which conditions did and did not resolve it. Then the reinforcer that pattern supports and the intervention it indicates.\n\
- Hedge the inference to the evidence behind it. \"suggesting\", \"indicating\", \"consistent with\". A handful of trials does not license a flat assertion of function.\n\
- A behavior that was looked for and did not occur is a finding, and it belongs here. \"No aggression, flopping or tears accompanied the crying\" narrows the record. That sentence is about the client rather than about the documentation, which is the line the absence rule already draws, so it is not an exception to it. Report an absence only where the intake states it.\n\n\
THE BEHAVIOR ANALYST IS ENTITLED TO THE ANALYSIS. Assigning a function, naming an establishing operation and identifying an intervention target is what an assessment is for, and it is this author's own work. Do not recast it into a bare observation. The restraint that keeps analysis out of a note governs a technician writing a session note, not a Behavior Analyst writing an assessment.\n\
- So do not cut a causal claim or a clinical hypothesis out of this note. Naming why a behavior occurs is the assessment's finding, not an overreach, provided it is hedged to the evidence that supports it.\n\n\
RULES\n\
- Stick strictly to what is reported. Do not embellish or invent instruments, scores, or outcomes.\n\
- Plain, precise clinical language. Sparse notes → brief honest sentences.\n\
- Scope to assessment activities, their findings, protocol review, and follow-up items only.\n\n\
CHECKBOX INFERENCE: For \"activities\" and \"reporting\" return ONLY verbatim values from the allowed lists. Empty array if unsupported.\n\n\
TERMINOLOGY (non-negotiable)\n\
- Reinforcement is contingent on behavior. Never \"[person] was reinforced.\"\n\
- Precise verbs: administered [instrument], conducted a preference assessment, conducted FBA/FA, ran probes, established baseline, observed, interviewed, scored, identified function.\n\
- Name instruments specifically (VB-MAPP, AFLS, Vineland-3, MSWO, indirect FA). No generic phrases like \"assessment was conducted.\"\n\
- Objective, observable language. Cut staff opinion, causal claims and clinical hypotheses. A light judgment sitting on something actually seen is not value-laden phrasing and stays as written.";

  // Additive hint instructions, the core prompt above matches the standalone page.
  var HINTS_BLOCK = "\n\nHINTS: also return a \"hints\" array of {section, code, detail} objects flagging ONLY missing or ambiguous standard elements (max 3; empty [] when the note stands on its own). section is one of: " + SECTION_IDS.join(", ") + ". code is one of: thin_section (the narrative lacks the specifics the form expects), ambiguous_item (detail = what needs clarifying, 10 words max), no_results (section = results; activities are described and the findings are not, detail = which activity has no reported outcome), unscored_instrument (section = results; an instrument is named with no score, level or result, detail = the instrument), other (detail = the question). Never fabricate to avoid a hint.";

  var JSON_FORMAT_BLOCK = "\n\nOUTPUT FORMAT\nReturn ONLY a single JSON object. No markdown, no preamble. Use EXACTLY these keys; arrays hold verbatim option labels (empty [] if unsupported); \"narrative\" is the up to 8 sentence clinical summary of what was done and \"results\" is the up to 10 sentence report of what was found.\n{\n  \"activities\": [],\n  \"reporting\": [],\n  \"narrative\": \"\",\n  \"results\": \"\",\n  \"hints\": []\n}";

  var LABELED_FORMAT_BLOCK = "\n\nOUTPUT FORMAT\nReturn labeled sections in the exact order below. For each \"[tick]\" line, list ONLY the options that apply, comma-separated and verbatim from that section's allowed list; if none apply write \"None selected.\" For each \"[narrative]\" line write that field's prose. No JSON, no preamble, no commentary.\n\nACTIVITIES PERFORMED [tick]\nASSESSMENT REPORTING TASKS [tick]\nBRIEF SUMMARY OF ACTIVITIES COMPLETED [narrative]\nRESULTS OF ASSESSMENT [narrative]";

  function buildUserPrompt(values) {
    return [
      "Summary notes of activities (primary source, use as the basis of the narrative and the checkbox inference):",
      (values.summaryNotes || "").trim() || "(none provided)",
      "",
      "ALLOWED CHECKBOX OPTIONS (return only verbatim values from these lists):",
      "- activities: " + menu(ACTIVITIES),
      "- reporting: " + menu(REPORTING),
    ].join("\n");
  }

  function normalizeOutput(raw) {
    var o = raw && typeof raw === "object" ? raw : {};
    var out = {
      activities: (Array.isArray(o.activities) ? o.activities : []).filter(function (v) { return ACTIVITIES.indexOf(v) !== -1; }),
      reporting: (Array.isArray(o.reporting) ? o.reporting : []).filter(function (v) { return REPORTING.indexOf(v) !== -1; }),
      narrative: typeof o.narrative === "string" ? o.narrative : "",
      results: typeof o.results === "string" ? o.results : "",
      hints: normalizeHints(o.hints, HINT_CATALOG, SECTION_IDS),
    };
    // The three revision keys the engine reads back. Kept separate from the
    // note's own fields because they never reach the EHR: an answer is shown
    // in the panel and a routing decision is consumed before render.
    return Object.assign({}, out, normalizeRevision(o, SECTION_IDS));
  }

  window.NOTE_TOOLS.push({
    id: "assess",
    label: "Assessment",
    title: "Assessment Note Tool",
    subtitle: "Describe what was done and what it showed, the tool drafts both narratives and suggests which checkboxes to select on your EHR form.",
    assistantIntro: "Describe what was done in the assessment, then press Generate Note. I'll ask about anything that looks thin before drafting, then you can click any section, or select a phrase inside one, to revise it.",
    genLabel: "Generate Note",
    inputs: [
      {
        id: "summaryNotes", type: "textarea", label: "Summary Notes of Activities", required: true, height: 200,
        hint: "Describe what was done this session, which assessment tools/interviews/observations/analyses you ran, and reporting tasks (record review, scoring, treatment-plan work). Then what it showed: scores in the instrument's own units, strengths and deficits by domain, what a target behavior looked like and what each condition did to it. Name instruments (e.g. VB-MAPP, Vineland-3). The tool drafts both form narratives, \"Brief Summary of Activities Completed\" from what you did and \"Results of Assessment\" from what you found, and suggests which activity and reporting checkboxes to select.",
        placeholder: "No PHI. Bullets are fine, e.g.:\n- VB-MAPP milestones administered, levels 1-2 complete\n- Scored Level 1 overall, 23.5 milestone points\n- Strong manding + visual matching; imitation generalized in play but not on vocal instruction\n- Caregiver interview re: increase in tantrums over past 2 weeks\n- FBA: wordless pitched vocalizations when a preferred item is visible but out of reach\n- Tangible condition resolved it; attention-only condition did not\n- No aggression or tears alongside the crying\n- Scored protocol; began treatment-plan goal development\n- Need to schedule follow-up for preference assessment",
      },
    ],
    groupOptions: GROUP_OPTIONS,
    formSections: FORM_SECTIONS,
    hintCatalog: HINT_CATALOG,
    responseSchema: RESPONSE_SCHEMA,
    validate: function (values) {
      if (!(values.summaryNotes || "").trim()) return "Please enter Summary Notes of Activities.";
      return null;
    },
    /* This tool's system prompt is composed inside the Worker, from the prompt
       store, and is not sent from here.

       buildSystem stays because buildLabeledPrompt below is the logged-out
       copy-prompt path, and his 2026-08-04 ruling keeps that a logged-out
       feature. So the clinical rules were always going to reach a browser that
       asked for them. What migrating buys is the other half: /api/llm-call no
       longer accepts a system prompt for assess, so a password holder can no longer
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
