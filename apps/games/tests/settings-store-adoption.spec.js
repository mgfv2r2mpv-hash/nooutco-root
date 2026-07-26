import { test, expect } from '@playwright/test';

/**
 * Stage 6, part 2 — the games adopt the shared settings store.
 *
 * `sequences` was migrated in part 1 because it is where the pattern came from.
 * Every other game moves the same way and has to prove the same four things,
 * which is why this table grows one row per game rather than one spec per game:
 *
 *   1. the module is actually loaded (a missing script tag takes the game down
 *      at parse time, so this is the assertion that names the cause)
 *   2. the retired key FOLDS — every option a technician set comes back, in the
 *      store AND in the panel they read it from
 *   3. the retired key is NEVER dropped: it survives the fold, and it survives
 *      subsequent edits, byte for byte
 *   4. an out-of-range stored value is clamped into the range the panel can
 *      show, rather than left as a value the control renders as blank
 *
 * Plus the rule that makes a fold safe to run on every load: a configuration
 * already in the store wins, because the retired key is by then stale.
 */

/**
 * Every seeded value is deliberately off its default, so a game that silently
 * redefaults an option fails rather than coincidentally matching it.
 *
 * `topic` and `targetFilters` are deliberately absent: topic selection and
 * target remapping are asserted against the real manifest in
 * `stimulus-repoint.spec.js`, and seeding them here would make this spec
 * depend on which stimuli happen to be published. For the same reason
 * `intraverbal`'s `category` and `patterns`' `setName` are asserted in
 * `config-migration.spec.js` against the real `items.json` / `symbols.json`
 * rather than here.
 *
 * Two things the table cannot assume across ten games, so every row may name
 * its own:
 *   - `boot`: the dropdown each game fills straight after `loadSettings()`,
 *     which is the signal that the store has already been read
 *   - `probe`: the numeric stepper the generic edit / precedence / clamp
 *     assertions drive. Four games share `#inp-size`; `patterns` has no array
 *     size at all and uses its bank size instead.
 */
const DEFAULT_BOOT = { selector: '#sel-topic option', notText: '-- scanning --' };
const DEFAULT_PROBE = {
  selector: '#inp-size',
  option: 'arraySize',
  seeded: 6,   // what the retired key carries
  edited: 7,   // what a live edit writes
  ahead: 9,    // what a config already in the store carries
  max: 10,     // what an out-of-range 99 must clamp down to
};

