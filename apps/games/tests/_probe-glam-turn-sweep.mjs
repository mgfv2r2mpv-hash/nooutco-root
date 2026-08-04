/* Finding E - the per-tool turn-exchange sweep.
 *
 * For EVERY tool in the person catalogue, with that tool's own work already
 * done, answer the four columns:
 *   a  armable - is it still on the cart and can `arm()` take it?
 *   b  changes - does re-running its own mechanism change the client at all?
 *   c  tick - does its ✓ survive being armed, or blink off?
 *   d  charges - does re-running it spend a turn action on a FRESH turn?
 *
 * `d` is measured across a real turn boundary: `_charged` is cleared exactly
 * the way `_advanceTurn` clears it, so a tool that charged on turn 1 is asked
 * again on turn 2. A tool that is (a) armable, (b) cannot change anything and
 * (d) still charges is the Finding A shape.
 *
 * Usage: node tests/_probe-glam-turn-sweep.mjs   (server on :8788)
 */
import { chromium } from '@playwright/test';

const painted = () => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:8788/glam-team-makeover/');
await page.waitForFunction(() => !!window.GlamTT);
await page.getByTitle('Show / hide setup').click();
await page.getByLabel('Routine', { exact: true }).selectOption('free');
await page.getByLabel('Turns', { exact: true }).selectOption('6');
await page.getByRole('button', { name: /^▶ Play/ }).click();
await page.getByRole('button', { name: /Go - / }).click();
await page.waitForFunction(painted, undefined, { timeout: 20000 });

const rows = await page.evaluate(async () => {
  const host = document.getElementById('gtm-canvas');
  let f = host[Object.keys(host).find((k) => k.startsWith('__reactFiber$'))];
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  const L = f.stateNode.logic;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const snap = () => JSON.stringify(L.state.ed);
  const base = JSON.parse(snap());

  /* The trolley face for one option, straight out of renderVals - the ✓ prefix
     is what the maintainer watched blink. */
  const face = (opt) => {
    const v = L.renderVals();
    for (const g of v.palette || []) for (const o of g.options || []) {
      if (o.title === opt.label) return { label: o.label, disabled: !!o.disabled };
    }
    return null;
  };
  /* The sweep runs 69 tools through one Trial, so the shared turn would hit the
     cap after the first handful and every later row would read "spent nothing"
     for the wrong reason. Each row therefore starts from a clean turn ledger.
     The ENGINE is untouched - this pokes the live Trial's counters only, and
     only in this probe. */
  const freshTurn = () => { const t = L._trial.turn; t.actions = 0; t.overCap = 0; t.forfeit = null; t.cueAt = null; };

  /* Run this tool's own mechanism to completion, once. `redo` re-runs it with
     the work already done - for paint that must be ONE UNGUARDED stroke, not a
     `while cov<1` loop, or the loop guard hides the very charge being measured. */
  async function work(opt, redo) {
    if (opt.mech === 'choose') { L.arm(opt); await tick(); return; }
    L.arm(opt); await tick();
    if (opt.mech === 'paint') { if (redo) { L.setState({ armed: opt }); await tick(); L.paintStep(); await tick(); return; }
      for (let i = 0; i < 11 && (L.state.ed.cov[opt.slot] || 0) < 1; i++) { L.setState({ armed: opt }); await tick(); L.paintStep(); await tick(); } return; }
    if (opt.mech === 'patch') { for (let i = 0; i < L.state.ed.pimples.length; i++) { L.setState({ armed: opt }); await tick(); L.patchOne(i); await tick(); } return; }
    if (opt.mech === 'conceal') { for (let i = 0; i < L.state.ed.pimples.length; i++) { L.setState({ armed: opt }); await tick(); L.concealOne(i); await tick(); } return; }
    L.tapApply(); await tick();
  }

  const cats = L.cfg().cats;
  const out = [];
  for (const grp of cats) for (const opt of grp.options) {
    // ── reset the client and the turn economy ──────────────────────────────
    L.setState({ ed: JSON.parse(JSON.stringify(base)), armed: null, chargedThisTurn: {} });
    L._charged = {};
    freshTurn();
    await tick();
    // conceal needs every spot patched first - that is its own precondition,
    // not part of what is being measured.
    if (opt.mech === 'conceal') {
      const p = L.cfg().cats.flatMap((g) => g.options).find((o) => o.mech === 'patch');
      await work(p);
    }
    await work(opt);
    const edDone = snap();
    const faceDone = face(opt);

    // ── the turn boundary, exactly as `_advanceTurn` draws it ───────────────
    L._charged = {};
    L.setState({ chargedThisTurn: {}, armed: null });
    freshTurn();
    await tick();

    const dead = !!L._optDead(opt), locked = !!L._optLocked(opt), spent = !!L._optSpent(opt);
    const onCart = !!faceDone && !spent && !locked;
    const a0 = L._trial.turn.actions;

    // ── (a) can arm() take it, and (c) does the ✓ survive being armed? ──────
    L.arm(opt); await tick();
    const armed = !!(L.state.armed && L.state.armed.id === opt.id);
    const faceArmed = face(opt);
    const tickHeld = !faceDone || !faceDone.label.startsWith('✓ ')
      ? 'n/a' : (faceArmed && faceArmed.label.startsWith('✓ ') ? 'held' : 'blinks');

    // ── (b) does re-running its mechanism change the client? ───────────────
    await work(opt, true);
    const edRedo = snap();
    const charges = L._trial.turn.actions - a0;

    // ── (d) worse half: the SAME re-run with the turn already at its cap ────
    L.setState({ ed: JSON.parse(JSON.stringify(JSON.parse(edDone))), armed: null, chargedThisTurn: {} });
    L._charged = {};
    freshTurn();
    await tick();
    const t = L._trial.turn; t.actions = t.budget;      // at the cap, nothing spent yet
    await work(opt, true);
    const capCost = { overCap: t.overCap, forfeit: t.forfeit || null };

    out.push({
      grp: grp.label, id: opt.id, label: opt.label,
      mech: opt.mech + (opt.apply ? '/' + opt.apply : ''), slot: opt.slot || '',
      family: (L._familySizes()[L._optFamily(opt)] || 0),
      dead, locked, spent, onCart, armable: armed || opt.mech === 'choose',
      changes: edRedo !== edDone, tick: tickHeld, charges,
      overCap: capCost.overCap, forfeit: capCost.forfeit,
    });
  }
  return out;
});

