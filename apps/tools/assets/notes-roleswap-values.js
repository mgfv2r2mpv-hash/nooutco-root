/*
 * notes-roleswap-values.js - Typed values, possessives and the FNV-1a hash.
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
  const { NAME_IS_A_WORD } = NS._lex;

  // What the role swap does to a NAME, and the one hash it decides with.
  //
  // Three small things the engine needs and none of them is about English:
  //
  //   the hash       FNV-1a, so the same text and the same seed give the same
  //                  answer on every Mac, on every run, in every browser. Not
  //                  `Math.random`, which would make a second copy-out of the same
  //                  note differ from the first.
  //   possessives    "Hayes's" for a singular that ends in s, and only the
  //                  apostrophe for a plural possessive, His ruling.
  //   value checks   what he typed in a field, said as a sentence he can read.
  //
  // PORTABLE. Imports only `lex.mjs` beside it: no Node API, no sass module.


  const MAX_VALUE = 80;
  // Ordinary words a value must not BE, beyond the names that are also words. The
  // role words are here: a value of "client" would swap "client" for itself.
  const ORDINARY = new Set(['the', 'and', 'but', 'for', 'not', 'with', 'this', 'that', 'client', 'learner',
    'student', 'patient', 'child', 'parent', 'mother', 'father', 'staff', 'session', 'behavior', 'school',
    'home', 'clinic', 'plan', 'report', 'data', 'goal', 'note']);
  // The words of a typed name that are a title, a particle or a suffix.
  const FILLER = new Set(['mr', 'mrs', 'ms', 'mx', 'miss', 'dr', 'prof', 'sir', 'madam', 'jr', 'sr', 'ii', 'iii', 'iv',
    'de', 'la', 'le', 'da', 'del', 'di', 'van', 'von', 'der', 'den', 'bin', 'ibn', 'al', 'el', 'st', 'of', 'the', 'and']);
  const FNV_OFFSET = 0x811c9dc5;
  const FNV_PRIME = 0x01000193;

  // 32 bit FNV-1a over the UTF-16 code units. Returned as an unsigned integer.
  function fnv1a(text) {
    let h = FNV_OFFSET;
    const s = String(text);
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, FNV_PRIME) >>> 0;
    }
    return h >>> 0;
  }

  // A hash as a fraction in [0, 1), ten thousand steps, so a rate of 0.15 is a
  // plain comparison and not a float accident.
  function fraction(text) {
    return (fnv1a(text) % 10000) / 10000;
  }

  // The possessive of a name. A singular that ends in s takes 's ("Hayes's"); a
  // plural possessive takes only the apostrophe ("the Hayes' house" is the
  // plural-family form he asked for). `mark` is the apostrophe the draft used, so
  // a curly one stays curly.
  function possessiveOf(name, { plural = false, mark = "'" } = {}) {
    const word = String(name);
    if (!word) return word;
    if (plural) return /s$/i.test(word) ? `${word}${mark}` : `${word}${mark}s`;
    return `${word}${mark}s`;
  }

  // The value he typed, trimmed, or null when it is blank. A blank row swaps
  // nothing for that role, never an empty string.
  function cleanValue(raw) {
    const value = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
    return value || null;
  }

  // Whether a typed value may be used at all, and what to tell him when it may be
  // but he should look twice. `ok: false` is a refusal; `warn` is a note.
  function checkValue(raw) {
    const value = cleanValue(raw);
    if (!value) return { ok: true, blank: true, value: null, warn: null };
    if (value.length > MAX_VALUE) return { ok: false, value, warn: `Too long. A name is under ${MAX_VALUE} characters.` };
    if (/[\[\]<>{}\\]/.test(value) || /[\u0000-\u001f]/.test(value)) {
      return { ok: false, value, warn: 'A name has no brackets or control characters in it.' };
    }
    const notes = [];
    const first = value.split(' ')[0];
    if (value.length < 3) notes.push('Short: it will match as a whole word anywhere, including inside other names.');
    if (NAME_IS_A_WORD.has(value.toLowerCase()) || NAME_IS_A_WORD.has(first.toLowerCase())
      || ORDINARY.has(value.toLowerCase())) {
      notes.push(`"${value}" is also an ordinary word. It is masked as typed, capital letter and all, so the sentence "Will you ..." will read as the name.`);
    }
    return { ok: true, blank: false, value, warn: notes.length ? notes.join(' ') : null };
  }

  // Every exact string a typed value should scrub: the whole thing, each word of
  // it (first name, last name), the initials with and without stops, in that order.
  // The possessive needs no entry of its own: the matcher is a whole word match,
  // and an apostrophe ends a word, so "Jaden's" is "Jaden" with 's outside the
  // mask, which is how `sensitive.mjs` already treats "Riverbend's".
  function scrubForms(raw) {
    const value = cleanValue(raw);
    if (!value) return [];
    const words = value.split(' ').filter(Boolean);
    const forms = [value];
    if (words.length > 1) {
      // A title, a particle or a suffix is part of the name but is not a name: "Dr."
      // or "de" on its own would mask every one in the note.
      const named = words.filter((w) => !FILLER.has(w.replace(/\.+$/, '').toLowerCase()));
      for (const w of named) if ((w.match(/\p{L}/gu) || []).length >= 2) forms.push(w);
      const initials = named.map((w) => [...w][0]).filter((c) => /\p{L}/u.test(c));
      if (initials.length > 1) {
        forms.push(initials.join(''), initials.map((c) => `${c}.`).join(''), initials.map((c) => `${c}.`).join(' '));
      }
    }
    // Longest first, like every term list in this app, so "Jaden Parker" is cut
    // before "Jaden" and nothing is stranded beside a token.
    return [...new Set(forms)].sort((a, b) => b.length - a.length);
  }

  // Case-sensitive, whole word matches of each form, longest first, none inside
  // another. The offsets index `text`.
  function findScrubs(text, forms) {
    const body = typeof text === 'string' ? text : '';
    const list = [...new Set((Array.isArray(forms) ? forms : []).filter((f) => typeof f === 'string' && f.trim()))]
      .sort((a, b) => b.length - a.length);
    if (!body || !list.length) return [];
    const found = [];
    for (const form of list) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu');
      for (const m of body.matchAll(re)) {
        const start = m.index;
        const end = start + m[0].length;
        if (found.some((f) => start < f.end && end > f.start)) continue;
        found.push({ start, end, surface: m[0], term: form });
      }
    }
    return found.sort((a, b) => a.start - b.start);
  }

  NS._values = { MAX_VALUE, fnv1a, fraction, possessiveOf, cleanValue, checkValue, scrubForms, findScrubs };
})();
