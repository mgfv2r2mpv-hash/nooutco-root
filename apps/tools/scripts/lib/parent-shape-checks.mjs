/* What a right parent note must show, checked against a draft.
 *
 * Written 2026-10-03 from one production parent note that came out wrong, as
 * step 9 of the plan Kaleb approved. Each check is one of his rulings on that
 * note, so a failure names the ruling it breaks. The cases live in
 * tests/fixtures/parent-note-shape.json; parent-note-shape.spec.js proves
 * these checks catch the failures the real note had, and the same checks can
 * score a live draft (see that spec's header for how).
 *
 * `draft` is the parent tool's normalized output: individualsPresent,
 * supportActivities, caregiverResponse, progressStatus, summary, followup,
 * hints. */

const QUESTION_LINE = /^\s*(clarify|specify|(confirm|verify|determine|check|ask|identify) (whether|if)|find out (whether|if))\b|\?\s*$/i;

const lc = (s) => String(s || '').toLowerCase();
const anyOf = (v) => [].concat(v);

export function checkParentDraft(c, draft) {
  const e = c.expect || {};
  const fails = [];
  const summary = String(draft.summary || '');
  const all = `${summary}\n${draft.followup || ''}`;

  for (const name of e.goalNames || []) {
    if (!lc(summary).includes(lc(name))) fails.push(`goal not named in the summary: "${name}"`);
  }
  for (const claim of e.forbidCountClaims || []) {
    if (lc(summary).includes(lc(claim))) fails.push(`a goal count the list does not support: "${claim}"`);
  }
  for (const p of e.forbidPhrases || []) {
    if (lc(all).includes(lc(p))) fails.push(`a phrase that must not appear: "${p}"`);
  }
  if (e.promptLevelWithCount) {
    // count may list several ways to write the same count ("2 of 3", "2
    // trials"); Kaleb's first live run wrote one the single form missed.
    const { count, level } = e.promptLevelWithCount;
    const forms = anyOf(count);
    const sentences = summary.split(/(?<=[.!?])\s+/);
    const withCount = sentences.filter((s) => forms.some((f) => lc(s).includes(lc(f))));
    if (!withCount.length) fails.push(`the trial count ("${forms.join('" or "')}") is missing`);
    else if (!withCount.some((s) => lc(s).includes(lc(level)))) fails.push(`the trial count is written without the prompt level ("${level}") beside it`);
  }

  const present = draft.individualsPresent || [];
  for (const who of e.individualsInclude || []) if (!present.includes(who)) fails.push(`Individuals Present is missing "${who}"`);
  for (const who of e.individualsExclude || []) if (present.includes(who)) fails.push(`Individuals Present lists "${who}", whom the notes place out of the session`);

  if (e.caregiverResponse && draft.caregiverResponse !== e.caregiverResponse) {
    fails.push(`Caregiver Response picked "${draft.caregiverResponse}", expected "${e.caregiverResponse}"`);
  }
  if (e.progressStatus && draft.progressStatus !== e.progressStatus) {
    fails.push(`Progress Status picked "${draft.progressStatus}", expected "${e.progressStatus}"`);
  }

  const items = String(draft.followup || '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (e.followupItems) {
    const [lo, hi] = e.followupItems;
    if (items.length < lo || items.length > hi) fails.push(`Follow Up has ${items.length} item(s), expected ${lo} to ${hi}`);
  }
  for (const line of items) if (QUESTION_LINE.test(line)) fails.push(`Follow Up holds a question to the author: "${line}"`);
  // An entry may list alternatives: ["BT", "technician"] is met by either.
  for (const entry of e.followupMentions || []) {
    const words = anyOf(entry);
    if (!items.some((l) => words.some((w) => lc(l).includes(lc(w))))) fails.push(`no Follow Up item mentions "${words.join('" or "')}"`);
  }
  return fails;
}
