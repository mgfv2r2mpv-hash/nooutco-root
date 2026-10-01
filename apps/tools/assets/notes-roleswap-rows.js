/*
 * notes-roleswap-rows.js - The rows above Copy out, as plain data.
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
  const { STANDING_ROLES, CAREGIVER_KIN, ADD_KINDS } = NS._lex;
  const { cleanValue } = NS._values;

  // The rows he fills in above Copy out, as plain data.
  //
  // Four standing rows (client, BT, BCBA, caregiver), a separate BCaBA row that is
  // never mapped to the BCBA row, and the rows he adds from the dropdown. Each row
  // is a value and nothing else: the engine reads them, the pane draws them, and
  // neither one keeps a second copy.
  //
  // Everything here returns a NEW row. A row he is typing into is replaced, never
  // edited in place, so the preview and the field can never disagree about what a
  // row held a moment ago.
  //
  // His rulings, all admin mode only:
  //   "replace-with mirrors looks-for until the user edits it, then stops following."
  //   "A blank row swaps nothing for that role, never an empty string."
  //   "A visible 'Active: name / name / ...' strip sits beside the Copy button."


  // The standing rows, blank. The caregiver row carries the toggle for the kin
  // words (mom, mother, dad, father), off by default.
  function standingRows() {
    return STANDING_ROLES.map((r) => ({
      id: r.id, kind: 'standing', label: r.label, words: [...r.words], value: '',
      ...(r.id === 'caregiver' ? { kinOn: false } : {}),
    }));
  }

  const splitWords = (text) => String(text || '').split(/[,/;]+/).map((w) => w.trim()).filter(Boolean);

  // A row from the "add a row" dropdown. `n` keeps its id unique within the tab.
  function customRow(kindId, n = 1) {
    const kind = ADD_KINDS.find((k) => k.id === kindId) || ADD_KINDS[ADD_KINDS.length - 1];
    return {
      id: `x${n}`, kind: 'custom', label: kind.label, looksFor: kind.looksFor,
      // Mirrors looks-for until he types in it.
      value: kind.looksFor, valueEdited: false,
    };
  }

  // He edits "looks for". The value follows until he has edited the value itself.
  function setLooksFor(row, text) {
    const looksFor = String(text ?? '');
    return { ...row, looksFor, value: row.valueEdited ? row.value : looksFor };
  }

  // He edits "replace with". From this press on it no longer follows.
  function setValue(row, text) {
    return { ...row, value: String(text ?? ''), valueEdited: true };
  }

  function setKin(row, on) {
    return row.id === 'caregiver' ? { ...row, kinOn: Boolean(on) } : row;
  }

  // The words a row looks for.
  function wordsOf(row) {
    const base = row.kind === 'custom' ? splitWords(row.looksFor) : row.words || [];
    const kin = row.id === 'caregiver' && row.kinOn ? CAREGIVER_KIN : [];
    return [...base, ...kin];
  }

  // Whether the row swaps anything. Blank is nothing. A custom row whose value is
  // still its own looks-for is nothing too: replacing "doctor" with "doctor" would
  // only paint the preview green for no change.
  function isActive(row) {
    const value = cleanValue(row.value);
    if (!value) return false;
    if (row.kind === 'custom') {
      const looks = splitWords(row.looksFor);
      if (!looks.length) return false;
      if (looks.length === 1 && looks[0].toLowerCase() === value.toLowerCase()) return false;
    }
    return wordsOf(row).length > 0;
  }

  const activeRows = (rows) => (Array.isArray(rows) ? rows : []).filter(isActive);

  // "Active: Jaden / Ben / Janet", or null when nothing is.
  function activeStrip(rows) {
    const names = activeRows(rows).map((r) => cleanValue(r.value));
    return names.length ? `Active: ${names.join(' / ')}` : null;
  }

  NS._rows = { standingRows, customRow, setLooksFor, setValue, setKin, wordsOf, isActive, activeRows, activeStrip };
})();
