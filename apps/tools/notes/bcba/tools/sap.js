/* SAP Goals & Planning tool config — ported from /notes/sap/ with prompts
 * intact, plus the shared engine's revision loop and a starter hint catalog.
 * The model returns nested JSON (exercise/generalization/errorCorrection);
 * normalizeOutput flattens each into the editable text block the EHR expects. */
(function () {
  var normalizeHints = window.NoteToolsUtil.normalizeHints;

  var SMART_TOOLTIP = "SMART goals are: Specific (clearly defines the target behavior and context — what, where, with whom), Measurable (includes quantifiable criteria, e.g. \"4 out of 5 opportunities\" or \"80% accuracy\"), Achievable (realistic within the authorization period given the client's current baseline), Relevant (tied to the client's diagnosis, functional independence, and medical necessity — not academics), and Time-bound (specifies a timeframe, e.g. \"within 1 authorization period\" or \"across 3 consecutive sessions\").";

  var SECTION_IDS = ["refinedGoal", "exercise", "generalization", "errorCorrection"];

  var HINT_CATALOG = {
    thin_section: "This section is thin relative to what technicians need to implement — add specifics if you have them",
    ambiguous_item: "Clarify",
    other: "",
  };

  var SYSTEM_PROMPT = [
    "You are a BCBA writing a Service Authorization Plan (SAP) for behavior technicians to implement.",
    "Output concise, operational procedures. Exception: the Purpose field states the clinical indication — what functional skill deficit or behavioral barrier is targeted, and what independence or safety outcome the goal supports. This is required for medical necessity.",
    "All other fields: no rationale, no prose, no padding. Staff are trained; do not explain ABA concepts.",
    "",
    "Given a treatment goal and SAP specifications, return ONLY a JSON object (no markdown fences, no preamble) with this exact structure:",
    "",
    '{',
    '  "refinedGoal": "Refined SMART goal. Preserve clinician wording wherever possible — only fill in missing SMART elements (Specific target + context, Measurable criterion, Achievable, Relevant to functional independence/medical necessity, Time-bound). Add \'by the end of 1 authorization period\' if timeframe is missing.",',
    '  "exercise": {',
    '    "purpose": "* [clinical indication: functional skill deficit or behavioral barrier addressed]\\n* [functional outcome: independence or safety gain this goal targets]",',
    '    "teachingStrategy": "[Method name]. [One sentence on application — no rationale paragraph.]",',
    '    "lessonSetUp": "* [setup item]\\n* [setup item]\\n* [setup item if needed]",',
    '    "sd": "* [What adult says/does — use [CLIENT] for the client]\\ne.g., [3 example questions/demands in neutral third-person]\\n* [Delivery condition]",',
    '    "correctResponse": "+ [criterion]\\n+ [criterion]\\n+ [criterion if needed]",',
    '    "incorrectResponse": "- [criterion]\\n- [criterion]\\n- [criterion if needed]",',
    '    "masteryCriteria": "Minimum [N] trials at [X]% accuracy across [N] consecutive sessions.",',
    '    "promptHierarchy": "Use [Least-to-Most or Most-to-Least] Prompting\\n* I — Independent: [brief description]\\n* G — Gesture: [brief description]\\n* PV — Partial Verbal: [brief description]\\n* FV — Full Verbal: [brief description]"',
    '  },',
    '  "generalization": {',
    '    "criteria": "[2-3 sentences: contexts, people, stimuli. No padding.]",',
    '    "maintenance": "[Schedule, probe structure, accuracy threshold. 2-4 sentences.]"',
    '  },',
    '  "errorCorrection": {',
    '    "initial": "(1) [step]\\n(2) [step]\\n(3) [step]\\n\\n[One additional rule if warranted — omit if not]",',
    '    "maintenance": "(1) [step]\\n(2) [step]\\n[One additional rule if warranted — omit if not]"',
    '  }',
    '}',
    '',
    "JSON escaping — every value above is a multi-line block, so this is where output breaks:",
    "- Write each line break inside a value as \\n. Never press an actual newline inside a string.",
    "- Write every double quote inside a value as \\\" — SD examples quote the demand verbatim (e.g. \\\"What is it?\\\"), and a bare quote there makes the whole object unparseable.",
    "",
    "Style rules — follow exactly:",
    "- Use [CLIENT] everywhere in place of any client name or the client in procedures",
    "- Use * for general bullets, + for correct response items, - for incorrect response items",
    "- Prompt hierarchy: always I, G, PV, FV notation unless specs specify otherwise",
    "- masteryCriteria: exactly one line",
    "- No sentence starting with It is important to, Rationale:, This ensures, Note that, or similar",
    "- Lesson Set Up: actual setup steps only — no reminders about data sheets or timers",
    "- SD examples: neutral third-person phrasing",
    "- Keep every section as short as operationally complete allows",
    "",
    "Terminology standards — non-negotiable:",
    "- Reinforcement is contingent on behavior, never delivered to people. Never write [CLIENT] is reinforced. Write deliver reinforcement contingent on [target behavior] or [behavior] is reinforced on [schedule].",
    "- Use precise behavior-analytic verbs: prompt, fade, model, shape, chain, present the SD, deliver/withhold reinforcement, run a probe, conduct a trial, mass trial, intersperse.",
    "- Do not substitute loose synonyms (reward, encourage, motivate). Plain operational language only.",
  ].join("\n");

  // Additive hint instructions — the core prompt above matches the standalone page.
  var HINTS_BLOCK = "\n\nHINTS: additionally include a top-level \"hints\" key — an array of {section, code, detail} objects flagging ONLY missing or ambiguous elements (max 3; empty [] when the draft stands on its own). section is one of: " + SECTION_IDS.join(", ") + ". code is one of: thin_section (a section lacks operational specifics technicians need), ambiguous_item (detail = what needs clarifying, 10 words max), other (detail = the question). Never fabricate to avoid a hint.";

  function buildUserPrompt(values) {
    return "Treatment Goal:\n" + (values.goal || "") + "\n\nSAP Specifications:\n" + ((values.sapSpecs || "").trim() || "(No additional specifications provided — apply standard best-practice defaults.)");
  }

  function buildLabeledPrompt(values) {
    var sys = [
      "You are a BCBA writing a Service Authorization Plan (SAP) for behavior technicians.",
      "Output concise, operational procedures. Exception: the Purpose field states the clinical indication (what functional skill deficit is targeted and what independence outcome the goal supports).",
      "All other fields: no rationale, no prose padding. Staff are trained.",
      "",
      "Terminology standards — non-negotiable:",
      "- Reinforcement is contingent on behavior, never delivered to people. Never write [CLIENT] is reinforced.",
      "- Use precise behavior-analytic verbs: prompt, fade, model, shape, chain, present the SD, errorless teaching, DRO, DRA, time delay, BST.",
      "- Do not substitute loose synonyms (reward, encourage, motivate). Plain operational language only.",
      "",
      "Given a treatment goal and SAP specifications, return exactly the following labeled sections",
      "(label on its own line, content below, blank line before next label).",
      "No preamble, no commentary after the last section.",
      "",
      "REFINED TREATMENT GOAL",
      "[Refined SMART goal — preserve clinician wording wherever possible. Only fill in missing SMART elements. If timeframe is missing add 'by the end of 1 authorization period'.]",
      "",
      "EXERCISE",
      "Purpose:",
      "[* clinical indication: functional skill deficit or behavioral barrier addressed]",
      "[* functional outcome: independence or safety gain this goal targets]",
      "",
      "Teaching Strategy:",
      "[Method name. One sentence on application.]",
      "",
      "Lesson Set Up:",
      "[* bullet list of actual setup steps]",
      "",
      "SD (Demand / Discriminative Stimulus):",
      "[* What adult says/does — use [CLIENT] for client]",
      "[e.g., 3 example questions/demands in neutral third-person]",
      "[* Delivery condition]",
      "",
      "Correct Response:",
      "[+ criterion]",
      "[+ criterion]",
      "",
      "Incorrect Response:",
      "[- criterion]",
      "[- criterion]",
      "",
      "Mastery Criteria:",
      "[One line: Minimum N trials at X% accuracy across N consecutive sessions.]",
      "",
      "Prompt Hierarchy:",
      "Use [Least-to-Most or Most-to-Least] Prompting",
      "[* I — Independent: brief description]",
      "[* G — Gesture: brief description]",
      "[* PV — Partial Verbal: brief description]",
      "[* FV — Full Verbal: brief description]",
      "",
      "GENERALIZATION",
      "Generalization Criteria:",
      "[2-3 sentences: conditions, contexts, people, stimuli]",
      "",
      "Maintenance Criteria:",
      "[Schedule, probe structure, accuracy threshold. 2-4 sentences.]",
      "",
      "ERROR CORRECTION",
      "During Initial Teaching:",
      "[(1) step]",
      "[(2) step]",
      "[(3) step]",
      "[One additional rule if warranted]",
      "",
      "During Maintenance:",
      "[(1) step]",
      "[(2) step]",
      "[One additional rule if warranted]",
      "",
      "Note: After 2 consecutive maintenance probes below Maintenance Criteria, contact BCBA so a skill can re-enter teaching.",
    ].join("\n");

    var user = "Treatment Goal:\n" + (values.goal || "") + "\n\nSAP Specifications:\n" + ((values.sapSpecs || "").trim() || "(No additional specifications — apply best-practice defaults.)");
    return sys + "\n\n---\n\n" + user;
  }

  function formatExercise(ex) {
    var parts = [];
    if (ex.purpose)           parts.push("Purpose:\n"                               + ex.purpose);
    if (ex.teachingStrategy)  parts.push("Teaching Strategy:\n"                     + ex.teachingStrategy);
    if (ex.lessonSetUp)       parts.push("Lesson Set Up:\n"                         + ex.lessonSetUp);
    if (ex.sd)                parts.push("SD (Demand / Discriminative Stimulus):\n" + ex.sd);
    if (ex.correctResponse)   parts.push("Correct Response:\n"                      + ex.correctResponse);
    if (ex.incorrectResponse) parts.push("Incorrect Response:\n"                    + ex.incorrectResponse);
    if (ex.masteryCriteria)   parts.push("Mastery Criteria:\n"                      + ex.masteryCriteria);
    if (ex.promptHierarchy)   parts.push("Prompt Hierarchy:\n"                      + ex.promptHierarchy);
    return parts.join("\n\n");
  }

  function formatGeneralization(gen) {
    var parts = [];
    if (gen.criteria)    parts.push("Generalization Criteria:\n" + gen.criteria);
    if (gen.maintenance) parts.push("Maintenance Criteria:\n"    + gen.maintenance);
    return parts.join("\n\n");
  }

  function formatErrorCorrection(ec) {
    var parts = [];
    if (ec.initial)     parts.push("During Initial Teaching:\n" + ec.initial);
    if (ec.maintenance) parts.push("During Maintenance:\n"      + ec.maintenance);
    parts.push("Note: After 2 consecutive maintenance probes below Maintenance Criteria, contact BCBA so a skill can re-enter teaching.");
    return parts.join("\n\n");
  }

  function normalizeOutput(raw) {
    var o = raw && typeof raw === "object" ? raw : {};
    return {
      refinedGoal: typeof o.refinedGoal === "string" ? o.refinedGoal : "",
      exercise: formatExercise(o.exercise || {}),
      generalization: formatGeneralization(o.generalization || {}),
      errorCorrection: formatErrorCorrection(o.errorCorrection || {}),
      hints: normalizeHints(o.hints, HINT_CATALOG, SECTION_IDS),
    };
  }

  window.NOTE_TOOLS.push({
    id: "sap",
    label: "SAP",
    title: "SAP Goals & Planning Tool",
    subtitle: "Enter a treatment goal and SAP specifications — generate a prompt or draft a complete Service Authorization Plan for clinical review.",
    genLabel: "Generate SAP",
    outputTitle: "Generated SAP Draft",
    promptIntro: "Copy and paste into your AI of choice. It will return a refined SMART goal and complete SAP draft — no preamble, no editorializing.",
    maxTokens: 3500,
    inputs: [
      {
        id: "goal", type: "textarea", label: "Treatment Goal", required: true, height: 120, charCount: true,
        tooltip: SMART_TOOLTIP,
        hint: "Write a SMART goal tied to the client's diagnosis and functional needs — without PHI. Hover the i icon to see what makes a goal SMART.",
        placeholder: "e.g., [Client] will independently request preferred items or activities using their AAC device in 4 out of 5 opportunities, absent behaviors targeted for reduction, across 3 consecutive sessions within 1 authorization period, as measured by direct observation during structured and unstructured activities.",
      },
      {
        id: "sapSpecs", type: "textarea", label: "SAP Specifications", height: 150, charCount: true,
        tip: "The AI will draft a best-practice SAP template based on your goal — but it has no access to client-specific details. Include relevant considerations here (without PHI): teaching format (DTT vs NET), prompt hierarchy preferences, number of trials, mastery criteria, generalization targets (settings, people, stimuli), error correction protocol, session structure, or any deviations from standard practice. The more context you provide, the more tailored the draft will be.",
        placeholder: "Bullet points or fragments are fine, e.g.:\n- DTT format, 10 trials per session\n- Least to most prompt hierarchy\n- Mastery: 80% accuracy across 3 consecutive sessions\n- Generalize across 3 staff and 2 settings\n- Error correction: no-no prompt during acquisition\n- Maintenance: same error correction as acquisition",
      },
    ],
    groupOptions: {},
    formSections: [
      { kind: "narrative", heading: "Treatment Goal (Refined)", key: "refinedGoal", minHeight: 100 },
      { kind: "narrative", heading: "Exercise", key: "exercise", minHeight: 420 },
      { kind: "narrative", heading: "Generalization", key: "generalization", minHeight: 180 },
      { kind: "narrative", heading: "Error Correction", key: "errorCorrection", minHeight: 220 },
    ],
    hintCatalog: HINT_CATALOG,
    validate: function (values) {
      if (!(values.goal || "").trim()) return "Please enter a treatment goal.";
      return null;
    },
    buildSystem: function () { return SYSTEM_PROMPT + HINTS_BLOCK; },
    buildUserPrompt: buildUserPrompt,
    buildLabeledPrompt: buildLabeledPrompt,
    normalizeOutput: normalizeOutput,
  });
})();
