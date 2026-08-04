import { test, expect } from '@playwright/test';

/**
 * Stage 6, part 2 - the games adopt the shared settings store.
 *
 * `sequences` was migrated in part 1 because it is where the pattern came from.
 * Every other game moves the same way and has to prove the same four things,
 * which is why this table grows one row per game rather than one spec per game:
 *
 *   1. the module is actually loaded (a missing script tag takes the game down
 *      at parse time, so this is the assertion that names the cause)
 *   2. the retired key FOLDS - every option a technician set comes back, in the
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
 * Four things the table cannot assume across ten games, so every row may name
 * its own:
 *   - `boot`: the control each game fills straight after `loadSettings()`,
 *     which is the signal that the store has already been read. A row whose
 *     dropdown ships EMPTY - with no placeholder option to be *not* - names the
 *     `text` it expects instead of a `notText` to exclude.
 *   - `probe`: the numeric control the generic edit / precedence / clamp
 *     assertions drive. Five games share `#inp-size`; `patterns` has no array
 *     size at all and uses its bank size, `emotions` and `think-or-say` their
 *     prompt delay.
 *   - `secondary`: a second, non-numeric option the precedence test uses to
 *     prove the whole config came from the store rather than one field of it.
 *     Eight games have a prompt-style select; `emotions` does not.
 *   - `outOfRange`: which stored values are unshowable, which is a property of
 *     that game's own controls.
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
const DEFAULT_SECONDARY = {
  option: 'promptStyle',
  stale: 'outline',   // what the (by then stale) retired key carries
  ahead: 'sparkle',   // what the store carries
  control: ['#sel-prompt-style', 'value', 'sparkle'],
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
      // The toolbar Simple/Visual slider - no panel control, so it is asserted
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
      // slider - so it is the value that proves the whole enum survived.
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
    // No array size in this game - the bank size is the stepper the generic
    // assertions drive, and its ceiling is 8 rather than 10.
    probe: { selector: '#inp-bank', option: 'bankSize', seeded: 6, edited: 7, ahead: 8, max: 8 },
    seeded: {
      patternLength: 3,
      shownReps: 1,
      // Only meaningful against patternLength 3 - a blanksToFill max resolved
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
  {
    game: 'ffc',
    url: '/ffc/',
    legacyKey: 'ffcgSettings',
    // NOT `nooutco.settings.ffc`: that key already holds this game's Frame 07
    // session document, which has the same {sets,last,working} shape and an
    // entirely different schema. Sharing it would make foldLegacy() refuse for
    // any technician who has ever pressed Start Session.
    storeKey: 'nooutco.settings.ffc.trial',
    boot: { selector: '#sel-tag option', notText: '(no tags available)' },
    seeded: {
      mode: 'function',
      arraySize: 6,
      representErrors: false,
      errorless: true,
      noErrorAnim: true,
      promptPersists: true,
      promptStyle: 'outline',
      autoPromptEnabled: true,
      promptDelay: true,
      promptDelaySecs: 5,
    },
    controls: [
      ['#sel-mode', 'value', 'function'],
      ['#inp-size', 'value', '6'],
      ['#chk-represent-errors', 'checked', false],
      ['#chk-errorless', 'checked', true],
      ['#chk-no-error-anim', 'checked', true],
      ['#chk-persists', 'checked', true],
      ['#sel-prompt-style', 'value', 'outline'],
      ['#chk-auto-prompt', 'checked', true],
      ['#chk-prompt-delay', 'checked', true],
      ['#sel-prompt-delay', 'value', '5'],
    ],
    fresh: [
      ['#sel-mode', 'value', 'feature'],
      ['#inp-size', 'value', '4'],
      ['#chk-represent-errors', 'checked', true],
      ['#chk-errorless', 'checked', false],
      ['#chk-no-error-anim', 'checked', false],
      ['#chk-persists', 'checked', false],
      ['#sel-prompt-style', 'value', 'sparkle'],
      ['#chk-auto-prompt', 'checked', false],
    ],
  },
  {
    game: 'emotions',
    url: '/emotions/',
    legacyKey: 'noaba.emotionID.v1',
    storeKey: 'nooutco.settings.emotions',
    // The one game whose prompt delay is not called `promptDelaySecs`.
    delayOption: 'promptDelay',
    // Every option here is a pill, a segmented button or a chip rather than a
    // form control, so this row reads `aria-checked`, `data-v` and text.
    boot: { selector: '#targets-count', notText: '0' },
    // No array size and no prompt-style select in this game: the prompt delay
    // is the only numeric control the persisted config drives.
    probe: {
      selector: '#sel-prompt-delay',
      option: 'promptDelay',
      seeded: 5, edited: 4, ahead: 2, max: 10,
    },
    secondary: {
      option: 'faceMode',
      stale: 'image',
      ahead: 'emoji',
      control: ['#faceMode button.on', 'attr:data-v', 'emoji'],
    },
    outOfRange: {
      seeded: { promptDelay: 99, size: 5, pronoun: '__custom' },
      expected: { promptDelay: 10, size: 4, pronoun: 'rotate' },
      controls: [
        ['#sel-prompt-delay', 'value', '10'],
        // 5 is not one of the field-size buttons, so leaving it stored renders
        // the row with NO size selected - which reads as "unset", not as 5.
        ['#sizes button.on', 'text', '4'],
        ['#pron button.on', 'attr:data-v', 'rotate'],
      ],
    },
    seeded: {
      set: ['happy', 'sad', 'angry', 'scared', 'tired', 'calm'],
      size: 6,
      sdR: 'Point to {emotion}',
      sdE: 'What is {pronoun} feeling?',
      pronoun: 'she',
      visual: true,
      faceMode: 'emoji',
      errorless: true,
      rePresentErrors: true,
      noErrorAnim: true,
      autoPrompt: true,
      promptDelay: 5,
    },
    controls: [
      ['#targets-count', 'text', '6'],
      ['#sizes button.on', 'text', '6'],
      ['#sdRText', 'value', 'Point to {emotion}'],
      ['#sdEText', 'value', 'What is {pronoun} feeling?'],
      ['#pron button.on', 'attr:data-v', 'she'],
      ['#display-toggle', 'attr:aria-checked', 'true'],
      ['#faceMode button.on', 'attr:data-v', 'emoji'],
      ['#opt-errorless', 'attr:aria-checked', 'true'],
      ['#opt-represent', 'attr:aria-checked', 'true'],
      ['#opt-noerroranim', 'attr:aria-checked', 'true'],
      ['#opt-autoprompt', 'attr:aria-checked', 'true'],
      ['#sel-prompt-delay', 'value', '5'],
    ],
    fresh: [
      ['#targets-count', 'text', '4'],
      ['#sizes button.on', 'text', '4'],
      ['#sdRText', 'value', 'Touch {emotion}'],
      ['#pron button.on', 'attr:data-v', 'rotate'],
      ['#display-toggle', 'attr:aria-checked', 'false'],
      ['#faceMode button.on', 'attr:data-v', 'image'],
      ['#opt-errorless', 'attr:aria-checked', 'false'],
      ['#opt-represent', 'attr:aria-checked', 'false'],
      ['#opt-noerroranim', 'attr:aria-checked', 'false'],
      ['#opt-autoprompt', 'attr:aria-checked', 'false'],
      ['#sel-prompt-delay', 'value', '3'],
    ],
  },
  {
    game: 'think-or-say',
    url: '/think-or-say/',
    legacyKey: 'tosSettings',
    storeKey: 'nooutco.settings.think-or-say',
    // This game's category dropdown is EMPTY in the HTML, so there is no
    // placeholder to exclude: populateCategories() builds it in the same
    // synchronous `init()` that then calls loadSettings(), and the first option
    // it writes is the signal (see the helper).
    boot: { selector: '#sel-category option', text: 'All categories' },
    // No numeric input here either: the prompt delay select is the only
    // persisted value with a range.
    probe: {
      selector: '#sel-prompt-delay',
      option: 'promptDelaySecs',
      seeded: 5, edited: 4, ahead: 2, max: 10,
    },
    outOfRange: {
      // Unshowable in three different ways: past the select's ceiling, a
      // category whose cards no longer exist (which leaves the select blank
      // AND makes buildDeck match nothing, so the game cannot start), and a
      // prompt style the select does not offer.
      seeded: { promptDelaySec: 99, category: 'nonesuch', promptStyle: 'neon' },
      expected: { promptDelaySecs: 10, category: 'all', promptStyle: 'sparkle' },
      controls: [
        ['#sel-prompt-delay', 'value', '10'],
        ['#sel-category', 'value', 'all'],
        ['#sel-prompt-style', 'value', 'sparkle'],
      ],
    },
    seeded: {
      category: 'private',
      order: 'sequential',
      represent: false,
      errorless: true,
      noErrorAnim: true,
      autoPrompt: true,
      promptDelay: true,
      // The retired spelling: singular, and stored as a STRING.
      promptDelaySec: '5',
      promptStyle: 'outline',
      showReason: false,
      includeTricky: true,
    },
    // What the fold makes of that payload. `promptDelaySec` is renamed forward
    // onto the `promptDelaySecs` int eight other games declare; every other
    // option is carried through unchanged, and `tosSettings` keeps its own
    // spelling and its own string (asserted by the never-dropped test).
    folded: {
      category: 'private',
      order: 'sequential',
      represent: false,
      errorless: true,
      noErrorAnim: true,
      autoPrompt: true,
      promptDelay: true,
      promptDelaySecs: 5,
      promptStyle: 'outline',
      showReason: false,
      // The retired "Include Tricky / Reasoning Cards" switch is superseded by
      // the Level selector: its tricky cards were the nuanced, context-decides
      // ones, so a stored `true` folds forward onto Level 2.
      level: 2,
    },
    controls: [
      ['#sel-level', 'value', '2'],
      ['#sel-category', 'value', 'private'],
      ['#sel-order', 'value', 'sequential'],
      ['#chk-represent-errors', 'checked', false],
      ['#chk-errorless', 'checked', true],
      ['#chk-no-error-anim', 'checked', true],
      ['#chk-auto-prompt', 'checked', true],
      ['#chk-prompt-delay', 'checked', true],
      ['#sel-prompt-delay', 'value', '5'],
      ['#sel-prompt-style', 'value', 'outline'],
      ['#chk-show-reason', 'checked', false],
    ],
    fresh: [
      ['#sel-level', 'value', '1'],
      ['#sel-category', 'value', 'all'],
      ['#sel-order', 'value', 'shuffle'],
      ['#chk-represent-errors', 'checked', true],
      ['#chk-errorless', 'checked', false],
      ['#chk-no-error-anim', 'checked', false],
      ['#chk-auto-prompt', 'checked', false],
      ['#chk-prompt-delay', 'checked', false],
      ['#sel-prompt-delay', 'value', '3'],
      ['#sel-prompt-style', 'value', 'sparkle'],
      ['#chk-show-reason', 'checked', true],
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
 * builds a dropdown straight after `loadSettings()` - the stimulus topic for
 * the six library games, the category for `intraverbal`, the symbol set for
 * `patterns` - so a dropdown with real options means the store has been read.
 */
