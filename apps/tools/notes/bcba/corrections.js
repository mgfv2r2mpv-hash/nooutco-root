/* The corrections pass, as marks the technician can act on.
 *
 * The Worker returns each corrected section whole. This turns that into the
 * marks drawn over the draft, and folds the technician's decisions about those
 * marks back into the text the note ships with.
 *
 * THE DEFAULT IS ACCEPTED. Every mark starts applied, so a technician who reads
 * the note and copies it gets the corrected note. His ruling: doing nothing
 * ships all of it. Undo is what costs a click, not accept, because the pass is
 * only allowed to do things the handout already asks for.
 *
 * NoteDiff.sections does the alignment, including working out that a sentence
 * which left one section and arrived in another was MOVED. Nothing here
 * re-derives that. What this module owns is which marks exist, which two belong
 * to one move, and what the section reads like given a set of decisions.
 *
 * Exposes window.NoteCorrections.
 */
(function () {
  "use strict";

  var MOVE_TYPES = { "move-in": true, "move-out": true };

  function keyOf(id, index) {
    return id + ":" + index;
  }

  /* Tidy up after a removal. Taking a sentence out leaves the space that used
     to sit beside it, and two spaces mid-paragraph is the kind of thing a
     supervisor notices and the technician did not do.

     Runs ONLY on a section the pass actually changed, so an untouched narrative
     is never quietly reformatted under someone who typed it that way. */
  function tidy(text) {
    return String(text)
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /* One mark's contribution to the section it sits in.

     A move is drawn at both ends and each end contributes the opposite thing:
     the origin's text is what comes OUT when the move stands, and the
     destination's is what goes in. Reverting either end therefore has to revert
     both, or the sentence ends up in two places or in none - which is the exact
     fault the move-aware diff exists to prevent, arriving one layer later. */
  function contribution(op, mark) {
    var reverted = !!(mark && mark.reverted);
    var text = mark && typeof mark.text === "string" ? mark.text : op.text;
    if (op.type === "same") return op.text;
    if (op.type === "ins" || op.type === "move-in") return reverted ? "" : text;
    if (op.type === "del" || op.type === "move-out") return reverted ? op.text : "";
    return op.text;
  }

  // Every mark belonging to the same move, by key. Both ends of a move share a
  // moveId; anything else is only ever itself.
  function pairedKeys(sections, op) {
    if (!op || !MOVE_TYPES[op.type] || !op.moveId) return [];
    var keys = [];
    Object.keys(sections).forEach(function (id) {
      sections[id].forEach(function (other, index) {
        if (MOVE_TYPES[other.type] && other.moveId === op.moveId) keys.push(keyOf(id, index));
      });
    });
    return keys;
  }

  /* Align the draft against what the pass returned.

     `corrections` is the Worker's list, so a section it did not name keeps its
     draft text and grows no marks. Sections are aligned TOGETHER rather than one
     at a time, because a move is only visible across two of them. */
  function build(opts) {
    var o = opts || {};
    var before = o.before || {};
    var list = Array.isArray(o.corrections) ? o.corrections : [];
    if (!list.length) return { sections: {}, marks: [], changed: [], count: 0 };

    var after = {};
    list.forEach(function (c) {
      if (!c || typeof c.section !== "string") return;
      if (!Object.prototype.hasOwnProperty.call(before, c.section)) return;
      after[c.section] = String(c.text == null ? "" : c.text);
    });
    var changed = Object.keys(after);
    if (!changed.length) return { sections: {}, marks: [], changed: [], count: 0 };

    /* Both sides are restricted to the sections the pass changed. Handing
       sections() the untouched ones as well would let it pair a "move" whose
       destination nobody proposed changing, and the browser would then be
       drawing a mark in a section the Worker never returned text for. */
    var scopedBefore = {};
    changed.forEach(function (id) { scopedBefore[id] = String(before[id] == null ? "" : before[id]); });

    var sections = window.NoteDiff.sections(scopedBefore, after);

    var why = {};
    list.forEach(function (c) {
      if (c && typeof c.section === "string" && typeof c.why === "string") why[c.section] = c.why;
    });

    var marks = [];
    changed.forEach(function (id) {
      (sections[id] || []).forEach(function (op, index) {
        if (op.type === "same") return;
        marks.push({
          key: keyOf(id, index),
          id: id,
          index: index,
          type: op.type,
          moveId: op.moveId || 0,
          to: op.to || "",
          from: op.from || "",
          text: op.text,
          why: why[id] || "",
        });
      });
    });

    return { sections: sections, marks: marks, changed: changed, count: marks.length };
  }

  // The section as it currently reads, given the decisions made so far.
  function textFor(sections, id, state) {
    var ops = (sections || {})[id];
    if (!ops) return null;
    var st = state || {};
    var out = "";
    ops.forEach(function (op, index) {
      out += contribution(op, st[keyOf(id, index)]);
    });
    return tidy(out);
  }

  // Every changed section's current reading, ready to fold into the note.
  function outputFor(sections, state) {
    var out = {};
    Object.keys(sections || {}).forEach(function (id) {
      out[id] = textFor(sections, id, state);
    });
    return out;
  }

  /* Toggle one mark, and the other end of its move with it. Returns a NEW state
     map: the note's output is derived from this, and mutating it in place would
     leave React redrawing the same object it already has. */
  function toggle(sections, state, key) {
    var next = {};
    Object.keys(state || {}).forEach(function (k) { next[k] = state[k]; });
    var parts = String(key).split(":");
    var index = Number(parts.pop());
    var id = parts.join(":");
    var op = ((sections || {})[id] || [])[index];
    if (!op) return next;

    var keys = pairedKeys(sections, op);
    if (keys.indexOf(key) === -1) keys.push(key);
    var reverted = !(next[key] && next[key].reverted);
    keys.forEach(function (k) {
      next[k] = { reverted: reverted, text: (next[k] && next[k].text) || undefined };
    });
    return next;
  }

  // Replace one mark's wording. The other end of a move keeps its own: the text
  // that renders in a place is the text that ships there.
  function edit(state, key, text) {
    var next = {};
    Object.keys(state || {}).forEach(function (k) { next[k] = state[k]; });
    next[key] = { reverted: !!(next[key] && next[key].reverted), text: String(text) };
    return next;
  }

  window.NoteCorrections = {
    build: build,
    textFor: textFor,
    outputFor: outputFor,
    toggle: toggle,
    edit: edit,
    keyOf: keyOf,
    tidy: tidy,
  };
})();
