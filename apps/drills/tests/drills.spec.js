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

// Copy, then respond is the app's default (his ruling of 2026-09-23). Most of
// these tests drive a bank question, so they start in Answer mode unless a
// test says otherwise; the default itself has its own test below.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!location.search.includes('settle')) window.__settleMs = 0; // the settle has its own test
    const k = 'noaba.drills.settings.v1';
    if (location.search.includes('fresh')) return; // a first launch, as he gets it
    if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ mode: 'answer', copyDefault: true }));
  });
});

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
  // Nothing answered: B.1, the first askable item in the heaviest domain.
  // (It was B.4 until bank-more.js gave B.1 to B.3 a question each.)
  await expect(page.locator('[data-drill-category]')).toContainText('B.1');
  await page.locator('[data-drill-box]').pressSequentially('two response classes ', { delay: 15 });
  await done(page);
  await page.locator('[data-tab="map"]').click();
  await expect(page.locator('[data-map-cell="B.1"]')).toHaveAttribute('data-map-total', '1');
  await page.locator('[data-drill-again]').click();
  await expect(page.locator('[data-drill-category]')).toContainText('B.2');
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
  // Strict Shift off: the lenient trainer, which lets the capital through. Strict
  // (the default since 2026-09-23) has its own tests below.
  await page.addInitScript(() => localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({ mode: 'answer', copyDefault: true, strictShift: false })));
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

/* ---- Strict Shift (default on): a same-side capital is refused --------- */

test('strict Shift, on by default: a same-side capital is refused and flashed, the right Shift types it, and the round reports it', async ({ page }) => {
  await page.goto('/index.html?clock=4');
  await expect(page.locator('[data-drill-strict-shift]')).toBeChecked();
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.focus();
  // T is a left-hand key: the left Shift is refused, twice on one held press.
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.press('KeyT');
  await expect(page.locator('[data-sidefx]')).toHaveAttribute('data-last-shift', 'refused');
  await expect(page.locator('[data-side="L"] .fx-key.is-refused')).toHaveText('T');
  await expect(page.locator('[data-side="R"] svg.wc-shift')).toHaveCount(1);
  await page.keyboard.press('KeyT');
  await page.keyboard.up('ShiftLeft');
  await expect(box).toHaveValue('');
  await page.keyboard.down('ShiftRight');
  await page.keyboard.press('KeyT');
  await page.keyboard.up('ShiftRight');
  await box.pressSequentially('he cat ', { delay: 10 });
  await expect(box).toHaveValue('The cat ');
  await done(page);
  await expect(page.locator('[data-drill-timing]')).toContainText('2 capitals refused for a same-side Shift (T 2\u00d7)');
  await expect(page.locator('[data-drill-timing]')).toContainText('1 of 1 capitals with the opposite Shift');
  // Refusals are not errors, and the record carries the count, never text.
  await expect(page.locator('[data-drill-errors]')).toHaveText('0');
  const rec = await page.evaluate(() => window.NoteDrill.data.history.at(-1));
  expect(rec.refused).toBe(2);
  expect(rec.refusedKeys).toEqual(['T']);
});

test('strict Shift refuses in a copy round too, and the passage still marks clean', async ({ page }) => {
  await page.goto('/index.html?clock=120');
  await page.locator('[data-drill-mode="copy"]').click();
  await page.locator('[data-drill-start]').click();
  const text = (await page.locator('[data-drill-passage]').textContent()).trim().replace(/\s+/g, ' ');
  const first = text[0];
  expect(first).toMatch(/[A-Z]/);
  const code = 'Key' + first;
  const box = page.locator('[data-drill-box]');
  await box.focus();
  // The wrong Shift for this letter is the one on its own hand.
  const ownSide = await page.evaluate((c) => window.NoteDrill.handOf(c), code);
  const wrong = ownSide === 'L' ? 'ShiftLeft' : 'ShiftRight', right = ownSide === 'L' ? 'ShiftRight' : 'ShiftLeft';
  await page.keyboard.down(wrong); await page.keyboard.press(code); await page.keyboard.up(wrong);
  await expect(box).toHaveValue('');
  await page.keyboard.down(right); await page.keyboard.press(code); await page.keyboard.up(right);
  await expect(box).toHaveValue(first);
  await box.pressSequentially(text.slice(1), { delay: 0 });
  await done(page);
  await expect(page.locator('[data-drill-errors]')).toHaveText('0');
  await expect(page.locator('[data-drill-timing]')).toContainText('1 capital refused for a same-side Shift');
});

test('strict Shift can be turned off in settings, and the choice is saved', async ({ page }) => {
  await page.goto('/index.html?clock=3');
  await page.locator('[data-drill-strict-shift]').uncheck();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('noaba.drills.settings.v1')));
  expect(saved.strictShift).toBe(false);
  await page.reload();
  await expect(page.locator('[data-drill-strict-shift]')).not.toBeChecked();
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').focus();
  await page.keyboard.down('ShiftLeft'); await page.keyboard.press('KeyT'); await page.keyboard.up('ShiftLeft');
  await expect(page.locator('[data-drill-box]')).toHaveValue('T');
  await expect(page.locator('[data-sidefx]')).toHaveAttribute('data-last-shift', 'same');
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
  // 2026-09-23: a composed round names a revision as a changed mind and reports the kept words.
  await expect(page.locator('[data-drill-timing]')).toContainText('1 revision (a changed mind, never an error), 3 words kept');
  const rec = await page.evaluate(() => window.NoteDrill.data.history.at(-1));
  expect(rec.revisions).toBe(1);
  expect(rec.habits.wordDeletes).toBe(1);
});

