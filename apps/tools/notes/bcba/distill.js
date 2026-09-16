/* WHAT AN EDIT TEACHES, AND WHAT IT LEAVES BEHIND.
 *
 * disposition.js records what a technician did about a suggestion against the
 * suggestion's CLASS, and on an edit it hands the offered and kept sentences to
 * a sink and keeps neither. This file is that sink. One pair goes in and two
 * readings come out of the same pair:
 *
 *   diction  which synonyms the technician reached for that the offer did not
 *            hold, as {family_id, variant_index, count} through the sealed
 *            house dictionary in diction.js. Words the offer already had are
 *            not counted: leaving a word standing is the weak "none" answer,
 *            and an edit is the strongest one, so only what the edit added is
 *            the edit's evidence.
 *   shape    a specimen in the form specimens.js already hands the style
 *            measurement, {kind, source, own, before, after}, with the offer
 *            as before and the rewrite as after.
 *
 * WHY DICTION COUNTS USES AND NOT WEIGHTS. The four dispositions carry four
 * weights and those live in the ledger, where score() sums them per class. A
 * diction count is how many times an author used a word, and the store caps it
 * and turns it into a share. Multiplying it by an edit's weight would record
 * five uses of a word somebody wrote once. The weight takes effect in which
 * answers produce a pair at all: only an edit does.
 *
 * WHY A CORRECTION MARK GETS NO SHAPE SPECIMEN HERE. The specimen chain in
 * specimens.js already reads a reworded correction off the marks at Copy and
 * teaches it as the EDITED link. A correction mark answered through the ledger
 * as well would teach the same rewording twice. Its diction is still tallied,
 * because the chain does not count diction.
 *
 * WHEN. Nothing here posts anything. answer() keeps the latest reading per
 * item in a per-note book and harvest() reads the book when the note leaves,
 * the same moment the chain teaches. A rewording later reverted teaches
 * nothing, because by the time the note leaves it was not kept.
 *
 * NO TEXT LEAVES THIS FILE THROUGH THE LEDGER. The book holds the pair as the
 * shape specimen, in the browser and for one note, the same way the specimen
 * chain holds it. harvest() returns counts, and specimens for a caller to
 * measure, never a row to store.
 *
 * Plain functions, no DOM, no network. Needs NoteDisposition, NoteDiction.
 * Exposes window.NoteDistill.
 */