async function bootedWithSettings(page, boot) {
  const { selector, notText, text } = boot || DEFAULT_BOOT;
  const locator = page.locator(selector).first();
  // Nine rows exclude a placeholder option that is in the HTML before boot
  // ('-- scanning --', '(no categories)'). `think-or-say`'s category select
  // ships with NO options at all, so there is no placeholder to be *not*: the
  // equivalent signal is the text of the first option the game builds.
  // (Both forms wait - a negated locator assertion fails on an element that
  // never appears rather than passing vacuously; verified, not assumed.)
  if (text != null) await expect(locator).toHaveText(text);
  else await expect(locator).not.toHaveText(notText);
}

async function readStore(page, storeKey) {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || 'null'), storeKey);
}

async function expectControls(page, controls) {
  for (const [selector, kind, want] of controls) {
    const locator = page.locator(selector);
    if (kind === 'value') await expect(locator, `${selector} shows ${want}`).toHaveValue(String(want));
    // Not every persisted setting has a form control: `matching`'s displayMode
    // is the toolbar Simple/Visual slider, whose state is its aria-checked, and
    // every one of `emotions`' options is a pill, a segment or a chip.
    else if (kind.startsWith('attr:')) {
      await expect(locator, `${selector} ${kind} is ${want}`).toHaveAttribute(kind.slice(5), String(want));
    }
    else if (kind === 'text') await expect(locator, `${selector} reads ${want}`).toHaveText(String(want));
    else if (want) await expect(locator, `${selector} is checked`).toBeChecked();
    else await expect(locator, `${selector} is unchecked`).not.toBeChecked();
  }
}

