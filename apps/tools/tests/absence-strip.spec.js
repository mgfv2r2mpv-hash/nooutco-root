import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The absence rule is enforced now, not asked for.
 *
 * WHY. "A note records what was done, never what was not done" has been in the
 * prompt since 2026-08-15, in three places at once: NEVER DOCUMENT AN ABSENCE in
 * the shared register rules, the conditional on the rate comparison in bt's
 * narrative guidance, and the flat "never state that the comparison is missing"
 * on the end of it. All three are live on tools.nooutco.me; I pulled the
 * deployed prompt and read them. On 2026-08-18 he reported still getting "no
 * recent session information was provided for comparison".
 *
 * A fourth sentence in the prompt would have been a wish. So no-absence-language
 * .spec.js keeps guarding what the prompt ASKS for, and this guards what the
 * tool GUARANTEES: the model can write the sentence and the technician still
 * never sees it.
 *
 * The two carve-outs below are the whole difficulty, and both come from the
 * prompt's own words. A zero is an observation and it stays. And the tool
 * supplies "No new questions or concerns for the BCBA at this time" itself, so a
 * checker that keyed on a leading "no" would delete the tool's own default.
 */

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}
const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

// A note carrying the sentence he reported, alongside prose that must survive.
const noteWith = (overrides) => ({
  individualsPresent: ['Client'],
  clinicalStatus: ['Presented Calm'],
  clinicalStatusNarrative: 'The client met the technician at the door and settled quickly.',
  purpose: ['Worked on goals as stated in the treatment plan'],
  servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'Eight of ten trials came back correct with a gestural prompt. The prompt was faded by the sixth trial.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'A two minute warning preceded each transition and the client moved without protest.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions and the technician blocked the door and redirected. No recent session information was provided for comparison.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
  ...overrides,
});

async function draft(page, note, { breakAbsence = false } = {}) {
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(note));
  });

  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  if (breakAbsence) {
    // Prove it fails open rather than taking the note down with it.
    await page.addInitScript(() => { window.__killAbsence = true; });
  }
  await page.goto('/notes/bt/');
  if (breakAbsence) await page.evaluate(() => { delete window.NoteAbsence; });

  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, 8 of 10 gestural');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('two minute warning before transitions');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
}

const section = (page, key) => page.locator(`textarea[data-section-id="${key}"]`);

test.describe('the sentence never reaches the technician', () => {
  test('the exact sentence he reported is cut, and the clinical half of the same section stays', async ({ page }) => {
    await draft(page, noteWith({}));
    const behavior = section(page, 'behaviorPlanNarrative');
    await expect(behavior).not.toHaveValue(/no recent session information/i);
    await expect(behavior).not.toHaveValue(/provided for comparison/i);
    // The rest of that section is the record and must be untouched.
    await expect(behavior).toHaveValue(/Elopement occurred on two occasions/);
    await expect(behavior).toHaveValue(/blocked the door and redirected/);
  });

  test('a zero is an observation and it stays', async ({ page }) => {
    // Straight from the prompt: "No instances of aggression occurred" describes
    // the session. A checker that fired on a leading "no" would delete it.
    await draft(page, noteWith({
      behaviorPlanNarrative: 'No instances of aggression occurred during the session. The rate was not reported.',
    }));
    const behavior = section(page, 'behaviorPlanNarrative');
    await expect(behavior).toHaveValue(/No instances of aggression occurred/);
    await expect(behavior).not.toHaveValue(/rate was not reported/i);
  });

  test("the tool's own default follow-up sentence survives", async ({ page }) => {
    // buildUserPrompt supplies this one when the technician writes nothing, so
    // an over-eager checker would delete the tool's own words.
    await draft(page, noteWith({}));
    await expect(section(page, 'followUpNarrative'))
      .toHaveValue(/No new questions or concerns for the BCBA at this time/);
  });

  test('a sentence with a person doing the acting is left alone', async ({ page }) => {
    // "The client was not provided with a break" uses one of the seven banned
    // participles and is a perfectly good clinical sentence. Deleting a clinical
    // fact is a worse outcome than leaving a sentence he has already seen.
    await draft(page, noteWith({
      antecedentNarrative: 'The client was not provided with a break between the third and fourth trials.',
    }));
    await expect(section(page, 'antecedentNarrative'))
      .toHaveValue(/The client was not provided with a break/);
  });

  test('it fails open: no checker means a note without the strip, not no note', async ({ page }) => {
    await draft(page, noteWith({}), { breakAbsence: true });
    // The note still drafts. The sentence survives, which is the correct
    // trade: a missing checker must not cost somebody their note.
    await expect(section(page, 'lessonProgressNarrative')).toHaveValue(/Eight of ten trials/);
  });
});

