// @ts-check
/* ClickClackOracle, through the page, in WebKit (the engine the Mac app
 * runs) and Chromium.
 *
 * The arithmetic is pinned by hand in the node tests (drill-score, drill-map,
 * drill-panel). This drives the page: the clock starts on the first key, the
 * box locks at zero, the score renders, paste is refused, numbers are saved
 * and text is not, the word check runs at the space, the map picks the
 * emptiest cell, the garden grows, and the board draws.
 */
import { test, expect } from '@playwright/test';

const PAGE = '/index.html?clock=3';
const wordsReady = (page) => page.waitForFunction(() => window.NoteDrill && window.NoteDrill.known() !== null, null, { timeout: 15000 });
const done = (page) => expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'done', { timeout: 10000 });

test('a question, a clock that starts on the first key, a lock at zero, a score', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'idle');
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'armed');
  await expect(page.locator('[data-drill-q]')).not.toHaveText('');
  expect(await page.locator('[data-drill-bullets] li .src').count()).toBeGreaterThan(0);
  await expect(page.locator('[data-drill-clock]')).toHaveText('0:03');

  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('The BCBA modeled the prompt, then the parent ran it.', { delay: 15 });
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'running');
  await done(page);
  await expect(box).toBeDisabled();
  await expect(page.locator('[data-drill-results]')).toBeVisible();
  // 52 characters in 3 seconds = 10.4 words / 0.05 min = 208 GWAM.
  expect(Number(await page.locator('[data-drill-gwam]').textContent())).toBeCloseTo(208, 0);
  await expect(page.locator('[data-drill-rating]')).not.toHaveText('');
  await expect(page.locator('[data-drill-pace] svg')).toHaveCount(1);
});

test('Backspace counts as a correction and names the key that was hit for the one meant', async ({ page }) => {
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('ther', { delay: 15 });
  await box.press('Backspace');
  await box.pressSequentially('e is', { delay: 15 });
  await done(page);
  await expect(page.locator('[data-drill-errors]')).toHaveText('1');
  await expect(page.locator('[data-drill-tricky]')).toContainText('hit r for e');
});

test('paste is refused and says so', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.focus();
  await page.evaluate(() => {
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    document.querySelector('[data-drill-box]').dispatchEvent(ev);
  });
  await expect(box).toHaveValue('');
  await expect(page.locator('[data-drill-hint]')).toContainText('Paste is off');
});

test('numbers are saved after every drill and the text is not; Keep in a browser says text is for the app', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('word word word', { delay: 15 });
  await done(page);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('noaba.drills.v1')));
  expect(stored).toHaveLength(1);
  expect(stored[0].outline).toMatch(/^[A-I]\.\d+$/);
  expect(stored[0].keys.w.presses).toBe(3);
  expect(JSON.stringify(stored)).not.toContain('word word');
  await page.locator('[data-drill-keep]').click();
  await expect(page.locator('[data-drill-keepnote]')).toContainText('Mac app');
});

test('an unknown word is named when the space lands, counted, and marking it clinical takes it out and keeps it', async ({ page }) => {
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('The parent ran the dysregulatn plan ', { delay: 15 });
  await expect(page.locator('[data-drill-live]')).toContainText('dysregulatn');
  await done(page);
  await expect(page.locator('[data-drill-basis]')).toContainText('1 unknown word');
  await expect(page.locator('[data-drill-errors]')).toHaveText('1');
  const before = Number(await page.locator('[data-drill-nwam]').textContent());
  await page.locator('[data-drill-clinical="dysregulatn"]').click();
  await expect(page.locator('[data-drill-errors]')).toHaveText('0');
  expect(Number(await page.locator('[data-drill-nwam]').textContent())).toBeGreaterThan(before);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('noaba.drills.lexicon.v1')))).toEqual(['dysregulatn']);
  // The saved record moved with it.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('noaba.drills.v1')));
  expect(stored[0].uncorrected).toBe(0);
  // A seed term and the word just kept are known from now on.
  await page.locator('[data-drill-again]').click();
  await page.locator('[data-drill-box]').pressSequentially('mands and dysregulatn ', { delay: 15 });
  await expect(page.locator('[data-drill-live]')).toHaveText('');
});

test('the map has 104 cells, the first question is the emptiest cell, and a drill darkens it', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('[data-drill-open="map"]').click();
  await expect(page.locator('[data-map-cell]')).toHaveCount(104);
  await expect(page.locator('[data-map-cell]:not([data-map-total="0"])')).toHaveCount(0);
  await page.locator('[data-drill-again]').click();
  // Nothing answered: B.4, the first askable item in the heaviest domain.
  await expect(page.locator('[data-drill-category]')).toContainText('B.4');
  await page.locator('[data-drill-box]').pressSequentially('negative reinforcement ', { delay: 15 });
  await done(page);
  await page.locator('[data-tab="map"]').click();
  await expect(page.locator('[data-map-cell="B.4"]')).toHaveAttribute('data-map-total', '1');
  await page.locator('[data-drill-again]').click();
  await expect(page.locator('[data-drill-category]')).toContainText('B.6');
});

