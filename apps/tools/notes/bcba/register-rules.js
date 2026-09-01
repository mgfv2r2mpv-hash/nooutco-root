/* Shared register rules for every note tool.
 *
 * WHERE THESE COME FROM. The maintainer sent one narrative in two versions with
 * everything else held constant: his original scored 53% on QuillBot, his own
 * edit of it scored 0%. Sentence count, sentence length, opener variety and
 * burstiness were unchanged between them, which is why the structural scorer
 * rated the 53% version as the BETTER of the two. Everything that actually moved
 * was word choice and clause construction:
 *
 *   "altered the client's motivational state by ensuring attention was
 *    available independent of behavioral response"          <- 53%
 *   "decreased the client's motivation for attention, because attention was
 *    available independent of problem behaviors"            <- 0%
 *
 * Four constructions carried it, and all four are invisible to any measure of
 * length or variety. They are banned below.
 *
 * SEPARATELY, the tools write too well. His words: these notes are "written by
 * tired staff at the end of a work block of a session so they are a little
 * briefer about things and let some words fall, some implications be only
 * implied." Every session note tool had a sentence-count FLOOR, which is a
 * machine for manufacturing exactly the wrong register when the input is thin.
 *
 * That second half deliberately does NOT apply to the SAP tool. A plan is read
 * before a session by someone who needs the detail, so it carries the opposite
 * instruction. Two document classes, two registers, and flattening them into one
 * rule is how this goes wrong.
 */
