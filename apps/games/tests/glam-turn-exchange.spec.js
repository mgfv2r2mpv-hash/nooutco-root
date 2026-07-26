import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover — turn-exchange: a finished tool has to STAY finished.
 *
 * Reported from play: "when I cleansed moisturized and applied 3 acne stickers,
 * then removed 2 (turn over), then P2 saw 1 sticker left. However, they were
 * able to click the treat spots button making the checkmark disappear and
 * reappear."
 *
 * The cause is one predicate answering the wrong question. `Treat spots` is
 * declared `{mech:'patch', step:3}`, and `_optWorkDone` short-circuits on
 * `opt.step`, so the cart asked "is step 3 done?" — `pimples.every(v=>v===2)`,
 * i.e. every spot CONCEALED. But `patchOne(i)` early-returns unless
 * `pimples[i]===0`, so the tool is a guaranteed no-op from the moment every spot
 * is `>=1`, several actions earlier. In that window it stayed on the cart and
 * armable, and because the trolley label is
 * `(locked?'🔒 ':(active&&!armed?'✓ ':''))+opt.label`, arming it stripped its own
 * ✓ and disarming put it back. That is the flicker, exactly as described.
 *
 * The two correct predicates already existed — as the `mech==='patch'` and
 * `mech==='conceal'` branches BELOW the `opt.step` short-circuit in
 * `_optWorkDone`, which neither option row can reach. They now live in
 * `_optDead`, which asks the narrower question the cart never asked: can THIS
 * tool's own mechanism still change the client?
 *
 * Dead is not the same as spent. `_optSpent` ("this tool's whole step is over")
 * takes a tool off the cart; a dead `Treat spots` stays, because step 3 is not
 * over — Conceal has still to run — and a patch button that vanished would claim
 * otherwise. So a dead tool is DISABLED IN PLACE: real `disabled` attribute
 * (React drops the handler, the browser drops it from the tab order),
 * `aria-disabled`, its ✓ kept, and `arm()` guarding the programmatic path.
 *
 * These tests fail against 95ba6101.
 *
 * The GlamTT engine and tests/glam-tt-scoring.spec.js are untouched by this work.
 */

/** Evaluate `src` with `L` bound to the component instance and `T` to its Trial. */
function logic(page, src) {
  return page.evaluate(({ src }) => {
    let f = null;
    for (const el of document.querySelectorAll('*')) {
      const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      if (k) { f = el[k]; break; }
    }
    while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
    const L = f.stateNode.logic;
    return new Function('L', 'T', src)(L, L._trial);
  }, { src });
}

/** Boot to the play surface. `turns:4` gives the learner a 10-action budget
    (REQUIRED_ACTIONS 19 over 2 learner turns), which is what lets the whole
    reported sequence — wash, moisturize, three patches, two conceals — run on
    ONE turn by real pointer input, the way it was reported. */
async function stage(page, { routine = 'on', turns = '4' } = {}) {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/glam-team-makeover/');
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Routine', { exact: true }).selectOption(routine);
  await page.getByLabel('Turns', { exact: true }).selectOption(turns);
  await page.getByRole('button', { name: /^▶ Play/ }).click();
  await page.waitForFunction(() => {
    let f = null;
    for (const el of document.querySelectorAll('*')) {
      const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      if (k) { f = el[k]; break; }
    }
    while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
    const L = f && f.stateNode.logic;
    if (!L || !L._skinPool(L.state.model)) return false;
    const c = L._imgc || {};
    const keys = Object.keys(c);
    return keys.length > 0 && keys.every((k) => c[k].ok);
  }, undefined, { timeout: 30000 });
  await page.getByRole('button', { name: /Go —/ }).click();
  return errors;
}

/** Arm a paint tool and drag its target zone to full coverage. */
async function paintTool(page, name) {
  await page.getByTitle(name, { exact: true }).first().click();
  const zone = page.locator('div[style*="gtm-target"]').first();
  await expect(zone).toBeVisible();
  const box = await zone.boundingBox();
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(box.x + 10 + (i * (box.width - 20)) / 14, box.y + box.height / 2);
  }
  await page.mouse.up();
}

