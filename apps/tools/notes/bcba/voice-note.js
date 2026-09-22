/* ONE NOTE'S VOICE READING, FOR THE STORE THAT LEARNS ONE AUTHOR'S LEVELS.
 *
 * The profile store keeps a running level per author for the four features the
 * house holds a prior for, and a running count of which synonyms that author
 * reaches for. This builds the one entry a note contributes:
 *
 *   {tool, levels: {within_cv, step_rel, actor_naming, hedging}, diction: [...]}
 *
 * Numbers and closed-list ids only. The passage is measured here, in the
 * browser, and nothing of it goes into the entry but the four rates.
 *
 * A NOTE THE TECHNICIAN DID NOT TOUCH TEACHES NO LEVEL. A level is read off the
 * note that was copied, and on an untouched note every word of that is the
 * tool's. Filed as the author's level it would teach the tool its own habits
 * back as somebody's voice, which is the fault slice 5b took out of the style
 * measurement. So a level is read only when the note carries at least one pair
 * whose after side is the technician's own prose (specimens.js marks those
 * `own`: an edited correction or hand typing). A rejection alone puts model
 * text back and does not count. The limit, stated: one word typed by hand
 * admits the whole note, because a rate cannot be taken off a single word.
 *
 * Diction arrives already counted, from NoteDistill.harvest, and every count
 * there came from an edit, so it needs no gate of its own here.
 *
 * Plain functions, no DOM, no network. Needs NoteStyleFeatures, NoteMetrics.
 * Exposes window.NoteVoice.
 */
(function () {
  "use strict";

  /* The four features the store keeps a level for, by the names it reads.
     Mirrored from HOUSE_FEATURES in apps/profile-api/src/house-prior.js and
     pinned to it by apps/profile-api/test/voice-write.test.js. */
  var FEATURES = ["within_cv", "step_rel", "actor_naming", "hedging"];

  /* The floor style-features.js judges a passage on. Below it a rate per word
     or per sentence swings on one sentence, and a level is a mean over notes
     that each have to be worth a vote. */
  var MIN_WORDS = 25;

  function passageOf(ids, shipped) {
    var from = shipped || {};
    return (Array.isArray(ids) ? ids : []).map(function (id) {
      return String(from[id] == null ? "" : from[id]);
    }).join("\n\n");
  }

  /**
   * The four levels one passage measures.
   *
   * @param {string} passage  narrative sections joined by blank lines
   * @returns {object|null} only the features the passage can support. The two
   *   section measures are left out rather than sent as zero when the sections
   *   are too short, for the reason the shape profile gives: a zero would enter
   *   perfect flatness as a real observation.
   */
  function levels(passage) {
    var text = String(passage == null ? "" : passage);
    var style = window.NoteStyleFeatures ? window.NoteStyleFeatures._measure(text) : null;
    if (!style || style.words < MIN_WORDS) return null;
    var out = { actor_naming: style.actor_naming, hedging: style.hedging };
    var shape = window.NoteMetrics ? window.NoteMetrics.measure(text) : null;
    if (shape && shape.sectionCv > 0) out.within_cv = shape.sectionCv;
    if (shape && shape.sectionStep > 0) out.step_rel = shape.sectionStep;
    return out;
  }

  /**
   * The entry one note contributes, or null when it has nothing to teach.
   *
   * @param {object} args
   * @param {string} args.tool       the tool id
   * @param {string[]} args.ids      narrative section ids, in note order
   * @param {object} args.shipped    the note as copied, by section id
   * @param {Array} args.pairs       NoteSpecimens.pairs() for this note
   * @param {{diction: Array, specimens: Array}|null} [args.harvest]
   *   NoteDistill.harvest() for this note, once an affordance answers
   * @returns {{tool, levels, diction}|null}
   */
  function entry(args) {
    var a = args || {};
    var harvest = a.harvest || {};
    var pairs = (Array.isArray(a.pairs) ? a.pairs : [])
      .concat(Array.isArray(harvest.specimens) ? harvest.specimens : []);
    var ownCount = pairs.filter(function (p) { return !!p && p.own === true; }).length;
    var own = ownCount > 0;
    var read = own ? levels(passageOf(a.ids, a.shipped)) : null;
    var diction = Array.isArray(harvest.diction) ? harvest.diction : [];
    if (!read && !diction.length) return null;
    /* Engagement: the share of this note's specimen pairs that are the
       technician's own prose. The store weights the two shape features by it
       (house-prior.js, `evidence`), so a note they barely touched teaches the
       tool less about how they write than one they worked. */
    var out = { tool: String(a.tool || ""), levels: read || {}, diction: diction };
    if (read) out.engagement = ownCount / pairs.length;
    return out;
  }

  window.NoteVoice = {
    FEATURES: FEATURES,
    MIN_WORDS: MIN_WORDS,
    levels: levels,
    entry: entry,
  };
})();
