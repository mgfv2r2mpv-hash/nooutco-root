/* SLICE 6: THE BLOCK A DRAFT READS ITS AUTHOR'S STORED VOICE FROM.
 *
 * The profile store sends back, with the style card, the moves this author's
 * stored voice earns (profile-api/src/voice-read.js) as ids and numbers:
 *
 *   { levels:  [{ feature, direction: "more"|"less", target, n }],
 *     diction: [{ family_id, variant_index, share, notes }] }
 *
 * This file turns that into the few lines the draft's system suffix carries.
 *
 * NOTHING HERE CAN CARRY CLIENT DATA, AND THAT IS STRUCTURAL. Every word in the
 * block comes from one of two closed sources: the fixed sentences below, and
 * the house synonym dictionary (diction.js), read by family id and variant
 * index. A feature, family or direction this file does not know is dropped, a
 * number is formatted as a number, and nothing from the reply is ever put in
 * the block as text. The intake still goes through the scrub as it always has;
 * this block never touches the intake at all.
 *
 * An empty reading gives "", so a technician with no stored voice drafts on
 * exactly the prompt that shipped before this slice.
 *
 * Exposes window.NoteVoiceRead
 *   .block(voice) -> the suffix text, or ""
 */
(function () {
  "use strict";

  var HEADER = [
    "",
    "TECHNICIAN VOICE, MEASURED (read from the notes this technician edited by hand)",
    "These describe how this person writes. Match them where they do not conflict with anything above. Where they conflict, the rules above win: they are clinical and documentation requirements, and these are only style.",
    "They change phrasing, sentence length and word choice only. Never add, drop or change a fact, number, count, percentage, target, date or any other session data because of this section.",
    "Never mention this section or the fact that the writing is being matched.",
  ];

  function tenths(v) {
    return Math.max(1, Math.min(10, Math.round(v * 10)));
  }

  /* One sentence per level move, by feature and direction. A feature with no
     sentence here is dropped rather than described generically. */
  var LEVEL_LINES = {
    actor_naming: function (m) {
      var n = tenths(m.target);
      return m.direction === "more"
        ? "- Name who did each step (the technician, the client, staff) in about " + n + " of every 10 sentences, more often than a default note does."
        : "- Name who did each step in about " + n + " of every 10 sentences. This person names the actor less often than a default note does; keep the actor wherever leaving it out would hide who acted.";
    },
    hedging: function (m) {
      var every = Math.max(10, Math.round(1 / Math.max(m.target, 0.001)));
      return m.direction === "more"
        ? "- Mark uncertainty (appeared, seemed, may) about once every " + every + " words, more often than a default note does, and only where the observation was uncertain."
        : "- Mark uncertainty (appeared, seemed, may) about once every " + every + " words, less often than a default note does. Never state an uncertain observation as certain.";
    },
  };

  function families() {
    var d = window.NoteDiction;
    var map = {};
    (d && Array.isArray(d.FAMILIES) ? d.FAMILIES : []).forEach(function (f) { map[f.id] = f; });
    return map;
  }

  function isWhole(v) { return typeof v === "number" && isFinite(v) && Math.floor(v) === v; }

  function levelLines(levels) {
    return (Array.isArray(levels) ? levels : []).slice(0, 2).map(function (m) {
      if (!m || !Object.prototype.hasOwnProperty.call(LEVEL_LINES, m.feature)) return "";
      if (m.direction !== "more" && m.direction !== "less") return "";
      if (typeof m.target !== "number" || !isFinite(m.target) || m.target <= 0) return "";
      return LEVEL_LINES[m.feature](m);
    }).filter(Boolean);
  }

  /* The word comes from the dictionary by position, the base form (the first
     in its variant). A family or index the dictionary does not hold says
     nothing, because there is no word to put there that this file chose. */
  function dictionLines(diction) {
    var fams = families();
    var lines = (Array.isArray(diction) ? diction : []).slice(0, 5).map(function (p) {
      if (!p || !Object.prototype.hasOwnProperty.call(fams, p.family_id)) return "";
      if (!isWhole(p.variant_index)) return "";
      var variant = fams[p.family_id].variants[p.variant_index];
      if (!Array.isArray(variant) || !variant.length) return "";
      return "- For " + String(p.family_id).replace(/_/g, " ") + ", write \"" + variant[0] + "\" rather than its synonyms.";
    }).filter(Boolean);
    return lines.length ? ["Word choice, where the note needs the word at all:"].concat(lines) : [];
  }

  function block(voice) {
    if (!voice || typeof voice !== "object") return "";
    var body = levelLines(voice.levels).concat(dictionLines(voice.diction));
    return body.length ? HEADER.concat(body).join("\n") : "";
  }

  window.NoteVoiceRead = { block: block };
})();
