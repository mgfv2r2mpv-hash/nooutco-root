/*
 * notes-roleswap.js - the copy-out role swap: "the client" becomes the name the
 * clinician typed, at copy-out and nowhere else. Browser global, window.NotesRoleswap.
 *
 * LOAD ORDER (this file last; each earlier file is a part and throws nothing alone):
 *   notes-roleswap-lex.js, notes-roleswap-values.js, notes-roleswap-rows.js,
 *   notes-roleswap-ctx.js, notes-roleswap-engine.js, notes-roleswap.js
 *
 * Pure and portable: no DOM, no storage, no network, no import. Ported from the
 * sass-assistant engine (src/roleswap/index.mjs), same API, same output byte for byte:
 *
 *   swap({ text, config })          -> { text, spans, counts }
 *   swapRoles(text, config)         the same, positional
 *   applySpans(text, spans, flips)  text with `flips` (span ids) turned the other way
 *   checkBeforeCopy(text, result, rows, { flips, seed, rates })
 *                                   -> { ok, block: [...], warn: [...] }
 *
 *   config = { rows, seed = 1, everything = false, rates = { [roleId]: { leave, bare, modified } } }
 *   span   = { id, start, end, role, original, replacement, swapped, reason, risky, paragraph, sentence }
 *   reason = swapped | plural | indefinite | other-person | label | hyphen | quote
 *            | title | already-named | modifier | density | unsure
 *
 *   rows helpers:  standingRows, customRow, setLooksFor, setValue, setKin, wordsOf,
 *                  isActive, activeRows, activeStrip
 *   value helpers: cleanValue, checkValue, scrubForms, findScrubs, possessiveOf, fnv1a
 *   constants:     REASON_TEXT, SWAPPED, DEFAULT_RATES, MIN_ELIGIBLE_FOR_LEAVES,
 *                  EVENT_NOUNS_USE_NORMAL_RATE, ADD_KINDS, STANDING_ROLES, CAREGIVER_KIN
 *
 * The parts hand their pieces over on NotesRoleswap._<part>; this file reads them
 * into closures and deletes those handles, so the finished namespace is the API
 * above and nothing else.
 */
(function () {
  'use strict';
  var root = typeof window !== 'undefined' ? window : globalThis;
  var NS = root.NotesRoleswap = root.NotesRoleswap || {};
  var parts = ['_lex', '_values', '_rows', '_ctx', '_engine'];
  parts.forEach(function (p) {
    if (!NS[p]) throw new Error('notes-roleswap.js: load notes-roleswap' + p.replace('_', '-') + '.js first');
  });
  const { swapRoles, applySpans, REASON_TEXT, SWAPPED, DEFAULT_RATES, MIN_ELIGIBLE_FOR_LEAVES, EVENT_NOUNS_USE_NORMAL_RATE } = NS._engine;
  const { ADD_KINDS, STANDING_ROLES, CAREGIVER_KIN } = NS._lex;
  const { standingRows, customRow, setLooksFor, setValue, setKin, wordsOf, isActive, activeRows, activeStrip } = NS._rows;
  const { cleanValue, checkValue, scrubForms, findScrubs, possessiveOf, fnv1a } = NS._values;
  parts.forEach(function (p) { delete NS[p]; });

  // What is checked before a swapped copy leaves, from his rulings:
  //
  //   "block if any typed name appears twice in one sentence; warn if a typed value
  //   is empty but its role word appears."
  //
  // The block reads the text AS IT WOULD BE COPIED (spans applied, flips from the
  // preview included), because a name twice in a sentence is a defect in what
  // leaves and not in what he wrote. It is the check that catches "Janet/Janet" if
  // the collapse ever missed one, and "Jaden told Jaden's mother", which reads as a
  // slip even when it is accurate. A click on a span in the preview is how he
  // resolves it.
  //
  // The warning is the other way round: a role with no value typed swaps nothing,
  // so its role word goes out generic. That may be exactly what he wants, so it is
  // a note and not a stop.
  //
  // PORTABLE. Imports only its neighbours.


  const PROBE = 'Probe Name';
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function sentencesOf(text) {
    return String(text).split(/(?<=[.!?]["”')\]]*)\s+|\n+/u).filter(Boolean);
  }

  // Every typed name that appears twice or more in one sentence of the copied text.
  function namesTwice(copied, rows) {
    const names = [...new Set((Array.isArray(rows) ? rows : []).map((r) => cleanValue(r.value)).filter(Boolean))];
    const found = [];
    for (const name of names) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(name)}(?![\\p{L}\\p{N}])`, 'gu');
      sentencesOf(copied).forEach((sentence, index) => {
        const count = [...sentence.matchAll(re)].length;
        if (count >= 2) found.push({ kind: 'twice', name, count, sentence: index });
      });
    }
    return found;
  }

  // Roles with no value whose role word the note uses, counted as mentions that
  // WOULD have swapped.
  function emptyButUsed(text, rows, options = {}) {
    const list = Array.isArray(rows) ? rows : [];
    const blank = list.filter((r) => !cleanValue(r.value));
    if (!blank.length) return [];
    const probe = blank.map((r) => ({ ...r, value: PROBE }));
    const out = swapRoles(text, { ...options, rows: probe, everything: true });
    return blank
      .map((r) => ({ kind: 'empty-role', role: r.id, label: r.label, count: out.spans.filter((s) => s.role === r.id && s.swapped).length }))
      .filter((w) => w.count > 0);
  }

  // Both checks, in one answer. `ok` is false only when something blocks.
  function checkBeforeCopy(text, result, rows, options = {}) {
    const copied = applySpans(text, result.spans, options.flips || new Set());
    const block = namesTwice(copied, rows);
    const warn = emptyButUsed(text, rows, options);
    return { ok: block.length === 0, block, warn };
  }

  // Input as one object, the shape a wrapper for another tool wants.
  function swap({ text, config } = {}) {
    return swapRoles(text, config || {});
  }

  Object.assign(NS, {
    swap, swapRoles, applySpans, checkBeforeCopy, namesTwice, emptyButUsed,
    standingRows, customRow, setLooksFor, setValue, setKin, wordsOf, isActive, activeRows, activeStrip,
    cleanValue, checkValue, scrubForms, findScrubs, possessiveOf, fnv1a,
    REASON_TEXT, SWAPPED, DEFAULT_RATES, MIN_ELIGIBLE_FOR_LEAVES, EVENT_NOUNS_USE_NORMAL_RATE,
    ADD_KINDS, STANDING_ROLES, CAREGIVER_KIN,
  });
})();
