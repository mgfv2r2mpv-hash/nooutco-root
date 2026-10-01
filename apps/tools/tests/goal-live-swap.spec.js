import { test, expect } from '@playwright/test';
import { isTriageCall } from './helpers/llm-call.js';

/* Live goal swaps. Toggling a goal chip applies by itself: a pause of about
 * 1200ms after the last toggle, then one revision turn for the net change. A
 * held row comes back at once with no model call. While a turn is in flight the
 * chips show it in place, a toggle in that window queues one follow-up, and a
 * failure puts the chips back to what the table shows and says so in the thread.
 * Every model reply is canned here; nothing calls a live model. Names are
 * invented. */

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['sup'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const reply = (obj) => ({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { output_tokens: 100 }, stop_reason: 'end_turn' }),
});

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
const NOTES = NAMES.map((n) => `- ${n} goal: 2 of 5`).join('\n');

const row = (goal, progress = `${goal} progress.`, nextSteps = 'Continue.') => ({ goal, progress, nextSteps });
const note = (rows) => ({
  sessionChecks: [], goalsAnalyzed: rows, overallProgress: '', progress: 'Progress text. '.repeat(30), programming: 'Programming text. '.repeat(30),
  behavior: 'Behavior text. '.repeat(30), feedback: 'Feedback text. '.repeat(30), reviewedNotes: 'No', followup: 'Follow up. '.repeat(20), hints: [],
});

/* The draft returns rows for the first three names only, so Delta and Echo are
 * candidates whose rows are not in the table yet. */
async function open(page, { delayMs = 0, failUpdate = false, notes = NOTES, rows = NAMES.slice(0, 3).map((n) => row(n)) } = {}) {
  const calls = { draft: 0, update: 0, asked: [], active: 0, maxActive: 0 };
  await page.route('**/api/llm-call**', async (route) => {
    const b = JSON.parse(route.request().postData() || '{}');
    if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
    const text = JSON.stringify(b.messages || []);
    if (text.includes('GOAL UPDATE')) {
      calls.update += 1;
      calls.active += 1;
      calls.maxActive = Math.max(calls.maxActive, calls.active);
      const tail = text.split('using the goal name verbatim:').pop().split('. Write')[0];
      const asked = [...tail.matchAll(/\\"([^"\\]+)\\"/g)].map((m) => m[1]).filter((n) => n !== 'hints');
      calls.asked.push(asked);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      calls.active -= 1;
      if (failUpdate) return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'canned failure' }) });
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

const picker = (page) => page.getByTestId('goal-picker');
const chip = (page, name) => page.locator(`[data-goal-chip="${name}"]`);
const box = (page, name) => chip(page, name).locator('input');
const cells = (page) => page.$$eval('textarea, input[type="text"]',
  (els) => els.filter((e) => !e.closest('.diff-view')).map((e) => e.value));
const gridGoals = (page) => page.$$eval('[data-goal-key]', (els) => els.map((e) => e.getAttribute('data-goal-key')));
const idle = (page) => expect(picker(page)).toHaveAttribute('data-swap', 'idle', { timeout: 20000 });