const ADOPTED = [
  {
    game: 'clock',
    url: '/clock/',
    legacyKey: 'hddSettings',
    storeKey: 'nooutco.settings.clock',
    seeded: {
      arraySize: 6,
      animations: false,
      representErrors: false,
      errorless: true,
      noErrorAnim: true,
      crossCategory: true,
      nonTargetDistractors: false,
      promptPersists: true,
      promptStyle: 'outline',
      autoPromptEnabled: true,
      promptDelay: true,
      promptDelaySecs: 5,
    },
    controls: [
      ['#inp-size', 'value', '6'],
      ['#chk-animations', 'checked', false],
      ['#chk-represent-errors', 'checked', false],
      ['#chk-errorless', 'checked', true],
      ['#chk-no-error-anim', 'checked', true],
      ['#chk-cross', 'checked', true],
      ['#chk-non-target-distractor', 'checked', false],
      ['#chk-persists', 'checked', true],
      ['#sel-prompt-style', 'value', 'outline'],
      ['#chk-auto-prompt', 'checked', true],
      ['#chk-prompt-delay', 'checked', true],
      ['#sel-prompt-delay', 'value', '5'],
    ],
    fresh: [
      ['#inp-size', 'value', '4'],
      ['#chk-animations', 'checked', true],
      ['#chk-represent-errors', 'checked', true],
      ['#chk-non-target-distractor', 'checked', true],
      ['#sel-prompt-style', 'value', 'sparkle'],
      ['#chk-auto-prompt', 'checked', false],
    ],
  },
  {
    game: 'receptive',
    url: '/receptive/',
    legacyKey: 'ngSettings',
    storeKey: 'nooutco.settings.receptive',
    seeded: {
      arraySize: 6,
      representErrors: false,
      errorless: true,
      noErrorAnim: true,
      crossCategory: true,
      nonTargetDistractors: false,
      promptPersists: true,
      promptStyle: 'outline',
      autoPromptEnabled: true,
      promptDelay: true,
      promptDelaySecs: 5,
      tokenBoardEnabled: true,
      scheduleType: 'VR',
      scheduleValue: 3,
      startingTokens: 2,
      goalTokens: 7,
      tokenEmoji: '🏆',
      chosenEmoji: '💎',
      currentTokens: 4,
    },
    controls: [
      ['#inp-size', 'value', '6'],
      ['#chk-represent-errors', 'checked', false],
      ['#chk-errorless', 'checked', true],
      ['#chk-no-error-anim', 'checked', true],
      ['#chk-cross', 'checked', true],
      ['#chk-non-target-distractor', 'checked', false],
      ['#chk-persists', 'checked', true],
      ['#sel-prompt-style', 'value', 'outline'],
      ['#chk-auto-prompt', 'checked', true],
      ['#chk-prompt-delay', 'checked', true],
      ['#sel-prompt-delay', 'value', '5'],
      ['#chk-token-board', 'checked', true],
      ['#sel-schedule-type', 'value', 'VR'],
      ['#inp-schedule-value', 'value', '3'],
      ['#inp-starting-tokens', 'value', '2'],
      ['#inp-goal-tokens', 'value', '7'],
      ['#sel-token-emoji', 'value', '🏆'],
    ],
    fresh: [
      ['#inp-size', 'value', '4'],
      ['#chk-represent-errors', 'checked', true],
      ['#chk-non-target-distractor', 'checked', true],
      ['#sel-prompt-style', 'value', 'sparkle'],
      ['#chk-auto-prompt', 'checked', false],
      ['#chk-token-board', 'checked', false],
      ['#sel-schedule-type', 'value', 'FR'],
      ['#inp-goal-tokens', 'value', '10'],
      ['#sel-token-emoji', 'value', 'random'],
    ],
  },
  {
    game: 'matching',
    url: '/matching/',
    legacyKey: 'mgSettings',
    storeKey: 'nooutco.settings.matching',
    seeded: {
      arraySize: 6,
      // The toolbar Simple/Visual slider — no panel control, so it is asserted
      // through the toggle's own aria-checked, which is what a technician sees.
      displayMode: 'visual',
      representErrors: false,
      errorless: true,
      noErrorAnim: true,
      crossCategory: true,
      nonTargetDistractors: false,
      promptPersists: true,
      promptStyle: 'outline',
      autoPromptEnabled: true,
      promptDelay: true,
      promptDelaySecs: 5,
      tokenBoardEnabled: true,
      scheduleType: 'VR',
      scheduleValue: 3,
      startingTokens: 2,
      goalTokens: 7,
      tokenEmoji: '🏆',
      chosenEmoji: '💎',
    },
    controls: [
      ['#inp-size', 'value', '6'],
      ['#display-toggle', 'attr:aria-checked', 'true'],
      ['#chk-represent-errors', 'checked', false],
      ['#chk-errorless', 'checked', true],
      ['#chk-no-error-anim', 'checked', true],
      ['#chk-cross', 'checked', true],
      ['#chk-non-target-distractor', 'checked', false],
      ['#chk-persists', 'checked', true],
      ['#sel-prompt-style', 'value', 'outline'],
      ['#chk-auto-prompt', 'checked', true],
      ['#chk-prompt-delay', 'checked', true],
      ['#sel-prompt-delay', 'value', '5'],
      ['#chk-token-board', 'checked', true],
      ['#sel-schedule-type', 'value', 'VR'],
      ['#inp-schedule-value', 'value', '3'],
      ['#inp-starting-tokens', 'value', '2'],
      ['#inp-goal-tokens', 'value', '7'],
      ['#sel-token-emoji', 'value', '🏆'],
    ],
    fresh: [
      ['#inp-size', 'value', '4'],
      ['#display-toggle', 'attr:aria-checked', 'false'],
      ['#chk-represent-errors', 'checked', true],
      ['#chk-non-target-distractor', 'checked', true],
      ['#sel-prompt-style', 'value', 'sparkle'],
      ['#chk-auto-prompt', 'checked', false],
      ['#chk-token-board', 'checked', false],
      ['#sel-schedule-type', 'value', 'FR'],
      ['#inp-goal-tokens', 'value', '10'],
      ['#sel-token-emoji', 'value', 'random'],
    ],
  },
  {
    game: 'market',
    url: '/market/',
    legacyKey: 'mmSettings',
    storeKey: 'nooutco.settings.market',
    seeded: {
      arraySize: 6,
      // 'light' is reachable only from the select, never from the toolbar
      // slider — so it is the value that proves the whole enum survived.
      animTier: 'light',
      showCaption: true,
      sameCustomerOnRetry: false,
      representErrors: false,
      errorless: true,
      noErrorAnim: true,
      crossCategory: true,
      nonTargetDistractors: false,
      promptPersists: true,
      promptStyle: 'outline',
      autoPromptEnabled: true,
      promptDelay: true,
      promptDelaySecs: 5,
      tokenBoardEnabled: true,
      scheduleType: 'VR',
      scheduleValue: 3,
      startingTokens: 2,
      goalTokens: 7,
      tokenEmoji: '🏆',
      chosenEmoji: '💎',
    },
    controls: [
      ['#inp-size', 'value', '6'],
      ['#sel-anim-tier', 'value', 'light'],
      ['#chk-caption', 'checked', true],
      ['#chk-same-customer', 'checked', false],
      ['#chk-represent-errors', 'checked', false],
      ['#chk-errorless', 'checked', true],
      ['#chk-no-error-anim', 'checked', true],
      ['#chk-cross', 'checked', true],
      ['#chk-non-target-distractor', 'checked', false],
      ['#chk-persists', 'checked', true],
      ['#sel-prompt-style', 'value', 'outline'],
      ['#chk-auto-prompt', 'checked', true],
      ['#chk-prompt-delay', 'checked', true],
      ['#sel-prompt-delay', 'value', '5'],
      ['#chk-token-board', 'checked', true],
      ['#sel-schedule-type', 'value', 'VR'],
      ['#inp-schedule-value', 'value', '3'],
      ['#inp-starting-tokens', 'value', '2'],
      ['#inp-goal-tokens', 'value', '7'],
      ['#sel-token-emoji', 'value', '🏆'],
    ],
    fresh: [
      ['#inp-size', 'value', '4'],
      ['#sel-anim-tier', 'value', 'full'],
      ['#chk-caption', 'checked', false],
      ['#chk-same-customer', 'checked', true],
      ['#chk-represent-errors', 'checked', true],
      ['#chk-non-target-distractor', 'checked', true],
      ['#sel-prompt-style', 'value', 'sparkle'],
      ['#chk-auto-prompt', 'checked', false],
      ['#chk-token-board', 'checked', false],
      ['#sel-schedule-type', 'value', 'FR'],
      ['#inp-goal-tokens', 'value', '10'],
      ['#sel-token-emoji', 'value', 'random'],
    ],
  },
  {
    game: 'intraverbal',
    url: '/intraverbal/',
    legacyKey: 'ivgSettings',
    storeKey: 'nooutco.settings.intraverbal',
    boot: { selector: '#sel-category option', notText: '(no categories)' },
    seeded: {
      arraySize: 6,
      representErrors: false,
      errorless: true,
      noErrorAnim: true,
      crossCategory: true,
      promptPersists: true,
      promptStyle: 'outline',
      autoPromptEnabled: true,
      promptDelay: true,
      promptDelaySecs: 5,
      vocalPromptsEnabled: true,
      vocalResponsesEnabled: true,
    },
    controls: [
      ['#inp-size', 'value', '6'],
      ['#chk-represent-errors', 'checked', false],
      ['#chk-errorless', 'checked', true],
      ['#chk-no-error-anim', 'checked', true],
      ['#chk-cross', 'checked', true],
      ['#chk-persists', 'checked', true],
      ['#sel-prompt-style', 'value', 'outline'],
      ['#chk-auto-prompt', 'checked', true],
      ['#chk-prompt-delay', 'checked', true],
      ['#sel-prompt-delay', 'value', '5'],
      ['#chk-vocal-prompts', 'checked', true],
      ['#chk-vocal-responses', 'checked', true],
    ],
    fresh: [
      ['#inp-size', 'value', '4'],
      ['#chk-represent-errors', 'checked', true],
      ['#chk-errorless', 'checked', false],
      ['#chk-cross', 'checked', false],
      ['#sel-prompt-style', 'value', 'sparkle'],
      ['#chk-auto-prompt', 'checked', false],
      ['#chk-vocal-prompts', 'checked', false],
      ['#chk-vocal-responses', 'checked', false],
    ],
  },
  {
    game: 'patterns',
    url: '/patterns/',
    legacyKey: 'ppcSettings',
    storeKey: 'nooutco.settings.patterns',
    boot: { selector: '#sel-set option', notText: '-- loading --' },
    // No array size in this game — the bank size is the stepper the generic
    // assertions drive, and its ceiling is 8 rather than 10.
    probe: { selector: '#inp-bank', option: 'bankSize', seeded: 6, edited: 7, ahead: 8, max: 8 },
    seeded: {
      patternLength: 3,
      shownReps: 1,
      // Only meaningful against patternLength 3 — a blanksToFill max resolved
      // from the *declared* default of 2 instead of the stored 3 clamps it.
      blanksToFill: 3,
      bankSize: 6,
      representErrors: false,
      errorless: true,
      noErrorAnim: true,
      promptPersists: true,
      promptStyle: 'outline',
      autoPromptEnabled: true,
      promptDelay: true,
      promptDelaySecs: 5,
      reduceMotion: true,
    },
    controls: [
      ['#inp-pattern-length', 'value', '3'],
      ['#inp-reps', 'value', '1'],
      ['#inp-blanks', 'value', '3'],
      ['#inp-bank', 'value', '6'],
      ['#chk-represent-errors', 'checked', false],
      ['#chk-errorless', 'checked', true],
      ['#chk-no-error-anim', 'checked', true],
      ['#chk-persists', 'checked', true],
      ['#sel-prompt-style', 'value', 'outline'],
      ['#chk-auto-prompt', 'checked', true],
      ['#chk-prompt-delay', 'checked', true],
      ['#sel-prompt-delay', 'value', '5'],
      ['#chk-reduce-motion', 'checked', true],
    ],
    fresh: [
      ['#inp-pattern-length', 'value', '2'],
      ['#inp-reps', 'value', '2'],
      ['#inp-blanks', 'value', '1'],
      ['#inp-bank', 'value', '4'],
      ['#chk-represent-errors', 'checked', true],
      ['#chk-errorless', 'checked', false],
      ['#sel-prompt-style', 'value', 'sparkle'],
      ['#chk-auto-prompt', 'checked', false],
      ['#chk-reduce-motion', 'checked', false],
    ],
  },
];