test('a thought taken back with plain Backspace costs no error, no accuracy, and the ladder always has a next rung', async ({ page }) => {
  await page.goto('/index.html?clock=4');
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('the child ran home', { delay: 12 });
  for (let i = 0; i < 'home'.length; i++) await box.press('Backspace');
  await box.pressSequentially('away', { delay: 12 });
  await done(page);
  await expect(page.locator('[data-drill-errors]')).toHaveText('0');
  await expect(page.locator('[data-drill-accuracy]')).toHaveText('100%');
  await expect(page.locator('[data-drill-basis]')).toContainText('counted in your speed, never as errors');
  await expect(page.locator('[data-drill-next]')).toContainText('next milestone');
  const rec = await page.evaluate(() => window.NoteDrill.data.history.at(-1));
  expect(rec.corrections).toBe(0);
  expect(rec.revisions).toBe(1);
  expect(rec.revisedKeys).toBe(4);
  expect(rec.keptWords).toBe(4);
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

test('achievements carry their new names; a secret shows only its hint until it is found', async ({ page }) => {
  await page.addInitScript(() => {
    const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(1, 30, 0, 0);
    const rec = (at, nwam) => ({ at, minutes: 1, seconds: 60, nwam, gwam: nwam + 4, accuracy: 0.96, words: nwam + 4, outline: 'A.1', itemId: 'x', keys: {} });
    // One drill at 1:30 in the morning: Midnight Oil, a secret, is found.
    localStorage.setItem('noaba.drills.v1', JSON.stringify([rec(d.toISOString(), 50)]));
  });
  await page.goto('/index.html');
  await page.locator('.row [data-drill-open="trophies"]').click();
  await expect(page.locator('[data-trophy="sessions-1"]')).toContainText('First Keystrokes');
  await expect(page.locator('[data-trophy="midnight"]')).toContainText('Midnight Oil');
  // Unfound secrets are not "next": they appear only under Show every trophy, as Secret with a hint.
  await expect(page.locator('[data-trophy="deja-vu"]')).toHaveCount(0);
  await page.locator('[data-trophy-toggle]').click();
  const hidden = page.locator('[data-trophy="deja-vu"]');
  await expect(hidden).toHaveClass(/is-secret/);
  await expect(hidden.locator('b')).toHaveText('Secret');
  await expect(hidden).toContainText('Do it again, exactly the same.');
  await expect(hidden).not.toContainText('Deja Vu');
  // A yes-or-no achievement says Not yet, not "0 of 1".
  await expect(page.locator('[data-trophy="weekend"]')).toContainText(/Not yet|Unlocked/);
  await expect(page.locator('[data-trophy="leap"]')).toContainText('Not yet');
});

test('a round that spots a nemesis says so, and the board shows it under Your nemeses with the day it was spotted', async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now();
    // Seven earlier drills that missed u on a quarter of its presses; the round typed here is the eighth.
    const rec = (i) => ({ at: new Date(now - (10 - i) * 3600000).toISOString(), minutes: 1, seconds: 60, nwam: 80, gwam: 84, accuracy: 0.96,
      words: 84, mode: 'answer', itemId: 'x', outline: 'B.1', keys: { u: { presses: 12, misses: 3 } } });
    localStorage.setItem('noaba.drills.v1', JSON.stringify(Array.from({ length: 7 }, (_, i) => rec(i))));
  });
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('the bus runs up', { delay: 15 });
  await done(page);
  const spotted = page.locator('[data-spotted="nem-key-u"]');
  await expect(spotted).toContainText('New nemesis:');
  await expect(spotted).toContainText('U missed on');
  const rec = await page.evaluate(() => window.NoteDrill.data.history.at(-1));
  expect(Array.isArray(rec.confusions)).toBe(true);
  await page.evaluate(() => window.NoteDrill.openBoard('trophies'));
  const card = page.locator('[data-trophy="nem-key-u"]');
  await expect(card).toContainText('Spotted');
  await expect(card).toContainText('0 of 12');
  await expect(page.locator('.trophy-group.is-nemeses h3')).toHaveText('Your nemeses');
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

/* ---- the oracle (canned replies on window.ClickClackMock; no Claude call) -- */

const ORACLE_MOCK = () => {
  window.__calls = [];
  window.__proposed = [];
  window.__sent = [];
  window.ClickClackMock = {
    askClaude: async (req) => {
      window.__calls.push(req);
      if (req.schema && req.schema.properties && req.schema.properties.records) {
        return { ok: true, output: { records: [
          { title: "Delay kills momentum", rule: "Present the low-p request right after the high-p run.", applies: "when a note describes high-p requests", topic: "behavioral-momentum" },
          { title: "Quoted", rule: "the high-p run builds reinforced compliance before the hard ask every time", applies: "x", topic: "q" },
        ] } };
      }
      const turn = window.__calls.filter((c) => !(c.schema.properties && c.schema.properties.records)).length;
      return { ok: true, output: { reflection: turn > 1 ? "You named the timing; add the reinforcement rate." : "",
        thoughts: [{ text: "Momentum is resistance to change.", source: "Nevin (1992)" }, { text: "Gaps weaken it.", source: "Mace et al. (1988)" }],
        question: turn > 1 ? "Follow-up question number two?" : "Why does the high-p sequence work?" } };
    },
    expertStatus: async () => ({ connected: true, queued: 1, note: "Connected to the expert. The token has 29 days left." }),
    expertQueue: async () => ({ items: [{ at: "2026-09-23T15:00:00Z", question: "Why?", answer: "the high-p run builds reinforced compliance before the hard ask every time", mode: "oracle" }] }),
    expertPropose: async (record) => { window.__proposed.push(record); return { ok: true, proposalId: "pr_test" }; },
    expertSent: async (stamps) => { window.__sent.push(...stamps); return { ok: true, queued: 0 }; },
    micStart: async () => ({ ok: true }),
    micStop: async () => ({ ok: true }),
  };
};

test('the oracle asks, shows its thinking with sources, and the follow-up carries his answer', async ({ page }) => {
  await page.addInitScript(ORACLE_MOCK);
  await page.goto('/index.html?clock=2');
  await page.locator('[data-drill-mode="oracle"]').click();
  await expect(page.locator('[data-drill-oracle-topic]')).toBeVisible();
  await page.locator('[data-drill-oracle-topic]').fill('behavioral momentum');
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'oracle');
  await expect(page.locator('[data-drill-q]')).toHaveText('Why does the high-p sequence work?');
  await expect(page.locator('[data-drill-bullets] li')).toHaveCount(2);
  await expect(page.locator('[data-drill-bullets] .src').first()).toHaveText('Nevin (1992)');
  const first = await page.evaluate(() => window.__calls[0]);
  expect(first.webSearch).toBe(true);
  expect(first.prompt).toContain('Topic: behavioral momentum');
  await page.locator('[data-drill-box]').pressSequentially('it builds reinforced compliance ', { delay: 10 });
  await done(page);
  await expect(page.locator('[data-drill-again]')).toContainText('Follow-up');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-drill-q]')).toHaveText('Follow-up question number two?');
  await expect(page.locator('[data-drill-bullets] li').first()).toContainText('You named the timing');
  const second = await page.evaluate(() => window.__calls[1]);
  expect(second.prompt).toContain('He answered: it builds reinforced compliance');
});

test('with no topic typed the oracle opens on a live question for his view, then on the map next time', async ({ page }) => {
  await page.addInitScript(ORACLE_MOCK);
  await page.goto('/index.html?clock=2');
  await page.locator('[data-drill-mode="oracle"]').click();
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'oracle');
  await expect(page.locator('[data-drill-category]')).toContainText('your view');
  const first = await page.evaluate(() => window.__calls[0].prompt);
  expect(first).toContain('Topic: how many hours of ABA a week');
  expect(first).toContain('(BACB outline F.8)');
  await page.locator('[data-drill-box]').pressSequentially('it depends on the child ', { delay: 10 });
  await done(page);
  const rec = await page.evaluate(() => window.NoteDrill.data.history.at(-1));
  expect(rec.seed).toBe('s-hours');
  // A new conversation, not a follow-up: the map's turn.
  await page.evaluate(() => { window.__calls.length = 0; });
  await page.goto('/index.html?clock=2');
  await page.locator('[data-drill-mode="oracle"]').click();
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'oracle');
  await expect(page.locator('[data-drill-category]')).not.toContainText('your view');
  expect(await page.evaluate(() => window.__calls[0].prompt)).not.toContain('how many hours');
});

test('talking fills the box, marks the round spoken, and a spoken round can be kept', async ({ page }) => {
  await page.addInitScript(ORACLE_MOCK);
  await page.goto('/index.html?clock=2');
  await page.locator('[data-drill-mode="oracle"]').click();
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('[data-drill-mic]')).toBeVisible();
  await page.locator('[data-drill-mic]').click();
  await expect(page.locator('[data-drill-mic]')).toHaveClass(/is-on/);
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'running');
  await page.evaluate(() => window.ClickClack.speech({ text: 'I would fade the prompts', final: false }));
  await expect(page.locator('[data-drill-box]')).toHaveValue('I would fade the prompts');
  await done(page);
  await expect(page.locator('[data-drill-basis]')).toContainText('You talked');
  await expect(page.locator('[data-drill-keep]')).toBeEnabled();
  const rec = await page.evaluate(() => window.NoteDrill.data.history.at(-1));
  expect(rec.spoken).toBe(true);
  expect(rec.spokenWords).toBe(5);
});

test('send to the expert drafts, drops a draft that quotes him, proposes the rest, and marks the answer sent', async ({ page }) => {
  await page.addInitScript(ORACLE_MOCK);
  await page.goto('/index.html');
  await page.locator('.row [data-drill-open="expert"]').click();
  await expect(page.locator('[data-drill-expert-status]')).toContainText('1 kept answer waiting');
  await page.locator('[data-drill-expert-send]').click();
  await expect(page.locator('[data-drill-expert-log]')).toContainText('1 answer read, 1 proposal staged');
  await expect(page.locator('[data-drill-expert-log]')).toContainText('quotes the answer');
  const out = await page.evaluate(() => ({ proposed: window.__proposed, sent: window.__sent, draftCall: window.__calls[0] }));
  expect(out.proposed).toHaveLength(1);
  expect(out.proposed[0].title).toBe('Delay kills momentum');
  expect(out.proposed[0].tier).toBe('topic');
  expect(out.sent).toEqual(['2026-09-23T15:00:00Z']);
  expect(out.draftCall.webSearch).toBe(false);
});

test('outside the Mac app the oracle says so plainly', async ({ page }) => {
  await page.goto('/index.html');
  await page.locator('[data-drill-mode="oracle"]').click();
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('[data-drill-pb]')).toHaveText('The oracle works in the Mac app.');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'idle');
});

/* ---- copy then respond by default, and the baton pass ------------------ */

test('a first launch opens on Copy, then respond', async ({ page }) => {
  await page.goto('/index.html?fresh');
  await expect(page.locator('[data-drill-mode="copy"]')).toHaveClass(/is-on/);
  await expect(page.locator('[data-drill-lede]')).toContainText('pass the baton');
  await page.locator('[data-drill-mode="answer"]').click();
  await page.reload();
  await expect(page.locator('[data-drill-mode="answer"]')).toHaveClass(/is-on/);
});

