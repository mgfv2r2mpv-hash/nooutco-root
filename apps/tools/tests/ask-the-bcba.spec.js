import { test, expect } from '@playwright/test';

// "I do want the BTs to ask questions of NoMe and it can try to stay within its
// scope but if they say they're not sure about something then it could be smart
// to tell the BT user 'this is a great thing to ask the BCBA about, do you want
// me to do that?'"
//
// His answer on what happens next: put it in the note itself, because the note
// is already the channel to the BCBA and nothing new has to be built or watched.
//
// One deviation, flagged: he said tick Action Items for BCBA as well. That list
// is his EHR's closed set and has no option meaning "the technician has a
// question" - the nearest is "Contact staff". Forcing that into a clinical
// record would be worse than leaving the checkbox to normal inference, so this
// writes the question and does not tick anything.

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}
const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});
const note = (o = {}) => ({
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
});

async function drafted(page, onRevision) {
  let calls = 0;
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    const last = (b.messages && b.messages.length) ? String(b.messages[b.messages.length - 1].content || '') : '';
    if (/look at your own draft again/i.test(last)) return route.fulfill(reply(note()));
    const isTriage = !!b.systemPrompt || /sufficient/i.test(b.system || '');
    if (isTriage) return route.fulfill(reply({ sufficient: true, questions: [] }));
    calls++;
    if (calls === 1) return route.fulfill(reply(note()));
    return onRevision(route, b);
  });
  await page.goto('/notes/bt/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto('/notes/bt/');
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array faded to gestural');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first then board, choice up front');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement x2 blocked, not sure if it counts');
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

const Q = 'Should the two instances of leaving the table be recorded as elopement, or as a transition refusal?';

test.describe('it offers to ask the BCBA', () => {
  test('an offer appears, and nothing is written until it is accepted', async ({ page }) => {
    await drafted(page, (route) => route.fulfill(reply(note({
      answer: 'I would not want to call that either way without your BCBA.',
      bcbaQuestion: Q,
    }))));

    await page.locator('.revision-input').fill("I'm not sure if that counts as elopement");
    await page.locator('.revision-send').click();

    const offer = page.locator('.bcba-offer');
    await expect(offer).toBeVisible({ timeout: 20000 });
    await expect(offer).toContainText(Q);
    // Offered, not applied. Putting words in a clinical record on someone's
    // behalf is not the tool's call.
    await expect(page.locator('textarea[data-section-id="followUpNarrative"]'))
      .toHaveValue(/No new questions or concerns/);
  });

  test('accepting puts it in the follow-up section, through Accept and Discard', async ({ page }) => {
    await drafted(page, (route) => route.fulfill(reply(note({ bcbaQuestion: Q }))));
    await page.locator('.revision-input').fill("not sure if that counts");
    await page.locator('.revision-send').click();
    await expect(page.locator('.bcba-offer')).toBeVisible({ timeout: 20000 });

    await page.getByRole('button', { name: 'Add it to the note' }).click();
    await expect(page.locator('.bcba-offer')).toHaveCount(0);

    // It is a proposal like any other, so it is visible and reversible.
    await expect(page.locator('.diff-view').first()).toBeVisible();
    await page.locator('.diff-accept').first().click();
    await expect(page.locator('textarea[data-section-id="followUpNarrative"]')).toHaveValue(new RegExp('transition refusal'));
  });

  test('it replaces the nothing-to-report default rather than contradicting it', async ({ page }) => {
    // "No new questions or concerns for the BCBA" followed by a question is a
    // note that argues with itself.
    await drafted(page, (route) => route.fulfill(reply(note({ bcbaQuestion: Q }))));
    await page.locator('.revision-input').fill("not sure");
    await page.locator('.revision-send').click();
    await expect(page.locator('.bcba-offer')).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Add it to the note' }).click();
    await page.locator('.diff-accept').first().click();

    const value = await page.locator('textarea[data-section-id="followUpNarrative"]').inputValue();
    expect(value).not.toMatch(/No new questions or concerns/);
  });

  test('declining leaves the note alone', async ({ page }) => {
    await drafted(page, (route) => route.fulfill(reply(note({ bcbaQuestion: Q }))));
    await page.locator('.revision-input').fill("not sure");
    await page.locator('.revision-send').click();
    await expect(page.locator('.bcba-offer')).toBeVisible({ timeout: 20000 });

    await page.getByRole('button', { name: 'No thanks' }).click();
    await expect(page.locator('.bcba-offer')).toHaveCount(0);
    await expect(page.locator('textarea[data-section-id="followUpNarrative"]'))
      .toHaveValue(/No new questions or concerns/);
  });

  test('no offer when they were not unsure', async ({ page }) => {
    await drafted(page, (route) => route.fulfill(reply(note({
      behaviorPlanNarrative: 'The client eloped twice and was blocked each time.',
    }))));
    await page.getByText('Narrative of Behavior Support Plan Goals Progress', { exact: true }).click();
    await page.locator('.revision-input').fill('tighten this');
    await page.locator('.revision-send').click();
    await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.bcba-offer')).toHaveCount(0);
  });

  test('the prompt asks for clinical uncertainty only, not wording', async ({ page }) => {
    let seen = null;
    await drafted(page, (route, body) => {
      seen = body.messages[body.messages.length - 1].content;
      return route.fulfill(reply(note()));
    });
    await page.locator('.revision-input').fill('anything');
    await page.locator('.revision-send').click();
    await expect(page.locator('.revision-panel-body')).toContainText(/No change was needed|Updated/i, { timeout: 20000 });

    expect(seen).toMatch(/IF THE CLINICIAN SAYS THEY ARE UNSURE/);
    expect(seen).toMatch(/do not guess and do not decide for them/i);
    // A tool that offers to escalate every typo would be noise.
    expect(seen).toMatch(/not for uncertainty about wording or formatting/i);
  });
});
