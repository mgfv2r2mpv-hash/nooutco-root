/**
 * Playtest driver — runs a full 5-round Snack Quest at two viewports and
 * screenshots every stage, so the result can be looked at rather than reasoned
 * about. Not a spec; run it by hand against a live server:
 *
 *   npx wrangler pages dev . --port 8799
 *   node tests/_shots-snack-quest.mjs [baseURL] [outDir]
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const BASE = process.argv[2] || 'http://localhost:8799';
const OUT = process.argv[3] || 'test-results/shots-snack-quest';

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '768', width: 768, height: 1024 },
];

const SETTINGS_KEY = 'nooutco.settings.snackQuest';
const RESULTS_KEY = 'nooutco.results.snackQuest';
const TOKENS_KEY = 'noaba.tokens.snackQuest.v1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function seed(page, { scheduleValue = 2, goalTokens = 5 } = {}) {
  await page.addInitScript(
    ({ scheduleValue, goalTokens, SETTINGS_KEY, RESULTS_KEY, TOKENS_KEY }) => {
      localStorage.removeItem(RESULTS_KEY);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        working: { topic: 'T_animals', arraySize: 3, speak: false, targetFilters: {}, tokensSeeded: true },
      }));
      localStorage.setItem(TOKENS_KEY, JSON.stringify({
        enabled: true, scheduleType: 'FR', scheduleValue,
        startingTokens: 0, goalTokens, tokenEmoji: '⭐',
      }));
    },
    { scheduleValue, goalTokens, SETTINGS_KEY, RESULTS_KEY, TOKENS_KEY }
  );
}

const peek = (page) => page.evaluate(() => window.__sq.peek());

async function respondCorrect(page) {
  if (await page.locator('#score-row').isVisible()) {
    await page.click('.score-btn[data-score="correct"]');
    return;
  }
  const { correctIndex } = await peek(page);
  await page.click(`#trial-grid .pick[data-index="${correctIndex}"]`);
}

async function waitIdle(page) {
  await page.waitForFunction(() => !window.__sq.peek().busy, null, { timeout: 25000 });
}

async function run(browser, vp, errors) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${vp.name}] console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${vp.name}] pageerror: ${e}`));

  const shot = (name) => page.screenshot({ path: `${OUT}/${vp.name}-${name}.png` });

  await seed(page, { scheduleValue: 2, goalTokens: 5 });
  await page.goto(`${BASE}/snack-quest/`);
  await page.waitForFunction(() => !!window.__sq);
  await sleep(500);
  await shot('01-task');

  await page.click('#task-tiles .choice-tile[data-task="matching"]');
  await sleep(600);
  await shot('02-place');

  await page.click('#place-tiles .choice-tile[data-place="countryside"]');
  await page.waitForFunction(() => window.__sq.peek().screen === 'quest');
  await sleep(900);
  await shot('03-trial-matching');

  // Round 1 — non-delivering under FR2: card leaves, he walks partway.
  await respondCorrect(page);
  await page.waitForFunction(() => document.getElementById('trial-card').hidden);
  await sleep(350);
  await shot('04-walking');
  await waitIdle(page);
  await sleep(400);
  await shot('05-partway');

  // Round 2 — delivering: he arrives and the snack is collected.
  await respondCorrect(page);
  await waitIdle(page);
  await sleep(400);
  await shot('06-collected');

  // Grind out the rest of the quest.
  for (let i = 0; i < 24; i++) {
    if (await page.locator('#screen-done').isVisible()) break;
    await respondCorrect(page);
    await waitIdle(page);
  }
  await sleep(1200);
  await shot('07-done');

  // Other two tasks, so the trial surfaces get looked at too.
  await page.click('#btn-play-again');
  await sleep(300);
  await page.click('#task-tiles .choice-tile[data-task="receptive"]');
  await sleep(300);
  await page.click('#place-tiles .choice-tile[data-place="playroom"]');
  await page.waitForFunction(() => window.__sq.peek().screen === 'quest');
  await sleep(900);
  await shot('08-trial-receptive');

  await page.click('#btn-abandon');
  await sleep(300);
  await page.click('#task-tiles .choice-tile[data-task="expressive"]');
  await sleep(300);
  await page.click('#place-tiles .choice-tile[data-place="sky"]');
  await page.waitForFunction(() => window.__sq.peek().screen === 'quest');
  await sleep(900);
  await shot('09-trial-expressive');

  await respondCorrect(page);
  await waitIdle(page);
  await sleep(300);
  await shot('10-sky-scene');

  await page.click('#btn-abandon');
  await sleep(300);
  await page.click('#task-tiles .choice-tile[data-task="matching"]');
  await sleep(200);
  await page.click('#place-tiles .choice-tile[data-place="party"]');
  await page.waitForFunction(() => window.__sq.peek().screen === 'quest');
  await sleep(1000);
  await page.locator('#trial-card').evaluate((n) => { n.hidden = true; });
  await sleep(200);
  await shot('11-party-scene');

  await ctx.close();
}

const browser = await chromium.launch();
const errors = [];
await mkdir(OUT, { recursive: true });
for (const vp of VIEWPORTS) await run(browser, vp, errors);
await browser.close();

if (errors.length) {
  console.error('CONSOLE ERRORS:\n' + errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log('No console errors.');
}
console.log('Screenshots in ' + OUT);