const BATON_MOCK = () => {
  window.__calls = []; window.__kept = []; window.__proposed = []; window.__sent = [];
  const long = 'You are right that the order matters. The research adds a second point worth weighing, which is the rate of reinforcement during the high probability run, since rate and not order is what builds persistence.';
  window.ClickClackMock = {
    keep: async (r) => { window.__kept.push(r); return { ok: true, corpus: 'Kept.', expert: 'Queued.' }; },
    askClaude: async (req) => {
      window.__calls.push(req);
      if (req.schema.properties.records) return { ok: true, output: { records: [{ title: 'Rate builds persistence', rule: 'Reinforcement rate during the run sets persistence.', applies: 'when a note describes high-p requests', topic: 'behavioral-momentum' }] } };
      return { ok: true, output: { stance: 'adds a consideration', title: 'Rate \u2014 not order', passage: long, sources: [{ claim: 'Rate drives persistence', source: 'Nevin (1992)' }], respond: 'How would you raise the rate in session?' } };
    },
    expertStatus: async () => ({ connected: true, queued: 1, note: 'Connected.' }),
    expertRecords: async () => ({ ok: true, records: [{ title: 'Momentum before the hard ask', rule: 'High probability requests build momentum before the demand.', topic: 'behavioral-momentum' }] }),
    // As the Swift shell does: the queued entry is the kept sidecar plus the answer.
    expertQueue: async () => ({ items: window.__kept.map((k) => ({ ...k, answer: k.text })) }),
    expertPropose: async (record) => { window.__proposed.push(record); return { ok: true, proposalId: 'pr_b' }; },
    expertSent: async (stamps) => { window.__sent.push(...stamps); return { ok: true, queued: 0 }; },
  };
};

test('baton pass: keeps the answer, ingests it in the background, and the expert\'s reply is the next passage to copy, then respond', async ({ page }) => {
  await page.addInitScript(BATON_MOCK);
  await page.addInitScript(() => localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({ mode: 'copy', copyDefault: true })));
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('The ', { delay: 10 });
  await done(page);
  await expect(page.locator('[data-drill-baton]')).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'respond');
  await box.pressSequentially('high p runs build momentum ', { delay: 10 });
  await done(page);
  await expect(page.locator('[data-drill-baton]')).toBeVisible();
  await page.keyboard.press('b');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'copy', { timeout: 10000 });
  await expect(page.locator('[data-drill-passage]')).toContainText('rate and not order');
  await expect(page.locator('[data-drill-category]')).toContainText('baton pass 1');
  await expect(page.locator('[data-drill-bullets]')).toContainText('The expert, adds a consideration, with 1 of its records');
  const out = await page.evaluate(() => ({ kept: window.__kept, calls: window.__calls, sent: window.__sent, proposed: window.__proposed }));
  expect(out.kept).toHaveLength(1);
  expect(out.kept[0].mode).toBe('respond');
  const batonCall = out.calls.find((c) => c.schema.properties.passage);
  expect(batonCall.webSearch).toBe(true);
  expect(batonCall.prompt).toContain('high p runs build momentum');
  expect(batonCall.prompt).toContain('Momentum before the hard ask');
  await expect.poll(() => page.evaluate(() => window.__sent.length)).toBe(1);
  // Copy the expert's reply, then respond to its question, with its sources beside it.
  const text = (await page.locator('[data-drill-passage]').textContent()).trim();
  await box.pressSequentially(text.split(/\s+/).slice(0, 3).join(' ') + ' ', { delay: 8 });
  await done(page);
  await expect(page.locator('[data-drill-keep]')).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-drill-q]')).toHaveText('How would you raise the rate in session?');
  await expect(page.locator('[data-drill-bullets]')).toContainText('Nevin (1992)');
  await expect(page.locator('[data-drill-category]')).toContainText('respond · baton pass 1');
});

test('a kept respond answer carries the passage it answered and a local stance, and the draft reads them for consensus and dissent', async ({ page }) => {
  await page.addInitScript(BATON_MOCK);
  await page.addInitScript(() => localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({ mode: 'copy', copyDefault: true })));
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('The ', { delay: 10 });
  await done(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'respond');
  await box.pressSequentially('I am not convinced, however it might help ', { delay: 10 });
  await done(page);
  await page.keyboard.press('b');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'copy', { timeout: 10000 });
  await expect.poll(() => page.evaluate(() => window.__sent.length)).toBe(1);
  const out = await page.evaluate(() => ({ kept: window.__kept[0], passage: window.NoteDrill.data.history.at(-2).passage, calls: window.__calls, proposed: window.__proposed }));
  expect(out.kept.research.kind).toBe('passage');
  expect(out.kept.research.passage).toBe(out.passage);
  expect(out.kept.research.sources.length).toBeGreaterThan(0);
  expect(out.kept.tone.stance).toBe('pushes back');
  expect(out.kept.tone.hedges).toBe(1);
  const draft = out.calls.find((c) => c.schema.properties.records);
  expect(draft.prompt).toContain('The research in front of him (passage):');
  expect(draft.prompt).toContain('Stance markers in his answer: pushes back.');
  expect(draft.prompt).not.toContain('hedges');
  expect(draft.system).toContain('dissent');
  expect(out.proposed[0].provenance.sources).toEqual(out.kept.research.sources);
});

test('for three seconds after the bell, keys do nothing, so typing past it cannot start the next round', async ({ page }) => {
  await page.goto('/index.html?clock=2&settle');
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('one two ', { delay: 10 });
  await done(page);
  await expect(page.locator('main.drill')).toHaveAttribute('data-settling', '1');
  await page.keyboard.press('Enter');
  await page.keyboard.press('k');
  await page.keyboard.press('c');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'done');
  await expect(page.locator('[data-drill-keep]')).not.toHaveText('Kept');
  await expect(page.locator('main.drill')).not.toHaveAttribute('data-settling', '1', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'armed');
});

test('Send to the expert keeps the answer on screen first, so Keep going rounds are never sent without it', async ({ page }) => {
  await page.addInitScript(BATON_MOCK);
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('reinforcement comes first ', { delay: 10 });
  await done(page);
  await page.keyboard.press('c');
  await box.pressSequentially('and then the rate ', { delay: 10 });
  await done(page);
  await expect(page.locator('[data-drill-send]')).toBeVisible();
  await page.locator('[data-drill-send]').click();
  await expect.poll(() => page.evaluate(() => window.__sent.length)).toBe(1);
  const kept = await page.evaluate(() => window.__kept);
  expect(kept).toHaveLength(1);
  expect(kept[0].text).toContain('reinforcement comes first');
  expect(kept[0].text).toContain('and then the rate');
  await expect(page.locator('[data-drill-keep]')).toHaveText(/Kept/);
});

/* ---- read and consider, and the shelf (his ask of 2026-09-23) ------------ */

test('after the copy round the passage comes back to read, with its question; N shows the numbers and Return responds', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({ mode: 'copy', copyDefault: true })));
  await page.goto(PAGE);
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('[data-drill-hint]')).toContainText('read it properly afterwards');
  const words = (await page.locator('[data-drill-passage]').textContent()).trim().split(/\s+/);
  await page.locator('[data-drill-box]').pressSequentially(words.slice(0, 2).join(' ') + ' ', { delay: 10 });
  await done(page);
  const read = page.locator('[data-drill-read]');
  await expect(read).toBeVisible();
  await expect(page.locator('[data-drill-results]')).toBeHidden();
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-view', 'read');
  const p = await page.evaluate(() => window.NoteDrill.state.passage);
  await expect(page.locator('[data-drill-read-title]')).toHaveText(p.title);
  await expect(page.locator('[data-drill-read-question]')).toHaveText(p.respond);
  await expect(page.locator('[data-drill-read-score]')).toContainText('Copied at');
  const paras = await page.locator('[data-drill-read-text] p').allTextContents();
  expect(paras.length).toBeGreaterThan(1);
  expect(paras.join(' ')).toBe(p.text.replace(/\s+/g, ' ').trim());
  // The numbers are one key away, and the same key comes back.
  await page.keyboard.press('n');
  await expect(page.locator('[data-drill-results]')).toBeVisible();
  await expect(read).toBeHidden();
  await page.keyboard.press('n');
  await expect(read).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'respond');
  await expect(page.locator('[data-drill-q]')).toHaveText(p.respond);
  await expect(read).toBeHidden();
});

