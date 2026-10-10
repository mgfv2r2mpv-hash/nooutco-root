/* THE BENCH'S CHECKS, one set for every tool.
 *
 * Each check is one of Kaleb's rulings or one point of his BT Session Note
 * Resources guide, so a failure names the rule it breaks. A case's `expect`
 * says which apply:
 *
 *   mentions   facts the note must carry. Each is a phrase, or a list of the
 *              plain forms that say the same fact (["dad", "father", "parent",
 *              "caregiver"]); any one form passes. A form counts at the start
 *              of a word, so "gesture" passes "gestures" and "turn" does not
 *              pass "return". A ruling stays one exact phrase ("full
 *              physical", "mastery criteria"). Kaleb's BT runs of 9 Oct 2026
 *              failed notes that said "new action sequences", the intake's own
 *              "new ones", where the case wanted "novel", and "His father"
 *              where it wanted "dad".
 *   forbid     phrases it must not (an invented fact, a hollow line, "was
 *              reinforced", "responded well")
 *   picks      { group: [labels that must be ticked] }
 *   notPicks   { group: [labels that must not be] }
 *   single     { group: label } for a single-select
 *   noData     true for BT: no percentage or a/b count in a narrative, because
 *              ReThink already pulls the data in (his guide)
 *   tasksOnly  narrative keys that hold tasks, never a question to the author
 *
 * And on every note: no opaque token left, no em dash, no blank single-select.
 * The parent tool's own checks (scripts/lib/parent-shape-checks.mjs) run too
 * when the case carries `parentExpect`. */
import { checkParentDraft } from '../../lib/parent-shape-checks.mjs';
import { saysAtWordStart } from './page-bench.mjs';

const lc = (s) => String(s || '').toLowerCase();
const forms = (m) => (Array.isArray(m) ? m : [m]);
const QUESTION = /^\s*(clarify|specify|(confirm|verify|determine|check|ask|identify) (whether|if)|find out (whether|if))\b|\?\s*$/i;

/* What the note says: its narratives, its picks and its goals table rows.
   Never the page around it. Kaleb's Assessment run on 9 Oct 2026 passed
   "neuropsych" only because the expert review panel showed "neuropsych - not
   recognized"; the note itself said "assessment report from May". So mentions
   and forbids read this, and the card's `all` text is left for the report. */
export function noteWords(note) {
  const picks = Object.values(note.picks || {}).flat();
  const rows = Object.values(note.tables || {}).flat();
  return [...Object.values(note.text || {}), ...picks, ...rows].join('\n');
}

/* The note as the parent checker reads it: narratives by key, picks by group,
   a single-select as its one label. */
export function flatDraft(note, singles = []) {
  const out = { ...note.text };
  for (const [group, on] of Object.entries(note.picks || {})) {
    out[group] = singles.includes(group) ? (on[0] || '') : on;
  }
  return out;
}

export function checkNote(c, note) {
  const e = c.expect || {};
  const fails = [];
  const narratives = Object.values(note.text || {}).join('\n');
  const said = noteWords(note);

  for (const m of e.mentions || []) {
    if (!forms(m).some((f) => saysAtWordStart(said, f))) fails.push(`missing from the note: ${forms(m).map((f) => `"${f}"`).join(' or ')}`);
  }
  for (const f of e.forbid || []) if (lc(said).includes(lc(f))) fails.push(`must not appear: "${f}"`);
  for (const [group, labels] of Object.entries(e.picks || {})) {
    const on = (note.picks || {})[group] || [];
    for (const l of labels) if (!on.includes(l)) fails.push(`${group} is missing "${l}"`);
  }
  for (const [group, labels] of Object.entries(e.notPicks || {})) {
    const on = (note.picks || {})[group] || [];
    for (const l of labels) if (on.includes(l)) fails.push(`${group} wrongly has "${l}"`);
  }
  for (const [group, label] of Object.entries(e.single || {})) {
    const on = (note.picks || {})[group] || [];
    if (on[0] !== label) fails.push(`${group} picked "${on[0] || '(blank)'}", expected "${label}"`);
  }
  if (e.noData) {
    const hit = narratives.match(/\b\d+\s*\/\s*\d+\b|\b\d+(?:\.\d+)?\s*%|\b\d+ (?:of|out of) \d+\b/);
    if (hit) fails.push(`repeats data ReThink already pulls in: "${hit[0]}"`);
  }
  for (const key of e.tasksOnly || []) {
    for (const line of String((note.text || {})[key] || '').split('\n')) {
      if (line.trim() && QUESTION.test(line)) fails.push(`${key} holds a question to the author: "${line.trim()}"`);
    }
  }
  if (/\[\[T\d+\]\]/.test(said)) fails.push('an opaque token was left in the note');
  if (/\u2014/.test(narratives)) fails.push('an em dash in a narrative');
  for (const group of e.singlesNeverBlank || []) {
    if (!((note.picks || {})[group] || [])[0]) fails.push(`${group} left blank`);
  }
  if (c.parentExpect) fails.push(...checkParentDraft({ expect: c.parentExpect }, flatDraft(note, ['caregiverResponse', 'progressStatus'])));
  return fails;
}