test.describe('the checker itself', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/notes/bt/');
    await page.waitForFunction(() => !!window.NoteAbsence);
  });

  test('classifies the cases that decided its shape', async ({ page }) => {
    const got = await page.evaluate(() => [
      'No recent session information was provided for comparison.',
      'Behavior rates relative to recent sessions were not reported in the session documentation.',
      'Prompt level was not documented.',
      'Baseline data for this program is not available.',
      'The frequency of elopement remains unclear.',
      'No instances of aggression occurred.',
      'No new questions or concerns for the BCBA at this time.',
      'The client was not provided with a break between trials.',
      'Reinforcement was not delivered contingent on the behavior.',
      'The behavior technician did not report a rate for comparison.',
    ].map((s) => window.NoteAbsence.classify(s)));

    expect(got).toEqual([
      'cut', 'cut', 'cut', 'cut', 'cut',
      null, null, null, null,
      'flag',
    ]);
  });

  test('rebuilds the narrative rather than reflowing it', async ({ page }) => {
    // Whatever survives must read exactly as the model wrote it. A checker that
    // re-joined on a single space would quietly restyle every note it touched.
    const out = await page.evaluate(() =>
      window.NoteAbsence.scrub('One. The rate was not reported. Three.'));
    expect(out.text).toBe('One. Three.');
    expect(out.cut).toBe(1);
    expect(out.flagged).toBe(0);
  });

  test('leaves a checkbox array alone', async ({ page }) => {
    // An option label is not prose, and cutting one would change what the
    // technician is asked to verify on their own form.
    const out = await page.evaluate(() =>
      window.NoteAbsence.scrubNote({ actionItems: ['None'], behaviorPlanNarrative: 'The rate was not reported.' }));
    expect(out.output.actionItems).toEqual(['None']);
    expect(out.output.behaviorPlanNarrative).toBe('');
    expect(out.cut).toBe(1);
  });

  test('does not split on the abbreviations a real note uses', async ({ page }) => {
    // A mis-split is not cosmetic. "The rate was not reported approx. 3 times"
    // split at the abbreviation would cut the first half and leave "3 times"
    // standing on its own, which is worse than either outcome on purpose.
    const n = await page.evaluate(() =>
      window.NoteAbsence.sentences('Ran DTT approx. 20 trials w/ gest. prompt fading. Client left settled.').length);
    expect(n).toBe(2);
  });

  test('never changes a single byte of what it keeps', async ({ page }) => {
    // The property everything else rests on. Whatever survives must read exactly
    // as the model wrote it, spacing and all, however the splitter behaved.
    const same = await page.evaluate(() => {
      const texts = [
        'Ran DTT approx. 20 trials w/ gest. prompt fading. Client left settled.',
        'The client engaged in aggression on two occasions.  Two spaces, and a trailing line.\nSecond line.',
        'One sentence with no terminator',
        '',
      ];
      return texts.map((t) => window.NoteAbsence.scrub(t).text === t.replace(/\s+$/, ''));
    });
    expect(same).toEqual([true, true, true, true]);
  });
});
