import { test, expect } from '@playwright/test';

// Smoke coverage for Red Carpet Convos (a version of the Famous Person game).
// Drives the two-phase flow far enough to prove each screen mounts, the roster
// loads from people.json, and the hub card links to it.

test.describe('Red Carpet Convos', () => {
  test('setup screen loads with heading and CTA', async ({ page }) => {
    await page.goto('/red-carpet-convos/');
    await expect(page.getByRole('heading', { name: /Meet and discuss someone famous/ })).toBeVisible();
    await expect(page.locator('[data-act="begin"]')).toBeVisible();
  });

  test('runs from Setup → Meet → Talk with a karaoke prompt', async ({ page }) => {
    await page.goto('/red-carpet-convos/');

    // Setup → Meet
    await page.locator('[data-act="begin"]').click();
    await expect(page.locator('[data-act="newPerson"]')).toBeVisible(); // Meet header

    // Reveal all facts, then start the conversation
    for (let i = 0; i < 3; i++) {
      const next = page.locator('[data-act="revealNext"]');
      if (await next.count()) await next.click();
    }
    await page.locator('[data-act="startTalk"]').first().click();

    // Talk: the support/score row and a sayable (karaoke) prompt are present
    await expect(page.locator('[data-act="score"]')).toBeVisible();
    await expect(page.locator('[data-act="miss"]')).toBeVisible();
    await expect(page.locator('#rcc [data-say]')).toHaveCount(1);

    // Scoring a comment advances to the volley
    await page.locator('[data-act="score"]').click();
    await expect(page.getByText('Ask a question back')).toBeVisible();
  });

  test('roster loads from people.json (search finds a person)', async ({ page }) => {
    await page.goto('/red-carpet-convos/');
    await page.locator('[data-act="begin"]').click();
    await page.locator('[data-act="toggleSearch"]').click();
    await page.locator('#rcc-search-input').fill('Serena');
    await expect(page.locator('#rcc-search-results').getByText('Serena Williams')).toBeVisible();
  });

  test('games hub links to the new game', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('a.card[href="./red-carpet-convos/"]');
    await expect(card).toBeVisible();
    await expect(card.getByText('Red Carpet Convos')).toBeVisible();
  });
});