test('S shelves the passage: the next one starts, the shelf is saved, and home says what is on it', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({ mode: 'copy', copyDefault: true })));
  await page.goto(PAGE);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('The ', { delay: 10 });
  await done(page);
  const first = await page.evaluate(() => window.NoteDrill.state.passage);
  await page.keyboard.press('s');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'armed');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'copy');
  const next = await page.evaluate(() => window.NoteDrill.state.passage);
  expect(next.id).not.toBe(first.id);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('noaba.drills.settings.v1')));
  expect(saved.shelf).toHaveLength(1);
  expect(saved.shelf[0].id).toBe(first.id);
  expect(Object.keys(saved.shelf[0]).sort()).toEqual(['at', 'id', 'round', 'shown']);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-drill-shelf]')).toContainText('On the shelf (1)');
  await expect(page.locator('[data-drill-shelf]')).toContainText(first.title);
  await page.locator('.row [data-drill-open="map"]').click();
  await expect(page.locator('[data-drill-map-shelf]')).toContainText(first.title);
});

test('a shelved passage comes back the next day in new words, and leaves the shelf once copied', async ({ page }) => {
  await page.addInitScript(() => {
    const at = new Date(Date.now() - 2 * 86400000).toISOString();
    localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({ mode: 'copy', copyDefault: true, shelf: [{ id: 'p-wolf', at, round: 0, shown: 0 }] }));
  });
  await page.goto(PAGE);
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('[data-drill-category]')).toContainText('back from the shelf');
  const variant = await page.evaluate(() => import('./variants.js').then((m) => m.VARIANTS['p-wolf'][0]));
  const shown = (await page.locator('[data-drill-passage]').textContent()).replace(/\s+/g, ' ').trim();
  expect(shown).toBe(variant);
  const words = shown.split(' ');
  await page.locator('[data-drill-box]').pressSequentially(words.slice(0, 2).join(' ') + ' ', { delay: 10 });
  await done(page);
  const rec = await page.evaluate(() => window.NoteDrill.data.history.at(-1));
  expect(rec.passage).toBe('p-wolf');
  expect(rec.variant).toBe(1);
  expect(rec.fromShelf).toBe(true);
  await expect(page.locator('[data-drill-read-note]')).toContainText('Back from the shelf');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('noaba.drills.settings.v1')));
  expect(saved.shelf).toEqual([]);
});

test('the settle after the bell holds on the read screen too: Return and S do nothing for three seconds', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({ mode: 'copy', copyDefault: true })));
  await page.goto('/index.html?clock=2&settle');
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('The ', { delay: 10 });
  await done(page);
  await expect(page.locator('[data-drill-read]')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('s');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'copy');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'done');
  await expect(page.locator('main.drill')).not.toHaveAttribute('data-settling', '1', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'respond');
});

test('a bank question answered days ago comes back for review through a lens, and home says it is due', async ({ page }) => {
  await page.addInitScript(() => {
    const at = new Date(Date.now() - 5 * 86400000).toISOString();
    localStorage.setItem('noaba.drills.v1', JSON.stringify([{ at, minutes: 1, nwam: 80, gwam: 82, accuracy: 0.97, words: 82, keptWords: 80, mode: 'answer', outline: 'B.11', itemId: 'b-04' }]));
  });
  await page.goto(PAGE);
  await expect(page.locator('[data-drill-reviews]')).toContainText('1 question due for another look');
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('[data-drill-category]')).toContainText('review · steelman');
  await expect(page.locator('[data-drill-q]')).toContainText('Mom stopped giving candy for screaming');
  await expect(page.locator('[data-drill-q]')).toContainText('strongest case for the view you usually argue against');
  await page.locator('[data-drill-box]').pressSequentially('Extinction bursts are common and she can plan for one.', { delay: 10 });
  await done(page);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('noaba.drills.v1')).at(-1));
  expect(saved.review).toBe(true);
  expect(saved.lens).toBe('steelman');
  expect(saved.itemId).toBe('b-04');
  // Never two reviews in a row: the next one is a new question from the map.
  await page.keyboard.press('Escape');
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('[data-drill-category]')).not.toContainText('review');
});

/* ---- item 8: the nemesis drill, offered and never forced ------------------ */

test('home offers a thirty-second drill on his nemesis; it teaches the finger, stays out of history and earns its own trophy', async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now();
    // Eight drills that missed u on a quarter of its presses: nem-key-u is spotted on load.
    const rec = (i) => ({ at: new Date(now - (10 - i) * 3600000).toISOString(), minutes: 1, seconds: 60, nwam: 80, gwam: 84, accuracy: 0.96,
      words: 84, mode: 'answer', itemId: 'x', outline: 'B.1', keys: { u: { presses: 12, misses: 3 } } });
    if (!localStorage.getItem('noaba.drills.v1')) localStorage.setItem('noaba.drills.v1', JSON.stringify(Array.from({ length: 8 }, (_, i) => rec(i))));
  });
  await page.goto(PAGE);
  await wordsReady(page);
  const offer = page.locator('[data-drill-tame-home]');
  await expect(offer).toBeVisible();
  await expect(offer).toContainText('thirty seconds on it, if you like');
  // Offered, never forced: Start still runs an ordinary round.
  await expect(page.locator('[data-drill-start]')).toBeFocused();
  await page.keyboard.press('d');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'tame');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'armed');
  await expect(page.locator('[data-drill-category]')).toContainText('nemesis drill');
  await expect(page.locator('.tame-lesson')).toContainText('U is your right index finger, top row');
  await expect(page.locator('[data-drill-passage]')).toBeVisible();
  const text = await page.evaluate(() => window.NoteDrill.state.passage.text);
  expect(text.split(' ').filter((w) => w.includes('u')).length).toBeGreaterThanOrEqual(29);
  await page.locator('[data-drill-box]').pressSequentially(text.split(' ').slice(0, 4).join(' ') + ' ', { delay: 15 });
  await done(page);
  // Straight to the numbers: no read screen, nothing to keep, and the target's own line.
  await expect(page.locator('[data-drill-read]')).toBeHidden();
  await expect(page.locator('[data-drill-results]')).toBeVisible();
  await expect(page.locator('[data-drill-keep]')).toBeHidden();
  await expect(page.locator('[data-drill-next]')).toContainText(/U: \d+ missed of \d+ presses/);
  await expect(page.locator('[data-drill-keepnote]')).toContainText('practice only');
  await expect(page.locator('[data-unlocked="tame-n-1"]')).toContainText('Sparring Partner');
  const saved = await page.evaluate(() => ({ history: window.NoteDrill.data.history.length, tame: window.NoteDrill.data.settings.tame }));
  expect(saved.history).toBe(8);
  expect(saved.tame).toHaveLength(1);
  expect(saved.tame[0]).toMatchObject({ mode: 'tame', target: 'nem-key-u', minutes: 0.5 });
  expect(JSON.stringify(saved.tame)).not.toContain(text.split(' ')[0] + ' ');
  // Again runs a fresh drill on the same target; the button on the results offers it too.
  await expect(page.locator('[data-drill-tame]')).toContainText('Drill U');
  await expect(page.locator('[data-drill-again]')).toContainText('Again');
  await page.keyboard.press('Enter');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'tame');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'armed');
  await page.keyboard.press('Escape');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'idle');
  // The board counts the drill under its own group, and a reload keeps it.
  await page.reload();
  await wordsReady(page);
  await page.evaluate(() => window.NoteDrill.openBoard('trophies'));
  await expect(page.locator('[data-trophy="tame-n-1"]')).toBeVisible();
});

test('the results of an ordinary round offer the nemesis drill on D; with nothing to aim at there is no offer', async ({ page }) => {
  await page.goto(PAGE);
  await wordsReady(page);
  // A first launch: no history, no tricky key, no offer.
  await expect(page.locator('[data-drill-tame-home]')).toBeHidden();
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('the child ran home', { delay: 15 });
  await done(page);
  await expect(page.locator('[data-drill-tame]')).toBeHidden();
  await page.keyboard.press('d');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'done');
});

test('strict Shift judges capitals only: shifted symbols type with either Shift', async ({ page }) => {
  await page.goto('/index.html?clock=4');
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.focus();
  // ? is on a right-hand key and ! on a left-hand key; the same-side Shift must still type them.
  await page.keyboard.down('ShiftRight');
  await page.keyboard.press('Slash');
  await page.keyboard.up('ShiftRight');
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.press('Digit1');
  await page.keyboard.up('ShiftLeft');
  await expect(box).toHaveValue('?!');
  await expect(page.locator('[data-sidefx]')).not.toHaveAttribute('data-last-shift', 'refused');
});

