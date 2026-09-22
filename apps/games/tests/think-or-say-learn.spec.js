// @ts-check
/**
 * Think or Say? - the Learn screen and the end-of-session rule badges.
 *
 * The Learn screen follows the Teaching Interaction Procedure (Leaf et al.
 * 2012): label the skill, give a short reason, show an example. So it is the
 * Why ladder's tiers, top to bottom, each with its questions and one line of
 * why, then one Level 1 matched pair side by side (Horner, Albin & Ralph 1986).
 * The tiers are rendered FROM the model, so this spec checks them against
 * WHY_TIERS rather than against copy typed into the spec.
 *
 * The done card then shows the rules that decided the cards answered right on
 * the first try, as small badges, counted off the Why ladder's deciding row.
 */
import { test, expect } from '@playwright/test';

const URL = '/think-or-say/';
const STORE = 'nooutco.settings.think-or-say';

async function seed(page, working) {
  await page.addInitScript((args) => {
    localStorage.setItem(args.key, JSON.stringify({ working: args.cfg }));
  }, { key: STORE, cfg: working });
}

async function booted(page) {
  await expect(page.locator('#sel-category option').first()).toHaveText('All categories');
}

const plain = (level, over = {}) => ({
  level, category: 'all', order: 'sequential',
  showReason: true, represent: false, errorless: false,
  autoPrompt: false, counterbalance: false,
  ...over,
});

const session = page => page.evaluate(() => window.__thinkOrSay.session());

test('the Learn screen shows one tier card per WHY_TIERS entry, in order', async ({ page }) => {
  await seed(page, plain(1));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-learn').click();
  await expect(page.locator('#learn-screen')).toBeVisible();

  const tiers = await page.evaluate(() => window.__thinkOrSay.whyTiers);
  const cards = page.locator('#learn-ladder .learn-tier');
  await expect(cards).toHaveCount(tiers.length);
  for (let i = 0; i < tiers.length; i++) {
    await expect(cards.nth(i)).toHaveAttribute('data-key', tiers[i].key);
    await expect(cards.nth(i).locator('.learn-tier-name')).toHaveText(tiers[i].label);
    // Every tier states its one-line reason, from the model.
    expect(tiers[i].why, `tier ${tiers[i].key} carries a why line`).toBeTruthy();
    await expect(cards.nth(i).locator('.learn-tier-why')).toHaveText(tiers[i].why);
    await expect(cards.nth(i).locator('.learn-q').first()).toBeVisible();
  }
  await expect(page.locator('.learn-wins')).toContainText('Higher rules win');
  await expect(page.locator('#btn-learn-start')).toBeVisible();
});

test('the Learn screen shows a Level 1 pair with opposite answers and the chip that flipped', async ({ page }) => {
  await seed(page, plain(1));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-learn').click();

  const sides = page.locator('#learn-pair .learn-side');
  await expect(sides).toHaveCount(2);
  const answers = await sides.evaluateAll(els => els.map(e => e.getAttribute('data-answer')));
  expect(answers.sort()).toEqual(['say', 'think']);
  await expect(sides.nth(0).locator('.tag')).not.toHaveText(await sides.nth(1).locator('.tag').innerText());

  // The pair is one the level declares, and both chips name the flipped dimension.
  const ids = await sides.evaluateAll(els => els.map(e => e.getAttribute('data-card')));
  const pair = await page.evaluate(([a, b]) => window.__thinkOrSay.level(1).pairs
    .find(p => p.a === a && p.b === b), ids);
  expect(pair, 'the example is a declared Level 1 pair').toBeTruthy();
  const dims = await page.locator('#learn-pair .learn-flip-chip')
    .evaluateAll(els => els.map(e => e.getAttribute('data-dim')));
  expect(dims).toEqual([pair.flips, pair.flips]);
  const chips = await page.locator('#learn-pair .learn-flip-chip').allInnerTexts();
  expect(chips[0]).not.toBe(chips[1]);
});

test('the Learn screen fits a 390px phone with no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, plain(1));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-learn').click();
  await expect(page.locator('#learn-ladder .learn-tier').first()).toBeVisible();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // Stacked on a phone: the second side sits below the first.
  const [a, b] = await page.locator('#learn-pair .learn-side').evaluateAll(els =>
    els.map(e => e.getBoundingClientRect().top));
  expect(b).toBeGreaterThan(a);
});

test('the done card shows the rules that decided first-try cards, as badges', async ({ page }) => {
  // The smallest Level 1 category keeps the session short.
  await page.goto(URL);
  await booted(page);
  const cat = await page.evaluate(() => {
    const counts = {};
    window.__thinkOrSay.level(1).cards.forEach(c => { counts[c.cat] = (counts[c.cat] || 0) + 1; });
    return Object.entries(counts).sort((x, y) => x[1] - y[1])[0][0];
  });
  await seed(page, plain(1, { category: cat }));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();

  const deck = (await session(page)).deck;
  for (let i = 0; i < deck.length; i++) {
    await page.locator('#reveal-panel').click();
    await page.locator(`#choices .choice[data-answer="${deck[i].answer}"]`).click();
    await page.locator('#btn-next').click();
  }

  const done = page.locator('#done-card');
  await expect(done).toBeVisible();
  await expect(done.locator('#btn-again')).toBeVisible();
  const badges = done.locator('.rule-badge');
  expect(await badges.count()).toBeGreaterThan(0);

  // The badge counts are the deciding rows of the cards played, nothing else.
  const expected = await page.evaluate(() => {
    const T = window.__thinkOrSay;
    const out = {};
    T.session().deck.forEach(d => {
      const c = T.cards.find(x => x.id === d.id);
      const row = T.whyLadder(c).find(r => r.decides);
      if (row) out[row.dim] = (out[row.dim] || 0) + 1;
    });
    return out;
  });
  const shown = await badges.evaluateAll(els => Object.fromEntries(
    els.map(e => [e.getAttribute('data-dim'), Number(e.getAttribute('data-count'))])));
  expect(shown).toEqual(expected);
  // Ordered by count, most first.
  const counts = Object.values(await badges.evaluateAll(els =>
    els.map(e => Number(e.getAttribute('data-count')))));
  expect(counts).toEqual([...counts].sort((x, y) => y - x));
});
