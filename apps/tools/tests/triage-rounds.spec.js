import { test, expect } from '@playwright/test';

// Triage asks more than once.
//
// His note: "the model need not give up on questions after one round.
// Sometimes they will answer two of 3 or 3 of 5 and wait for your answer to get
// what they need to decide for the remaining question."
//
// Before this, answering two of three sent the note to drafting with the third
// still open, and the answer to it was never asked for.

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
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

const isTriage = (b) => !!b.systemPrompt || /sufficient/i.test(b.system || '');

// `script` is the sequence of triage replies. Anything not triage gets a note.
async function run(page, script) {
  const triageBodies = [];
  let t = 0;
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const last = (b.messages && b.messages.length) ? String(b.messages[b.messages.length - 1].content || '') : '';
    if (/look at your own draft again/i.test(last)) return route.fulfill(reply(note()));
    if (isTriage(b)) {
      triageBodies.push(last);
      const next = script[Math.min(t, script.length - 1)];
      t++;
      return route.fulfill(reply(next));
    }
    return route.fulfill(reply(note()));
  });

  await page.goto('/notes/bt/');
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto('/notes/bt/');
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  return { triageBodies, triageCount: () => t };
}

const answer = async (page, text) => {
  await page.locator('.revision-input').fill(text);
  await page.locator('.revision-send').click();
};

test.describe('it asks again when something is still missing', () => {
  test('a second round is asked rather than drafting around the gap', async ({ page }) => {
    await run(page, [
      { sufficient: false, questions: [{ field: 'fBehavior', question: 'How many times did the elopement happen?' }] },
      { sufficient: false, questions: [{ field: 'fLesson', question: 'What prompt level did you fade to?' }] },
      { sufficient: true, questions: [] },
    ]);

    await expect(page.getByText(/How many times/i)).toBeVisible({ timeout: 20000 });
    await answer(page, 'twice');

    // The second question, which only became answerable after the first.
    await expect(page.getByText(/What prompt level/i)).toBeVisible({ timeout: 20000 });
    // And the note has NOT been drafted yet.
    await expect(page.getByText('Generated Note')).toHaveCount(0);
  });

  test('the follow-up round is told what was already answered', async ({ page }) => {
    const { triageBodies } = await run(page, [
      { sufficient: false, questions: [{ field: 'fBehavior', question: 'How many times?' }] },
      { sufficient: true, questions: [] },
    ]);
    await expect(page.getByText(/How many times/i)).toBeVisible({ timeout: 20000 });
    await answer(page, 'twice, both during the money program');
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    const second = triageBodies[1];
    expect(second, 'the second round must see the first answer').toContain('ALREADY ANSWERED');
    expect(second).toContain('twice, both during the money program');
    // Otherwise it asks the same thing again, which reads as not listening.
    expect(second).toMatch(/Never re-ask something they have answered/i);
  });

  test('it stops after three rounds rather than interrogating', async ({ page }) => {
    // A model that always finds something missing must not be able to loop.
    const { triageCount } = await run(page, [
      { sufficient: false, questions: [{ field: 'fBehavior', question: 'Round one question?' }] },
    ]);
    await expect(page.getByText(/Round one question/i)).toBeVisible({ timeout: 20000 });
    await answer(page, 'a');
    await expect(page.getByText(/Round one question/i)).toBeVisible({ timeout: 20000 });
    await answer(page, 'b');
    await expect(page.getByText(/Round one question/i)).toBeVisible({ timeout: 20000 });
    await answer(page, 'c');

    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
    expect(triageCount(), 'three rounds of questions, then draft').toBe(3);
  });

  test('every answer reaches the note, not just the last one', async ({ page }) => {
    let noteAsk = null;
    await page.route('**/api/llm-call**', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}');
      const last = (b.messages && b.messages.length) ? String(b.messages[b.messages.length - 1].content || '') : '';
      if (/look at your own draft again/i.test(last)) return route.fulfill(reply(note()));
      if (isTriage(b)) {
        return route.fulfill(reply(/ALREADY ANSWERED/.test(last)
          ? { sufficient: true, questions: [] }
          : { sufficient: false, questions: [{ field: 'fBehavior', question: 'How many times?' }] }));
      }
      noteAsk = b.messages[0].content;
      return route.fulfill(reply(note()));
    });
    await page.goto('/notes/bt/');
    await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
    await page.goto('/notes/bt/');
    await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array');
    await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board');
    await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked');
    await page.getByRole('button', { name: 'Generate Note' }).click();
    const ack = page.locator('#notes-ack-go');
    if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
      await page.locator('#notes-ack-cb').check();
      await ack.click();
    }
    const rev = page.locator('#notes-scrub-go');
    if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();

    await expect(page.getByText(/How many times/i)).toBeVisible({ timeout: 20000 });
    await answer(page, 'twice during the money program');
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    expect(noteAsk).toContain('twice during the money program');
  });

  test('skipping keeps what was already answered rather than binning it', async ({ page }) => {
    await run(page, [
      { sufficient: false, questions: [{ field: 'fBehavior', question: 'How many times?' }] },
      { sufficient: false, questions: [{ field: 'fLesson', question: 'What prompt level?' }] },
      { sufficient: true, questions: [] },
    ]);
    await expect(page.getByText(/How many times/i)).toBeVisible({ timeout: 20000 });
    await answer(page, 'twice, in the money program');
    await expect(page.getByText(/What prompt level/i)).toBeVisible({ timeout: 20000 });

    // Skip the second. The first answer is work they already did.
    await page.locator('.revision-skip').click();
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.revision-panel-body')).toContainText('twice, in the money program');
  });
});