test('a shelved passage that no longer exists is dropped, so the due one behind it still comes back', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({
    mode: 'copy', copyDefault: true,
    shelf: [{ id: 'p-retired', at: '2026-01-01T12:00:00Z', round: 0 }, { id: 'p-iwata', at: '2026-01-01T12:00:00Z', round: 0 }],
  })));
  await page.goto(PAGE);
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'copy');
  const st = await page.evaluate(() => ({ id: window.NoteDrill.state.passage.id, back: window.NoteDrill.state.passage.fromShelf, shelf: window.NoteDrill.data.settings.shelf.map((e) => e.id) }));
  expect(st.id).toBe('p-iwata');
  expect(st.back).toBe(true);
  expect(st.shelf).not.toContain('p-retired');
});

test('every screen opens at its top: focusing a button never scrolls the page down', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.addInitScript(() => localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({ mode: 'copy', copyDefault: true })));
  await page.goto('/index.html?clock=2');
  const box = page.locator('[data-drill-box]');
  const atTop = async (state) => {
    await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', state, { timeout: 10000 });
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(0);
  };
  await page.keyboard.press('Enter');
  await atTop('armed');
  await box.pressSequentially('Iwata ', { delay: 10 });
  await atTop('done'); // the read screen, taller than the window
  await page.keyboard.press('Enter');
  await atTop('armed');
  await box.pressSequentially('function first ', { delay: 10 });
  await atTop('done'); // the results, taller than the window
  await page.keyboard.press('c');
  await atTop('armed');
});

test('an answer left without a Keep is held: a nemesis or a new round later, Keep it and Send still reach it', async ({ page }) => {
  await page.addInitScript(() => {
    window.__kept = []; window.__sent = [];
    window.ClickClackMock = {
      keep: async (r) => { window.__kept.push(r); return { ok: true, corpus: 'Kept.', expert: 'Queued.' }; },
      expertStatus: async () => ({ connected: true, queued: window.__kept.length, note: 'Connected.' }),
      expertQueue: async () => ({ items: [] }),
      expertSent: async (s) => { window.__sent.push(...s); return { ok: true }; },
    };
  });
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('function comes first ', { delay: 10 });
  await done(page);
  await expect(page.locator('[data-drill-pending]')).toBeHidden();
  await page.keyboard.press('Enter'); // a new round, the answer not kept
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'armed');
  await expect(page.locator('[data-drill-pending]')).toBeHidden(); // never while typing
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-drill-pending]')).toBeVisible();
  await expect(page.locator('[data-drill-pending]')).toContainText('is not kept');
  await page.locator('[data-pending-keep="0"]').click();
  await expect(page.locator('[data-drill-pending]')).toBeHidden();
  const kept = await page.evaluate(() => window.__kept);
  expect(kept).toHaveLength(1);
  expect(kept[0].text).toContain('function comes first');
});

test('a slow pair opens the pair game: ten words, the clock, and a time to beat', async ({ page }) => {
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').focus();
  // "br" typed slowly, everything else quick: br is the slow pair.
  const box = page.locator('[data-drill-box]');
  for (const w of ['brisk', 'bread', 'brown', 'brick']) {
    await page.keyboard.press('KeyB'); await page.waitForTimeout(400);
    await box.pressSequentially(w.slice(1) + ' ', { delay: 15 });
  }
  await done(page);
  const go = page.locator('.pair-go[data-pair="br"]').first();
  await expect(go).toBeVisible();
  await go.click();
  const game = page.locator('[data-pairgame="br"]');
  await expect(game).toBeVisible();
  const words = await game.locator('.pg-word').allTextContents();
  expect(words).toHaveLength(10);
  expect(words.every((w) => w.includes('br'))).toBe(true);
  await game.locator('.pg-input').pressSequentially(words.join(' ') + ' ', { delay: 5 });
  await expect(game).toHaveAttribute('data-done', '1');
  await expect(game.locator('[data-pairgame-out]')).toContainText('The tortoise wins. 10 words in');
  await expect(game.locator('.pg-tortoise')).toHaveClass(/is-win/);
  const runs = await page.evaluate(() => window.NoteDrill.data.settings.games.pairs.br);
  expect(runs).toHaveLength(1);
  expect(runs[0].wpm).toBeGreaterThan(0);
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'done'); // no shortcut fired
  await game.locator('.pg-close').click();
  await expect(game).toHaveCount(0);
});

test('strict Shift in a copy round: the wrong-side Shift lights red on its side and green on the other, before the letter', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({ mode: 'copy', copyDefault: true })));
  await page.goto(PAGE);
  await page.locator('[data-drill-start]').click();
  const first = await page.evaluate(() => window.NoteDrill.state.passage.text.trim()[0]);
  await page.locator('[data-drill-box]').focus();
  // The first letter of a passage is a capital: hold the Shift on its own side.
  const hand = await page.evaluate((ch) => ('qwertasdfgzxcvb'.includes(ch.toLowerCase()) ? 'L' : 'R'), first);
  const wrong = hand === 'L' ? 'ShiftLeft' : 'ShiftRight';
  await page.keyboard.down(wrong);
  await expect(page.locator(`[data-side="${hand}"]`)).toHaveClass(/is-cue-bad/);
  await expect(page.locator(`[data-side="${hand === 'L' ? 'R' : 'L'}"]`)).toHaveClass(/is-cue-good/);
  await page.keyboard.up(wrong);
  await expect(page.locator(`[data-side="${hand}"]`)).not.toHaveClass(/is-cue-bad/);
});

test('a wrong-side Shift offers Shifty Shifts: twenty words, thirteen capitals, the car drives, and the run is saved', async ({ page }) => {
  await page.goto('/index.html?clock=4');
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').focus();
  // T with the left Shift: refused under strict Shift, so the round offers the game.
  await page.keyboard.down('ShiftLeft'); await page.keyboard.press('KeyT'); await page.keyboard.up('ShiftLeft');
  await page.locator('[data-drill-box]').pressSequentially('then more words ', { delay: 10 });
  await done(page);
  const go = page.locator('[data-shifty-offer] [data-shifty-go]');
  await expect(go).toBeVisible();
  await go.click();
  const game = page.locator('[data-shifty]');
  await expect(game).toBeVisible();
  await expect(game.locator('.sh-tach')).toBeVisible();
  const words = await game.locator('.pg-word').allTextContents();
  expect(words).toHaveLength(20);
  expect(words.filter((w) => /[A-Z]/.test(w))).toHaveLength(13);
  const input = game.locator('.pg-input');
  await input.focus();
  const left = 'qwertasdfgzxcvb';
  for (const ch of words.join(' ') + ' ') {
    if (/[A-Z]/.test(ch)) {
      const shift = left.includes(ch.toLowerCase()) ? 'ShiftRight' : 'ShiftLeft';
      await page.keyboard.down(shift); await page.keyboard.press('Key' + ch); await page.keyboard.up(shift);
    } else await page.keyboard.type(ch);
  }
  await expect(game).toHaveAttribute('data-done', '1');
  await expect(game.locator('[data-shifty-out]')).toContainText('0 wrong-side');
  await expect(game.locator('[data-shifty-out]')).toContainText('First run');
  const run = await page.evaluate(() => window.NoteDrill.data.settings.games.shifty[0]);
  expect(run.shifts).toBe(13);
  expect(run.wrong).toBe(0);
  expect(await page.evaluate(() => window.NoteDrill.data.history.length)).toBe(1); // never in history
});

test('the uneven-timing tip offers River Rhythm: an even beat keeps the kayak mid-river and wins', async ({ page }) => {
  await page.addInitScript(() => { window.__riverGoalS = 2; });
  await page.goto('/index.html?clock=6');
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.focus();
  // Uneven on purpose: alternate quick and slow letters so the rhythm tip fires.
  for (const w of ['behavior', 'function', 'reinforce', 'schedule']) {
    for (const [i, ch] of [...w].entries()) { await page.keyboard.type(ch); await page.waitForTimeout(i % 2 ? 260 : 25); }
    await page.keyboard.type(' ');
  }
  await done(page);
  const go = page.locator('[data-river-go]').first();
  await expect(go).toBeVisible();
  await go.click();
  const game = page.locator('[data-river]');
  await expect(game).toBeVisible();
  const input = game.locator('.pg-input');
  await input.focus();
  for (let i = 0; i < 40; i++) { await page.keyboard.type('a'); await page.waitForTimeout(90); }
  await expect(game).toHaveAttribute('data-done', '1', { timeout: 10000 });
  await expect(game.locator('[data-river-out]')).toContainText('You won in');
  const run = await page.evaluate(() => window.NoteDrill.data.settings.games.river[0]);
  expect(run.secs).toBeGreaterThan(0);
});

