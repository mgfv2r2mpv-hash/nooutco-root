import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* A function claim is answered where it sits.
 *
 * The expert flags "he wanted attention" as a claim about a mind rather than a
 * report of a room, and until now the only way to act on that was to open the
 * panel and retype the sentence. His idea on 2026-09-02 was to ask the question
 * the tool already knows the answer shape of: did attention come after the
 * behavior, was it missing before it, both, or something else.
 *
 * WHAT THESE PIN, and each one is a way the feature could ship looking fine and
 * be worthless:
 *
 *   THE CONTROL IS SELECTIVE. A control on every finding is a control on none,
 *   so a finding with no mentalistic frame in it must render exactly as it did
 *   before. That assertion is what stops the detector being widened later into
 *   "show it always".
 *
 *   THE ANSWER ROUTES. "After" and "before" are not two wordings of one
 *   instruction. They name different sections, and naming the wrong one puts a
 *   consequence in the antecedent narrative, which is the exact fault the
 *   membership check exists to catch downstream.
 *
 *   THE INSTRUCTION FORBIDS THE FUNCTION. The whole point is to replace an
 *   inference with an observation. An instruction that carried "he wanted
 *   attention" forward as a fact would launder the claim into the note.
 *
 *   THE QUOTE IS NEVER RETYPED AND NEVER RESCRUBBED. It rides in the prompt as
 *   a pointer. A revision built from a click must still send no name.
 */

const PAGE = '/notes/bt/';

function tokenFor(role, tools) {
  const p = { role, kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const NOTE = {
  individualsPresent: ['Client'],
  clinicalStatus: ['Presented Calm'],
  clinicalStatusNarrative: 'The client met the technician at the door and settled quickly.',
  purpose: ['Worked on goals as stated in the treatment plan'],
  servicePaused: 'No',
  abaTechniques: ['Discrete Trial Training'],
  lessonProgressNarrative: 'Eight of ten trials came back correct with a gestural prompt.',
  antecedentStrategies: ['Offered choices'],
  antecedentNarrative: 'A two minute warning preceded each transition.',
  consequenceStrategies: ['Redirection'],
  consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
  behaviorPlanNarrative: 'Elopement occurred on two occasions and the technician blocked the door.',
  clientProgress: 'Steady progress towards goals and behaviors',
  actionItems: ['None'],
  followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
  hints: [],
};

// The claim, and beside it a finding with no mentalistic frame in it at all.
// Both come back from one reading, so "the control is selective" is a check on
// this page rather than a claim about the regular expression.
const CLAIM = { quote: 'he wanted attention', action: 'reframe', why: 'A function claim, not an observation.', move: 'Say what happened and who responded.' };
const PLAIN = { quote: 'Client eloped twice', action: 'ask', why: 'How long did each one last?', move: 'Add the duration.' };

const EXPERT = {
  terms: [],
  register: [CLAIM, PLAIN],
  hints: [],
  hintsDropped: 0,
  usage: { input_tokens: 20, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  model: 'claude-haiku-4-5-20251001',
};

/* Draft one note, then open the register stack. `revised` is what the model
   returns on the SECOND drafting call, which is the revision. */
async function draft(page, { expert = EXPERT, revised = null } = {}) {
  const llm = [];
  let drafts = 0;

  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    llm.push(b);
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    drafts += 1;
    if (drafts > 1 && revised) return route.fulfill(reply(revised));
    return route.fulfill(reply(NOTE));
  });

  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(expert) }));

  await page.addInitScript(([k, t]) => localStorage.setItem(k, t), ['notes_auth_token', tokenFor('admin', ['bt'])]);
  await page.goto(PAGE);

  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, 8 of 10 gestural');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('two minute warning before transitions');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i })
    .fill('elopement x2 with client Jacob, blocked and redirected, he wanted attention');
  await page.getByRole('button', { name: 'Generate Note' }).click();

  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

  await page.getByTestId('expert-register-toggle').click();
  await expect(page.getByTestId('expert-register-row').first()).toBeVisible();
  return { llm, revisionBody: () => llm.filter((b) => !isTriageCall(b)).slice(-1)[0] };
}

const answered = (llm) => JSON.stringify(llm.filter((b) => !isTriageCall(b)).slice(-1)[0] || {});

