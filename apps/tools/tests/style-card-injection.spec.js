import { test, expect } from '@playwright/test';
import { isTriageCall, browserSystem } from './helpers/llm-call.js';

// The learned style block reaching the prompt, and staying put once it does.
//
// The card is fetched but deliberately NOT rendered on the notes page - that is
// a clinical surface and a panel for inspecting how the tool writes distracts
// from filing a note. Viewing and tuning move to a password-gated profile page
// next phase. So these test the injection, which is all this page does with it.
//
// The block is snapshotted per conversation: the system prompt is the cached
// prefix every revision replays, so if it could change mid-note every later
// turn would pay full price.

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
    // The signature is never checked in the browser - only the server verifies
    // it, and these tests intercept the server.
    localStorage.setItem('notes_auth_token', `${b64}.local-test`);
  });
  await page.reload();
}

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
      const isTriage = isTriageCall(body);
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
    // bt is migrated, so the browser sends only what it measured today and the
    // Worker prepends the stored prompt. The card is in that measured block.
    expect(browserSystem(noteCalls[0])).toContain('TECHNICIAN VOICE');
    expect(browserSystem(noteCalls[0])).toContain('Keep sentences short.');
    expect(noteCalls[0].system, 'a migrated tool must not send a whole prompt').toBeUndefined();

    // Triage must NOT carry the block. It is a different prompt with a
    // different job, and it is not part of the cached note conversation.
    for (const t of triageCalls) {
      expect(browserSystem(t) || t.systemPrompt || '').not.toContain('TECHNICIAN VOICE');
    }
  });

  test('a revision replays the exact prompt the draft was written with', async ({ page }) => {
    // This is the whole reason the block is snapshotted rather than read fresh
    // each turn. If the card changed under an open conversation -- a mute from
    // the profile page, a rule re-derived by a correction sent moments ago --
    // the cached prefix every revision replays would stop matching and each
    // turn would pay full price. The card is deliberately swapped mid-note here
    // to prove the open conversation ignores it.
    const systems = [];
    await page.route('**/api/llm-call**', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      const isTriage = isTriageCall(body);
      if (!isTriage) systems.push(browserSystem(body));
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

    // Change what the store would serve, while the note is open. Anything that
    // re-read the card from here on would pick this up.
    await page.route('**/api/style-card.js*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ available: true, rules: [], block: 'COMPLETELY DIFFERENT BLOCK' }),
      }));

    // Now revise. The panel is already open after a draft, so this runs
    // unconditionally - a guarded assertion here could pass without ever
    // exercising the thing the test exists for.
    await expect(page.locator('.revision-panel')).toBeVisible();
    await page.locator('.revision-input').fill('make the behavior section shorter');
    await page.locator('.revision-send').click();

    await expect.poll(() => systems.length, { timeout: 20000 }).toBe(2);
    expect(systems[1]).toBe(systems[0]);
    expect(systems[1]).toContain('Keep sentences short.');
    expect(systems[1]).not.toContain('COMPLETELY DIFFERENT BLOCK');
  });

  test('neither the style card nor the standards panel clutters the notes page', async ({ page }) => {
    // A clinical surface. The technician is here to file a note, not to tune how
    // the tool writes or to read documentation standards they are held to
    // anyway. The learning still happens here and the block still reaches the
    // prompt; only the panels are gone.
    await withCard(page);
    await expect(page.getByRole('button', { name: /learned to write like you/i })).toHaveCount(0);
    await expect(page.getByText('Keep sentences short.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Documentation standards/i })).toHaveCount(0);
  });
});
