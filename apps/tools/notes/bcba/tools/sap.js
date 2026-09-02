/* SAP Goals & Planning tool config - ported from /notes/sap/ with prompts
 * intact, plus the shared engine's revision loop and a starter hint catalog.
 * The model returns nested JSON (exercise/generalization/errorCorrection);
 * normalizeOutput flattens each into the editable text block the EHR expects. */
(function () {
  var normalizeHints = window.NoteToolsUtil.normalizeHints;
  var normalizeRevision = window.NoteToolsUtil.normalizeRevision;
  var hintSchema = window.NoteToolsUtil.hintSchema;

  var SMART_TOOLTIP = "SMART goals are: Specific (clearly defines the target behavior and context, what, where, with whom), Measurable (includes quantifiable criteria, e.g. \"4 out of 5 opportunities\" or \"80% accuracy\"), Achievable (realistic within the authorization period given the client's current baseline), Relevant (tied to the client's diagnosis, functional independence, and medical necessity, not academics), and Time-bound (specifies a timeframe, e.g. \"within 1 authorization period\" or \"across 3 consecutive sessions\").";

  var SECTION_IDS = ["refinedGoal", "exercise", "generalization", "errorCorrection"];
  // Bound after SECTION_IDS, which it reads: `var` hoists the declaration but
  // not the value, so binding this above would seal the enum as undefined.
  var revision = window.NoteToolsUtil.revisionKeys(SECTION_IDS);

  // Used only when the model omits reentryRule. Single-sourced so the JSON path
  // (formatErrorCorrection) and the copy-paste path (buildLabeledPrompt) cannot
  // drift apart. They previously carried separate literal copies of this line.
  var REENTRY_FALLBACK = "After 2 consecutive maintenance probes below Maintenance Criteria, contact BCBA so a skill can re-enter teaching.";

  var HINT_CATALOG = {
    thin_section: "This section is thin relative to what technicians need to implement, add specifics if you have them",
    ambiguous_item: "Clarify",
    other: "",
  };

  /* Response schema - what the model is CONSTRAINED to, not merely asked for.
   * The prompt below still describes this shape, but the prompt is guidance and
   * this is enforcement: with it the note is serialised by the API instead of
   * being typed out as prose, so a missed escape stops being possible rather
   * than being something the client has to recover from.
   *
   * The API constrains output to a subset of JSON Schema - no recursion, no
   * numeric bounds, no string lengths - and every object must seal itself with
   * additionalProperties:false. Every property is listed in `required`: an
   * optional key is one the model may omit, which is the blank-section hole the
   * shape gate exists to catch. Kept flat and string-valued to stay inside the
   * subset; structure within a value stays the model's job. */
  var str = { type: "string" };

  var RESPONSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["refinedGoal", "exercise", "generalization", "errorCorrection", "hints"],
    properties: {
      refinedGoal: str,
      exercise: {
        type: "object",
        additionalProperties: false,
        required: [
          "purpose", "teachingStrategy", "lessonSetUp", "sd",
          "correctResponse", "incorrectResponse", "masteryCriteria", "promptHierarchy",
        ],
        properties: {
          purpose: str, teachingStrategy: str, lessonSetUp: str, sd: str,
          correctResponse: str, incorrectResponse: str, masteryCriteria: str, promptHierarchy: str,
        },
      },
      generalization: {
        type: "object",
        additionalProperties: false,
        required: ["criteria", "maintenance"],
        properties: { criteria: str, maintenance: str },
      },
      errorCorrection: {
        type: "object",
        additionalProperties: false,
        required: ["initial", "maintenance", "reentryRule"],
        properties: { initial: str, maintenance: str, reentryRule: str },
      },
      // An empty array is the "draft stands on its own" case, so hints is
      // required as a key even though it is routinely empty. Shared shape, so
      // rank, kind and the whole-note section arrive here without this file
      // restating them.
      hints: hintSchema(HINT_CATALOG, SECTION_IDS),
      // The three keys a revision turn can carry. Optional, never required: a
      // first draft has nothing to answer and nothing to route. Without them
      // this sealed object turned "should this go in the plan?" into a rewrite
      // of the plan, which is the fault REVISION_RULES exists to prevent.
      bcbaQuestion: revision.bcbaQuestion,
      answer: revision.answer,
      crossSection: revision.crossSection,
    },
  };

  var SYSTEM_PROMPT = [
    "You are a BCBA writing a Service Authorization Plan (SAP) for behavior technicians to implement.",
    "",
    "WHO READS THIS AND WHEN. The technician reads the plan BEFORE the session, not during a trial. They have been trained on the procedures; the plan's job is to carry enough specific detail that the training comes back to them and they can run THIS program. So do not compress. A clause that names the actor, the stimulus or the condition earns its place. Write operational prose, not telegraphese, and never pad with rationale to reach a length.",
    "",
    "Four fields carry more than a bare instruction:",
    "* Purpose states the clinical indication, what functional skill deficit or behavioral barrier is targeted, and what independence or safety outcome the goal supports. This is required for medical necessity.",
    "* Teaching Strategy names the strategy and then explains briefly how it applies to THIS program: the arrangement, stimuli, contingency or schedule it uses for this specific target. Describing how the method runs here is not rationale and is wanted. Arguing why the method is a good choice is rationale and is not.",
    "* Lesson Set Up covers three things: how to arrange the space and the stimuli, how to judge that the learner is ready, and how to pick the moment, including when to pause the program and what has to be true to resume. A basic need always outranks the program: if distress starts to interfere with eating, toileting or sleep, say so and say to let the client meet the need, re-pair, and resume at baseline.",
    "* Error Correction steps name who does what, and the actual prompt level, stimuli or contingency for this program.",
    "All other fields: no rationale, no padding. Staff are trained; do not explain ABA concepts.",
    "",
    "NAMING THE ACTOR, AND THEN NOT NAMING IT AGAIN. Say who does what rather than issuing a bare instruction: 'the technician presents the array' beats 'present the array'. Then stop saying it.",
    "NAME ONCE AT THE SHIFT, THEN LET IT RIDE. Once a sentence has established who is acting, the following sentences in that section must NOT restate the actor. Drop the subject and carry on: 'The technician presents the array, waits 5 seconds, then delivers the prompt.' Restate an actor only when the actor genuinely changes, for example when the caregiver takes over. Re-naming the same actor sentence after sentence is the single loudest machine-writing tell in this document type.",
    "HARD CEILINGS, measured on real output and on 7 human-written plans:",
    "* The client placeholder appears in AT MOST half the sentences of any section. In human plans it runs about one sentence in five.",
    "* No more than TWO sentences in any section may begin with the same first two words. Restructure the third: lead with the condition, lead with the stimulus, or fold it into the previous sentence.",
    "* Vary sentence length deliberately within every section. Put a short sentence next to a long one.",
    "Where a protocol genuinely involves more than one adult, expand each role once and then abbreviate: Client (C), Prompting Partner (PP), Communicative Partner (CP). Use the abbreviation after that. This is a technical field and some repetition of clinical terms is unavoidable and correct; repetition of SENTENCE SHAPE is what to avoid.",
    "",
    "Given a treatment goal and SAP specifications, return ONLY a JSON object (no markdown fences, no preamble) with this exact structure:",
    "",
    '{',
    '  "refinedGoal": "Refined SMART goal. Preserve clinician wording wherever possible, only fill in missing SMART elements (Specific target + context, Measurable criterion, Achievable, Relevant to functional independence/medical necessity, Time-bound). Add \'by the end of 1 authorization period\' if timeframe is missing.",',
    '  "exercise": {',
    '    "purpose": "* [clinical indication: functional skill deficit or behavioral barrier addressed]\\n* [functional outcome: independence or safety gain this goal targets]",',
    '    "teachingStrategy": "[Strategy name]. [How it applies to THIS program, name the actual target, arrangement, stimuli or contingency from the goal above, not the method in the abstract. Say who does what. 2-4 sentences, or * bullets where the strategy has distinct components.]",',
    '    "lessonSetUp": "* [how the space and stimuli are arranged for THIS target, name the actual materials and positions]\\n* [how to tell the learner is ready, and how to pick the moment to run it]\\n* [what to do if the program has to pause, and what has to be true to resume]\\n* [further item only if this program needs one]",',
    '    "sd": "* [What adult says/does, use [CLIENT] for the client]\\ne.g., [3 example questions/demands in neutral third-person]\\n* [Delivery condition]",',
    '    "correctResponse": "+ [criterion]\\n+ [criterion]\\n+ [criterion if needed]",',
    '    "incorrectResponse": "- [criterion]\\n- [criterion]\\n- [criterion if needed]",',
    '    "masteryCriteria": "Minimum [N] trials at [X]% accuracy across [N] consecutive sessions.",',
    '    "promptHierarchy": "[Prompting direction as the clinician states it, e.g. Most-to-Least (MtL) or Least-to-Most (LtM)]\\n* [ABBR] ([Full Prompt Name]): [what the technician does at this level]\\n* [one line per level the clinician actually uses, do NOT pad to a fixed count]"',
    '  },',
    '  "generalization": {',
    '    "criteria": "[3-4 sentences: the contexts, people and stimuli this has to transfer to, and what counts as transferred.]",',
    '    "maintenance": "[Schedule, probe structure, accuracy threshold. 2-4 sentences.]"',
    '  },',
    '  "errorCorrection": {',
    '    "initial": "(1) [step, name who does what, and the actual prompt level, stimuli or contingency for THIS program]\\n(2) [step]\\n(3) [step]\\n\\n[One additional rule if warranted, omit if not]",',
    '    "maintenance": "(1) [step, same: actor and condition, not the generic procedure]\\n(2) [step]\\n[One additional rule if warranted, omit if not]",',
    '    "reentryRule": "One line: how many consecutive maintenance probes below criteria trigger BCBA contact and re-entry to teaching. This MUST agree with the probe schedule written in generalization.maintenance, do not state a different number."',
    '  }',
    '}',
    '',
    "JSON escaping, every value above is a multi-line block, so this is where output breaks:",
    "* Write each line break inside a value as \\n. Never press an actual newline inside a string.",
    "* Write every double quote inside a value as \\\". SD examples quote the demand verbatim (e.g. \\\"What is it?\\\"), and a bare quote there makes the whole object unparseable.",
    "",
    "Style rules, follow exactly:",
    "* Use [CLIENT] everywhere in place of any client name or the client in procedures",
    "* Use * for general bullets, + for correct response items, - for incorrect response items",
    "* Prompt hierarchy: reproduce the levels and labels the clinician gives, in their order. Real hierarchies run 3 to 7 levels; there is no default count and no default lettering. Never invent a level scheme or pad to a fixed count. If the specs do not state the levels, write the direction only and emit a hint asking for them.",
    "* Write dashes as a plain hyphen (-). Never use an em dash.",
    "- masteryCriteria: exactly one line",
    "* No sentence starting with It is important to, Rationale:, This ensures, Note that, or similar",
    "* Lesson Set Up: arrangement, learner readiness, and when to pause or resume. No reminders about data sheets or timers.",
    "* SD examples: neutral third-person phrasing",
    "* Length follows operational completeness, not brevity. Say the whole condition rather than a clipped fragment of it, and stop when the technician could run the program from what is written.",
    "",
    "Terminology standards, non-negotiable:",
    "* Name behavior targeted for reduction the way a payer reads it: \"behaviors targeted for reduction\", or \"maladaptive behavior\" where the goal replaces something like self-injury and the insurer needs it spelled out. \"interfering behavior\" is acceptable. NEVER write \"problem behavior\" or \"challenging behavior\" in a plan.",
    "* Reinforcement is contingent on behavior, never delivered to people. Never write [CLIENT] is reinforced. Write deliver reinforcement contingent on [target behavior] or [behavior] is reinforced on [schedule].",
    "* Use precise behavior-analytic verbs: prompt, fade, model, shape, chain, present the SD, deliver/withhold reinforcement, run a probe, conduct a trial, mass trial, intersperse.",
    "* Do not substitute loose synonyms (reward, encourage, motivate). Plain operational language only.",
    "* Expand every acronym on first use, then abbreviate: Functional Communication Training (FCT), Augmentative and Alternative Communication (AAC), Discrete Trial Training (DTT).",
    "* Cut words that carry no clinical precision: utilize, facilitate, appropriate, effectively, demonstrated the ability to, engaged in the activity of. Use the plain verb instead.",
  ].join("\n");

  // Additive hint instructions - the core prompt above matches the standalone page.
  var HINTS_BLOCK = "\n\nHINTS: additionally include a top-level \"hints\" key, an array of {section, code, detail} objects flagging ONLY missing or ambiguous elements (max 3; empty [] when the draft stands on its own). section is one of: " + SECTION_IDS.join(", ") + ". code is one of: thin_section (a section lacks operational specifics technicians need), ambiguous_item (detail = what needs clarifying, 10 words max), other (detail = the question). Never fabricate to avoid a hint.";

  function buildUserPrompt(values) {
    return "Treatment Goal:\n" + (values.goal || "") + "\n\nSAP Specifications:\n" + ((values.sapSpecs || "").trim() || "(No additional specifications provided, apply standard best-practice defaults.)");
  }

  function buildLabeledPrompt(values) {
    var sys = [
      "You are a BCBA writing a Service Authorization Plan (SAP) for behavior technicians.",
      "",
      "WHO READS THIS AND WHEN. The technician reads the plan BEFORE the session, not during a trial. They have been trained on the procedures; the plan's job is to carry enough specific detail that the training comes back to them and they can run THIS program. Do not compress. A clause that names the actor, the stimulus or the condition earns its place. Length follows operational completeness, not brevity.",
      "Exception in the other direction: the Purpose field states the clinical indication (what functional skill deficit is targeted and what independence outcome the goal supports).",
      "All other fields: no rationale, no padding. Staff are trained.",
      "",
      "NAMING THE ACTOR, AND THEN NOT NAMING IT AGAIN. Say who does what rather than issuing a bare instruction: 'the technician presents the array' beats 'present the array'. Then stop saying it.",
      "NAME ONCE AT THE SHIFT, THEN LET IT RIDE. Once a sentence has established who is acting, the following sentences in that section must NOT restate the actor. Drop the subject and carry on. Restate an actor only when the actor genuinely changes.",
      "HARD CEILINGS, measured on real output and on 7 human-written plans:",
      "* The client placeholder appears in AT MOST half the sentences of any section. In human plans it runs about one sentence in five.",
      "* No more than TWO sentences in any section may begin with the same first two words. Restructure the third: lead with the condition, lead with the stimulus, or fold it into the previous sentence.",
      "* Vary sentence length deliberately within every section. Put a short sentence next to a long one.",
      "Where a protocol involves more than one adult, expand each role once and then abbreviate: Client (C), Prompting Partner (PP), Communicative Partner (CP). Repetition of clinical TERMS is unavoidable and correct; repetition of SENTENCE SHAPE is what to avoid.",
      "",
      "Terminology standards, non-negotiable:",
      "* Name behavior targeted for reduction the way a payer reads it: \"behaviors targeted for reduction\", or \"maladaptive behavior\" where the goal replaces something like self-injury and the insurer needs it spelled out. \"interfering behavior\" is acceptable. NEVER write \"problem behavior\" or \"challenging behavior\" in a plan.",
      "* Reinforcement is contingent on behavior, never delivered to people. Never write [CLIENT] is reinforced.",
      "* Use precise behavior-analytic verbs: prompt, fade, model, shape, chain, present the SD, errorless teaching, DRO, DRA, time delay, BST.",
      "* Do not substitute loose synonyms (reward, encourage, motivate). Plain operational language only.",
      "",
      "Given a treatment goal and SAP specifications, return exactly the following labeled sections",
      "(label on its own line, content below, blank line before next label).",
      "No preamble, no commentary after the last section.",
      "",
      "REFINED TREATMENT GOAL",
      "[Refined SMART goal, preserve clinician wording wherever possible. Only fill in missing SMART elements. If timeframe is missing add 'by the end of 1 authorization period'.]",
      "",
      "EXERCISE",
      "Purpose:",
      "[* clinical indication: functional skill deficit or behavioral barrier addressed]",
      "[* functional outcome: independence or safety gain this goal targets]",
      "",
      "Teaching Strategy:",
      "[Strategy name, then briefly how it applies to THIS program, the actual target, arrangement, stimuli or contingency from the goal above, and who does what. Not the method in the abstract, and not an argument for why the method was chosen. 2-4 sentences, or * bullets where the strategy has distinct components.]",
      "",
      "Lesson Set Up:",
      "[* how the space and stimuli are arranged for THIS target, the actual materials and positions]",
      "[* how to tell the learner is ready, and how to pick the moment to run it]",
      "[* what to do if the program has to pause, and what has to be true to resume. A basic need outranks the program: if distress interferes with eating, toileting or sleep, let the client meet the need, re-pair, and resume at baseline.]",
      "",
      "SD (Demand / Discriminative Stimulus):",
      "[* What adult says/does, use [CLIENT] for client]",
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
      "[Prompting direction as the clinician states it, e.g. Most-to-Least (MtL) or Least-to-Most (LtM)]",
      "[* ABBR (Full Prompt Name): what the technician does at this level]",
      "[one line per level the clinician actually uses. 3 to 7 is normal; do not pad to a fixed count and do not invent a level scheme]",
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
      "[(1) step, name who does what, and the actual prompt level, stimuli or contingency for THIS program]",
      "[(2) step]",
      "[(3) step]",
      "[One additional rule if warranted]",
      "",
      "During Maintenance:",
      "[(1) step, same: actor and condition, not the generic procedure]",
      "[(2) step]",
      "[One additional rule if warranted]",
      "",
      "Note: [how many consecutive maintenance probes below criteria trigger BCBA contact and re-entry to teaching, must agree with the Maintenance Criteria above]",
      "",
      "Write dashes as a plain hyphen (-). Do not use an em dash.",
      "Expand every acronym on first use, then abbreviate. Cut words that carry no clinical precision (utilize, facilitate, appropriate, effectively).",
    ].join("\n");

    var user = "Treatment Goal:\n" + (values.goal || "") + "\n\nSAP Specifications:\n" + ((values.sapSpecs || "").trim() || "(No additional specifications, apply best-practice defaults.)");
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

  // The re-entry note used to be pushed unconditionally with a hardcoded probe
  // count. Two problems: an errorCorrection the model failed to fill still
  // rendered ~119 characters, so the section looked populated to any emptiness
  // check; and the fixed "2 consecutive probes" could contradict the schedule
  // the model wrote in generalization.maintenance. The rule now comes from the
  // model, which is told to keep it consistent, and it only annotates a section
  // that actually has steps in it.
  function formatErrorCorrection(ec) {
    var parts = [];
    if (ec.initial)     parts.push("During Initial Teaching:\n" + ec.initial);
    if (ec.maintenance) parts.push("During Maintenance:\n"      + ec.maintenance);
    if (!parts.length) return "";
    parts.push("Note: " + (ec.reentryRule || REENTRY_FALLBACK));
    return parts.join("\n\n");
  }

  function normalizeOutput(raw) {
    var o = raw && typeof raw === "object" ? raw : {};
    var out = {
      refinedGoal: typeof o.refinedGoal === "string" ? o.refinedGoal : "",
      exercise: formatExercise(o.exercise || {}),
      generalization: formatGeneralization(o.generalization || {}),
      errorCorrection: formatErrorCorrection(o.errorCorrection || {}),
      hints: normalizeHints(o.hints, HINT_CATALOG, SECTION_IDS),
    };
    // The three revision keys the engine reads back. Kept separate from the
    // note's own fields because they never reach the EHR: an answer is shown
    // in the panel and a routing decision is consumed before render.
    return Object.assign({}, out, normalizeRevision(o, SECTION_IDS));
  }

  /* The engine's default triage is written for session notes: it asks for
     counts, rates and how the session compared to recent ones. A SAP has no
     session behind it, so every one of those questions is unanswerable here.

     What actually goes missing in a program plan is specification, and the tool
     invites the omission: sapSpecs is optional, so the commonest input by far
     is a goal on its own. That is precisely when the draft falls back on
     generic best practice, which is the register that scored 100% in the first
     place. The prompt hierarchy leads because it is the one gap where a
     plausible invention is actively unsafe: a technician runs whatever levels
     are on the page, and the tool used to manufacture four of them. */
  var TRIAGE_SYSTEM =
    "You are reviewing a clinician's treatment goal and program specifications BEFORE they are turned into a formal Service Authorization Plan (SAP).\n\n" +
    "Your ONLY job: decide whether anything is too thin to write from, and if so ask the short, specific questions that would materially change the finished plan.\n\n" +
    "ASK ABOUT, in this order of value:\n" +
    "* The prompt hierarchy. If the specifications do not name the levels, ask which prompts this clinician uses for this program and in what order. Real hierarchies run 3 to 7 levels and the labels are the clinician's own. A technician runs whatever levels the plan lists, so inventing them is the costliest gap here. Ask this first.\n" +
    "* Mastery criteria, when no accuracy figure and no number of sessions is stated.\n" +
    "* The maintenance probe schedule, when it is absent. The plan's re-entry rule has to agree with it, so a missing schedule makes the two contradict.\n" +
    "* Teaching format (discrete trial, natural environment, or a mix), the exact wording of the SD, or the generalization targets across people, settings and stimuli, when one of those is load-bearing for this goal and absent.\n\n" +
    "RULES\n" +
    "* Be specific and quote back what they wrote. \"You wrote least-to-most: which levels, in order?\" NOT \"Can you add more detail?\"\n" +
    "* NEVER ask for a name, a date, an address, a diagnosis, or any other identifying detail. This input is deliberately de-identified and must stay that way.\n" +
    "* Ask only for specification the clinician already has and did not write down. Never ask them to justify a clinical choice, and never offer a clinical opinion.\n" +
    "* Do not ask about anything the goal itself already answers.\n" +
    "* Write dashes as a plain hyphen (-). Never use an em dash.\n" +
    "* If the specifications are adequate, return sufficient=true and an empty array. Fewer questions is better than more, and HOW MANY TO ASK below is the only ceiling.\n" +
    // Stated once, at the end of the composed prompt, by the shared READINESS
    // block. A partial version here names a second object.
    "* Return ONLY a JSON object. No markdown, no preamble, no commentary.";

  window.NOTE_TOOLS.push({
    id: "sap",
    label: "SAP",
    title: "SAP Goals & Planning Tool",
    subtitle: "Enter a treatment goal and SAP specifications, generate a prompt or draft a complete Service Authorization Plan for clinical review.",
    assistantIntro: "Enter the treatment goal and any SAP specifications, then press Generate SAP. I'll ask about anything that looks thin before drafting, then you can click any section, or select a phrase inside one, to revise it.",
    genLabel: "Generate SAP",
    outputTitle: "Generated SAP Draft",
    promptIntro: "Copy and paste into your AI of choice. It will return a refined SMART goal and complete SAP draft, no preamble, no editorializing.",
    maxTokens: 3500,
    inputs: [
      {
        id: "goal", type: "textarea", label: "Treatment Goal", required: true, height: 120, charCount: true,
        tooltip: SMART_TOOLTIP,
        hint: "Write a SMART goal tied to the client's diagnosis and functional needs, without PHI. Hover the i icon to see what makes a goal SMART.",
        placeholder: "e.g., [Client] will independently request preferred items or activities using their AAC device in 4 out of 5 opportunities, absent behaviors targeted for reduction, across 3 consecutive sessions within 1 authorization period, as measured by direct observation during structured and unstructured activities.",
      },
      {
        id: "sapSpecs", type: "textarea", label: "SAP Specifications", height: 150, charCount: true,
        tip: "The AI will draft a best-practice SAP template based on your goal, but it has no access to client-specific details. Include relevant considerations here (without PHI): teaching format (DTT vs NET), prompt hierarchy preferences, number of trials, mastery criteria, generalization targets (settings, people, stimuli), error correction protocol, session structure, or any deviations from standard practice. The more context you provide, the more tailored the draft will be.",
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
    responseSchema: RESPONSE_SCHEMA,
    /* TRIAGE_SYSTEM is still read here, and it still has to be. It is the
       source verify-parity.mjs composes the stored sap_triage prompt from, and
       it is what runs if this tool is ever un-migrated. What it no longer does
       is travel to the Worker: triageKind names the stored copy instead.

       These two lines are one fact in two halves, and server-prompt.spec.js
       fails a migrated tool that has the override without the key. Deleting
       either one alone asks a clinician the wrong questions without erroring. */
    triageSystem: TRIAGE_SYSTEM,
    triageKind: "sap_triage",
    triageIntro: "CLINICIAN'S GOAL AND SPECIFICATIONS:",
    validate: function (values) {
      if (!(values.goal || "").trim()) return "Please enter a treatment goal.";
      return null;
    },
    /* This tool's system prompt is composed inside the Worker, from the prompt
       store, and is not sent from here.

       buildSystem stays because buildLabeledPrompt below is the logged-out
       copy-prompt path, and his 2026-08-04 ruling keeps that a logged-out
       feature. So the clinical rules were always going to reach a browser that
       asked for them. What migrating buys is the other half: /api/llm-call no
       longer accepts a system prompt for sap, so a password holder can no longer
       run a prompt of their own choosing on the account's Anthropic key.

       The stored copy and this one are held together by verify-parity.mjs in
       voice-module, which composes THIS file from the deployed site and fails
       on a difference. An edit here without a matching extraction there is a
       drift CI catches, but only on the next push to that repo. */
    serverPrompt: true,
    buildSystem: function () { return SYSTEM_PROMPT + (window.NoteRegisterRules ? window.NoteRegisterRules.constructions : "") + HINTS_BLOCK; },
    buildUserPrompt: buildUserPrompt,
    buildLabeledPrompt: buildLabeledPrompt,
    normalizeOutput: normalizeOutput,
  });
})();