/** The blinking spot rings the patch/conceal tools put on the face. */
const spots = (page) => page.locator('div[style*="gtm-pim"]');

/** Tap `n` spot rings for real, one at a time — the ring set re-renders after
    every tap, so each is re-queried rather than held. */
async function tapSpots(page, tool, n) {
  await page.getByTitle(tool, { exact: true }).first().click();
  for (let i = 0; i < n; i++) {
    await expect(spots(page).first()).toBeVisible();
    await spots(page).first().click();
  }
}

/** Everything the trolley currently says about one tool. `title` is the RAW tool
    name and never carries the ✓ prefix, so it stays a stable handle. */
function toolState(page, name) {
  return page.getByTitle(name, { exact: true }).first().evaluate((el) => ({
    label: el.innerText.trim(),
    disabled: el.disabled === true,
    ariaDisabled: el.getAttribute('aria-disabled'),
  }));
}

/** Can a keyboard land on this tool? Asked by actually trying to focus it, not by
    reading `tabIndex` — a disabled <button> still reports `tabIndex === 0` while
    being wholly unfocusable, so the property is a proxy that lies. */
function canFocus(page, name) {
  return page.getByTitle(name, { exact: true }).first()
    .evaluate((el) => { el.focus(); return document.activeElement === el; });
}