(function () {
  "use strict";

  /* Producers whose rewordings the specimen chain already measures as shape.
     A class filed under one of these gets a diction tally and no specimen. */
  var CHAIN_PRODUCERS = ["corrections"];

  // The same kind, source and owner specimens.js gives an EDITED link.
  var EDITED = { kind: "edited", source: "manual", own: true };

  function slot(c) {
    return c.family_id + ":" + c.variant_index;
  }

  /**
   * What the rewrite reached for that the offer did not hold.
   *
   * @returns {{counts, unknown, words, refused}|null} through NoteDiction.record,
   *   so a count can only be a house family and a whole number. unknown and
   *   words describe the kept side. Null when the dictionary is not loaded.
   */
  function diction(offered, kept) {
    var D = window.NoteDiction;
    if (!D) return null;
    var before = D.tally(String(offered || ""));
    var after = D.tally(String(kept || ""));
    var had = {};
    before.counts.forEach(function (c) { had[slot(c)] = c.count; });
    var gained = [];
    after.counts.forEach(function (c) {
      var more = c.count - (had[slot(c)] || 0);
      if (more > 0) gained.push({ family_id: c.family_id, variant_index: c.variant_index, count: more });
    });
    return D.record({ counts: gained, unknown: after.unknown, words: after.words });
  }

  function producerOf(cls) {
    return String(cls || "").split(":")[0];
  }

  /**
   * Both readings of one pair. This is the function handed to
   * NoteDisposition.record as its sink, through answer() below.
   *
   * @param {{cls: string, tool: string, offered: string, kept: string}} pair
   *   exactly what disposition.js hands its sink
   * @returns {{cls, tool, diction, shape}}
   */
  function distill(pair) {
    var p = pair || {};
    var offered = String(p.offered || "");
    var kept = String(p.kept || "");
    var chain = CHAIN_PRODUCERS.indexOf(producerOf(p.cls)) !== -1;
    return {
      cls: String(p.cls || ""),
      tool: String(p.tool || ""),
      diction: diction(offered, kept),
      shape: chain || offered === kept ? null : {
        kind: EDITED.kind, source: EDITED.source, own: EDITED.own, before: offered, after: kept,
      },
    };
  }

  /* WHICH ITEM, AS OPPOSED TO WHICH CLASS. Two correction marks in one section
     are one class, corrections:correction:<section>, and two different
     sentences. Keyed by class alone, a second rewording would overwrite the
     first and one of them would never be taught. The item is the caller's own
     key for the one thing answered (a mark key such as
     lessonProgressNarrative:0, a suggestion key such as 3:1). It only picks a
     slot in the book, which lives in the browser for one note. It is never
     handed to the ledger, so a row cannot hold it. A value that is not a short
     key is read as no item at all. */
  var ITEM = /^[A-Za-z0-9_.:-]{1,64}$/;

  function bookKey(cls, item) {
    return typeof item === "string" && ITEM.test(item) ? cls + "#" + item : cls;
  }

  function emptyState() {
    return { ledger: window.NoteDisposition.emptyLedger(), book: {} };
  }

  /**
   * THE CALL AN AFFORDANCE MAKES. One suggestion, one answer, one pair.
   *
   * @param {{ledger, book}|null} state  what the last call returned, or null to
   *   start a note
   * @param {{producer, code, section, tool, item}} suggestion  identifiers,
   *   plus the caller's own key for the one item answered. Any other key on
   *   it, a detail sentence included, is never read
   * @param {"none"|"approve"|"reject"|"revert"|"edit"} disposition
   * @param {{offered: string, kept: string}|null} pair  read on an edit only
   * @returns {{ledger, book}} a NEW state. The one passed in is not touched.
   */
  function answer(state, suggestion, disposition, pair) {
    var s = state && state.ledger && state.book ? state : emptyState();
    var sug = suggestion || {};
    var p = pair || {};
    var caught = null;
    var ledger = window.NoteDisposition.record(s.ledger, {
      producer: sug.producer, code: sug.code, section: sug.section, tool: sug.tool,
      disposition: disposition, offered: p.offered, kept: p.kept,
    }, function (handed) { caught = distill(handed); });

    // Refused by the ledger, so it teaches nothing either.
    if (ledger.entries.length === s.ledger.entries.length) return { ledger: ledger, book: s.book };

    var entry = ledger.entries[ledger.entries.length - 1];
    var key = bookKey(entry.cls, sug.item);
    var book = {};
    Object.keys(s.book).forEach(function (k) { book[k] = s.book[k]; });
    if (caught) {
      book[key] = caught;
    } else if (entry.disposition === "reject") {
      // The rewrite was put back, so the note no longer holds it.
      delete book[key];
    }
    return { ledger: ledger, book: book };
  }

  /**
   * What the note teaches when it leaves.
   *
   * @returns {{diction: Array<{family_id, variant_index, count}>, specimens: Array}}
   *   diction merged across every item still standing, specimens in book key
   *   order for a caller to hand to the style measurement
   */
  function harvest(state) {
    var book = state && state.book ? state.book : {};
    var counts = [];
    var specimens = [];
    Object.keys(book).sort().forEach(function (cls) {
      var read = book[cls];
      if (read.diction) counts = window.NoteDiction.merge(counts, read.diction.counts);
      if (read.shape) specimens.push(read.shape);
    });
    return { diction: counts, specimens: specimens };
  }

  window.NoteDistill = {
    CHAIN_PRODUCERS: CHAIN_PRODUCERS,
    EDITED: EDITED,
    diction: diction,
    distill: distill,
    emptyState: emptyState,
    answer: answer,
    harvest: harvest,
  };
})();