/* ── Phase 2 - completion across a REAL handoff, both directions ────────────
   One representative per mechanism family, all worked on the learner's own
   turn, then `handoff()` → partner → back. Completion is claimed from `ed`,
   which `_advanceTurn` never touches; this is the measurement of that. */
const hand = await page.evaluate(async () => {
  const host = document.getElementById('gtm-canvas');
  let f = host[Object.keys(host).find((k) => k.startsWith('__reactFiber$'))];
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  const L = f.stateNode.logic;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const all = L.cfg().cats.flatMap((g) => g.options);
  const pick = (p) => all.find(p);
  const REPS = [
    ['paint', pick((o) => o.id === 'wash')],
    ['patch', pick((o) => o.mech === 'patch')],
    ['conceal', pick((o) => o.mech === 'conceal')],
    ['tap/toggle', pick((o) => o.id === 'mascara')],
    ['tap/recolor', pick((o) => o.id === 'hc_berry')],
    ['tap/place', pick((o) => o.id === 'ear1')],
    ['choose', pick((o) => o.id === 'sh_bob')],
  ];
  async function work(opt) {
    L.arm(opt); await tick();
    if (opt.mech === 'choose') return;
    if (opt.mech === 'paint') { for (let i = 0; i < 11 && (L.state.ed.cov[opt.slot] || 0) < 1; i++) { L.setState({ armed: opt }); await tick(); L.paintStep(); await tick(); } return; }
    if (opt.mech === 'patch') { for (let i = 0; i < L.state.ed.pimples.length; i++) { L.setState({ armed: opt }); await tick(); L.patchOne(i); await tick(); } return; }
    if (opt.mech === 'conceal') { for (let i = 0; i < L.state.ed.pimples.length; i++) { L.setState({ armed: opt }); await tick(); L.concealOne(i); await tick(); } return; }
    L.tapApply(); await tick();
  }
  const read = () => {
    const v = L.renderVals();
    const tickOf = (opt) => {
      for (const g of v.palette || []) for (const o of g.options || []) if (o.title === opt.label) return (o.label.startsWith('✓ ') ? '✓' : ' - ') + (o.disabled ? '·disabled' : '');
      return 'off-cart';
    };
    return REPS.map(([fam, o]) => ({ fam, id: o.id, done: !!L._optWorkDone(o), dead: !!L._optDead(o), tick: tickOf(o) }));
  };
  const ledger = () => { const t = L._trial.turn; return t ? { actor: t.actor, actions: t.actions, budget: t.budget, overCap: t.overCap, forfeit: t.forfeit || null } : null; };

  // the learner's own turn: give every family its work, with the ledger reset
  // between tools so one turn can hold all seven (the real game spreads them).
  for (const [, o] of REPS) { const t = L._trial.turn; t.actions = 0; t.overCap = 0; t.forfeit = null; await work(o); }
  const mine = { state: read(), ledger: ledger(), ed: JSON.stringify(L.state.ed) };
  L.handoff(); await tick();
  const theirs = { state: read(), ledger: ledger(), ed: JSON.stringify(L.state.ed) };
  L.giveBack(); await tick();         // partner hands it back (staffHandBack)
  const back = { state: read(), ledger: ledger(), ed: JSON.stringify(L.state.ed) };
  return {
    mine: mine.state, theirs: theirs.state, back: back.state,
    ledgers: { mine: mine.ledger, theirs: theirs.ledger, back: back.ledger },
    edHoldsAcross: mine.ed === theirs.ed && theirs.ed === back.ed,
    chargedCleared: Object.keys(L._charged).length === 0 && Object.keys(L.state.chargedThisTurn || {}).length === 0,
  };
});