/**
 * Out of range in three different ways, and every one of them is a value the
 * control cannot render: 99 is past the input's max, 0 is unparseable-as-truthy
 * and below the minimum, and 'neon' is not an option the select offers.
 */
function outOfRange(probe) {
  return {
    seeded: { [probe.option]: 99, promptDelaySecs: 0, promptStyle: 'neon' },
    expected: { [probe.option]: probe.max, promptDelaySecs: 3, promptStyle: 'sparkle' },
    controls: [
      [probe.selector, 'value', String(probe.max)],
      ['#sel-prompt-delay', 'value', '3'],
      ['#sel-prompt-style', 'value', 'sparkle'],
    ],
  };
}

/** Seed a localStorage key before any page script runs. */
async function seed(page, entries) {
  await page.addInitScript((pairs) => {
    for (const [key, value] of pairs) window.localStorage.setItem(key, value);
  }, entries.map(([k, v]) => [k, JSON.stringify(v)]));
}

/**
 * Wait for a signal that boot has finished adopting the settings: every game
 * builds a dropdown straight after `loadSettings()` — the stimulus topic for
 * the six library games, the category for `intraverbal`, the symbol set for
 * `patterns` — so a dropdown with real options means the store has been read.
 */
async function bootedWithSettings(page, boot) {
  const { selector, notText } = boot || DEFAULT_BOOT;
  await expect(page.locator(selector).first()).not.toHaveText(notText);
}

