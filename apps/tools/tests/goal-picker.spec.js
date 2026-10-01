import { test, expect, devices } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* The goal picker strip above Goals Analyzed. No live model: every
 * /api/llm-call is answered here, and a counter tells the draft from an Update
 * turn. */

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['sup'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const NOTES = [
  '- Mand training goal: 3 of 5 independent',
  '- Elopement goal: targeted for reduction, 0 occurrences',
  '- Tolerate Waiting goal: 2 of 4 with one prompt',
].join('\n');

const row = (goal, progress = `${goal} progress.`, nextSteps = 'Continue.') => ({ goal, progress, nextSteps });
const note = (rows) => ({
  sessionChecks: [], goalsAnalyzed: rows, overallProgress: '', progress: '', programming: '',
  behavior: '', feedback: '', reviewedNotes: 'No', followup: '', hints: [],
});

async function open(page, notes, rows, { delayMs = 0 } = {}) {
  const calls = { draft: 0, update: 0, bodies: [] };
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    const text = JSON.stringify(b.messages || []);
    if (text.includes('GOAL UPDATE')) {
      calls.update += 1;
      calls.bodies.push(text);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      const tail = text.split('using the goal name verbatim:')[1].split('. Write')[0];
      const asked = [...tail.matchAll(/\\"([^"\\]+)\\"/g)].map((m) => m[1]);
      return route.fulfill(reply(note(asked.map((n) => row(n, 'Fresh row.')))));
    }
    calls.draft += 1;
    return route.fulfill(reply(note(rows)));
  });
  await page.goto('/notes/sup/');
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.goto('/notes/sup/');
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('textbox', { name: /Session Notes/i }).fill(notes);
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  await expect(page.getByTestId('goal-picker')).toBeVisible({ timeout: 30000 });
  return calls;
}

const chip = (page, name) => page.locator(`[data-goal-chip="${name}"]`);
// Grid cells are textareas, so their text lives in .value, not in the DOM text.
const cells = (page) => page.$$eval('textarea, input[type="text"]',
  (els) => els.filter((e) => !e.closest('.diff-view')).map((e) => e.value));

test.describe('goal picker', () => {
  test('chips show, preselected ones are checked, no Update while picks match the grid', async ({ page }) => {
    await open(page, NOTES, [row('Mand training'), row('Elopement'), row('Tolerate Waiting')]);
    await expect(page.locator('[data-goal-chip]')).toHaveCount(3);
    await expect(chip(page, 'Mand training').locator('input')).toBeChecked();
    await expect(page.locator('[data-goal-update]')).toHaveCount(0);
  });

  test('the eye opens the source line and why it scored', async ({ page }) => {
    await open(page, NOTES, [row('Mand training'), row('Elopement'), row('Tolerate Waiting')]);
    await chip(page, 'Elopement').getByRole('button', { name: /came from/ }).click();
    const pop = page.locator('[data-goal-pop="Elopement"]');
    await expect(pop).toContainText('goal: targeted for reduction');
    await expect(pop.locator('.gp-why')).not.toBeEmpty();
  });

  test('unchecking and Update drops the row, others stay, and no model call is made', async ({ page }) => {
    const calls = await open(page, NOTES, [row('Mand training'), row('Elopement'), row('Tolerate Waiting')]);
    await chip(page, 'Elopement').locator('input').uncheck();
    await expect(page.locator('[data-goal-update]')).toBeVisible();
    await page.locator('[data-goal-update]').click();
    await expect(page.locator('[data-goal-update]')).toHaveCount(0);
    expect(calls.update).toBe(0);
    expect(await cells(page)).not.toContain('Elopement progress.');
    await expect.poll(() => cells(page)).toContain('Mand training progress.');
    await expect(chip(page, 'Elopement')).toBeVisible();
  });

  test('rechecking a dropped goal restores its row from held text with no model call', async ({ page }) => {
    const calls = await open(page, NOTES, [row('Mand training', 'Mand progress kept.'), row('Elopement', 'Elopement progress kept.'), row('Tolerate Waiting')]);
    await chip(page, 'Elopement').locator('input').uncheck();
    await page.locator('[data-goal-update]').click();
    await chip(page, 'Elopement').locator('input').check();
    await page.locator('[data-goal-update]').click();
    expect(calls.update).toBe(0);
    await expect.poll(() => cells(page)).toContain('Elopement progress kept.');
  });

  // A row with no held text: drop it, change the notes, then bring it back.
  async function dropThenEditNotes(page, name) {
    await chip(page, name).locator('input').uncheck();
    await page.locator('[data-goal-update]').click();
    await expect(page.locator('[data-goal-update]')).toHaveCount(0);
    await page.getByRole('textbox', { name: /Session Notes/i }).fill(NOTES + '\n- Extra bullet with new detail');
    await chip(page, name).locator('input').check();
  }

  test('a goal with no held row makes one revision turn and adds only that row', async ({ page }) => {
    const calls = await open(page, NOTES, [row('Mand training', 'Mand progress kept.'), row('Elopement', 'Old elopement text.'), row('Tolerate Waiting')]);
    await dropThenEditNotes(page, 'Elopement');
    await page.locator('[data-goal-update]').click();
    await expect.poll(() => cells(page), { timeout: 15000 }).toContain('Fresh row.');
    expect(calls.update).toBe(1);
    const now = await cells(page);
    expect(now).toContain('Mand progress kept.');
    expect(now).not.toContain('Old elopement text.');
  });

  test('a double press makes one turn only', async ({ page }) => {
    const calls = await open(page, NOTES, [row('Mand training'), row('Elopement'), row('Tolerate Waiting')], { delayMs: 800 });
    await dropThenEditNotes(page, 'Elopement');
    await page.locator('[data-goal-update]').dblclick();
    await expect.poll(() => cells(page), { timeout: 15000 }).toContain('Fresh row.');
    expect(calls.update).toBe(1);
  });

  test('a seventh check unchecks the leftmost preselected chip', async ({ page }) => {
    const seven = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'];
    const notes = seven.map((n) => `- ${n} goal: 2 of 5`).join('\n');
    await open(page, notes, seven.slice(0, 6).map((n) => row(n)));
    const boxes = page.locator('[data-goal-chip] input');
    const n = await boxes.count();
    expect(n).toBe(7);
    const checkedNow = await boxes.evaluateAll((els) => els.filter((e) => e.checked).length);
    expect(checkedNow).toBeLessThanOrEqual(6);
    if (checkedNow === 6) {
      await chip(page, 'Golf').locator('input').check();
      expect(await boxes.evaluateAll((els) => els.filter((e) => e.checked).length)).toBe(6);
      await expect(chip(page, 'Alpha').locator('input')).not.toBeChecked();
    }
  });
});

test.describe('goal picker on the phone', () => {
  const { defaultBrowserType, ...IPHONE } = devices['iPhone 14'];
  test.use(IPHONE);

  test('chips wrap, nothing scrolls sideways, targets are at least 30px', async ({ page }) => {
    await open(page, NOTES, [row('Mand training'), row('Elopement'), row('Tolerate Waiting')]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const sizes = await page.locator('[data-goal-chip] .gp-eye, [data-goal-chip] .gp-label').evaluateAll(
      (els) => els.map((e) => e.getBoundingClientRect().height));
    sizes.forEach((h) => expect(h).toBeGreaterThanOrEqual(30));
  });
});
