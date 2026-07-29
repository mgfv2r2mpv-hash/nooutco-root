import { test, expect } from '@playwright/test';

/**
 * Stage 5 — `NooutcoConfig.migrate()` in every in-scope game.
 *
 * `CLAUDE.md` mandates that every game call `NooutcoConfig.migrate()` early in
 * boot, but only `matching` and `market` did. That hook is the only place a
 * renamed or restructured settings key can be folded forward, so it has to be
 * live *before* anything is renamed — a game that reads `hddSettings` without
 * having run a migration first would adopt a config the migration was supposed
 * to rewrite, and then persist the adopted version over it.
 *
 * Two properties are asserted per game, and they are different properties:
 *
 *   1. the migration runs at all      — `nooutco:configVersion` is stamped
 *   2. it runs BEFORE the settings read — the ordering probe below
 *
 * (1) alone passes with the call sitting *after* `loadSettings()`, which is the
 * exact mistake that makes a future migration a no-op. (2) is what fails on it.
 *
 * The third block is the per-game settings round-trip owed since Stage 1: seed
 * the key a technician's configuration lives under today, load the game, and
 * assert every option came back. `clock`, `receptive`, `matching` and `market`
 * are covered by `stimulus-repoint.spec.js` and `ffc` by `stimulus-ffc.spec.js`
 * (both also assert the target remapping those games needed); the five games
 * with no coverage at all are covered here.
 */

const VERSION_KEY = 'nooutco:configVersion';

/**
 * Every in-scope game, and the key its settings live under today.
 *
 * A game that has adopted the shared store (Stage 6) reads `nooutco.settings.*`
 * — its retired key is still read, but only by `foldLegacy()` and only until
 * the fold has run once, so the store key is the read that has to come after
 * the migration on every load.
 */
const GAMES = [
  { game: 'clock',        url: '/clock/',        settingsKey: 'nooutco.settings.clock' },
  { game: 'emotions',     url: '/emotions/',     settingsKey: 'nooutco.settings.emotions' },
  // NOT `nooutco.settings.ffc` — that key holds ffc's Frame 07 session document,
  // which has the same {sets,last,working} shape and a different schema. The
  // trial settings took their own key rather than collide with it.
  { game: 'ffc',          url: '/ffc/',          settingsKey: 'nooutco.settings.ffc.trial' },
  { game: 'intraverbal',  url: '/intraverbal/',  settingsKey: 'nooutco.settings.intraverbal' },
  // matching's retired key was mgSettings and market's mmSettings — the pairing
  // is the opposite of what the folder names suggest. Both have since adopted
  // the store, so the key named here is the store's; naming the retired key
  // would go vacuous from the second load onward, once foldLegacy() returns
  // before ever touching it.
  { game: 'market',       url: '/market/',       settingsKey: 'nooutco.settings.market' },
  { game: 'matching',     url: '/matching/',     settingsKey: 'nooutco.settings.matching' },
  { game: 'patterns',     url: '/patterns/',     settingsKey: 'nooutco.settings.patterns' },
  { game: 'receptive',    url: '/receptive/',    settingsKey: 'nooutco.settings.receptive' },
  // sequences reads its retired key through migrateLegacyIntoStore().
  { game: 'sequences',    url: '/sequences/',    settingsKey: 'seqSettings' },
  { game: 'think-or-say', url: '/think-or-say/', settingsKey: 'nooutco.settings.think-or-say' },
];

/**
 * Record the order of localStorage reads and writes for the whole page load.
 *
 * `Storage.prototype` rather than the `localStorage` instance: assigning to
 * `localStorage.getItem` goes through Storage's named-property setter in some
 * engines, which stores an *entry* called "getItem" and leaves the prototype
 * method in place — the patch would silently do nothing on those browsers.
 */