test('the garden grows with words and warms with speed, and goes back to bare ground for the next drill', async ({ page }) => {
  await page.goto('/index.html?clock=6');
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('the parent ran the plan and the kid did the step and we watch the data every day now ', { delay: 8 });
  await expect.poll(() => page.evaluate(() => window.NoteDrill.garden.state.growth)).toBeGreaterThan(0.1);
  expect(await page.evaluate(() => window.NoteDrill.garden.state.heat)).toBeGreaterThan(0);
  expect(await page.locator('.garden .orn-item.on').count()).toBeGreaterThan(0);
  const heat = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--heat'));
  expect(Number(heat)).toBeGreaterThan(0);
  await done(page);
  await page.locator('[data-drill-again]').click();
  expect(await page.evaluate(() => window.NoteDrill.garden.state.growth)).toBe(0);
});

test('the board draws progress, bests and the keyboard', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('the plan ran', { delay: 15 });
  await done(page);
  await page.locator('[data-tab="progress"]').click();
  await expect(page.locator('[data-chart-nwam] svg .chart-dot')).toHaveCount(1);
  // One row per clock, answer and copy side by side, under a header.
  await expect(page.locator('[data-drill-bests] tr:has(td)')).toHaveCount(5);
  await expect(page.locator('[data-drill-bests] th')).toHaveText(['', 'answer', 'copy']);
  await page.locator('[data-tab="keys"]').click();
  await expect(page.locator('[data-drill-keyboard] .kbd-key')).toHaveCount(26);
});

test('the minute picker sets the clock, number keys pick it, and it is remembered', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('[data-drill-minutes="5"]').click();
  await expect(page.locator('[data-drill-clock]')).toHaveText('5:00');
  await page.keyboard.press('2');
  await expect(page.locator('[data-drill-minutes="2"]')).toHaveClass(/is-on/);
  await page.reload();
  await expect(page.locator('[data-drill-minutes="2"]')).toHaveClass(/is-on/);
  await expect(page.locator('[data-drill-pb]')).toContainText('2 minutes');
});

test('escape leaves a drill without scoring it', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('half an answ', { delay: 15 });
  await page.keyboard.press('Escape');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'idle');
  await page.waitForTimeout(3500);
  expect(await page.evaluate(() => localStorage.getItem('noaba.drills.v1'))).toBeNull();
});

/* ---- round two ----------------------------------------------------------- */

test('possessives and contractions are not flagged at the space', async ({ page }) => {
  await page.goto('/index.html?clock=4');
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially("the gambler's fallacy, don't chase it ", { delay: 12 });
  await expect(page.locator('[data-drill-live]')).toHaveText('');
});

test('a same-side Shift paints the correct side and flashes the key on its own side; an opposite Shift cheers', async ({ page }) => {
  await page.goto('/index.html?clock=4');
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.focus();
  // T is a left-hand key. Left Shift + T is same-side: the RIGHT side gets the watercolour Shift.
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.press('KeyT');
  await page.keyboard.up('ShiftLeft');
  await expect(page.locator('[data-sidefx]')).toHaveAttribute('data-last-shift', 'same');
  await expect(page.locator('[data-side="R"] svg.wc-shift')).toHaveCount(1);
  await expect(page.locator('[data-side="R"]')).toHaveClass(/is-warn/);
  await expect(page.locator('[data-side="L"] .fx-key')).toHaveText('T');
  // Right Shift + T is the opposite hand: a small cheer on the right.
  await page.keyboard.down('ShiftRight');
  await page.keyboard.press('KeyT');
  await page.keyboard.up('ShiftRight');
  await expect(page.locator('[data-sidefx]')).toHaveAttribute('data-last-shift', 'ok');
  await expect(page.locator('[data-side="R"] svg.fx-glyph')).toHaveCount(1);
  await done(page);
  await expect(page.locator('[data-drill-timing]')).toContainText('1 of 2 capitals with the opposite Shift');
});

