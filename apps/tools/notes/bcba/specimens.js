/* THREE PAIRED SPECIMENS FROM ONE NOTE, AND WHICH SIDE OF EACH IS WHOSE.
 *
 * style-features.js measures a before and an after and returns a feature, a
 * direction and a magnitude. It used to be handed one pair per note: the draft
 * the model wrote against the note the technician copied. That pair has three
 * different acts inside it, and one act that is not the technician's at all.
 *
 *   draft      what the model wrote
 *     |        the corrections pass changes it. The TOOL did this, and a
 *     |        change nobody touched is accepted by default, which is low
 *     |        evidence. It is not measured as anyone's prose.
 *   offered    the note with every correction standing
 *     |        REJECTED: the technician undid a correction
 *   rejected   the note with only the undos applied
 *     |        EDITED: the technician reworded a correction they kept
 *   decided    the note as the marks now read
 *     |        OVERTYPED: the technician typed over the text by hand
 *   shipped    the note they copied
 *
 * Each link is one pair, so no difference is taught twice and every difference
 * is taught as the act that made it. Measuring draft against shipped taught a
 * correction left standing as the technician's own typing, which is the
 * weakest disposition scored as the strongest.
 *
 * WHAT IS NOT CHANGED. What leaves the page is still compare()'s output and
 * nothing else. The kind of a pair never rides along with the features: it
 * picks the `source` compare already carries, and that is all.
 *
 * WHEN. All three are taught at the one moment a note teaches, the first Copy,
 * off the note's final state. A correction undone and then put back teaches
 * nothing, because by the time the note leaves it was not rejected.
 *
 * WHY A BOOK. "Edit by hand" puts a section's marks away, and with them the
 * record of what was offered and what was undone. observe() copies the three
 * readings out every time the marks change and keeps a section after its marks
 * are gone, so a section finished by hand still knows where it started.
 *
 * Plain functions, no DOM, no network. Exposes window.NoteSpecimens.
 */
(function () {
  "use strict";

  /* `own` says whether the AFTER side is the technician's own prose. A
     rejection puts the model's draft back, so its after side is model text: it
     is real evidence about what they prefer and it must not be filed as
     something they wrote. */
  var KINDS = {
    rejected: { source: "revision", own: false },
    edited: { source: "manual", own: true },
    overtyped: { source: "manual", own: true },
  };

  // The chain, in order. Each kind reads the stage before it against its own.
  var ORDER = ["rejected", "edited", "overtyped"];

  function has(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  // The mark state with every rewording taken out and every undo left in.
  function undosOnly(state) {
    var out = {};
    Object.keys(state || {}).forEach(function (k) {
      if (state[k] && state[k].reverted) out[k] = { reverted: true };
    });
    return out;
  }

  /**
   * Read the three stages off every section that has marks right now.
   *
   * @param {object|null} book         what was read last time
   * @param {object|null} corrections  S.corrections, or null
   * @param {object} markState         S.markState
   * @returns {object} a NEW book. A section whose marks were put away keeps
   *   the entry it had, which is the whole reason this is a book.
   */
  function observe(book, corrections, markState) {
    var next = {};
    Object.keys(book || {}).forEach(function (id) { next[id] = book[id]; });
    var sections = corrections && corrections.sections;
    if (!sections || !window.NoteCorrections) return next;
    var state = markState || {};
    var undos = undosOnly(state);
    Object.keys(sections).forEach(function (id) {
      next[id] = {
        offered: window.NoteCorrections.textFor(sections, id, {}),
        rejected: window.NoteCorrections.textFor(sections, id, undos),
        decided: window.NoteCorrections.textFor(sections, id, state),
      };
    });
    return next;
  }

  /**
   * The pairs to measure when the note leaves.
   *
   * Every pair is measured over the same passage, every narrative section
   * joined, which is the passage the copy-time comparison has always used. A
   * section with no marks reads the model's draft at the first three stages, so
   * for a note the corrections pass never touched this is the old comparison
   * exactly.
   *
   * @param {object} args
   * @param {string[]} args.ids      narrative section ids, in note order
   * @param {object} args.draft      the model's last output
   * @param {object|null} args.book  from observe()
   * @param {object} args.shipped    S.output
   * @returns {Array<{kind, source, own, before, after}>} only the links where
   *   something changed
   */
  function pairs(args) {
    var a = args || {};
    var ids = Array.isArray(a.ids) ? a.ids : [];
    var draft = a.draft || {};
    var book = a.book || {};
    var shipped = a.shipped || {};

    var offered = [], rejected = [], decided = [], sent = [];
    ids.forEach(function (id) {
      var drafted = String(draft[id] == null ? "" : draft[id]);
      var read = has(book, id) ? book[id] : null;
      offered.push(read ? read.offered : drafted);
      rejected.push(read ? read.rejected : drafted);
      decided.push(read ? read.decided : drafted);
      sent.push(String(shipped[id] == null ? "" : shipped[id]));
    });

    // One line per firing site, so each can be taken out on its own.
    var out = [];
    link(out, "rejected", offered, rejected);
    link(out, "edited", rejected, decided);
    link(out, "overtyped", decided, sent);
    return out;
  }

  function link(out, kind, from, to) {
    var before = from.join("\n\n");
    var after = to.join("\n\n");
    if (before === after) return;
    out.push({ kind: kind, source: KINDS[kind].source, own: KINDS[kind].own, before: before, after: after });
  }

  window.NoteSpecimens = {
    KINDS: KINDS,
    ORDER: ORDER,
    observe: observe,
    pairs: pairs,
  };
})();