/* ---- one answer, one Keep (AUDIT A2, A5, A6, A7) ------------------------- */
const SLOW_KEEP = () => {
  window.__kept = [];
  window.ClickClackMock = {
    keep: async (r) => { window.__kept.push(r); await new Promise((ok) => setTimeout(ok, 300)); return { ok: true, corpus: 'Kept.', expert: 'Queued.' }; },
    expertStatus: async () => ({ connected: false, queued: window.__kept.length, note: 'Not connected.' }),
    expertQueue: async () => ({ items: [] }),
  };
};

test('K pressed twice while the Keep is on its way keeps the answer once', async ({ page }) => {
  await page.addInitScript(SLOW_KEEP);
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('function comes first ', { delay: 10 });
  await done(page);
  await page.keyboard.press('k');
  await page.keyboard.press('k');
  await expect(page.locator('[data-drill-keep]')).toHaveText('Kept');
  expect(await page.evaluate(() => window.__kept.length)).toBe(1);
});

test('an answer kept from the pending bar is not held again after Progress and Home, and a double click keeps it once', async ({ page }) => {
  await page.addInitScript(SLOW_KEEP);
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('function comes first ', { delay: 10 });
  await done(page);
  await page.keyboard.press('Escape');
  const bar = page.locator('[data-drill-pending]');
  await expect(bar).toBeVisible();
  await page.locator('[data-pending-keep="0"]').dblclick();
  await expect(bar).toBeHidden();
  expect(await page.evaluate(() => window.__kept.length)).toBe(1);
  await page.locator('.row [data-drill-open="trophies"]').click();
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'board');
  await page.keyboard.press('Escape');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'idle');
  await expect(bar).toBeHidden();
  expect(await page.evaluate(() => window.__kept.length)).toBe(1);
});

test('a failed Keep from the pending bar says so on the bar and leaves the answer held', async ({ page }) => {
  await page.addInitScript(() => {
    window.ClickClackMock = {
      keep: async () => ({ ok: false, note: 'The disk said no.' }),
      expertStatus: async () => ({ connected: false, queued: 0, note: 'Not connected.' }),
      expertQueue: async () => ({ items: [] }),
    };
  });
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('function comes first ', { delay: 10 });
  await done(page);
  await page.keyboard.press('Escape');
  await page.locator('[data-pending-keep="0"]').click();
  const bar = page.locator('[data-drill-pending]');
  await expect(bar).toContainText('The disk said no.');
  await expect(bar).toContainText('is not kept');
  await expect(page.locator('[data-pending-keep="0"]')).toBeEnabled();
});

test('the baton pass run twice at once keeps once and asks the expert once', async ({ page }) => {
  await page.addInitScript(BATON_MOCK);
  await page.addInitScript(() => localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({ mode: 'copy', copyDefault: true })));
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('The ', { delay: 10 });
  await done(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'respond');
  await box.pressSequentially('high p runs build momentum ', { delay: 10 });
  await done(page);
  await page.evaluate(() => Promise.all([window.NoteDrill.batonPass(), window.NoteDrill.batonPass()]));
  const out = await page.evaluate(() => ({ kept: window.__kept.length, baton: window.__calls.filter((c) => c.schema.properties.passage).length }));
  expect(out).toEqual({ kept: 1, baton: 1 });
});

test('a baton reply that quotes his answer is not used, so his words never reach the shelf (AUDIT A10)', async ({ page }) => {
  await page.addInitScript(BATON_MOCK);
  await page.addInitScript(() => {
    const ask = window.ClickClackMock.askClaude;
    window.ClickClackMock.askClaude = async (req) => {
      const r = await ask(req);
      if (req.schema.properties.passage) r.output.passage += ' As you said, high p runs build momentum before the hard ask every time.';
      return r;
    };
  });
  await page.addInitScript(() => localStorage.setItem('noaba.drills.settings.v1', JSON.stringify({ mode: 'copy', copyDefault: true })));
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('The ', { delay: 10 });
  await done(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'respond');
  await box.pressSequentially('high p runs build momentum before the hard ask every time ', { delay: 5 });
  await done(page);
  await page.evaluate(() => window.NoteDrill.batonPass());
  await expect(page.locator('[data-drill-keepnote]')).toContainText('quoted your answer');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'respond');
  expect(await page.evaluate(() => window.NoteDrill.state.passage.kind)).not.toBe('baton');
  expect(await page.evaluate(() => window.__kept.length)).toBe(1);
});

/* ---- keys inside a mini game stay in the game (AUDIT G1, G2) ------------- */
test('on a finished or open game, K and C on Close do nothing to the round, and Esc closes the game, not the results', async ({ page }) => {
  await page.addInitScript(SLOW_KEEP);
  await page.goto('/index.html?clock=4');
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').focus();
  await page.keyboard.down('ShiftLeft'); await page.keyboard.press('KeyT'); await page.keyboard.up('ShiftLeft');
  await page.locator('[data-drill-box]').pressSequentially('then more words ', { delay: 10 });
  await done(page);
  await page.locator('[data-shifty-offer] [data-shifty-go]').click();
  const game = page.locator('[data-shifty]');
  await game.locator('.pg-close').focus();
  for (const k of ['k', 'c', 'd', 's']) await page.keyboard.press(k);
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'done');
  expect(await page.evaluate(() => window.__kept.length)).toBe(0);
  await page.keyboard.press('Escape');
  await expect(game).toHaveCount(0);
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'done');
});

test('Esc on the pair race\'s Close, after the race, closes it and leaves the results', async ({ page }) => {
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').focus();
  const box = page.locator('[data-drill-box]');
  for (const w of ['brisk', 'bread', 'brown', 'brick']) {
    await page.keyboard.press('KeyB'); await page.waitForTimeout(400);
    await box.pressSequentially(w.slice(1) + ' ', { delay: 15 });
  }
  await done(page);
  await page.locator('.pair-go[data-pair="br"]').first().click();
  const game = page.locator('[data-pairgame="br"]');
  const words = await game.locator('.pg-word').allTextContents();
  await game.locator('.pg-input').pressSequentially(words.join(' ') + ' ', { delay: 5 });
  await expect(game).toHaveAttribute('data-done', '1');
  await expect(game.locator('.pg-close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(game).toHaveCount(0);
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'done');
});

/* ---- Keep going and the microphone (AUDIT A3, A4) ------------------------ */
const KEEP_MOCK = () => {
  window.__kept = [];
  window.ClickClackMock = {
    keep: async (r) => { window.__kept.push(r); return { ok: true, corpus: 'Kept.', expert: 'Queued.' }; },
    expertStatus: async () => ({ connected: false, queued: window.__kept.length, note: 'Not connected.' }),
    expertQueue: async () => ({ items: [] }),
  };
};

test('Keep going, then Esc mid-round: the finished answer is held on the bar, and Keep it keeps it', async ({ page }) => {
  await page.addInitScript(KEEP_MOCK);
  await page.goto('/index.html?clock=2');
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('function comes first ', { delay: 10 });
  await done(page);
  await page.keyboard.press('c');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'armed');
  const bar = page.locator('[data-drill-pending]');
  await box.pressSequentially('then', { delay: 10 });
  await page.keyboard.press('Escape');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'idle');
  await expect(bar).toBeVisible();
  await expect(bar.locator('.pending-row')).toHaveCount(1);
  await page.locator('[data-pending-keep="0"]').click();
  await expect(bar).toBeHidden();
  const kept = await page.evaluate(() => window.__kept);
  expect(kept).toHaveLength(1);
  expect(kept[0].text).toBe('function comes first ');
});

