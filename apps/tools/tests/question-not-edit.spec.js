import { test, expect } from '@playwright/test';

// Two live faults he hit on the deployed tool, both of which lose work.
//
// 1. He asked whether something belonged in the BCBA summary. The tool answered
//    by REWRITING the note. A question is not an instruction, and answering one
//    by editing is the one thing the tool should never spend on a question.
//
// 2. On a move, it removed the content from the source section and never wrote
//    it into the destination, so a move silently became a delete. The
//    cross-section work covered "this also changed another section". It did not
//    cover "this should leave here and arrive there".

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}
const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

function note(o = {}) {
  return {
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
    hints: [], ...o,
  };
}

async function drafted(page, onRevision) {
  let calls = 0;
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const last = (b.messages && b.messages.length) ? String(b.messages[b.messages.length - 1].content || '') : '';
    if (/look at your own draft again/i.test(last)) return route.fulfill(reply(note()));
    calls++;
    if (calls === 1) return route.fulfill(reply({ sufficient: true, questions: [] }));
    if (calls === 2) return route.fulfill(reply(note()));
    return onRevision(route, b);
  });
  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto('/notes/bt/');
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array faded to gestural, 8/12 correct');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board, choice up front, 2 min warning');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2 blocked and redirected, no SIB');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 30000 });
}

test.describe('a question is answered, not applied', () => {
  test('an answer lands in the panel and the note is untouched', async ({ page }) => {
    await drafted(page, (route) => route.fulfill(reply(note({
      answer: 'It belongs in the follow-up section, because it is a question for the BCBA rather than a description of what happened.',
      // The model also tried to edit. It must not be allowed to.
      behaviorPlanNarrative: 'REWRITTEN, SHOULD NOT APPEAR',
    }))));

    const behaviour = page.locator('textarea[data-section-id="behaviorPlanNarrative"]');
    await expect(behaviour).toHaveValue(/Elopement occurred on two occasions/);

    await page.locator('.revision-input').fill('does the elopement detail belong in the BCBA summary?');
    await page.locator('.revision-send').click();

    await expect(page.locator('.revision-panel-body')).toContainText(/belongs in the follow-up section/i, { timeout: 20000 });
    // Nothing proposed, nothing changed.
    await expect(page.locator('.diff-view')).toHaveCount(0);
    await expect(behaviour).toHaveValue(/Elopement occurred on two occasions/);
  });

  test('an instruction still edits, so this did not just disable revising', async ({ page }) => {
    await drafted(page, (route) => route.fulfill(reply(note({
      behaviorPlanNarrative: 'The client eloped twice and was blocked each time.',
    }))));

    await page.getByText('Narrative of Behavior Support Plan Goals Progress', { exact: true }).click();
    await page.locator('.revision-input').fill('tighten this');
    await page.locator('.revision-send').click();
    await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 20000 });
  });

  test('the prompt tells it that a question is not an instruction', async ({ page }) => {
    let seen = null;
    await drafted(page, (route, body) => {
      seen = body.messages[body.messages.length - 1].content;
      return route.fulfill(reply(note()));
    });
    await page.locator('.revision-input').fill('anything');
    await page.locator('.revision-send').click();
    await expect(page.locator('.revision-panel-body')).toContainText(/No change was needed|Updated|belongs/i, { timeout: 20000 });

    expect(seen).toMatch(/IF THE MESSAGE IS A QUESTION/);
    // The distinction has to be shown, not just asserted, or it gets guessed at.
    expect(seen).toMatch(/"Should this go in the summary\?" is a question/i);
    expect(seen).toMatch(/"Move this to the summary" is an instruction/i);
  });
});

test.describe('a move has two halves', () => {
  test('the prompt forbids removing content without placing it', async ({ page }) => {
    let seen = null;
    await drafted(page, (route, body) => {
      seen = body.messages[body.messages.length - 1].content;
      return route.fulfill(reply(note()));
    });
    await page.locator('.revision-input').fill('move the elopement detail to the summary');
    await page.locator('.revision-send').click();
    await expect(page.locator('.revision-panel-body')).toContainText(/No change was needed|Updated/i, { timeout: 20000 });

    expect(seen).toMatch(/A MOVE HAS TWO HALVES AND YOU MUST DO BOTH/);
    expect(seen).toMatch(/Never take content out of a section without putting it somewhere/i);
    // The exception matters: an explicit delete must still be possible.
    expect(seen).toMatch(/unless the clinician explicitly asked for it to be deleted/i);
  });

  test('a genuine move shows both halves, the removal and the arrival', async ({ page }) => {
    await drafted(page, (route) => route.fulfill(reply(note({
      behaviorPlanNarrative: 'The client eloped twice.',
      followUpNarrative: 'Elopement occurred twice during the money program; the BCBA may want to review the array difficulty.',
      crossSection: [{ section: 'followUpNarrative', confident: true, why: 'you asked for it to move there' }],
    }))));

    await page.getByText('Narrative of Behavior Support Plan Goals Progress', { exact: true }).click();
    await page.locator('.revision-input').fill('move the detail about array difficulty to the summary');
    await page.locator('.revision-send').click();

    // Both ends of the move are proposed together, so accepting takes both.
    await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.diff-view')).toHaveCount(2);
    await expect(page.locator('.revision-panel-body')).toContainText(/also changed/i);

    await page.locator('.diff-accept').first().click();
    await expect(page.locator('textarea[data-section-id="followUpNarrative"]')).toHaveValue(/array difficulty/);
    await expect(page.locator('textarea[data-section-id="behaviorPlanNarrative"]')).toHaveValue(/eloped twice\./);
  });
});
