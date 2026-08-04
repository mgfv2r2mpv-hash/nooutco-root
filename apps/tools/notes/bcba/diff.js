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

  window.NoteDiff = { words: words, changed: changed };
})();
