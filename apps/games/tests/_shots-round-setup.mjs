/**
 * Before / after screenshots for the Round-setup port (PHASE8-HANDOFF-3 §3b).
 * Not a spec; run it by hand against a live server, once on the base branch
 * (no panel: only the settings-bar shot is taken) and once on the port:
 *
 *   npx wrangler pages dev . --port 8811
 *   node tests/_shots-round-setup.mjs <game> [baseURL] [outDir]
 *
 * Shots per viewport: the page as it boots, the panel opened by a tap
 * (locked), and the panel opened by a press and hold (editing).
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const GAME = process.argv[2];
const BASE = process.argv[3] || 'http://localhost:8811';
const OUT = process.argv[4] || `test-results/shots-round-setup/${GAME}`;
if (!GAME) {
  console.error('usage: node tests/_shots-round-setup.mjs <game> [baseURL] [outDir]');
  process.exit(2);
}

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
];
const HOLD_MS = 700;

async function shoot(page, file) {
  await page.screenshot({ path: `${OUT}/${file}.png`, fullPage: false });
  console.log(`  ${OUT}/${file}.png`);
}

async function run(browser, vp, errors) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push(`[${vp.name}] ${m.text()}`); });
  page.on('pageerror', e => errors.push(`[${vp.name}] pageerror: ${e.message}`));
  await page.goto(`${BASE}/${GAME}/`);
  await page.waitForLoadState('networkidle');
  await shoot(page, `${vp.name}-boot`);

  const gear = page.locator('#btn-round-toggle');
  if (!(await gear.count())) { await ctx.close(); return; }

  await gear.click();
  await page.locator('#round-panel').waitFor({ state: 'visible' });
  await page.locator('#round-panel').scrollIntoViewIfNeeded();
  await shoot(page, `${vp.name}-panel-locked`);

  await page.locator('#btn-round-close').click();
  const box = await gear.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();
  await page.locator('#round-panel[data-editing="true"]').waitFor();
  await page.locator('#round-panel').scrollIntoViewIfNeeded();
  await shoot(page, `${vp.name}-panel-editing`);
  await page.locator('#round-panel').screenshot({ path: `${OUT}/${vp.name}-panel-full.png` });
  console.log(`  ${OUT}/${vp.name}-panel-full.png`);
  await ctx.close();
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const errors = [];
for (const vp of VIEWPORTS) await run(browser, vp, errors);
await browser.close();
if (errors.length) {
  console.log('console errors:');
  errors.forEach(e => console.log('  ' + e));
}
