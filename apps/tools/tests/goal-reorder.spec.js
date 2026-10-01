import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* Drag and drop for Goals Analyzed rows. A row has a handle; dragging it with a
 * pointer or moving it with the keyboard reorders the grid, and the drop teaches
 * the order of the CATEGORIES (reduction and safety, communication, play,
 * other), which is all that is stored in localStorage. Every model reply is
 * canned; names are invented. */

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['sup'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const row = (goal) => ({ goal, progress: `${goal} progress.`, nextSteps: 'Continue.' });
const note = (rows) => ({
  sessionChecks: [], goalsAnalyzed: rows, overallProgress: '', progress: 'Progress text. '.repeat(30), programming: 'Programming text. '.repeat(30),
  behavior: 'Behavior text. '.repeat(30), feedback: 'Feedback text. '.repeat(30), reviewedNotes: 'No', followup: 'Follow up. '.repeat(20), hints: [],
});

const NOTES = [
  '- Elopement (behavior targeted for reduction): 0 occurrences',
  '- Mand for help goal: 2 of 5',
  '- Play with a peer goal: 3 of 5',
  '- Sort colors goal: 1 of 5',
  '- Tact objects goal: 4 of 5',
  '- Zip a coat goal: 2 of 5',
].join('\n');
const DRAFT = ['Elopement', 'Mand for help', 'Play with a peer', 'Sort colors', 'Tact objects', 'Zip a coat'];
const KEY = 'nome_goal_category_order_v1';

// Tall enough that all six rows are on screen, so a mouse can reach any of them.
test.use({ viewport: { width: 1280, height: 1800 } });

async function open(page, { stored = null, rows = DRAFT, reduced = false } = {}) {
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    const text = JSON.stringify(b.messages || []);
    if (text.includes('GOAL UPDATE')) {
      const tail = text.split('using the goal name verbatim:').pop().split('. Write')[0];
      const asked = [...tail.matchAll(/\\"([^"\\]+)\\"/g)].map((m) => m[1]).filter((n) => n !== 'hints');
      return route.fulfill(reply(note(asked.map((n) => row(n)))));
    }
    return route.fulfill(reply(note(rows.map(row))));
  });
  await page.goto('/notes/sup/');
  await page.evaluate(([t, k, v]) => {
    localStorage.setItem('notes_auth_token', t);
    if (v) localStorage.setItem(k, v); else localStorage.removeItem(k);
  }, [tokenFor(), KEY, stored]);
  await page.goto('/notes/sup/');
  await page.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('textbox', { name: /Session Notes/i }).fill(NOTES);
  await page.getByRole('button', { name: 'Generate Note' }).click();
  const ack = page.locator('#notes-ack-go');
  if (await ack.isVisible({ timeout: 5000 }).catch(() => false)) {
    await page.locator('#notes-ack-cb').check();
    await ack.click();
  }
  const rev = page.locator('#notes-scrub-go');
  if (await rev.isVisible({ timeout: 1500 }).catch(() => false)) await rev.click();
  await expect(page.locator('[data-goal-row]').first()).toBeVisible({ timeout: 30000 });
}

const goalCells = async (page) => {
  const all = await page.$$eval('[data-goal-row]', (els) => els.map((e) => e.querySelector('textarea').value));
  return all;
};
const handle = (page, i) => page.locator('[data-goal-handle]').nth(i);
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);

async function drag(page, from, to, { after = false } = {}) {
  await page.locator('[data-goal-row]').first().evaluate((e) => e.scrollIntoView({ block: 'start' }));
  const a = await handle(page, from).boundingBox();
  const target = await page.locator('[data-goal-row]').nth(to).boundingBox();
  const y = target.y + (after ? target.height - 4 : 4);
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, (a.y + y) / 2, { steps: 6 });
  await page.mouse.move(a.x + a.width / 2, y, { steps: 8 });
  await page.mouse.up();
}

