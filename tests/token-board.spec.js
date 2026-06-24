import { test, expect } from '@playwright/test';

test.describe('Token Board Feature', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/market/index.html');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test.describe('Token Board Settings', () => {
    test('token board toggle exists in settings panel', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await expect(page.locator('#chk-token-board')).toBeVisible();
    });

    test('token board is hidden by default', async ({ page }) => {
      await expect(page.locator('#token-board')).toBeHidden();
    });

    test('token board displays when toggled on', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      await expect(page.locator('#token-board')).toBeVisible();
    });

    test('FR/VR selector and value inputs visible when token board enabled', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      await expect(page.locator('#sel-schedule-type')).toBeVisible();
      await expect(page.locator('#inp-schedule-value')).toBeVisible();
      await expect(page.locator('#inp-starting-tokens')).toBeVisible();
      await expect(page.locator('#inp-goal-tokens')).toBeVisible();
      await expect(page.locator('#sel-token-emoji')).toBeVisible();
    });

    test('default schedule is FR1', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      await expect(page.locator('#sel-schedule-type')).toHaveValue('FR');
      await expect(page.locator('#inp-schedule-value')).toHaveValue('1');
    });

    test('default token emoji selector is random', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      await expect(page.locator('#sel-token-emoji')).toHaveValue('random');
    });

    test('settings persist after reload', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      await page.locator('#sel-schedule-type').selectOption('VR');
      await page.locator('#inp-schedule-value').fill('3');
      await page.locator('#inp-schedule-value').dispatchEvent('change');
      await page.locator('#inp-starting-tokens').fill('5');
      await page.locator('#inp-starting-tokens').dispatchEvent('change');
      await page.locator('#inp-goal-tokens').fill('20');
      await page.locator('#inp-goal-tokens').dispatchEvent('change');

      await page.reload();
      await page.waitForLoadState('networkidle');

      await page.click('#btn-extra-toggle');
      await expect(page.locator('#chk-token-board')).toBeChecked();
      await expect(page.locator('#sel-schedule-type')).toHaveValue('VR');
      await expect(page.locator('#inp-schedule-value')).toHaveValue('3');
      await expect(page.locator('#inp-starting-tokens')).toHaveValue('5');
      await expect(page.locator('#inp-goal-tokens')).toHaveValue('20');
    });
  });

  test.describe('Token Board Display', () => {
    test('token board displays correct progress text', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      await page.locator('#inp-starting-tokens').fill('3');
      await page.locator('#inp-starting-tokens').dispatchEvent('change');
      await page.locator('#inp-goal-tokens').fill('10');
      await page.locator('#inp-goal-tokens').dispatchEvent('change');

      await expect(page.locator('#token-progress-text')).toContainText('3 / 10');
    });
  });
});