test('Keep going to the end: one row holds the whole answer, and a Keep of the last round clears the earlier one', async ({ page }) => {
  await page.addInitScript(KEEP_MOCK);
  await page.goto('/index.html?clock=2');
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('function comes first ', { delay: 10 });
  await done(page);
  await page.keyboard.press('c');
  await box.pressSequentially('then form ', { delay: 10 });
  await done(page);
  const bar = page.locator('[data-drill-pending]');
  await page.keyboard.press('Escape');
  await expect(bar.locator('.pending-row')).toHaveCount(1);
  // Keep it on the one row: the whole answer, once.
  await page.locator('[data-pending-keep="0"]').click();
  await expect(bar).toBeHidden();
  // And kept from the results screen instead: the earlier round is not left held.
  await page.locator('[data-drill-start]').click();
  await box.pressSequentially('reinforce the reply ', { delay: 10 });
  await done(page);
  await page.keyboard.press('c');
  await box.pressSequentially('right away ', { delay: 10 });
  await done(page);
  await page.keyboard.press('k');
  await expect(page.locator('[data-drill-keep]')).toHaveText('Kept');
  await page.keyboard.press('Escape');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'idle');
  await expect(bar).toBeHidden();
  const kept = await page.evaluate(() => window.__kept.map((k) => k.text));
  expect(kept).toEqual(['function comes first then form ', 'reinforce the reply right away ']);
});

test('Esc while talking turns the Mac microphone off', async ({ page }) => {
  await page.addInitScript(ORACLE_MOCK);
  await page.addInitScript(() => {
    window.__micStops = 0;
    const m = window.ClickClackMock;
    m.micStop = async () => { window.__micStops += 1; return { ok: true }; };
  });
  await page.goto('/index.html?clock=5');
  await page.locator('[data-drill-mode="oracle"]').click();
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'oracle');
  await page.locator('[data-drill-mic]').click();
  await expect(page.locator('[data-drill-mic]')).toHaveClass(/is-on/);
  await page.locator('[data-drill-box]').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'idle');
  await expect.poll(() => page.evaluate(() => window.__micStops)).toBe(1);
  await expect(page.locator('[data-drill-mic]')).not.toHaveClass(/is-on/);
  await expect(page.locator('[data-drill-mic]')).toHaveText('Talk');
});

test('words typed while talking stay in the box when the next spoken words arrive (AUDIT A12)', async ({ page }) => {
  await page.addInitScript(ORACLE_MOCK);
  await page.goto('/index.html?clock=30');
  await page.locator('[data-drill-mode="oracle"]').click();
  await page.locator('[data-drill-start]').click();
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-mode', 'oracle');
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('I start ', { delay: 10 });
  await page.locator('[data-drill-mic]').click();
  await expect(page.locator('[data-drill-mic]')).toHaveClass(/is-on/);
  await page.evaluate(() => window.ClickClack.speech({ text: 'with a pairing', final: false }));
  await expect(box).toHaveValue('I start with a pairing');
  await box.focus();
  await page.keyboard.press('End');
  await box.pressSequentially(' (typed)', { delay: 10 });
  // The recognizer's partials are cumulative: the next one repeats what it
  // already heard and adds the new words.
  await page.evaluate(() => window.ClickClack.speech({ text: 'with a pairing session first', final: false }));
  await expect(box).toHaveValue('I start with a pairing (typed) session first');
  await page.evaluate(() => window.ClickClack.speech({ text: 'with a pairing session first today', final: true }));
  await expect(box).toHaveValue('I start with a pairing (typed) session first today');
  await page.evaluate(() => window.ClickClack.speech({ text: 'then demands', final: false }));
  await expect(box).toHaveValue('I start with a pairing (typed) session first today then demands');
});

test('Keep going: the earlier round kept from the bar, then K on the last round sends only what came after', async ({ page }) => {
  await page.addInitScript(KEEP_MOCK);
  await page.goto('/index.html?clock=2');
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('function comes first ', { delay: 10 });
  await done(page);
  await page.keyboard.press('c');
  await box.pressSequentially('then form ', { delay: 10 });
  await done(page);
  const bar = page.locator('[data-drill-pending]');
  await expect(bar).toBeVisible();
  await page.locator('[data-pending-keep="0"]').click();
  await expect(bar).toBeHidden();
  await page.keyboard.press('k');
  await expect(page.locator('[data-drill-keep]')).toHaveText('Kept');
  const kept = await page.evaluate(() => window.__kept.map((k) => ({ text: k.text, continues: Boolean(k.continues) })));
  expect(kept).toEqual([{ text: 'function comes first ', continues: false }, { text: 'then form ', continues: true }]);
});

/* A1: the Mac shell asks the page how many answers would be lost before it
   quits or closes the window. Nothing is written by the asking. */
test('unkeptCount: a finished answer counts until Keep, a held row counts on home, a copy round never counts', async ({ page }) => {
  await page.addInitScript(KEEP_MOCK);
  await page.goto('/index.html?clock=2');
  await wordsReady(page);
  const count = () => page.evaluate(() => window.NoteDrill.unkeptCount());
  expect(await count()).toBe(0);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('function comes first ', { delay: 10 });
  // Still being written: quitting now would lose it too.
  expect(await count()).toBe(1);
  await done(page);
  expect(await count()).toBe(1);
  await page.keyboard.press('k');
  await expect.poll(() => page.evaluate(() => (window.__kept || []).length)).toBe(1);
  expect(await count()).toBe(0);
  await page.keyboard.press('Escape');
  // A second answer left without a Keep is held on the bar at home: still 1.
  await page.locator('[data-drill-start]').click();
  await box.pressSequentially('reinforce the reply ', { delay: 10 });
  await done(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-drill-pending] .pending-row')).toHaveCount(1);
  expect(await count()).toBe(1);
  expect(await page.evaluate(() => window.__kept.length)).toBe(1);
  await page.locator('[data-pending-keep="0"]').click();
  await expect(page.locator('[data-drill-pending]')).toBeHidden();
  expect(await count()).toBe(0);
  // A copy round is not his words, so it is never counted.
  await page.locator('[data-drill-mode="copy"]').click();
  await page.locator('[data-drill-start]').click();
  const words = (await page.locator('[data-drill-passage]').textContent()).trim().split(/\s+/);
  await box.pressSequentially(words[0] + ' ', { delay: 10 });
  expect(await count()).toBe(0);
  await done(page);
  expect(await count()).toBe(0);
});

test('unkeptCount: Keep going mid-round counts the answer once, not the held round and the live one', async ({ page }) => {
  await page.addInitScript(KEEP_MOCK);
  await page.goto('/index.html?clock=2');
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  const box = page.locator('[data-drill-box]');
  await box.pressSequentially('function comes first ', { delay: 10 });
  await done(page);
  await page.keyboard.press('c');
  await box.pressSequentially('then', { delay: 10 });
  expect(await page.evaluate(() => window.NoteDrill.unkeptCount())).toBe(1);
});

/* ---- busy, the board and typed fields (AUDIT S1, S2, S4, S5) ------------- */

test('Send from home puts the minute line back when it is done, not "Drafting from answer 1 of 1"', async ({ page }) => {
  await page.addInitScript(ORACLE_MOCK);
  await page.goto(PAGE);
  const pb = page.locator('[data-drill-pb]');
  const before = await pb.textContent();
  await page.evaluate(() => window.NoteDrill.sendToExpert());
  expect(await page.evaluate(() => window.__sent.length)).toBe(1);
  await expect(pb).toHaveText(before || '');
  await expect(page.locator('main.drill')).toHaveAttribute('data-busy', '');
});

test('a refused expertSent still clears busy, so the oracle, baton and Send work again', async ({ page }) => {
  await page.addInitScript(ORACLE_MOCK);
  await page.addInitScript(() => { window.ClickClackMock.expertSent = async () => { throw new Error('disk said no'); }; });
  await page.goto(PAGE);
  await page.evaluate(() => window.NoteDrill.sendToExpert().catch(() => {}));
  expect(await page.evaluate(() => window.NoteDrill.state.busy)).toBe(false);
  await expect(page.locator('main.drill')).toHaveAttribute('data-busy', '');
});

test('the trophy chip does nothing while a round is running, so the finish never yanks him off the board', async ({ page }) => {
  await page.goto(PAGE);
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').pressSequentially('function ', { delay: 10 });
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'running');
  await page.locator('[data-stat-trophies]').evaluate((b) => b.click());
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'running');
  await done(page);
});

test('typing in the admin-token field fires no shortcut, and Return in it connects', async ({ page }) => {
  await page.addInitScript(() => {
    window.__tokens = [];
    window.ClickClackMock = {
      expertToken: async (t) => { window.__tokens.push(t); return { ok: true }; },
      expertStatus: async () => ({ connected: false, queued: 0, note: 'Not connected.' }),
      expertQueue: async () => ({ items: [] }),
    };
  });
  await page.goto(PAGE);
  await page.locator('.row [data-drill-open="expert"]').click();
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'board');
  const field = page.locator('[data-drill-expert-token]');
  await field.focus();
  await page.keyboard.type('abc');
  await page.keyboard.press('Enter');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'board');
  await expect.poll(() => page.evaluate(() => window.__tokens)).toEqual(['abc']);
});

