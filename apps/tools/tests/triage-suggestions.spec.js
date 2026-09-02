import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';
import { refusedKeywords } from './helpers/schema.js';

/* Candidate answers under a gap question.
 *
 * His ruling on the third of the three supervision checks: "If they don't
 * report anything, the tool should look at areas of struggle and suggest a
 * couple of default-included suggestions (similar edit options as previously
 * discussed with ghost check -> pencil/undo -> save/cancel)."
 *
 * A question costs a technician a sentence. A suggestion costs a glance, and
 * these run at the one moment the session is still in their head. So the whole
 * value of this is in the default: doing nothing keeps them.
 *
 * Which is only safe because of the traceability rule in the prompt. A
 * suggestion rephrases what the technician already wrote and never supplies a
 * fact they did not report, so leaving one alone re-surfaces their observation
 * rather than the model's guess. Two tests below hold that rule in the prompt
 * text, because nothing downstream can tell an invented sentence from a
 * rephrased one.
 */

function tokenFor(tools = ['bt']) {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const note = () => ({
  individualsPresent: ['Client'], clinicalStatus: ['Presented Tired'],
  clinicalStatusNarrative: 'The client presented as tired on arrival today.',
  purpose: ['Worked on goals as stated in the treatment plan'], servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'Choices were offered before each demand presented.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions during the session.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
});

/* Drive bt to the gap questions, with `triage` as the reply and the first note
   call's user turn captured. That user turn is the whole point: it is the
   intake the draft is written from, so a suggestion that reaches it reaches the
   note and one that does not, does not. */
async function ask(page, triage) {
  const seen = { noteAsk: null, triageSchema: null };
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const last = (b.messages && b.messages.length) ? String(b.messages[b.messages.length - 1].content || '') : '';
    if (/look at your own draft again/i.test(last)) return route.fulfill(reply(note()));
    if (isTriageCall(b)) {
      seen.triageSchema = b.output_config && b.output_config.format && b.output_config.format.schema;
      // A second round would re-ask; one round then draft is what these test.
      if (/ALREADY ANSWERED/.test(last)) return route.fulfill(reply({ sufficient: true, readiness: 90, questions: [] }));
      return route.fulfill(reply(triage));
    }
    seen.noteAsk = b.messages[0].content;
    return route.fulfill(reply(note()));
  });

  await page.goto('/notes/bt/');
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto('/notes/bt/');
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, needed full physical most of it');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board, also moved to the floor and he settled');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  return seen;
}

const TWO = {
  sufficient: false,
  readiness: 70,
  questions: [{
    field: 'fAntecedent',
    question: 'You wrote that you moved to the floor. Was that in the plan?',
    suggestions: [
      'Moving to the floor settled him faster than the break did.',
      'The first-then board worked better once we were down there.',
    ],
  }],
};

/* ── The prompt, which is the only place the safety rule can live ────────── */

test.describe('the prompt that produces them', () => {
  test('every triage prompt carries the suggestion contract, whichever tool runs it', async ({ page }) => {
    await page.goto('/notes/bt/');
    const t = await page.evaluate(() => window.NoteTriagePrompt);
    expect(t.suggestions, 'triage-prompt.js no longer exports the suggestions block').toBeTruthy();
    // Composed into the shared prompt the store publishes, not merely defined.
    expect(t.full).toContain(t.suggestions);
    // And named in the closing shape line, so the prompt and the schema agree
    // about the object being asked for.
    expect(t.readiness).toContain('"suggestions"');
  });

  test('a suggestion may only rephrase what the clinician already wrote', async ({ page }) => {
    await page.goto('/notes/bt/');
    const block = await page.evaluate(() => window.NoteTriagePrompt.suggestions);
    // This is the rule that makes accept-by-default safe, and it is enforceable
    // nowhere else. If it leaves the prompt, a technician who reads nothing
    // ships a sentence about a session that did not happen.
    expect(block).toMatch(/traceable to something the clinician already wrote/i);
    expect(block).toMatch(/NEVER supply a fact they did not report/i);
    expect(block, 'the cap has to be stated as well as enforced').toMatch(/at most two/i);
  });

  test('bt asks about the three gaps a supervisor reads for, and not about the counts', async ({ page }) => {
    await page.goto('/notes/bt/');
    const bt = await page.evaluate(() => (window.NOTE_TOOLS.find((t) => t.id === 'bt') || {}).triageSystem);
    expect(bt, 'bt.js no longer registers a triage prompt of its own').toBeTruthy();
    // The gap that made this tool's own generator argue with the handout: the
    // EHR collects the numbers, so asking for them again spends the one moment
    // the session is still in the technician's head on data they did not have
    // to supply.
    expect(bt).toMatch(/Never ask for a number the data collection already holds/i);
    expect(bt).toMatch(/A PROGRAM WITH NO ACCOUNT OF HOW IT WENT/);
    expect(bt).toMatch(/A BEHAVIOR WITH NO COMPARISON, OR A COMPARISON WITH NO RESPONSE/);
    expect(bt).toMatch(/SOMETHING THAT HELPED AND IS NOT IN THE PROTOCOL/);
    // The half he added on top of the round-6 proposal: a comparison on its own
    // is not the answer. "They should ideally say what they did in response to
    // the change from last week."
    expect(bt).toMatch(/ask what they did about it/i);
  });
});

/* ── The schema, which is what the model is actually held to ─────────────── */

