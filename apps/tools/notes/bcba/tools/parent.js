/* Parent/caregiver training note tool config — ported from /notes/parent/ with
 * prompts intact, plus the shared engine's revision loop and a starter hint
 * catalog. */
(function () {
  var menu = window.NoteToolsUtil.menu;
  var normalizeHints = window.NoteToolsUtil.normalizeHints;

  // Canonical option lists — these labels are both the menu the AI may choose
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
    thin_section: "This section is thin relative to the form's expectations — add specifics if you have them",
    ambiguous_item: "Clarify",
    other: "",
  };

  // Shared prompt core: clinical role + voice + terminology + conservative checkbox inference.
  var SYSTEM_CORE = "You are documenting a Behavior Analyst's parent/caregiver training session. The BCBA is the author documenting their own session. Write in third-person clinical prose: \"The Behavior Analyst modeled…\", \"The caregiver implemented….\"\n\n\
For training strategies and programming decisions, fold rationale inline — \"[caregiver skill level or observed barrier], so [approach] was selected to [functional target or generalization outcome]\" — not as a separate rationale sentence. Example: \"The caregiver's inconsistent prompt delivery prompted modeling with immediate feedback to improve procedural fidelity\" — not \"Modeling was provided. Rationale: caregiver needed feedback.\"\n\n\
OUTPUT: (a) polished third-person clinical narratives, (b) conservative checkbox inferences for the BCBA to verify.\n\n\
RULES\n\
- Never invent caregiver actions, child responses, or program changes not in the notes. Sparse section → brief honest sentence.\n\
- Plain, precise clinical language — no filler, no elevated vocabulary.\n\
- \"individualsPresent\" should include \"Parent/Caregiver\" and \"Client\" unless notes indicate otherwise.\n\n\
CHECKBOX INFERENCE: For each group return ONLY verbatim values from the allowed list. Infer conservatively — only options clearly supported by the notes. Single-selects: one verbatim value or \"\".\n\n\
TERMINOLOGY (non-negotiable)\n\
- Reinforcement is contingent on behavior. Never \"[person] was reinforced.\" Write \"[behavior] was reinforced,\" \"reinforcement was delivered contingent on [behavior],\" or for caregivers: \"the caregiver was praised for [specific implementation behavior]\" or \"performance feedback was delivered.\"\n\
- Precise verbs: prompted, faded, modeled, shaped, chained, redirected, blocked, provided BST, gave performance feedback.\n\
- Name procedures specifically (partial verbal prompt, errorless teaching, DRO, BST). No loose synonyms (rewarded, encouraged, motivated).\n\
- Objective, observable language — no value-laden phrasing.";

  // Additive hint instructions — the core prompt above matches the standalone page.
  var HINTS_BLOCK = "\n\nHINTS: also return a \"hints\" array of {section, code, detail} objects flagging ONLY missing or ambiguous standard elements (max 3; empty [] when the note stands on its own). section is one of: " + SECTION_IDS.join(", ") + ". code is one of: thin_section (a narrative lacks the specifics the form expects), ambiguous_item (detail = what needs clarifying, 10 words max), other (detail = the question). Never fabricate to avoid a hint.";

  var JSON_FORMAT_BLOCK = "\n\nOUTPUT FORMAT\nReturn ONLY a single JSON object. No markdown, no preamble. Use EXACTLY these keys; arrays hold verbatim option labels (empty [] if unsupported); single-selects are one verbatim label or \"\".\n{\n  \"individualsPresent\": [],\n  \"supportActivities\": [],\n  \"caregiverResponse\": \"\",\n  \"progressStatus\": \"\",\n  \"summary\": \"\",\n  \"followup\": \"\",\n  \"hints\": []\n}\nWhere \"summary\" is 3–5 clinical sentences covering goal progress and any program modifications made or needed, and \"followup\" is follow-up items for the Behavior Analyst — each item on its own line separated by \\n, no bullets, no numbers, no commas between items.";

  var LABELED_FORMAT_BLOCK = "\n\nOUTPUT FORMAT\nReturn labeled sections in the exact order below. For each \"[tick]\" line, list ONLY the options that apply, comma-separated and verbatim from that section's allowed list; if none apply write \"None selected.\" For \"[choose one]\" pick exactly one allowed option (or \"None\"). For \"[narrative]\" write the prose. No JSON, no preamble, no commentary.\n\nINDIVIDUALS PRESENT [tick]\nCAREGIVER RECEIVED THE FOLLOWING SUPPORT [tick]\nCAREGIVER RESPONSE TO TRAINING [choose one]\nPROGRESS STATUS [choose one]\nSUMMARY OF GOAL PROGRESS & MODIFICATIONS [narrative: 3–5 clinical sentences]\nBEHAVIOR ANALYST FOLLOW UP [narrative: one item per line, no bullets/numbers]";

  function buildUserPrompt(values) {
    return [
      "Session notes (primary source — expand faithfully, never fabricate):",
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

  function normalizeOutput(raw) {
    var o = raw && typeof raw === "object" ? raw : {};
    var out = {};
    Object.keys(GROUP_OPTIONS).forEach(function (key) {
      var opts = GROUP_OPTIONS[key];
      var isSingle = key === "caregiverResponse" || key === "progressStatus";
      if (isSingle) out[key] = opts.indexOf(o[key]) !== -1 ? o[key] : "";
      else out[key] = (Array.isArray(o[key]) ? o[key] : []).filter(function (v) { return opts.indexOf(v) !== -1; });
    });
    ["summary", "followup"].forEach(function (key) { out[key] = typeof o[key] === "string" ? o[key] : ""; });
    out.hints = normalizeHints(o.hints, HINT_CATALOG, SECTION_IDS);
    return out;
  }

  window.NOTE_TOOLS.push({
    id: "parent",
    label: "Parent Training",
    title: "Parent Note Tool",
    subtitle: "Enter your session notes — the tool drafts the clinical note and suggests which checkboxes to select on your EHR form.",
    genLabel: "Generate Note",
    inputs: [
      {
        id: "sessionNotes", type: "textarea", label: "Session Notes", required: true, height: 200,
        hint: "Describe the session: who was present, the support you provided (data, modeling, problem-solving, discussion, feedback), how the caregiver responded, progress toward goals, and any follow-ups. The tool drafts the note and suggests which checkboxes to select on your EHR form.",
        placeholder: "No PHI. Bullet points are fine, e.g.:\n- Parent + client present; modeled manding, parent practiced, 70% independent\n- Reviewed token board setup, parent unsure of steps\n- Phase change needed on DTT targets\n- Parent to practice prompting hierarchy at home",
      },
    ],
    groupOptions: GROUP_OPTIONS,
    formSections: FORM_SECTIONS,
    hintCatalog: HINT_CATALOG,
    validate: function (values) {
      if (!(values.sessionNotes || "").trim()) return "Please enter your session notes.";
      return null;
    },
    buildSystem: function () { return SYSTEM_CORE + HINTS_BLOCK + JSON_FORMAT_BLOCK; },
    buildUserPrompt: buildUserPrompt,
    buildLabeledPrompt: function (values) {
      return SYSTEM_CORE + LABELED_FORMAT_BLOCK + "\n\n---\n\n" + buildUserPrompt(values);
    },
    normalizeOutput: normalizeOutput,
  });
})();