async function readStore(page, storeKey) {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || 'null'), storeKey);
}

async function expectControls(page, controls) {
  for (const [selector, kind, want] of controls) {
    const locator = page.locator(selector);
    if (kind === 'value') await expect(locator, `${selector} shows ${want}`).toHaveValue(String(want));
    // Not every persisted setting has a form control: `matching`'s displayMode
    // is the toolbar Simple/Visual slider, whose state is its aria-checked.
    else if (kind.startsWith('attr:')) {
      await expect(locator, `${selector} ${kind} is ${want}`).toHaveAttribute(kind.slice(5), String(want));
    }
    else if (want) await expect(locator, `${selector} is checked`).toBeChecked();
    else await expect(locator, `${selector} is unchecked`).not.toBeChecked();
  }
}

for (const row of ADOPTED) {
  const { game, url, legacyKey, storeKey, seeded, controls, fresh } = row;
  const boot = row.boot || DEFAULT_BOOT;
  const probe = row.probe || DEFAULT_PROBE;
  const OUT_OF_RANGE = outOfRange(probe);

  test(`${game}: loads the shared settings module`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(url);

    await expect(page.locator('script[src*="game-settings.js"]')).toHaveCount(1);
    expect(await page.evaluate(() => typeof window.NooutcoSettings), 'the module loaded').toBe('object');
    await bootedWithSettings(page, boot);
    expect(errors, 'the game booted without a page error').toEqual([]);
  });

  test(`${game}: a fresh install shows this game's own declared defaults`, async ({ page }) => {
    // The non-negotiable in this list is `#chk-auto-prompt`: it defaults to
    // FALSE in all nine games and TRUE only in `sequences`. Moving the schema
    // into a shared module is exactly the change that could harmonise it.
    await page.goto(url);
    await bootedWithSettings(page, boot);
    await expectControls(page, fresh);
  });

  test(`${game}: a retired ${legacyKey} configuration folds into the store`, async ({ page }) => {
    await seed(page, [[legacyKey, seeded]]);
    await page.goto(url);
    await bootedWithSettings(page, boot);

    // The panel the technician reads is the assertion that matters — a fold
    // that landed in storage but never reached the controls is still a fold
    // that lost their configuration as far as they can tell.
    await expectControls(page, controls);

    const stored = await readStore(page, storeKey);
    expect(stored && stored.working, `${storeKey} carries a working config`).toBeTruthy();
    for (const [option, value] of Object.entries(seeded)) {
      expect(stored.working[option], `${option} folded`).toEqual(value);
    }
  });

  test(`${game}: the retired ${legacyKey} is never dropped, before or after an edit`, async ({ page }) => {
    const seededJson = JSON.stringify(seeded);
    await seed(page, [[legacyKey, seeded]]);
    await page.goto(url);
    await bootedWithSettings(page, boot);
    await expect(page.locator(probe.selector)).toHaveValue(String(probe.seeded));

    // A real edit through the game's own handler, so this exercises the
    // production save path rather than the store in isolation.
    await page.evaluate(([selector, value]) => {
      const input = document.querySelector(selector);
      input.value = String(value);
      input.dispatchEvent(new Event('change'));
    }, [probe.selector, probe.edited]);

    await expect
      .poll(async () => (await readStore(page, storeKey)).working[probe.option])
      .toBe(probe.edited);

    const legacy = await page.evaluate((key) => window.localStorage.getItem(key), legacyKey);
    expect(legacy, `${legacyKey} is byte-for-byte what was seeded`).toBe(seededJson);
  });

  test(`${game}: a configuration already in the store outranks ${legacyKey}`, async ({ page }) => {
    // Once the game has been configured under the new store, the retired key is
    // stale: re-folding it would silently revert the technician's newer edits.
    await seed(page, [
      [legacyKey, { ...seeded, [probe.option]: probe.seeded, promptStyle: 'outline' }],
      [storeKey, { working: { ...seeded, [probe.option]: probe.ahead, promptStyle: 'sparkle' } }],
    ]);
    await page.goto(url);
    await bootedWithSettings(page, boot);

    await expect(page.locator(probe.selector)).toHaveValue(String(probe.ahead));
    await expect(page.locator('#sel-prompt-style')).toHaveValue('sparkle');
    expect((await readStore(page, storeKey)).working[probe.option]).toBe(probe.ahead);
  });

  test(`${game}: an out-of-range stored value is clamped into the panel's range`, async ({ page }) => {
    await seed(page, [[legacyKey, { ...seeded, ...OUT_OF_RANGE.seeded }]]);
    await page.goto(url);
    await bootedWithSettings(page, boot);

    await expectControls(page, OUT_OF_RANGE.controls);

    const { working } = await readStore(page, storeKey);
    for (const [option, value] of Object.entries(OUT_OF_RANGE.expected)) {
      expect(working[option], `${option} was clamped, not left unshowable`).toEqual(value);
    }
  });
}
