import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The repeat check is wired as a hint source. A drafted note that states the
 * same fact in two narrative sections gets an ambiguous_item hint on the later
 * section, and the note text itself is untouched. No live model: every
 * /api/llm-call is answered here. */

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['sup'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const SAME_FACT_A = 'The caregiver practiced the delay procedure and was coached on delivering the reinforcer right away.';
const SAME_FACT_B = 'Caregiver practiced the delay procedure, was coached on delivering the reinforcer right away.';

const note = (o) => ({
  sessionChecks: [], goalsAnalyzed: [], overallProgress: '', programming: 'No protocol changes were made.',
  behavior: '', reviewedNotes: 'No', followup: '', hints: [], ...o,
});

async function draft(page, output) {
  await page.route('**/api/llm-call**', (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    return route.fulfill(reply(output));
  });
  await page.goto('/notes/sup/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto('/notes/sup/');
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('textbox', { name: /Session Notes/i }).fill('- Delay procedure practiced with caregiver');
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  await expect(page.getByText('Feedback Notes', { exact: true }).first()).toBeVisible({ timeout: 30000 });
}

test.describe('sup repeat check as a hint source', () => {
  test('the same fact in Progress and Feedback Notes hints on Feedback Notes only', async ({ page }) => {
    await draft(page, note({ progress: SAME_FACT_A, feedback: SAME_FACT_B }));
    const hint = page.getByTestId('hints-feedback');
    await expect(hint).toBeVisible({ timeout: 20000 });
    await expect(hint).toContainText('Repeats Summary of Progress and Findings');
    await expect(page.getByTestId('hints-progress')).toHaveCount(0);
    // Hint only: the text of both sections is left as drafted.
    await expect(page.locator('textarea').filter({ hasText: 'Caregiver practiced the delay procedure' }).first()).toBeVisible();
  });

  test('a note with no repeat gets no repeat hint', async ({ page }) => {
    await draft(page, note({ progress: 'Mand for help improved with fewer prompts.', feedback: SAME_FACT_B }));
    await expect(page.getByText('Feedback Notes', { exact: true }).first()).toBeVisible();
    await expect(page.getByTestId('hints-feedback')).toHaveCount(0);
  });
});
