import { test, expect } from '@playwright/test';

/**
 * Stage 6 part 1 — the shared settings store, `game-settings.js`.
 *
 * The module is the `sequences` round-setup pattern lifted out verbatim in
 * behaviour: the `{sets, last, working}` schema, `normalize()` clamping, the
 * press-and-hold-to-unlock gear gating, and the one migration primitive the
 * stage turns on — `foldLegacy()`, read-then-fold, never drop.
 *
 * Two halves, and both are needed:
 *
 *   1. the module's own semantics, driven directly against a scratch key, so a
 *      rule that no game happens to exercise today still has a test on it
 *   2. `sequences` running on it, driven through the real page, because the
 *      module is only correct if the game it was extracted from behaves the
 *      same way it did before the extraction
 *
 * The scratch keys below are deliberately outside every game's namespace, so
 * these tests can never write a config a game would then adopt.
 */

const SCRATCH = 'nooutco.test.settings.store';
const SCRATCH_LEGACY = 'nooutco.test.settings.legacy';
const SEQ_KEY = 'nooutco.settings.sequences';

/**
 * Install a scratch-store factory, then open a page that loads the module.
 *
 * `sequences` is the game the module was extracted from, so a failure to load
 * it here is itself a finding. The factory's field spec covers one of each
 * type, with the two properties that matter clinically: a bool that defaults
 * TRUE (so a silent redefault to false shows up) and an int whose default is
 * not its minimum (so "fell back to the default" and "fell back to the floor
 * of the range" are distinguishable).
 */
async function openModule(page) {
  await page.addInitScript(([key, legacyKey]) => {
    window.__scratchStore = () => {
      window.localStorage.removeItem(key);
      window.localStorage.removeItem(legacyKey);
      return window.NooutcoSettings.defineStore({
        key,
        legacyKey,
        fields: {
          patterns:  { type: 'list', values: ['AB', 'ABC', 'AABB'], default: ['AB'] },
          reps:      { type: 'int', min: 1, max: 10, default: 2 },
          bankSize:  { type: 'int', min: 2, max: 8, default: 4 },
          style:     { type: 'enum', values: ['sparkle', 'outline'], default: 'sparkle' },
          setName:   { type: 'string', default: '' },
          sound:     { type: 'bool', default: true },
          errorless: { type: 'bool', default: false },
          // An opaque technician-keyed object, the shape `targetFilters` has.
          targets:   { type: 'map', default: {} },
        },
      });
    };
  }, [SCRATCH, SCRATCH_LEGACY]);
  await page.goto('/sequences/');
  expect(await page.evaluate(() => typeof window.NooutcoSettings), 'the module loaded').toBe('object');
}

// ── 1. normalize(): clamping that never silently redefaults ────────────────

test('normalize clamps an out-of-range int into range', async ({ page }) => {
  await openModule(page);
  const out = await page.evaluate(() => {
    const store = window.__scratchStore();
    return {
      tooHigh: store.normalize({ bankSize: 99 }).bankSize,
      tooLow: store.normalize({ bankSize: 1 }).bankSize,
      inRange: store.normalize({ bankSize: 6 }).bankSize,
    };
  });
  expect(out).toEqual({ tooHigh: 8, tooLow: 2, inRange: 6 });
});

test('an unparseable int takes the field default, not the floor of its range', async ({ page }) => {
  await openModule(page);
  // bankSize's default (4) is deliberately not its minimum (2): a corrupted
  // value must restore the programme's default, not quietly move the
  // technician to the bottom of the range.
  const out = await page.evaluate(() => {
    const store = window.__scratchStore();
    return {
      absent: store.normalize({}).bankSize,
      garbage: store.normalize({ bankSize: 'six' }).bankSize,
      declared: store.defaults().bankSize,
    };
  });
  expect(out).toEqual({ absent: 4, garbage: 4, declared: 4 });
});

