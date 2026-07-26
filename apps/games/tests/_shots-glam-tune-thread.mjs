/* Screenshot pass for TUNING fix 2 — the texting intro.
   Not a spec. Run against a server on :8788:

     git show HEAD:apps/games/glam-team-makeover/index.html \
       > apps/games/glam-team-makeover/_before-tune.html
     PHASE=before PAGE=/glam-team-makeover/_before-tune.html node tests/_shots-glam-tune-thread.mjs
     PHASE=after  node tests/_shots-glam-tune-thread.mjs
     rm apps/games/glam-team-makeover/_before-tune.html

   The `before` page is the previous commit's file dropped into the SAME
   directory, so `../tailwind.css`, `vendor/` and `assets/` all resolve exactly
   as they do for the live build and the pair differs only in the thing under
   test.

   Math.random is seeded in an init script because the client, the name and the
   scenario are all drawn at random (D-F): without it the before pass and the
   after pass photograph two different conversations and the pair is unreadable.
   Reduced motion, same reason as the sibling scripts: it settles the arrival
   keyframes so a bubble is photographed at rest rather than mid-flight. */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const PHASE = process.env.PHASE || 'after';
const PAGE = process.env.PAGE || '/glam-team-makeover/';
const OUT = new URL('../../../docs/eval/shots/glam-tune/', import.meta.url).pathname;
const DEVICES = [
  { tag: 'desktop', width: 1280, height: 860 },
  { tag: 'tablet', width: 834, height: 1112 },
  { tag: 'phone', width: 390, height: 844 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const problems = [];

for (const d of DEVICES) {
  const page = await browser.newPage({ viewport: { width: d.width, height: d.height }, reducedMotion: 'reduce' });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${d.tag}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${d.tag}: ${e.message}`));
  await page.addInitScript(() => {
    let s = 20260725;
    Math.random = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  });
  await page.goto(`http://localhost:8788${PAGE}`);
  await page.waitForFunction(() => !!window.GlamTT && !!window.GlamStory);
  await page.getByRole('button', { name: /^Start/ }).click();

  /* The CLIENT typing: the first bubble has landed and the next one is on its
     way in from the left. */
  await page.waitForFunction(() => document.querySelectorAll('.gtm-scroll [style*="justify-content"] > div').length >= 1);
  await page.waitForFunction(() => document.querySelectorAll('.gtm-dot').length > 0);
  await page.screenshot({ path: `${OUT}texting-intro-${PHASE}-${d.tag}.png` });

  /* The GLAM TEAM typing: the client has finished asking and the reply is
     coming back down the right-hand side. */
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.gtm-scroll > div')];
    const typing = rows.find((r) => r.querySelector('.gtm-dot'));
    return !!typing && getComputedStyle(typing).justifyContent === 'flex-end';
  }, undefined, { timeout: 30000 });
  await page.screenshot({ path: `${OUT}texting-typing-team-${PHASE}-${d.tag}.png` });

  await page.getByRole('button', { name: /Skip ahead/ }).click();
  await page.getByRole('button', { name: /Open the salon/ }).waitFor();
  await page.screenshot({ path: `${OUT}texting-booked-${PHASE}-${d.tag}.png` });

  await page.close();
}

await browser.close();
if (problems.length) {
  console.error('CONSOLE / PAGE ERRORS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`${PHASE} thread shots written to ${OUT}`);
