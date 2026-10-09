import { test, expect } from '@playwright/test';
import { roundSetupSuite, holdGear } from './lib/round-setup.js';

/**
 * Pattern Pack Co. carries the gated Round-setup panel (PHASE8-HANDOFF-3 §3b).
 * The shared contract lives in ./lib/round-setup.js; this row names what is
 * particular to patterns.
 */
roundSetupSuite({
  game: 'patterns',
  url: '/patterns/',
  storeKey: 'nooutco.settings.patterns',
  async ready(page) {
    await expect(page.locator('#sel-set option').first()).not.toHaveText('-- loading --');
  },
  stateFields: [
    'setName', 'patternLength', 'shownReps', 'blanksToFill', 'bankSize',
    'representErrors', 'errorless', 'noErrorAnim', 'promptPersists', 'promptStyle',
    'autoPromptEnabled', 'promptDelay', 'promptDelaySecs', 'reduceMotion',
  ],
  edit: { kind: 'stepper', label: 'Bank Size', control: '#inp-bank', field: 'bankSize' },
  // setName is left out: its declared default is '' and the game resolves that
  // to the first published set, which is what Reset selects. reduceMotion is
  // left out too: it serves the learner, not the round, so Reset keeps it
  // (checked below).
  resetFields: [
    'patternLength', 'shownReps', 'blanksToFill', 'bankSize',
    'representErrors', 'errorless', 'noErrorAnim', 'promptPersists', 'promptStyle',
    'autoPromptEnabled', 'promptDelay', 'promptDelaySecs',
  ],
});

test.describe('patterns: Round setup and reduced motion', () => {
  test('Reset to defaults leaves Reduce Motion as it was', async ({ page }) => {
    await page.goto('/patterns/');
    await expect(page.locator('#sel-set option').first()).not.toHaveText('-- loading --');
    await holdGear(page);

    const motionSwitch = page.locator('#round-panel .round-field-row[data-mirror="#chk-reduce-motion"] [role="switch"]');
    await motionSwitch.click();
    await expect(page.locator('#chk-reduce-motion')).toBeChecked();

    await page.locator('#btn-round-reset').click();
    await expect(page.locator('#chk-reduce-motion')).toBeChecked();
    await expect(motionSwitch).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => document.body.classList.contains('reduce-motion'))).toBe(true);
    const working = await page.evaluate(() => JSON.parse(localStorage.getItem('nooutco.settings.patterns')).working);
    expect(working.reduceMotion).toBe(true);
  });
});
