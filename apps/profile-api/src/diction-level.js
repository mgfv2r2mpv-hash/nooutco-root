/* THE STORE SIDE OF DICTION, AND IT DOES NOT KNOW A SINGLE WORD.
 *
 * The dictionary lives in the browser, at apps/tools/notes/bcba/diction.js,
 * because that is where a note is and a note never leaves the device. What
 * arrives here is {family_id, variant_index, count}: a meaning, which synonym
 * inside it, and how often.
 *
 * SO THIS FILE HOLDS IDS AND COUNTS AND NO SURFACE FORMS. Not because a synonym
 * list is secret, but because a store that cannot name a word cannot leak one,
 * and because the thing a reviewer has to check here is one sentence long: is
 * every value in this table a slug from a closed list or an integer. Reading
 * `prompting: 6` answers that. Reading six synonyms under it invites the next
 * person to add a seventh here, where the browser would never see it.
 *
 * WHY THE SAME CHECK TWICE. The browser already refuses a family it does not
 * hold, and the browser is the side an attacker controls. A gate that runs
 * before the untrusted hop is not a gate. accept() is the one that decides what
 * gets written.
 *
 * DRIFT IS THE REAL HAZARD AND A TEST OWNS IT. variant_index is a POSITION, so
 * a variant inserted in the middle of a family in the browser rewrites the
 * meaning of every row already stored, and a family renamed there makes every
 * row here unreadable without either side erroring. test/diction-level.test.js
 * loads the browser dictionary and pins this map against it.
 */

/** family id -> how many variants it holds. Mirrored from FAMILIES in
 *  apps/tools/notes/bcba/diction.js, pinned by test/diction-level.test.js. */
export const FAMILY_VARIANTS = Object.freeze({
  prompting: 6,
  mand: 4,
  elopement: 5,
  dysregulation: 5,
  aggression: 5,
  self_injury: 4,
  reinforcement: 4,
  compliance: 3,
  refusal: 5,
  engagement: 4,
  redirection: 4,
  independence: 4,
  escalation: 4,
  calming: 4,
  transition: 4,
  vocalization: 4,
  display: 4,
  frequency: 4,
  acquisition: 4,
  caregiver_training: 4,
});

export const FAMILY_IDS = Object.freeze(Object.keys(FAMILY_VARIANTS));

/* A note that mentions one family two hundred times is a note with a stuck key
   in it, not an author with a preference. The cap bounds one note's vote so a
   single note cannot outweigh a year of them.

   Kaleb ruled this from 50 to 10 on 21 September. The old number was written as
   "50 is a guess" and it was guessed too high to do its own job: a BT session
   note runs a few hundred words, so one family reaching fifty inside it is the
   stuck key rather than the preference, and a cap that only fires on the stuck
   key is not bounding a vote at all. Ten sits well above anything a real note
   produces and well below anything a jam produces, which is where a bound
   belongs. */
export const MAX_COUNT_PER_NOTE = 10;

const isWhole = (v) => typeof v === "number" && Number.isFinite(v) && Math.floor(v) === v;

/**
 * What may be written, and why everything else was not.
 *
 * @param {Array<{family_id: string, variant_index: number, count: number}>} rows
 * @returns {{counts: Array, refused: Array<{at: number, reason: string}>}}
 */
