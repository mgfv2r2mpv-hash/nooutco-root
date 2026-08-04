import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover - what a colour change costs, by the maintainer's ruling.
 *
 *   "Changing color within a turn does not deduct additional actions - only the
 *    first color change of a type per turn (shadow, blush, lips, hair, clothes
 *    can be changed SUBSEQUENT times within a turn without extra action cost."
 *
 * Two things are asserted, because they pull against each other. The ruling's
 * OTHER half - "redo the drag so the 'reapply' feel is there" - makes a shade
 * switch cost a full repaint, and the obvious way to implement that would have
 * re-opened the charge: a fresh drag ends in a completing stroke, and a
 * completing stroke is exactly what `paintStep` asks `_admit` about. It stays
 * free because `_admit` charges a KEY once per turn, and every shade of one
 * article resolves to the same key (`color:blush`, `color:hair`, …). This file
 * pins that, for all five types the maintainer named.
 *
 * Measured on 438d38d8 before the change and again after: three changes cost
 * one action for every one of the five, both times. So this half of the ruling
 * describes behaviour the build already had, and these tests exist to keep it
 * once the re-drag landed - they are a regression fence, not a fix. The
 * across-turn case at the bottom is the one that fails against 438d38d8's
 * predecessor and must not be traded away for the within-turn freebie: a
 * genuinely different shade after a handoff still costs its one action.
 *
 * The freebie is guarded against the trivial way to fake it. If the turn cap had
 * refused a change, `_admit` returns false, no state is written, and the action
 * count would not move either - which reads identically to "it was free". So
 * every change also asserts that the new colour actually LANDED.
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

/** Free play so every shade shelf is reachable without walking the 11-step TA
    first; `turns:2` gives the learner ONE turn with the whole 19-action budget,
    so five types × three changes cannot run the turn out and have the cap stand
    in for "it was free". */
async function stage(page, { routine = 'free', turns = '2' } = {}) {
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

const target = (page) => page.locator('div[style*="gtm-target"]').first();

/** Arm a tool and do the whole gesture it asks for: a full drag for a paint
    tool, a single tap for everything with a tap box, nothing more for a tool
    that applies straight off the trolley. */
async function useTool(page, name) {
  await page.getByTitle(name, { exact: true }).first().click();
  const zone = target(page);
  if (!(await zone.count()) || !(await zone.isVisible())) return;   // `choose` applies on the trolley
  const box = await zone.boundingBox();
  const isDrag = await zone.evaluate((el) => el.style.cursor === 'grab');
  if (!isDrag) { await zone.click(); return; }
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(box.x + 10 + (i * (box.width - 20)) / 14, box.y + box.height / 2);
  }
  await page.mouse.up();
}

/* The five types the maintainer named, each with three shades of the one
   article and the `ed` read that proves the shade actually landed. */
const TYPES = [
  { type: 'shadow', key: 'color:shadow', read: 'col.shadow',
    changes: [['Shadow violet', '#a06cc9'], ['Shadow ocean', '#3f7fa8'], ['Shadow moss', '#6f8a54']] },
  { type: 'blush', key: 'color:blush', read: 'col.blush',
    changes: [['Blush rose', '#f28ba0'], ['Blush berry', '#d4638f'], ['Blush plum', '#a75a86']] },
  { type: 'lips', key: 'color:lips', read: 'col.lips',
    changes: [['Lips red', '#d64b6a'], ['Lips berry', '#a83f6b'], ['Lips plum', '#7e3f63']] },
  { type: 'hair', key: 'color:hair', read: 'col.hair',
    changes: [['Blonde', 'blonde'], ['Copper', 'copper'], ['Berry', 'berry']] },
  { type: 'clothes', key: 'color:outfit', read: 'outfit',
    changes: [['Teal', 'gown'], ['Blue', 'casual'], ['Sunshine', 'dress']] },
];

test.describe('Glam Team Makeover - the 2nd..Nth colour change of a type is free within the turn', () => {
  test('all five types, three changes each, one action apiece - and every change lands', async ({ page }) => {
    const errors = await stage(page);
    expect(await logic(page, 'return T.turn.budget'), 'the turn has room for all of it')
      .toBeGreaterThanOrEqual(TYPES.length + 2);

    const spent = {};
    for (const { type, key, read, changes } of TYPES) {
      const before = await logic(page, 'return T.turn.actions');
      const perChange = [];
      for (const [tool, landed] of changes) {
        const at = await logic(page, 'return T.turn.actions');
        await useTool(page, tool);
        expect(await logic(page, `return L.state.ed.${read}`), `${type}: "${tool}" actually landed`).toBe(landed);
        perChange.push(await logic(page, 'return T.turn.actions') - at);
      }
      // All three resolve to ONE charge key, which is why two of them are free.
      const keys = await logic(page, `
        const byLabel = (n) => L.cfg().cats.flatMap(g=>g.options).find(o=>o.label===n);
        return ${JSON.stringify(changes.map((c) => c[0]))}.map(n => L._optKey(byLabel(n)));`);
      expect(keys, `${type}: every shade charges the same key`).toEqual([key, key, key]);
      expect(perChange, `${type}: the first change costs one action, the 2nd and 3rd cost none`)
        .toEqual([1, 0, 0]);
      spent[type] = await logic(page, 'return T.turn.actions') - before;
    }

    expect(spent, 'three changes of each of the five types cost exactly five actions in all')
      .toEqual({ shadow: 1, blush: 1, lips: 1, hair: 1, clothes: 1 });
    expect(errors).toEqual([]);
  });

  test('the freebie is per TURN - a different shade after a handoff still costs its action', async ({ page }) => {
    /* The half of the economy the turn-exchange sweep established, and the one
       the re-drag could most easily have broken: `_charged` is cleared at the
       turn boundary, so the partner's first change of the same article is a
       first change, not a subsequent one. A no-op re-touch of the shade already
       on stays free across that boundary - that is `_optNoOp`, not this. */
    const errors = await stage(page, { turns: '4' });

    await useTool(page, 'Blush rose');
    expect(await logic(page, 'return L.state.ed.col.blush')).toBe('#f28ba0');
    const mine = await logic(page, 'return T.turn.actions');
    expect(mine, 'the first blush of the turn cost one').toBe(1);

    await useTool(page, 'Blush berry');
    expect(await logic(page, 'return L.state.ed.col.blush')).toBe('#d4638f');
    expect(await logic(page, 'return T.turn.actions'), 'the second is free, inside this turn').toBe(mine);

    await page.getByRole('button', { name: /Done - their turn/ }).click();
    expect(await logic(page, 'return T.turn.actions'), 'a fresh turn starts from zero').toBe(0);

    // A genuinely different shade on the new turn is a first change again.
    await useTool(page, 'Blush plum');
    expect(await logic(page, 'return L.state.ed.col.blush')).toBe('#a75a86');
    expect(await logic(page, 'return T.turn.actions'), 'and costs its one action').toBe(1);

    // …and the shade that is already on writes nothing, so it costs nothing.
    await useTool(page, 'Blush plum');
    expect(await logic(page, 'return T.turn.actions'), 'a provable no-op is still free').toBe(1);

    expect(errors).toEqual([]);
  });
});
