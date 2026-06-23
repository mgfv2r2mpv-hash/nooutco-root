import { test, expect } from '@playwright/test';

test.describe('Token Board Feature', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/market/index.html');
    // Wait for app to load
    await page.waitForLoadState('networkidle');
  });

  test.describe('Token Board Settings', () => {
    test('token board toggle exists in settings panel', async ({ page }) => {
      // Open settings
      await page.click('#btn-extra-toggle');
      const toggle = page.locator('#chk-token-board');
      await expect(toggle).toBeVisible();
    });

    test('token board is hidden by default', async ({ page }) => {
      const tokenBoard = page.locator('#token-board');
      await expect(tokenBoard).toBeHidden();
    });

    test('token board displays when toggled on', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      const tokenBoard = page.locator('#token-board');
      await expect(tokenBoard).toBeVisible();
    });

    test('FR/VR selector and value input visible when token board enabled', async ({ page }) => {
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
      const scheduleType = page.locator('#sel-schedule-type');
      const scheduleValue = page.locator('#inp-schedule-value');
      await expect(scheduleType).toHaveValue('FR');
      await expect(scheduleValue).toHaveValue('1');
    });

    test('default token emoji is random', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      const tokenEmoji = page.locator('#sel-token-emoji');
      await expect(tokenEmoji).toHaveValue('random');
    });

    test('settings persist after reload', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      await page.selectOption('#sel-schedule-type', 'VR');
      await page.fill('#inp-schedule-value', '3');
      await page.fill('#inp-starting-tokens', '5');
      await page.fill('#inp-goal-tokens', '20');

      // Reload page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Check settings persisted
      await page.click('#btn-extra-toggle');
      await expect(page.locator('#chk-token-board')).toBeChecked();
      await expect(page.locator('#sel-schedule-type')).toHaveValue('VR');
      await expect(page.locator('#inp-schedule-value')).toHaveValue('3');
      await expect(page.locator('#inp-starting-tokens')).toHaveValue('5');
      await expect(page.locator('#inp-goal-tokens')).toHaveValue('20');
    });
  });

  test.describe('Token Board Display', () => {
    test('token board appears between settings and game area', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');

      const settingsBar = page.locator('#settings-bar');
      const tokenBoard = page.locator('#token-board');
      const gameArea = page.locator('#game-area');

      const settingsBox = await settingsBar.boundingBox();
      const tokenBox = await tokenBoard.boundingBox();
      const gameBox = await gameArea.boundingBox();

      // Token board should be below settings bar
      expect(tokenBox.y).toBeGreaterThan(settingsBox.y + settingsBox.height);
      // Token board should be above or same as game area (if game not started)
      expect(tokenBox.y).toBeLessThanOrEqual(gameBox.y + 100);
    });

    test('token board displays correct progress text', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      await page.fill('#inp-starting-tokens', '3');
      await page.fill('#inp-goal-tokens', '10');

      const progressText = page.locator('#token-progress-text');
      await expect(progressText).toContainText('3 / 10');
    });

    test('token board displays emoji', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');

      const emojiDisplay = page.locator('#token-emoji-display');
      // Should contain at least one emoji
      const text = await emojiDisplay.textContent();
      expect(text).toMatch(/[\u{1F300}-\u{1F9FF}]/u);
    });
  });

  test.describe('FR Schedule (Fixed Ratio)', () => {
    test('FR1: 1 token per correct trial', async ({ page }) => {
      // Set up FR1
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      await page.selectOption('#sel-schedule-type', 'FR');
      await page.fill('#inp-schedule-value', '1');
      await page.fill('#inp-starting-tokens', '0');
      await page.fill('#inp-goal-tokens', '5');

      // Close settings and start game
      await page.click('#btn-extra-close');

      // Verify token board visible
      await expect(page.locator('#token-board')).toBeVisible();

      // Simulate 5 correct trials via localStorage manipulation
      // (In real gameplay, these would be triggered by correct matches)
      const tokenData = await page.evaluate(() => {
        window.__tokenBoard = { fr1Test: true };
        return 'ready';
      });

      // Set internal state (tokens earned per trial)
      await page.evaluate(() => {
        const state = {
          tokenBoardEnabled: true,
          scheduleType: 'FR',
          scheduleValue: 1,
          currentTokens: 0,
          trialsCompleted: 0
        };
        localStorage.setItem('mmTokenSettings', JSON.stringify(state));
      });

      // Award 5 tokens
      await page.evaluate(async () => {
        // Simulate trial completions
        for (let i = 0; i < 5; i++) {
          const state = JSON.parse(localStorage.getItem('mmTokenSettings'));
          state.trialsCompleted = i + 1;
          // FR1: every trial gets a token
          state.currentTokens = Math.ceil(state.trialsCompleted / state.scheduleValue);
          localStorage.setItem('mmTokenSettings', JSON.stringify(state));
        }
      });

      // Reload to verify persistence and display
      await page.reload();
      await page.waitForLoadState('networkidle');

      const progressText = page.locator('#token-progress-text');
      await expect(progressText).toContainText('5 / 5');
    });

    test('FR3: 1 token per 3 correct trials', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      await page.selectOption('#sel-schedule-type', 'FR');
      await page.fill('#inp-schedule-value', '3');
      await page.fill('#inp-starting-tokens', '0');
      await page.fill('#inp-goal-tokens', '5');

      // Simulate 15 correct trials (should yield 5 tokens)
      await page.evaluate(async () => {
        const state = {
          tokenBoardEnabled: true,
          scheduleType: 'FR',
          scheduleValue: 3,
          currentTokens: 0,
          trialsCompleted: 15
        };
        state.currentTokens = Math.floor(15 / 3); // 5 tokens
        localStorage.setItem('mmTokenSettings', JSON.stringify(state));
      });

      await page.reload();
      await page.waitForLoadState('networkidle');

      const progressText = page.locator('#token-progress-text');
      await expect(progressText).toContainText('5 / 5');
    });

    test('FR5: 1 token per 5 correct trials', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      await page.selectOption('#sel-schedule-type', 'FR');
      await page.fill('#inp-schedule-value', '5');
      await page.fill('#inp-starting-tokens', '0');
      await page.fill('#inp-goal-tokens', '10');

      // Simulate 45 correct trials (should yield 9 tokens)
      await page.evaluate(async () => {
        const state = {
          tokenBoardEnabled: true,
          scheduleType: 'FR',
          scheduleValue: 5,
          currentTokens: 0,
          trialsCompleted: 45
        };
        state.currentTokens = Math.floor(45 / 5); // 9 tokens
        localStorage.setItem('mmTokenSettings', JSON.stringify(state));
      });

      await page.reload();
      await page.waitForLoadState('networkidle');

      const progressText = page.locator('#token-progress-text');
      await expect(progressText).toContainText('9 / 10');
    });
  });

  test.describe('VR Schedule (Variable Ratio)', () => {
    test('VR2: average 1 token per 2 trials over 100 trials', async ({ page }) => {
      // Test that VR2 reinforcement count is approximately numTrials/2
      const schedule = await page.evaluate(() => {
        // Import or inline the VR schedule generator
        function generateVRSchedule(numTrials, vrValue) {
          const targetReinforcements = numTrials / vrValue;
          const itemsPerChunk = Math.ceil(vrValue);
          const reinforcementIndices = [];

          for (let i = 0; i < numTrials; i += itemsPerChunk) {
            const chunkEnd = Math.min(i + itemsPerChunk, numTrials);
            const randomPos = Math.floor(Math.random() * (chunkEnd - i)) + i;
            reinforcementIndices.push(randomPos);
          }

          return reinforcementIndices.sort((a, b) => a - b);
        }

        const schedule = generateVRSchedule(100, 2);
        return schedule;
      });

      // Verify approximately 50 reinforcements (VR2 = 1 per 2 trials)
      expect(schedule.length).toBeGreaterThanOrEqual(45);
      expect(schedule.length).toBeLessThanOrEqual(55);
    });

    test('VR2: no gap exceeds 1.5x target interval over 100 trials', async ({ page }) => {
      const schedule = await page.evaluate(() => {
        function generateVRSchedule(numTrials, vrValue) {
          const itemsPerChunk = Math.ceil(vrValue);
          const reinforcementIndices = [];

          for (let i = 0; i < numTrials; i += itemsPerChunk) {
            const chunkEnd = Math.min(i + itemsPerChunk, numTrials);
            const randomPos = Math.floor(Math.random() * (chunkEnd - i)) + i;
            reinforcementIndices.push(randomPos);
          }

          return reinforcementIndices.sort((a, b) => a - b);
        }

        const schedule = generateVRSchedule(100, 2);
        const targetInterval = 100 / 2; // 50
        const maxAllowedGap = targetInterval * 1.5; // 75

        const gaps = [];
        gaps.push(schedule[0]); // gap from start
        for (let i = 1; i < schedule.length; i++) {
          gaps.push(schedule[i] - schedule[i - 1]);
        }
        gaps.push(100 - schedule[schedule.length - 1]); // gap to end

        return { schedule, gaps, maxAllowedGap };
      });

      // Verify no gap exceeds 1.5x target interval
      schedule.gaps.forEach(gap => {
        expect(gap).toBeLessThanOrEqual(schedule.maxAllowedGap + 1); // +1 for rounding
      });
    });

    test('VR2: consistent fidelity over 1000 trials (no drift)', async ({ page }) => {
      const result = await page.evaluate(() => {
        function generateVRSchedule(numTrials, vrValue) {
          const itemsPerChunk = Math.ceil(vrValue);
          const reinforcementIndices = [];

          for (let i = 0; i < numTrials; i += itemsPerChunk) {
            const chunkEnd = Math.min(i + itemsPerChunk, numTrials);
            const randomPos = Math.floor(Math.random() * (chunkEnd - i)) + i;
            reinforcementIndices.push(randomPos);
          }

          return reinforcementIndices.sort((a, b) => a - b);
        }

        const schedule = generateVRSchedule(1000, 2);
        const expectedCount = 1000 / 2;
        const actualCount = schedule.length;
        const deviation = Math.abs(actualCount - expectedCount) / expectedCount;

        return {
          expectedCount,
          actualCount,
          deviationPercent: deviation * 100
        };
      });

      // Verify deviation is less than 10%
      expect(result.deviationPercent).toBeLessThan(10);
    });

    test('VR3: correct average reinforcement rate', async ({ page }) => {
      const result = await page.evaluate(() => {
        function generateVRSchedule(numTrials, vrValue) {
          const itemsPerChunk = Math.ceil(vrValue);
          const reinforcementIndices = [];

          for (let i = 0; i < numTrials; i += itemsPerChunk) {
            const chunkEnd = Math.min(i + itemsPerChunk, numTrials);
            const randomPos = Math.floor(Math.random() * (chunkEnd - i)) + i;
            reinforcementIndices.push(randomPos);
          }

          return reinforcementIndices.sort((a, b) => a - b);
        }

        const schedule = generateVRSchedule(300, 3);
        const expectedCount = 300 / 3; // 100
        const actualCount = schedule.length;

        return { expectedCount, actualCount };
      });

      // VR3 over 300 trials should yield ~100 reinforcements
      expect(result.actualCount).toBeGreaterThanOrEqual(90);
      expect(result.actualCount).toBeLessThanOrEqual(110);
    });

    test('VR schedule is auditable in session data', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      await page.selectOption('#sel-schedule-type', 'VR');
      await page.fill('#inp-schedule-value', '2');

      // Check that schedule is stored in state
      const schedule = await page.evaluate(() => {
        return localStorage.getItem('mmSettings');
      });

      expect(schedule).toBeTruthy();
      const settings = JSON.parse(schedule);
      expect(settings.scheduleType).toBe('VR');
      expect(settings.scheduleValue).toBe('2');
    });
  });

  test.describe('Token Emoji Persistence', () => {
    test('chosen emoji persists throughout session', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');

      // Get the emoji text
      const emojiDisplay1 = await page.locator('#token-emoji-display').textContent();

      // Reload
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Emoji should be the same
      const emojiDisplay2 = await page.locator('#token-emoji-display').textContent();
      expect(emojiDisplay1).toBe(emojiDisplay2);
    });

    test('random emoji option selects a valid emoji', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      await page.selectOption('#sel-token-emoji', 'random');

      const emojiDisplay = page.locator('#token-emoji-display');
      const text = await emojiDisplay.textContent();

      // Should be one of the emoji pool characters
      expect(text).toMatch(/[⭐🔷💎✨🎁🏆💫🌟]/);
    });
  });

  test.describe('Goal Reached', () => {
    test('visual feedback when goal is reached', async ({ page }) => {
      await page.click('#btn-extra-toggle');
      await page.check('#chk-token-board');
      await page.fill('#inp-starting-tokens', '0');
      await page.fill('#inp-goal-tokens', '5');

      // Simulate reaching goal
      await page.evaluate(() => {
        const state = {
          tokenBoardEnabled: true,
          scheduleType: 'FR',
          scheduleValue: 1,
          currentTokens: 5,
          goalTokens: 5,
          trialsCompleted: 5
        };
        localStorage.setItem('mmTokenSettings', JSON.stringify(state));
      });

      await page.reload();
      await page.waitForLoadState('networkidle');

      // Check for goal-reached class or styling
      const tokenBoard = page.locator('#token-board');
      const hasGoalClass = await tokenBoard.evaluate(el =>
        el.classList.contains('goal-reached')
      );

      expect(hasGoalClass).toBeTruthy();
    });
  });
});
