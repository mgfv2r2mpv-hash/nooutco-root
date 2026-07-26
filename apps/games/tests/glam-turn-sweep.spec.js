import { test, expect } from '@playwright/test';

/**
 * Glam Team Makeover — Finding E, the per-tool turn-exchange sweep.
 *
 * Finding A closed one instance of a class: `Treat spots`, with every spot
 * already patched, was still armable, could change nothing, and at the action
 * cap took the learner's independent score away (`overCap 2`, `forfeit
 * 'overcap'`). The sweep asked the same four questions of all 69 person tools
 * and found the class is the catalogue, not the tool:
 *
 *   · with a tool's own work done, re-running its mechanism leaves `ed`
 *     byte-identical — for every one of the 69;
 *   · 67 of 69 still spent a turn action for it on the next turn;
 *   · 67 of 69 logged `overCap` and set the turn-durable `forfeit='overcap'`
 *     when it was reached for at the cap.
 *
 * The two that already passed are patch and conceal — `_optDead` refuses them
 * before the cap check, which is exactly the Finding A guard.
 *
 * The cause is that `_admit`'s own contract ("free re-touches of an
 * already-charged article never reach the engine") is enforced through
 * `_charged`, which `syncTT` wipes at every turn boundary. Across the boundary
 * the identical re-touch reads as a first touch. `_optNoOp` answers the
 * question `_charged` was standing in for — would this apply path write one
 * byte the client does not already carry? — and a no-op re-touch is now free in
 * both directions: no charge, and no refusal either.
 *
 * Free is NOT dead. Every tool here stays armable, keeps its target overlay and
 * its "All done ✓", and still echoes on the mirror. Only the ledger changed.
 *
 * Tests 1–3 fail against 93dab9be and d4c0c112. Test 4 passes on all three by
 * design — it is the durability pin for completion across the exchange, which
 * the sweep measured as already correct and which this change must not break.
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

async function stage(page, { routine = 'free', turns = '6' } = {}) {
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

/** Arm a tap tool and tap its target box once. */
async function tapTool(page, name) {
  await page.getByTitle(name, { exact: true }).first().click();
  const zone = page.locator('div[style*="gtm-target"]').first();
  await expect(zone).toBeVisible();
  await zone.click();
}

/** The engine's own per-turn ledger, read off the live Trial. */
const ledger = (page) => logic(page, `const t=T.turn; return t?{actor:t.actor,actions:t.actions,budget:t.budget,overCap:t.overCap,forfeit:t.forfeit||null}:null;`);

/* Four tools that spend FOUR charges. The economy keys on the article, not the
   button (`_optKey`), so the twelve hair colours are one key between them and a
   turn spent on hair colours never reaches its own cap. Each of these is a
   distinct `item:` slot. */
const FOUR_KEYS = ['Mascara', 'Eyeliner', 'Lip liner', 'Brow pencil'];

/** Tap distinct-key tools until the turn is exactly at its cap. */
async function spendToCap(page, kit) {
  for (const name of kit) {
    const l = await ledger(page);
    if (l.actions >= l.budget) return l;
    await tapTool(page, name);
  }
  return ledger(page);
}

/** Hand over, let the partner spend their whole budget, mand it back, resume.
    The shipped default give-back is "they 'forget' → I ask", so the return leg
    is the learner's own mand (`✓ I asked!`) and then Go. */
async function roundTrip(page, kit) {
  await page.getByRole('button', { name: /Done — their turn/ }).click();
  const theirs = await ledger(page);
  expect(theirs.actor, 'the partner has the turn').toBe('staff');
  await spendToCap(page, kit);
  await page.getByRole('button', { name: /I asked/ }).click();
  await page.getByRole('button', { name: /Go —/ }).click();
  return theirs;
}

/* The in-page sweep body, shared by test 1. Written as a string because it runs
   inside `logic()`. It resets the LIVE Trial's per-turn counters between tools:
   69 tools on one turn would exhaust the budget after the first handful and
   every later row would read "spent nothing" for the wrong reason. The engine
   source is untouched — this pokes the running Trial only, and test 2 and 3
   drive the cap by real play with no poking at all. */