(function () {
  "use strict";

  // Applies everywhere, including SAP. These are constructions, not lengths.
  var CONSTRUCTIONS = [
    "",
    "CONSTRUCTIONS THAT READ AS MACHINE WRITTEN. These were measured on a real pair of notes, one scored 53% by a detector and the same content edited by the clinician scored 0%. Avoid all four:",
    "* Abstract state nouns. Write what changed, not the category it belongs to. 'decreased the motivation for attention' not 'altered the motivational state'. 'problem behaviors' not 'behavioral response'.",
    "* Empty intensifier adverbs: proactively, actively, effectively, appropriately, successfully, systematically, thoroughly. Delete them. The verb already carries it.",
    "* Participial causals of the form 'by ensuring', 'by providing', 'by allowing'. Use a comma and 'because', or start a new sentence.",
    "* Vague support verbs where a specific one exists: support, facilitate, promote, enhance, address. Say what actually happened instead.",
  ].join("\n");

  /* Session notes only. A note written at the end of a session by someone tired
     is shorter than a note written to be complete, and the difference is most of
     what a detector reads. The ranges each tool gives are ceilings; nothing
     requires filling them.

     THE ABSENCE RULE, and why "leave the gap" was not enough on its own. The
     paragraph below already told the model to leave a gap rather than smooth
     over it, and every tool already forbids fabrication. The model found a third
     move that breaks neither rule: write a sentence reporting that the detail
     was missing. On 2026-08-13 a BT note came back carrying "Behavior rates
     relative to recent sessions were not reported in the session documentation."
     Nothing in that sentence is invented, which is exactly why anti-fabrication
     never caught it, and it is still wrong. The maintainer's ruling: a note
     records what was done, never what was not done.

     The carve-out matters as much as the rule. A zero is an observation, and
     these tools ask for behavior counts including zero. "No instances of
     aggression occurred" is the session. "The rate was not reported" is the
     paperwork. Banning the second must never take the first with it, so the
     rule below draws the line on what the sentence is ABOUT rather than on the
     word "not". */
  var TIRED_REGISTER = [
    "",
    "WHO WRITES THIS AND WHEN. A real note is written by staff at the end of a work block, tired, wanting to be finished. It is a little briefer than a complete account would be. Some words fall away and some implications are left implied rather than spelled out.",
    "So: any sentence range given below is a CEILING, never a target. Thin input earns a short note, and a short honest note is correct output, not a failure. Do not restate what the form's own checkboxes already record. Do not add a closing sentence that summarises what the preceding sentences already said. If a detail was not given to you, leave the gap rather than smoothing over it, and emit the hint instead.",
    "",
    "NEVER DOCUMENT AN ABSENCE. This record is about the session, never about the intake you were handed. Do not write that something was not reported, not documented, not provided, not specified, not available, not included, or unclear, in any section, as a caveat, or as a closing line. When an element is missing, write nothing whatsoever about it and emit the hint instead: the hint reaches the person who can still fill it in, and the note pays nothing for the silence.",
    "A zero is an observation and it stays. \"No instances of aggression occurred\" describes the session and belongs in the note. \"The rate was not reported\" describes the paperwork and does not. The test is what the sentence is about, not whether it contains the word not. If the subject of the sentence is the record rather than the client, the staff or the session, cut the sentence.",
  ].join("\n");


  /* What a session record is FOR, and what to cut when there is too much.
     The field requirement is observable events. But real notes are not written
     by a machine applying that rule perfectly: "he approached staff and was
     happy" survives in real notes without anyone operationally defining happy.

     The maintainer's correction, which is the sharper rule and the one that
     matters: a feeling is not a behavior. What makes "happy" acceptable is not
     that it is mild, it is that the observable sits right there beside it. He
     approached, unprompted, and that is the evidence. A feeling named with no
     observation attached is not a softer version of the same thing, it is a
     missing observation, and the answer is to ASK what told them rather than to
     delete the word or to invent a definition for it.

     Opinion and causation are NOT the same severity, which is the maintainer's
     later correction. A causal claim can land as inappropriate to whoever reads
     the record next and is not the technician's to make, so it goes without
     appeal. An opinion is sometimes fine and they may have a reason, so it is
     flagged with a short why and left to them. A technician who reads the flag
     and keeps the sentence has overridden it, and that is the intended
     outcome. */
  /* THE TWO REMOVALS THAT TURN ON WHO IS HOLDING THE PEN.
     His instruction, 2026-08-31: "The fix for BCBA analysis should be widened to
     all non BT tools. remove from all but the BT note tool."

     Both lines take the analysis away from the author and reserve it for the
     BCBA. On the BT note that is right, and it is his own earlier ruling: a
     causal claim is not the technician's to make, so it goes without appeal.

     On sup, assess and parent the author IS the BCBA, so the same two lines take
     the analysis away from the very person they were reserving it for. On the
     assessment tool that is not a register wrinkle, it deletes the finding the
     assessment was run to produce: assigning a function and naming an
     establishing operation is what an assessment is FOR.

     Only bt has a technician author. Everything else in this block is about what
     a record is for rather than about who owns the analysis, so all four tools
     share the rest of it unchanged. */
  var ANALYSIS_IS_NOT_THE_AUTHORS = [
    "* Claims about WHY a behavior happened. A causal claim in a session note can land as inappropriate to whoever reads it next, and it is not the technician's to make.",
    "* Clinical hypotheses. Function, motivation and diagnosis belong to the BCBA's analysis.",
  ];

  /* Built once per author rather than written twice, so the shared four fifths
     cannot drift apart. The technician build must stay byte-identical to what
     shipped before this split: bt's served prompt is composed from this file in
     voice-module, and a stray character here is a re-extract nobody asked for. */
  function sessionRecord(authorIsBcba) {
    return [
    "",
    "WHAT THIS RECORD IS FOR. A session note documents observable events. That is a field requirement, not a style preference, and neutral observation is what the record is for.",
    "",
    authorIsBcba
      ? "REMOVE, ALWAYS. This is not a preference, because it is wrong in a record rather than merely unwanted:"
      : "REMOVE, ALWAYS. These are not preferences and the technician does not get a say, because they are wrong in a record rather than merely unwanted:",
  ].concat(authorIsBcba ? [] : ANALYSIS_IS_NOT_THE_AUTHORS).concat([
    "* Anything a checkbox on the form already records.",
    "",
    "FLAG, DO NOT REMOVE. Staff opinion about the client, the family or the program is sometimes fine and the technician may have a reason for it. Keep what they wrote, and emit an ambiguous_item hint on that section giving the reason in a few words, for example 'opinion, not observation. Neutral wording is safer here.' Then leave it to them. A technician who reads that and keeps the sentence has overridden it, which is the correct outcome, not a failure.",
    "",
    "A FEELING IS NOT A BEHAVIOR, and that decides the next two rules.",
    "KEEP A FEELING THAT HAS ITS OBSERVATION BESIDE IT. 'He approached staff and was happy' is how these notes are really written, and what makes it acceptable is the approach, not the mildness of the word. Do not manufacture an operational definition, and do not strip it either. 'Demonstrated positive affect as evidenced by' is worse on both counts: no more observable than 'happy', and no technician writes that way.",
    "FLAG A FEELING THAT HAS NOTHING ATTACHED. If the notes name a feeling and never say what was seen, that is a missing observation rather than a softer one. Keep the word and emit an ambiguous_item hint naming it and offering the two ways out, for example: \"'frustrated' has no observation. Add a description or remove it.\" Never answer it yourself and never quietly drop the word.",
    "State the problem and the options. Do not phrase these as a question to the technician; they are reading at the end of a shift and a flat statement is faster to act on.",
    ]).join("\n");
  }

  var SESSION_RECORD = sessionRecord(false);
  var SESSION_RECORD_BCBA = sessionRecord(true);

  window.NoteRegisterRules = {
    constructions: CONSTRUCTIONS,
    tired: TIRED_REGISTER,
    // Everything a session note tool wants, in the order it should be read.
    sessionRecord: SESSION_RECORD,
    sessionRecordBcba: SESSION_RECORD_BCBA,
    /* sessionNote is the TECHNICIAN build and bt is its only caller. The name is
       left alone rather than renamed to match, because renaming it would edit
       bt's served prompt for no clinical reason and cost a re-extract. */
    sessionNote: CONSTRUCTIONS + "\n" + TIRED_REGISTER + "\n" + SESSION_RECORD,
    // sup, assess and parent. Same rules, minus the two that hand the analysis
    // to a BCBA who is already the one writing.
    sessionNoteBcba: CONSTRUCTIONS + "\n" + TIRED_REGISTER + "\n" + SESSION_RECORD_BCBA,
  };
})();
