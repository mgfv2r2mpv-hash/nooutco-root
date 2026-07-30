import { test, expect } from '@playwright/test';
import { bootstrap, chooseTask, choosePlace, respondCorrect, peek, waitIdle } from './lib/snack-quest.js';

test.describe('Snack Quest — task → place → quest', () => {
  for (const task of ['matching', 'receptive', 'expressive']) {
    test(`${task} reaches a trial`, async ({ page }) => {
      await bootstrap(page);
      await chooseTask(page, task);
      await choosePlace(page, 'playroom');

      await expect(page.locator('#screen-quest')).toBeVisible();
      await expect(page.locator('#trial-card')).toBeVisible();
      await expect(page.locator('#stage-scene')).toHaveAttribute('src', /playroom\.webp$/);

      if (task === 'expressive') {
        await expect(page.locator('#trial-prompt')).toHaveText('What is it?');
        await expect(page.locator('#trial-grid .pick')).toHaveCount(1);
        await expect(page.locator('#score-row')).toBeVisible();
      } else {
        await expect(page.locator('#trial-grid .pick')).toHaveCount(3);
        await expect(page.locator('#score-row')).toBeHidden();
        await expect(page.locator('#trial-sample')).toBeVisible();
      }

      const s = await peek(page);
      expect(s.task).toBe(task);
      expect(s.place).toBe('playroom');
      expect(s.round).toBe(1);
    });
  }

  test('the place screen offers all four places and can go back to the task screen', async ({ page }) => {
    await bootstrap(page);
    await chooseTask(page, 'matching');
    await expect(page.locator('#place-tiles .choice-tile')).toHaveCount(4);
    for (const id of ['playroom', 'party', 'sky', 'countryside']) {
      await expect(page.locator(`#place-tiles .choice-tile[data-place="${id}"]`)).toBeVisible();
    }
    await page.click('#btn-back-to-task');
    await expect(page.locator('#screen-task')).toBeVisible();
  });
});