for (const row of ADOPTED) {
  const { game, url, legacyKey, storeKey, seeded, controls, fresh } = row;
  const boot = row.boot || DEFAULT_BOOT;
  const probe = row.probe || DEFAULT_PROBE;
  const secondary = row.secondary || DEFAULT_SECONDARY;
  // Nine games spell the prompt delay `promptDelaySecs` (an int, paired with a
  // `promptDelay` bool). `emotions` has no bool at all and its `promptDelay`
  // IS the seconds - finding 63, and it cannot be harmonised away.
  const delayOption = row.delayOption || 'promptDelaySecs';
  const OUT_OF_RANGE = row.outOfRange || outOfRange(probe);
  // What the store holds after the retired payload folds. Identical to the
  // seeded payload for every game whose fold is a straight carry-forward;
  // `think-or-say` renames one option on the way through.
  const folded = row.folded || seeded;

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

    // The panel the technician reads is the assertion that matters - a fold
    // that landed in storage but never reached the controls is still a fold
    // that lost their configuration as far as they can tell.
    await expectControls(page, controls);

    const stored = await readStore(page, storeKey);
    expect(stored && stored.working, `${storeKey} carries a working config`).toBeTruthy();
    for (const [option, value] of Object.entries(folded)) {
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
      [legacyKey, { ...seeded, [secondary.option]: secondary.stale }],
      [storeKey, { working: { ...folded, [probe.option]: probe.ahead, [secondary.option]: secondary.ahead } }],
    ]);
    await page.goto(url);
    await bootedWithSettings(page, boot);

    await expect(page.locator(probe.selector)).toHaveValue(String(probe.ahead));
    await expectControls(page, [secondary.control]);
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

  // Stage 7. The clamp above only makes a stored value legal; it does not make
  // it SHOWABLE. All ten games declare the prompt delay as `int {min:1,max:10}`
  // while the select offered 1/2/3/4/5/10, so 6-9 s were in range and
  // unrenderable at once: `select.value = 7` matches no option, the browser
  // resolves it to '', and the panel shows a blank where a programme parameter
  // should be. The options were added (never removed - hard constraint 1), and
  // this is what fails if a later tidy-up prunes them back.
  test(`${game}: the prompt-delay select can show every value the store may hold`, async ({ page }) => {
    await seed(page, [[storeKey, { working: { [delayOption]: 7 } }]]);
    await page.goto(url);
    await bootedWithSettings(page, boot);

    await expect(page.locator('#sel-prompt-delay')).toHaveValue('7');
    expect((await readStore(page, storeKey)).working[delayOption], 'and it is still 7 in the store')
      .toBe(7);
  });
}

