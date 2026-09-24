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
    expertQueue: async () => ({ items: window.__kept.map((k) => ({ at: k.at, question: k.question, answer: k.text, mode: k.mode })) }),
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