test.describe('Snack Quest — movement is driven by the schedule', () => {
  test('FR1 delivers on every correct round', async ({ page }) => {
    await bootstrap(page, { scheduleValue: 1, goalTokens: 3 });
    await chooseTask(page, 'matching');
    await choosePlace(page, 'countryside');

    for (let i = 1; i <= 3; i++) {
      const before = await peek(page);
      expect(before.collected.length).toBe(i - 1);
      await respondCorrect(page);
      await waitIdle(page);
      if (i < 3) {
        const after = await peek(page);
        expect(after.collected.length).toBe(i);
      }
    }
    await expect(page.locator('#screen-done')).toBeVisible();
  });

  test('FR3 moves him partway on rounds 1–2 and delivers on round 3', async ({ page }) => {
    await bootstrap(page, { scheduleValue: 3, goalTokens: 2 });
    await chooseTask(page, 'matching');
    await choosePlace(page, 'countryside');

    const start = await peek(page);
    expect(start.collected).toHaveLength(0);

    // Round 1 — no delivery, but he must still have covered ground.
    await respondCorrect(page);
    await waitIdle(page);
    const r1 = await peek(page);
    expect(r1.collected).toHaveLength(0);
    expect(Math.abs(r1.friendCentreX - start.friendCentreX)).toBeGreaterThan(4);
    expect(Math.abs(r1.friendCentreX - r1.foodCentreX)).toBeGreaterThan(r1.friendHalfW + r1.foodHalfW);

    // Round 2 — still no delivery, still moving.
    await respondCorrect(page);
    await waitIdle(page);
    const r2 = await peek(page);
    expect(r2.collected).toHaveLength(0);
    expect(Math.abs(r2.friendCentreX - r1.friendCentreX)).toBeGreaterThan(4);

    // Round 3 — the schedule reinforces: he arrives and the food is collected.
    const foodBefore = r2.foodCentreX;
    await respondCorrect(page);
    await waitIdle(page);
    const r3 = await peek(page);
    expect(r3.collected).toHaveLength(1);
    // "Arrived" = standing against the food he was walking to, not near it.
    const touching = r3.friendHalfW + r2.foodHalfW + r2.stageW * 0.02;
    expect(Math.abs(r3.friendCentreX - foodBefore)).toBeLessThan(touching);
  });

  test('the honey is always the last item collected', async ({ page }) => {
    await bootstrap(page, { scheduleValue: 1, goalTokens: 4 });
    await chooseTask(page, 'matching');
    await choosePlace(page, 'party');

    const plan = await peek(page);
    expect(plan.foodTotal).toBe(4);

    for (let i = 0; i < 4; i++) {
      await respondCorrect(page);
      await waitIdle(page);
    }
    const done = await peek(page);
    expect(done.collected).toHaveLength(4);
    expect(done.collected[3]).toBe('honey');
    expect(done.collected.slice(0, 3)).not.toContain('honey');
  });

  test('with the token board switched off every correct round delivers', async ({ page }) => {
    // The board is this game's quest engine, but a technician can still turn it
    // off; the quest has to stay playable rather than stall with nothing to do.
    await bootstrap(page, { goalTokens: 2 });
    await page.evaluate(() => {
      const chk = document.getElementById('chk-token-board');
      chk.checked = false;
      chk.dispatchEvent(new Event('change'));
    });
    await chooseTask(page, 'matching');
    await choosePlace(page, 'playroom');

    await respondCorrect(page);
    await waitIdle(page);
    expect((await peek(page)).collected).toHaveLength(1);
    await respondCorrect(page);
    await waitIdle(page);
    await expect(page.locator('#screen-done')).toBeVisible();
    await expect(page.locator('#done-food img')).toHaveCount(2);
    // No board means no goal class, so the SR button correctly stays away.
    await expect(page.locator('#btn-finish-sr')).toBeHidden();
  });

  test('an incorrect response gains no ground and never delivers', async ({ page }) => {
    await bootstrap(page, { scheduleValue: 1, goalTokens: 3 });
    await chooseTask(page, 'expressive');
    await choosePlace(page, 'sky');

    const before = await peek(page);
    await page.click('.score-btn[data-score="incorrect"]');
    await waitIdle(page);
    const after = await peek(page);

    expect(after.collected).toHaveLength(0);
    // Ground gained is the reinforcer, so an error must not buy any of it. He
    // waddles on the spot instead, which the position cannot distinguish from
    // standing still — that is the point.
    expect(Math.abs(after.friendCentreX - before.friendCentreX)).toBeLessThan(1);
    expect(Math.abs(after.friendCentreX - after.foodCentreX))
      .toBeCloseTo(Math.abs(before.friendCentreX - before.foodCentreX), 0);
  });

  test('errors never accumulate ground across a run of them', async ({ page }) => {
    await bootstrap(page, { scheduleValue: 1, goalTokens: 3 });
    await chooseTask(page, 'expressive');
    await choosePlace(page, 'sky');

    const before = await peek(page);
    for (let i = 0; i < 4; i++) {
      await page.click('.score-btn[data-score="incorrect"]');
      await waitIdle(page);
    }
    const after = await peek(page);

    // Four errors in a row must leave him exactly where he started; a per-error
    // nudge that looked negligible once would have carried him most of the way.
    expect(after.collected).toHaveLength(0);
    expect(Math.abs(after.friendCentreX - before.friendCentreX)).toBeLessThan(1);
  });

  test('a prompted response is recorded as prompted and does not advance the ratio', async ({ page }) => {
    await bootstrap(page, { scheduleValue: 1, goalTokens: 3 });
    await chooseTask(page, 'expressive');
    await choosePlace(page, 'sky');

    await page.click('.score-btn[data-score="prompted"]');
    await waitIdle(page);
    const after = await peek(page);
    expect(after.collected).toHaveLength(0);

    const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('nooutco.results.snackQuest') || '[]'));
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe('Prompted');
    expect(rows[0].prompted).toBe(true);
  });
});