test.describe('the posted schema', () => {
  test('every question is required to carry a suggestions array', async ({ page }) => {
    const seen = await ask(page, { sufficient: true, readiness: 95, questions: [] });
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
    const q = seen.triageSchema.properties.questions.items;
    expect(q.required, 'a key the model may omit is a key half the tools will omit').toContain('suggestions');
    expect(q.properties.suggestions.type).toBe('array');
  });

  test('it carries no keyword the API refuses', async ({ page }) => {
    const seen = await ask(page, { sufficient: true, readiness: 95, questions: [] });
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
    // The whole call is refused over one of these, and the engine's catch
    // swallows a failed triage, so this is the guard that keeps five tools from
    // losing their gap questions again without anything looking broken.
    expect(refusedKeywords(seen.triageSchema, 'triage schema')).toEqual([]);
  });

  test('a model that offers five is cut to two, and blanks never reach the screen', async ({ page }) => {
    await ask(page, {
      sufficient: false,
      readiness: 60,
      questions: [{
        field: 'fAntecedent',
        question: 'Was moving to the floor in the plan?',
        suggestions: ['   ', 'One.', 'Two.', 'Three.', 'Four.'],
      }],
    });
    await expect(page.getByText(/Was moving to the floor/i)).toBeVisible({ timeout: 20000 });
    // Two is his number. A question wearing five pre-accepted answers is a
    // paragraph the tool wrote and dared the technician to read.
    await expect(page.locator('[data-suggestion]')).toHaveCount(2);
    await expect(page.locator('[data-suggestion="0:0"]')).toHaveText('One.');
    await expect(page.locator('[data-suggestion="0:1"]')).toHaveText('Two.');
  });
});

/* ── The surface, and what reaches the note ──────────────────────────────── */

test.describe('what the technician does with them', () => {
  test('they arrive accepted, and generating keeps them', async ({ page }) => {
    const seen = await ask(page, TWO);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-suggestion-accepted="1"]')).toHaveCount(2);
    // Ghost, not solid: accepted is the resting state, and a column of bright
    // ticks is a column nobody reads.
    await expect(page.locator('[data-suggestion-tick="0:0"]')).toHaveClass(/is-ghost/);

    // The skip button is the accept path, because sending needs typed text and
    // agreeing with a suggestion needs none.
    const skip = page.locator('.revision-skip');
    await expect(skip).toHaveText(/Use these and generate/);
    await expect(skip).toBeEnabled({ timeout: 40000 });
    await skip.click();

    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
    expect(seen.noteAsk).toContain('Moving to the floor settled him faster than the break did.');
    expect(seen.noteAsk).toContain('The first-then board worked better once we were down there.');
  });

  test('dropping one keeps it out of the note, and the other still goes', async ({ page }) => {
    const seen = await ask(page, TWO);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });

    await page.locator('[data-suggestion-tick="0:1"]').click();
    await page.locator('[data-suggestion-toggle="0:1"]').click();
    await expect(page.locator('[data-suggestion-accepted="0:1"]')).toHaveCount(0);
    await expect(page.locator('[data-suggestion="0:1"]')).toHaveAttribute('data-suggestion-accepted', '0');

    const skip = page.locator('.revision-skip');
    await expect(skip).toBeEnabled({ timeout: 40000 });
    await skip.click();
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    expect(seen.noteAsk).toContain('Moving to the floor settled him faster than the break did.');
    expect(seen.noteAsk, 'a dropped suggestion reached the note anyway')
      .not.toContain('The first-then board worked better once we were down there.');
  });

  test('dropping every one puts the button back to nothing to add', async ({ page }) => {
    await ask(page, TWO);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });
    for (const id of ['0:0', '0:1']) {
      await page.locator(`[data-suggestion-tick="${id}"]`).click();
      await page.locator(`[data-suggestion-toggle="${id}"]`).click();
    }
    // The label describes what the button carries. With nothing left to carry
    // it is a plain skip again.
    await expect(page.locator('.revision-skip')).toHaveText(/Nothing to add/);
  });

  test('rewording one sends the reworded sentence, not the one it was offered as', async ({ page }) => {
    const seen = await ask(page, TWO);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });

    await page.locator('[data-suggestion-tick="0:0"]').click();
    await page.locator('[data-suggestion-pencil="0:0"]').click();
    await page.locator('[data-suggestion-edit="0:0"]').fill('Floor seating settled him within a minute.');
    await page.locator('[data-suggestion-save="0:0"]').click();
    await expect(page.locator('[data-suggestion="0:0"]')).toHaveText('Floor seating settled him within a minute.');

    const skip = page.locator('.revision-skip');
    await expect(skip).toBeEnabled({ timeout: 40000 });
    await skip.click();
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    expect(seen.noteAsk).toContain('Floor seating settled him within a minute.');
    expect(seen.noteAsk, 'the wording it was offered as followed the edit into the note')
      .not.toContain('Moving to the floor settled him faster than the break did.');
  });

  test('a typed answer and the suggestions left standing arrive together', async ({ page }) => {
    const seen = await ask(page, TWO);
    await expect(page.getByText(/Was that in the plan/i)).toBeVisible({ timeout: 20000 });

    await page.locator('.revision-input').fill('No, floor seating is not in the plan.');
    await page.locator('.revision-send').click();
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    expect(seen.noteAsk).toContain('No, floor seating is not in the plan.');
    expect(seen.noteAsk).toContain('Moving to the floor settled him faster than the break did.');
  });
});