test.describe('the finding asks, and one click answers it', () => {
  test('the claim gets the question and the plain finding does not', async ({ page }) => {
    await draft(page);
    const rows = page.getByTestId('expert-register-row');
    await expect(rows).toHaveCount(2);
    // One control on the page, on the row carrying the claim.
    await expect(page.getByTestId('claim-question')).toHaveCount(1);
    await expect(rows.nth(0)).toContainText('he wanted attention');
    await expect(rows.nth(0).getByTestId('claim-question')).toBeVisible();
    await expect(rows.nth(1)).toContainText('Client eloped twice');
    await expect(rows.nth(1).getByTestId('claim-question')).toHaveCount(0);
  });

  test('the four answers are the ones he named', async ({ page }) => {
    await draft(page);
    const q = page.getByTestId('claim-question');
    await expect(q).toHaveAttribute('data-claim-kind', 'attention');
    await expect(q.getByTestId('claim-option-after')).toContainText('Attention came after');
    await expect(q.getByTestId('claim-option-before')).toContainText('Attention was missing before');
    await expect(q.getByTestId('claim-option-both')).toContainText('Both');
    await expect(q.getByTestId('claim-option-other')).toContainText('Something else');
  });
});

test.describe('the answer decides the section', () => {
  test('after sends it to the behavior narrative and not to the antecedent one', async ({ page }) => {
    const { llm } = await draft(page);
    await page.getByTestId('claim-option-after').click();
    await expect.poll(() => llm.filter((b) => !isTriageCall(b)).length).toBe(2);
    const sent = answered(llm);
    expect(sent).toContain('behaviorPlanNarrative');
    expect(sent).toContain('attention followed the behavior');
    expect(sent).not.toContain('attention was absent or reduced');
  });

  test('before sends it to the antecedent narrative and not to the behavior one', async ({ page }) => {
    const { llm } = await draft(page);
    await page.getByTestId('claim-option-before').click();
    await expect.poll(() => llm.filter((b) => !isTriageCall(b)).length).toBe(2);
    const sent = answered(llm);
    expect(sent).toContain('attention was absent or reduced before the behavior');
    expect(sent).toContain('what preceded the behavior');
    expect(sent).not.toContain('attention followed the behavior');
  });

  test('both names both sections and forbids one sentence doing for two', async ({ page }) => {
    const { llm } = await draft(page);
    await page.getByTestId('claim-option-both').click();
    await expect.poll(() => llm.filter((b) => !isTriageCall(b)).length).toBe(2);
    const sent = answered(llm);
    expect(sent).toContain('attention followed the behavior');
    expect(sent).toContain('attention was absent or reduced before the behavior');
    expect(sent).toContain('do not repeat the same sentence in both');
  });

  test('the pencil carries the technician own words', async ({ page }) => {
    const { llm } = await draft(page);
    await page.getByTestId('claim-option-other').click();
    await page.getByTestId('claim-detail').fill('he looked at the door, not at me');
    await page.getByTestId('claim-detail-send').click();
    await expect.poll(() => llm.filter((b) => !isTriageCall(b)).length).toBe(2);
    const sent = answered(llm);
    expect(sent).toContain('he looked at the door, not at me');
    // A typed answer routes itself; it must not be filed under a section the
    // technician never picked.
    expect(sent).toContain('The answer names the sections it belongs in');
  });
});