const SWEEP = `
const tick=()=>new Promise(r=>setTimeout(r,0));
const fresh=()=>{const t=T.turn;t.actions=0;t.overCap=0;t.forfeit=null;t.cueAt=null;};
async function work(opt,redo){
  L.arm(opt); await tick();
  if(opt.mech==='choose') return;
  if(opt.mech==='paint'){
    if(redo){ L.setState({armed:opt}); await tick(); L.paintStep(); await tick(); return; }
    for(let i=0;i<11&&(L.state.ed.cov[opt.slot]||0)<1;i++){ L.setState({armed:opt}); await tick(); L.paintStep(); await tick(); }
    return; }
  if(opt.mech==='patch'){ for(let i=0;i<L.state.ed.pimples.length;i++){ L.setState({armed:opt}); await tick(); L.patchOne(i); await tick(); } return; }
  if(opt.mech==='conceal'){ for(let i=0;i<L.state.ed.pimples.length;i++){ L.setState({armed:opt}); await tick(); L.concealOne(i); await tick(); } return; }
  L.tapApply(); await tick(); }
return (async()=>{
  const base=JSON.parse(JSON.stringify(L.state.ed));
  const all=L.cfg().cats.flatMap(g=>g.options);
  const patchOpt=all.find(o=>o.mech==='patch');
  const rows=[];
  for(const opt of all){
    L.setState({ed:JSON.parse(JSON.stringify(base)),armed:null,chargedThisTurn:{}}); L._charged={}; fresh(); await tick();
    if(opt.mech==='conceal') await work(patchOpt);
    await work(opt);                                   // the tool's own work, done
    const done=JSON.stringify(L.state.ed);
    // the turn boundary, exactly as syncTT draws it
    L._charged={}; L.setState({chargedThisTurn:{},armed:null}); fresh(); await tick();
    const claim=!!L._optNoOp(opt);                     // read BEFORE the re-run
    const a0=T.turn.actions;
    await work(opt,true);                              // reach for it again
    rows.push({id:opt.id,claim,writesNothing:JSON.stringify(L.state.ed)===done,charges:T.turn.actions-a0});
    // …and the same re-run with the turn already at its cap
    L.setState({ed:JSON.parse(done),armed:null,chargedThisTurn:{}}); L._charged={}; fresh(); await tick();
    T.turn.actions=T.turn.budget;
    await work(opt,true);
    rows[rows.length-1].overCap=T.turn.overCap;
    rows[rows.length-1].forfeit=T.turn.forfeit||null; }
  return rows; })();`;