test('Option+Backspace is logged as a revision, not an error', async ({ page }) => {
  // The browser does the word delete, and only a Mac maps it to Option+Backspace
  // (Linux uses Control). The app runs only on the Mac; the counting itself is
  // pinned in drill-round2.test.mjs, which runs everywhere.
  test.skip(process.platform !== 'darwin', 'Option+Backspace deletes a word only on macOS');
  await page.goto('/index.html?clock=4');
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('the child ran', { delay: 12 });
  await box.press('Alt+Backspace');
  await expect(box).toHaveValue('the child ');
  await box.pressSequentially('walked', { delay: 12 });
  await done(page);
  await expect(page.locator('[data-drill-errors]')).toHaveText('0');
  await expect(page.locator('[data-drill-timing]')).toContainText('1 revision with Option or Command+Backspace');
  const rec = await page.evaluate(() => window.NoteDrill.data.history.at(-1));
  expect(rec.revisions).toBe(1);
  expect(rec.habits.wordDeletes).toBe(1);
});

test('the calendar shows each day with its numbers, badge and streak banner; trophies show dates and conditions', async ({ page }) => {
  await page.addInitScript(() => {
    const now = new Date();
    const at = (back, h) => { const d = new Date(now); d.setDate(d.getDate() - back); d.setHours(h, 0, 0, 0); return d.toISOString(); };
    const rec = (back, h, nwam) => ({ at: at(back, h), minutes: 1, seconds: 60, nwam, gwam: nwam + 6, accuracy: 0.98, words: nwam + 6, outline: 'A.1', itemId: 'x', keys: {} });
    localStorage.setItem('noaba.drills.v1', JSON.stringify([rec(2, 9, 40), rec(1, 9, 44), rec(1, 10, 48), rec(0, 8, 52)]));
  });
  await page.goto('/index.html');
  await expect(page.locator('[data-stat-streak]')).toHaveText('3 days in a row');
  await expect(page.locator('[data-stat-today]')).toHaveText('1 today');
  await page.locator('.row [data-drill-open="calendar"]').click();
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
  const cell = page.locator(`[data-cal-day="${today}"]`).first();
  await expect(cell.locator('.cal-nwam')).toHaveText('52');
  await expect(cell.locator('.cal-gwam')).toHaveText('58 gross');
  await expect(cell.locator('[data-cal-count]')).toHaveText('1');
  await expect(page.locator('[data-cal-summary]')).toContainText('3 days in a row');
  // The banner under the three days, labelled where it starts (it may wrap a week).
  await expect(page.locator('[data-cal-banner="3"]').first()).toBeVisible();
  await page.locator('[data-tab="trophies"]').click();
  const won = page.locator('[data-trophy="streak-3"]');
  await expect(won).toHaveClass(/is-won/);
  await expect(won).toContainText('Drill 3 days in a row.');
  await expect(won).toContainText('Unlocked');
  await expect(page.locator('[data-trophy="streak-7"]')).toContainText('3 of 7');
});

/* ---- round three --------------------------------------------------------- */

test('Keep going carries the answer into a fresh clock and scores only what the new round added', async ({ page }) => {
  await page.goto('/index.html?clock=2');
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  const question = await page.locator('[data-drill-q]').textContent();
  await box.pressSequentially('the child ran ', { delay: 12 });
  await done(page);
  await page.keyboard.press('c');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'armed');
  await expect(page.locator('[data-drill-q]')).toHaveText(question);
  await expect(box).toHaveValue('the child ran ');
  await expect(page.locator('[data-drill-category]')).toContainText('keep going 1');
  await box.pressSequentially('home', { delay: 12 });
  await expect(box).toHaveValue('the child ran home');
  await done(page);
  const last = await page.evaluate(() => window.NoteDrill.data.history.slice(-2));
  expect(last[0].itemId).toBe(last[1].itemId);
  expect(last[1].cont).toBe(1);
  // 4 keys placed in the second round: "home".
  expect(last[1].words).toBe(0.8);
});

test('copy, then respond: the passage is marked word by word, the copy is never kept, and respond runs a minute on it', async ({ page }) => {
  await page.goto('/index.html?clock=3');
  await wordsReady(page);
  await page.locator('[data-drill-mode="copy"]').click();
  await expect(page.locator('[data-drill-lede]')).toContainText('Copy a passage');
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'copy');
  const passage = page.locator('[data-drill-passage]');
  await expect(passage).toBeVisible();
  const words = (await passage.textContent()).trim().split(/\s+/);
  const box = page.locator('[data-drill-box]');
  // First word right, second word wrong.
  await box.pressSequentially(words[0] + ' xyzzy ', { delay: 12 });
  await expect(passage.locator('.pw').nth(0)).toHaveClass(/is-ok/);
  await expect(passage.locator('.pw').nth(1)).toHaveClass(/is-bad/);
  await expect(passage.locator('.pw').nth(2)).toHaveClass(/is-cur/);
  await expect(page.locator('[data-drill-live]')).toHaveText('');
  await done(page);
  await expect(page.locator('[data-drill-errors]')).toHaveText('1');
  await expect(page.locator('[data-drill-keep]')).toBeHidden();
  await expect(page.locator('[data-drill-continue]')).toBeHidden();
  await expect(page.locator('[data-drill-again]')).toContainText('Respond');
  const copyRec = await page.evaluate(() => window.NoteDrill.data.history.at(-1));
  expect(copyRec.mode).toBe('copy');
  expect(copyRec.outline).toBeNull();
  await page.keyboard.press('Enter');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'respond');
  await expect(page.locator('[data-drill-ref]')).toBeVisible();
  await expect(box).toHaveValue('');
  await box.pressSequentially('I agree with most of it ', { delay: 12 });
  await done(page);
  await expect(page.locator('[data-drill-keep]')).toBeVisible();
  await expect(page.locator('[data-drill-continue]')).toBeVisible();
  const rec = await page.evaluate(() => window.NoteDrill.data.history.at(-1));
  expect(rec.mode).toBe('respond');
  expect(rec.passage).toBe(copyRec.passage);
  expect(rec.outline).not.toBeNull();
});

