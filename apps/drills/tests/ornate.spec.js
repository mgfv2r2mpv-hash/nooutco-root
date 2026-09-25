// @ts-check
/* The ornament around the drill (web/flourish.js and the ornate layer in
 * drill.css): rich on the setup, results and board, calm while he types. */
import { test, expect } from '@playwright/test';

const PAGE = '/index.html?clock=3';
const state = (page, s) => expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', s, { timeout: 10000 });
const washOpacity = (page) => page.evaluate(() => Number(getComputedStyle(document.querySelector('[data-wash]')).opacity));

test('the washes dim and still while a round is armed or running, and come back after', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('body')).toHaveAttribute('data-calm', '');
  await expect.poll(() => washOpacity(page)).toBeGreaterThan(0.9);
  await page.locator('[data-drill-start]').click();
  await state(page, 'armed');
  await expect(page.locator('body')).toHaveAttribute('data-calm', '1');
  await page.locator('[data-drill-box]').pressSequentially('The parent ran the prompt.', { delay: 12 });
  await state(page, 'running');
  await expect(page.locator('body')).toHaveAttribute('data-calm', '1');
  await expect.poll(() => washOpacity(page), { timeout: 4000 }).toBeLessThan(0.4);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-wash] .w1')).animationPlayState)).toBe('paused');
  await state(page, 'done');
  await expect(page.locator('body')).toHaveAttribute('data-calm', '');
  await expect.poll(() => washOpacity(page), { timeout: 4000 }).toBeGreaterThan(0.9);
});

test('the setup and results cards wear a gilded frame; the typing card stays plain', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('[data-drill-setup] > .filigree')).toHaveCount(4);
  await expect(page.locator('[data-drill-results] > .filigree')).toHaveCount(4);
  await expect(page.locator('[data-drill-question] .filigree')).toHaveCount(0);
  await expect(page.locator('[data-drill-setup] svg.divider')).toHaveCount(1);
});

test('a personal best lights the plaque and throws confetti once', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('The BCBA modeled the prompt.', { delay: 12 });
  await state(page, 'done');
  await expect(page.locator('[data-drill-results]')).toHaveAttribute('data-glory', 'best');
  await expect(page.locator('[data-confetti]')).toHaveCount(1);
  await expect(page.locator('[data-confetti]')).toHaveCount(0, { timeout: 5000 });
});

test('reduced motion keeps the gold and skips the confetti', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(PAGE);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('The BCBA modeled the prompt.', { delay: 12 });
  await state(page, 'done');
  await expect(page.locator('[data-drill-results]')).toHaveAttribute('data-glory', 'best');
  await page.waitForTimeout(300);
  await expect(page.locator('[data-confetti]')).toHaveCount(0);
});

test('busier calendar days glow warmer', async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date();
    const at = (d, h) => new Date(now.getFullYear(), now.getMonth(), d, h, 0).toISOString();
    const rec = (d, h) => ({ at: at(d, h), minutes: 1, nwam: 50, gwam: 55, accuracy: 0.96, words: 55, mode: 'answer' });
    const day = Math.max(2, now.getDate() - 1);
    localStorage.setItem('noaba.drills.v1', JSON.stringify([rec(day - 1, 9), ...[9, 10, 11, 12, 13].map((h) => rec(day, h))]));
  });
  await page.goto('/index.html');
  await page.locator('[data-drill-open="calendar"]').click();
  const days = page.locator('.cal-day.has');
  await expect(days).toHaveCount(2);
  const glow = await days.evaluateAll((els) => els.map((el) => Number(el.style.getPropertyValue('--n'))));
  expect(glow.sort()).toEqual([0.2, 1]);
});

/* The bands as a road (web/bands.js): gems on the home screen, and a crest
   on the results the first time a round reaches a band. */
