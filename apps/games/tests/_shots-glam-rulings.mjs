/* Screenshots for the three maintainer rulings, by real pointer input.
 *
 *   cart-spots-before.png       the cart while spots are still bare - Treat
 *                               spots is on it
 *   cart-spots-after-mine.png   every spot patched, on my own turn - Treat
 *                               spots is gone, Conceal is still standing and
 *                               the shelf claims no ✓, because the step is not
 *                               over
 *   cart-spots-after-theirs.png the same cart after the handoff - the tool does
 *                               not come back
 *   shelf-finished.png          every spot clear: both tools gone and the
 *                               Skincare shelf folded to its ✓ record row
 *   shade-redrag-armed.png      a second blush armed over a painted slot - the
 *                               hitbox asks for the drag rather than saying
 *                               "All done"
 *   shade-redrag-mid.png        part-way through that fresh drag
 *   shade-redrag-done.png       the drag finished and the ✓ moved
 *
 * Usage: node tests/_shots-glam-rulings.mjs   (server on :8788)
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const SHOTS = new URL('../../../docs/eval/shots/glam-rulings/', import.meta.url).pathname;
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

const trolley = () => page.locator('#gtm-trolley');
const cart = (name) => trolley().screenshot({ path: SHOTS + name });
const shot = (name) => page.screenshot({ path: SHOTS + name });
const tool = (n) => page.getByTitle(n, { exact: true }).first();
const btn = (re) => page.getByRole('button', { name: re }).first();

async function open({ routine = 'on', turns = '4' } = {}) {
  await page.goto('http://localhost:8788/glam-team-makeover/');
  await page.waitForFunction(() => !!window.GlamTT);
  await page.getByTitle('Show / hide setup').click();
  await page.getByLabel('Routine', { exact: true }).selectOption(routine);
  await page.getByLabel('Turns', { exact: true }).selectOption(turns);
  await btn(/^▶ Play/).click();
  await page.waitForFunction(() => {
    const c = document.getElementById('gtm-canvas');
    if (!c) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8 && ++n > 20000) return true;
    return false;
  }, undefined, { timeout: 30000 });
  await btn(/Go - /).click();
}

async function drag(name, strokes = 14) {
  await tool(name).click();
  const zone = page.locator('div[style*="gtm-target"]').first();
  const b = await zone.boundingBox();
  await page.mouse.move(b.x + 8, b.y + b.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= strokes; i++) await page.mouse.move(b.x + 8 + (i * (b.width - 16)) / strokes, b.y + b.height / 2);
  await page.mouse.up();
}

async function tapSpots(name, n) {
  await tool(name).click();
  for (let i = 0; i < n; i++) {
    const ring = page.locator('div[style*="gtm-pim"]').first();
    await ring.waitFor({ state: 'visible' });
    await ring.click();
  }
}

// ── Rulings 2 + 3 - the spots step, across a handoff ────────────────────────
await open();
await drag('Wash');
await drag('Moisturize');
await cart('cart-spots-before.png');
console.log('before  · Treat spots on the cart:', await tool('Treat spots').count());

await tapSpots('Treat spots', 3);
await cart('cart-spots-after-mine.png');
console.log('patched · Treat spots:', await tool('Treat spots').count(), '· Conceal:', await tool('Conceal').count());

await btn(/Done - their turn/).click();
await cart('cart-spots-after-theirs.png');
console.log('theirs  · Treat spots:', await tool('Treat spots').count(), '· Conceal:', await tool('Conceal').count());

await tapSpots('Conceal', 3);
await cart('shelf-finished.png');
console.log('cleared · Skincare header:', JSON.stringify(await page.locator('[data-shelf="Skincare"] button').first().innerText()),
  '· tools left:', await page.locator('[data-shelf="Skincare"] button[title]').count());

// ── Ruling 1a - a shade switch is a fresh drag ──────────────────────────────
await open({ routine: 'free' });
await drag('Blush rose');
await tool('Blush plum').click();
await shot('shade-redrag-armed.png');
console.log('\narmed   · hitbox says:', JSON.stringify((await page.locator('div[style*="gtm-target"]').first().innerText()).trim()),
  '· cov:', await L('return L.state.ed.cov.blush'));

// half the drag, then look at it
const zone = page.locator('div[style*="gtm-target"]').first();
const b = await zone.boundingBox();
await page.mouse.move(b.x + 8, b.y + b.height / 2);
await page.mouse.down();
for (let i = 1; i <= 5; i++) await page.mouse.move(b.x + 8 + (i * (b.width - 16)) / 14, b.y + b.height / 2);
await shot('shade-redrag-mid.png');
console.log('mid     · hitbox says:', JSON.stringify((await zone.innerText()).trim()),
  '· cov:', await L('return L.state.ed.cov.blush'));
for (let i = 6; i <= 14; i++) await page.mouse.move(b.x + 8 + (i * (b.width - 16)) / 14, b.y + b.height / 2);
await page.mouse.up();
await shot('shade-redrag-done.png');
console.log('done    · cov:', await L('return L.state.ed.cov.blush'),
  '· shade on the slot:', await L('return L.state.ed.col.blush'),
  '· ✓ on Blush plum:', (await tool('Blush plum').innerText()).includes('✓'));

console.log('\nconsole:', errs.length ? errs : 'clean');
await browser.close();
if (errs.length) process.exit(1);