// ── ffc keeps two config documents, and they must not collide ──────────────

/**
 * `nooutco.settings.ffc` was already taken when ffc adopted the store - by ffc.
 * The Frame 07 session panel persists a curated per-learner session there, in a
 * `{ sets, last, working }` document with exactly the shared store's SHAPE and
 * an entirely different schema. That is why the trial settings live under
 * `nooutco.settings.ffc.trial` instead, and this is the test that fails if a
 * later tidy-up "corrects" the key to match the other nine games:
 *
 *   - `foldLegacy()` returns early once `working` exists, so `ffcgSettings`
 *     would never fold for a technician who had pressed Start Session once
 *   - `initial()` would then normalize the session document AS trial settings,
 *     defaulting every field it does not recognise
 *
 * Both failures are silent: the game boots, the panel renders, and the
 * technician's programme parameters are simply gone.
 */
const FFC = ADOPTED.find((row) => row.game === 'ffc');

const FFC_SESSION = {
  last: 'Room 2',
  sets: {
    'Room 2': {
      items: [], targets: {},
      includeTypes: ['feature'], arraySize: 3, prompting: 'time-delay',
    },
  },
  working: {
    items: [], targets: {},
    includeTypes: ['feature'], arraySize: 3, prompting: 'time-delay',
  },
};

test('ffc: a saved Frame 07 session neither blocks nor is read as the trial settings', async ({ page }) => {
  await seed(page, [
    ['nooutco.settings.ffc', FFC_SESSION],
    [FFC.legacyKey, FFC.seeded],
  ]);
  await page.goto(FFC.url);
  await bootedWithSettings(page, FFC.boot);

  // The retired key folded even though a session `working` config exists…
  await expectControls(page, FFC.controls);
  const stored = await readStore(page, FFC.storeKey);
  expect(stored && stored.working, 'the trial settings folded into their own key').toBeTruthy();
  expect(stored.working.arraySize, 'and carry ffcgSettings\' array size, not the session\'s 3').toBe(6);

  // …and the session document came back untouched.
  const session = await page.evaluate((key) => window.localStorage.getItem(key), 'nooutco.settings.ffc');
  expect(session, 'the session document is byte-for-byte what was seeded')
    .toBe(JSON.stringify(FFC_SESSION));
});

// ── think-or-say renames one option on the way into the store ──────────────

