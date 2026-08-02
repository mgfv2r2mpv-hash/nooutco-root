import { test, expect } from '@playwright/test';
import { bootstrap, chooseTask, choosePlace, respondCorrect, waitIdle } from './lib/snack-quest.js';

/**
 * The character is never named. The artwork resembles a trademarked character;
 * free use with no commercial intent is fine, a name is not. He is "our friend"
 * / "he" / "him" in every user-visible surface.
 *
 * This is asserted *positively* — no candidate name is written down here, since
 * that would put one in the repository, which is the thing being prevented.
 * Instead every capitalised word on a learner- or technician-facing surface has
 * to come from the game's own known vocabulary. A stray proper noun fails.
 */

const ALLOWED = new Set([
  // Product + chrome
  'Snack', 'Quest', 'Games', 'Outcome', 'ABA', 'Options', 'Settings', 'Topic',
  'Array', 'Size', 'Targets', 'Main', 'Skip', 'Home', 'Tools', 'Admin', 'Back',
  'Tact',
  // Tasks
  'Matching', 'Receptive', 'Expressive',
  // Places
  'Playroom', 'Party', 'Sky', 'Countryside',
  // Story + trial copy
  'Our', 'Let', 'First', 'Where', 'What', 'Find', 'Touch', 'Look', 'Pick', 'Hear', 'One',
  'Cozy', 'Food', 'Out', 'Prompt', 'Change', 'End', 'Round', 'Snacks',
  'Technician', 'Help', 'Choice', 'Choose', 'Picture', 'Progress', 'Tracker',
  // Praise pool
  'You', 'Your', 'Match', 'Every', 'Sharing', 'Word', 'Now', 'Better',
  // Scoring + results
  'Correct', 'Prompted', 'Incorrect', 'Session', 'Results', 'Trials', 'Task',
  'Place', 'Target', 'Time', 'Outcome', 'Play', 'Again', 'Open', 'Printable',
  'Clear', 'Data', 'Finish', 'Only',
  // Token board
  'Token', 'Board', 'Schedule', 'Fixed', 'Ratio', 'Variable', 'Starting',
  'Tokens', 'Goal', 'Emoji', 'Random', 'Star', 'Diamond', 'Gem', 'Sparkle',
  'Gift', 'Trophy', 'Dizzy', 'Glowing', 'Speak', 'The',
]);

/**
 * Capitalised words on a surface that are not part of the game's own
 * vocabulary.
 *
 * Markup is flattened by replacing tags with spaces rather than read through
 * `innerText`, for two reasons: `innerText` on a detached clone falls back to
 * `textContent` and welds adjacent blocks into one word, and on an attached
 * one it applies `text-transform: uppercase`, which destroys the very
 * capitalisation this scan keys off.
 */
async function strayProperNouns(page, selector, exclude = []) {
  return page.evaluate(
    ({ selector, exclude, allowed }) => {
      const root = document.querySelector(selector);
      if (!root) return ['<missing surface: ' + selector + '>'];
      const clone = root.cloneNode(true);
      exclude.forEach((sel) => clone.querySelectorAll(sel).forEach((n) => n.remove()));
      const text = clone.innerHTML
        .replace(/<[^>]*>/g, ' ')
        .replace(/&[a-z]+;|&#\d+;/gi, ' ');
      const words = text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [];
      const allow = new Set(allowed);
      return [...new Set(words.filter((w) => !allow.has(w)))];
    },
    { selector, exclude, allowed: [...ALLOWED] }
  );
}

test.describe('Snack Quest — our friend is never named', () => {
  test('the task and place screens name no character', async ({ page }) => {
    await bootstrap(page);
    expect(await strayProperNouns(page, '#screen-task')).toEqual([]);
    await expect(page.locator('#screen-task')).toContainText(/our friend/i);

    await chooseTask(page, 'matching');
    expect(await strayProperNouns(page, '#screen-place')).toEqual([]);
    await expect(page.locator('#screen-place')).toContainText(/our friend/i);
  });

  test('the quest and final screens name no character', async ({ page }) => {
    await bootstrap(page, { goalTokens: 2 });
    await chooseTask(page, 'matching');
    await choosePlace(page, 'playroom');

    expect(await strayProperNouns(page, '#screen-quest')).toEqual([]);

    for (let i = 0; i < 2; i++) { await respondCorrect(page); await waitIdle(page); }
    await expect(page.locator('#screen-done')).toBeVisible();

    // The results grid legitimately names stimulus targets, so it is excluded;
    // everything a learner reads is not.
    expect(await strayProperNouns(page, '#screen-done', ['.results-wrap'])).toEqual([]);
    // The praise pool varies per quest; every phrasing refers to him as
    // "our friend", "he" or "him" and none of them may name him.
    await expect(page.locator('#done-praise')).toContainText(/\bour friend\b|\bhe\b|\bhim\b/i);
  });

  test('no accessible name for the artwork names him either', async ({ page }) => {
    await bootstrap(page);
    await chooseTask(page, 'expressive');
    await choosePlace(page, 'countryside');

    // Scoped to this game's own surfaces; the shared nav bar and header chrome
    // are not Snack Quest's copy to police.
    const names = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#quest-main img, #quest-main [aria-label], #quest-main [title], #quest-main [alt]'))
        .flatMap((n) => ['alt', 'title', 'aria-label'].map((a) => n.getAttribute(a)))
        .filter(Boolean));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const stray = (name.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || []).filter((w) => !ALLOWED.has(w));
      expect(stray, `accessible name "${name}" introduces a proper noun`).toEqual([]);
    }
    await expect(page.locator('#walker-img')).toHaveAttribute('alt', 'Our friend');
  });

  test('the games index card names no character', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('a.card[href="./snack-quest/"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText(/our friend/i);
    expect(await strayProperNouns(page, 'a.card[href="./snack-quest/"]')).toEqual([]);
  });
});
