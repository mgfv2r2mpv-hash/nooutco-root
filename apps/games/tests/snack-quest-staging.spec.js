import { test, expect } from '@playwright/test';
import {
  bootstrap, peek, chooseTask, choosePlace,
  respondCorrect, waitIdle, waitForQuestion,
} from './lib/snack-quest.js';

/**
 * The learner has to see who they are helping, and what for.
 *
 * The trial card covers the whole stage. It used to be raised in the same frame
 * the scene was built, so the character and the snack were behind it from the
 * first moment: the learner met our friend only after a trial was already
 * over, and answered without ever having seen which snack was at stake or
 * where it was. These pin the order — scene first, question second.
 */

test.describe('Snack Quest — the character is present before the question', () => {
  test('our friend is on the choosing screen, while the place is being picked', async ({ page }) => {
    await bootstrap(page);
    await chooseTask(page, 'matching');

    const friend = page.locator('#screen-place .story-friend');
    await expect(friend, 'he is on the page the learner is choosing for').toBeVisible();

    const box = await friend.boundingBox();
    expect(box.width, 'and big enough to actually read as him').toBeGreaterThan(60);
    // A broken <img> still reports a box, so check the bitmap really decoded.
    const loaded = await friend.evaluate((img) => img.complete && img.naturalWidth > 0);
    expect(loaded, 'his picture actually loaded').toBe(true);
  });

  test('the stage is unobscured before the first question arrives', async ({ page }) => {
    await bootstrap(page);
    await chooseTask(page, 'matching');
    await page.click('#place-tiles .choice-tile[data-place="playroom"]');
    await page.waitForFunction(() => window.__sq.peek().screen === 'quest');

    // Hold the stage long enough to be seen. Asserting the card is hidden on
    // the very first frame would pass on nothing more than the raise not having
    // been scheduled yet, so this samples across a real window: the scene must
    // still be clear well after the point the old build had already covered it.
    const samples = [];
    for (let i = 0; i < 5; i++) {
      samples.push(await page.locator('#trial-card').isHidden());
      await page.waitForTimeout(120);
    }
    expect(samples.every(Boolean), 'the scene stays clear for a beat, not a frame').toBe(true);

    await expect(page.locator('#walker'), 'our friend is on the stage').toBeVisible();
    await expect(page.locator('#food'), 'and so is the snack he is going for').toBeVisible();

    // …and it does arrive, shortly.
    await waitForQuestion(page);
    await expect(page.locator('#trial-card')).toBeVisible();
  });

  test('every later round also opens with the scene to itself', async ({ page }) => {
    test.setTimeout(60_000);
    await bootstrap(page, { goalTokens: 4, scheduleType: 'FR', scheduleValue: 1 });
    await chooseTask(page, 'matching');
    await choosePlace(page, 'playroom');

    await respondCorrect(page);
    await waitIdle(page);

    // Between the walk finishing and the next question, the stage is clear.
    expect((await peek(page)).awaitingAnswer, 'the next question is not up yet').toBe(false);
    await expect(page.locator('#trial-card')).toBeHidden();
    await expect(page.locator('#food'), 'the next snack has already landed').toBeVisible();

    await waitForQuestion(page);
    await expect(page.locator('#trial-card')).toBeVisible();
  });

  test('the receptive word is spoken with the array, not over a bare scene', async ({ page }) => {
    await bootstrap(page);

    // Record every utterance and the moment it was requested, against whether
    // the trial card was up at that moment.
    await page.addInitScript(() => {
      window.__spoken = [];
      const realSpeak = window.speechSynthesis && window.speechSynthesis.speak;
      if (!realSpeak) return;
      window.speechSynthesis.speak = function (u) {
        const card = document.getElementById('trial-card');
        window.__spoken.push({
          text: u && u.text,
          cardUp: !!card && !card.hidden,
          picks: document.querySelectorAll('#trial-grid .pick').length,
        });
      };
    });
    await page.reload();
    await page.waitForFunction(() => !!window.__sq && window.__sq.peek().screen === 'task');

    // Speech is off in the shared bootstrap; turn it on the way a technician would.
    await page.click('#btn-extra-toggle');
    await page.check('#chk-speak');
    await page.click('#btn-extra-close');

    await chooseTask(page, 'receptive');
    await page.click('#place-tiles .choice-tile[data-place="playroom"]');
    await page.waitForFunction(() => window.__sq.peek().screen === 'quest');

    // Nothing may be said while the scene is still settling.
    await page.waitForTimeout(500);
    const early = await page.evaluate(() => window.__spoken.slice());
    expect(early, 'the word is not said before the card carrying it exists').toEqual([]);

    await waitForQuestion(page);
    await page.waitForFunction(() => window.__spoken.length > 0, null, { timeout: 8000 });

    const spoken = await page.evaluate(() => window.__spoken.slice());
    expect(spoken.length).toBeGreaterThan(0);
    expect(spoken[0].cardUp, 'it is spoken with the card up').toBe(true);
    expect(spoken[0].picks, 'and with pictures to respond to').toBeGreaterThan(0);
    expect(spoken[0].text, 'and it is the target word').toBe((await peek(page)).targetLabel);
  });

  test('he turns to face the snack while the learner is looking at it', async ({ page }) => {
    await bootstrap(page);
    await chooseTask(page, 'matching');
    await page.click('#place-tiles .choice-tile[data-place="playroom"]');
    await page.waitForFunction(() => window.__sq.peek().screen === 'quest');
    await waitForQuestion(page);

    const p = await peek(page);
    const facing = await page.locator('#walker-img').evaluate(
      (img) => getComputedStyle(img).transform,
    );
    // scaleX(-1) shows as a leading '-1' in the matrix; scaleX(1) as '1'.
    const flipped = facing.startsWith('matrix(-');
    const snackIsLeft = p.foodCentreX < p.friendCentreX;
    expect(flipped, 'he looks toward the snack, not away from it').toBe(snackIsLeft);
  });
});
