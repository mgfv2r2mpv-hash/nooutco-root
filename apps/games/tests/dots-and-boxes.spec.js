import { test, expect } from '@playwright/test';

// Smoke + behaviour coverage for Dots & Boxes — a pass-and-play turn-taking
// game rendered as an inline SVG board. Proves the board boots clean, the
// core turn rules hold (pass on no box, go-again on a completed box), the
// repeatable Backup undo restores state, and the hub card links to it.

const edge = (o, r, c) => `.db-hit[data-orient="${o}"][data-r="${r}"][data-c="${c}"]`;
const boxNum = (r, c) => `.db-num[data-r="${r}"][data-c="${c}"]`;

test.describe('Dots & Boxes', () => {
  test('boots with no JavaScript errors', async ({ page }) => {
    // Collect genuine JS errors only; ignore resource-load failures (e.g. the
    // shared tokens.css web-font @imports) that fail in offline/CI sandboxes.
    const errors = [];
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (/Failed to load resource/i.test(m.text())) return;
      errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/dots-and-boxes/');
    await expect(page.getByText('Dots & Boxes').first()).toBeVisible();
    await expect(page.locator('#btn-play')).toBeVisible();
    expect(errors, `JS errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('a line that closes no box passes the turn', async ({ page }) => {
    await page.goto('/dots-and-boxes/');
    await page.locator('#btn-play').click();                 // default 3×3
    await expect(page.getByText(/Player 1's turn/)).toBeVisible();
    await expect(page.getByText('0 / 9 boxes')).toBeVisible();

    await page.locator(edge('h', 0, 0)).click();             // one edge — no box
    await expect(page.getByText(/Player 2's turn/)).toBeVisible();
    await expect(page.getByText('0 / 9 boxes')).toBeVisible();
  });

  test('closing a box claims it, scores, and the same player goes again', async ({ page }) => {
    await page.goto('/dots-and-boxes/');
    await page.locator('#btn-play').click();

    // The 4 edges of box (0,0) are placed across alternating turns:
    //   h00 → P1 (pass), v00 → P2 (pass), v01 → P1 (pass), h10 → P2 closes it.
    await page.locator(edge('h', 0, 0)).click();
    await page.locator(edge('v', 0, 0)).click();
    await page.locator(edge('v', 0, 1)).click();
    await page.locator(edge('h', 1, 0)).click();             // Player 2 closes box (0,0)

    await expect(page.getByText('1 / 9 boxes')).toBeVisible();
    await expect(page.locator(boxNum(0, 0))).toHaveText('2'); // owned by Player 2
    await expect(page.getByText(/Player 2's turn/)).toBeVisible(); // claimed → goes again
  });

  test('Backup undoes the last line and restores the turn', async ({ page }) => {
    await page.goto('/dots-and-boxes/');
    await page.locator('#btn-play').click();

    await page.locator(edge('h', 0, 0)).click();             // P1 → P2
    await expect(page.getByText(/Player 2's turn/)).toBeVisible();

    await page.locator('#btn-undo').click();
    await expect(page.getByText(/Player 1's turn/)).toBeVisible();
    await expect(page.locator('#btn-undo')).toBeDisabled();  // history empty again
  });

  test('Backup un-claims a completed box', async ({ page }) => {
    await page.goto('/dots-and-boxes/');
    await page.locator('#btn-play').click();

    for (const [o, r, c] of [['h', 0, 0], ['v', 0, 0], ['v', 0, 1], ['h', 1, 0]]) {
      await page.locator(edge(o, r, c)).click();
    }
    await expect(page.getByText('1 / 9 boxes')).toBeVisible();

    await page.locator('#btn-undo').click();                 // undo the closing line
    await expect(page.getByText('0 / 9 boxes')).toBeVisible();
    await expect(page.locator(boxNum(0, 0))).toHaveText('');  // box label cleared
  });

  test('hub card links to the game', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a.card[href="./dots-and-boxes/"]')).toBeVisible();
  });
});