const seedAnswered = (page, nwams) => page.addInitScript((list) => {
  window.__settleMs = 0;
  localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({ mode: 'answer', copyDefault: true }));
  const now = Date.now();
  localStorage.setItem('noaba.drills.v1', JSON.stringify(list.map((nwam, i) => ({
    at: new Date(now - (list.length - i) * 86400000).toISOString(), minutes: 1, seconds: 60, nwam, gwam: nwam + 2, accuracy: 0.98,
    words: nwam, mode: 'answer', outline: 'A.1', itemId: 'x', keys: {}, rating: 'Professional',
  }))));
}, nwams);

test('the home screen draws the bands as a road, gilded as far as his numbers have reached', async ({ page }) => {
  await seedAnswered(page, [60, 92, 88]);
  await page.goto('/index.html');
  const road = page.locator('[data-drill-road]');
  await expect(road).toBeVisible();
  await expect(road.locator('.gem')).toHaveCount(10);
  await expect(road.locator('.gem.is-reached')).toHaveCount(6); // Amateur up to Expert
  await expect(road.locator('.gem.is-next')).toHaveAttribute('data-band', 'Elite');
  await expect(road.locator('.road-line')).toHaveText('Highest band so far: Expert. Next: Elite, at 95 NWAM. (answering)');
});

test('a first launch has no road yet', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({ mode: 'answer', copyDefault: true })));
  await page.goto('/index.html');
  await expect(page.locator('[data-drill-road]')).toBeHidden();
});

test('a round that reaches a band for the first time drops a crest and throws the gold', async ({ page }) => {
  await seedAnswered(page, [3, 4, 5]);
  await page.goto(PAGE);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('The BCBA modeled the prompt.', { delay: 12 });
  await state(page, 'done');
  const crest = page.locator('[data-drill-levelup]');
  await expect(crest).toBeVisible();
  await expect(crest.locator('.crest-kicker')).toHaveText('New band');
  const band = await page.locator('[data-drill-rating]').textContent();
  await expect(crest.locator('b')).toHaveText(band || '');
  await expect(crest.locator('.crest-note')).toContainText('Past Amateur');
  await expect(page.locator('[data-drill-results]')).toHaveAttribute('data-levelup', band || '');
  await expect(page.locator('[data-confetti]')).toHaveCount(1);
});

test('a round inside a band already reached gets no crest', async ({ page }) => {
  await seedAnswered(page, [300, 300, 300]);
  await page.goto(PAGE);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('The BCBA modeled the prompt.', { delay: 12 });
  await state(page, 'done');
  await expect(page.locator('[data-drill-levelup]')).toBeHidden();
  expect(await page.locator('[data-drill-results]').getAttribute('data-levelup')).toBeNull();
});

test('a copy round that opens a band shows the crest on the read screen, where he lands first', async ({ page }) => {
  await page.addInitScript(() => {
    window.__settleMs = 0;
    localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({ mode: 'copy', copyDefault: true }));
    const now = Date.now();
    localStorage.setItem('noaba.drills.v1', JSON.stringify([2, 3, 4].map((nwam, i) => ({
      at: new Date(now - (4 - i) * 86400000).toISOString(), minutes: 1, seconds: 60, nwam, gwam: nwam, accuracy: 0.98,
      words: nwam, mode: 'copy', passage: 'p-x', keys: {},
    }))));
  });
  await page.goto(PAGE);
  await page.locator('[data-drill-start]').click();
  const words = ((await page.locator('[data-drill-passage]').textContent()) || '').trim().split(/\s+/);
  await page.locator('[data-drill-box]').pressSequentially(words.slice(0, 8).join(' ') + ' ', { delay: 10 });
  await state(page, 'done');
  await expect(page.locator('[data-drill-read]')).toBeVisible();
  const crest = page.locator('[data-drill-read-levelup]');
  await expect(crest).toBeVisible();
  await expect(crest.locator('.crest-kicker')).toHaveText('New band');
  await expect(page.locator('[data-confetti]')).toHaveCount(1);
});