const ORDER_PROBE = () => {
  const order = [];
  window.__lsOrder = order;
  const proto = Storage.prototype;
  const get = proto.getItem;
  const set = proto.setItem;
  proto.getItem = function (key) { order.push('get:' + key); return get.call(this, key); };
  proto.setItem = function (key, value) { order.push('set:' + key); return set.call(this, key, value); };
};

// ── 1. The migration runs ──────────────────────────────────────────────────

for (const { game, url } of GAMES) {
  test(`${game}: NooutcoConfig.migrate() runs during boot`, async ({ page }) => {
    await page.goto(url);

    await expect(page.locator('script[src*="migrate-config.js"]')).toHaveCount(1);
    expect(await page.evaluate(() => typeof window.NooutcoConfig), 'the module loaded').toBe('object');

    // The version stamp is the migration's only side effect today, so it is the
    // observable that says it ran. Polled because several games boot from an
    // async DOMContentLoaded handler.
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), VERSION_KEY))
      .toBe(await page.evaluate(() => window.APP_VERSION || '0.1.0'));
  });
}

// ── 2. …and runs before the game reads its settings ────────────────────────

for (const { game, url, settingsKey } of GAMES) {
  test(`${game}: the migration runs before ${settingsKey} is read`, async ({ page }) => {
    await page.addInitScript(ORDER_PROBE);
    await page.goto(url);

    // Self-synchronising: wait for the read itself rather than for a per-game
    // boot marker, so this test does not need to know each game's boot shape.
    await expect
      .poll(() => page.evaluate((key) => (window.__lsOrder || []).includes('get:' + key), settingsKey))
      .toBe(true);

    const order = await page.evaluate(() => window.__lsOrder);
    const stamped = order.indexOf(`set:${VERSION_KEY}`);
    const read = order.indexOf(`get:${settingsKey}`);

    expect(stamped, `${VERSION_KEY} was written`).toBeGreaterThanOrEqual(0);
    expect(stamped, `the migration ran before ${settingsKey} was read (order: ${order.join(', ')})`)
      .toBeLessThan(read);
  });
}

// ── 3. A seeded settings payload survives a reload, value by value ─────────

/**
 * Every value is deliberately off its default, so a game that silently
 * redefaults an option fails rather than coincidentally matching it.
 *
 * `expect` on a locator retries, so no per-game boot marker is needed: the
 * assertion simply waits for the control the game populates from the payload.
 */
