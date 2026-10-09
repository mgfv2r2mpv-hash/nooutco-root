import { test, expect } from '@playwright/test';

/**
 * The Round-setup contract every ported game proves (PHASE8-HANDOFF-3 §3b).
 *
 * The panel (../../round-setup.js) is a gated view over controls the game
 * already has, so the suite pins five things:
 *
 *   1. gating: a tap opens it locked and every editing control is disabled;
 *      a press and hold unlocks it; Start round stays live either way
 *   2. defaults: a panel opened and closed untouched writes nothing to storage
 *      and moves no control, and Start round from it runs exactly the
 *      programme the game's own Start runs
 *   3. an edit in the panel lands in the game's own control, state and store
 *   4. the prompting radios set the two primitives and leave the seconds alone
 *   5. saved sets round-trip, and Reset returns the mirrored fields to the
 *      store's declared defaults
 *
 * Each game's spec calls `roundSetupSuite()` with what differs per game:
 *
 *   game, url, storeKey
 *   ready(page)      resolves once the game has booted and filled its controls
 *   stateFields      fields of `state` (or of `state[statePath]`) that Start and
 *                    Start round must agree on
 *   statePath        optional path under `state` where the config lives
 *   edit             { label, control, field, kind: 'stepper' | 'select', to? }
 *                    one control to edit through the panel
 *   resetFields      store fields the panel mirrors, compared to defaults()
 *   startButton      the game's own Start (default #btn-start)
 *   startedSelector  visible once a round is running (default #game-area)
 *   sets             false when the game keeps no named round sets
 *   promptFields     { auto, delay, secs } store names of the prompt primitives
 */

export const HOLD_MS = 700;

const DEFAULT_PROMPT_FIELDS = { auto: 'autoPromptEnabled', delay: 'promptDelay', secs: 'promptDelaySecs' };

export async function holdGear(page) {
  const box = await page.locator('#btn-round-toggle').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
  await expect(page.locator('#round-panel')).toHaveAttribute('data-editing', 'true');
}

export async function tapGear(page) {
  await page.locator('#btn-round-toggle').click();
  await expect(page.locator('#round-panel')).toBeVisible();
}

export function snapshotStorage(page) {
  return page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
    return out;
  });
}

export function snapshotControls(page) {
  return page.evaluate(() => {
    const out = {};
    document.querySelectorAll('#settings-bar input, #settings-bar select, #extra-panel input, #extra-panel select')
      .forEach(n => { if (n.id) out[n.id] = n.type === 'checkbox' ? n.checked : n.value; });
    return out;
  });
}

function readState(page, fields, path) {
  return page.evaluate(([names, keys]) => {
    // `state` is a top-level lexical global in every standard game.
    // eslint-disable-next-line no-undef
    let s = state;
    for (const k of keys) s = s[k];
    return Object.fromEntries(names.map(n => [n, s[n]]));
  }, [fields, path || []]);
}

function readWorking(page, storeKey) {
  return page.evaluate(k => (JSON.parse(localStorage.getItem(k) || '{}').working) || null, storeKey);
}

function panelRow(page, label) {
  const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
  return page.locator('#round-panel .round-field-row', {
    has: page.locator('.round-field-label', { hasText: exact }),
  });
}

/** Move the edit control one notch through the panel; returns the new value. */
async function editOnce(page, edit, backTo) {
  const row = panelRow(page, edit.label);
  if (edit.kind === 'select') {
    const sel = row.locator('select');
    const current = await sel.inputValue();
    const options = await sel.locator('option').evaluateAll(os => os.map(o => o.value));
    const next = backTo != null ? backTo : (edit.to != null ? edit.to : options.find(v => v !== current));
    await sel.selectOption(next);
    return next;
  }
  const up = row.locator('.round-step[data-dir="1"]');
  const down = row.locator('.round-step[data-dir="-1"]');
  const before = await page.locator(edit.control).inputValue();
  let btn = (await up.getAttribute('data-at-limit')) === 'true' ? down : up;
  if (backTo != null) btn = Number(backTo) > Number(before) ? up : down;
  await btn.click();
  return page.locator(edit.control).inputValue();
}