test.describe('Glam Team Makeover — a finished tool costs nothing to reach for again', () => {
  test('every tool in the catalogue: work done ⇒ re-running it writes nothing, spends nothing, forfeits nothing', async ({ page }) => {
    test.slow();
    const errors = await stage(page);
    const rows = await logic(page, SWEEP);
    expect(rows.length, 'the whole person catalogue was swept').toBe(69);

    // The rule, stated as a measurement: `_optNoOp` claims exactly what the
    // apply paths actually do. Not "it agrees where I remembered to check".
    expect(rows.filter((r) => r.claim !== r.writesNothing).map((r) => r.id),
      '_optNoOp disagrees with what re-running the tool actually writes').toEqual([]);

    // The sweep's headline: EVERY tool is a no-op once its own work is done.
    expect(rows.filter((r) => !r.writesNothing).map((r) => r.id),
      'a finished tool wrote something on the second reach').toEqual([]);

    // …and therefore none of them may cost anything. This is the fix.
    expect(rows.filter((r) => r.charges !== 0).map((r) => r.id),
      'a finished tool spent a turn action for a write it did not make').toEqual([]);
    expect(rows.filter((r) => r.overCap !== 0 || r.forfeit !== null).map((r) => r.id),
      'reaching for a finished tool at the cap cost the turn its independence').toEqual([]);

    expect(errors).toEqual([]);
  });

  test('across a real exchange, both directions: re-dragging a finished Wash spends none of my new budget', async ({ page }) => {
    const errors = await stage(page, { turns: '6' });

    // ── my turn: wash the face, for real ─────────────────────────────────────
    await paintTool(page, 'Wash');
    const mine = await ledger(page);
    expect(mine.actor).toBe('learner');
    expect(mine.actions, 'washing a bare face is one action').toBe(1);

    // ── hand it over, let the partner spend their budget, take it back ───────
    await roundTrip(page, FOUR_KEYS);

    // ── my turn again. Wash is done and still says so ────────────────────────
    const back = await ledger(page);
    expect(back.actor, 'the turn came back to the learner').toBe('learner');
    expect(back.actions, 'a fresh turn starts empty').toBe(0);
    expect(await logic(page, `return L.state.ed.cov.wash>=1 && !!L.state.ed.done.wash;`),
      'the wash survived the exchange in both directions').toBe(true);

    // Re-drag it. The face cannot get any cleaner, so this must cost nothing.
    await paintTool(page, 'Wash');
    const after = await ledger(page);
    expect(after.actions, 'a re-drag that cannot change the face spends no action').toBe(0);
    expect(after.overCap).toBe(0);
    expect(after.forfeit).toBe(null);

    // The overlay still tells the truth over the finished slot (eval §8).
    await page.getByTitle('Wash', { exact: true }).first().click();
    await expect(page.locator('div[style*="gtm-target"]').first()).toContainText('All done ✓');

    expect(errors).toEqual([]);
  });

  test('at the cap on a LATER turn, by real play: a finished tool forfeits nothing — an unfinished one still does', async ({ page }) => {
    const errors = await stage(page, { turns: '10' });

    /* The boundary is load-bearing. Within ONE turn `_charged` already makes a
       re-touch free, so a same-turn version of this test passes on 93dab9be
       too and proves nothing. The wash therefore happens on turn 1 and the cap
       is reached on turn 2 — which is the state the sweep found broken, and the
       state a child actually plays. The partner's kit and the learner's turn-2
       kit share no charge key, so neither turn's work makes the other's free. */
    await paintTool(page, 'Wash');
    await roundTrip(page, ['Shape brows', 'Pearl stud', 'Brunette', 'Pixie']);

    // Spend the whole of the NEW turn's budget on real, distinct work.
    const capped = await spendToCap(page, FOUR_KEYS);
    expect(capped.actor, 'this is the learner\'s own second turn').toBe('learner');
    expect(capped.actions, 'the turn is at its cap').toBe(capped.budget);
    expect(capped.overCap, 'and nothing has been refused yet').toBe(0);
    expect(capped.forfeit).toBe(null);

    /* Reach for the FINISHED wash at the cap — one click, because `arm()` is
       where the harm lands: that is the call that used to route a tool which
       can do nothing through `_refuse` → `requestAction`. It can do nothing, so
       it must cost nothing. This is the Finding A guarantee, generalised past
       patch and conceal. */
    await page.getByTitle('Wash', { exact: true }).first().click();
    const afterDead = await ledger(page);
    expect(afterDead.overCap, 'a finished tool at the cap is not an over-cap violation').toBe(0);
    expect(afterDead.forfeit, 'and never costs the child their independent score').toBe(null);
    expect(await logic(page, `return !!(L.state.armed && L.state.armed.id==='wash');`),
      'and free is not dead — it still arms, and still shows its target').toBe(true);
    await paintTool(page, 'Wash');
    expect((await ledger(page)).forfeit, 'dragging it at the cap is free too').toBe(null);

    // The control, in the same breath: a tool that WOULD change something is
    // still refused at the cap, still logged, and still forfeits the turn. The
    // fix makes no-ops free; it does not make the cap optional. The refusal
    // lands at ARM time, so there is no drag to make — Moisturize never gets a
    // target zone at all, which is itself the assertion.
    await page.getByTitle('Moisturize', { exact: true }).first().click();
    expect(await logic(page, `return L.state.armed;`),
      'a tool that would spend a new charge is refused before it can arm').toBe(null);
    const afterLive = await ledger(page);
    expect(afterLive.overCap, 'a real action at the cap is still refused and logged').toBeGreaterThan(0);
    expect(afterLive.forfeit, 'and still sets the turn-durable forfeit').toBe('overcap');
    expect(await logic(page, `return (L.state.ed.cov.moist||0);`),
      'and the refused action wrote nothing').toBe(0);

    expect(errors).toEqual([]);
  });

  test('completion survives the exchange in both directions, for every mechanism family', async ({ page }) => {
    // This one PASSES against 93dab9be and d4c0c112 by design — it is the pin
    // for what the sweep measured as already correct (`ed` is client state and
    // `syncTT` never touches it at a turn boundary), so that making no-op
    // re-touches free cannot quietly un-complete anything.
    const errors = await stage(page, { turns: '6' });

    /* Read what the CHILD sees — the trolley's own face for one representative
       of each mechanism family — rather than the predicate behind it. `wash`
       stands for paint, `mascara` for tap/toggle, `hc_berry` for tap/recolor,
       `ear1` for tap/place, `sh_bob` for choose.

       The per-spot pair is read the other way round, as `gonePair` below. By the
       maintainer's ruling a tool whose own mechanism has gone dead disappears
       from the cart entirely, and `patch`/`conceal` are the only two that can —
       so for them "completion survived the exchange" means they are still ABSENT
       on the far side, not that a ✓ is still painted on a button. Free play is
       what this test runs in, and free play never settles a shelf, so there is no
       shelf ✓ to read here either; the staged surface's ✓ record row is asserted
       in glam-turn-exchange.spec.js. */
    const REPS = ['Wash', 'Mascara', 'Berry', 'Pearl stud', 'Bob'];
    const DEAD_PAIR = ['Treat spots', 'Conceal'];
    const read = async () => ({
      ed: await logic(page, `return JSON.stringify(L.state.ed);`),
      /* Just the state the seven representatives own. The whole of `ed` is
         byte-identical only across the FIRST leg — on the way back the partner
         has legitimately done their own turn's work, so the durability claim
         has to be scoped to the seven, not to the client as a whole. */
      reps: await logic(page, `const e=L.state.ed; return JSON.stringify({
        wash:e.cov.wash, mascara:e.cov.mascara, hair:e.col.hair, ear:e.gl.ear,
        hairShape:e.hairShape, pimples:e.pimples,
        done:['wash','mascara','hair','ear','hairShape'].map(k=>!!e.done[k]) });`),
      faces: await Promise.all(REPS.map((n) => page.getByTitle(n, { exact: true }).first()
        .evaluate((el) => el.innerText.trim()))),
      gonePair: await Promise.all(DEAD_PAIR.map((n) => page.getByTitle(n, { exact: true }).count())),
    });

    // Give every family its work, derived from the catalogue rather than from
    // remembered literals, so the state is exactly what the apply paths write.
    await logic(page, `return new Promise((r)=>{
      const o=id=>L.cfg().cats.flatMap(g=>g.options).find(x=>x.id===id);
      const val=x=>(x.value!=null?x.value:x.color);
      L.setState((s)=>{ const ed=JSON.parse(JSON.stringify(s.ed));
        ed.cov.wash=1; ed.done.wash=true;
        ed.pimples=ed.pimples.map(()=>2);
        ed.pimples.forEach((_,i)=>{ed.done['patch'+i]=true;ed.done['conceal'+i]=true;});
        ed.cov.mascara=1; ed.done.mascara=true;
        ed.col.hair=val(o('hc_berry')); ed.done.hair=true;
        ed.gl.ear=val(o('ear1')); ed.done.ear=true;
        ed.hairShape=o('sh_bob').value; ed.done.hairShape=true;
        return { ed }; }, r); });`);

    // Hairstyle buttons carry their number above the name ("4\n✓ Bob"), so the
    // ✓ is read as present-anywhere rather than as a prefix.
    const mine = await read();
    expect(mine.faces.filter((f) => !f.includes('✓')),
      'every family reads done on my turn').toEqual([]);
    expect(mine.gonePair, 'and the dead per-spot pair has left the cart').toEqual([0, 0]);

    await page.getByRole('button', { name: /Done — their turn/ }).click();
    const theirs = await read();
    expect(theirs.faces, 'and still reads done on theirs').toEqual(mine.faces);
    expect(theirs.gonePair, 'and the pair does not come back on the handoff').toEqual([0, 0]);
    expect(theirs.ed, 'the whole client is byte-identical across the handoff').toBe(mine.ed);

    // The partner's own turn must not touch any of the seven: Eyeliner, Lip
    // liner, Shape brows and Brow pencil are four distinct keys, none of them
    // a representative above.
    await spendToCap(page, ['Eyeliner', 'Lip liner', 'Shape brows', 'Brow pencil']);
    await page.getByRole('button', { name: /I asked/ }).click();
    await page.getByRole('button', { name: /Go —/ }).click();

    const back = await read();
    expect(back.faces, 'and still reads done when it comes back').toEqual(mine.faces);
    expect(back.gonePair, 'and is still gone when it comes back').toEqual([0, 0]);
    expect(back.reps, 'and nothing the seven own moved on the return leg').toBe(mine.reps);
    expect(await logic(page, `return Object.keys(L._charged).length===0 && Object.keys(L.state.chargedThisTurn||{}).length===0;`),
      'the per-turn charge ledger is cleared at the boundary, both mirrors').toBe(true);

    expect(errors).toEqual([]);
  });
});
