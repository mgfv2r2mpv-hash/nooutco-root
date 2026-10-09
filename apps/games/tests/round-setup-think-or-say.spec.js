import { test, expect } from '@playwright/test';
import { roundSetupSuite, holdGear } from './lib/round-setup.js';

/**
 * Think or Say? carries the gated Round-setup panel (PHASE8-HANDOFF-3 §3b).
 * The shared contract lives in ./lib/round-setup.js; this row names what is
 * particular to think-or-say.
 *
 * - The configuration in force is `state.cfg`, and the prompt switches are
 *   spelled `autoPrompt` / `promptDelay` / `promptDelaySecs`.
 * - No named round sets: the store's `sets` / `last` already hold the Learner
 *   A/B/C slots, so the panel mounts with `sets: false`.
 * - Play (`#btn-play`) is the game's own Start.
 */
roundSetupSuite({
  game: 'think-or-say',
  url: '/think-or-say/',
  storeKey: 'nooutco.settings.think-or-say',
  async ready(page) {
    await expect(page.locator('#sel-category option').first()).toHaveAttribute('value', 'all');
  },
  statePath: ['cfg'],
  stateFields: [
    'level', 'category', 'order', 'represent', 'errorless', 'noErrorAnim',
    'autoPrompt', 'promptDelay', 'promptDelaySecs', 'promptStyle',
    'showReason', 'showRule', 'counterbalance',
  ],
  edit: { kind: 'select', label: 'Level', control: '#sel-level', field: 'level' },
  startButton: '#btn-play',
  sets: false,
  promptFields: { auto: 'autoPrompt', delay: 'promptDelay', secs: 'promptDelaySecs' },
  // Every option the panel mirrors has a markup default equal to its declared
  // default. Left out: the Learner slot (not an option, and kept out of Reset),
  // and the per-level probe fields, which stay in the Options panel only.
  resetFields: [
    'level', 'category', 'order', 'represent', 'errorless', 'noErrorAnim',
    'autoPrompt', 'promptDelay', 'promptDelaySecs', 'promptStyle',
    'showReason', 'showRule', 'counterbalance',
  ],
});

test.describe('think-or-say: Round setup and learner slots', () => {
  test('the panel offers no named sets, and Reset never switches the learner', async ({ page }) => {
    await page.goto('/think-or-say/');
    await expect(page.locator('#sel-category option').first()).toHaveAttribute('value', 'all');
    await holdGear(page);
    await expect(page.locator('#sel-round-set')).toHaveCount(0);
    await expect(page.locator('#btn-round-save')).toHaveCount(0);

    const learner = page.locator('#round-panel .round-field-row', { hasText: 'Learner' }).locator('select');
    await learner.selectOption('B');
    await expect(page.locator('#sel-learner')).toHaveValue('B');
    await page.locator('#round-panel .round-field-row', { hasText: /^Level/ }).locator('select').selectOption('2');

    await page.locator('#btn-round-reset').click();
    await expect(page.locator('#sel-learner')).toHaveValue('B');
    await expect(page.locator('#sel-level')).toHaveValue('1');
    const last = await page.evaluate(() => JSON.parse(localStorage.getItem('nooutco.settings.think-or-say')).last);
    expect(last).toBe('Learner B');
  });
});