test.describe('goal rows: pointer drag', () => {
  test('every row has a handle with an accessible name', async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-goal-handle]')).toHaveCount(6);
    await expect(handle(page, 1)).toHaveAttribute('aria-label', /Move .*Mand for help/);
  });

  test('dragging a row down moves it, and the other rows keep their order', async ({ page }) => {
    await open(page);
    expect(await goalCells(page)).toEqual(DRAFT);
    await drag(page, 1, 3, { after: true });
    expect(await goalCells(page)).toEqual(['Elopement', 'Play with a peer', 'Sort colors', 'Mand for help', 'Tact objects', 'Zip a coat']);
  });

  test('a drop beside another category learns the order of the categories, and stores nothing else', async ({ page }) => {
    await open(page);
    // Play with a peer (play) dropped above Mand for help (communication).
    await drag(page, 2, 1);
    expect(await goalCells(page)).toEqual(['Elopement', 'Play with a peer', 'Mand for help', 'Sort colors', 'Tact objects', 'Zip a coat']);
    const s = await stored(page);
    expect(JSON.parse(s)).toEqual(['reduction', 'play', 'communication', 'other']);
    for (const name of DRAFT) expect(s).not.toContain(name);
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => /order/i.test(k)));
    expect(keys).toEqual([KEY]);
  });

  test('a drop among its own category teaches nothing', async ({ page }) => {
    await open(page);
    // Zip a coat and Sort colors are both in the other category.
    await drag(page, 5, 3);
    expect(await goalCells(page)).toEqual(['Elopement', 'Mand for help', 'Play with a peer', 'Zip a coat', 'Sort colors', 'Tact objects']);
    expect(await stored(page)).toBeNull();
  });

  test('the learned order is kept on the next load and applied to the next draft', async ({ page }) => {
    await open(page, { stored: JSON.stringify(['reduction', 'play', 'communication', 'other']) });
    expect(await goalCells(page)).toEqual(['Elopement', 'Play with a peer', 'Mand for help', 'Tact objects', 'Sort colors', 'Zip a coat']);
  });
});

test.describe('goal rows: keyboard', () => {
  test('space picks a row up, arrows move it, space drops it, and the move is announced', async ({ page }) => {
    await open(page);
    const live = page.locator('[data-goal-order-say]');
    await expect(live).toHaveAttribute('aria-live', 'polite');
    await handle(page, 2).focus();
    await page.keyboard.press('Space');
    await expect(live).toContainText(/Picked up .*Play with a peer.*position 3 of 6/);
    await page.keyboard.press('ArrowUp');
    await expect(live).toContainText(/Play with a peer.*position 2 of 6/);
    expect(await goalCells(page)).toEqual(['Elopement', 'Play with a peer', 'Mand for help', 'Sort colors', 'Tact objects', 'Zip a coat']);
    await expect(handle(page, 1)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(live).toContainText(/Dropped .*Play with a peer.*position 2 of 6/);
    expect(JSON.parse(await stored(page))).toEqual(['reduction', 'play', 'communication', 'other']);
  });

  test('escape puts the row back and learns nothing', async ({ page }) => {
    await open(page);
    await handle(page, 2).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Escape');
    expect(await goalCells(page)).toEqual(DRAFT);
    expect(await stored(page)).toBeNull();
    await expect(page.locator('[data-goal-order-say]')).toContainText(/Cancelled/);
  });

  test('arrows do nothing until a row is picked up', async ({ page }) => {
    await open(page);
    await handle(page, 2).focus();
    await page.keyboard.press('ArrowUp');
    expect(await goalCells(page)).toEqual(DRAFT);
  });
});

test.describe('goal rows: reset order', () => {
  test('the button shows only once an order is learned, and puts the default back', async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-goal-order-reset]')).toHaveCount(0);
    await drag(page, 2, 1);
    await expect(page.locator('[data-goal-order-reset]')).toBeVisible();
    await page.locator('[data-goal-order-reset]').click();
    expect(await stored(page)).toBeNull();
    // The default categories again: reduction, communication, play, other.
    expect(await goalCells(page)).toEqual(['Elopement', 'Mand for help', 'Tact objects', 'Play with a peer', 'Sort colors', 'Zip a coat']);
    await expect(page.locator('[data-goal-order-reset]')).toHaveCount(0);
  });
});

test.describe('goal rows: a swap keeps the learned order', () => {
  test('a row that comes back through the chips lands where its category belongs', async ({ page }) => {
    await open(page, { stored: JSON.stringify(['reduction', 'play', 'communication', 'other']) });
    await page.locator('[data-goal-chip="Play with a peer"] input').uncheck();
    await expect.poll(() => goalCells(page), { timeout: 20000 }).not.toContain('Play with a peer');
    await page.locator('[data-goal-chip="Play with a peer"] input').check();
    await expect.poll(() => goalCells(page), { timeout: 20000 }).toContain('Play with a peer');
    const cells = await goalCells(page);
    expect(cells.indexOf('Play with a peer')).toBeLessThan(cells.indexOf('Mand for help'));
  });
});

test.describe('goal rows: motion', () => {
  test('the dragged row has no transition under reduced motion', async ({ page }) => {
    await open(page, { reduced: true });
    const t = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'gs-dragging';
      document.body.appendChild(el);
      const v = getComputedStyle(el).transitionDuration;
      el.remove();
      return v;
    });
    expect(t.split(',').every((d) => parseFloat(d) === 0)).toBe(true);
  });
});
