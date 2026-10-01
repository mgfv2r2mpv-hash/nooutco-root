/*
 * notes-roleswap-ctx.js - Where a word sits in a note.
 *
 * One of the notes-roleswap-*.js scripts, loaded in this order, each a small IIFE
 * adding to the one window.NotesRoleswap namespace (see notes-roleswap.js, which
 * loads last and holds the public API):
 *   lex, values, rows, ctx, engine, then notes-roleswap.js
 * Ported from the sass-assistant roleswap engine (src/roleswap/*.mjs) with the
 * import/export lines turned into namespace reads and writes and nothing else
 * changed. Pure: no DOM, no storage, no network, no globals but NotesRoleswap.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var NS = root.NotesRoleswap = root.NotesRoleswap || {};

  // What the role swap knows about WHERE a word sits, and nothing about which word.
  //
  // His ruling: always leave generic "quoted speech (straight or curly quotes),
  // titles, headings, ALL-CAPS lines, 3+ capitalized-word title lines, bold labels
  // ending in a colon". Every one of those is a fact about the place a mention
  // stands in, not about the mention, so they are worked out here once per note and
  // the engine asks `ctx.at(offset)` for the answer.
  //
  // It reads the ORIGINAL text and never the swapped one. The swap is one pass over
  // what he wrote, so a name it puts in can never be found by a later look.
  //
  // No imports.

  const SMALL_WORDS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'for', 'to', 'in', 'on', 'at', 'with', 'by', 'from', 'vs']);

  // `[start, end)` of every paragraph: runs of text split on a blank line.
  function paragraphRanges(src) {
    const out = [];
    const re = /\n[ \t\r]*\n+/g;
    let from = 0;
    for (const m of src.matchAll(re)) {
      out.push([from, m.index]);
      from = m.index + m[0].length;
    }
    out.push([from, src.length]);
    return out;
  }

  // The offsets just AFTER each sentence end: a full stop, question or exclamation
  // mark (with any closing quote or bracket) followed by space or the end, or a
  // line break.
  function sentenceEnds(src) {
    const ends = [];
    for (const m of src.matchAll(/[.!?]+["”')\]]*(?=\s|$)|\n/gu)) ends.push(m.index + m[0].length);
    return ends;
  }

  // Straight quotes pair up within a line; curly pairs and guillemets are matched
  // by their own shapes. An odd straight quote at the end of a line pairs with
  // nothing, which is a quote he forgot to close and not a reason to leave the
  // rest of the line generic.
  function quoteRanges(src) {
    const out = [];
    let lineStart = 0;
    for (const line of src.split('\n')) {
      const marks = [];
      for (let i = 0; i < line.length; i += 1) if (line[i] === '"') marks.push(lineStart + i);
      for (let i = 0; i + 1 < marks.length; i += 2) out.push([marks[i], marks[i + 1] + 1]);
      lineStart += line.length + 1;
    }
    for (const m of src.matchAll(/“[^”\n]*”|«[^»\n]*»/gu)) out.push([m.index, m.index + m[0].length]);
    return out;
  }

  // A line is a title when it reads as one: a heading marker, every letter in
  // capitals, or three or more capitalised words with no sentence end.
  function lineIsTitle(line) {
    const t = line.trim();
    if (!t) return false;
    if (/^#{1,6}\s/.test(t)) return true;
    const letters = t.replace(/[^\p{L}]/gu, '');
    if (letters.length >= 2 && t === t.toUpperCase() && /\p{Lu}/u.test(t)) return true;
    // A short line that ends in a colon is a label for what follows.
    if (/:$/.test(t) && t.length <= 80) return true;
    if (/[.!?]$/.test(t)) return false;
    const words = t.split(/\s+/).filter((w) => /\p{L}/u.test(w));
    // A lone capital is a label ("Client A and Client B"), not a title word.
    const big = words.filter((w) => /^["'(“]*\p{Lu}/u.test(w) && w.replace(/[^\p{L}]/gu, '').length > 1);
    const rest = words.filter((w) => !/^["'(“]*\p{Lu}/u.test(w));
    return big.length >= 3 && rest.every((w) => SMALL_WORDS.has(w.toLowerCase()));
  }

  // `**Label:**` and `**Label**:` and the underscore forms. Ranges of the whole
  // marked label.
  function boldLabelRanges(src) {
    const out = [];
    for (const m of src.matchAll(/(\*\*|__)([^*_\n]+?)\1(:?)/gu)) {
      if (m[2].trim().endsWith(':') || m[3] === ':') out.push([m.index, m.index + m[0].length]);
    }
    return out;
  }

  const within = (ranges, at) => ranges.some(([a, b]) => at >= a && at < b);

  // The structure of one note.
  function noteContext(text) {
    const src = String(text);
    const paragraphs = paragraphRanges(src);
    const ends = sentenceEnds(src);
    const quotes = quoteRanges(src);
    const labels = boldLabelRanges(src);
    const titleLines = [];
    let at = 0;
    for (const line of src.split('\n')) {
      if (lineIsTitle(line)) titleLines.push([at, at + line.length + 1]);
      at += line.length + 1;
    }
    return {
      src,
      paragraphs,
      // Which paragraph an offset is in.
      paragraphOf(offset) {
        const i = paragraphs.findIndex(([a, b]) => offset >= a && offset <= b);
        return i < 0 ? paragraphs.length - 1 : i;
      },
      // Which sentence, counted across the note. Two offsets share a sentence when
      // no sentence end lies between them.
      sentenceOf(offset) {
        let n = 0;
        while (n < ends.length && ends[n] <= offset) n += 1;
        return n;
      },
      quoted: (offset) => within(quotes, offset),
      titled: (offset) => within(titleLines, offset) || within(labels, offset),
    };
  }

  // The word before `start`, or what stands there instead: a punctuation mark, or
  // the start of a line. Spaces and tabs are skipped; a line break is a start.
  function before(src, start) {
    const head = src.slice(Math.max(0, start - 64), start);
    const spaced = head.replace(/[ \t\r]+$/, '');
    if (!spaced || spaced.endsWith('\n')) return { kind: 'start' };
    const m = spaced.match(/([\p{L}\p{N}][\p{L}\p{N}'’ʼ´`-]*)$/u);
    if (!m) return { kind: 'punct', ch: spaced[spaced.length - 1] };
    const raw = m[1];
    return { kind: 'word', raw, lower: raw.toLowerCase(), at: start - (head.length - spaced.length) - raw.length, gap: head.length - spaced.length };
  }

  // The word after `end`, or a mark, or the end of the line.
  function after(src, end) {
    const tail = src.slice(end, end + 64);
    if (!tail || tail[0] === '\n' || (tail[0] === '\r' && tail[1] === '\n')) return { kind: 'end' };
    const spaces = tail.match(/^[ \t]*/)[0].length;
    const rest = tail.slice(spaces);
    if (!rest || rest[0] === '\n' || (rest[0] === '\r' && rest[1] === '\n')) return { kind: 'end' };
    const m = rest.match(/^[\p{L}\p{N}][\p{L}\p{N}'’ʼ´`-]*/u);
    if (!m) return { kind: 'punct', ch: rest[0], rest, spaces };
    const raw = m[0];
    return { kind: 'word', raw, lower: raw.toLowerCase(), capital: /^\p{Lu}/u.test(raw), rest, spaces, len: raw.length };
  }

  NS._ctx = { noteContext, before, after };
})();