test('a stored false survives a field that defaults true', async ({ page }) => {
  await openModule(page);
  // Hard constraint 1 in miniature: a saved option is never silently
  // redefaulted. `sound` defaults true; a technician who turned it off must
  // still have it off after a reload.
  const out = await page.evaluate(() => {
    const store = window.__scratchStore();
    return {
      storedFalse: store.normalize({ sound: false }).sound,
      absent: store.normalize({}).sound,
      storedTrueOnFalseDefault: store.normalize({ errorless: true }).errorless,
      absentOnFalseDefault: store.normalize({}).errorless,
    };
  });
  expect(out).toEqual({
    storedFalse: false,
    absent: true,
    storedTrueOnFalseDefault: true,
    absentOnFalseDefault: false,
  });
});

test('normalize drops list members the content no longer has, then falls back', async ({ page }) => {
  await openModule(page);
  const out = await page.evaluate(() => {
    const store = window.__scratchStore();
    return {
      partial: store.normalize({ patterns: ['AB', 'RETIRED', 'ABC'] }).patterns,
      allGone: store.normalize({ patterns: ['RETIRED'] }).patterns,
      notAList: store.normalize({ patterns: 'AB' }).patterns,
      enumFallback: store.normalize({ style: 'neon' }).style,
      enumKept: store.normalize({ style: 'outline' }).style,
    };
  });
  expect(out).toEqual({
    partial: ['AB', 'ABC'],
    allGone: ['AB'],
    notAList: ['AB'],
    enumFallback: 'sparkle',
    enumKept: 'outline',
  });
});

test('a map keeps every key and value it was given', async ({ page }) => {
  await openModule(page);
  // `targetFilters` is the live case, and its keys and values are BOTH content:
  // a topic whose art is temporarily unpublished must still come back carrying
  // the targets the technician chose, so nothing here may be validated away.
  const out = await page.evaluate(() => {
    const store = window.__scratchStore();
    const chosen = { T_animals: ['/a/bear.jpg', '/a/cat.jpg'], T_retired_topic: ['/r/old.png'] };
    return {
      kept: store.normalize({ targets: chosen }).targets,
      // The stored object must not be adopted by reference — a later live edit
      // to state would otherwise reach back into what was normalized.
      copied: store.normalize({ targets: chosen }).targets !== chosen,
      notAnObject: store.normalize({ targets: 'T_animals' }).targets,
      absent: store.normalize({}).targets,
    };
  });
  expect(out).toEqual({
    kept: { T_animals: ['/a/bear.jpg', '/a/cat.jpg'], T_retired_topic: ['/r/old.png'] },
    copied: true,
    notAnObject: {},
    absent: {},
  });
});

test('defaults() hands back a fresh map each time', async ({ page }) => {
  await openModule(page);
  const out = await page.evaluate(() => {
    const store = window.__scratchStore();
    store.defaults().targets.T_animals = ['/a/bear.jpg'];
    return store.defaults().targets;
  });
  expect(out).toEqual({});
});

test('defaults() hands back a fresh list each time', async ({ page }) => {
  await openModule(page);
  // A shared array would let one caller's edit reach into the next call's
  // defaults — the kind of bug that only shows up after a panel reset.
  const out = await page.evaluate(() => {
    const store = window.__scratchStore();
    store.defaults().patterns.push('ABC');
    return store.defaults().patterns;
  });
  expect(out).toEqual(['AB']);
});

// ── 2. The {sets, last, working} store ─────────────────────────────────────

test('a named set round-trips through the store', async ({ page }) => {
  await openModule(page);
  const out = await page.evaluate((key) => {
    const store = window.__scratchStore();
    store.saveSet('Morning block', { reps: 7, bankSize: 6, sound: false, patterns: ['ABC'] });
    return {
      names: store.setNames(),
      last: JSON.parse(window.localStorage.getItem(key)).last,
      applied: store.applySet('Morning block'),
      unknown: store.applySet('never saved'),
      lastAfterUnknown: JSON.parse(window.localStorage.getItem(key)).last,
    };
  }, SCRATCH);
  expect(out.names).toEqual(['Morning block']);
  expect(out.last).toBe('Morning block');
  expect(out.applied).toMatchObject({ reps: 7, bankSize: 6, sound: false, patterns: ['ABC'] });
  expect(out.unknown, 'an unknown set name is refused').toBeNull();
  expect(out.lastAfterUnknown, 'and does not move `last`').toBe('Morning block');
});

