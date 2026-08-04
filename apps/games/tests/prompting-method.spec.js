import { test, expect } from '@playwright/test';

/**
 * Stage 7 - `sequences`' three prompting-method cards reach the other games.
 *
 * `sequences` has shipped Most-to-Least / Time-Delay / Least-to-Most as named
 * procedures since Frame 04. The eight games in this table exposed only the
 * primitives the procedures are made of - an Auto-Prompt switch and a Prompt
 * Delay switch - so a technician had to already know that "auto-prompt on,
 * delay off" IS most-to-least. `../prompting-method.js` is that vocabulary,
 * shared, and it adds no stored option: the selected procedure is DERIVED from
 * the two switches, so nothing new is persisted and the two cannot disagree.
 *
 * Five properties per game, because every one of them can break per game:
 *
 *   1. the group renders (a missing script tag or markup line leaves the panel
 *      exactly as it was, which no other assertion notices)
 *   2. the selection follows the STORED configuration on load - the load path
 *      writes `.checked` programmatically, which fires no `change` event, so a
 *      game that never calls `refresh()` shows the wrong procedure
 *   3. choosing a procedure drives the switches through the game's own change
 *      handlers and therefore persists
 *   4. an Advanced override moves the selection, which is what keeps the group
 *      honest rather than making it a fourth source of truth
 *   5. a preset never rewrites the technician's prompt-delay seconds
 *
 * `emotions` is deliberately absent: it has no Prompt Delay boolean at all - * its `promptDelay` IS the seconds (finding 63) - so there is no second
 * primitive for the procedures to compose. `sequences` is absent because it
 * already has this UI, with its own stored `prompting` field.
 */

const METHODS = ['most-to-least', 'time-delay', 'least-to-most'];

const DEFAULT_BOOT = { selector: '#sel-topic option', notText: '-- scanning --' };

/**
 * `autoField` is the one field name the eight games do not share: seven spell
 * the auto-prompt flag `autoPromptEnabled`, `think-or-say` spells it
 * `autoPrompt`. Everything else the group touches (`promptDelay`,
 * `promptDelaySecs`) is already platform-wide.
 */
const GAMES = [
  { game: 'clock',        url: '/clock/',        storeKey: 'nooutco.settings.clock' },
  { game: 'receptive',    url: '/receptive/',    storeKey: 'nooutco.settings.receptive' },
  { game: 'matching',     url: '/matching/',     storeKey: 'nooutco.settings.matching' },
  { game: 'market',       url: '/market/',       storeKey: 'nooutco.settings.market' },
  {
    game: 'intraverbal', url: '/intraverbal/', storeKey: 'nooutco.settings.intraverbal',
    boot: { selector: '#sel-category option', notText: '(no categories)' },
  },
  {
    game: 'patterns', url: '/patterns/', storeKey: 'nooutco.settings.patterns',
    boot: { selector: '#sel-set option', notText: '-- loading --' },
  },
  {
    game: 'ffc', url: '/ffc/', storeKey: 'nooutco.settings.ffc.trial',
    boot: { selector: '#sel-tag option', notText: '(no tags available)' },
  },
  {
    game: 'think-or-say', url: '/think-or-say/', storeKey: 'nooutco.settings.think-or-say',
    autoField: 'autoPrompt',
    boot: { selector: '#sel-category option', text: 'All categories' },
  },
];

/** Seed a localStorage key before any page script runs. */
async function seed(page, entries) {
  await page.addInitScript((pairs) => {
    for (const [key, value] of pairs) window.localStorage.setItem(key, value);
  }, entries.map(([k, v]) => [k, JSON.stringify(v)]));
}

/** Same boot signal the settings-store adoption table uses: a built dropdown. */
async function bootedWithSettings(page, boot) {
  const { selector, notText, text } = boot || DEFAULT_BOOT;
  const locator = page.locator(selector).first();
  if (text != null) await expect(locator).toHaveText(text);
  else await expect(locator).not.toHaveText(notText);
}

async function readStore(page, storeKey) {
  return page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) || 'null'), storeKey);
}

/** Open the collapsed settings panel the group lives in. */
async function openPanel(page) {
  await page.locator('#btn-extra-toggle').click();
  await expect(page.locator('#extra-panel')).toBeVisible();
}

function pill(page, method) {
  return page.locator(`[data-prompting-method] [data-method="${method}"]`);
}

async function expectSelected(page, method) {
  for (const m of METHODS) {
    await expect(pill(page, m), `${m} is ${m === method ? 'selected' : 'not selected'}`)
      .toHaveAttribute('aria-checked', m === method ? 'true' : 'false');
  }
}