export function accept(rows) {
  const counts = [];
  const refused = [];
  const at = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row, i) => {
    const entry = row || {};
    const variants = Object.prototype.hasOwnProperty.call(FAMILY_VARIANTS, entry.family_id)
      ? FAMILY_VARIANTS[entry.family_id]
      : undefined;
    if (variants === undefined) {
      // The reason never quotes what arrived. A refused family id is a string
      // somebody on the other side of the hop chose, so writing it into a log
      // is the same mistake in a different file.
      refused.push({ at: i, reason: "family not in the house dictionary" });
      return;
    }
    if (!isWhole(entry.variant_index) || entry.variant_index < 0 || entry.variant_index >= variants) {
      refused.push({ at: i, family_id: entry.family_id, reason: "variant index outside the family" });
      return;
    }
    if (!isWhole(entry.count) || entry.count <= 0) {
      refused.push({ at: i, family_id: entry.family_id, reason: "count is not a positive whole number" });
      return;
    }
    const key = entry.family_id + ":" + entry.variant_index;
    if (at.has(key)) {
      // Two rows for one variant is the caller's bug, not evidence. Fold it
      // rather than writing one and losing the other.
      const seen = counts[at.get(key)];
      counts[at.get(key)] = { ...seen, count: Math.min(MAX_COUNT_PER_NOTE, seen.count + entry.count) };
      return;
    }
    at.set(key, counts.length);
    counts.push({
      family_id: entry.family_id,
      variant_index: entry.variant_index,
      count: Math.min(MAX_COUNT_PER_NOTE, entry.count),
    });
  });

  counts.sort((a, b) =>
    a.family_id === b.family_id
      ? a.variant_index - b.variant_index
      : a.family_id < b.family_id ? -1 : 1);

  return { counts, refused };
}

/**
 * The rows to write for one note, as running totals. Same shape as voice_level:
 * a total and a note count per key, no per note history, nothing to prune.
 *
 * @param {Array<{family_id, variant_index, count, notes}>} stored  what the table holds
 * @param {Array<{family_id, variant_index, count}>} accepted  this note, through accept()
 * @returns {Array} a new array. `stored` is not touched.
 */
export function applyNote(stored, accepted) {
  const out = [];
  const at = new Map();
  const put = (row, isNew) => {
    const key = row.family_id + ":" + row.variant_index;
    if (!at.has(key)) {
      at.set(key, out.length);
      out.push({
        family_id: row.family_id,
        variant_index: row.variant_index,
        count: row.count,
        notes: isNew ? 1 : (isWhole(row.notes) && row.notes > 0 ? row.notes : 1),
      });
      return;
    }
    /* Added in place, and safe because every row reaching here was rebuilt by
       accept() or by the push above. Neither argument holds a reference to it,
       which the revert proof says plainly: rewriting this as a fresh object
       broke no test, so the copy that matters is the one accept() makes. */
    const seen = out[at.get(key)];
    seen.count += row.count;
    seen.notes += isNew ? 1 : 0;
  };

  (Array.isArray(stored) ? stored : []).forEach((row) => {
    const { counts } = accept([row]);
    /* The stored count, not the one accept() hands back. accept() caps ONE
       NOTE's vote at MAX_COUNT_PER_NOTE, and a stored row is a running total
       over many notes: read back through the cap, a total of 120 came out at
       50 and the author's history was cut down on every write. The gate still
       decides whether the row is readable at all. */
    if (counts.length) put({ ...counts[0], count: row.count, notes: row.notes }, false);
  });
  (Array.isArray(accepted) ? accepted : []).forEach((row) => {
    const { counts } = accept([row]);
    if (counts.length) put(counts[0], true);
  });

  out.sort((a, b) =>
    a.family_id === b.family_id
      ? a.variant_index - b.variant_index
      : a.family_id < b.family_id ? -1 : 1);
  return out;
}

/**
 * Which synonym this author reaches for inside one family, as a share.
 *
 * The reading a style move is made from: not "they say prompted" but "prompted
 * is 70 percent of how they name that meaning, over 40 notes". A share on two
 * notes is noise, so `notes` rides along and the caller decides what is enough.
 * No threshold is picked here, because the bar is the maintainer's.
 *
 * @returns {{family_id, notes, total, shares: Array<{variant_index, share, count}>}|null}
 */
export function familyShares(stored, familyId) {
  if (!Object.prototype.hasOwnProperty.call(FAMILY_VARIANTS, familyId)) return null;
  const rows = (Array.isArray(stored) ? stored : []).filter(
    (r) => r && r.family_id === familyId && isWhole(r.count) && r.count > 0,
  );
  if (!rows.length) return null;
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  const notes = rows.reduce((most, r) => Math.max(most, isWhole(r.notes) ? r.notes : 0), 0);
  return {
    family_id: familyId,
    notes,
    total,
    shares: rows
      .map((r) => ({ variant_index: r.variant_index, count: r.count, share: r.count / total }))
      .sort((a, b) => b.share - a.share || a.variant_index - b.variant_index),
  };
}
