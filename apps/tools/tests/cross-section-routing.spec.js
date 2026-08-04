import { test, expect } from '@playwright/test';

// Cross-section routing.
//
// The engine used to run `if (targetId && id !== targetId) return;` over the
// model's reply, which threw away every change made outside the section the
// clinician clicked. Say "and shorten the lesson narrative too" while pointing
// at Behavior and the model would do it, correctly, and the engine would drop
// it on the floor without telling anyone.
//
// His four rulings, 2026-08-04:
//   1. apply the part that fits, ask about the rest
//   2. declined text stays in the conversation so it can be reused
//   3. the question appears as a message in the panel
//   4. automatic when the model is confident, with an undo
//
// So `confident` decides everything, and these tests pin both sides of it.

function tokenFor(role = 'user', tools = ['bt']) {
  const payload = { role, kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.not-a-real-signature`;
}

function reply(obj) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(obj) }],
      usage: { output_tokens: 100 },
      stop_reason: 'end_turn',
    }),
  };
}

function note(overrides = {}) {
  return {
    individualsPresent: ['Client'],
    clinicalStatus: ['Presented Tired'],
    clinicalStatusNarrative: 'The client presented as tired on arrival.',
    purpose: ['Worked on goals as stated in the treatment plan'],
    servicePaused: 'No',
    abaTechniques: ['Discrete Trial Training'],
    lessonProgressNarrative: 'The behavior technician utilized a three-item array.',
    antecedentStrategies: ['Offered choices'],
    antecedentNarrative: 'Choices were offered before each demand.',
    consequenceStrategies: ['Redirection'],
    consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
    behaviorPlanNarrative: 'Elopement occurred on two occasions.',
    clientProgress: 'Steady progress towards goals and behaviors',
    actionItems: ['None'],
    followUpNarrative: 'No new questions or concerns for the BCBA at this time.',
    hints: [],
    ...overrides,
  };
}

async function acceptScrubGate(page) {
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await expect(ack).toBeEnabled();
    await ack.click();
  }
  const review = page.locator('#notes-scrub-go');
  if (await review.isVisible({ timeout: 1500 }).catch(() => false)) await review.click();
}

async function draft(page, onRevision) {
  let calls = 0;
  await page.route('**/api/llm-call**', async (route) => {
    calls++;
    if (calls === 1) return route.fulfill(reply({ sufficient: true, questions: [] }));
    if (calls === 2) return route.fulfill(reply(note()));
    return onRevision(route, JSON.parse(route.request().postData() || '{}'));
  });
  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto('/notes/bt/');
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT 3-item array, full physical faded to independent');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  await acceptScrubGate(page);
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });
}

// Target Behavior, and have the model also rewrite the lesson narrative.
async function reviseFromBehaviour(page, crossSection) {
  await draft(page, (route) => route.fulfill(reply(note({
    behaviorPlanNarrative: 'Elopement occurred twice and was blocked each time.',
    lessonProgressNarrative: 'The behavior technician used a three-item array.',
    crossSection,
  }))));

  await page.getByText('Narrative of Behavior Support Plan Goals Progress', { exact: true }).click();
  await expect(page.locator('.revision-panel')).toBeVisible();
  await page.locator('.revision-input').fill('tighten this, and shorten the lesson narrative too');
  await page.locator('.revision-send').click();
}

test.describe('a revision that reaches past the section that was clicked', () => {
  test('confident: it is carried through and shown, not asked about', async ({ page }) => {
    await reviseFromBehaviour(page, [
      { section: 'lessonProgressNarrative', confident: true, why: 'you named the lesson narrative' },
    ]);

    // Both sections diff, so the carried change is visible rather than silent.
    await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.diff-view')).toHaveCount(2);

    // Nothing to answer.
    await expect(page.locator('.routing-ask')).toHaveCount(0);

    // And it says where else it went, and why, rather than changing a section
    // the clinician was not looking at without a word.
    await expect(page.locator('.revision-panel-body')).toContainText(/also changed/i);
    await expect(page.locator('.revision-panel-body')).toContainText('you named the lesson narrative');
  });

  test('not confident: it asks in the panel and leaves the note alone', async ({ page }) => {
    await reviseFromBehaviour(page, [
      { section: 'lessonProgressNarrative', confident: false, why: 'this one was a judgement call' },
    ]);

    const ask = page.locator('.routing-ask');
    await expect(ask).toBeVisible({ timeout: 20000 });
    await expect(ask).toContainText('Narrative of Lesson Progress');
    await expect(ask).toContainText('this one was a judgement call');
    // The wording is shown, so the call is made on what it says.
    await expect(ask.locator('.routing-ask-preview')).toContainText('used a three-item array');

    // Only the targeted section is proposed. The unconfident one is held.
    await expect(page.locator('.diff-view')).toHaveCount(1);
  });

  test('nothing at all is reported: it asks, because silence is not confidence', async ({ page }) => {
    // The four BCBA tools have no crossSection in their schema and will never
    // send one. An off-target change from them must never apply itself.
    await reviseFromBehaviour(page, []);

    await expect(page.locator('.routing-ask')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.diff-view')).toHaveCount(1);
  });

  test('taking it folds it into the same proposal, so Discard is the undo', async ({ page }) => {
    await reviseFromBehaviour(page, [
      { section: 'lessonProgressNarrative', confident: false, why: 'a judgement call' },
    ]);

    const lesson = page.locator('textarea[data-section-id="lessonProgressNarrative"]');
    await expect(page.locator('.routing-ask')).toBeVisible({ timeout: 20000 });
    await expect(lesson).toHaveValue(/utilized/);

    await page.getByRole('button', { name: 'Put it there' }).click();
    await expect(page.locator('.routing-ask')).toHaveCount(0);
    await expect(page.locator('.diff-view')).toHaveCount(2);

    // Two changed sections means a floating bar on each, and either one acts on
    // the whole proposal - which is what "Accept all 2" says on it.
    await expect(page.locator('.diff-accept').first()).toHaveText('Accept all 2');

    // Still not committed - Discard puts everything back, which is the undo.
    await page.locator('.diff-discard').first().click();
    await expect(lesson).toHaveValue(/utilized/);
  });

  test('accepting after taking it commits both sections', async ({ page }) => {
    await reviseFromBehaviour(page, [
      { section: 'lessonProgressNarrative', confident: false, why: 'a judgement call' },
    ]);

    await expect(page.locator('.routing-ask')).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Put it there' }).click();
    await page.locator('.diff-accept').first().click();

    await expect(page.locator('textarea[data-section-id="lessonProgressNarrative"]')).toHaveValue(/used a three-item array/);
    await expect(page.locator('textarea[data-section-id="behaviorPlanNarrative"]')).toHaveValue(/blocked each time/);
  });

  // His ruling: nothing is lost. Declining must not delete the wording.
  test('declining keeps the wording in the conversation rather than dropping it', async ({ page }) => {
    await reviseFromBehaviour(page, [
      { section: 'lessonProgressNarrative', confident: false, why: 'a judgement call' },
    ]);

    await expect(page.locator('.routing-ask')).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Leave that section' }).click();

    await expect(page.locator('.routing-ask')).toHaveCount(0);
    // The note is untouched there.
    await expect(page.locator('textarea[data-section-id="lessonProgressNarrative"]')).toHaveValue(/utilized/);
    // And the text it would have used is still readable, so it can be reused.
    await expect(page.locator('.revision-panel-body')).toContainText('used a three-item array');
  });

  test('the prompt tells the model what earns a confident true', async ({ page }) => {
    let body = null;
    await draft(page, (route, b) => {
      body = b;
      return route.fulfill(reply(note()));
    });
    await page.getByText('Narrative of Behavior Support Plan Goals Progress', { exact: true }).click();
    await page.locator('.revision-input').fill('tighten this');
    await page.locator('.revision-send').click();
    await expect(page.locator('.revision-panel-body')).toContainText(/No change was needed|Updated/i, { timeout: 20000 });

    const last = body.messages[body.messages.length - 1].content;
    expect(last).toContain('crossSection');
    // A rule, not a vibe: the flag is only true when the instruction named it.
    expect(last).toMatch(/confident.{0,40}true.{0,120}names that section/is);
  });
});

test.describe('the schema carries the routing', () => {
  test('crossSection is optional, so a first draft never has to emit it', async ({ page }) => {
    await page.goto('/notes/bt/');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    const schema = await page.evaluate(() => {
      const bt = window.NOTE_TOOLS.find((t) => t.id === 'bt');
      return {
        hasProp: !!bt.responseSchema.properties.crossSection,
        required: bt.responseSchema.required.includes('crossSection'),
        sealed: bt.responseSchema.additionalProperties === false,
      };
    });
    expect(schema.hasProp).toBe(true);
    expect(schema.required, 'requiring it would force it onto every generation').toBe(false);
    expect(schema.sealed).toBe(true);
  });

  test('a fabricated section name cannot route a change anywhere', async ({ page }) => {
    await page.goto('/notes/bt/');
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    const out = await page.evaluate(() => {
      const bt = window.NOTE_TOOLS.find((t) => t.id === 'bt');
      return bt.normalizeOutput({
        crossSection: [
          { section: 'lessonProgressNarrative', confident: true, why: 'ok' },
          { section: 'notARealSection', confident: true, why: 'nope' },
          { section: 'antecedentNarrative', confident: 'yes', why: 42 },
        ],
      }).crossSection;
    });

    expect(out.map((c) => c.section)).toEqual(['lessonProgressNarrative', 'antecedentNarrative']);
    // Anything that is not the boolean true is not confidence.
    expect(out[1].confident).toBe(false);
    expect(out[1].why).toBe('');
  });
});