/**
 * `tosSettings` is the only retired payload whose fold is not a straight
 * carry-forward: it spelled the prompt delay `promptDelaySec` (singular) and
 * stored it as a string, where eight other games declare `promptDelaySecs` as
 * an int. The rename happens in the fold, so the retired key keeps its own
 * spelling and its own string forever (the never-dropped row above asserts
 * that), and nothing downstream has to know two names for one option.
 */
const TOS = ADOPTED.find((row) => row.game === 'think-or-say');

test('think-or-say: the retired promptDelaySec string folds onto the shared promptDelaySecs int', async ({ page }) => {
  await seed(page, [[TOS.legacyKey, TOS.seeded]]);
  await page.goto(TOS.url);
  await bootedWithSettings(page, TOS.boot);

  const stored = await readStore(page, TOS.storeKey);
  expect(stored.working.promptDelaySecs, 'folded forward, as a number').toBe(5);
  expect('promptDelaySec' in stored.working, 'the retired spelling never reaches the store').toBe(false);

  // A live edit writes the shared spelling as a number too. A select's value is
  // a string, so this is what fails if the save path stops normalizing on the
  // way out and starts persisting '4'.
  await page.evaluate(() => {
    const select = document.querySelector('#sel-prompt-delay');
    select.value = '4';
    select.dispatchEvent(new Event('change'));
  });
  await expect
    .poll(async () => (await readStore(page, TOS.storeKey)).working.promptDelaySecs)
    .toBe(4);
});

test('think-or-say: the folded configuration reaches the deck, not just the panel', async ({ page }) => {
  // This game keeps its configuration in the controls rather than in `state`,
  // so `buildDeck()` reads `#sel-category` and `#sel-order` directly. That makes
  // "the fold reached the panel" and "the fold reached the programme" the same
  // read here - but only if a session can still be started at all, which is the
  // path `saveSettings()` (now normalizing on the way out) runs first.
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await seed(page, [['tosSettings', { category: 'kind', order: 'sequential', includeTricky: false }]]);
  await page.goto(TOS.url);
  await bootedWithSettings(page, TOS.boot);
  await expect(page.locator('#sel-category')).toHaveValue('kind');
  // `includeTricky: false` folds forward onto Level 1, so the deck is the
  // Level 1 pool narrowed to 'kind'.
  await expect(page.locator('#sel-level')).toHaveValue('1');

  await page.locator('#btn-play').click();

  // The first card of the 'kind' category, in the order they are declared - // a card from any other category means the deck was built from something
  // other than the technician's folded selection.
  await expect(page.locator('#scenario-situation'))
    .toHaveText('Your friend shows you a drawing they made. You really like how it looks.');
  await expect(page.locator('#progress-label')).toHaveText('Card 1 of 14');
  expect(errors, 'the session started without a page error').toEqual([]);
});

// ── think-or-say: the panel is a view of the configuration (Stage 7) ───────

/**
 * This game used to read its programme parameters straight off the controls - * `buildDeck()` read `#sel-category`, `scheduleAutoPrompt()` read
 * `#sel-prompt-delay`, and `saveSettings()` rebuilt the whole config from the
 * panel on every edit. `state.cfg` is now the single normalized copy and the
 * controls are a view of it.
 *
 * The difference is only visible when a control's value changes WITHOUT a
 * `change` event, which is not the exotic case it sounds like: browsers restore
 * form-control state across a reload and a back-forward navigation, so a
 * checkbox can come back ticked over a stored configuration that says
 * otherwise. Reading the panel in bulk turns that into a programme change no
 * technician made.
 */
/** Exactly what a restored form control looks like: the property moves, no event. */
async function silentlyTick(page, selector) {
  await page.evaluate((sel) => { document.querySelector(sel).checked = true; }, selector);
}

/** The same thing for a select: the value moves, no `change` event. */
async function silentlySelect(page, selector, value) {
  await page.evaluate(([sel, v]) => { document.querySelector(sel).value = v; }, [selector, value]);
}

test('think-or-say: a control changed without a change event never reaches the deck', async ({ page }) => {
  await seed(page, [[TOS.storeKey, { working: { category: 'all', level: 1 } }]]);
  await page.goto(TOS.url);
  await bootedWithSettings(page, TOS.boot);
  await expect(page.locator('#sel-level')).toHaveValue('1');

  await silentlySelect(page, '#sel-level', '3');

  // Level 1 holds 35 cards and Level 3 holds 18. A deck of 18 means buildDeck()
  // read the select rather than the configuration in force.
  await page.locator('#btn-play').click();
  await expect(page.locator('#progress-label')).toHaveText('Card 1 of 35');
});

