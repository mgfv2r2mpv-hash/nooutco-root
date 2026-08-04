/* Screenshot pass for the refresh's new opening surfaces.
   Not a spec - run with `node tests/_shots-open-flow.mjs` against a server on
   :8788. Drives the real flow (Start → the thread mid-arrival → the booked
   state → the salon) at the three device widths the spec's §3.9 device order
   names, and fails loudly on any console error. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const OUT = new URL('../../../docs/eval/shots/glam-refresh/', import.meta.url).pathname;
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
  { tag: 'phone', width: 390, height: 844 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];

for (const d of DEVICES) {
  const page = await browser.newPage({ viewport: { width: d.width, height: d.height } });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${d.tag}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${d.tag}: ${e.message}`));

  await page.goto('http://localhost:8788/glam-team-makeover/');
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await page.getByRole('button', { name: /^Start/ }).waitFor();
  await page.screenshot({ animations: 'disabled', path: `${OUT}title-screen-${d.tag}.png` });

  await page.getByRole('button', { name: /^Start/ }).click();
  // mid-thread: a couple of bubbles landed, someone still typing
  await page.waitForFunction(() => document.querySelectorAll('.gtm-dot').length > 0);
  await page.waitForTimeout(2000);
  await page.screenshot({ animations: 'disabled', path: `${OUT}texting-intro-${d.tag}.png` });

  await page.getByRole('button', { name: 'Skip ahead' }).click();
  await page.getByRole('button', { name: /Open the salon/ }).waitFor();
  await page.screenshot({ animations: 'disabled', path: `${OUT}texting-booked-${d.tag}.png` });

  await page.getByRole('button', { name: /Open the salon/ }).click();
  await page.getByRole('button', { name: /Go - / }).waitFor();
  await page.waitForFunction(() => {
    const c = document.getElementById('gtm-canvas');
    if (!c) return false;
    const dd = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < dd.length; i += 4) if (dd[i] > 8 && ++n > 20000) return true;
    return false;
  }, undefined, { timeout: 20000 });
  await page.screenshot({ animations: 'disabled', path: `${OUT}salon-open-${d.tag}.png` });

  // the BT setup, one ⚙ away from the child's front door
  if (d.tag === 'desktop') {
    await page.getByTitle('Show / hide setup').click();
    await page.screenshot({ animations: 'disabled', path: `${OUT}bt-setup-${d.tag}.png` });
  }
  await page.close();
}

await browser.close();
if (problems.length) { console.error('CONSOLE ERRORS:\n' + problems.join('\n')); process.exit(1); }
console.log('shots written to ' + OUT);
