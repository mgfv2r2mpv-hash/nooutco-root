/* SAP Goals & Planning tool config.
 *
 * WHAT CHANGED ON 2026-09-07, and why the file looks different.
 *
 * This tool used to return four nested objects and render four cards. The
 * Exercise card alone hid eight company-required blocks behind one key, and
 * formatExercise dropped the label of any block the model left empty - so a
 * plan that lost Purpose and Prompt Hierarchy came back looking like a plan
 * with a shorter Exercise section, and nothing in the shape gate could tell
 * the difference. The gate checks that four keys are PRESENT; twelve of the
 * thirteen required blocks were never keys at all.
 *
 * All thirteen are keys now. Each one is its own card, its own click target,
 * its own diff, and its own line in the shape gate. Copy still hands back the
 * four fields the EHR actually has, with the eight labels typed inside the
 * Exercise block exactly as they read today - see COPY_GROUPS.
 *
 * The second change is stance. The old prompt forbade the tool an opinion, and
 * the old triage asked a clinician to supply mechanics it was not allowed to
 * propose. A SAP is a DESIGN document: the BCBA is designing an intervention,
 * not reporting a session that already happened, so there is no observation to
 * be faithful to and nothing is gained by refusing to draft a hierarchy. The
 * tool now designs the plan and says what it chose, and triage asks only about
 * the learner - the things no amount of ABA knowledge can supply.
 */
