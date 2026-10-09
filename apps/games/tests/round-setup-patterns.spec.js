import { expect } from '@playwright/test';
import { roundSetupSuite } from './lib/round-setup.js';

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
  // to the first published set, which is what Reset selects.
  resetFields: [
    'patternLength', 'shownReps', 'blanksToFill', 'bankSize',
    'representErrors', 'errorless', 'noErrorAnim', 'promptPersists', 'promptStyle',
    'autoPromptEnabled', 'promptDelay', 'promptDelaySecs', 'reduceMotion',
  ],
});
