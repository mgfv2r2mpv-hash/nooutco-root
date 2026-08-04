/* A FULL trial by real pointer input, end to end on the shipped defaults:
 * title → Start → the client texts in → Open the salon → every turn played to
 * its cap and handed over → the look finished → the outro.
 *
 * Nothing is driven through the component. Every move is a mouse event on the
 * element the child would touch; the only thing read from the instance is which
 * tool is live and what kind of target it put on the face, because that is what
 * the child reads off the screen too.
 *
 * Prints one line per beat, the console/page-error tally, and the trial's own
 * per-turn report. Exits non-zero on any console error, page error, or if the
 * trial does not reach its outro.
 *
 * Usage: node tests/_play-glam-full-trial.mjs   (server on :8788)
 */
import { chromium } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';

const SHOTS = new URL('../../../docs/eval/shots/glam-turn-exchange/', import.meta.url).pathname;
const RULINGS = new URL('../../../docs/eval/shots/glam-rulings/', import.meta.url).pathname;
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 960 }, reducedMotion: 'reduce' });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

const L = (src) => page.evaluate((s) => {
  let f = null;
  for (const el of document.querySelectorAll('*')) {
    const k = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    if (k) { f = el[k]; break; }
  }
  while (f && !(f.stateNode && f.stateNode.logic)) f = f.return;
  const C = f.stateNode.logic;
  return new Function('L', 'T', s)(C, C._trial);
}, src);

const view = () => L(`const v=L.renderVals(); const t=T&&T.turn;
  return { phase:L.state.phase, armed:L.state.armed&&L.state.armed.id||null,
    turn:t?{n:t.n,actor:t.actor,actions:t.actions,budget:t.budget,overCap:t.overCap,forfeit:t.forfeit||null}:null,
    target:{drag:!!v.target.drag,tap:!!v.target.tap,pop:!!v.target.pop,pims:(v.target.pimples||[]).length},
    /* What the child can reach, and which of those already carry a ✓. The
       driver picks an UNTICKED one - exactly the read a child makes. Picking
       blind loops forever on the first tool, because re-dragging a finished
       shade is now free and the budget never moves. */
    /* Everything the palette renders IS live now - a tool whose mechanism has
       gone dead leaves the cart rather than sitting on it disabled (maintainer
       ruling), so there is no longer a disabled face to filter out. */
    live:(()=>{ const cat=L.cfg().cats.flatMap(g=>g.options);
      return v.palette.flatMap(g=>g.options.map(o=>{
        const c=cat.find(x=>x.label===o.title)||{};
        return { t:o.title, mech:c.mech||'', done:o.label.indexOf('\u2713')>=0 }; })); })() };`);
/* One tool is taken at most once in the whole trial. Without that the driver
   ping-pongs between two shades of one slot forever: switching shade inside a
   turn is free (the slot is already charged), so the ✓ moves back and forth and
   the budget never advances. A child moves on; so does this. */
const used = new Set();
const nextTool = (v) => {
  // …except the per-spot pair, which legitimately needs arming once per spot
  // and stays un-✓ until every spot is done.
  const u = v.live.find((o) => !o.done && !used.has(o.t))
    || v.live.find((o) => !o.done && (o.mech === 'patch' || o.mech === 'conceal'));
  if (u) used.add(u.t);
  return u && u.t;
};

const click = (name) => page.getByTitle(name, { exact: true }).first().click();
const btn = (re) => page.getByRole('button', { name: re }).first();

async function useTarget(v) {
  if (v.target.pop) {
    const ring = page.locator('div[style*="gtm-pim"]').first();
    if (await ring.isVisible().catch(() => false)) { await ring.click(); return 'spot'; }
    return 'no-spot';
  }
  const zone = page.locator('div[style*="gtm-target"]').first();
  if (!(await zone.isVisible().catch(() => false))) return 'no-zone';
  if (v.target.tap) { await zone.click(); return 'tap'; }
  const b = await zone.boundingBox();
  await page.mouse.move(b.x + 8, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) await page.mouse.move(b.x + 8 + (i * (b.width - 16)) / 14, b.y + b.height / 2);
  await page.mouse.up();
  return 'drag';
}

const log = (...a) => console.log(...a);

await page.goto('http://localhost:8788/glam-team-makeover/');
await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
log('· title screen up');
await btn(/^Start/).click();
log('· Start tapped - the client is texting');
// Let the thread arrive on its own for a while, then use the shipped Skip.
const salon = btn(/Open the salon/);
for (let i = 0; i < 30 && !(await salon.isVisible().catch(() => false)); i++) await page.waitForTimeout(500);
if (!(await salon.isVisible().catch(() => false))) { await btn(/Skip ahead/).click(); log('· Skip ahead tapped'); }
await salon.click();
log('· salon open');
await page.waitForFunction(() => {
  const c = document.getElementById('gtm-canvas');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
  return false;
}, undefined, { timeout: 30000 });

let stalls = 0;
for (let step = 0; step < 600; step++) {
  const v = await view();
  if (process.env.GTM_TRACE) log('  step', step, v.phase, 'armed=' + v.armed, v.turn ? `${v.turn.actions}/${v.turn.budget}` : '-', 'live=' + v.live.length + '/todo=' + v.live.filter((o) => !o.done).length, JSON.stringify(v.target));
  if (v.phase === 'done') break;
  if (v.phase === 'ready') { await btn(/Go - /).click(); log(`· turn ${v.turn ? v.turn.n : '?'} - Go`); continue; }
  if (v.phase === 'giveback') { await btn(/My turn again/).click(); continue; }

  const atCap = v.turn && v.turn.actions >= v.turn.budget;
  if (v.phase === 'theirs') {
    if (atCap) { await btn(/I asked|My turn again/).click(); log('· asked for the turn back'); continue; }
  } else if (v.phase === 'mine' && atCap) {
    await btn(/Done - their turn/).click(); log(`· handed over at ${v.turn.actions}/${v.turn.budget}`); continue;
  }

  if (v.armed) { const how = await useTarget(v);
    if (how.startsWith('no')) { log('  ! armed', v.armed, how, JSON.stringify(v.target)); stalls++;
      if (stalls > 8) { log('  ! stalled', JSON.stringify(v)); break; } }
    continue; }
  const pick = nextTool(v);
  if (!pick) { stalls++; if (stalls > 8) { log('  ! no live tools', JSON.stringify(v)); break; } await page.waitForTimeout(200); continue; }
  await click(pick);
}

const end = await view();
log('· phase:', end.phase);
const rep = await L(`return T.ended ? T.report() : null;`);
if (rep) {
  log('· turns played:', rep.rows.length);
  for (const r of rep.rows) log('   ', JSON.stringify(r));
}
const outro = await page.getByText(/Trial finished|The reveal|Look at that/i).first().isVisible().catch(() => false);
log('· outro on screen:', outro);
await page.screenshot({ path: SHOTS + 'fulltrial-outro.png', fullPage: false });
await mkdir(RULINGS, { recursive: true });
await page.screenshot({ path: RULINGS + 'fulltrial-outro.png', fullPage: false });

log(errs.length ? '· CONSOLE NOT CLEAN:' : '· console clean', errs.join(' | '));
await browser.close();
if (errs.length || end.phase !== 'done') process.exit(1);
