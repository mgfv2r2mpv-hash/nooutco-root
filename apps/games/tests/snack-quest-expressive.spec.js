import { test, expect } from '@playwright/test';
import { bootstrap, chooseTask, choosePlace, peek, waitIdle } from './lib/snack-quest.js';

/**
 * The clinical point of expressive mode is that the learner *names* the
 * picture. If the word is anywhere on the page they can read the answer
 * instead, so this is asserted against the real page content rather than
 * assumed from the markup.
 */
test.describe('Snack Quest - expressive hides the target word', () => {
  test('the target word appears nowhere in the DOM on an expressive trial', async ({ page }) => {
    await bootstrap(page, { goalTokens: 3 });
    await chooseTask(page, 'expressive');
    await choosePlace(page, 'sky');

    const { targetLabel } = await peek(page);
    expect(targetLabel, 'the game must actually have a target to hide').toBeTruthy();

    // Word-boundary match: the word itself must not be readable anywhere - // not as text, not in an attribute, not in the serialised document.
    const word = new RegExp(`\\b${targetLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

    const html = await page.content();
    expect(html, `serialised page still contains "${targetLabel}"`).not.toMatch(word);

    const visible = await page.locator('body').innerText();
    expect(visible, `visible text still contains "${targetLabel}"`).not.toMatch(word);

    const attrs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('*')).flatMap((n) =>
        ['alt', 'title', 'aria-label', 'aria-description', 'placeholder', 'value', 'src', 'href']
          .map((a) => n.getAttribute(a))
          .filter(Boolean)));
    for (const value of attrs) {
      expect(value, `attribute "${value}" leaks the target word`).not.toMatch(word);
    }
  });

  test('the stimulus renders as a field of one and the path never reaches an attribute', async ({ page }) => {
    await bootstrap(page, { goalTokens: 3 });
    await chooseTask(page, 'expressive');
    await choosePlace(page, 'countryside');

    const picks = page.locator('#trial-grid .pick');
    await expect(picks).toHaveCount(1);

    const img = page.locator('#trial-grid .pick img');
    await expect(img).toHaveJSProperty('naturalWidth', await img.evaluate(async (n) => {
      if (n.complete && n.naturalWidth) return n.naturalWidth;
      await new Promise((r) => n.addEventListener('load', r, { once: true }));
      return n.naturalWidth;
    }));
    const src = await img.getAttribute('src');
    expect(src, 'the stimulus is served from an object URL so the filename cannot leak')
      .toMatch(/^blob:/);
    expect(await img.getAttribute('alt')).toBe('A picture to name');

    // The sample slot that receptive/matching use stays empty here.
    await expect(page.locator('#trial-sample')).toBeHidden();
    await expect(page.locator('#trial-prompt')).toHaveText('What is it?');
  });

  test('receptive, by contrast, does show its word', async ({ page }) => {
    await bootstrap(page, { goalTokens: 3 });
    await chooseTask(page, 'receptive');
    await choosePlace(page, 'sky');

    const { targetLabel } = await peek(page);
    await expect(page.locator('#trial-sample .sample-word')).toHaveText(targetLabel);
  });

  test('the word stays hidden across several expressive trials', async ({ page }) => {
    await bootstrap(page, { goalTokens: 4, scheduleValue: 2 });
    await chooseTask(page, 'expressive');
    await choosePlace(page, 'party');

    const seen = new Set();
    for (let i = 0; i < 4; i++) {
      const { targetLabel } = await peek(page);
      seen.add(targetLabel);
      const word = new RegExp(`\\b${targetLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      // Only the trial surface is checked from round 2 on: the results grid is
      // technician-facing and is meant to name every target.
      const card = await page.locator('#trial-card').innerHTML();
      expect(card).not.toMatch(word);
      await page.click('.score-btn[data-score="correct"]');
      await waitIdle(page);
      if (await page.locator('#screen-done').isVisible()) break;
    }
    expect(seen.size, 'the sample deck should not repeat before the topic is exhausted')
      .toBeGreaterThan(1);
  });
});