test('finishing the passage ends the copy round early and scores the time it took', async ({ page }) => {
  await page.goto('/index.html?clock=120');
  await page.locator('[data-drill-mode="copy"]').click();
  await page.locator('[data-drill-start]').click();
  const text = (await page.locator('[data-drill-passage]').textContent()).trim().replace(/\s+/g, ' ');
  await page.locator('[data-drill-box]').fill('');
  await page.locator('[data-drill-box]').pressSequentially(text, { delay: 0 });
  await done(page);
  await expect(page.locator('[data-drill-errors]')).toHaveText('0');
  await expect(page.locator('[data-drill-basis]')).toContainText('A copy round');
});

test('the copy picker aims at his weak keys, says so, and marks those letters', async ({ page }) => {
  await page.addInitScript(() => {
    const keys = {};
    for (const k of 'abcdefghijklmnopqrstuvwxyz') keys[k] = { presses: 40, misses: 0 };
    keys.w = { presses: 40, misses: 6 }; keys.m = { presses: 40, misses: 5 }; keys.b = { presses: 40, misses: 4 };
    const at = new Date(Date.now() - 3600000).toISOString();
    localStorage.setItem('noaba.drills.v1', JSON.stringify([{ at, minutes: 1, nwam: 60, gwam: 62, accuracy: 0.95, words: 62, keys, mode: 'answer', outline: 'A.1', itemId: 'a-01' }]));
  });
  await page.goto('/index.html?clock=3');
  await page.locator('[data-drill-mode="copy"]').click();
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('[data-drill-category]')).toContainText('works w m b');
  expect(await page.locator('[data-drill-passage] u.wk').count()).toBeGreaterThan(20);
  await expect(page.locator('[data-drill-q]')).toContainText('Relative and absolute strength');
  await page.keyboard.press('Escape');
  await page.locator('.row [data-drill-open="keys"]').click();
  await expect(page.locator('[data-drill-working]')).toContainText('aiming at: w m b');
});

test('"a word" makes an unknown word known without counting it as clinical', async ({ page }) => {
  await page.goto('/index.html?clock=3');
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('a zorbly win ', { delay: 12 });
  await done(page);
  await expect(page.locator('[data-drill-errors]')).toHaveText('1');
  await page.locator('[data-drill-word="zorbly"]').click();
  await expect(page.locator('[data-drill-errors]')).toHaveText('0');
  const saved = await page.evaluate(() => ({ words: window.NoteDrill.data.settings.words, lexicon: window.NoteDrill.data.lexicon }));
  expect(saved.words).toEqual(['zorbly']);
  expect(saved.lexicon).toEqual([]);
  // Known next time: not flagged at the space. (Click Again: focus is still on
  // the button just pressed, and Return on a button does not start a drill.)
  await page.locator('[data-drill-again]').click();
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'armed');
  await page.locator('[data-drill-box]').pressSequentially('zorbly ', { delay: 12 });
  await expect(page.locator('[data-drill-live]')).toHaveText('');
});

test('an acronym on one held Shift is judged once: EHR with the right Shift held throughout is all correct', async ({ page }) => {
  await page.goto('/index.html?clock=4');
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').focus();
  // E is a left-hand key, so the right Shift is correct; H and R ride the same hold.
  await page.keyboard.down('ShiftRight');
  await page.keyboard.press('KeyE');
  await page.keyboard.press('KeyH');
  await page.keyboard.press('KeyR');
  await page.keyboard.up('ShiftRight');
  await expect(page.locator('[data-drill-box]')).toHaveValue('EHR');
  await expect(page.locator('[data-side="L"] .fx-key')).toHaveCount(0);
  await page.keyboard.press('Space');
  await done(page);
  await expect(page.locator('[data-drill-timing]')).toContainText('1 of 1 capitals with the opposite Shift');
});