const ROUND_TRIPS = [
  {
    game: 'intraverbal',
    url: '/intraverbal/',
    key: 'ivgSettings',
    storeKey: 'nooutco.settings.intraverbal',
    seeded: {
      category: 'children_songs',
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
      targetFilters: {},
    },
    controls: [
      ['category', '#sel-category', 'value', 'children_songs'],
      ['arraySize', '#inp-size', 'value', '6'],
      ['representErrors', '#chk-represent-errors', 'checked', false],
      ['errorless', '#chk-errorless', 'checked', true],
      ['noErrorAnim', '#chk-no-error-anim', 'checked', true],
      ['crossCategory', '#chk-cross', 'checked', true],
      ['promptPersists', '#chk-persists', 'checked', true],
      ['promptStyle', '#sel-prompt-style', 'value', 'outline'],
      ['autoPromptEnabled', '#chk-auto-prompt', 'checked', true],
      ['promptDelay', '#chk-prompt-delay', 'checked', true],
      ['promptDelaySecs', '#sel-prompt-delay', 'value', '5'],
      ['vocalPromptsEnabled', '#chk-vocal-prompts', 'checked', true],
      ['vocalResponsesEnabled', '#chk-vocal-responses', 'checked', true],
    ],
  },
  {
    game: 'patterns',
    url: '/patterns/',
    key: 'ppcSettings',
    storeKey: 'nooutco.settings.patterns',
    seeded: {
      setName: 'Weather',
      patternLength: 3,
      shownReps: 1,
      blanksToFill: 2,
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
      ['setName', '#sel-set', 'value', 'Weather'],
      ['patternLength', '#inp-pattern-length', 'value', '3'],
      ['shownReps', '#inp-reps', 'value', '1'],
      ['blanksToFill', '#inp-blanks', 'value', '2'],
      ['bankSize', '#inp-bank', 'value', '6'],
      ['representErrors', '#chk-represent-errors', 'checked', false],
      ['errorless', '#chk-errorless', 'checked', true],
      ['noErrorAnim', '#chk-no-error-anim', 'checked', true],
      ['promptPersists', '#chk-persists', 'checked', true],
      ['promptStyle', '#sel-prompt-style', 'value', 'outline'],
      ['autoPromptEnabled', '#chk-auto-prompt', 'checked', true],
      ['promptDelay', '#chk-prompt-delay', 'checked', true],
      ['promptDelaySecs', '#sel-prompt-delay', 'value', '5'],
      ['reduceMotion', '#chk-reduce-motion', 'checked', true],
    ],
  },
  {
    game: 'think-or-say',
    url: '/think-or-say/',
    key: 'tosSettings',
    storeKey: 'nooutco.settings.think-or-say',
    // The only retired payload whose fold is not a straight carry-forward:
    // `promptDelaySec` (singular, and a string) is renamed onto the
    // `promptDelaySecs` int the other games declare. `tosSettings` itself keeps
    // its own spelling — the `saved[option]` loop below is what asserts that.
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
      includeTricky: true,
    },
    seeded: {
      category: 'private',
      order: 'sequential',
      represent: false,
      errorless: true,
      noErrorAnim: true,
      autoPrompt: true,
      promptDelay: true,
      promptDelaySec: '5',
      promptStyle: 'outline',
      showReason: false,
      includeTricky: true,
    },
    controls: [
      ['category', '#sel-category', 'value', 'private'],
      ['order', '#sel-order', 'value', 'sequential'],
      ['represent', '#chk-represent-errors', 'checked', false],
      ['errorless', '#chk-errorless', 'checked', true],
      ['noErrorAnim', '#chk-no-error-anim', 'checked', true],
      ['autoPrompt', '#chk-auto-prompt', 'checked', true],
      ['promptDelay', '#chk-prompt-delay', 'checked', true],
      ['promptDelaySec', '#sel-prompt-delay', 'value', '5'],
      ['promptStyle', '#sel-prompt-style', 'value', 'outline'],
      ['showReason', '#chk-show-reason', 'checked', false],
      ['includeTricky', '#chk-include-tricky', 'checked', true],
    ],
  },
  {
    game: 'emotions',
    url: '/emotions/',
    key: 'noaba.emotionID.v1',
    storeKey: 'nooutco.settings.emotions',
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
      ['sdR', '#sdRText', 'value', 'Point to {emotion}'],
      ['sdE', '#sdEText', 'value', 'What is {pronoun} feeling?'],
      ['errorless', '#opt-errorless', 'aria-checked', 'true'],
      ['rePresentErrors', '#opt-represent', 'aria-checked', 'true'],
      ['noErrorAnim', '#opt-noerroranim', 'aria-checked', 'true'],
      ['autoPrompt', '#opt-autoprompt', 'aria-checked', 'true'],
      ['promptDelay', '#sel-prompt-delay', 'value', '5'],
      ['size', '#sizes button.on', 'text', '6'],
      ['faceMode', '#faceMode button.on', 'data-v', 'emoji'],
      ['pronoun', '#pron button.on', 'data-v', 'she'],
      ['set', '#targets-count', 'text', '6'],
    ],
  },
];