test.describe('live goal swaps', () => {
  test('there is no Update goals button', async ({ page }) => {
    await open(page);
    await box(page, 'Alpha').uncheck();
    await expect(page.getByRole('button', { name: /update goals/i })).toHaveCount(0);
    await expect(page.locator('[data-goal-update]')).toHaveCount(0);
  });

  test('rapid toggles settle into one revision turn for the net change', async ({ page }) => {
    const calls = await open(page);
    // Alpha leaves, Delta and Echo come in, Bravo leaves and comes back.
    await box(page, 'Alpha').uncheck();
    await box(page, 'Delta').uncheck();
    await box(page, 'Delta').check();
    await box(page, 'Bravo').uncheck();
    await box(page, 'Bravo').check();
    await box(page, 'Echo').uncheck();
    await box(page, 'Echo').check();
    await expect(picker(page)).toHaveAttribute('data-swap', 'waiting');
    expect(calls.update).toBe(0);
    await expect.poll(() => cells(page), { timeout: 20000 }).toContain('Fresh row.');
    await idle(page);
    expect(calls.update).toBe(1);
    // Delta and Echo only: the masked names, two of them, and not Alpha or Bravo.
    expect(calls.asked[0]).toHaveLength(2);
    const goals = await cells(page);
    expect(goals).not.toContain('Alpha progress.');
    expect(goals).toContain('Bravo progress.');
    expect(goals).toContain('Charlie progress.');
  });

  test('unchanged rows stay byte-identical across a swap', async ({ page }) => {
    await open(page, { rows: [row('Alpha', 'Alpha text kept.\nWith a second line.'), row('Bravo'), row('Charlie')] });
    await box(page, 'Delta').uncheck();
    await box(page, 'Delta').check();
    await expect.poll(() => cells(page), { timeout: 20000 }).toContain('Fresh row.');
    expect(await cells(page)).toContain('Alpha text kept.\nWith a second line.');
  });

  test('a toggle that returns to the table state asks for nothing', async ({ page }) => {
    const calls = await open(page);
    await box(page, 'Alpha').uncheck();
    await box(page, 'Alpha').check();
    await expect(picker(page)).toHaveAttribute('data-swap', 'idle');
    await page.waitForTimeout(1800);
    expect(calls.update).toBe(0);
    expect(await cells(page)).toContain('Alpha progress.');
  });

  test('a held row comes back at once with no model call', async ({ page }) => {
    const calls = await open(page, { rows: [row('Alpha', 'Alpha text kept.'), row('Bravo'), row('Charlie')] });
    await box(page, 'Alpha').uncheck();
    await expect.poll(() => cells(page), { timeout: 20000 }).not.toContain('Alpha text kept.');
    await idle(page);
    await box(page, 'Alpha').check();
    await expect.poll(() => cells(page), { timeout: 700 }).toContain('Alpha text kept.');
    await idle(page);
    expect(calls.update).toBe(0);
  });

  test('a toggle while a turn is in flight queues one follow-up, never two at once', async ({ page }) => {
    const calls = await open(page, { delayMs: 1500 });
    await box(page, 'Delta').uncheck();
    await box(page, 'Delta').check();
    await expect(picker(page)).toHaveAttribute('data-swap', 'pending', { timeout: 10000 });
    await expect(chip(page, 'Delta')).toHaveAttribute('data-pending', 'true');
    await box(page, 'Echo').uncheck();
    await box(page, 'Echo').check();
    await expect.poll(() => cells(page), { timeout: 30000 }).toContain('Fresh row.');
    await expect.poll(() => calls.update, { timeout: 30000 }).toBe(2);
    await idle(page);
    expect(calls.update).toBe(2);
    expect(calls.maxActive).toBe(1);
    expect(calls.asked.map((a) => a.length)).toEqual([1, 1]);
    expect(calls.asked[0]).not.toEqual(calls.asked[1]);
    expect(await gridGoals(page)).toEqual(expect.arrayContaining(['alpha', 'bravo', 'charlie', 'delta', 'echo']));
  });

  test('the pending state sits in place and moves nothing', async ({ page }) => {
    await open(page, { delayMs: 1500 });
    const card = page.locator('[data-section-key="goalsAnalyzed"]');
    // Document coordinates, so the scroll the click itself causes does not count.
    const where = (el) => el.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { y: r.top + window.scrollY, h: r.height };
    });
    const before = await where(card);
    const stripBefore = await where(picker(page));
    await box(page, 'Delta').uncheck();
    await box(page, 'Delta').check();
    await expect(picker(page)).toHaveAttribute('data-swap', 'pending', { timeout: 10000 });
    const during = await where(card);
    const stripDuring = await where(picker(page));
    expect(Math.abs(during.h - before.h)).toBeLessThanOrEqual(1);
    expect(Math.abs(stripDuring.h - stripBefore.h)).toBeLessThanOrEqual(1);
    expect(Math.abs(during.y - before.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(stripDuring.y - stripBefore.y)).toBeLessThanOrEqual(1);
    await idle(page);
  });

  test('a failed turn puts the chips back to the table and says so in the thread', async ({ page }) => {
    await open(page, { failUpdate: true });
    await expect(box(page, 'Delta')).toBeChecked();
    await box(page, 'Delta').uncheck();
    await box(page, 'Delta').check();
    await box(page, 'Alpha').uncheck();
    await idle(page);
    // The table is as it was, and the chips match it again.
    expect(await cells(page)).toContain('Alpha progress.');
    expect(await cells(page)).not.toContain('Fresh row.');
    await expect(box(page, 'Alpha')).toBeChecked();
    await expect(box(page, 'Delta')).not.toBeChecked();
    const fab = page.locator('.revision-fab');
    if (await fab.isVisible().catch(() => false)) await fab.click();
    await expect(page.getByText(/goal swap failed/i).first()).toBeVisible();
  });

  test('a row the reply leaves out is unchecked and named, not retried forever', async ({ page }) => {
    const calls = await open(page);
    // The stub answers with rows for what was asked, so ask for a name the reply cannot carry back.
    await page.unroute('**/api/llm-call**');
    await page.route('**/api/llm-call**', async (route) => {
      const b = JSON.parse(route.request().postData() || '{}');
      if (isTriageCall(b)) return route.fulfill(reply({ sufficient: true, readiness: 95, questions: [] }));
      calls.update += 1;
      return route.fulfill(reply(note([])));
    });
    await box(page, 'Delta').uncheck();
    await box(page, 'Delta').check();
    await idle(page);
    await page.waitForTimeout(2500);
    expect(calls.update).toBe(1);
    await expect(box(page, 'Delta')).not.toBeChecked();
  });

  test('a seventh check names what the cap unchecked in the thread', async ({ page }) => {
    const seven = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf'];
    await open(page, { notes: seven.map((n) => `- ${n} goal: 2 of 5`).join('\n'), rows: seven.slice(0, 6).map((n) => row(n)) });
    await box(page, 'Golf').check();
    await expect(box(page, 'Alpha')).not.toBeChecked();
    const fab = page.locator('.revision-fab');
    if (await fab.isVisible().catch(() => false)) await fab.click();
    await expect(page.getByText(/six goals at most/i).first()).toBeVisible();
    await idle(page);
  });
});

