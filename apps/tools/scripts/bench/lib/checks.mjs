/* THE BENCH'S CHECKS, one set for every tool.
 *
 * Each check is one of Kaleb's rulings or one point of his BT Session Note
 * Resources guide, so a failure names the rule it breaks. A case's `expect`
 * says which apply:
 *
 *   mentions   phrases the note must carry (the intake's facts, as written)
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

const lc = (s) => String(s || '').toLowerCase();
const QUESTION = /^\s*(clarify|specify|(confirm|verify|determine|check|ask|identify) (whether|if)|find out (whether|if))\b|\?\s*$/i;

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
  const all = note.all || narratives;

  for (const m of e.mentions || []) if (!lc(all).includes(lc(m))) fails.push(`missing from the note: "${m}"`);
  for (const f of e.forbid || []) if (lc(all).includes(lc(f))) fails.push(`must not appear: "${f}"`);
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
  if (/\[\[T\d+\]\]/.test(all)) fails.push('an opaque token was left in the note');
  if (/\u2014/.test(narratives)) fails.push('an em dash in a narrative');
  for (const group of e.singlesNeverBlank || []) {
    if (!((note.picks || {})[group] || [])[0]) fails.push(`${group} left blank`);
  }
  if (c.parentExpect) fails.push(...checkParentDraft({ expect: c.parentExpect }, flatDraft(note, ['caregiverResponse', 'progressStatus'])));
  return fails;
}
