import { expect } from '@playwright/test';
import { roundSetupSuite } from './lib/round-setup.js';

/**
 * Hickory Dickory Dock carries the gated Round-setup panel (PHASE8-HANDOFF-3
 * §3b). The shared contract lives in ./lib/round-setup.js; this row names what
 * is particular to clock.
 */
roundSetupSuite({
  game: 'clock',
  url: '/clock/',
  storeKey: 'nooutco.settings.clock',
  async ready(page) {
    await expect(page.locator('#sel-topic option').first()).toHaveAttribute('value', /^T_/);
  },
  stateFields: [
    'topic', 'arraySize', 'animations', 'representErrors', 'errorless', 'noErrorAnim',
    'crossCategory', 'nonTargetDistractors', 'promptPersists', 'promptStyle',
    'autoPromptEnabled', 'promptDelay', 'promptDelaySecs', 'targetFilters',
  ],
  edit: { kind: 'stepper', label: 'Array Size', control: '#inp-size', field: 'arraySize' },
  // Left out: `topic`, whose declared default is '' and which the game resolves
  // to the first published topic (what Reset selects), and `targetFilters`,
  // which the panel does not show and Reset deliberately leaves alone.
  resetFields: [
    'arraySize', 'animations', 'representErrors', 'errorless', 'noErrorAnim',
    'crossCategory', 'nonTargetDistractors', 'promptPersists', 'promptStyle',
    'autoPromptEnabled', 'promptDelay', 'promptDelaySecs',
  ],
});