test('initial() prefers the working config, then the last set, then defaults', async ({ page }) => {
  await openModule(page);
  const out = await page.evaluate(() => {
    const store = window.__scratchStore();
    const bare = store.initial().reps;
    store.saveSet('Set A', { reps: 5 });
    const fromSet = store.initial().reps;
    store.saveWorking({ reps: 9 });
    const fromWorking = store.initial().reps;
    return { bare, fromSet, fromWorking };
  });
  expect(out).toEqual({ bare: 2, fromSet: 5, fromWorking: 9 });
});

test('a corrupted store document degrades to defaults instead of throwing', async ({ page }) => {
  await openModule(page);
  const out = await page.evaluate((key) => {
    const store = window.__scratchStore();
    window.localStorage.setItem(key, 'not json at all');
    const fromGarbage = store.initial().reps;
    window.localStorage.setItem(key, '["an","array"]');
    const fromArray = store.initial().reps;
    return { fromGarbage, fromArray };
  }, SCRATCH);
  expect(out).toEqual({ fromGarbage: 2, fromArray: 2 });
});

// ── 3. foldLegacy(): read-then-fold, never drop ────────────────────────────

test('foldLegacy folds a retired key forward and never deletes it', async ({ page }) => {
  await openModule(page);
  const out = await page.evaluate(([key, legacyKey]) => {
    const store = window.__scratchStore();
    window.localStorage.setItem(legacyKey, JSON.stringify({
      reps: 7, bankSize: 6, sound: false, extraneous: 'ignored',
    }));
    const folded = store.foldLegacy({
      map: (l) => ({ reps: l.reps, bankSize: l.bankSize, sound: l.sound }),
    });
    return {
      folded,
      stored: JSON.parse(window.localStorage.getItem(key)),
      legacyStillThere: window.localStorage.getItem(legacyKey),
    };
  }, [SCRATCH, SCRATCH_LEGACY]);
  expect(out.folded).toMatchObject({ reps: 7, bankSize: 6, sound: false });
  expect(out.stored.working, 'the fold lands as the working config').toMatchObject({ reps: 7 });
  expect(out.stored._legacyMigrated, 'and is recorded as done').toBe(true);
  // Never drop: the retired payload is still intact in storage, so a wrong
  // mapping is recoverable and a downgrade still finds its configuration.
  expect(JSON.parse(out.legacyStillThere)).toEqual({
    reps: 7, bankSize: 6, sound: false, extraneous: 'ignored',
  });
});

test('foldLegacy refuses once a working config exists', async ({ page }) => {
  await openModule(page);
  const out = await page.evaluate(([key, legacyKey]) => {
    const store = window.__scratchStore();
    store.saveWorking({ reps: 9 });
    window.localStorage.setItem(legacyKey, JSON.stringify({ reps: 3 }));
    const folded = store.foldLegacy();
    return { folded, working: JSON.parse(window.localStorage.getItem(key)).working.reps };
  }, [SCRATCH, SCRATCH_LEGACY]);
  expect(out.folded, 'nothing folded').toBeNull();
  expect(out.working, 'the newer config is untouched').toBe(9);
});

test('foldLegacy runs at most once', async ({ page }) => {
  await openModule(page);
  const out = await page.evaluate((legacyKey) => {
    const store = window.__scratchStore();
    window.localStorage.setItem(legacyKey, JSON.stringify({ reps: 3 }));
    const first = store.foldLegacy();
    // A technician resetting the panel clears the working config; the fold has
    // already happened and must not undo their reset on the next load.
    const doc = store.load();
    delete doc.working;
    store.save(doc);
    return { first: first && first.reps, second: store.foldLegacy() };
  }, SCRATCH_LEGACY);
  expect(out.first).toBe(3);
  expect(out.second, 'the second fold is refused by _legacyMigrated').toBeNull();
});