/* ── Phase 3 - the control. Making a no-op free must NOT make a real change
   free. Same starting point, but the second reach picks a DIFFERENT option of
   the same slot, which the client does not already carry. That one still has
   to spend an action and still has to be refused at the cap. */
const ctrl = await page.evaluate(async () => {
  const host = document.getElementById('gtm-canvas');
  let f = host[Object.keys(host).find((k) => k.startsWith('__reactFiber$'))];
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  const L = f.stateNode.logic;
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const all = L.cfg().cats.flatMap((g) => g.options);
  const id = (x) => all.find((o) => o.id === x);
  const base = JSON.parse(JSON.stringify(L.state.ed));
  const freshTurn = () => { const t = L._trial.turn; t.actions = 0; t.overCap = 0; t.forfeit = null; t.cueAt = null; };
  async function apply(opt, strokes) {
    L.arm(opt); await tick();
    if (opt.mech === 'choose') return;
    if (opt.mech === 'paint') { for (let i = 0; i < (strokes || 11); i++) { L.setState({ armed: opt }); await tick(); L.paintStep(); await tick(); } return; }
    L.tapApply(); await tick();
  }
  const PAIRS = [['paint', 'bl1', 'bl2'], ['tap/recolor', 'hc_berry', 'hc_mint'],
    ['tap/place', 'ear1', 'ear2'], ['choose', 'sh_bob', 'sh_pixie']];
  const out = [];
  for (const [fam, a, b] of PAIRS) {
    L.setState({ ed: JSON.parse(JSON.stringify(base)), armed: null, chargedThisTurn: {} });
    L._charged = {}; freshTurn(); await tick();
    await apply(id(a));                                   // the work, on turn 1
    L._charged = {}; L.setState({ chargedThisTurn: {} }); freshTurn(); await tick();
    const t = L._trial.turn, a0 = t.actions;
    // read BEFORE the write; absent on pre-fix builds, so the probe runs on both
    const notNoOp = typeof L._optNoOp === 'function' ? L._optNoOp(id(b)) === false : null;
    await apply(id(b));                                   // a DIFFERENT option, turn 2
    const charges = L._trial.turn.actions - a0;
    // and the same different option with the turn already at its cap
    L.setState({ ed: JSON.parse(JSON.stringify(base)), armed: null, chargedThisTurn: {} });
    L._charged = {}; freshTurn(); await tick();
    await apply(id(a));
    L._charged = {}; L.setState({ chargedThisTurn: {} }); freshTurn(); await tick();
    const t2 = L._trial.turn; t2.actions = t2.budget;
    await apply(id(b));
    out.push({ fam, from: a, to: b, charges, notNoOp, overCapAtCap: t2.overCap, forfeitAtCap: t2.forfeit || null });
  }
  return out;
});

console.log(JSON.stringify({ errs, n: rows.length, rows, hand, ctrl }, null, 1));
await page.close();
await browser.close();