test('think-or-say: an unrelated edit does not adopt a control nobody changed', async ({ page }) => {
  await seed(page, [[TOS.storeKey, { working: { category: 'all', level: 1 } }]]);
  await page.goto(TOS.url);
  await bootedWithSettings(page, TOS.boot);

  await silentlySelect(page, '#sel-level', '3');

  // An unrelated, REAL edit - the path that used to rebuild the whole config
  // from the panel, quietly adopting every control it found on the way past.
  await page.evaluate(() => {
    const box = document.querySelector('#chk-show-reason');
    box.checked = false;
    box.dispatchEvent(new Event('change'));
  });

  const { working } = await readStore(page, TOS.storeKey);
  expect(working.showReason, 'the edit the technician made is persisted').toBe(false);
  expect(working.level, 'the one they did not make is not').toBe(1);
  // And the panel is re-rendered from the configuration in force, so the
  // silently-restored control is put back rather than left lying.
  await expect(page.locator('#sel-level')).toHaveValue('1');
});

test('think-or-say: a trial runs on the stored configuration, not on the panel', async ({ page }) => {
  // The two remaining runtime reads: errorless prompting (which disables the
  // wrong tile) and the reason card. Both used to come off a checkbox.
  await seed(page, [[TOS.storeKey, {
    working: { category: 'kind', order: 'sequential', errorless: false, showReason: true, noErrorAnim: true },
  }]]);
  await page.goto(TOS.url);
  await bootedWithSettings(page, TOS.boot);

  await silentlyTick(page, '#chk-errorless');
  await page.evaluate(() => { document.querySelector('#chk-show-reason').checked = false; });

  await page.locator('#btn-play').click();
  await page.locator('#reveal-panel').click();

  // The first 'kind' card in declaration order is a SAY IT, so THINK IT is wrong.
  await page.locator('#choices .choice[data-answer="think"]').click();
  await expect(page.locator('#choices .choice[data-answer="think"]'),
    'errorless is off, so the wrong tile stays available').not.toBeDisabled();

  await page.locator('#choices .choice[data-answer="say"]').click();
  await expect(page.locator('#scenario-reason'), 'the reason card is still on').toBeVisible();
});

/**
 * The delay the learner actually waits comes from the store, not from the
 * select. Before Stage 7 this read `parseInt(el.selPromptDelay.value, 10)`,
 * so a stored delay the select could not display resolved to `''` → `NaN` →
 * `setTimeout(fn, NaN)`, which fires immediately: a 7-second time delay
 * silently became an instant prompt, defeating the prompt-fading procedure
 * it exists to run.
 */
test('think-or-say: an auto-prompt waits the stored delay, not zero', async ({ page }) => {
  await seed(page, [[TOS.storeKey, {
    working: { category: 'kind', order: 'sequential', autoPrompt: true, promptDelay: true, promptDelaySecs: 7 },
  }]]);
  await page.goto(TOS.url);
  await bootedWithSettings(page, TOS.boot);
  await expect(page.locator('#sel-prompt-delay')).toHaveValue('7');

  // Now put the panel and the configuration in force out of step, the way a
  // restored form control does, and confirm the programme follows the store.
  await page.evaluate(() => { document.querySelector('#sel-prompt-delay').value = '1'; });

  await page.locator('#btn-play').click();
  await page.locator('#reveal-panel').click();
  await expect(page.locator('#choices')).toBeVisible();

  // Well inside the 7 s delay, and well past the 1 s the panel is showing:
  // no choice tile may be carrying a prompt yet.
  await page.waitForTimeout(2000);
  await expect(page.locator('#choices .prompt-sparkle, #choices .prompt-outline')).toHaveCount(0);
});

test('ffc: the retired __auto__ tag sentinel folds to an empty selection', async ({ page }) => {
  // `__auto__` was an older "pick a tag for me" sentinel that the tag dropdown
  // now expresses as an empty selection. The old load re-checked it on EVERY
  // read; the store reads the retired key once, so the rewrite has to happen in
  // the fold or the sentinel is adopted verbatim as a tag name and persisted.
  await seed(page, [[FFC.legacyKey, { ...FFC.seeded, tag: '__auto__' }]]);
  await page.goto(FFC.url);
  await bootedWithSettings(page, FFC.boot);

  const stored = await readStore(page, FFC.storeKey);
  expect(stored.working.tag, 'the sentinel never reaches the store as a tag').toBe('');
});
