import { expect } from '@playwright/test';
import { roundSetupSuite } from './lib/round-setup.js';

/**
 * Matching Market carries the gated Round-setup panel (PHASE8-HANDOFF-3 §3b).
 * The shared contract lives in ./lib/round-setup.js; this row names what is
 * particular to market.
 */
roundSetupSuite({
  game: 'market',
  url: '/market/',
  storeKey: 'nooutco.settings.market',
  async ready(page) {
    await expect(page.locator('#sel-topic option').first()).not.toHaveText('-- scanning --');
    // Start needs the topic's images, which load after the dropdown fills.
    await page.waitForFunction(() => state.topicImages.length > 0); // eslint-disable-line no-undef
  },
  stateFields: [
    'topic', 'arraySize', 'animTier', 'showCaption', 'sameCustomerOnRetry',
    'representErrors', 'errorless', 'noErrorAnim', 'nonTargetDistractors', 'crossCategory',
    'promptPersists', 'promptStyle', 'autoPromptEnabled', 'promptDelay', 'promptDelaySecs',
    'targetFilters',
  ],
  edit: { kind: 'stepper', label: 'Array Size', control: '#inp-size', field: 'arraySize' },
  // topic is left out: its declared default is '' and the game resolves that
  // to the first published topic, which is what Reset selects.
  resetFields: [
    'arraySize', 'animTier', 'showCaption', 'sameCustomerOnRetry',
    'representErrors', 'errorless', 'noErrorAnim', 'nonTargetDistractors', 'crossCategory',
    'promptPersists', 'promptStyle', 'autoPromptEnabled', 'promptDelay', 'promptDelaySecs',
  ],
});