test.describe('Glam Team Makeover — a finished tool stays finished across the exchange', () => {
  test('the reported sequence: patched spots kill Treat spots, and a handoff does not revive it', async ({ page }) => {
    const errors = await stage(page);

    // ── the reported sequence, by real pointer input ──────────────────────────
    await paintTool(page, 'Wash');
    await paintTool(page, 'Moisturize');
    await tapSpots(page, 'Treat spots', 3);
    expect(await logic(page, 'return L.state.ed.pimples')).toEqual([1, 1, 1]);

    // Every spot now carries a patch, so `patchOne` can do nothing for any of
    // them. The tool has to say so BEFORE the conceal step is finished — this is
    // the window the step-only predicate could not see.
    const armed = await toolState(page, 'Treat spots');
    expect(armed.disabled, 'Treat spots is disabled the moment the last spot is patched').toBe(true);
    expect(armed.ariaDisabled).toBe('true');
    expect(await canFocus(page, 'Treat spots'), 'not focusable into a dead action').toBe(false);
    expect(armed.label, 'it keeps its ✓ — this step was done, not blocked').toContain('✓');

    // Conceal 2 of 3, then hand over. This is the state the partner inherits.
    await tapSpots(page, 'Conceal', 2);
    expect(await logic(page, 'return L.state.ed.pimples')).toEqual([2, 2, 1]);
    await page.getByRole('button', { name: /Done — their turn/ }).click();

    // ── the partner's turn: one sticker left, and the dead tool stays dead ────
    const theirs = await toolState(page, 'Treat spots');
    expect(theirs.disabled, 'the handoff does not reset it').toBe(true);
    expect(theirs.ariaDisabled).toBe('true');

    // The flicker: a click must not arm it, and its ✓ must not move.
    const before = await toolState(page, 'Treat spots');
    await page.getByTitle('Treat spots', { exact: true }).first().click({ force: true });
    expect(await logic(page, 'return L.state.armed'), 'a dead tool cannot be armed').toBe(null);
    await expect(spots(page), 'and puts no targets on the face').toHaveCount(0);
    expect(await toolState(page, 'Treat spots'), 'the checkmark does not move').toEqual(before);

    // Conceal is the live tool on this shelf and is untouched by any of it.
    expect((await toolState(page, 'Conceal')).disabled).toBe(false);

    // ── and back again: an already-dead tool cannot un-die on my turn ─────────
    await page.getByRole('button', { name: /Done — their turn|Go —|I asked/ }).first().click();
    await expect(page.getByTitle('Treat spots', { exact: true }).first()).toBeVisible();
    expect((await toolState(page, 'Treat spots')).disabled, 'still dead back on my turn').toBe(true);

    expect(errors).toEqual([]);
  });

  test('Conceal goes the same way once every spot is clear — including in free play, where nothing leaves the cart', async ({ page }) => {
    // Free play is the mode that proves the fix is the DISABLED state and not
    // `_optSpent`: `_optSpent` is gated on `staged!=='free'`, so in free play the
    // cart never removes a finished tool and a removal-only fix would leave this
    // mode exactly as broken.
    const errors = await stage(page, { routine: 'free' });

    await logic(page, `return new Promise((r) => L.setState((s) => {
      const ed = JSON.parse(JSON.stringify(s.ed));
      ed.pimples = [1, 1, 1];
      return { ed };
    }, r));`);
    expect((await toolState(page, 'Treat spots')).disabled, 'patch is dead at all-patched').toBe(true);
    expect((await toolState(page, 'Conceal')).disabled, 'conceal still has work').toBe(false);

    await tapSpots(page, 'Conceal', 3);
    expect(await logic(page, 'return L.state.ed.pimples')).toEqual([2, 2, 2]);

    const done = await toolState(page, 'Conceal');
    expect(done.disabled, 'every spot clear — Conceal can do nothing more').toBe(true);
    expect(done.ariaDisabled).toBe('true');
    expect(await canFocus(page, 'Conceal'), 'not focusable into a dead action').toBe(false);
    expect(await canFocus(page, 'Treat spots')).toBe(false);

    const before = await toolState(page, 'Conceal');
    await page.getByTitle('Conceal', { exact: true }).first().click({ force: true });
    expect(await logic(page, 'return L.state.armed')).toBe(null);
    expect(await toolState(page, 'Conceal'), 'no checkmark flicker here either').toEqual(before);

    expect(errors).toEqual([]);
  });

  test('arming a dead tool at the cap cannot cost the child their independent score', async ({ page }) => {
    /* The worse half of this defect. `arm()` runs `_atCapFor(_optKey(opt))`
       before it arms, and `_optKey` maps patch/conceal to the synthetic
       `'__perTap__'` — a key `_admit` never writes, since it charges
       `item:patch<i>` per spot. So `this._charged['__perTap__']` is permanently
       falsy and `_atCapFor` reduces to `trial.atCap()`. At the cap that routed a
       dead tool into `_refuse` → `requestAction`, which on the learner's own turn
       does NOT silently bounce: it increments `overCap` and sets the TURN-DURABLE
       `forfeit='overcap'` flag. A tool that can do nothing was able to take the
       turn's independence away.

       Note what is NOT true, stated because it was worth checking: `requestAction`
       only increments `t.actions` on the under-cap path, and a dead patch tool
       renders zero spot rings, so no CLICK can spend an action. The exposure is
       the over-cap forfeit, not the action count. */
    const errors = await stage(page);

    // Seed the state the tool goes dead in, then spend the turn's whole budget.
    await logic(page, `return new Promise((r) => L.setState((s) => {
      const ed = JSON.parse(JSON.stringify(s.ed));
      ed.pimples = [1, 1, 1]; ed.done.wash = true; ed.done.moist = true;
      return { ed };
    }, r));`);
    await logic(page, 'while(!T.atCap()) T.requestAction("fill"); return T.atCap();');
    expect(await logic(page, 'return T.atCap()')).toBe(true);
    expect(await logic(page, 'return T.turn.overCap')).toBe(0);
    expect(await logic(page, 'return T.turn.forfeit')).not.toBe('overcap');

    // Reach for the dead tool at the cap — pointer first, then the programmatic
    // path a keyboard or a future caller could take.
    await page.getByTitle('Treat spots', { exact: true }).first().click({ force: true });
    await logic(page, `return L.arm(L.cfg().cats.flatMap(g=>g.options).find(o=>o.id==='patch'));`);

    expect(await logic(page, 'return T.turn.overCap'), 'no over-cap violation logged').toBe(0);
    expect(await logic(page, 'return T.turn.forfeit'), 'and the turn is still independent').not.toBe('overcap');
    expect(await logic(page, 'return L.state.armed')).toBe(null);

    expect(errors).toEqual([]);
  });
});