test.describe('Snack Quest — the final screen', () => {
  test('shows the chosen place artwork with the collected food in front of it', async ({ page }) => {
    await bootstrap(page, { scheduleValue: 1, goalTokens: 3 });
    await chooseTask(page, 'receptive');
    await choosePlace(page, 'sky');

    for (let i = 0; i < 3; i++) {
      await respondCorrect(page);
      await waitIdle(page);
    }

    await expect(page.locator('#screen-done')).toBeVisible();
    await expect(page.locator('#done-final')).toHaveAttribute('src', /finals\/sky\.webp$/);
    await expect(page.locator('#done-food img')).toHaveCount(3);
    await expect(page.locator('#done-food img').last()).toHaveAttribute('src', /honey\.webp$/);

    // The food composites in front of the artwork, not behind it.
    const order = await page.evaluate(() => {
      const art = document.getElementById('done-art');
      const kids = Array.from(art.children);
      return { finalIdx: kids.indexOf(document.getElementById('done-final')),
               foodIdx: kids.indexOf(document.getElementById('done-food')) };
    });
    expect(order.foodIdx).toBeGreaterThan(order.finalIdx);

    const artBox = await page.locator('#done-art').boundingBox();
    const foodBox = await page.locator('#done-food img').first().boundingBox();
    expect(foodBox.width).toBeGreaterThan(8);
    expect(foodBox.y + foodBox.height).toBeLessThanOrEqual(artBox.y + artBox.height + 2);

    await expect(page.locator('#done-praise')).not.toBeEmpty();
    await expect(page.locator('#btn-finish-sr')).toBeVisible();
  });
});

test.describe('Snack Quest — session results', () => {
  test('accumulate across two playthroughs with different tasks', async ({ page }) => {
    await bootstrap(page, { scheduleValue: 1, goalTokens: 2 });

    await chooseTask(page, 'matching');
    await choosePlace(page, 'playroom');
    for (let i = 0; i < 2; i++) { await respondCorrect(page); await waitIdle(page); }
    await expect(page.locator('#screen-done')).toBeVisible();
    await expect(page.locator('#results-body tr')).toHaveCount(2);

    await page.click('#btn-play-again');
    await chooseTask(page, 'expressive');
    await choosePlace(page, 'countryside');
    for (let i = 0; i < 2; i++) {
      await page.click('.score-btn[data-score="correct"]');
      await waitIdle(page);
    }
    await expect(page.locator('#screen-done')).toBeVisible();
    await expect(page.locator('#results-body tr')).toHaveCount(4);

    const rows = await page.locator('#results-body tr').allInnerTexts();
    expect(rows.filter((r) => r.includes('Matching'))).toHaveLength(2);
    expect(rows.filter((r) => r.includes('Expressive'))).toHaveLength(2);
    expect(rows.filter((r) => r.includes('Playroom'))).toHaveLength(2);
    expect(rows.filter((r) => r.includes('Countryside'))).toHaveLength(2);
  });

  test('survive a reload and are wiped by Clear data', async ({ page }) => {
    await bootstrap(page, { scheduleValue: 1, goalTokens: 2 });
    await chooseTask(page, 'matching');
    await choosePlace(page, 'playroom');
    for (let i = 0; i < 2; i++) { await respondCorrect(page); await waitIdle(page); }

    await page.reload();
    await page.waitForFunction(() => !!window.__sq);
    const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('nooutco.results.snackQuest') || '[]'));
    expect(rows).toHaveLength(2);

    page.on('dialog', (d) => d.accept());
    await chooseTask(page, 'matching');
    await choosePlace(page, 'playroom');
    for (let i = 0; i < 2; i++) { await respondCorrect(page); await waitIdle(page); }
    await expect(page.locator('#results-body tr')).toHaveCount(4);
    await page.click('#btn-clear-data');
    await expect(page.locator('#results-body tr')).toHaveCount(0);
  });
});

test.describe('Snack Quest — no console errors', () => {
  test('a full quest logs nothing to console.error', async ({ page }) => {
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));

    await bootstrap(page, { scheduleValue: 2, goalTokens: 3 });
    await chooseTask(page, 'receptive');
    await choosePlace(page, 'countryside');
    for (let i = 0; i < 12; i++) {
      if (await page.locator('#screen-done').isVisible()) break;
      await respondCorrect(page);
      await waitIdle(page);
    }
    await expect(page.locator('#screen-done')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