test('an absent legacy field takes the schema default rather than the base value', async ({ page }) => {
  await openModule(page);
  // The map names every field explicitly, so a legacy payload missing one
  // lands as `undefined` and the schema default wins. Asserted because the
  // opposite — the base value survives — is what a spread-the-whole-object
  // fold would do, leaving a stale value the panel never showed.
  const out = await page.evaluate((legacyKey) => {
    const store = window.__scratchStore();
    store.saveSet('Set A', { reps: 9, bankSize: 7 });
    window.localStorage.setItem(legacyKey, JSON.stringify({ reps: 3 }));
    return store.foldLegacy({ map: (l) => ({ reps: l.reps, bankSize: l.bankSize }) });
  }, SCRATCH_LEGACY);
  expect(out.reps, 'the legacy value folds forward').toBe(3);
  expect(out.bankSize, 'the absent one takes the default, not the saved set').toBe(4);
});

test('foldLegacy is a no-op when there is no retired payload', async ({ page }) => {
  await openModule(page);
  const out = await page.evaluate((key) => {
    const store = window.__scratchStore();
    return { folded: store.foldLegacy(), stored: window.localStorage.getItem(key) };
  }, SCRATCH);
  expect(out.folded).toBeNull();
  expect(out.stored, 'nothing was written at all').toBeNull();
});

// ── 4. holdToUnlock(): the learner cannot tap a programme open ─────────────

test('a quick tap toggles locked; a press-and-hold unlocks', async ({ page }) => {
  await openModule(page);
  const out = await page.evaluate(async () => {
    const gear = document.createElement('button');
    document.body.appendChild(gear);
    const calls = [];
    window.NooutcoSettings.holdToUnlock(gear, {
      holdMs: 30,
      onHold: () => calls.push('hold'),
      onTap: () => calls.push('tap'),
    });
    const fire = (type) => gear.dispatchEvent(new Event(type));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    fire('pointerdown');
    fire('pointerup');
    fire('click');                       // quick tap
    await wait(120);
    const afterTap = calls.slice();

    fire('pointerdown');
    await wait(120);                     // held past holdMs
    const holdingClass = gear.classList.contains('is-holding');
    fire('pointerup');
    fire('click');                       // the click that follows a hold
    return { afterTap, afterHold: calls.slice(), holdingClass };
  });
  expect(out.afterTap, 'a tap never unlocks').toEqual(['tap']);
  // The hold fires onHold, and the click it produces on release is swallowed —
  // otherwise every unlock would immediately toggle the panel shut again.
  expect(out.afterHold).toEqual(['tap', 'hold']);
  expect(out.holdingClass, 'the holding class is cleared when the hold fires').toBe(false);
});

test('releasing before the hold completes cancels it', async ({ page }) => {
  await openModule(page);
  const out = await page.evaluate(async () => {
    const gear = document.createElement('button');
    document.body.appendChild(gear);
    const calls = [];
    window.NooutcoSettings.holdToUnlock(gear, {
      holdMs: 60,
      onHold: () => calls.push('hold'),
      onTap: () => calls.push('tap'),
    });
    gear.dispatchEvent(new Event('pointerdown'));
    await new Promise((r) => setTimeout(r, 10));
    gear.dispatchEvent(new Event('pointerleave'));   // finger slid off the gear
    await new Promise((r) => setTimeout(r, 200));
    return { calls, holding: gear.classList.contains('is-holding') };
  });
  expect(out.calls, 'an abandoned hold does nothing at all').toEqual([]);
  expect(out.holding).toBe(false);
});

// ── 5. sequences runs on the extracted module ──────────────────────────────