test.describe('what the instruction must never do', () => {
  test('it forbids the function rather than passing it on', async ({ page }) => {
    const { llm } = await draft(page);
    await page.getByTestId('claim-option-after').click();
    await expect.poll(() => llm.filter((b) => !isTriageCall(b)).length).toBe(2);
    const sent = answered(llm);
    expect(sent).toContain('Name no function');
    expect(sent).toContain('Do not state a motive, a desire, or the reason the behavior happened');
  });

  /* THE SCRUB REWROTE THIS INSTRUCTION ONCE AND IT WOULD HAVE SHIPPED.
   *
   * Every revision instruction goes through the same name gate the technician's
   * typed text does, and that gate reads a role label followed by a capitalised
   * word as a person. Its pattern carries the i flag. So the first draft of the
   * closing rule, "do not write what the client wanted", went out to the model
   * as "do not write what the client Client 2", with a second phrase replaced
   * by an opaque token.
   *
   * A substring check would not have caught it, because a substring check only
   * finds the wordings somebody thought to look for. This compares what crossed
   * the wire against what the module built, character for character, so ANY
   * future wording the gate rewrites fails here. */
  test('what crosses the wire is what the module wrote, character for character', async ({ page }) => {
    const { llm } = await draft(page);
    const built = await page.evaluate(() =>
      window.FunctionClaim.instructionFor(window.FunctionClaim.read('he wanted attention'), 'after', ''));
    await page.getByTestId('claim-option-after').click();
    await expect.poll(() => llm.filter((b) => !isTriageCall(b)).length).toBe(2);
    const body = llm.filter((b) => !isTriageCall(b)).slice(-1)[0];
    const sent = body.messages[body.messages.length - 1].content;
    expect(sent).toContain('Instruction: ' + built);
    // Two-sided: the module really did produce the sentence being compared, so
    // this cannot pass by comparing an empty string to an empty string.
    expect(built).toContain('behaviorPlanNarrative');
    expect(built.length).toBeGreaterThan(200);
  });

  test('the quote rides as a pointer and the name still never crosses the wire', async ({ page }) => {
    const { llm } = await draft(page);
    await page.getByTestId('claim-option-after').click();
    await expect.poll(() => llm.filter((b) => !isTriageCall(b)).length).toBe(2);
    const sent = answered(llm);
    // The finding's own words reach the model, labelled as a pointer.
    expect(sent).toContain('he wanted attention');
    expect(sent).toContain('It is not content to copy into the note');
    // Two-sided: this is a real revision call carrying the note, and it is
    // still scrubbed. "client Jacob" was typed into the intake.
    expect(sent).toContain('Elopement occurred on two occasions');
    expect(sent).not.toContain('Jacob');
  });
});

test.describe('answering it once is answering it', () => {
  test('the question is replaced by what they said', async ({ page }) => {
    await draft(page);
    await page.getByTestId('claim-option-before').click();
    await expect(page.getByTestId('claim-answered')).toBeVisible();
    await expect(page.getByTestId('claim-answered')).toHaveAttribute('data-claim-answer', 'before');
    await expect(page.getByTestId('claim-answered')).toContainText('Attention was missing before it');
    await expect(page.getByTestId('claim-question')).toHaveCount(0);
  });

  test('the revision reaches the note', async ({ page }) => {
    const revised = { ...NOTE, behaviorPlanNarrative: 'Elopement occurred on two occasions. The technician blocked the door and spoke with the client afterwards.' };
    await draft(page, { revised });
    await page.getByTestId('claim-option-after').click();
    await expect(page.getByText('spoke with the client afterwards')).toBeVisible({ timeout: 20000 });
  });
});

/* THE ROW SHOWS THEIR WORD AND THE WIRE CARRIES THE TOKEN.
 *
 * These two came within one commit of being a leak. The register quote is
 * rehydrated for display now, so the row shows the word the clinician typed
 * rather than the token that replaced it. The claim answer sends that same quote
 * back to the model in the prompt, on purpose and deliberately unscrubbed,
 * because the standing premise is that a quote of the intake has already been
 * through the scrub. Rehydrating in place would have falsified that premise
 * silently, and the first click on a claim question would have put a real
 * client's name on the wire.
 *
 * So expertForReader carries both strings and these tests pin both directions.
 * A build that displays the token fails the first. A build that sends the name
 * fails the second, and the second is the one that matters.
 */
test.describe('the displayed quote and the sent quote are not the same string', () => {
  const TOKEN_CLAIM = { quote: 'Client--1 wanted attention', action: 'reframe', why: 'A function claim.', move: 'Say what happened and who responded.' };
  const tokenExpert = { ...EXPERT, register: [TOKEN_CLAIM] };

  test('the row shows the word the clinician actually typed', async ({ page }) => {
    await draft(page, { expert: tokenExpert });
    const row = page.getByTestId('expert-register-row').first();
    await expect(row).toContainText('Jacob wanted attention');
    await expect(row).not.toContainText('Client--1');
  });

  test('and answering it sends the token, never the name', async ({ page }) => {
    const { llm } = await draft(page, { expert: tokenExpert });
    await page.getByTestId('claim-option-after').click();
    await expect.poll(() => llm.filter((b) => !isTriageCall(b)).length).toBe(2);
    const sent = JSON.stringify(llm.filter((b) => !isTriageCall(b)).slice(-1)[0]);
    expect(sent, 'a client name reached the model').not.toContain('Jacob');
    expect(sent).toContain('Client--1');
  });
});
