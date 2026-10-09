// The strip of graph pictures waiting to be read (issue #100).
//
// A BCBA defending a record usually has several graphs, so the tool holds a
// list rather than one image. Each picture is blacked out and cropped in the
// editor, then marked Done, and Done is what bakes it: the baked copy is the
// only thing that ever leaves the browser, and the original File stays here.
// Read stays off until every picture in the strip is Done, and opening a Done
// picture to change it takes its Done away, so nothing half-edited is sent.
//
// Pure functions over plain data, so the rules can be tested without a canvas.
// A picture: { id, label, file, marks, baked, bakedHi, done, reading, error }.
// The file name is never read or shown, because a name on a file can be a name.
(function () {
  "use strict";

  var MAX_PICTURES = 6;

  function empty() {
    return { pictures: [], next: 1 };
  }

  function relabel(pictures) {
    return pictures.map(function (p, i) { return Object.assign({}, p, { label: "Graph " + (i + 1) }); });
  }

  // Adds what fits under the cap; the rest is reported, never dropped silently.
  function add(strip, files) {
    var list = Array.prototype.slice.call(files || []);
    var room = Math.max(0, MAX_PICTURES - strip.pictures.length);
    var taken = list.slice(0, room);
    var next = strip.next;
    var added = taken.map(function (file) {
      var p = { id: "p" + next, label: "", file: file, marks: null, baked: null, bakedHi: null, done: false, reading: null, error: "" };
      next += 1;
      return p;
    });
    return {
      strip: { pictures: relabel(strip.pictures.concat(added)), next: next },
      added: added.map(function (p) { return p.id; }),
      left: list.length - taken.length,
    };
  }

  function remove(strip, id) {
    return { pictures: relabel(strip.pictures.filter(function (p) { return p.id !== id; })), next: strip.next };
  }

  function update(strip, id, patch) {
    return {
      pictures: strip.pictures.map(function (p) { return p.id === id ? Object.assign({}, p, patch) : p; }),
      next: strip.next,
    };
  }

  // Done: the marks as drawn and both bakes, the one read first and the
  // sharper one a failed read retries with. Any earlier reading is stale.
  function markDone(strip, id, marks, baked, bakedHi) {
    return update(strip, id, { marks: marks, baked: baked, bakedHi: bakedHi, done: true, reading: null, error: "" });
  }

  // Opened again to change it: the bakes go, so the old copy cannot be sent.
  function reopen(strip, id) {
    return update(strip, id, { baked: null, bakedHi: null, done: false, reading: null, error: "" });
  }

  function find(strip, id) {
    for (var i = 0; i < strip.pictures.length; i++) if (strip.pictures[i].id === id) return strip.pictures[i];
    return null;
  }

  function firstUndone(strip) {
    for (var i = 0; i < strip.pictures.length; i++) if (!strip.pictures[i].done) return strip.pictures[i];
    return null;
  }

  // Whether Read may run, and if not, the one plain reason why.
  function readiness(strip) {
    if (!strip.pictures.length) return { ok: false, reason: "Add a graph image first." };
    var open = firstUndone(strip);
    if (open) return { ok: false, reason: open.label + " is not done yet. Black out anything identifying, crop if you want to, then select Done." };
    return { ok: true, reason: "" };
  }

  window.GVA_PICTURES = {
    MAX_PICTURES: MAX_PICTURES,
    empty: empty,
    add: add,
    remove: remove,
    update: update,
    markDone: markDone,
    reopen: reopen,
    find: find,
    firstUndone: firstUndone,
    readiness: readiness,
  };
})();
