/* Word-level diff for the inline revision view.
 *
 * A revision returns the whole rewritten section, so without a diff the
 * clinician has to re-read a paragraph to find the clause that changed. This
 * marks the change in place instead.
 *
 * Hand-rolled because these pages have no build step and no runtime
 * dependencies - adding one for ~70 lines of Myers-adjacent DP would mean
 * introducing a bundler to the only part of the repo that doesn't have one.
 *
 * Exposes window.NoteDiff.words(before, after) -> [{type, text}] where type is
 * "same" | "ins" | "del", in reading order.
 */
(function () {
  "use strict";

  // Split into words AND the whitespace between them, so reassembling the
  // "same" runs reproduces the original text exactly - including paragraph
  // breaks, which matter in a clinical narrative.
  function tokenize(text) {
    return String(text == null ? "" : text).match(/\s+|[^\s]+/g) || [];
  }

  // Compare on the visible word, not the spacing around it: a rewrite that only
  // reflows whitespace should not light up as a change.
  function key(tok) {
    return /^\s+$/.test(tok) ? " " : tok;
  }

  // Longest common subsequence over the token arrays, bounded by trimming the
  // shared head and tail first. A revision usually edits one clause, so the
  // trimmed middle is tiny even when the section is long - which keeps the
  // O(n*m) table small enough to build without a smarter algorithm.
  function lcsMatrix(a, b) {
    const n = a.length, m = b.length;
    const table = [];
    for (let i = 0; i <= n; i++) table.push(new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i][j] = key(a[i]) === key(b[j])
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    return table;
  }

  // Merge neighbouring ops of the same type so the rendered output is a handful
  // of spans rather than one per word.
  function coalesce(ops) {
    const out = [];
    ops.forEach(function (op) {
      if (!op.text) return;
      const last = out[out.length - 1];
      if (last && last.type === op.type) last.text += op.text;
      else out.push({ type: op.type, text: op.text });
    });
    return out;
  }

  function words(before, after) {
    const a = tokenize(before);
    const b = tokenize(after);

    let head = 0;
    while (head < a.length && head < b.length && key(a[head]) === key(b[head])) head++;

    let tail = 0;
    while (
      tail < a.length - head &&
      tail < b.length - head &&
      key(a[a.length - 1 - tail]) === key(b[b.length - 1 - tail])
    ) tail++;

    const midA = a.slice(head, a.length - tail);
    const midB = b.slice(head, b.length - tail);

    const ops = [];
    if (head) ops.push({ type: "same", text: a.slice(0, head).join("") });

    // Whole-section rewrite, or one side empty - no useful alignment to show.
    if (!midA.length || !midB.length) {
      if (midA.length) ops.push({ type: "del", text: midA.join("") });
      if (midB.length) ops.push({ type: "ins", text: midB.join("") });
    } else {
      const table = lcsMatrix(midA, midB);
      let i = 0, j = 0;
      while (i < midA.length && j < midB.length) {
        if (key(midA[i]) === key(midB[j])) {
          // Keep the NEW side's spacing so accepted text reads as the model wrote it.
          ops.push({ type: "same", text: midB[j] });
          i++; j++;
        } else if (table[i + 1][j] >= table[i][j + 1]) {
          ops.push({ type: "del", text: midA[i] });
          i++;
        } else {
          ops.push({ type: "ins", text: midB[j] });
          j++;
        }
      }
      while (i < midA.length) { ops.push({ type: "del", text: midA[i] }); i++; }
      while (j < midB.length) { ops.push({ type: "ins", text: midB[j] }); j++; }
    }

    if (tail) ops.push({ type: "same", text: b.slice(b.length - tail).join("") });

    return coalesce(ops);
  }

  // True when the two texts differ in anything but whitespace. Used to decide
  // whether a returned section is worth showing as a change at all.
  function changed(before, after) {
    return words(before, after).some(function (op) { return op.type !== "same"; });
  }

  /* ── Moves ────────────────────────────────────────────────────────────────
     words() is the wrong granularity for restructuring. Word-level LCS over a
     reordered paragraph produces alternating one-word insertions and deletions
     with no run longer than a word, so a sentence that simply changed place
     reads as the whole paragraph being rewritten. Measured on a three-sentence
     reorder: 32 alternating ops, no run of 2.

     For restructuring the unit is the sentence. sections() aligns sentences
     first, which makes a moved sentence a clean deletion here and a clean
     insertion there - and those two are pairable. Word-level diff still runs,
     but only INSIDE a sentence that was rewritten rather than moved, which is
     the case it was always good at.

     Both ends of a move keep their text and share a moveId. How each end is
     drawn is the renderer's call, not this module's. */

  const MIN_MOVE_WORDS = 4;
  // Two sentences sharing at least this fraction of their words are a rewrite
  // of one another rather than an unrelated pair, so they get a word-level
  // diff instead of being shown as a wholesale replacement.
  const REWRITE_OVERLAP = 0.5;

  function wordCount(text) {
    return (String(text).trim().match(/[^\s]+/g) || []).length;
  }

  function moveKey(text) {
    return String(text).trim().replace(/\s+/g, " ");
  }

  // Keep the trailing whitespace on each sentence so joining the pieces
  // reproduces the original exactly, including paragraph breaks.
  function splitSentences(text) {
    const raw = String(text == null ? "" : text);
    if (!raw) return [];
    return raw.match(/[^.!?\n]*(?:[.!?]+|\n+|$)\s*/g).filter(function (t) { return t !== ""; });
  }

  function lcsOver(a, b, keyOf) {
    const n = a.length, m = b.length;
    const table = [];
    for (let i = 0; i <= n; i++) table.push(new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i][j] = keyOf(a[i]) === keyOf(b[j])
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    return table;
  }

  function sentenceOps(before, after) {
    const a = splitSentences(before);
    const b = splitSentences(after);
    if (!a.length && !b.length) return [];
    if (!a.length) return b.map(function (t) { return { type: "ins", text: t }; });
    if (!b.length) return a.map(function (t) { return { type: "del", text: t }; });

    const table = lcsOver(a, b, moveKey);
    const ops = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (moveKey(a[i]) === moveKey(b[j])) { ops.push({ type: "same", text: b[j] }); i++; j++; }
      else if (table[i + 1][j] >= table[i][j + 1]) { ops.push({ type: "del", text: a[i] }); i++; }
      else { ops.push({ type: "ins", text: b[j] }); j++; }
    }
    while (i < a.length) { ops.push({ type: "del", text: a[i] }); i++; }
    while (j < b.length) { ops.push({ type: "ins", text: b[j] }); j++; }
    return ops;
  }

  function overlap(x, y) {
    const ax = moveKey(x).toLowerCase().split(" ").filter(Boolean);
    const by = moveKey(y).toLowerCase().split(" ").filter(Boolean);
    if (!ax.length || !by.length) return 0;
    const pool = by.slice();
    let hit = 0;
    ax.forEach(function (w) {
      const at = pool.indexOf(w);
      if (at !== -1) { hit++; pool.splice(at, 1); }
    });
    return hit / Math.max(ax.length, by.length);
  }

  function sections(before, after) {
    const out = {};
    const dels = [];
    const inss = [];

    Object.keys(after || {}).forEach(function (id) {
      const ops = sentenceOps((before || {})[id] || "", (after || {})[id] || "");
      out[id] = ops;
      ops.forEach(function (op, index) {
        if (wordCount(op.text) < MIN_MOVE_WORDS) return;
        if (op.type === "del") dels.push({ id: id, index: index, key: moveKey(op.text) });
        else if (op.type === "ins") inss.push({ id: id, index: index, key: moveKey(op.text) });
      });
    });

    // A sentence that survived verbatim somewhere else was moved, not deleted.
    // The technician wrote it; showing it as lost claims otherwise.
    const claimed = {};
    let moveId = 0;
    dels.forEach(function (d) {
      for (let k = 0; k < inss.length; k++) {
        const ins = inss[k];
        if (claimed[k] || ins.key !== d.key) continue;
        if (ins.id === d.id && ins.index === d.index) continue;
        claimed[k] = true;
        moveId++;
        const source = out[d.id][d.index];
        const dest = out[ins.id][ins.index];
        source.type = "move-out"; source.moveId = moveId; source.to = ins.id;
        dest.type = "move-in";    dest.moveId = moveId;   dest.from = d.id;
        d.paired = true;
        return;
      }
    });

    // What is left may still be a rewrite of the same sentence rather than an
    // unrelated pair. Where it is, fall back to the word-level diff, which is
    // the case words() was written for.
    Object.keys(out).forEach(function (id) {
      const ops = out[id];
      const merged = [];
      for (let n = 0; n < ops.length; n++) {
        const cur = ops[n], next = ops[n + 1];
        if (cur && next && cur.type === "del" && next.type === "ins" &&
            overlap(cur.text, next.text) >= REWRITE_OVERLAP) {
          words(cur.text, next.text).forEach(function (op) { merged.push(op); });
          n++;
          continue;
        }
        merged.push(cur);
      }
      out[id] = merged;
    });

    return out;
  }

  window.NoteDiff = { words: words, changed: changed, sections: sections, MIN_MOVE_WORDS: MIN_MOVE_WORDS };
})();