test.describe('live goal swaps: the page does not jump', () => {
  // Two sections down, so no goal row is on screen while the section is parked near the top.
  const below = async (page) => {
    const key = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('[data-section-key]')];
      const at = cards.findIndex((c) => c.getAttribute('data-section-key') === 'goalsAnalyzed');
      const next = cards[at + 2];
      return next ? next.getAttribute('data-section-key') : null;
    });
    expect(key).toBeTruthy();
    return page.locator(`[data-section-key="${key}"]`);
  };
  const place = (el, top) => el.evaluate((e, y) => window.scrollBy(0, e.getBoundingClientRect().top - y), top);
  const top = (el) => el.evaluate((e) => e.getBoundingClientRect().top);

  test('removing a row above the viewport leaves the section below it where it was', async ({ page }) => {
    await open(page);
    const next = await below(page);
    await place(next, 160);
    // Click through the DOM so the page does not scroll back up to the strip.
    await page.evaluate(() => document.querySelector('[data-goal-chip="Alpha"] input').click());
    const was = await top(next);
    expect(Math.abs(was - 160)).toBeLessThanOrEqual(2);
    await expect.poll(() => gridGoals(page), { timeout: 20000 }).not.toContain('alpha');
    await idle(page);
    await page.waitForTimeout(400);
    expect(Math.abs((await top(next)) - was)).toBeLessThanOrEqual(2);
  });

  test('a swap that drops one row and adds one leaves the section below it where it was', async ({ page }) => {
    await open(page);
    const next = await below(page);
    // Toggle from the strip, then scroll down to the section below and wait out the pause there.
    await box(page, 'Alpha').uncheck();
    await box(page, 'Delta').uncheck();
    await box(page, 'Delta').check();
    await place(next, 160);
    const was = await top(next);
    await expect.poll(() => cells(page), { timeout: 20000 }).toContain('Fresh row.');
    await idle(page);
    await page.waitForTimeout(400);
    expect(Math.abs((await top(next)) - was)).toBeLessThanOrEqual(2);
  });

  test('with the grid top in view, the grid top stays put', async ({ page }) => {
    await open(page);
    const strip = picker(page);
    await strip.scrollIntoViewIfNeeded();
    const was = await top(strip);
    await box(page, 'Alpha').uncheck();
    await expect.poll(() => cells(page), { timeout: 20000 }).not.toContain('Alpha progress.');
    await idle(page);
    expect(Math.abs((await top(strip)) - was)).toBeLessThanOrEqual(2);
  });

  test('a swapped-out row fades rather than vanishing, and reduced motion turns the fade off', async ({ page }) => {
    await open(page);
    const dur = (reduced) => page.evaluate((r) => {
      const el = document.createElement('div');
      el.className = 'gs-leaving';
      document.body.appendChild(el);
      const d = getComputedStyle(el).transitionDuration;
      el.remove();
      return { d, r };
    }, reduced);
    const normal = await dur(false);
    expect(parseFloat(normal.d)).toBeGreaterThan(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await dur(true);
    expect(parseFloat(reduced.d)).toBe(0);
  });
});
