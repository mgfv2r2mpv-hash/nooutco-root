import { test, expect } from '@playwright/test';

// The tool revises its own first draft before anyone sees it.
//
// Measured 2026-08-04 on one intake: the register rewrite moved the uniformity
// score not at all, 26 under the old prompt and 26 under the new. Two rounds of
// the technician revising by hand took it to 16. Revision is the thing that
// works, so the tool does the first one itself.
//
// The trigger is a measurement, not a habit: it only fires when the draft's own
// sentences came out uniform. A draft that already mixes costs one API call.

function tokenFor() {
  const payload = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.not-a-real-signature`;
}
const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

// Every sentence eleven words long. This is the shape the self-revision exists
// to catch, and it is what a first draft reliably produces.
const UNIFORM = [
  'The behavior technician ran the money program with a three item array.',
  'The client responded correctly on eight of the twelve presented trials.',
  'The behavior technician faded the prompt from full physical to gestural.',
  'The client eloped from the table on two separate occasions today.',
  'The behavior technician blocked the elopement and redirected him back.',
  'The client selected the reinforcer from the choice board before starting.',
  'The behavior technician presented the discriminative stimulus for each trial.',
  'The client oriented toward the correct denomination on later presentations.',
  'The behavior technician recorded the data immediately after every trial.',
  'The client tolerated the transition to table work without any protest.',
  'The behavior technician delivered reinforcement contingent on correct responding.',
  'The client remained seated for the duration of the teaching block.',
].join(' ');

// Short next to long. Nothing to fix.
const VARIED = [
  'The client arrived settled.',
  'The behavior technician ran the money program with a three-item array of one, five and ten dollar bills, starting at full physical prompting and fading to a gesture once the client began orienting to the correct bill on his own.',
  'Eight of twelve trials were correct.',
  'He eloped twice, both times during the money program, and on each occasion the technician blocked it and brought him back with a gestural prompt before returning to the array.',
  'No self-injury today.',
  'The technician gave a two-minute warning before the move to table work and set a visual timer where he could see it, which is the change from last week.',
  'Refusals were well down.',
  'The caregiver came in at the end and asked how the device should be used at home, so the technician walked her through the two mands he uses most.',
].join(' ');

function note(prose, o = {}) {
  return {
    individualsPresent: ['Client'], clinicalStatus: ['Presented Tired'],
    clinicalStatusNarrative: 'The client presented as tired on arrival today.',
    purpose: ['Worked on goals as stated in the treatment plan'], servicePaused: 'No',
    abaTechniques: ['Discrete Trial Training'],
    lessonProgressNarrative: prose,
    antecedentStrategies: ['Offered choices'],
    antecedentNarrative: 'Choices were offered before each demand presented.',
    consequenceStrategies: ['Redirection'],
    consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
    behaviorPlanNarrative: prose,
    clientProgress: 'Steady progress towards goals and behaviors',
    actionItems: ['None'],
    followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
    hints: [], ...o,
  };
}

// Returns every prompt the page sent, so a test can assert what the second call
// actually asked for rather than that a second call happened.
async function generate(page, prose, { revisedProse = null } = {}) {
  const sent = [];
  let calls = 0;
  await page.route('**/api/llm-call**', async (route) => {
    calls++;
    const body = JSON.parse(route.request().postData() || '{}');
    sent.push(body);
    if (calls === 1) return route.fulfill(reply({ sufficient: true, questions: [] }));
    if (calls === 2) return route.fulfill(reply(note(prose)));
    return route.fulfill(reply(note(revisedProse || VARIED)));
  });

  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto('/notes/bt/');
  await page.getByRole('textbox', { name: /Skill Acquisition/i })
    .fill('DTT money program, 3 item array, started full physical faded to gestural by trial 6. 8/12 correct.');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i })
    .fill('first then board before each demand. offered choice up front. 2 min warning.');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i })
    .fill('elopement x2 from table, blocked and redirected. no SIB today.');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const review = page.locator('#notes-scrub-go');
  if (await review.isVisible({ timeout: 1500 }).catch(() => false)) await review.click();
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(1200);
  return { sent, calls: () => calls };
}

test.describe('the tool revises its own draft first', () => {
  test('a uniform draft triggers a second pass', async ({ page }) => {
    const { calls } = await generate(page, UNIFORM);
    // triage, draft, self-revision.
    expect(calls()).toBe(3);
  });

  test('a draft that already varies does not', async ({ page }) => {
    // The trigger is a measurement, so a good draft must not cost a second call.
    const { calls } = await generate(page, VARIED);
    expect(calls()).toBe(2);
  });

  test('the revision names the real problem, which is sameness not length', async ({ page }) => {
    const { sent } = await generate(page, UNIFORM);
    const ask = sent[2].messages[sent[2].messages.length - 1].content;
    expect(ask).toMatch(/SAMENESS/);
    // It must not simply demand shorter or longer, which is the mistake both
    // previous prompts made.
    expect(ask).toMatch(/equally true whether every sentence is short or every sentence is long/i);
    // And it has to quote the draft's own numbers back, because that is the
    // difference between a fact and a preference.
    expect(ask).toMatch(/average \d+ words/);
  });

  test('it forbids changing the clinical content', async ({ page }) => {
    // A rewrite pass that can invent or drop a finding is a patient-safety
    // problem, not a style feature.
    const { sent } = await generate(page, UNIFORM);
    const ask = sent[2].messages[sent[2].messages.length - 1].content;
    expect(ask).toMatch(/no new facts/i);
    expect(ask).toMatch(/no removed facts/i);
    expect(ask).toMatch(/keep every checkbox/i);
  });

  test('the technician sees the revised draft, not the uniform one', async ({ page }) => {
    await generate(page, UNIFORM, { revisedProse: 'The client arrived settled. The behavior technician ran the money program with a three-item array and faded the prompt to a gesture once he began orienting to the right bill unassisted. Eight of twelve correct.' });
    await expect(page.locator('textarea[data-section-id="lessonProgressNarrative"]'))
      .toHaveValue(/arrived settled/);
  });

  test('a failed second pass keeps the first draft rather than losing the note', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/llm-call**', async (route) => {
      calls++;
      if (calls === 1) return route.fulfill(reply({ sufficient: true, questions: [] }));
      if (calls === 2) return route.fulfill(reply(note(UNIFORM)));
      return route.abort(); // the self-revision falls over
    });
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.goto('/notes/bt/');
    await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money program, 3 item array, faded to gestural.');
    await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board, offered choice up front.');
    await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2, blocked and redirected.');
    await page.getByRole('button', { name: 'Generate Note' }).click();
    const ack = page.locator('#notes-ack-go');
    if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.locator('#notes-ack-cb').check();
      await ack.click();
    }
    const review = page.locator('#notes-scrub-go');
    if (await review.isVisible({ timeout: 1500 }).catch(() => false)) await review.click();

    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('textarea[data-section-id="lessonProgressNarrative"]'))
      .toHaveValue(/three item array/);
  });
});

test.describe('the technician voice reaches the prompt', () => {
  test('the draft call carries a measured target, not a house rule', async ({ page }) => {
    const { sent } = await generate(page, VARIED);
    const system = sent[1].system;
    expect(system).toMatch(/VOICE OF THIS TECHNICIAN, TODAY/);
    expect(system).toMatch(/MEDIAN sentence of about \d+ words/);
  });

  test('it is derived from the intake, so a different writer gets a different target', async ({ page }) => {
    const terse = await generate(page, VARIED);
    const a = (terse.sent[1].system.match(/MEDIAN sentence of about (\d+)/) || [])[1];

    await page.goto('/notes/bt/');
    const longer = await page.evaluate(() => {
      // Two sentences at minimum: one sentence is not a shape, and measure()
      // correctly refuses to infer a target from it.
      const text = "The client came in settled today and we got straight to the money program without any of the usual negotiation at the door, which is a change from last week. I started at full physical prompting because he was reaching for the wrong bill before I had finished the instruction, and by the sixth trial he was orienting to the right one unassisted.";
      const block = window.IntakeVoice.block(text);
      const m = block.match(/MEDIAN sentence of about (\d+)/);
      return m ? m[1] : null;
    });
    expect(longer, 'two sentences of flowing prose must be measurable').not.toBeNull();
    expect(Number(longer)).toBeGreaterThan(Number(a));
  });
});
