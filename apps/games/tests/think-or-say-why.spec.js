// @ts-check
/**
 * Think or Say? - the Why ladder.
 *
 * After a correct answer the bare reason line grew into a small panel: the
 * verdict and the card's own reason, then only the rules IN PLAY on the card,
 * ordered by the hierarchy (safety, kind, where and when, who, true), with the
 * rule that decides it marked and any rule pulling the other way struck as
 * outranked. It is a support, gated exactly as the reason line was:
 *   * shown after a correct answer when "Show Reason After" is on;
 *   * withheld on a probe trial;
 *   * at Level 3, withheld until the technician scores the spoken reason (or
 *     reveals the exemplars) - before that it is the answer sheet.
 * A card in a matched minimum-difference pair also shows its partner as
 * "Flip it:".
 *
 * Cards are picked by what the ladder will show, never by hard-coded id, so
 * the three pool files can grow without this spec going stale.
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

async function chooseTile(page, i) {
  const deck = (await session(page)).deck;
  await page.locator('#reveal-panel').click();
  await expect(page.locator('#choices')).toBeVisible();
  await page.locator(`#choices .choice[data-answer="${deck[i].answer}"]`).click();
}

/** Deck position of the first sequential card that meets `pred`, found in the page. */
async function firstWhere(page, level, predSrc) {
  return page.evaluate(([lv, src]) => {
    const pred = new Function('card', 'rows', 'pairs', 'return (' + src + ')(card, rows, pairs);');
    const T = window.__thinkOrSay;
    const L = T.level(lv);
    return L.cards.findIndex(c => pred(c, T.whyLadder(c), L.pairs));
  }, [level, predSrc]);
}

/** Answer cards 0..i-1 correctly and advance, so card i is on screen. */
async function advanceTo(page, i) {
  for (let k = 0; k < i; k++) {
    await chooseTile(page, k);
    await page.locator('#btn-next').click();
  }
}