export function roundSetupSuite(cfg) {
  const startedSelector = cfg.startedSelector || '#game-area';
  const startButton = cfg.startButton || '#btn-start';
  const pf = { ...DEFAULT_PROMPT_FIELDS, ...(cfg.promptFields || {}) };
  const edit = cfg.edit;
  const field = edit.field;

  async function boot(page) {
    await page.goto(cfg.url);
    await cfg.ready(page);
    await expect(page.locator('#btn-round-toggle')).toBeVisible();
  }

  test.describe(`${cfg.game}: Round setup`, () => {
    test('a tap opens the panel locked; a press and hold unlocks it', async ({ page }) => {
      await boot(page);
      await tapGear(page);
      const panel = page.locator('#round-panel');
      const editControl = panelRow(page, edit.label).locator('button, select').first();
      await expect(panel).toHaveAttribute('data-editing', 'false');
      await expect(page.locator('#round-gate-pill')).toHaveText(/Locked/);
      await expect(editControl).toBeDisabled();
      await expect(page.locator('#round-panel .round-radio').first()).toBeDisabled();
      await expect(page.locator('#btn-round-reset')).toBeDisabled();
      if (cfg.sets !== false) {
        await expect(page.locator('#sel-round-set')).toBeDisabled();
        await expect(page.locator('#btn-round-save')).toBeDisabled();
      }
      await expect(page.locator('#btn-round-start')).toBeEnabled();

      await page.locator('#btn-round-close').click();
      await expect(panel).toBeHidden();
      await holdGear(page);
      await expect(page.locator('#round-gate-pill')).toHaveText(/Editing/);
      await expect(panelRow(page, edit.label).locator('button, select').last()).toBeEnabled();

      // Closing re-locks: the next tap shows it locked again.
      await page.locator('#btn-round-close').click();
      await tapGear(page);
      await expect(panel).toHaveAttribute('data-editing', 'false');
    });

    test('a panel opened and closed untouched writes nothing and moves no control', async ({ page }) => {
      await boot(page);
      const storageBefore = await snapshotStorage(page);
      const controlsBefore = await snapshotControls(page);
      const stateBefore = await readState(page, cfg.stateFields, cfg.statePath);

      await tapGear(page);
      await page.locator('#btn-round-close').click();
      await holdGear(page);
      await page.locator('#btn-round-close').click();

      expect(await snapshotStorage(page)).toEqual(storageBefore);
      expect(await snapshotControls(page)).toEqual(controlsBefore);
      expect(await readState(page, cfg.stateFields, cfg.statePath)).toEqual(stateBefore);
    });

    test('Start round from an untouched panel runs the same programme as Start', async ({ browser }) => {
      const legacy = await browser.newPage();
      await boot(legacy);
      await legacy.locator(startButton).click();
      await expect(legacy.locator(startedSelector)).toBeVisible();
      const viaStart = await readState(legacy, cfg.stateFields, cfg.statePath);
      await legacy.close();

      const round = await browser.newPage();
      await boot(round);
      await tapGear(round);
      await round.locator('#btn-round-start').click();
      await expect(round.locator(startedSelector)).toBeVisible();
      await expect(round.locator('#round-panel')).toBeHidden();
      const viaRound = await readState(round, cfg.stateFields, cfg.statePath);
      await round.close();

      expect(viaRound).toEqual(viaStart);
    });

    test('a panel edit lands in the game control, state and store', async ({ page }) => {
      await boot(page);
      const before = await page.locator(edit.control).inputValue();
      await holdGear(page);
      const after = await editOnce(page, edit);
      expect(after).not.toBe(before);
      await expect(page.locator(edit.control)).toHaveValue(after);
      const st = (await readState(page, [field], cfg.statePath))[field];
      expect(String(st)).toBe(after);
      expect(String((await readWorking(page, cfg.storeKey))[field])).toBe(after);
    });

    test('the prompting radios set the primitives and leave the seconds alone', async ({ page }) => {
      await boot(page);
      await holdGear(page);
      const secsBefore = await page.locator('#sel-prompt-delay').inputValue();

      await page.locator('#round-panel .round-radio[data-method="time-delay"]').click();
      await expect(page.locator('#chk-auto-prompt')).toBeChecked();
      await expect(page.locator('#chk-prompt-delay')).toBeChecked();
      await expect(page.locator('#round-panel .round-radio[data-method="time-delay"]')).toHaveAttribute('aria-checked', 'true');
      let w = await readWorking(page, cfg.storeKey);
      expect(w[pf.auto]).toBe(true);
      expect(w[pf.delay]).toBe(true);
      expect(String(w[pf.secs])).toBe(secsBefore);

      await page.locator('#round-panel .round-radio[data-method="least-to-most"]').click();
      await expect(page.locator('#chk-auto-prompt')).not.toBeChecked();
      w = await readWorking(page, cfg.storeKey);
      expect(w[pf.auto]).toBe(false);
      expect(String(w[pf.secs])).toBe(secsBefore);
    });

    if (cfg.sets !== false) {
      test('a saved set round-trips through the set picker', async ({ page }) => {
        page.on('dialog', d => d.accept('Round A'));
        await boot(page);
        const original = await page.locator(edit.control).inputValue();
        await holdGear(page);
        const saved = await editOnce(page, edit);
        await page.locator('#btn-round-save').click();
        await expect(page.locator('#sel-round-set')).toHaveValue('Round A');

        await editOnce(page, edit, original);
        await expect(page.locator(edit.control)).toHaveValue(original);
        await page.locator('#sel-round-set').selectOption('Round A');
        await expect(page.locator(edit.control)).toHaveValue(saved);
        expect(String((await readState(page, [field], cfg.statePath))[field])).toBe(saved);
      });
    }

    test('Reset returns every mirrored field to the declared default', async ({ page }) => {
      await boot(page);
      await holdGear(page);
      await editOnce(page, edit);
      await page.locator('#round-panel .round-radio[data-method="time-delay"]').click();
      await page.locator('#btn-round-reset').click();
      const defaults = await page.evaluate(() => settingsStore.defaults()); // eslint-disable-line no-undef
      const working = await readWorking(page, cfg.storeKey);
      for (const f of cfg.resetFields) expect([f, working[f]]).toEqual([f, defaults[f]]);
    });
  });
}
