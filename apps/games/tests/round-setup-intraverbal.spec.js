import { expect } from '@playwright/test';
import { roundSetupSuite } from './lib/round-setup.js';

/**
 * Intraverbal carries the gated Round-setup panel (PHASE8-HANDOFF-3 §3b).
 * The shared contract lives in ./lib/round-setup.js; this row names what is
 * particular to intraverbal.
 */
roundSetupSuite({
  game: 'intraverbal',
  url: '/intraverbal/',
  storeKey: 'nooutco.settings.intraverbal',
  async ready(page) {
    await expect(page.locator('#sel-category option').first()).toBeAttached();
    await expect(page.locator('#sel-category')).not.toHaveValue('');
  },
  stateFields: [
    'category', 'arraySize', 'representErrors', 'errorless', 'noErrorAnim',
    'crossCategory', 'promptPersists', 'promptStyle', 'autoPromptEnabled',
    'promptDelay', 'promptDelaySecs', 'vocalPromptsEnabled', 'vocalResponsesEnabled',
    'targetFilters',
  ],
  edit: { kind: 'stepper', label: 'Array Size', control: '#inp-size', field: 'arraySize' },
  // category is left out: its declared default is '' and the game resolves
  // that to the first category, which is what Reset selects. targetFilters is
  // not in the panel, so Reset leaves it alone.
  resetFields: [
    'arraySize', 'representErrors', 'errorless', 'noErrorAnim', 'crossCategory',
    'promptPersists', 'promptStyle', 'autoPromptEnabled', 'promptDelay',
    'promptDelaySecs', 'vocalPromptsEnabled', 'vocalResponsesEnabled',
  ],
});
