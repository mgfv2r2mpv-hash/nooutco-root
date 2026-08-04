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
     requires filling them. */
  var TIRED_REGISTER = [
    "",
    "WHO WRITES THIS AND WHEN. A real note is written by staff at the end of a work block, tired, wanting to be finished. It is a little briefer than a complete account would be. Some words fall away and some implications are left implied rather than spelled out.",
    "So: any sentence range given below is a CEILING, never a target. Thin input earns a short note, and a short honest note is correct output, not a failure. Do not restate what the form's own checkboxes already record. Do not add a closing sentence that summarises what the preceding sentences already said. If a detail was not given to you, leave the gap rather than smoothing over it, and emit the hint instead.",
  ].join("\n");

  window.NoteRegisterRules = {
    constructions: CONSTRUCTIONS,
    tired: TIRED_REGISTER,
    // Everything a session note tool wants, in the order it should be read.
    sessionNote: CONSTRUCTIONS + "\n" + TIRED_REGISTER,
  };
})();
