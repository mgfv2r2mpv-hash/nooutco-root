import { test, expect } from '@playwright/test';

// The card the technician sees, and the thing that makes it safe to inject:
// the block is snapshotted per conversation, so muting a rule mid-note cannot
// change the cached prompt prefix that every revision replays.

const CARD = {
  available: true,
  block: [
    'TECHNICIAN VOICE (learned from this technician\'s own corrections)',
    'Match them where they do not conflict with anything above.',
    '- Keep sentences short.',
  ].join('\n'),
  rules: [
    { feature: 'sentence_length', direction: -1, rule: 'Keep sentences short.', evidence: 9, confidence: 1, muted: false },
    { feature: 'hedging', direction: -1, rule: 'State observations directly.', evidence: 6, confidence: 0.83, muted: true },
  ],
};

/** Log in with a token the page will accept, and serve a fixed card. */
async function withCard(page, card = CARD) {
  await page.route('**/api/style-card.js*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(card) }));
  await page.goto('/notes/bt/');
  await page.evaluate(() => {
    const payload = { role: 'user', kid: 'pw:tech-1', tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // The signature is never checked in the browser — only the server verifies
    // it, and these tests intercept the server.
    localStorage.setItem('notes_auth_token', `${b64}.local-test`);
  });
  await page.reload();
}

test.describe('the card the technician sees', () => {
  test('learned habits are shown, with how much evidence each has', async ({ page }) => {
    await withCard(page);
    const toggle = page.getByRole('button', { name: /learned to write like you/i });
    await expect(toggle).toBeVisible();
    // One of the two rules is muted, so only one counts as active.
    await expect(toggle).toContainText('1 habit');

    await toggle.click();
    await expect(page.getByText('Keep sentences short.')).toBeVisible();
    await expect(page.getByText(/seen in 9 edits/)).toBeVisible();
  });

  test('it says plainly that nothing they typed is stored', async ({ page }) => {
    await withCard(page);
    await page.getByRole('button', { name: /learned to write like you/i }).click();
    await expect(page.getByText(/never from anything you typed/i)).toBeVisible();
  });

  test('a muted rule reads as switched off rather than absent', async ({ page }) => {
    await withCard(page);
    await page.getByRole('button', { name: /learned to write like you/i }).click();
    // Muted rules stay visible and unchecked -- a rule that vanished would look
    // like it was never learned.
    await expect(page.getByRole('checkbox', { name: /State observations directly/ })).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Keep sentences short/ })).toBeChecked();
  });

  test('unchecking a rule sends the mute', async ({ page }) => {
    let muted = null;
    await page.route('**/api/style-card/mute.js*', async (route) => {
      muted = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await withCard(page);
    await page.getByRole('button', { name: /learned to write like you/i }).click();
    // click() rather than uncheck(): the state settles through a React update
    // and, on failure, deliberately rolls back — so the assertion belongs after
    // the click, not inside it.
    await page.getByRole('checkbox', { name: /Keep sentences short/ }).click();

    await expect.poll(() => muted).toMatchObject({ feature: 'sentence_length', muted: true });
    await expect(page.getByRole('checkbox', { name: /Keep sentences short/ })).not.toBeChecked();
  });

  test('a mute that fails says so instead of silently reverting', async ({ page }) => {
    await page.route('**/api/style-card/mute.js*', (route) =>
      route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' }));
    await withCard(page);
    await page.getByRole('button', { name: /learned to write like you/i }).click();
    await page.getByRole('checkbox', { name: /Keep sentences short/ }).click();

    await expect(page.getByText(/couldn’t save that just now/i)).toBeVisible();
    // The box ends up back ON, because the rule still is. That rollback is why
    // this cannot use uncheck() — the final state is deliberately unchanged.
    await expect(page.getByRole('checkbox', { name: /Keep sentences short/ })).toBeChecked();
  });
});

test.describe('the card stays out of the way when there is nothing to show', () => {
  test('a new technician with no learned habits sees no card', async ({ page }) => {
    await withCard(page, { available: true, rules: [], block: '' });
    await expect(page.getByRole('button', { name: /learned to write like you/i })).toHaveCount(0);
  });

  test('an unreachable profile store sees no card, and no error', async ({ page }) => {
    await withCard(page, { available: false, rules: [], block: '' });
    await expect(page.getByRole('button', { name: /learned to write like you/i })).toHaveCount(0);
    // The house rules panel is unaffected -- the page is fully usable.
    await expect(page.getByRole('button', { name: /Documentation standards/i })).toBeVisible();
  });

  test('a logged-out page never asks for a card', async ({ page }) => {
    let asked = false;
    await page.route('**/api/style-card.js*', async (route) => {
      asked = true;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CARD) });
    });
    await page.goto('/notes/bt/');
    await page.evaluate(() => localStorage.removeItem('notes_auth_token'));
    await page.reload();
    await page.waitForTimeout(800);
    expect(asked).toBe(false);
  });
});

