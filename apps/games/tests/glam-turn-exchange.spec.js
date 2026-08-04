import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover - turn-exchange: a finished tool has to STAY finished.
 *
 * Reported from play: "when I cleansed moisturized and applied 3 acne stickers,
 * then removed 2 (turn over), then P2 saw 1 sticker left. However, they were
 * able to click the treat spots button making the checkmark disappear and
 * reappear."
 *
 * The cause is one predicate answering the wrong question. `Treat spots` is
 * declared `{mech:'patch', step:3}`, and `_optWorkDone` short-circuits on
 * `opt.step`, so the cart asked "is step 3 done?" - `pimples.every(v=>v===2)`,
 * i.e. every spot CONCEALED. But `patchOne(i)` early-returns unless
 * `pimples[i]===0`, so the tool is a guaranteed no-op from the moment every spot
 * is `>=1`, several actions earlier. In that window it stayed on the cart and
 * armable, and because the trolley label is
 * `(locked?'🔒 ':(active&&!armed?'✓ ':''))+opt.label`, arming it stripped its own
 * ✓ and disarming put it back. That is the flicker, exactly as described.
 *
 * The two correct predicates already existed - as the `mech==='patch'` and
 * `mech==='conceal'` branches BELOW the `opt.step` short-circuit in
 * `_optWorkDone`, which neither option row can reach. They now live in
 * `_optDead`, which asks the narrower question the cart never asked: can THIS
 * tool's own mechanism still change the client?
 *
 * ── the maintainer's two rulings on the treatment ────────────────────────────
 * The first build of this fix left a dead tool DISABLED IN PLACE. That was
 * overruled: "changed to make the tool disappear from the cart entirely". So a
 * dead tool now leaves through `_optSpent`, the door the cart already had, and
 * in every routine - "this step is over" is the staged routine's judgement, but
 * "this tool cannot act" is a fact about the client.
 *
 * Which takes its ✓ with it, and the second ruling is "kept - a finished step
 * should still read as finished". The two are reconciled by moving the ✓ up one
 * level: a settled shelf keeps its header, and its sage ✓, AFTER its last tool
 * has left. So the child sees, in order:
 *
 *   every spot patched   Treat spots is gone · Conceal is still standing on the
 *                        Skincare shelf · no ✓ on the shelf, because the step
 *                        genuinely is not over
 *   every spot clear     both gone · Skincare folds to a ✓ record row that
 *                        cannot be opened, because there is nothing behind it
 *
 * These tests fail against 95ba6101 (the flicker) and against 438d38d8 (which
 * disabled the tool in place instead of removing it).
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
    reported sequence - wash, moisturize, three patches, two conceals - run on
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
  await page.getByRole('button', { name: /Go - / }).click();
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

/** Tap `n` spot rings for real, one at a time - the ring set re-renders after
    every tap, so each is re-queried rather than held. */
async function tapSpots(page, tool, n) {
  await page.getByTitle(tool, { exact: true }).first().click();
  for (let i = 0; i < n; i++) {
    await expect(spots(page).first()).toBeVisible();
    await spots(page).first().click();
  }
}

/** Walk the exchange back to the learner's own turn by pressing whatever the
    screen is actually offering. In the default give-back mode that is TWO
    presses - the learner mands for the brush ("✓ I asked!"), which lands on the
    ready gate, and then takes it ("▸ Go - my turn!"). Only `mine` and `theirs`
    put a target under the pointer, so the intermediate gate has to be walked
    through rather than assumed away. */
async function toMyTurn(page) {
  for (let i = 0; i < 5; i++) {
    if (await logic(page, 'return L.state.phase') === 'mine') return;
    await page.getByRole('button', { name: /I asked|Go - my turn|My turn again|Done - their turn/ })
      .first().click();
  }
  expect(await logic(page, 'return L.state.phase'), 'the exchange came back round').toBe('mine');
}

/** A tool is on the cart when the trolley renders a button for it. `title` is
    the RAW tool name and never carries the ✓ prefix, so it stays a stable
    handle across every state the button can be in. */
const tool = (page, name) => page.getByTitle(name, { exact: true });

/** What one shelf of the trolley says: the header text (which carries the ✓),
    whether that header can still be opened, and the tools left on it. */
