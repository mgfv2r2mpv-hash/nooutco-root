/* Assessment note tool config - ported from /notes/assess/ with prompts intact,
 * plus the shared engine's revision loop and a starter (generic) hint catalog. */
(function () {
  var menu = window.NoteToolsUtil.menu;
  var normalizeHints = window.NoteToolsUtil.normalizeHints;

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
  ];

  var SECTION_IDS = ["activities", "reporting", "narrative"];

  var HINT_CATALOG = {
    thin_section: "This section is thin relative to the form's expectations, add specifics if you have them",
    ambiguous_item: "Clarify",
    other: "",
  };

  var SYSTEM_CORE = "You are documenting a Behavior Analyst's assessment session. The BCBA is the author documenting their own work. Write in third-person clinical prose: \"The Behavior Analyst administered…\", \"Results indicated….\"\n\n\
Frame all content for medical necessity. Embed clinical purpose inline - \"[instrument] was administered to identify [deficit or function], [how findings inform planning]\" - not as a separate purpose sentence. Example: \"The VB-MAPP was administered to identify language repertoire gaps informing skill acquisition targets for the upcoming authorization period\" - not \"The VB-MAPP was administered. Purpose: assess language skills.\"\n\n\
OUTPUT: (a) a up to 8 sentence third-person clinical narrative for the \"Brief Summary of Activities Completed\" field, (b) conservative checkbox inferences for the BCBA to verify.\n\n\
RULES\n\
- Stick strictly to what is reported. Do not embellish or invent instruments, scores, or outcomes.\n\
- Plain, precise clinical language. Sparse notes → brief honest sentences.\n\
- Scope to assessment activities, protocol review, and follow-up items only.\n\n\
CHECKBOX INFERENCE: For \"activities\" and \"reporting\" return ONLY verbatim values from the allowed lists. Empty array if unsupported.\n\n\
TERMINOLOGY (non-negotiable)\n\
- Reinforcement is contingent on behavior. Never \"[person] was reinforced.\"\n\
- Precise verbs: administered [instrument], conducted a preference assessment, conducted FBA/FA, ran probes, established baseline, observed, interviewed, scored, identified function.\n\
- Name instruments specifically (VB-MAPP, AFLS, Vineland-3, MSWO, indirect FA). No generic phrases like \"assessment was conducted.\"\n\
- Objective, observable language. Cut staff opinion, causal claims and clinical hypotheses. A light judgment sitting on something actually seen is not value-laden phrasing and stays as written.";

  // Additive hint instructions, the core prompt above matches the standalone page.
  var HINTS_BLOCK = "\n\nHINTS: also return a \"hints\" array of {section, code, detail} objects flagging ONLY missing or ambiguous standard elements (max 3; empty [] when the note stands on its own). section is one of: " + SECTION_IDS.join(", ") + ". code is one of: thin_section (the narrative lacks the specifics the form expects), ambiguous_item (detail = what needs clarifying, 10 words max), other (detail = the question). Never fabricate to avoid a hint.";

  var JSON_FORMAT_BLOCK = "\n\nOUTPUT FORMAT\nReturn ONLY a single JSON object. No markdown, no preamble. Use EXACTLY these keys; arrays hold verbatim option labels (empty [] if unsupported); \"narrative\" is the up to 8 sentence clinical summary.\n{\n  \"activities\": [],\n  \"reporting\": [],\n  \"narrative\": \"\",\n  \"hints\": []\n}";

  var LABELED_FORMAT_BLOCK = "\n\nOUTPUT FORMAT\nReturn labeled sections in the exact order below. For each \"[tick]\" line, list ONLY the options that apply, comma-separated and verbatim from that section's allowed list; if none apply write \"None selected.\" For \"[narrative]\" write the up to 8 sentence summary. No JSON, no preamble, no commentary.\n\nACTIVITIES PERFORMED [tick]\nASSESSMENT REPORTING TASKS [tick]\nBRIEF SUMMARY OF ACTIVITIES COMPLETED [narrative]";

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
    return {
      activities: (Array.isArray(o.activities) ? o.activities : []).filter(function (v) { return ACTIVITIES.indexOf(v) !== -1; }),
      reporting: (Array.isArray(o.reporting) ? o.reporting : []).filter(function (v) { return REPORTING.indexOf(v) !== -1; }),
      narrative: typeof o.narrative === "string" ? o.narrative : "",
      hints: normalizeHints(o.hints, HINT_CATALOG, SECTION_IDS),
    };
  }

  window.NOTE_TOOLS.push({
    id: "assess",
    label: "Assessment",
    title: "Assessment Note Tool",
    subtitle: "Describe what was done, the tool drafts the clinical summary and suggests which checkboxes to select on your EHR form.",
    assistantIntro: "Describe what was done in the assessment, then press Generate Note. I'll ask about anything that looks thin before drafting, then you can click any section, or select a phrase inside one, to revise it.",
    genLabel: "Generate Note",
    inputs: [
      {
        id: "summaryNotes", type: "textarea", label: "Summary Notes of Activities", required: true, height: 200,
        hint: "Describe what was done this session, which assessment tools/interviews/observations/analyses you ran, reporting tasks (record review, scoring, treatment-plan work), findings, scores, and follow-up items. Name instruments (e.g. VB-MAPP, Vineland-3). The tool drafts the narrative and suggests which activity and reporting checkboxes to select on your form.",
        placeholder: "No PHI. Bullets are fine, e.g.:\n- VB-MAPP milestones administered, levels 1-2 complete\n- Caregiver interview re: increase in tantrums over past 2 weeks\n- Observed 4 instances of elopement during 30-min play\n- Scored protocol; began treatment-plan goal development\n- Need to schedule follow-up for preference assessment",
      },
    ],
    groupOptions: GROUP_OPTIONS,
    formSections: FORM_SECTIONS,
    hintCatalog: HINT_CATALOG,
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
    buildSystem: function () { return SYSTEM_CORE + (window.NoteRegisterRules ? window.NoteRegisterRules.sessionNote : "") + HINTS_BLOCK + JSON_FORMAT_BLOCK; },
    buildUserPrompt: buildUserPrompt,
    buildLabeledPrompt: function (values) {
      return SYSTEM_CORE + LABELED_FORMAT_BLOCK + "\n\n---\n\n" + buildUserPrompt(values);
    },
    normalizeOutput: normalizeOutput,
  });
})();