for (const { game, url, key, storeKey, seeded, folded, controls } of ROUND_TRIPS) {
  test(`${game}: a seeded ${key} survives a reload with every value intact`, async ({ page }) => {
    await page.addInitScript(
      ([k, v]) => window.localStorage.setItem(k, v),
      [key, JSON.stringify(seeded)],
    );
    await page.goto(url);

    for (const [option, selector, kind, expected] of controls) {
      const locator = page.locator(selector);
      const because = `${option} survived the reload`;
      if (kind === 'checked') {
        if (expected) await expect(locator, because).toBeChecked();
        else await expect(locator, because).not.toBeChecked();
      } else if (kind === 'value') {
        await expect(locator, because).toHaveValue(String(expected));
      } else if (kind === 'text') {
        await expect(locator, because).toHaveText(String(expected));
      } else {
        await expect(locator, because).toHaveAttribute(kind, String(expected));
      }
    }

    // Nothing was dropped from the stored document either: a game that rewrote
    // the key on boot with a partial payload would show up here even when every
    // control happened to render the seeded value. For a game that has adopted
    // the shared store this is also the never-drop assertion — foldLegacy()
    // reads the retired key and leaves it exactly as it found it.
    const saved = JSON.parse(await page.evaluate((k) => window.localStorage.getItem(k), key));
    for (const [option, value] of Object.entries(seeded)) {
      expect(saved[option], `${option} is still in the stored settings`).toEqual(value);
    }

    // …and the fold actually landed, rather than the controls happening to
    // render the seeded values from a read that never reached the store.
    if (storeKey) {
      const stored = JSON.parse(await page.evaluate((k) => window.localStorage.getItem(k), storeKey));
      expect(stored && stored.working, `${storeKey} carries a working config`).toBeTruthy();
      for (const [option, value] of Object.entries(folded || seeded)) {
        expect(stored.working[option], `${option} folded into the store`).toEqual(value);
      }
    }
  });
}

// ── sequences: the retired key folds forward, and keeps its own default ────

/**
 * sequences is the one game that already migrates: `migrateLegacyIntoStore()`
 * folds the retired `seqSettings` into the `{sets, last, working}` round store
 * that Stage 6 extracts as the shared schema. Asserted here because that fold
 * is the read-then-fold pattern the other nine games are about to adopt, and
 * because `autoPromptEnabled` is the one option whose default legitimately
 * differs between games — true here, false in the other nine — which a
 * consolidation must not harmonise away.
 */
const SEQ_ROUND_KEY = 'nooutco.settings.sequences';

test('sequences: a retired seqSettings payload folds into the round store', async ({ page }) => {
  const legacy = {
    blanksToFill: 3,
    bankSize: 6,
    representErrors: false,
    errorless: true,
    noErrorAnim: true,
    promptPersists: true,
    promptStyle: 'outline',
    autoPromptEnabled: false,
    promptDelay: true,
    promptDelaySecs: 5,
  };
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    ['seqSettings', JSON.stringify(legacy)],
  );
  await page.goto('/sequences/');

  await expect
    .poll(() => page.evaluate((k) => {
      const raw = window.localStorage.getItem(k);
      return raw ? Boolean(JSON.parse(raw).working) : false;
    }, SEQ_ROUND_KEY))
    .toBe(true);

  const store = JSON.parse(await page.evaluate((k) => window.localStorage.getItem(k), SEQ_ROUND_KEY));
  for (const [option, value] of Object.entries(legacy)) {
    expect(store.working[option], `${option} folded into the round store`).toEqual(value);
  }
});

test("sequences keeps autoPromptEnabled true where the other nine default it false", async ({ page }) => {
  // No autoPromptEnabled in the retired payload: the fold must reach for
  // sequences' own default rather than for the platform-wide one.
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    ['seqSettings', JSON.stringify({ bankSize: 5 })],
  );
  await page.goto('/sequences/');

  await expect
    .poll(() => page.evaluate((k) => {
      const raw = window.localStorage.getItem(k);
      return raw ? Boolean(JSON.parse(raw).working) : false;
    }, SEQ_ROUND_KEY))
    .toBe(true);

  const store = JSON.parse(await page.evaluate((k) => window.localStorage.getItem(k), SEQ_ROUND_KEY));
  expect(store.working.autoPromptEnabled, 'sequences defaults autoPromptEnabled to true').toBe(true);
});