(function () {
  var U = window.NoteToolsUtil;
  var normalizeHints = U.normalizeHints;
  var normalizeRevision = U.normalizeRevision;
  var hintSchema = U.hintSchema;

  var SMART_TOOLTIP = "SMART goals are: Specific (clearly defines the target behavior and context, what, where, with whom), Measurable (includes quantifiable criteria, e.g. \"4 out of 5 opportunities\" or \"80% accuracy\"), Achievable (realistic within the authorization period given the client's current baseline), Relevant (tied to the client's diagnosis, functional independence, and medical necessity, not academics), and Time-bound (specifies a timeframe, e.g. \"within 1 authorization period\" or \"across 3 consecutive sessions\").";

  /* THIRTEEN, and the order is the order they are read in.
   *
   * These are flat top-level string keys now, not three nested objects. The
   * engine derives expectKeys from formSections, so flattening is what finally
   * puts every company-required block under the shape gate. */
  var SECTION_IDS = [
    "refinedGoal",
    "purpose",
    "teachingStrategy",
    "lessonSetUp",
    "sd",
    "correctResponse",
    "incorrectResponse",
    "masteryCriteria",
    "promptHierarchy",
    "generalizationCriteria",
    "maintenanceCriteria",
    "errorCorrectionInitial",
    "errorCorrectionMaintenance",
  ];
  // Bound after SECTION_IDS, which it reads: `var` hoists the declaration but
  // not the value, so binding this above would seal the enum as undefined.
  var revision = U.revisionKeys(SECTION_IDS);

  // Used only when the model omits reentryRule. Single-sourced so the JSON path
  // and the copy-paste path cannot drift apart.
  var REENTRY_FALLBACK = "After 2 consecutive maintenance probes below Maintenance Criteria, contact BCBA so a skill can re-enter teaching.";

  /* The re-entry rule is a model field and NOT a fourteenth card. It is one
     sentence, it belongs under the maintenance steps, and it renders exactly
     where it renders today: as the trailing "Note:" line of the Error
     Correction - Maintenance block. NOTE_PREFIX is how both the draft path and
     the revision path find it, so the two cannot drift. */
  var NOTE_PREFIX = "Note: ";

  var HINT_CATALOG = {
    thin_section: "This section is thin relative to what technicians need to implement, add specifics if you have them",
    ambiguous_item: "Clarify",
    other: "",
  };

  /* THE FOUR FIELDS THE EHR ACTUALLY HAS.
   *
   * The thirteen-way split is for editing. The company form has four boxes,
   * and the eight Exercise labels are typed into the second box as text. So
   * Copy reassembles them here, and the output is byte-identical to what this
   * tool produced before the split - which is the whole point of splitting for
   * editing rather than splitting the form.
   *
   * A block with no content drops out with its label, which is what the old
   * formatExercise did. The difference is that an empty block is now a visible
   * empty card and a missing key the gate rejects, so it can no longer vanish
   * quietly on its way to the clipboard. */
  var COPY_GROUPS = [
    { heading: "Treatment Goal (Refined)", parts: [{ id: "refinedGoal", label: "" }] },
    {
      heading: "Exercise",
      parts: [
        { id: "purpose", label: "Purpose" },
        { id: "teachingStrategy", label: "Teaching Strategy" },
        { id: "lessonSetUp", label: "Lesson Set Up" },
        { id: "sd", label: "SD (Demand / Discriminative Stimulus)" },
        { id: "correctResponse", label: "Correct Response" },
        { id: "incorrectResponse", label: "Incorrect Response" },
        { id: "masteryCriteria", label: "Mastery Criteria" },
        { id: "promptHierarchy", label: "Prompt Hierarchy" },
      ],
    },
    {
      heading: "Generalization",
      parts: [
        { id: "generalizationCriteria", label: "Generalization Criteria" },
        { id: "maintenanceCriteria", label: "Maintenance Criteria" },
      ],
    },
    {
      heading: "Error Correction",
      parts: [
        { id: "errorCorrectionInitial", label: "During Initial Teaching" },
        { id: "errorCorrectionMaintenance", label: "During Maintenance" },
      ],
    },
  ];

  var str = { type: "string" };

  /* WHAT THE TOOL CHOSE, AND WHAT YOU WOULD MOVE TO CHANGE IT.
   *
   * The tool is allowed to design now, which makes "where did this come from?"
   * a question the clinician is entitled to ask about every block on the page.
   * One line per designed block answers it: the choice, and the single lever
   * that would change it. `proposed` separates the tool's own ABA judgement
   * from a block that only rephrases what the clinician wrote, because the
   * first deserves a mark on the card and the second does not.
   *
   * Every proposal is ACCEPTED BY DEFAULT. That is his ruling and it is the
   * generous reading: the plan is complete the moment it is drafted, and a
   * proposal is dropped with one click rather than taken with one. */
  var DESIGN_SCHEMA = {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["section", "choice", "lever", "proposed"],
      properties: {
        section: { type: "string", enum: SECTION_IDS },
        choice: {
          type: "string",
          description: "What you chose for this block, in one clause a BCBA reads at a glance. " +
            "Name the procedure, not the reasoning. Under 15 words.",
        },
        lever: {
          type: "string",
          description: "The ONE thing about this learner that would change the choice above. " +
            "Written so the clinician can tell at a glance whether it applies to their client. " +
            "Under 15 words.",
        },
        proposed: {
          type: "boolean",
          description: "true when this block is your own clinical design. false when it only " +
            "restates a mechanic the clinician already specified. Be honest: a block marked " +
            "false that they never wrote is the one failure this field exists to prevent.",
        },
      },
    },
  };

  /* WHERE THE PLAN DISAGREES WITH ITSELF.
   *
   * Not an arithmetic check. The commonest real inconsistency in a program plan
   * is a procedure NAMED one thing and DESCRIBED as another - "NET" over a
   * description of discrete trials at a table, "Most-to-Least" over a trial
   * that starts independent. A technician runs the description and a supervisor
   * reads the label, so the two disagreeing is a plan that gets implemented
   * differently from the plan that was approved.
   *
   * A conflict is REPORTED, never resolved. The readings are named accurately
   * and the clinician picks, because "Most-to-Least written by mistake" and "a
   * prompt delay described correctly" are different procedures and only the
   * person who wrote it knows which one they meant. */
  var CONFLICT_SCHEMA = {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["sections", "kind", "question", "readings"],
      properties: {
        sections: {
          type: "array",
          items: { type: "string", enum: SECTION_IDS },
          description: "Every section this disagreement spans. Usually two.",
        },
        kind: {
          type: "string",
          enum: ["label_vs_description", "description_vs_description", "undefined_level", "figures"],
          description: '"label_vs_description" when a named procedure and its description are ' +
            'different procedures. "description_vs_description" when two blocks describe ' +
            'incompatible arrangements. "undefined_level" when a prompt level or term is used ' +
            'that the plan never defines. "figures" when two numbers disagree.',
        },
        question: {
          type: "string",
          description: "Quote both sides back and ask which holds. Never assert that one is " +
            "wrong. Under 45 words.",
        },
        readings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["name", "consequence"],
            properties: {
              name: { type: "string", description: "The procedure's real name, as a BCBA would say it." },
              consequence: { type: "string", description: "What a technician would actually do under this reading. One clause." },
            },
          },
          description: "Two or three genuinely different procedures that fit what they wrote. " +
            "Include the deliberate hybrid or the third procedure where one is live - a check " +
            "that cannot say \"you are running a mixed format\" is a check that argues with a " +
            "correct plan.",
        },
      },
    },
  };

  /* THE DRAFT SCHEMA. Thirteen flat sections, all required, plus reentryRule.
   *
   * The API constrains output to a subset of JSON Schema - no recursion, no
   * numeric bounds, no string lengths - and every object must seal itself with
   * additionalProperties:false. Every section is listed in `required`: an
   * optional key is one the model may omit, which is the blank-section hole the
   * shape gate exists to catch, and having only four keys is what let eight
   * required blocks sit outside that guarantee for as long as they did. */
  var RESPONSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: SECTION_IDS.concat(["reentryRule", "hints", "design", "conflicts"]),
    properties: {
      refinedGoal: str,
      purpose: str,
      teachingStrategy: str,
      lessonSetUp: str,
      sd: str,
      correctResponse: str,
      incorrectResponse: str,
      masteryCriteria: str,
      promptHierarchy: str,
      generalizationCriteria: str,
      maintenanceCriteria: str,
      errorCorrectionInitial: str,
      errorCorrectionMaintenance: str,
      reentryRule: {
        type: "string",
        description: "One line: how many consecutive maintenance probes below criteria trigger " +
          "BCBA contact and re-entry to teaching. This MUST agree with the probe schedule in " +
          "maintenanceCriteria. It is appended to Error Correction - Maintenance as a Note line.",
      },
      hints: hintSchema(HINT_CATALOG, SECTION_IDS),
      design: DESIGN_SCHEMA,
      conflicts: CONFLICT_SCHEMA,
      bcbaQuestion: revision.bcbaQuestion,
      answer: revision.answer,
      crossSection: revision.crossSection,
    },
  };

  /* THE REVISION SCHEMA, and the reason the plan stopped shrinking.
   *
   * A revision used to ask for the COMPLETE updated object with all keys, every
   * unaffected section copied verbatim. That is roughly 2,500 tokens of prose
   * the model has to re-type to change one sentence, and models do not re-type
   * 2,500 tokens - they paraphrase. Every paraphrase came back as a real diff
   * against the previous text, so the clinician was shown entire sections
   * struck through in red for a change they did not ask for, on every turn.
   *
   * Now it names only what it is changing. A section it does not name is
   * untouched BY CONSTRUCTION rather than by the model's diligence, so a
   * section can no longer shrink by accident - only by being named.
   *
   * `dependents` is the other half. An edits-only contract introduces staleness
   * the whole-note contract did not have: change the mastery figure and the
   * goal's own ratio still says the old one. So the model reports the blocks
   * its own edit made stale in the SAME reply, which costs no extra call, and
   * those are applied and marked as the tool's doing. */
  function editList(what) {
    return {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "content", "why"],
        properties: {
          section: { type: "string", enum: SECTION_IDS },
          content: { type: "string", description: "The COMPLETE new text of this block. Not a diff, not a fragment." },
          why: { type: "string", description: "One short clause the clinician reads, naming what sent the change here." },
        },
      },
      description: what,
    };
  }

  var REVISION_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["edits", "dependents", "conflicts", "hints", "design"],
    properties: {
      edits: editList(
        "Every block you are changing, and NOTHING else. A block you do not list " +
        "is left exactly as it stands, so there is no reason to list one you are not changing."
      ),
      dependents: editList(
        "Blocks the clinician did not ask you to touch, that YOUR edit above just made " +
        "stale or contradictory. You changed the number, so you know which blocks quote it. " +
        "Fix them here and they are applied with a mark saying you did it. Empty is the " +
        "normal case."
      ),
      conflicts: CONFLICT_SCHEMA,
      hints: hintSchema(HINT_CATALOG, SECTION_IDS),
      design: DESIGN_SCHEMA,
      bcbaQuestion: revision.bcbaQuestion,
      answer: revision.answer,
      crossSection: revision.crossSection,
    },
  };

  /* ── The drafting prompt ────────────────────────────────────────────────
     Composed here and stored server-side. verify-parity.mjs in voice-module
     re-derives the stored copy from THIS file as it is deployed, and fails on a
     difference, so an edit here is a two-repo edit. */
  /* HIS STANDING DEFAULTS, given 2026-09-09.
   *
   * The prompt already told the model to design rather than refuse. It gave it
   * nothing to design FROM, so "design a hierarchy appropriate to this target"
   * resolved to whatever the model reads as reasonable, which is not the same
   * thing twice and is not his clinic's standard once. These are the house
   * standards: the toolkit a BCBA here would reach for when the specifications
   * settle nothing.
   *
   * NOT A CLOSED LIST, ruled 2026-09-10. He gave these as EXAMPLES, and said so
   * plainly: ABA carries researched heuristics the way any field does, he could
   * not write them all out, and the expert should reach for the established one
   * whenever the BCBA left a mechanic alone. The first framing said "do not
   * invent one", which a model reads as a ceiling on the whole field rather
   * than a ban on making things up, and that is exactly how a block goes thin:
   * the BCBA skipped it BECAUSE it is standard. So the framing licenses the
   * field, the list pins the house calls, and the learner-facts rule above is
   * what still holds the line on invention.
   *
   * Shared by SYSTEM_PROMPT and buildLabeledPrompt on purpose. The logged-out
   * copy path pastes into somebody else's model and should carry the same
   * clinical floor; two copies of this would drift within a month. */
  var STANDING_DEFAULTS = [
    "STANDING DEFAULTS. Where the specifications do not settle a mechanic, design it from the established standard of practice in ABA and write it out in full. A clinician leaves a standard mechanic unspecified BECAUSE it is standard, not because it is optional, so the block the specifications did not reach is the one most likely to come out thin. Give it the same detail as a block they did reach.",
    "The standards below are the ones this clinic has pinned. They are not the boundary of the field. Where they are silent the researched best practice still governs, and you design from it the same way. Depart from any standard, listed or not, only where the goal, the specifications, or a contraindication the clinician gave you calls for it, and say so in the design notes when you do.",
    "",
    "Prompting.",
    "* Use the least restrictive controlling prompt: the least intrusive level that reliably produces the response.",
    "* Most-to-Least is the default direction for a skill in acquisition. Where the clinician's input shows the learner already performs the skill in part, use Least-to-Most instead, which accelerates the run to mastery.",
    "* Never write a vocal prompt for a vocal response. A vocal prompt on a vocal target is hard to fade.",
    "* Prompt early and escalate the prompt rather than let a trial be abandoned.",
    "* Never use physical force to overcome prompt rejection or resistance. Where the learner blocks or pulls away, drop to a less intrusive level and re-present.",
    "* After 2 consecutive errors on a program, revert to the last mastered prompt level for the remainder of the session and raise it to the BCBA.",
    "",
    "Reinforcement.",
    "* FR1 for a skill in acquisition: reinforcement is delivered contingent on every correct response.",
    "* Differentially reinforce independence. An independent response, and a closer approximation to independence, earns more reinforcement than a prompted one.",
    "* Fade reinforcement across generalization and maintenance so the skill survives under natural contingencies.",
    "* Never reprimand. An error is corrected, never marked.",
    "",
    "Mastery, maintenance and re-entry.",
    "* Mastery default: 80% accuracy over a minimum of 5 trials, across 3 consecutive sessions. Three consecutive sessions is what isolates the criterion from single-session variables, so never write it as one session or two.",
    "* Maintenance probes run at 3 trials.",
    "* Re-entry default: after 2 sessions below the mastery criterion, contact the BCBA so the skill can re-enter teaching.",
    "",
    "Format and arrangement.",
    "* Build learner choice into the program wherever the target allows it.",
    "* Arrange for minimal distractions.",
    "* A non-reversible skill runs in mass trial or discrete trial training, unless the learner will not tolerate instructional blocks, in which case name what replaces it.",
    "* Vary the procedure in minor ways rather than running it identically every trial. A looser teaching style around a fixed structure is what carries the skill past the intervention into the real case.",
    "* A mand program leverages the motivating operation during acquisition. Running mands without the MO in place builds faulty stimulus control.",
    "",
    "Error correction.",
    "* Default the initial-teaching procedure to: prompt the correct response, run a distractor or transfer trial, then reset and re-present the errored trial at the original prompt level.",
    "",
    "The list above is not exhaustive. A mechanic it does not name is not thereby unsettled: write the established standard for that one too, on the same terms. This licenses standard ABA practice and nothing else. It never licenses a fact about this learner, which the rule above still forbids.",
  ].join("\n");

  var SYSTEM_PROMPT = [
    "You are a BCBA designing a Service Authorization Plan (SAP) for behavior technicians to implement.",
    "",
    "YOU ARE DESIGNING, NOT REPORTING. This is the single most important line in this prompt. A session note records what happened and must never state what was not observed. A SAP is the opposite document: nothing has happened yet, there is no session to be faithful to, and the clinician is asking you to help design an intervention. So you may and SHOULD choose the mechanics - the teaching format, the prompt hierarchy, the mastery rule, the generalization matrix, the error correction procedure - and write them into the plan as a complete, implementable design. Refusing to choose does not make the plan safer. It makes it a form with holes in it that a technician has to fill from memory.",
    "",
    "WHAT YOU STILL MAY NOT INVENT. The line is about the LEARNER, not about ABA. Never state a fact about this client that the clinician did not give you: not a baseline, not a rate, not a preference, not a history, not something that has already been tried. Where a design choice depends on such a fact, choose the option that is defensible without it and name the fact as the lever (see DESIGN NOTES below). Design freely. Never report.",
    "",
    STANDING_DEFAULTS,
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
    "Given a treatment goal and SAP specifications, return ONLY a JSON object (no markdown fences, no preamble) with these THIRTEEN section keys, each a plain string:",
    "",
    '{',
    '  "refinedGoal": "Refined SMART goal. Preserve clinician wording wherever possible, only fill in missing SMART elements (Specific target + context, Measurable criterion, Achievable, Relevant to functional independence/medical necessity, Time-bound). Add \'by the end of 1 authorization period\' if timeframe is missing.",',
    '  "purpose": "* [clinical indication: functional skill deficit or behavioral barrier addressed]\\n* [functional outcome: independence or safety gain this goal targets]",',
    '  "teachingStrategy": "[Strategy name]. [How it applies to THIS program, name the actual target, arrangement, stimuli or contingency from the goal above, not the method in the abstract. Say who does what. 2-4 sentences, or * bullets where the strategy has distinct components.]",',
    '  "lessonSetUp": "* [how the space and stimuli are arranged for THIS target, name the actual materials and positions]\\n* [how to tell the learner is ready, and how to pick the moment to run it]\\n* [what to do if the program has to pause, and what has to be true to resume]\\n* [further item only if this program needs one]",',
    '  "sd": "* [What adult says/does, use [CLIENT] for the client]\\ne.g., [3 example questions/demands in neutral third-person]\\n* [Delivery condition]",',
    '  "correctResponse": "+ [criterion]\\n+ [criterion]\\n+ [criterion if needed]",',
    '  "incorrectResponse": "- [criterion]\\n- [criterion]\\n- [criterion if needed]",',
    '  "masteryCriteria": "Minimum [N] trials at [X]% accuracy across [N] consecutive sessions.",',
    '  "promptHierarchy": "[Prompting direction, e.g. Most-to-Least (MtL) or Least-to-Most (LtM)]\\n* [ABBR] ([Full Prompt Name]): [what the technician does at this level]\\n* [one line per level, 3 to 7 of them, no padding to a fixed count]",',
    '  "generalizationCriteria": "[3-4 sentences: the contexts, people and stimuli this has to transfer to, and what counts as transferred.]",',
    '  "maintenanceCriteria": "[Schedule, probe structure, accuracy threshold. 2-4 sentences.]",',
    '  "errorCorrectionInitial": "(1) [step, name who does what, and the actual prompt level, stimuli or contingency for THIS program]\\n(2) [step]\\n(3) [step]\\n\\n[One additional rule if warranted, omit if not]",',
    '  "errorCorrectionMaintenance": "(1) [step, same: actor and condition, not the generic procedure]\\n(2) [step]\\n[One additional rule if warranted, omit if not]",',
    '  "reentryRule": "One line, no \'Note:\' prefix: how many consecutive maintenance probes below criteria trigger BCBA contact and re-entry to teaching. This MUST agree with the probe schedule in maintenanceCriteria.",',
    '  "design": [ ... see DESIGN NOTES ... ],',
    '  "conflicts": [ ... see COHERENCE ... ],',
    '  "hints": [ ... ]',
    '}',
    "",
    "EVERY ONE OF THE THIRTEEN SECTION KEYS IS REQUIRED AND NONE MAY BE EMPTY. These are the blocks the company form has boxes for. If the specifications say nothing about a block, that is not a reason to leave it out - it is the block you design. An empty string here is a hole a technician finds at the table.",
    "",
    "DESIGN NOTES. Return a \"design\" array with one entry per block you made a real choice about. Each entry names the choice in a clause and the single fact about this learner that would change it, and sets \"proposed\": true when the block is your clinical judgement rather than a restatement of what the clinician specified.",
    "* Write the lever as something the clinician can check against their client at a glance: \"if [CLIENT] already scrolls past the first icon, drop to a 2-item field\" beats \"consider array size\".",
    "* A block that only rephrases what they wrote gets \"proposed\": false, and usually needs no entry at all. Marking your own design as theirs is the one thing this field exists to prevent.",
    "* Do not write an entry for every block. Between four and nine is normal on a plan drafted from a goal alone, and fewer when the specifications were detailed.",
    "",
    "COHERENCE. Before you return, read the plan and the clinician's own input back as one document and look for the places where it disagrees with itself. Report every one in \"conflicts\". This is NOT primarily about numbers.",
    "* A procedure NAMED one thing and DESCRIBED as another. \"NET\" over a description of going to a table, running 5 to 10 trials, and going back to play - that is discrete trial teaching with a play break around it. \"Most-to-Least\" over a trial that starts independent and gives a chance to respond - that is least-to-most, or a prompt delay, and those are three different procedures.",
    "* Two blocks describing arrangements that cannot both be true. Lesson Set Up runs it at the table; the SD delivery condition fires when the client initiates during play.",
    "* A prompt level, term or step named somewhere and never defined in the Prompt Hierarchy. A technician cannot run a level that is not on the page.",
    "* Figures that disagree. The mastery accuracy against the goal's own ratio, the re-entry probe count against the maintenance schedule.",
    "RULES FOR CONFLICTS, and they matter more than finding one:",
    "* NEVER assert that the clinician made a mistake, and never silently correct one reading into the other. Quote both sides and ask which holds.",
    "* Name each reading as the real procedure it is, with what a technician would actually do under it. \"Prompt delay: independent for a set delay, then the ONE prescribed prompt, not the least prompt\" is the reading a checker that only knows MtL and LtM cannot see, and it is frequently the one they meant.",
    "* Include the legitimate third reading where one exists - a deliberately mixed format, a hybrid procedure. A check with no way to say \"you are running both on purpose\" is a check that argues with a correct plan.",
    "* Write the plan out anyway, using the reading the clinician's own words best support. A conflict is a question beside a finished plan, never a hole in it.",
    "* Empty array when the plan is coherent, which is the common case on a well-specified goal.",
    "",
    "JSON escaping, every section value is a multi-line block, so this is where output breaks:",
    "* Write each line break inside a value as \\n. Never press an actual newline inside a string.",
    "* Write every double quote inside a value as \\\". SD examples quote the demand verbatim (e.g. \\\"What is it?\\\"), and a bare quote there makes the whole object unparseable.",
    "",
    "Style rules, follow exactly:",
    "* Use [CLIENT] everywhere in place of any client name or the client in procedures",
    "* Use * for general bullets, + for correct response items, - for incorrect response items",
    "* Prompt hierarchy: where the clinician names the levels, reproduce their labels in their order. Where they do not, DESIGN a hierarchy appropriate to this target and this teaching format, name it in the design notes as yours, and make the lever the thing about the learner that would change it. Real hierarchies run 3 to 7 levels. Never pad to a fixed count. A designed hierarchy is far better than a direction with no levels under it, which is what the plan used to carry.",
    "* Write dashes as a plain hyphen (-). Never use an em dash.",
    "* masteryCriteria: exactly one line",
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
  var HINTS_BLOCK = "\n\nHINTS: additionally include a top-level \"hints\" key, an array of {section, code, detail} objects flagging ONLY missing or ambiguous elements (max 3; empty [] when the draft stands on its own). section is one of: " + SECTION_IDS.join(", ") + ". code is one of: thin_section (a section lacks operational specifics technicians need), ambiguous_item (detail = what needs clarifying, 10 words max), other (detail = the question). A block you designed yourself is NOT a hint - it goes in \"design\". Never fabricate to avoid a hint.";

  function buildUserPrompt(values) {
    return "Treatment Goal:\n" + (values.goal || "") + "\n\nSAP Specifications:\n" + ((values.sapSpecs || "").trim() || "(No additional specifications provided. Design the plan.)");
  }

  /* The logged-out copy-prompt path, kept a logged-out feature by his ruling of
     2026-08-04. It returns the FOUR labeled EHR fields, because whoever pastes
     this into another model is pasting the result into the company form, not
     into this tool. */
  function buildLabeledPrompt(values) {
    var sys = [
      "You are a BCBA designing a Service Authorization Plan (SAP) for behavior technicians.",
      "",
      "YOU ARE DESIGNING, NOT REPORTING. Nothing has happened yet: the clinician is asking you to help design an intervention, so choose the mechanics - teaching format, prompt hierarchy, mastery rule, generalization matrix, error correction - and write a complete, implementable plan. Never state a fact about the CLIENT that the clinician did not give you: no baseline, no rate, no preference, no history. Design freely, report nothing.",
      "",
      STANDING_DEFAULTS,
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
      "[Prompting direction, e.g. Most-to-Least (MtL) or Least-to-Most (LtM)]",
      "[* ABBR (Full Prompt Name): what the technician does at this level]",
      "[one line per level. Where the clinician named the levels, use theirs. Where they did not, design a hierarchy suited to this target and say so. 3 to 7 levels; do not pad to a fixed count]",
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
      "COHERENCE CHECK",
      "[Read the plan and the specifications back as one document. List every place a procedure NAMED one thing is DESCRIBED as another - NET described as table trials, Most-to-Least described as starting independent - plus any arrangement, undefined prompt level or figure that disagrees with another. Quote both sides, name each reading as the real procedure it is, and ask which holds. Never assert a mistake. Write 'No inconsistencies found.' when there are none.]",
      "",
      "Write dashes as a plain hyphen (-). Do not use an em dash.",
      "Expand every acronym on first use, then abbreviate. Cut words that carry no clinical precision (utilize, facilitate, appropriate, effectively).",
    ].join("\n");

    var user = "Treatment Goal:\n" + (values.goal || "") + "\n\nSAP Specifications:\n" + ((values.sapSpecs || "").trim() || "(No additional specifications. Design the plan.)");
    return sys + "\n\n---\n\n" + user;
  }

  function s(v) { return typeof v === "string" ? v : ""; }

  /* The Note line is appended here, on the draft path only, and only to a
     maintenance block that actually has steps in it. An errorCorrection the
     model failed to fill used to render ~119 characters of boilerplate, so the
     section looked populated to any emptiness check. */
  function withReentry(maintenance, reentryRule) {
    var body = s(maintenance).trim();
    if (!body) return "";
    return body + "\n\n" + NOTE_PREFIX + (s(reentryRule).trim() || REENTRY_FALLBACK);
  }

  function normalizeOutput(raw) {
    var o = raw && typeof raw === "object" ? raw : {};
    var out = {};
    SECTION_IDS.forEach(function (id) { out[id] = s(o[id]); });
    out.errorCorrectionMaintenance = withReentry(o.errorCorrectionMaintenance, o.reentryRule);
    out.hints = normalizeHints(o.hints, HINT_CATALOG, SECTION_IDS);
    out.design = U.normalizeDesign(o.design, SECTION_IDS);
    out.conflicts = U.normalizeConflicts(o.conflicts, SECTION_IDS);
    return Object.assign({}, out, normalizeRevision(o, SECTION_IDS));
  }

  /* THE REVISION PATH'S NORMALIZER. Takes the model's edits plus the note as it
     currently stands, and returns a whole note. Merging here rather than in the
     engine means the engine's existing diff-and-review machinery sees exactly
     what it always saw - a complete note - and every section the model did not
     name is carried across byte-identical, so it produces no diff at all.
     That is the fix: a section can no longer shrink unless it was named. */
  function mergeRevision(raw, current) {
    var o = raw && typeof raw === "object" ? raw : {};
    var cur = current && typeof current === "object" ? current : {};
    var edits = U.normalizeEdits(o.edits, SECTION_IDS);
    var dependents = U.normalizeEdits(o.dependents, SECTION_IDS);
    var out = {};
    SECTION_IDS.forEach(function (id) { out[id] = s(cur[id]); });
    edits.concat(dependents).forEach(function (e) { out[e.section] = e.content; });
    /* A DETERMINISTIC FLOOR ON THE ONE LINE THE COMPANY FORM REQUIRES.
       The re-entry rule lives inside the maintenance block's text, so a model
       rewriting that block can drop it while doing exactly what it was asked.
       If the block had a Note line before the edit and the new text has none,
       the old line is carried across. The clinician can still delete it by
       hand; only the model is stopped from losing it in passing. */
    var prev = s(cur.errorCorrectionMaintenance);
    var next = out.errorCorrectionMaintenance;
    if (next && next !== prev && prev.indexOf("\n" + NOTE_PREFIX) !== -1 && next.indexOf(NOTE_PREFIX) === -1) {
      out.errorCorrectionMaintenance = next.trim() + "\n\n" + prev.slice(prev.lastIndexOf("\n" + NOTE_PREFIX) + 1);
    }
    out.hints = normalizeHints(o.hints, HINT_CATALOG, SECTION_IDS);
    out.design = U.normalizeDesign(o.design, SECTION_IDS);
    out.conflicts = U.normalizeConflicts(o.conflicts, SECTION_IDS);
    // Which sections the model itself said it changed on its own initiative,
    // so the engine can mark them without re-deriving the intent from a diff.
    out.dependentSections = dependents.map(function (e) { return e.section; });
    // And why each block moved, in the model's own words, keyed by section. The
    // engine shows this to the clinician verbatim; a change it cannot explain
    // is a change that arrives unannounced somewhere they were not looking.
    out.editReasons = {};
    edits.concat(dependents).forEach(function (e) { out.editReasons[e.section] = e.why; });
    return Object.assign({}, out, normalizeRevision(o, SECTION_IDS));
  }

  /* ── The triage prompt ──────────────────────────────────────────────────
     REWRITTEN 2026-09-07. The old one asked for the prompt hierarchy first, on
     the reasoning that a technician runs whatever levels are on the page and an
     invented hierarchy is unsafe. That reasoning held while the tool was
     forbidden to design. It is now allowed to, and a designed hierarchy that
     says it is designed and names its lever is better than a plan with a
     direction and no levels under it - which is what asking-first actually
     produced, because sapSpecs is optional and the commonest input by far is a
     goal on its own.

     So triage asks about the LEARNER: the things no amount of ABA knowledge can
     supply, and the clinician alone holds. Readiness stops grading their
     paperwork and starts grading how tailored the plan can be. */
  var TRIAGE_SYSTEM =
    "You are helping a clinician DESIGN a Service Authorization Plan (SAP). You read their treatment goal and program specifications BEFORE the plan is drafted.\n\n" +
    "Your ONLY job: ask the few questions about THIS LEARNER that would make the drafted plan meaningfully more tailored, and flag where their own input contradicts itself.\n\n" +
    "WHAT NOT TO ASK. Do not ask for plan mechanics. The drafter designs the teaching format, the prompt hierarchy, the mastery criteria, the trial count, the generalization matrix, the maintenance schedule and the error correction procedure, and it marks each one as its own so the clinician can change it in a click. Asking a BCBA to supply a mechanic the tool is about to design anyway wastes the one round trip you get.\n\n" +
    "ASK ABOUT THE LEARNER, in this order of value. These are the things no amount of behavior-analytic knowledge can supply and the clinician alone holds:\n" +
    "* The current repertoire this goal builds on. What can they already do that is adjacent to the target, and where does it break down? This changes the entry point of the plan more than any other single fact.\n" +
    "* What competes with the target behavior, and what the learner does instead when the demand goes up.\n" +
    "* What has already been tried for this skill and how it went. A plan that re-proposes a failed procedure is the costliest thing this tool can produce.\n" +
    "* Motivation and reinforcers, in operational terms: what they will work for, and what has stopped working.\n" +
    "* Where the skill actually has to work - which people, settings and moments in the day. This is what makes the generalization matrix real rather than generic.\n" +
    "* Any constraint the plan has to live inside: session length, staffing, a caregiver's capacity, a physical or communicative limitation that rules a procedure out.\n\n" +
    "COHERENCE. Read their input back and flag where it disagrees with itself. This is NOT mainly about numbers.\n" +
    "* A procedure NAMED one thing and DESCRIBED as another. \"NET\" alongside \"go to the table, 5 to 10 trials, back to playing\" is discrete trial teaching with a play break. \"Most-to-Least\" alongside a trial that starts independent and gives a chance to respond is least-to-most, or a prompt delay - three different procedures.\n" +
    "* Two statements about the arrangement that cannot both be true.\n" +
    "* A prompt level or term used and never defined.\n" +
    "* Figures that disagree, such as a mastery accuracy against the goal's own ratio.\n" +
    "Ask about it as a question with the readings as its suggestions, naming each as the real procedure it is. NEVER tell them they made a mistake and never pick a reading for them: a mistyped direction and a deliberate prompt delay are clinically different and only they know which they meant. Where a deliberate hybrid is a live reading, offer it - a check that cannot say \"you are running a mixed format\" argues with a correct plan.\n\n" +
    "RULES\n" +
    "* Be specific and quote back what they wrote. \"You wrote 'NET' and then described table trials: which is it?\" NOT \"Can you add more detail?\"\n" +
    "* NEVER ask for a name, a date, an address, a diagnosis, or any other identifying detail. This input is deliberately de-identified and must stay that way.\n" +
    "* Never ask them to justify a clinical choice. You may offer a clinical opinion when it is about the DESIGN; you may never state a fact about this client.\n" +
    "* Do not ask about anything the goal itself already answers.\n" +
    "* Write dashes as a plain hyphen (-). Never use an em dash.\n" +
    "* If you know enough about the learner to tailor the plan, return sufficient=true and an empty array. Fewer questions is better than more, and HOW MANY TO ASK below is the only ceiling.\n" +
    "* Return ONLY a JSON object. No markdown, no preamble, no commentary.";

  window.NOTE_TOOLS.push({
    id: "sap",
    label: "SAP",
    title: "SAP Goals & Planning Tool",
    subtitle: "Enter a treatment goal and SAP specifications, generate a prompt or draft a complete Service Authorization Plan for clinical review.",
    assistantIntro: "Enter the treatment goal and any SAP specifications, then press Generate SAP. I'll ask what I need to know about the learner, design the rest of the plan myself, and mark every block I designed so you can change it in a click.",
    genLabel: "Generate SAP",
    outputTitle: "Generated SAP Draft",
    promptIntro: "Copy and paste into your AI of choice. It will return a refined SMART goal and complete SAP draft, no preamble, no editorializing.",
    maxTokens: 4200,
    inputs: [
      {
        id: "goal", type: "textarea", label: "Treatment Goal", required: true, height: 120, charCount: true,
        tooltip: SMART_TOOLTIP,
        hint: "Write a SMART goal tied to the client's diagnosis and functional needs, without PHI. Hover the i icon to see what makes a goal SMART.",
        placeholder: "e.g., [Client] will independently request preferred items or activities using their AAC device in 4 out of 5 opportunities, absent behaviors targeted for reduction, across 3 consecutive sessions within 1 authorization period, as measured by direct observation during structured and unstructured activities.",
      },
      {
        id: "sapSpecs", type: "textarea", label: "SAP Specifications", height: 150, charCount: true,
        tip: "The tool designs the plan mechanics itself and marks each one so you can change it. What it cannot know is the learner. The more you say here about the current repertoire, what competes with the target, what has already been tried, and where the skill has to work, the more tailored the draft. No PHI. Anything you do specify here is taken as given rather than designed.",
        placeholder: "What the tool cannot guess, e.g.:\n- Already matches identical pictures, breaks down when the field goes past 3\n- Grabs and vocalizes when the demand goes up\n- Tried a picture exchange binder last authorization, abandoned it, too slow\n- Works for the tablet and for crunchy snacks; stickers stopped working\n- Has to work with 2 staff at the clinic and with mom at home\n- 45 minute sessions, one technician",
      },
    ],
    groupOptions: {},
    /* THIRTEEN CARDS. Every company-required block is now a real section: its
       own click target, its own diff, its own line in the shape gate. Copy
       still hands back the four EHR fields - see COPY_GROUPS above. */
    formSections: [
      { kind: "narrative", heading: "Treatment Goal (Refined)", key: "refinedGoal", minHeight: 100 },
      { kind: "narrative", heading: "Purpose", key: "purpose", minHeight: 90 },
      { kind: "narrative", heading: "Teaching Strategy", key: "teachingStrategy", minHeight: 130 },
      { kind: "narrative", heading: "Lesson Set Up", key: "lessonSetUp", minHeight: 150 },
      { kind: "narrative", heading: "SD (Demand / Discriminative Stimulus)", key: "sd", minHeight: 120 },
      { kind: "narrative", heading: "Correct Response", key: "correctResponse", minHeight: 90 },
      { kind: "narrative", heading: "Incorrect Response", key: "incorrectResponse", minHeight: 90 },
      { kind: "narrative", heading: "Mastery Criteria", key: "masteryCriteria", minHeight: 70 },
      { kind: "narrative", heading: "Prompt Hierarchy", key: "promptHierarchy", minHeight: 150 },
      { kind: "narrative", heading: "Generalization Criteria", key: "generalizationCriteria", minHeight: 120 },
      { kind: "narrative", heading: "Maintenance Criteria", key: "maintenanceCriteria", minHeight: 110 },
      { kind: "narrative", heading: "Error Correction - Initial Teaching", key: "errorCorrectionInitial", minHeight: 130 },
      { kind: "narrative", heading: "Error Correction - Maintenance", key: "errorCorrectionMaintenance", minHeight: 130 },
    ],
    copyGroups: COPY_GROUPS,
    hintCatalog: HINT_CATALOG,
    responseSchema: RESPONSE_SCHEMA,
    /* THE EDITS CONTRACT, SWITCHED ON FOR THIS TOOL ALONE.
       His ruling: build it as the engine's contract, ship it for sap, leave the
       other four tools on the whole-note path - exactly how responseSchema
       rolled out. The engine reads both flags together; a tool with one and not
       the other is caught by sap-edits.spec.js. */
    editsOnly: true,
    revisionSchema: REVISION_SCHEMA,
    mergeRevision: mergeRevision,
    triageSystem: TRIAGE_SYSTEM,
    /* A NEW KIND NAME, AND THE REASON IS DEPLOY ORDER.
       One prompt store serves both the production and the dev Pages projects.
       Replacing the stored "sap" and "sap_triage" prompts would hand the
       thirteen-key prompt to production's four-key client the moment
       voice-module deployed. New kinds let the two clients coexist: the old
       pair keeps serving main until main carries this code. */
    draftKind: "sap_design",
    triageKind: "sap_design_triage",
    triageIntro: "CLINICIAN'S GOAL AND SPECIFICATIONS:",
    validate: function (values) {
      if (!(values.goal || "").trim()) return "Please enter a treatment goal.";
      return null;
    },
    serverPrompt: true,
    buildSystem: function () { return SYSTEM_PROMPT + (window.NoteRegisterRules ? window.NoteRegisterRules.universal : "") + HINTS_BLOCK; },
    buildUserPrompt: buildUserPrompt,
    buildLabeledPrompt: buildLabeledPrompt,
    normalizeOutput: normalizeOutput,
  });
})();