test('while the oracle or the expert is working, Return starts no round under it', async ({ page }) => {
  await page.goto(PAGE);
  await wordsReady(page);
  await page.evaluate(() => { window.NoteDrill.state.busy = true; });
  await page.locator('[data-drill-start]').focus();
  await page.keyboard.press('Enter');
  await page.locator('body').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('main.drill')).toHaveAttribute('data-drill-state', 'idle');
});

/* ---- one game at a time, and no timer outlives its game (AUDIT G3-G6) ---- */
// Live intervals by delay: River ticks every 100 ms, the hare idles every 1800 ms.
const TRACK_INTERVALS = () => {
  const live = new Map();
  const set = window.setInterval.bind(window), clear = window.clearInterval.bind(window);
  window.setInterval = (fn, ms, ...a) => { const id = set(fn, ms, ...a); live.set(id, ms); return id; };
  window.clearInterval = (id) => { live.delete(id); clear(id); };
  window.__liveIntervals = (ms) => [...live.values()].filter((x) => x === ms).length;
};

test('a second River open, a second game, or a hare closed before it idles leaves one game and no stray timer', async ({ page }) => {
  await page.addInitScript(TRACK_INTERVALS);
  await page.goto(PAGE);
  const counts = await page.evaluate(async () => {
    const { openRiver } = await import('/river.js');
    const { openPairGame } = await import('/pairgame.js');
    const { openShifty, buildShifty, shiftyPool } = await import('/shifty.js');
    const { PASSAGES } = await import('/passages.js');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const out = {};
    openRiver(host, { text: 'steady beat text' });
    openRiver(host, { text: 'steady beat text' });
    out.riverTimers = window.__liveIntervals(100);
    out.riverBoxes = host.querySelectorAll('[data-river]').length;
    // A different game closes River first: one game at a time.
    const built = buildShifty(shiftyPool(PASSAGES));
    out.built = !!built;
    if (built) openShifty(host, { built, judge: () => 'ok', handOf: () => 'L' });
    out.afterShifty = host.querySelectorAll('[data-minigame]').length;
    out.riverTimersAfterShifty = window.__liveIntervals(100);
    // The hare starts idling 1.1 s after the first key; Close before then.
    const box = openPairGame(host, { pair: 'br', words: ['brisk', 'bread'] });
    out.afterPair = host.querySelectorAll('[data-minigame]').length;
    const input = box.querySelector('.pg-input');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }));
    box.querySelector('.pg-close').click();
    await new Promise((r) => setTimeout(r, 1400));
    out.hareTimers = window.__liveIntervals(1800);
    out.left = host.querySelectorAll('[data-minigame]').length;
    return out;
  });
  expect(counts).toEqual({ built: true, riverTimers: 1, riverBoxes: 1, afterShifty: 1, riverTimersAfterShifty: 0, afterPair: 1, hareTimers: 0, left: 0 });
});

test('a game left open on the results is closed by Home and by the next round, and its timer stops', async ({ page }) => {
  await page.addInitScript(TRACK_INTERVALS);
  await page.goto('/index.html?clock=4');
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').focus();
  await page.keyboard.down('ShiftLeft'); await page.keyboard.press('KeyT'); await page.keyboard.up('ShiftLeft');
  await page.locator('[data-drill-box]').pressSequentially('then more words ', { delay: 10 });
  await done(page);
  // A River box put in the results the way its button does, then Home.
  await page.evaluate(async () => {
    const { openRiver } = await import('/river.js');
    openRiver(document.querySelector('[data-drill-results]'), { text: 'steady beat text' });
  });
  expect(await page.evaluate(() => window.__liveIntervals(100))).toBe(1);
  await page.locator('[data-drill-home]').click();
  await expect(page.locator('[data-minigame]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__liveIntervals(100))).toBe(0);
  // Shifty open on the results, then Again: the next round starts with no game box in it.
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').focus();
  await page.keyboard.down('ShiftLeft'); await page.keyboard.press('KeyT'); await page.keyboard.up('ShiftLeft');
  await page.locator('[data-drill-box]').pressSequentially('then more words ', { delay: 10 });
  await done(page);
  await page.locator('[data-shifty-offer] [data-shifty-go]').click();
  await expect(page.locator('[data-shifty]')).toHaveCount(1);
  await page.evaluate(() => document.querySelector('[data-drill-again]').click());
  await expect(page.locator('[data-minigame]')).toHaveCount(0);
});

/* ---- a run finishes on the right words, with a clock (AUDIT G7, G12, G15) ---- */
test('a pair race or Shifty run with wrong words, or with no key typed, is not finished or saved', async ({ page }) => {
  await page.goto(PAGE);
  const out = await page.evaluate(async () => {
    const { openPairGame } = await import('/pairgame.js');
    const { openShifty, buildShifty, shiftyPool } = await import('/shifty.js');
    const { PASSAGES } = await import('/passages.js');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const typeInto = (input, value) => {
      for (const ch of value) input.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const r = {};
    // Twenty quick spaces: every word wrong. No run, a line saying what to fix.
    const pairRuns = [];
    let box = openPairGame(host, { pair: 'br', words: ['brisk', 'bread', 'broad'], onResult: (x) => pairRuns.push(x) });
    let input = box.querySelector('.pg-input');
    typeInto(input, 'x y z ');
    r.pairDoneWrong = box.dataset.done || '';
    r.pairLine = box.querySelector('[data-pairgame-out]').textContent;
    // Fix the words: now it finishes and saves one run.
    typeInto(input, 'brisk bread broad ');
    r.pairDoneRight = box.dataset.done || '';
    r.pairRuns = pairRuns.length;
    // Text with no key at all (e.g. dictation): the clock never started.
    box = openPairGame(host, { pair: 'br', words: ['brisk'], onResult: (x) => pairRuns.push(x) });
    input = box.querySelector('.pg-input');
    input.value = 'brisk ';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    r.noClockDone = box.dataset.done || '';
    r.noClockLine = box.querySelector('[data-pairgame-out]').textContent;
    r.pairRunsAfter = pairRuns.length;
    // Shifty: all spaces, no run.
    const built = buildShifty(shiftyPool(PASSAGES));
    const shRuns = [];
    box = openShifty(host, { built, judge: () => 'ok', handOf: () => 'L', onResult: (x) => shRuns.push(x) });
    input = box.querySelector('.pg-input');
    typeInto(input, ' '.repeat(built.words.length));
    r.shiftyDoneWrong = box.dataset.done || '';
    r.shiftyLine = box.querySelector('[data-shifty-out]').textContent;
    typeInto(input, built.words.join(' ') + ' ');
    r.shiftyDoneRight = box.dataset.done || '';
    r.shiftyRuns = shRuns.length;
    return r;
  });
  expect(out.pairDoneWrong).toBe('');
  expect(out.pairLine).toContain('3 words do not match');
  expect(out.pairDoneRight).toBe('1');
  expect(out.pairRuns).toBe(1);
  expect(out.noClockDone).toBe('');
  expect(out.noClockLine).toContain('The clock did not start');
  expect(out.pairRunsAfter).toBe(1);
  expect(out.shiftyDoneWrong).toBe('');
  expect(out.shiftyLine).toContain('words do not match');
  expect(out.shiftyDoneRight).toBe('1');
  expect(out.shiftyRuns).toBe(1);
});

test('keys typed into a game in the settle after the bell reach the game', async ({ page }) => {
  await page.addInitScript(() => { window.__settleMs = 3000; });
  await page.goto('/index.html?clock=3&settle');
  await wordsReady(page);
  await page.locator('[data-drill-start]').click();
  await page.locator('[data-drill-box]').focus();
  await page.keyboard.down('ShiftLeft'); await page.keyboard.press('KeyT'); await page.keyboard.up('ShiftLeft');
  await page.locator('[data-drill-box]').pressSequentially('then more words ', { delay: 10 });
  await done(page);
  await page.locator('[data-shifty-offer] [data-shifty-go]').click();
  const input = page.locator('[data-shifty] .pg-input');
  await input.focus();
  await page.keyboard.type('abc');
  await expect(input).toHaveValue('abc');
});