test('a correct Level 1 answer shows one ladder row per rule in play', async ({ page }) => {
  await seed(page, plain(1));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();

  await expect(page.locator('#why-panel')).toBeHidden();
  await chooseTile(page, 0);

  const card = await page.evaluate(() => window.__thinkOrSay.level(1).cards[0]);
  const panel = page.locator('#why-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('aria-label', /why/i);
  await expect(page.locator('#scenario-reason')).toHaveText(card.reason);
  await expect(page.locator('#why-verdict')).toHaveText(card.answer === 'think' ? 'THINK IT' : 'SAY IT');

  const dims = await page.locator('#why-rows > li').evaluateAll(els => els.map(e => e.dataset.dim));
  expect(dims.sort()).toEqual(Object.keys(card.features).sort());

  // Ordered by tier, top rule first.
  const tiers = await page.locator('#why-rows > li').evaluateAll(els => els.map(e => Number(e.dataset.tier)));
  expect(tiers).toEqual([...tiers].sort((a, b) => a - b));

  // Exactly one row decides it, and every row prints its answer in words.
  await expect(page.locator('#why-rows .is-decider')).toHaveCount(1);
  await expect(page.locator('#why-rows .is-decider .why-mark')).toHaveText('decides it');
  const leans = await page.locator('#why-rows .why-lean').allTextContents();
  for (const t of leans) expect(t).toMatch(/THINK|SAY|either way/);

  // The tier legend lights the tiers this card touches, and only those.
  const lit = await page.locator('#why-tiers .why-tier.is-lit').count();
  expect(lit).toBe(new Set(tiers).size);
});

test('a rule that pulls the other way is shown struck as outranked', async ({ page }) => {
  await seed(page, plain(1));
  await page.goto(URL);
  await booted(page);
  const i = await firstWhere(page, 1, '(c, rows) => rows.some(r => r.outranked)');
  expect(i, 'Level 1 holds a card where a lower rule is outranked').toBeGreaterThanOrEqual(0);

  await page.locator('#btn-play').click();
  await advanceTo(page, i);
  await chooseTile(page, i);

  const expected = await page.evaluate(n => {
    const T = window.__thinkOrSay;
    return T.whyLadder(T.level(1).cards[n]).filter(r => r.outranked).map(r => r.dim);
  }, i);
  const out = page.locator('#why-rows .is-outranked');
  await expect(out).toHaveCount(expected.length);
  await expect(out.first().locator('.why-mark')).toHaveText('outranked');
  // The losing rule leans the OTHER way, and says so in words.
  const card = (await session(page)).deck[i];
  const other = card.answer === 'think' ? 'SAY' : 'THINK';
  await expect(out.first().locator('.why-lean')).toContainText(other);
  // And it sits below the rule that decided it.
  const order = await page.locator('#why-rows > li').evaluateAll(els =>
    els.map(e => e.classList.contains('is-decider') ? 'D' : e.classList.contains('is-outranked') ? 'O' : '-').join(''));
  expect(order.indexOf('D')).toBeLessThan(order.indexOf('O'));
});

test('a paired card shows its minimum-difference partner as Flip it', async ({ page }) => {
  await seed(page, plain(1));
  await page.goto(URL);
  await booted(page);
  const i = await firstWhere(page, 1, '(c, rows, pairs) => pairs.some(p => p.a === c.id || p.b === c.id)');
  expect(i).toBeGreaterThanOrEqual(0);
  const { partner, flips } = await page.evaluate(n => {
    const L = window.__thinkOrSay.level(1);
    const c = L.cards[n];
    const p = L.pairs.find(x => x.a === c.id || x.b === c.id);
    const other = L.cards.find(x => x.id === (p.a === c.id ? p.b : p.a));
    return { partner: other, flips: p.flips };
  }, i);

  await page.locator('#btn-play').click();
  await advanceTo(page, i);
  await chooseTile(page, i);

  const flip = page.locator('#why-flip');
  await expect(flip).toBeVisible();
  await expect(flip).toContainText('Flip it:');
  await expect(flip.locator('.tag')).toHaveText(partner.answer === 'think' ? 'THINK IT' : 'SAY IT');
  const shown = await flip.locator('.why-flip-text').textContent();
  expect(shown.length).toBeLessThanOrEqual(91);
  expect(partner.situation.startsWith(shown.replace(/…$/, ''))).toBe(true);
  // The flipped rule is the one highlighted in the ladder.
  await expect(page.locator(`#why-rows li[data-dim="${flips}"]`)).toHaveClass(/is-flip-dim/);
});

test('a probe trial shows no ladder', async ({ page }) => {
  await seed(page, plain(1, {
    probes1: true, probeCount1: 1, probePlacement1: 'before',
  }));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();
  const deck = (await session(page)).deck;
  expect(deck[0].isProbe).toBe(true);

  await chooseTile(page, 0);
  await expect(page.locator('#btn-next')).toBeVisible();
  await expect(page.locator('#why-panel')).toBeHidden();
  await expect(page.locator('#why-rows > li')).toHaveCount(0);

  // The teaching trial after it keeps the support.
  await page.locator('#btn-next').click();
  await chooseTile(page, 1);
  await expect(page.locator('#why-panel')).toBeVisible();
});

test('at Level 3 the ladder waits until the spoken reason is scored', async ({ page }) => {
  await seed(page, plain(3));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();

  await chooseTile(page, 0);
  await expect(page.locator('#rationale-panel')).toBeVisible();
  await expect(page.locator('#why-panel')).toBeHidden();

  await page.locator('#rationale-scores button[data-score="partial"]').click();
  await expect(page.locator('#why-panel')).toBeVisible();
  await expect(page.locator('#why-rows .is-decider')).toHaveCount(1);
});

test('a Level 3 probe still withholds the ladder after scoring', async ({ page }) => {
  await seed(page, plain(3, {
    probes3: true, probeCount3: 1, probePlacement3: 'before',
  }));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();
  expect((await session(page)).deck[0].isProbe).toBe(true);

  await chooseTile(page, 0);
  await page.locator('#rationale-scores button[data-score="correct"]').click();
  await expect(page.locator('#btn-next')).toBeVisible();
  await expect(page.locator('#why-panel')).toBeHidden();
});

test('the ladder fits a phone without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seed(page, plain(1));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();
  await chooseTile(page, 0);
  await expect(page.locator('#why-panel')).toBeVisible();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await page.locator('#why-panel').boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
});