function shelf(page, label) {
  return page.locator(`[data-shelf="${label}"]`).evaluate((el) => {
    const head = el.querySelector('button');
    return {
      head: head.innerText.replace(/\s+/g, ' ').trim(),
      headDisabled: head.disabled === true,
      expanded: head.getAttribute('aria-expanded'),
      tools: [...el.querySelectorAll('button[title]')].map((b) => b.getAttribute('title')),
    };
  });
}

test.describe('Glam Team Makeover - a finished tool leaves the cart, and the step still reads as finished', () => {
  test('the reported sequence: patched spots take Treat spots off the cart, and a handoff does not bring it back', async ({ page }) => {
    const errors = await stage(page);

    // ── the reported sequence, by real pointer input ──────────────────────────
    await paintTool(page, 'Wash');
    await paintTool(page, 'Moisturize');
    await expect(tool(page, 'Treat spots'), 'the tool is on the cart while spots are bare').toHaveCount(1);
    await tapSpots(page, 'Treat spots', 3);
    expect(await logic(page, 'return L.state.ed.pimples')).toEqual([1, 1, 1]);

    // Every spot now carries a patch, so `patchOne` can do nothing for any of
    // them. The tool has to go BEFORE the conceal step is finished - this is the
    // window the step-only predicate could not see.
    await expect(tool(page, 'Treat spots'), 'gone the moment the last spot is patched').toHaveCount(0);
    await expect(spots(page), 'and it took its targets off the face with it').toHaveCount(0);

    // Ruling 3, at the stage where the step is NOT over: Conceal is still
    // standing, and the shelf does not claim a ✓ it has not earned.
    const midway = await shelf(page, 'Skincare');
    expect(midway.tools, 'Conceal is the live tool on this shelf').toEqual(['Conceal']);
    expect(midway.head, 'and the shelf does not read as finished yet').not.toContain('✓');

    // Conceal 2 of 3, then hand over. This is the state the partner inherits.
    await tapSpots(page, 'Conceal', 2);
    expect(await logic(page, 'return L.state.ed.pimples')).toEqual([2, 2, 1]);
    await page.getByRole('button', { name: /Done - their turn/ }).click();

    // ── the partner's turn: one sticker left, and the dead tool stays gone ────
    await expect(tool(page, 'Treat spots'), 'the handoff does not bring it back').toHaveCount(0);
    expect((await shelf(page, 'Skincare')).tools, 'Conceal is what the partner inherits').toEqual(['Conceal']);
    expect(await logic(page, 'return L.state.armed'), 'and nothing is armed by the exchange').toBe(null);

    // ── and back again: an already-dead tool cannot un-die on my turn ─────────
    await toMyTurn(page);
    await expect(tool(page, 'Conceal')).toHaveCount(1);
    await expect(tool(page, 'Treat spots'), 'still gone back on my turn').toHaveCount(0);

    // ── the last spot: both tools leave, and the shelf keeps the ✓ ────────────
    await tapSpots(page, 'Conceal', 1);
    expect(await logic(page, 'return L.state.ed.pimples')).toEqual([2, 2, 2]);
    await expect(tool(page, 'Conceal'), 'Conceal can do nothing more, so it goes too').toHaveCount(0);

    const done = await shelf(page, 'Skincare');
    expect(done.tools, 'nothing is left on the shelf').toEqual([]);
    expect(done.head, 'but the header stays, carrying the ✓ - the step reads as finished').toContain('✓');
    expect(done.head, 'and it still says which step it was - "🧼 SKINCARE ✓"').toMatch(/skincare/i);
    expect(done.headDisabled, 'it is a record, not a drawer - there is nothing behind it to open').toBe(true);
    expect(done.expanded, 'so it does not pose as a disclosure control either').toBe(null);
    expect(done.head, 'and offers no chevron').not.toMatch(/[▾▸]/);

    expect(errors).toEqual([]);
  });

  test('free play removes a dead tool too - a fact about the client, not a routine\'s judgement', async ({ page }) => {
    /* This is the case the disabled-in-place build was built around: `_optSpent`
       is gated on `staged!=='free'`, so a removal that inherited that gate would
       leave free play exactly as broken. The dead branch deliberately does NOT
       inherit it. Free play still never removes a merely FINISHED tool - Wash
       stays on the shelf here, which is what separates the two. */
    const errors = await stage(page, { routine: 'free' });

    await logic(page, `return new Promise((r) => L.setState((s) => {
      const ed = JSON.parse(JSON.stringify(s.ed));
      ed.pimples = [1, 1, 1]; ed.cov.wash = 1; ed.done.wash = true;
      return { ed };
    }, r));`);
    await expect(tool(page, 'Treat spots'), 'patch is dead at all-patched, in free play too').toHaveCount(0);
    await expect(tool(page, 'Conceal'), 'conceal still has work').toHaveCount(1);
    await expect(tool(page, 'Wash'), 'a finished-but-live tool is untouched by this').toHaveCount(1);

    await tapSpots(page, 'Conceal', 3);
    expect(await logic(page, 'return L.state.ed.pimples')).toEqual([2, 2, 2]);
    await expect(tool(page, 'Conceal'), 'every spot clear - Conceal leaves as well').toHaveCount(0);

    // Free play shelves never SETTLE (that is the staged routine's read), so the
    // Skincare shelf keeps its live tools and its open header rather than
    // folding to a ✓. Nothing here claims a step is over.
    const sk = await shelf(page, 'Skincare');
    expect(sk.tools, 'wash and moisturize are still reachable, as free play promises')
      .toEqual(['Wash', 'Moisturize']);
    expect(sk.head, 'and free play claims no completion').not.toContain('✓');

    expect(errors).toEqual([]);
  });

  test('the 67 tools that are FREE but not dead are all still on the cart and still armable', async ({ page }) => {
    /* The one way to get this ruling badly wrong. The turn-exchange sweep made a
       re-touch that provably writes nothing cost no action (`_optNoOp`) for 67 of
       the 69 person tools. Those tools are not dead: they re-apply, they echo on
       the mirror, they keep their target overlay. Only patch and conceal have a
       mechanism that can refuse outright, and only they leave the cart. */
    const errors = await stage(page, { routine: 'free' });

    const sweep = await logic(page, `
      const opts = L.cfg().cats.flatMap(g => g.options);
      return new Promise((r) => L.setState((s) => {
        const ed = JSON.parse(JSON.stringify(s.ed));
        ed.pimples = [2, 2, 2];                       // both spot tools dead
        return { ed };
      }, () => {
        const onCart = new Set((L.renderVals().palette || [])
          .flatMap(g => g.options.map(o => o.title)));
        r({
          total: opts.length,
          offCart: opts.filter(o => !onCart.has(o.label)).map(o => o.id),
          armable: opts.filter(o => onCart.has(o.label) && !L._optDead(o)).length,
        });
      }));`);

    expect(sweep.total, 'the person catalogue').toBe(69);
    expect(sweep.offCart, 'exactly two tools can go dead, and exactly two leave').toEqual(['patch', 'conceal']);
    expect(sweep.armable, 'the other 67 are all still there and all still armable').toBe(67);

    expect(errors).toEqual([]);
  });

  test('arming a dead tool at the cap cannot cost the child their independent score', async ({ page }) => {
    /* The worse half of this defect, and the reason `arm()` keeps its own
       `_optDead` guard now that the button is gone. `arm()` runs
       `_atCapFor(_optKey(opt))` before it arms, and `_optKey` maps patch/conceal
       to the synthetic `'__perTap__'` - a key `_admit` never writes, since it
       charges `item:patch<i>` per spot. So `this._charged['__perTap__']` is
       permanently falsy and `_atCapFor` reduces to `trial.atCap()`. At the cap
       that routed a dead tool into `_refuse` → `requestAction`, which on the
       learner's own turn does NOT silently bounce: it increments `overCap` and
       sets the TURN-DURABLE `forfeit='overcap'` flag. A tool that can do nothing
       was able to take the turn's independence away.

       Removal closes the pointer path to it, but not the programmatic one - a
       keyboard route, a restored session, or any future caller can still reach
       `arm` with a dead option in hand, so the guard is asserted directly. */
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

    // There is no button left to press - that is the ruling - so the reach is
    // made the only way it still can be.
    await expect(tool(page, 'Treat spots')).toHaveCount(0);
    await logic(page, `return L.arm(L.cfg().cats.flatMap(g=>g.options).find(o=>o.id==='patch'));`);

    expect(await logic(page, 'return T.turn.overCap'), 'no over-cap violation logged').toBe(0);
    expect(await logic(page, 'return T.turn.forfeit'), 'and the turn is still independent').not.toBe('overcap');
    expect(await logic(page, 'return L.state.armed')).toBe(null);

    expect(errors).toEqual([]);
  });
});
