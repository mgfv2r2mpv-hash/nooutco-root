import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* A revision turn on the supervision tool that rewrites Goals Analyzed rows.
 *
 * Reported as a failure: a canned-reply style revision changes the goal rows in
 * the model's JSON and the clinician sees nothing arrive. The path under test is
 * the table branch of the proposal: the reply is compared with the grid, the
 * changed table becomes a proposal change, the panel renders it, and Accept
 * writes the rows back into the grid. No live model: every /api/llm-call is
 * answered here. */

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['sup'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const DRAFT_ROWS = [
  { goal: 'Wait Before Responding', progress: 'Prompting stayed at a gestural level for the session.', nextSteps: 'Continue current teaching strategies.' },
  { goal: 'Request a Turn', progress: 'Independent requests became more frequent as the session went on.', nextSteps: 'Continue and re-assess next session.' },
];

const supNote = (o = {}) => ({
  sessionChecks: [],
  goalsAnalyzed: DRAFT_ROWS,
  overallProgress: '',
  progress: 'Data trends were reviewed with the technician.',
  programming: 'No protocol changes were made.',
  behavior: '',
  feedback: 'The Behavior Analyst gave performance feedback on prompting.',
  reviewedNotes: 'No',
  followup: '',
  hints: [],
  ...o,
});

const REVISED_ROWS = [
  { ...DRAFT_ROWS[0], progress: 'Prompting faded to a model prompt by the end of the session.' },
  DRAFT_ROWS[1],
  { goal: 'Tolerate Transitions', progress: 'Transitions went smoothly with a visual schedule.', nextSteps: 'Continue.' },
];

async function drafted(page, onRevision) {
  let calls = 0;
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    calls++;
    if (calls === 1) return route.fulfill(reply(supNote()));
    return onRevision(route, b);
  });
  await page.goto('/notes/sup/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto('/notes/sup/');
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('textbox', { name: /Session Notes/i }).fill('- Wait Before Responding: gestural prompts, minimal progress\n- Request a Turn: independent 2 of 4');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  await expect(page.getByText('Goals Analyzed', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('textarea[value], textarea').filter({ hasText: /gestural level/ }).first()).toBeVisible({ timeout: 30000 });
}

// The proposal draws its own read-only grid inside .diff-view; the real one is everything else.
const goalCells = (page) => page.locator('textarea').evaluateAll((els) => els.filter((e) => !e.closest('.diff-view')).map((e) => e.value));

test.describe('a revision that rewrites Goals Analyzed', () => {
  test('the change reaches the proposal and Accept applies it to the grid', async ({ page }) => {
    await drafted(page, (route) => route.fulfill(reply(supNote({ goalsAnalyzed: REVISED_ROWS }))));

    await page.locator('.revision-input').fill('Prompting faded to a model prompt, and add Tolerate Transitions as a goal');
    await page.locator('.revision-send').click();

    await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.diff-view').first()).toContainText(/Tolerate Transitions/);
    // Nothing is applied until Accept.
    expect(await goalCells(page)).not.toContain(REVISED_ROWS[2].goal);

    await page.locator('.diff-accept').first().click();
    await expect(page.locator('.diff-view')).toHaveCount(0);
    const cells = await goalCells(page);
    expect(cells).toContain('Tolerate Transitions');
    expect(cells).toContain(REVISED_ROWS[0].progress);
  });

  test('a row dropped by the reply is dropped from the grid on Accept', async ({ page }) => {
    await drafted(page, (route) => route.fulfill(reply(supNote({ goalsAnalyzed: [DRAFT_ROWS[0]] }))));

    await page.locator('.revision-input').fill('Remove Request a Turn, it was not run today');
    await page.locator('.revision-send').click();
    await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 20000 });

    await page.locator('.diff-accept').first().click();
    const cells = await goalCells(page);
    expect(cells).toContain('Wait Before Responding');
    expect(cells).not.toContain('Request a Turn');
  });

  test('a one-cell wording change still raises a proposal', async ({ page }) => {
    const rows = [DRAFT_ROWS[0], { ...DRAFT_ROWS[1], nextSteps: 'Hold at the current level until errors drop.' }];
    await drafted(page, (route) => route.fulfill(reply(supNote({ goalsAnalyzed: rows }))));

    await page.locator('.revision-input').fill('Request a Turn next steps: hold at the current level');
    await page.locator('.revision-send').click();
    await expect(page.locator('.diff-view').first()).toBeVisible({ timeout: 20000 });
    await page.locator('.diff-accept').first().click();
    expect(await goalCells(page)).toContain('Hold at the current level until errors drop.');
  });
});
