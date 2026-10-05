import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* THE EXPERT'S QUESTIONS, IN THE NOME PANEL.
 *
 * Kaleb, 2026-10-04, asking a second time: "WHERE ARE THE EXPERT QUESTION CHIPS
 * IN THE NOME PANEL?" His ruling on what moves ("Claims + asks"): the expert's
 * asks (whole-note and per section) and its function-claim questions are asked
 * in the panel, answered there, and sent in one revision. What is not a
 * question (the abbreviation readings, the phrases to reword) stays above the
 * note. Every model call is stubbed and every word is invented. */

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

const EXPERT = {
  terms: [{ token: 'DTT', reading: 'Discrete Trial Training', status: 'resolved', why: 'Named beside the trial count.' }],
  register: [
    { quote: 'he wanted attention', action: 'reframe', why: 'A function claim, not an observation.', move: 'Say what happened and who responded.' },
  ],
  hints: [
    { section: 'note', rank: 1, kind: 'blocks-claim', ask: 'What was the prompt level on the failed trials?', why: 'A payer reads a trial count with no prompt level as unsupported.' },
    { section: 'behaviorPlanNarrative', rank: 2, kind: 'thin', ask: 'How long did each elopement last?', why: 'Duration is what a rate comparison needs.' },
  ],
  hintsDropped: 0,
  usage: { input_tokens: 20, output_tokens: 30 },
  model: 'claude-haiku-4-5-20251001',
};

async function draft(page, { expert = EXPERT, behavior = 'elopement x2, blocked and redirected, he wanted attention' } = {}) {
  const llm = [];
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    llm.push(b);
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(NOTE));
  });
  await page.route('**/api/expert-pass**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(expert) }));
  await page.addInitScript(([k, t]) => localStorage.setItem(k, t), ['notes_auth_token', tokenFor('admin', ['bt'])]);
  await page.goto(PAGE);
  await page.getByRole('textbox', { name: /Skill Acquisition/i }).fill('DTT money 3 item array, 8 of 10 gestural');
  await page.getByRole('textbox', { name: /Antecedent Strategies/i }).fill('two minute warning before transitions');
  await page.getByRole('textbox', { name: /Behavior & Staff Response/i }).fill(behavior);
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  await expect(page.getByText('Generated Note')).toBeVisible({ timeout: 20000 });
  return { llm };
}

async function openPanel(page) {
  const block = page.getByTestId('panel-expert-questions');
  if (await block.isVisible({ timeout: 800 }).catch(() => false)) return block;
  const fab = page.locator('.revision-fab').first();
  if (await fab.isVisible({ timeout: 3000 }).catch(() => false)) await fab.click();
  await expect(block).toBeVisible({ timeout: 10000 });
  return block;
}

test.describe('the expert asks in the NoMe panel', () => {
  test('its asks and its function-claim question are in the panel, each with a way to answer', async ({ page }) => {
    await draft(page);
    const block = await openPanel(page);
    await expect(block.locator('[data-panel-expert]')).toHaveCount(3);
    await expect(block).toContainText('What was the prompt level on the failed trials?');
    await expect(block).toContainText('How long did each elopement last?');
    await expect(block.locator('[data-expert-kind="claim"]')).toContainText('he wanted attention');
    // On bt the claim keeps its one-click answers, now in the panel.
    await expect(block.getByTestId('claim-question')).toHaveCount(1);
    await expect(block.locator('textarea.expert-answer')).toHaveCount(2);
  });

  test('above the note only what is not a question stays', async ({ page }) => {
    await draft(page);
    await expect(page.getByTestId('expert-reading')).toBeVisible();
    await expect(page.getByTestId('expert-terms')).toBeVisible();
    await expect(page.getByTestId('expert-note')).toHaveCount(0);
    await expect(page.getByTestId('expert-behaviorPlanNarrative')).toHaveCount(0);
    await expect(page.getByTestId('expert-reading').getByTestId('claim-question')).toHaveCount(0);
  });

  test('answers go in one revision, each under its question, and the answered ones leave the panel', async ({ page }) => {
    const { llm } = await draft(page);
    const block = await openPanel(page);
    const before = llm.length;
    await block.locator('[data-panel-expert^="ask:note"] textarea').fill('Gestural on both misses.');
    await block.locator('[data-panel-expert^="ask:behaviorPlanNarrative"] textarea').fill('About a minute each.');
    await block.getByTestId('panel-expert-send').click();
    await expect.poll(() => llm.length).toBeGreaterThan(before);
    const sent = JSON.stringify(llm.slice(before));
    expect(sent).toContain('What was the prompt level on the failed trials?');
    expect(sent).toContain('Gestural on both misses.');
    expect(sent).toContain('How long did each elopement last?');
    expect(sent).toContain('About a minute each.');
    await expect(block.locator('[data-panel-expert^="ask:"]')).toHaveCount(0);
  });

  test('Send waits for an answer: nothing typed, nothing to send', async ({ page }) => {
    await draft(page);
    const block = await openPanel(page);
    await expect(block.getByTestId('panel-expert-send')).toHaveCount(0);
    await block.locator('[data-panel-expert^="ask:note"] textarea').fill('Gestural.');
    await expect(block.getByTestId('panel-expert-send')).toBeVisible();
  });
});

test('a name the question shows goes out as its token, never as the name', async ({ page }) => {
  const named = { ...EXPERT, register: [], hints: [{ section: 'note', rank: 1, kind: 'thin', ask: 'Where was Jacob when he eloped?', why: 'Setting.' }] };
  const { llm } = await draft(page, { expert: named, behavior: 'elopement x2 with client Jacob, blocked and redirected' });
  const block = await openPanel(page);
  const before = llm.length;
  await block.locator('[data-panel-expert^="ask:note"] textarea').fill('By the door.');
  await block.getByTestId('panel-expert-send').click();
  await expect.poll(() => llm.length).toBeGreaterThan(before);
  const sent = JSON.stringify(llm.slice(before));
  expect(sent).toContain('By the door.');
  expect(sent).toContain('when he eloped?');
  expect(sent).not.toContain('Jacob');
});
