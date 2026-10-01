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

async function open(page, notes, rows, { delayMs = 0, noPicker = false } = {}) {
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
  if (!noPicker) await expect(page.getByTestId('goal-picker')).toBeVisible({ timeout: 30000 });
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

test.describe('goal picker: review defects', () => {
  test('HIGH 1: notes edited before the drop never get the old row text back', async ({ page }) => {
    const calls = await open(page, NOTES, [row('Mand training'), row('Elopement', 'Written from old notes.'), row('Tolerate Waiting')]);
    await page.getByRole('textbox', { name: /Session Notes/i }).fill(NOTES + '\n- Extra bullet with new detail');
    await chip(page, 'Elopement').locator('input').uncheck();
    await page.locator('[data-goal-update]').click();
    await expect(page.locator('[data-goal-update]')).toHaveCount(0);
    await chip(page, 'Elopement').locator('input').check();
    await page.locator('[data-goal-update]').click();
    await expect.poll(() => cells(page), { timeout: 15000 }).toContain('Fresh row.');
    expect(calls.update).toBe(1);
    expect(await cells(page)).not.toContain('Written from old notes.');
  });

  test('six is the master cap: five skills and a reduction target are checked, a sixth skill is not', async ({ page }) => {
    const skills = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
    const notes = skills.map((n) => `- ${n} goal: 2 of 5`).join('\n')
      + '\n- Elopement goal: targeted for reduction, 0 occurrences';
    await open(page, notes, [...skills.slice(0, 5).map((n) => row(n)), row('Elopement', 'No occurrences of elopement today.')]);
    await expect(page.locator('[data-goal-chip] input:checked')).toHaveCount(6);
    await expect(chip(page, 'Elopement').locator('input')).toBeChecked();
    await expect(chip(page, 'Foxtrot').locator('input')).not.toBeChecked();
    await expect(page.locator('[data-goal-count]')).toHaveText('6 of 6');
    await expect(page.locator('[data-goal-update]')).toHaveCount(0);
  });

  test('HIGH 4: a scoring error cannot lose the draft', async ({ page }) => {
    await page.addInitScript(() => {
      let held;
      Object.defineProperty(window, 'GoalCandidates', {
        configurable: true,
        get: () => held,
        set: (v) => { held = { ...v, score: () => { throw new Error('boom'); } }; },
      });
    });
    await open(page, NOTES, [row('Mand training', 'Kept draft.'), row('Elopement'), row('Tolerate Waiting')], { noPicker: true });
    await expect.poll(() => cells(page), { timeout: 15000 }).toContain('Kept draft.');
    await expect(page.getByTestId('goal-picker')).toHaveCount(0);
  });
});

test.describe('goal picker: popover defects', () => {
  const MASKED_NOTES = [
    '- Mand training goal: 3 of 5 independent, Request Attn each time',
    '- Elopement goal: targeted for reduction, 0 occurrences',
    '- Tolerate Waiting goal: 2 of 4 with one prompt',
  ].join('\n');

  test('MED 6: the popover shows the words, never a token', async ({ page }) => {
    await open(page, MASKED_NOTES, [row('Mand training'), row('Elopement'), row('Tolerate Waiting')]);
    await chip(page, 'Mand training').getByRole('button', { name: /came from/ }).click();
    const pop = page.locator('[data-goal-pop="Mand training"]');
    await expect(pop).toContainText('Request Attn');
    await expect(pop).not.toContainText('[[T');
  });

  test('MED 8: Escape and a click elsewhere both close the popover', async ({ page }) => {
    await open(page, NOTES, [row('Mand training'), row('Elopement'), row('Tolerate Waiting')]);
    const eye = chip(page, 'Elopement').getByRole('button', { name: /came from/ });
    await eye.click();
    await expect(page.locator('[data-goal-pop]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-goal-pop]')).toHaveCount(0);
    await expect(eye).toBeFocused();
    await eye.click();
    await expect(page.locator('[data-goal-pop]')).toHaveCount(1);
    await page.locator('h1, header, body').first().click({ position: { x: 2, y: 2 }, force: true });
    await expect(page.locator('[data-goal-pop]')).toHaveCount(0);
  });

  test.describe('at 375px', () => {
    test.use({ viewport: { width: 375, height: 700 } });
    test('MED 8: the popover stays inside the strip and the page', async ({ page }) => {
      await open(page, NOTES, [row('Mand training'), row('Elopement'), row('Tolerate Waiting')]);
      for (const name of ['Mand training', 'Tolerate Waiting']) {
        await chip(page, name).getByRole('button', { name: /came from/ }).click();
        const pop = page.locator('[data-goal-pop]');
        const p = await pop.boundingBox();
        const s = await page.getByTestId('goal-picker').boundingBox();
        expect(p.x).toBeGreaterThanOrEqual(s.x - 1);
        expect(p.x + p.width).toBeLessThanOrEqual(s.x + s.width + 1);
        await page.keyboard.press('Escape');
      }
    });
  });
});

test.describe('goal picker: reworded rows (second review MED 3)', () => {
  test('a row the model reworded still counts as present, so no Update is offered', async ({ page }) => {
    await open(page, NOTES, [row('Mand training'), row('Elopement (reduction)'), row('Tolerate Waiting goal')]);
    await expect(page.locator('[data-goal-update]')).toHaveCount(0);
  });

  test('a longer word that merely contains the name is not the same row', async ({ page }) => {
    await open(page, '- Mand goal: 3 of 5 independent\n- Elopement goal: targeted for reduction, 0 occurrences',
      [row('Demand'), row('Elopement')]);
    await expect(page.locator('[data-goal-update]')).toBeVisible();
  });
});

test.describe('goal picker: popover anchors to its chip (second review LOW-MED 5)', () => {
  test.describe('desktop', () => {
    test.use({ viewport: { width: 1280, height: 800 } });
    test('the popover opens under the clicked chip, not at the strip edge', async ({ page }) => {
      await open(page, NOTES, [row('Mand training'), row('Elopement'), row('Tolerate Waiting')]);
      await chip(page, 'Tolerate Waiting').getByRole('button', { name: /came from/ }).click();
      const c = await chip(page, 'Tolerate Waiting').boundingBox();
      const p = await page.locator('[data-goal-pop]').boundingBox();
      expect(Math.abs(p.x - c.x)).toBeLessThanOrEqual(2);
      expect(p.y).toBeGreaterThanOrEqual(c.y + c.height);
      expect(p.y).toBeLessThanOrEqual(c.y + c.height + 12);
    });
  });

  test.describe('at 375px with wrapped rows', () => {
    test.use({ viewport: { width: 375, height: 800 } });
    test('the popover sits directly under the clicked chip row and stays inside the strip', async ({ page }) => {
      const names = ['Alpha Skill', 'Bravo Skill', 'Charlie Skill', 'Delta Skill', 'Echo Skill', 'Foxtrot Skill'];
      const notes = names.map((n) => `- ${n} goal: 2 of 5`).join('\n');
      await open(page, notes, names.map((n) => row(n)));
      const c = await chip(page, 'Alpha Skill').boundingBox();
      const s = await page.getByTestId('goal-picker').boundingBox();
      expect(s.height).toBeGreaterThan(c.height * 2);
      await chip(page, 'Alpha Skill').getByRole('button', { name: /came from/ }).click();
      const p = await page.locator('[data-goal-pop]').boundingBox();
      const c2 = await chip(page, 'Alpha Skill').boundingBox();
      expect(p.y).toBeGreaterThanOrEqual(c2.y + c2.height);
      expect(p.y).toBeLessThanOrEqual(c2.y + c2.height + 12);
      expect(p.x).toBeGreaterThanOrEqual(s.x - 1);
      expect(p.x + p.width).toBeLessThanOrEqual(s.x + s.width + 1);
      await page.keyboard.press('Escape');
      const last = chip(page, 'Foxtrot Skill');
      await last.getByRole('button', { name: /came from/ }).click();
      const l = await last.boundingBox();
      const q = await page.locator('[data-goal-pop]').boundingBox();
      expect(q.y).toBeGreaterThanOrEqual(l.y + l.height);
      expect(q.y).toBeLessThanOrEqual(l.y + l.height + 12);
      expect(q.x + q.width).toBeLessThanOrEqual(s.x + s.width + 1);
    });
  });
});