test('sequences loads game-settings.js and its store is the shared one', async ({ page }) => {
  await page.goto('/sequences/');
  await expect(page.locator('script[src*="game-settings.js"]')).toHaveCount(1);
  expect(await page.evaluate(() => typeof window.NooutcoSettings.defineStore)).toBe('function');
});

test('sequences clamps an out-of-range stored round on load', async ({ page }) => {
  // The panel is what the technician reads, so the assertion is on the panel:
  // a corrupted working config must render clamped values, not the raw ones.
  await page.addInitScript(
    ([k, v]) => window.localStorage.setItem(k, v),
    [SEQ_KEY, JSON.stringify({
      working: { reps: 99, bankSize: 0, blanksToFill: 42, patterns: ['AB'], sound: true },
    })],
  );
  await page.goto('/sequences/');
  await page.locator('#btn-round-toggle').click();

  const val = (key) => page.locator(`.round-stepper[data-stepper="${key}"] .round-step-val`);
  await expect(val('reps'), 'reps clamped to its maximum').toHaveText('10');
  await expect(val('blanksToFill'), 'blanks clamped to its maximum').toHaveText('5');
  await expect(val('bankSize'), 'a zero bank size takes the default, not the floor').toHaveText('4');
});

/** A real press-and-hold on the gear: down, wait past the 600ms threshold, up. */
async function holdGear(page) {
  const box = await page.locator('#btn-round-toggle').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
}

test('sequences: the gear unlocks on hold and stays locked on a tap', async ({ page }) => {
  await page.goto('/sequences/');
  const gear = page.locator('#btn-round-toggle');
  const panel = page.locator('#round-panel');
  const bump = page.locator('.round-stepper[data-stepper="bankSize"] .round-step[data-dir="1"]');

  await gear.click();
  await expect(panel, 'a tap opens the panel').not.toHaveAttribute('hidden', /.*/);
  await expect(panel, 'but leaves it locked').toHaveAttribute('data-editing', 'false');

  // Locked is not cosmetic: a learner tapping a control cannot change a
  // running programme's parameters, so the click never reaches the stepper.
  await expect(
    bump.click({ timeout: 1500 }),
    'a locked control refuses the click',
  ).rejects.toThrow();

  await gear.click();
  await expect(panel, 'and a second tap closes it').toHaveAttribute('hidden', /.*/);

  // The click the browser fires when the hold is released must not close it.
  await holdGear(page);
  await expect(panel, 'the hold opened it').not.toHaveAttribute('hidden', /.*/);
  await expect(panel, 'and unlocked it').toHaveAttribute('data-editing', 'true');
  await bump.click();
  await expect(
    page.locator('.round-stepper[data-stepper="bankSize"] .round-step-val'),
    'an unlocked control takes the edit',
  ).toHaveText('5');
});

test('sequences still starts a round on the extracted store', async ({ page }) => {
  // The extraction rewired the config the trial loop reads, so the assertion
  // that matters is that a round still runs — with no page error along the way.
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/sequences/');
  await holdGear(page);
  await page.locator('#btn-round-start').click();

  await expect(page.locator('#game-area'), 'the board came up').not.toHaveAttribute('hidden', /.*/);
  await expect(page.locator('#round-panel'), 'and the panel re-locked on start')
    .toHaveAttribute('data-editing', 'false');
  const store = JSON.parse(await page.evaluate((k) => window.localStorage.getItem(k), SEQ_KEY));
  expect(store.working, 'the started round persisted as the working config').toBeTruthy();
  expect(errors, 'no page errors').toEqual([]);
});

test('sequences persists a live edit as the working config', async ({ page }) => {
  await page.goto('/sequences/');
  await holdGear(page);
  await page.locator('.round-stepper[data-stepper="bankSize"] .round-step[data-dir="1"]').click();

  await expect
    .poll(() => page.evaluate((key) => {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw).working || {}).bankSize : null;
    }, SEQ_KEY), { message: 'the edit reached the {sets,last,working} store' })
    .toBe(5);
});