for (const row of GAMES) {
  const { game, url, storeKey } = row;
  const boot = row.boot || DEFAULT_BOOT;
  const autoField = row.autoField || 'autoPromptEnabled';

  test(`${game}: the prompting-method group renders three named procedures`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(url);
    await bootedWithSettings(page, boot);

    await expect(page.locator('script[src*="prompting-method.js"]')).toHaveCount(1);
    await openPanel(page);

    const group = page.locator('[data-prompting-method] [role="radiogroup"]');
    await expect(group).toBeVisible();
    await expect(group.locator('[role="radio"]')).toHaveCount(3);
    for (const m of METHODS) await expect(pill(page, m)).toBeVisible();
    expect(errors, 'the game booted without a page error').toEqual([]);
  });

  test(`${game}: the selection is derived from the stored switches, not from the defaults`, async ({ page }) => {
    // Both switches on IS time delay. A game that never calls refresh() after
    // rendering the panel shows least-to-most here, because the group would
    // still be reading the unchecked boxes the HTML shipped.
    await seed(page, [[storeKey, { working: { [autoField]: true, promptDelay: true } }]]);
    await page.goto(url);
    await bootedWithSettings(page, boot);
    await openPanel(page);

    await expect(page.locator('#chk-auto-prompt')).toBeChecked();
    await expect(page.locator('#chk-prompt-delay')).toBeChecked();
    await expectSelected(page, 'time-delay');
  });

  test(`${game}: choosing a procedure drives the switches and is persisted`, async ({ page }) => {
    // A fresh install is least-to-most everywhere but `sequences`, because
    // auto-prompt defaults to false - the per-game default hard constraint 2
    // protects, read through the new vocabulary.
    await page.goto(url);
    await bootedWithSettings(page, boot);
    await openPanel(page);
    await expectSelected(page, 'least-to-most');

    await pill(page, 'time-delay').click();

    await expect(page.locator('#chk-auto-prompt')).toBeChecked();
    await expect(page.locator('#chk-prompt-delay')).toBeChecked();
    await expectSelected(page, 'time-delay');

    // Persisted through the game's own change handlers - the group never
    // writes storage itself.
    await expect.poll(async () => {
      const s = await readStore(page, storeKey);
      return s && s.working ? [s.working[autoField], s.working.promptDelay] : null;
    }, { message: 'the store holds both switches on' }).toEqual([true, true]);
  });

  test(`${game}: an Advanced override moves the selection`, async ({ page }) => {
    // The primitives stay authoritative. Switching the delay off under Advanced
    // turns a time-delay procedure into a most-to-least one, and the group has
    // to say so rather than keep displaying the procedure last clicked.
    await seed(page, [[storeKey, { working: { [autoField]: true, promptDelay: true } }]]);
    await page.goto(url);
    await bootedWithSettings(page, boot);
    await openPanel(page);
    await expectSelected(page, 'time-delay');

    await page.locator('#chk-prompt-delay').uncheck();
    await expectSelected(page, 'most-to-least');

    await page.locator('#chk-auto-prompt').uncheck();
    await expectSelected(page, 'least-to-most');
  });

  test(`${game}: choosing Time Delay leaves the technician's seconds alone`, async ({ page }) => {
    // `sequences`' own preset resets the delay to 3 s on every click, which
    // silently discards a configured 7 s. The shared preset patches the two
    // switches and nothing else - hard constraint 1, read as "no setting
    // silently redefaulted".
    await seed(page, [[storeKey, { working: { [autoField]: false, promptDelay: false, promptDelaySecs: 7 } }]]);
    await page.goto(url);
    await bootedWithSettings(page, boot);
    await openPanel(page);
    await expectSelected(page, 'least-to-most');

    await pill(page, 'time-delay').click();

    await expect(page.locator('#sel-prompt-delay')).toHaveValue('7');
    await expect.poll(async () => {
      const s = await readStore(page, storeKey);
      return s && s.working ? s.working.promptDelaySecs : null;
    }, { message: 'the stored seconds are untouched' }).toBe(7);
  });
}

// ── The module's own vocabulary ────────────────────────────────────────────

/**
 * Driven in the page rather than in node because the module is a browser
 * global (`window.NooutcoPrompting`), loaded by the same <script> tag the games
 * use. `/clock/` is an arbitrary host for it.
 */
test('derive() is total: every combination of the two switches names one procedure', async ({ page }) => {
  await page.goto('/clock/');
  await expect(page.locator('[data-prompting-method] [role="radio"]')).toHaveCount(3);

  const got = await page.evaluate(() => {
    const d = window.NooutcoPrompting.derive;
    return {
      onOff:  d({ autoPrompt: true,  promptDelay: false }),
      onOn:   d({ autoPrompt: true,  promptDelay: true  }),
      offOff: d({ autoPrompt: false, promptDelay: false }),
      // With no automatic prompt there is nothing to delay, so a stale delay
      // flag must not invent a fourth state the panel cannot show.
      offOn:  d({ autoPrompt: false, promptDelay: true  }),
    };
  });

  expect(got).toEqual({
    onOff: 'most-to-least',
    onOn: 'time-delay',
    offOff: 'least-to-most',
    offOn: 'least-to-most',
  });
});

test('presetFor() and derive() are inverses for all three procedures', async ({ page }) => {
  await page.goto('/clock/');
  await expect(page.locator('[data-prompting-method] [role="radio"]')).toHaveCount(3);

  const round = await page.evaluate(() => {
    const { METHODS, derive, presetFor } = window.NooutcoPrompting;
    return METHODS.map(m => [m.id, derive(presetFor(m.id))]);
  });

  expect(round).toEqual([
    ['most-to-least', 'most-to-least'],
    ['time-delay', 'time-delay'],
    ['least-to-most', 'least-to-most'],
  ]);
});

test('a preset patches the two switches and nothing else', async ({ page }) => {
  await page.goto('/clock/');
  await expect(page.locator('[data-prompting-method] [role="radio"]')).toHaveCount(3);

  const keys = await page.evaluate(() =>
    window.NooutcoPrompting.METHODS.map(m => Object.keys(window.NooutcoPrompting.presetFor(m.id)).sort()));

  for (const k of keys) expect(k).toEqual(['autoPrompt', 'promptDelay']);
});
