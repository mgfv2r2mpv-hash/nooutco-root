import { expect } from '@playwright/test';
import { roundSetupSuite } from './lib/round-setup.js';

/**
 * Matching carries the gated Round-setup panel (PHASE8-HANDOFF-3 §3b).
 * The shared contract lives in ./lib/round-setup.js; this row names what is
 * particular to matching.
 */
roundSetupSuite({
  game: 'matching',
  url: '/matching/',
  storeKey: 'nooutco.settings.matching',
  async ready(page) {
    await expect(page.locator('#sel-topic option').first()).not.toHaveText('-- scanning --');
  },
  stateFields: [
    'topic', 'arraySize', 'displayMode',
    'representErrors', 'errorless', 'noErrorAnim', 'nonTargetDistractors', 'crossCategory',
    'promptPersists', 'promptStyle', 'autoPromptEnabled', 'promptDelay', 'promptDelaySecs',
    'targetFilters', 'tokenBoardEnabled',
  ],
  edit: { kind: 'stepper', label: 'Array Size', control: '#inp-size', field: 'arraySize' },
  // topic is left out: its declared default is '' and the game resolves that
  // to the first published topic, which is what Reset selects. Targets, the
  // display mode and the token board are not in the panel, so Reset leaves them.
  resetFields: [
    'arraySize',
    'representErrors', 'errorless', 'noErrorAnim', 'nonTargetDistractors', 'crossCategory',
    'promptPersists', 'promptStyle', 'autoPromptEnabled', 'promptDelay', 'promptDelaySecs',
  ],
});