// A complete BT note. The engine's shape gate rejects a response missing any
// key its formSections contract for, so this has to be whole.
function noteReply() {
  return {
    individualsPresent: ['Client'],
    clinicalStatus: ['Presented Tired'],
    clinicalStatusNarrative: 'The client presented as tired on arrival.',
    purpose: ['Worked on goals as stated in the treatment plan'],
    servicePaused: 'No',
    abaTechniques: ['Discrete Trial Training'],
    lessonProgressNarrative: 'The behavior technician used a three-item array.',
    antecedentStrategies: ['Offered choices'],
    antecedentNarrative: 'Choices were offered before each demand.',
    consequenceStrategies: ['Redirection'],
    consequenceEffectiveness: 'Moderately effective at addressing behaviors within session',
    behaviorPlanNarrative: 'Elopement occurred on two occasions.',
    clientProgress: 'Steady progress towards goals and behaviors',
    actionItems: ['None'],
    followUpNarrative: 'Direct staff do not report new questions or concerns for the BCBA.',
    hints: [],
  };
}

async function fillRequiredAndGenerate(page) {
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT 3-item array, full physical faded to independent');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('first-then board before demands');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill('elopement, blocked and redirected');
  await page.getByRole('button', { name: 'Generate Note' }).click();

  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await expect(ack).toBeEnabled();
    await ack.click();
  }
  const review = page.locator('#notes-scrub-go');
  if (await review.isVisible({ timeout: 1500 }).catch(() => false)) await review.click();
}

test.describe('the learned block reaches the prompt, and then holds still', () => {
  test('the block is appended to the system prompt, and triage is left alone', async ({ page }) => {
    const noteCalls = [];
    const triageCalls = [];

    await page.route('**/api/llm-call**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      // Triage is a separate, cheaper call with its own system prompt.
      const isTriage = !!body.systemPrompt || /sufficient/i.test(body.system || '');
      (isTriage ? triageCalls : noteCalls).push(body);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify(isTriage ? { sufficient: true, questions: [] } : noteReply()) }],
          usage: { output_tokens: 100 },
          stop_reason: 'end_turn',
        }),
      });
    });

    await withCard(page);
    await fillRequiredAndGenerate(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    expect(noteCalls.length).toBeGreaterThan(0);
    expect(noteCalls[0].system).toContain('TECHNICIAN VOICE');
    expect(noteCalls[0].system).toContain('Keep sentences short.');

    // Triage must NOT carry the block. It is a different prompt with a
    // different job, and it is not part of the cached note conversation.
    for (const t of triageCalls) {
      expect(t.system || t.systemPrompt || '').not.toContain('TECHNICIAN VOICE');
    }
  });

  test('muting a rule mid-note does not change the prompt the revision replays', async ({ page }) => {
    // This is the whole reason the block is snapshotted. If a mute changed the
    // system prompt of an open conversation, the cached prefix every revision
    // replays would stop matching and each turn would pay full price.
    const systems = [];
    await page.route('**/api/style-card/mute**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
    await page.route('**/api/llm-call**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const isTriage = !!body.systemPrompt || /sufficient/i.test(body.system || '');
      if (!isTriage) systems.push(body.system);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          content: [{ type: 'text', text: JSON.stringify(isTriage ? { sufficient: true, questions: [] } : noteReply()) }],
          usage: { output_tokens: 100 },
          stop_reason: 'end_turn',
        }),
      });
    });

    await withCard(page);
    await fillRequiredAndGenerate(page);
    await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });

    // Switch the rule off while the note is open.
    await page.getByRole('button', { name: /learned to write like you/i }).click();
    await page.getByRole('checkbox', { name: /Keep sentences short/ }).click();
    await expect(page.getByRole('checkbox', { name: /Keep sentences short/ })).not.toBeChecked();
    // The panel says so, so the technician is not left guessing.
    await expect(page.getByText(/applies to your next note/i)).toBeVisible();

    // Now revise. The panel is already open after a draft, so this runs
    // unconditionally — a guarded assertion here could pass without ever
    // exercising the thing the test exists for.
    await expect(page.locator('.revision-panel')).toBeVisible();
    await page.locator('.revision-input').fill('make the behavior section shorter');
    await page.locator('.revision-send').click();

    await expect.poll(() => systems.length, { timeout: 20000 }).toBe(2);
    expect(systems[1]).toBe(systems[0]);
    expect(systems[1]).toContain('Keep sentences short.');
  });
});
