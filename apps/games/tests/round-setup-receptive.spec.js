import { expect } from '@playwright/test';
import { roundSetupSuite } from './lib/round-setup.js';

/**
 * Receptive Words carries the gated Round-setup panel (PHASE8-HANDOFF-3 §3b).
 * The shared contract lives in ./lib/round-setup.js; this row names what is
 * particular to receptive.
 */
roundSetupSuite({
  game: 'receptive',
  url: '/receptive/',
  storeKey: 'nooutco.settings.receptive',
  async ready(page) {
    await expect(page.locator('#sel-topic option').first()).not.toHaveText('-- scanning --');
  },
  stateFields: [
    'topic', 'arraySize', 'representErrors', 'errorless', 'noErrorAnim',
    'crossCategory', 'nonTargetDistractors', 'promptPersists', 'promptStyle',
    'autoPromptEnabled', 'promptDelay', 'promptDelaySecs', 'targetFilters',
  ],
  edit: { kind: 'stepper', label: 'Array Size', control: '#inp-size', field: 'arraySize' },
  // `topic` is left out: its declared default is '' and the game resolves that
  // to the first published topic, which is what Reset selects. Target filters
  // and the token board are not in the panel, so Reset does not touch them.
  resetFields: [
    'arraySize', 'representErrors', 'errorless', 'noErrorAnim',
    'crossCategory', 'nonTargetDistractors', 'promptPersists', 'promptStyle',
    'autoPromptEnabled', 'promptDelay', 'promptDelaySecs',
  ],
});
