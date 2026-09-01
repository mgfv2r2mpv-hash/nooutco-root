/* BT Direct Service Note tool config - ported from the standalone /notes/bt/
 * page, which was its own 800-line React app with a duplicate of everything the
 * shared engine already does. Moving it here buys the conversation loop, the
 * 5-minute prompt cache, the scrub gate, hints, structured output and drafts
 * without reimplementing any of them.
 *
 * Two things are genuinely BT-specific and stayed: the five clustered inputs
 * (BTs are given recognition-framed prompts, not a blank box, because many are
 * newly credentialed) and the "facts" section, which reports quick-pick answers
 * the model must never infer. */
(function () {
  var menu = window.NoteToolsUtil.menu;
  var normalizeHints = window.NoteToolsUtil.normalizeHints;
  var normalizeRevision = window.NoteToolsUtil.normalizeRevision;
  var hintSchema = window.NoteToolsUtil.hintSchema;

  /* ── Canonical option lists ──────────────────────────────────────────────
     These labels are BOTH the menu the model may choose from AND the strings
     the output checklist renders. They must match the EHR form's wording. */

  var INDIVIDUALS_PRESENT = ["Client", "BCBA", "Parent/Caregiver", "Sibling(s)/Peer(s)", "Other"];

  var CLINICAL_STATUS = [
    "Ready to Start Learning",
    "Presented Tired",
    "Presented Hungry/Thirsty",
    "Presented Distracted/Unfocused",
    "Appeared unwell/ill",
    "Dysregulated/Engaging in Behavior of Concern",
    "Recent Medication Use/Change",
  ];

  var PURPOSE_OF_SESSION = [
    "Worked on goals as stated in the treatment plan",
    "Paired staff with reinforcement and established instructional control",
    "Implemented Behavior Plans",
  ];

  var ABA_TECHNIQUES = [
    "Discrete Trial Training",
    "Natural Environment Training",
    "Task Analysis",
    "Functional Communication Training",
    "Errorless Learning",
    "Most to Least Prompting",
    "Least to Most Prompting",
    "Differential Reinforcement",
    "Token Economy",
  ];

  var ANTECEDENT_STRATEGIES = [
    "Environmental arrangement",
    "Visual schedule",
    "Offered choices",
    "Utilized Premack principle (first-then)",
    "Priming/provided warning",
    "Motivation alteration / manipulation",
    "Other",
  ];

  var CONSEQUENCE_STRATEGIES = [
    "Redirection",
    "Lessened response requirement",
    "Prompted functional communication",
    "Allowed break",
    "Differential reinforcement",
    "Other",
  ];

  var EFFECTIVENESS = [
    "Highly effective at addressing behaviors and mitigating future incidents",
    "Moderately effective at addressing behaviors within session",
    "Not effective at addressing behaviors within session, additional support needed",
  ];

  var CLIENT_PROGRESS = [
    "Steady progress towards goals and behaviors",
    "Behavior of concern impacted session and progress towards goals",
    "Limited progress towards achieving goals",
  ];

  var BCBA_ACTION_ITEMS = [
    "Contact family, scheduling/staffing",
    "Contact family, new behavior",
    "Contact family, billing questions",
    "Contact staff",
    "Materials needed for programming",
    "None",
  ];

  var PLACE_OF_SERVICE = ["Home", "Clinic/Center", "School", "Community", "Other"];
  var YES_NO = ["Yes", "No"];

  var GROUP_OPTIONS = {
    individualsPresent: INDIVIDUALS_PRESENT,
    clinicalStatus: CLINICAL_STATUS,
    purpose: PURPOSE_OF_SESSION,
    abaTechniques: ABA_TECHNIQUES,
    antecedentStrategies: ANTECEDENT_STRATEGIES,
    consequenceStrategies: CONSEQUENCE_STRATEGIES,
    actionItems: BCBA_ACTION_ITEMS,
    consequenceEffectiveness: EFFECTIVENESS,
    clientProgress: CLIENT_PROGRESS,
  };

  /* ── Output render config - mirrors the EHR form top-to-bottom ─────────── */

  var FORM_SECTIONS = [
    { kind: "checklist", heading: "Individuals Present",                    group: "individualsPresent" },
    { kind: "checklist", heading: "Clinical Status Of Client Upon Arrival", group: "clinicalStatus" },
    { kind: "narrative", heading: "Further Detail On Clinical Status",      key: "clinicalStatusNarrative", minHeight: 80 },
    { kind: "checklist", heading: "Purpose of Session",                     group: "purpose" },
    // Quick-pick answers the model is told not to infer, echoed back so the BT
    // can tick the matching EHR boxes from one place.
    { kind: "facts",     heading: "Place of Service / Telehealth / Service Paused", key: "sessionFacts",
      rows: [
        { label: "Place of Service", from: "values", id: "placeOfService" },
        { label: "Telehealth",       from: "values", id: "telehealth" },
        { label: "Service Paused",   from: "output", id: "servicePaused" },
      ] },
    { kind: "checklist", heading: "ABA Teaching Techniques Used",           group: "abaTechniques" },
    { kind: "narrative", heading: "Narrative of Lesson Progress",           key: "lessonProgressNarrative", minHeight: 130 },
    { kind: "checklist", heading: "Antecedent Strategies Utilized",         group: "antecedentStrategies" },
    { kind: "narrative", heading: "Describe Antecedent Modifications Implemented in Session and Impact", key: "antecedentNarrative", minHeight: 100 },
    { kind: "checklist", heading: "Consequence Strategies Utilized",        group: "consequenceStrategies" },
    { kind: "single",    heading: "Effectiveness of Consequence Strategies", group: "consequenceEffectiveness" },
    { kind: "narrative", heading: "Narrative of Behavior Support Plan Goals Progress", key: "behaviorPlanNarrative", minHeight: 100 },
    { kind: "single",    heading: "Client Progress",                        group: "clientProgress" },
    { kind: "checklist", heading: "Action Items for BCBA",                  group: "actionItems" },
    { kind: "narrative", heading: "Summary of Concerns/Questions/Involvement", key: "followUpNarrative", minHeight: 80 },
  ];

  var SECTION_IDS = FORM_SECTIONS.map(function (s) { return s.key || s.group; });

  var NARRATIVE_KEYS = [
    "clinicalStatusNarrative", "lessonProgressNarrative",
    "antecedentNarrative", "behaviorPlanNarrative", "followUpNarrative",
  ];

  /* ── Hints ────────────────────────────────────────────────────────────────
     Canonical wording lives HERE, client-side; the model returns only the code
     (plus an optional short specifier). Consistent phrasing, nothing fabricated.
     The BT tool had no hints at all before - these are the gaps a supervising
     BCBA most often has to send a note back for. */

  var HINT_CATALOG = {
    no_behavior_count: "Behavior of concern noted without a count or rate, add how many times it occurred, even if zero",
    no_rate_comparison: "No comparison to recent sessions, say whether this was higher, lower, or about the same",
    no_prompt_level: "Teaching described without a prompt level, name the prompt type used and whether it was faded",
    single_program_only: "Only one program is described, a second (ideally communication/social plus adaptive) makes the note stronger",
    no_antecedent_impact: "Antecedent strategy named without its effect, say whether it helped",
    thin_clinical_status: "Little detail on how the client presented at the start of session",
    no_response_described: "Behavior noted without your response, add what you did and whether it worked",
    /* The code the SHARED register rules already ask every session tool to
       emit, for an opinion with no observation behind it and for a feeling with
       nothing attached. It was missing here, and a missing code is not a quiet
       gap: `code` is an enum built from this object and normalizeHints drops
       anything not in it, so both of those rules were unobeyable on this tool
       while their instruction sat in the prompt. assess, parent and sap have
       carried it since they were written; bt and sup did not. */
    ambiguous_item: "Clarify",
    other: "",
  };

  /* ── Response schema ──────────────────────────────────────────────────────
     What the model is CONSTRAINED to, not merely asked for. The prompt still
     describes the shape, but the prompt is guidance and this is enforcement. */

  var str = { type: "string" };
  var enumArray = function (values) {
    return { type: "array", items: { type: "string", enum: values } };
  };
  // Single-selects allow "" for "the notes don't support a choice", so the
  // model has an honest option other than picking one at random.
  var enumOrBlank = function (values) {
    return { type: "string", enum: values.concat([""]) };
  };

  var RESPONSE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: [
      "individualsPresent", "clinicalStatus", "clinicalStatusNarrative", "purpose",
      "servicePaused", "abaTechniques", "lessonProgressNarrative", "antecedentStrategies",
      "antecedentNarrative", "consequenceStrategies", "consequenceEffectiveness",
      "behaviorPlanNarrative", "clientProgress", "actionItems", "followUpNarrative", "hints",
    ],
    properties: {
      individualsPresent: enumArray(INDIVIDUALS_PRESENT),
      clinicalStatus: enumArray(CLINICAL_STATUS),
      clinicalStatusNarrative: str,
      purpose: enumArray(PURPOSE_OF_SESSION),
      servicePaused: { type: "string", enum: YES_NO },
      abaTechniques: enumArray(ABA_TECHNIQUES),
      lessonProgressNarrative: str,
      antecedentStrategies: enumArray(ANTECEDENT_STRATEGIES),
      antecedentNarrative: str,
      consequenceStrategies: enumArray(CONSEQUENCE_STRATEGIES),
      consequenceEffectiveness: enumOrBlank(EFFECTIVENESS),
      behaviorPlanNarrative: str,
      clientProgress: enumOrBlank(CLIENT_PROGRESS),
      actionItems: enumArray(BCBA_ACTION_ITEMS),
      followUpNarrative: str,
      // An empty array is the "note stands on its own" case, so hints is
      // required as a key even though it is routinely empty.
      //
      // The shape is shared now. rank and kind come with it, and their meaning
      // travels in the schema's own description fields rather than in the
      // prompt: this tool's system prompt is composed inside the Worker from the
      // prompt store, so wording added to HINTS_BLOCK below would never reach
      // the served call. The schema is sent from the browser for every tool.
      hints: hintSchema(HINT_CATALOG, SECTION_IDS),
      // Also optional. When the technician says they are unsure about something
      // clinical, the tool offers to put the question to the BCBA rather than
      // guessing an answer. His ruling: it goes in the note, because the note
      // is already the channel to the BCBA and nothing new has to be built or
      // monitored. Phrased as the technician would ask it, not as advice.
      bcbaQuestion: str,
      // Not required either. A question is not an edit: when the clinician asks
      // something rather than instructing something, the answer goes here and
      // every other key comes back untouched. Before this, asking "does this
      // belong in the BCBA summary?" rewrote the note, which is the tool
      // answering with the one thing it should never spend on a question.
      answer: str,
      // Optional. It only means anything on a revision turn, where the
      // clinician pointed at one section and the instruction turned out to
      // touch another. A first draft has no target to reach past.
      //
      // `confident` is the whole decision: true applies the change straight
      // away with an undo, false stops and asks in the panel. So the prompt
      // has to say what earns a true, or it becomes a coin toss with a
      // confident-sounding name.
      crossSection: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["section", "confident", "why"],
          properties: {
            section: { type: "string", enum: SECTION_IDS },
            confident: { type: "boolean" },
            // One short clause, shown to the clinician as the reason. Not a
            // rationale for the note itself, so it never reaches the EHR.
            why: { type: "string" },
          },
        },
      },
    },
  };

  /* ── Prompts ──────────────────────────────────────────────────────────── */

  var SYSTEM_CORE =
    "You are an ABA clinical documentation assistant turning a BT's raw session notes into a polished \"Adaptive Behavior Treatment by Protocol\" note. The BT is the author; write third-person clinical prose - \"The behavior technician implemented…\", \"The client demonstrated…\" - for funders/payers and the supervising BCBA.\n\n\
OUTPUT: (a) third-person clinical narratives for free-text sections, (b) conservative checkbox inferences for the BT to verify.\n\n\
RULES\n\
- Report concrete implementation: programs run, prompt types/levels/fading decisions, behavioral occurrences + BT response, antecedent strategies as applied, observable client outcomes.\n\
- Plain, precise clinical language. A fragment in the intake can stay compressed if it already reads clearly; sparse sections get one brief sentence about what did happen and stop there.\n\
- ANTI-FABRICATION: Never invent activities, programs, data points, prompt levels, strategies, or outcomes not in the notes. A section the notes do not support gets an empty narrative and empty checkboxes, not a sentence explaining what was missing.\n\n\
CHECKBOX INFERENCE\n\
- Return ONLY verbatim values from each group's allowed list. Never invent or reword options.\n\
- Infer conservatively; cross-read the whole note - purpose follows what was done, action items surface from anything mentioned anywhere.\n\n\
BEHAVIORAL RECHARACTERIZATION\n\
Translate mentalistic or colloquial language into behavioral observation using only what was reported - never add behaviors or clinical meaning not stated. \"He was cranky\" alone → \"the client presented with apparent negative affect\"; with \"aggression x2\" added → \"the client engaged in aggression on two occasions.\"\n\n\
TERMINOLOGY (non-negotiable)\n\
- Reinforcement is contingent on behavior. Write \"[behavior] was reinforced\" or \"reinforcement was delivered contingent on [behavior]\" - never \"[person] was reinforced.\"\n\
- Precise verbs: prompted, faded, modeled, shaped, chained, redirected, blocked, delivered/withheld reinforcement, ran a trial, presented the SD.\n\
- Name prompt types specifically (gestural, partial verbal, full physical, errorless). No loose synonyms (rewarded, encouraged, motivated).\n\
- Objective, observable language. Report what was seen and done; do not attribute cause or infer intent.\n\n\
PLAIN LANGUAGE (applies alongside the terminology rules, never against them)\n\
- Expand every acronym on first use, then abbreviate: \"Functional Communication Training (FCT) was implemented...\" and \"FCT\" thereafter. Same for DTT, NET, AAC, SD, IOA, BST.\n\
- Keep the clinical term when it carries precision a plain word would lose (a prompt type, a procedure, a schedule of reinforcement). Drop jargon and padding that carries none: write \"used\" not \"utilized\", \"played\" not \"engaged in the activity of\", \"could\" not \"demonstrated the ability to\".\n\
- NAME THE ACTOR ONCE, THEN LET IT RIDE. Say who did what rather than issuing an actorless instruction: \"The behavior technician ran mixed trials\" beats \"Mixed trials were run.\" Then STOP saying it. Once a sentence has established who is acting, the sentences after it in that section must not restate the actor - drop the subject and carry on: \"The technician presented the array, waited five seconds, then delivered a gestural prompt.\" Restate an actor only when the actor genuinely changes, for example when the caregiver takes over. Re-naming the same actor sentence after sentence is the single loudest machine-writing tell there is, and the previous version of this prompt asked for exactly that.\n\
- HARD CEILINGS, measured on real output against seven human-written clinical documents:\n\
  * \"The behavior technician\" or an equivalent staff subject opens AT MOST half the sentences in any section. In human writing it runs about one sentence in five.\n\
  * The client is the grammatical subject of AT MOST half the sentences in any section.\n\
  * No more than TWO sentences in a section may begin with the same first two words. Restructure the third: lead with the condition, lead with the stimulus, or fold it into the sentence before.\n\
  * Vary sentence length deliberately WITHIN each section. Put a short sentence next to a long one. A section where every sentence is the same length reads as machine-written whether that length is short or long, and this is the strongest single signal there is.\n\
- Some repetition of clinical terms is unavoidable and correct. Repetition of SENTENCE SHAPE is the thing to avoid.\n\
- Length follows completeness, not brevity. Say the whole condition rather than a clipped fragment of it, and stop when the reader could picture the session from what is written. Terseness is not the goal and neither is padding.\n\
- No sentence starting with \"It is important to\", \"Notably\", \"This ensures\", \"Note that\", \"Overall\", or similar. They carry nothing and they are a tell.\n\
- Use hyphens, never em dashes or en dashes. House convention, and their overuse is itself a machine tell.";

  var HINTS_BLOCK = "\n\nHINTS - return an array of {section, code, detail} objects flagging ONLY missing or ambiguous standard elements (max 4; empty array when the note stands on its own). \"section\" MUST be one of the JSON keys below; \"code\" MUST be from this list; \"detail\" is an optional specifier of 10 words or fewer:\n\
- no_behavior_count (behaviorPlanNarrative): a behavior of concern is described with no count, rate, or duration\n\
- no_rate_comparison (behaviorPlanNarrative): no comparison to recent sessions\n\
- no_prompt_level (lessonProgressNarrative): teaching described with no prompt type or fading decision\n\
- single_program_only (lessonProgressNarrative): only one program is identifiable in the notes\n\
- no_antecedent_impact (antecedentNarrative): an antecedent strategy is named with no stated effect\n\
- thin_clinical_status (clinicalStatusNarrative): almost nothing about how the client presented on arrival\n\
- no_response_described (behaviorPlanNarrative): a behavior is named with no BT response\n\
- ambiguous_item (any section): something in the note needs clarifying before it is signed - put what, in detail\n\
- other (any section): something else genuinely unclear - put the question in detail\n\
Hints are advisory nudges, not demands - do not hint when the BT plainly had nothing to report for that element.";

  var JSON_FORMAT_BLOCK =
    "\n\nOUTPUT FORMAT\nReturn ONLY a single JSON object. No markdown, no preamble, no commentary. Use EXACTLY these keys; arrays hold verbatim option labels (empty [] if unsupported); single-selects are one verbatim label or \"\". servicePaused is \"Yes\" or \"No\" (default \"No\" unless the notes mention an unexpected pause).\n{\n  \"individualsPresent\": [],\n  \"clinicalStatus\": [],\n  \"clinicalStatusNarrative\": \"\",\n  \"purpose\": [],\n  \"servicePaused\": \"No\",\n  \"abaTechniques\": [],\n  \"lessonProgressNarrative\": \"\",\n  \"antecedentStrategies\": [],\n  \"antecedentNarrative\": \"\",\n  \"consequenceStrategies\": [],\n  \"consequenceEffectiveness\": \"\",\n  \"behaviorPlanNarrative\": \"\",\n  \"clientProgress\": \"\",\n  \"actionItems\": [],\n  \"followUpNarrative\": \"\",\n  \"hints\": []\n}";

  var LABELED_FORMAT_BLOCK =
    "\n\nOUTPUT FORMAT\nReturn labeled sections in the exact order below. For each \"[tick]\" line, list ONLY the options that apply, comma-separated and verbatim from that section's allowed list; if none apply write \"None selected.\" For \"[choose one]\" pick exactly one allowed option (or \"None\"). For \"[narrative]\" write the prose. Do NOT output hints. No JSON, no preamble, no commentary.\n\nINDIVIDUALS PRESENT [tick]\nCLINICAL STATUS UPON ARRIVAL [tick]\nFURTHER DETAIL ON CLINICAL STATUS [narrative]\nPURPOSE OF SESSION [tick]\nSERVICE PAUSED DURING SESSION [choose one: Yes / No]\nABA TEACHING TECHNIQUES USED [tick]\nNARRATIVE OF LESSON PROGRESS [narrative]\nANTECEDENT STRATEGIES UTILIZED [tick]\nDESCRIBE ANTECEDENT MODIFICATIONS AND IMPACT [narrative]\nCONSEQUENCE STRATEGIES UTILIZED [tick]\nEFFECTIVENESS OF CONSEQUENCE STRATEGIES [choose one]\nNARRATIVE OF BEHAVIOR SUPPORT PLAN GOALS PROGRESS [narrative]\nCLIENT PROGRESS [choose one]\nACTION ITEMS FOR BCBA [tick]\nSUMMARY OF CONCERNS/QUESTIONS/INVOLVEMENT [narrative]\n\nIf the BT notes for a cluster are empty or nonsense, leave its ticks \"None selected\" and leave that narrative blank. A blank section tells the technician what is missing; a sentence saying the detail was not reported would follow the note into the record, where it describes the paperwork rather than the session.";

  function buildUserPrompt(values) {
    return [
      "FACTUAL SESSION DATA (provided, do not infer, do not include in the JSON):",
      "* Place of service: " + (values.placeOfService || "Not specified"),
      "* Provided via telehealth: " + (values.telehealth || "Not specified"),
      "",
      "BT NOTES BY CLUSTER (raw; expand faithfully, never fabricate):",
      "",
      "[1] SESSION START & CONTEXT (who was present, how the client presented on arrival, purpose, any unexpected pause):",
      (values.fSession || "").trim() || "(none provided)",
      "",
      "[2] SKILL ACQUISITION / LESSON (teaching techniques used + lesson progress across ideally two programs):",
      (values.fLesson || "").trim() || "(none provided)",
      "",
      "[3] ANTECEDENT STRATEGIES (proactive strategies used to prevent/reduce behavior, and their impact):",
      (values.fAntecedent || "").trim() || "(none provided)",
      "",
      "[4] BEHAVIOR & STAFF RESPONSE (behavior of concern incl. zero, consequence strategies, how well they worked, rates vs. recent sessions):",
      (values.fBehavior || "").trim() || "(none provided)",
      "",
      "[5] FOLLOW-UP & CONCERNS (BCBA action items, questions, involvement, overall progress):",
      // The technician IS the direct staff, so "Direct staff do not report..."
      // had them writing about themselves in the third person, which is exactly
      // the actorless register that reads as machine-written. Say it the way the
      // person filing the note would say it.
      (values.fFollowUp || "").trim() || "(none provided, default followUpNarrative to: \"No new questions or concerns for the BCBA at this time.\")",
      "",
      "ALLOWED CHECKBOX OPTIONS (return only verbatim values from these lists):",
      "- individualsPresent: " + menu(INDIVIDUALS_PRESENT),
      "- clinicalStatus: " + menu(CLINICAL_STATUS),
      "- purpose: " + menu(PURPOSE_OF_SESSION),
      "- abaTechniques: " + menu(ABA_TECHNIQUES),
      "- antecedentStrategies: " + menu(ANTECEDENT_STRATEGIES),
      "- consequenceStrategies: " + menu(CONSEQUENCE_STRATEGIES),
      "- actionItems: " + menu(BCBA_ACTION_ITEMS),
      "",
      "ALLOWED SINGLE-SELECT OPTIONS (one verbatim value, or \"\" if unclear):",
      "- consequenceEffectiveness: " + menu(EFFECTIVENESS),
      "- clientProgress: " + menu(CLIENT_PROGRESS),
      "",
      "NARRATIVE GUIDANCE:",
      "- lessonProgressNarrative: up to 8 sentences, ideally across two programs (one social/communication, one adaptive/repetitive-behavior-replacement). Qualitative, specific.",
      // The comparison is CONDITIONAL, and it was not before. "State whether
      // behavior increased, decreased, or held steady relative to recent
      // sessions" is a standing order, so a technician who never wrote a
      // comparison still got a sentence about one: the model obeyed the order
      // without fabricating by reporting that the comparison was missing. The
      // gap already has a channel in no_rate_comparison, which reaches the
      // technician who can answer it. The note gets silence.
      "- behaviorPlanNarrative: up to 4 sentences, quantitative where reported. Say whether behavior increased, decreased or held steady relative to recent sessions ONLY IF the notes give you that comparison. If they do not, write nothing at all about it, emit the no_rate_comparison hint, and never state that the comparison is missing.",
      "- antecedentNarrative: describe the antecedent strategies as applied and their impact.",
      "- clinicalStatusNarrative: up to 2 sentences on mood/behavior at session start.",
      "- followUpNarrative: brief; use the default sentence above if nothing reported. Write it as the person filing the note, not about them. The technician IS the direct staff, so never write \"Direct staff report...\" or \"The behavior technician has no concerns\" here, that is the author describing themselves in the third person, which reads as though someone else wrote the note. \"No new questions or concerns for the BCBA at this time\" is the register.",
    ].join("\n");
  }

  /* ── Normalizer ───────────────────────────────────────────────────────────
     Coerce the model's JSON into a safe, render-ready shape and drop any
     hallucinated or reworded value that isn't on the canonical lists. The
     schema makes this near-redundant, but ?schema=off and the recovery ladder
     both bypass the schema, so this stays the last line of defence. */

  function normalizeOutput(raw) {
    var o = raw && typeof raw === "object" ? raw : {};
    var out = {};
    Object.keys(GROUP_OPTIONS).forEach(function (key) {
      var opts = GROUP_OPTIONS[key];
      var isSingle = key === "consequenceEffectiveness" || key === "clientProgress";
      if (isSingle) {
        out[key] = opts.indexOf(o[key]) !== -1 ? o[key] : "";
      } else {
        var arr = Array.isArray(o[key]) ? o[key] : [];
        out[key] = arr.filter(function (v) { return opts.indexOf(v) !== -1; });
      }
    });
    NARRATIVE_KEYS.forEach(function (key) {
      out[key] = typeof o[key] === "string" ? o[key] : "";
    });
    out.servicePaused = o.servicePaused === "Yes" ? "Yes" : "No";
    out.hints = normalizeHints(o.hints, HINT_CATALOG, SECTION_IDS);
    // Only present on a revision that reached past the section the clinician
    // pointed at. Validated against the same closed section list as hints, so a
    // fabricated section name cannot route a change anywhere. bt carried its own
    // copy of this until 2026-08-30; it reads the shared one now, so the caps
    // cannot drift between the tool that had it and the four that gained it.
    return Object.assign({}, out, normalizeRevision(o, SECTION_IDS));
  }

  window.NOTE_TOOLS.push({
    id: "bt",
    // Who "What would you do here?" is answering. Every other tool is a BCBA
    // asking a peer; this one is the technician asking the analyst above them.
    asker: "behavior technician",
    label: "BT Session",
    title: "BT Direct Service Note Tool",
    subtitle: "Enter your session notes as free text. The tool drafts each clinical narrative and suggests which checkboxes to select on your EHR form.",
    assistantIntro: "Fill in your session notes and press Generate Note. I'll ask about anything that looks thin before drafting, then you can click any section, or select a phrase inside one, to revise it.",
    genLabel: "Generate Note",
    maxTokens: 4000,
    // The EHR takes these one field at a time, so a single combined blob is
    // never what gets pasted. Per-section Copy stays.
    copyAll: false,
    promptIntro: "Returns each form section with its narrative and a \"Tick:\" line indicating which boxes to select on your EHR.",

    inputs: [
      {
        id: "placeOfService", type: "toggle", label: "Place of Service",
        options: PLACE_OF_SERVICE.map(function (p) { return { value: p, label: p }; }),
        defaultValue: "Home",
      },
      {
        id: "telehealth", type: "toggle", label: "Provided via Telehealth?",
        options: [{ value: "No", label: "No" }, { value: "Yes", label: "Yes" }],
        defaultValue: "No",
      },
      {
        id: "fSession", type: "textarea", label: "Session Start & Context", height: 120,
        hint: "Who was there, how the client seemed when you started, and, in a few words, whether you worked on building rapport/pairing, skill goals, or reducing a behavior. We'll suggest the Individuals, Clinical Status, and Purpose checkboxes for you.",
        help: {
          intro: "Just jot what you saw, no need to label anything.",
          items: [
            { t: "How they arrived", d: "ready & engaged, tired, hungry/thirsty, distracted, seemed unwell, upset or already having behavior, or a recent medication change" },
            { t: "Focus of session", d: "building rapport / getting them to work with you (pairing), running learning programs, or working on a behavior plan" },
            { t: "Pauses", d: "mention if the session was unexpectedly paused (e.g., a nap)" },
          ],
        },
        placeholder: "No names or other PHI (anything that could identify a specific person).\nFragments are fine, e.g.:\n- BCBA present 20 min; parent home in another room\n- Arrived tired, slow to engage, asked for tablet\n- Ran treatment-plan goals + behavior plan",
      },
      {
        id: "fLesson", type: "textarea", label: "Skill Acquisition / Lesson Progress", required: true, height: 150,
        hint: "What you taught and how it went. Ideally two programs (e.g. one communication/social, one adaptive/daily-living or replacing a repetitive behavior). Include prompting, accuracy/progress, and barriers.",
        help: {
          intro: "Did any of these happen? Name the ones you used.",
          items: [
            { t: "Differential reinforcement", d: "you reinforced the behavior you want to see (the replacement skill or appropriate behavior) and gave little to no reinforcement to the problem behavior you're trying to reduce" },
            { t: "Errorless", d: "prompted right away so they didn't make mistakes" },
            { t: "Most-to-Least", d: "started with strong help and faded it" },
            { t: "Least-to-Most", d: "started with little help, added more only if needed" },
            { t: "Discrete Trial Training", d: "structured repeated trials" },
            { t: "Natural Environment Training", d: "teaching during play / natural routines" },
            { t: "Task Analysis", d: "breaking a multi-step skill into steps" },
            { t: "Functional Communication Training", d: "teaching them to communicate instead of using behavior" },
            { t: "Token Economy", d: "earning tokens toward a reward" },
          ],
        },
        placeholder: "No names or other PHI.\nFragments are fine, e.g.:\n- Receptive ID in DTT, 3-item array; full physical → independent, 2 indep at end\n- Tact training in NET during play, ~70% accuracy\n- Errorless start, faded to gestural prompt",
      },
      {
        id: "fAntecedent", type: "textarea", label: "Antecedent Strategies", required: true, height: 120,
        hint: "What you did proactively to prevent or reduce behavior of concern, and whether it helped.",
        help: {
          intro: "Did you do any of these to prevent problems before they started?",
          items: [
            { t: "Environmental arrangement", d: "set up the space / removed distractions or unsafe items" },
            { t: "Visual schedule", d: "showed what's coming with a picture schedule" },
            { t: "Offered choices", d: "let them pick between options" },
            { t: "Premack / first-then", d: "said “first this, then that” - most people do this without knowing the name" },
            { t: "Priming / warning", d: "a heads-up or countdown before a transition or before ending something fun" },
            { t: "Motivation alteration", d: "adjusted things to meet a need, e.g., a break before a hard task, or held back a preferred item so it stayed motivating" },
            { t: "Also worth a mention", d: "non-contingent reinforcement, easy wins first (behavior momentum), pre-session pairing, simplified instructions" },
          ],
        },
        placeholder: "No names or other PHI.\ne.g.:\n- First/then board for transitions\n- 1-min warnings before switching activities\n- Offered choice of work order\n- Reduced noise/distractions; helped engagement",
      },
      {
        id: "fBehavior", type: "textarea", label: "Behavior & Staff Response", required: true, height: 130,
        hint: "Behavior(s) of concern this session (rates vs. recent sessions, even if zero), how you responded, whether it worked, and overall progress.",
        help: {
          intro: "What behavior(s) of concern happened (even if zero), and how did you respond?",
          items: [
            { t: "Redirection", d: "redirected to an appropriate task" },
            { t: "Lessened response requirement", d: "briefly lowered the demand" },
            { t: "Prompted functional communication", d: "cued them to ask / communicate" },
            { t: "Allowed break", d: "gave a break to de-escalate" },
            { t: "Differential reinforcement", d: "reinforced the replacement behavior, withheld for the target" },
            { t: "Then say", d: "how well it worked (highly / moderately / not effective) and how rates compared to recent sessions" },
          ],
        },
        placeholder: "No names or other PHI.\ne.g.:\n- Elopement x2; blocked + redirected, no escalation\n- Prompted 'break please'; allowed break, behavior dropped\n- Lower rate than last week; responses worked well",
      },
      {
        id: "fFollowUp", type: "textarea", label: "Follow-Up & Concerns", height: 110,
        hint: "Anything the BCBA should do or know, scheduling/staffing, a new behavior, billing, materials, involvement. Items mentioned in earlier fields are surfaced here automatically; leave blank if there is nothing new.",
        help: {
          intro: "Anything the BCBA should do or know.",
          items: [
            { t: "Action items", d: "scheduling/staffing, a new behavior, billing, contact staff, materials needed, or nothing new" },
            { t: "Overall progress", d: "steady, impacted by behavior of concern, or limited" },
            { t: "No need to repeat", d: "things you mentioned above are surfaced here automatically" },
          ],
        },
        placeholder: "No names or other PHI.\ne.g.:\n- Ask BCBA to update elopement protocol\n- Need new visual schedule printed\n- No new concerns this session",
      },
    ],

    groupOptions: GROUP_OPTIONS,
    formSections: FORM_SECTIONS,
    hintCatalog: HINT_CATALOG,
    responseSchema: RESPONSE_SCHEMA,

    validate: function (values) {
      if (!(values.fLesson || "").trim()) return "Please add notes for Skill Acquisition / Lesson Progress.";
      if (!(values.fAntecedent || "").trim()) return "Please add notes for Antecedent Strategies.";
      if (!(values.fBehavior || "").trim()) return "Please add notes for Behavior & Staff Response.";
      return null;
    },

    // The standalone page kept place-of-service in its own localStorage key
    // ("bt_pos") rather than in the draft, so carry it across on first load.
    migrateDraft: function (saved) {
      var s = saved || {};
      if (!s.placeOfService) {
        var legacy = null;
        try { legacy = localStorage.getItem("bt_pos"); } catch (e) {}
        if (legacy) return Object.assign({}, s, { placeOfService: legacy });
      }
      return s;
    },

    /* This tool's system prompt is composed inside the Worker, from the prompt
       store, and is not sent from here.

       buildSystem stays, and for this tool it has to. SYSTEM_CORE is still read
       by buildLabeledPrompt below, which is the logged-out copy-prompt path, so
       the clinical rules were always going to reach a browser that asked. What
       migrating buys is the other half: /api/llm-call no longer accepts a
       system prompt for bt, so a password holder can no longer run a prompt of
       their own choosing on the account's Anthropic key.

       The stored copy and this one are held together by verify-parity.mjs in
       voice-module, which composes THIS file from the deployed site and fails on
       a difference. So an edit here without a matching extraction there is a
       drift that CI catches - but only on the next push to that repo, which is
       the weak link worth knowing about. */
    serverPrompt: true,
    buildSystem: function () { return SYSTEM_CORE + (window.NoteRegisterRules ? window.NoteRegisterRules.sessionNote : "") + HINTS_BLOCK + JSON_FORMAT_BLOCK; },
    buildUserPrompt: buildUserPrompt,
    buildLabeledPrompt: function (values) {
      return SYSTEM_CORE + LABELED_FORMAT_BLOCK + "\n\n---\n\n" + buildUserPrompt(values);
    },
    normalizeOutput: normalizeOutput,
  });
})();
