import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* A GOAL NAME THE INTAKE NEVER NAMED IS FLAGGED, NEVER PASSED.
 *
 * Approved 2 Oct 2026, from the diagnosis of one bad production Supervision
 * note whose Goals Analyzed table carried goal names the BCBA never wrote.
 * Nothing checked goalsAnalyzed against the input: normalizeOutput dropped a
 * row only when all three of its fields were empty.
 *
 * The check compares each goal name with the intake, after folding case,
 * whitespace and punctuation, and it counts a name that matches through the
 * scrub's tokens (a word restored from [[Tn]], or a role token the intake
 * carried in the same place). A name with no match is drawn with a notice on
 * its row for the clinician to correct or confirm. The page never rewrites it.
 */

function tokenFor(tools = ['sup']) {
  const payload = { role: 'user', kid: 'pw:bcba-1', tools, exp: Math.floor(Date.now() / 1000) + 3600 };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.local-test`;
}

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const supNote = (goals) => ({
  sessionChecks: [], goalsAnalyzed: goals, overallProgress: '',
  progress: 'The Behavior Analyst reviewed the session data.',
  programming: 'No modifications were made this session.',
  behavior: '', feedback: 'No technician was present.', reviewedNotes: 'No', followup: '', hints: [],
});

const INTAKE = [
  '- Kite Puzzle matching: 3 of 5 independent, up from 1 of 5',
  '- Waiting for a turn: 2 of 4 opportunities with a visual timer',
  '- greeting peers with Jacob at arrival: 1 of 3',
].join('\n');

/* `goals(wire)` builds the rows from what the page actually sent, so a test
   can hand back the very token the intake went out as. */
async function draft(page, goals) {
  const seen = { notes: [] };
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    const wire = (b.messages || []).map((m) => String(m.content || '')).join('\n');
    seen.notes.push(wire);
    return route.fulfill(reply(supNote(goals(wire))));
  });
  await page.goto('/notes/bcba/index.html?tool=sup');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.reload();
  await page.getByRole('textbox', { name: /Session Notes \/ Clinical Observations/i }).fill(INTAKE);
  await page.getByRole('button', { name: 'No, Behavior Analyst only' }).click();
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const review = page.locator('#notes-scrub-go');
  if (await review.isVisible({ timeout: 1200 }).catch(() => false)) await review.click();
  await expect(page.getByTestId('generated-note')).toBeVisible({ timeout: 30000 });
  return seen;
}

const goalCell = (page, ri) => page.locator(`[data-goal-row="${ri}"] textarea`).first();

const opaque = (wire) => (wire.match(/\[\[T\d+\]\]/) || [''])[0];
const clientToken = (wire) => (wire.match(/\[CLIENT[^\]]*\]/) || [''])[0];

test.describe('the match itself', () => {
  test('folds case, whitespace and punctuation, and reads the name as a run of whole words', async ({ page }) => {
    await page.goto('/notes/bcba/index.html?tool=sup');
    const r = await page.evaluate(() => {
      const G = window.GoalNames;
      const intake = ['- 3-step motor imitation: initiating before the SD', 'FCT "my turn" with peers: 2 of 4'];
      return {
        norm: G.normalise('  3-Step   Motor Imitation! '),
        exact: G.unmatched(['3-step motor imitation'], intake),
        folded: G.unmatched(['Motor  Imitation', 'FCT: My Turn'], intake),
        invented: G.unmatched(['Shape sorting', 'motor imitation', 'Turn'], intake),
        partWord: G.unmatched(['otor imit'], intake),
        empty: G.unmatched(['', '   '], intake),
      };
    });
    expect(r.norm).toBe('3 step motor imitation');
    expect(r.exact).toEqual([]);
    expect(r.folded).toEqual([]);
    expect(r.invented).toEqual([0]);
    expect(r.partWord).toEqual([0]);
    // A blank name is not a name to check.
    expect(r.empty).toEqual([]);
  });
});

test.describe('on the note', () => {
  test('a goal name the intake never named is flagged on its row, and the others are not', async ({ page }) => {
    await draft(page, () => [
      { goal: 'Kite Puzzle matching', progress: '3 of 5 independent.', nextSteps: 'Continue.' },
      { goal: 'Waiting for a turn', progress: '2 of 4.', nextSteps: 'Continue.' },
      { goal: 'Shape sorting', progress: '4 of 5.', nextSteps: 'Continue.' },
    ]);
    await expect(page.locator('[data-goal-unmatched="2"]')).toBeVisible();
    await expect(page.locator('[data-goal-unmatched="2"]')).toContainText(/not in your notes/i);
    await expect(page.locator('[data-goal-unmatched]')).toHaveCount(1);
    // Flagged, never rewritten.
    await expect(goalCell(page, 2)).toHaveValue('Shape sorting');
  });

  test('confirming keeps the name as written and takes the flag away', async ({ page }) => {
    await draft(page, () => [
      { goal: 'Shape sorting', progress: '4 of 5.', nextSteps: 'Continue.' },
    ]);
    await expect(page.locator('[data-goal-unmatched="0"]')).toBeVisible();
    await page.locator('[data-goal-confirm="0"]').click();
    await expect(page.locator('[data-goal-unmatched]')).toHaveCount(0);
    await expect(goalCell(page, 0)).toHaveValue('Shape sorting');
  });

  test('correcting the name to one the intake has takes the flag away, and a wrong correction keeps it', async ({ page }) => {
    await draft(page, () => [
      { goal: 'Shape sorting', progress: '4 of 5.', nextSteps: 'Continue.' },
    ]);
    await goalCell(page, 0).fill('Block stacking');
    await expect(page.locator('[data-goal-unmatched="0"]')).toBeVisible();
    await goalCell(page, 0).fill('Waiting for a turn');
    await expect(page.locator('[data-goal-unmatched]')).toHaveCount(0);
  });

  test('a name that matches through the scrub tokens is not flagged', async ({ page }) => {
    const seen = await draft(page, (wire) => [
      // The program title went out as an opaque token and comes back restored.
      { goal: `${opaque(wire)} matching`, progress: '3 of 5.', nextSteps: 'Continue.' },
      // The name in the intake went out as a role token, which never restores.
      { goal: `greeting peers with ${clientToken(wire)}`, progress: '1 of 3.', nextSteps: 'Continue.' },
    ]);
    expect(opaque(seen.notes[0]), 'the intake sent the program title as a token').not.toBe('');
    expect(clientToken(seen.notes[0]), 'the intake sent the name as a role token').not.toBe('');
    await expect(goalCell(page, 0)).toHaveValue('Kite Puzzle matching');
    await expect(page.locator('[data-goal-unmatched]')).toHaveCount(0);
  });

  test('a new draft forgets what was confirmed on the last one', async ({ page }) => {
    await draft(page, () => [
      { goal: 'Shape sorting', progress: '4 of 5.', nextSteps: 'Continue.' },
    ]);
    await page.locator('[data-goal-confirm="0"]').click();
    await expect(page.locator('[data-goal-unmatched]')).toHaveCount(0);
    // After the first Generate the button reads Regenerate (#228), and that is
    // the new process this test is about.
    await page.getByRole('button', { name: /^Regenerate$/ }).first().click();
    const review = page.locator('#notes-scrub-go');
    if (await review.isVisible({ timeout: 1200 }).catch(() => false)) await review.click();
    await expect(page.locator('[data-goal-unmatched="0"]')).toBeVisible({ timeout: 30000 });
  });
});
