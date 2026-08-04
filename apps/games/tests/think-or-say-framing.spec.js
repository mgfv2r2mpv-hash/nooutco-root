import { test, expect } from '@playwright/test';

/**
 * ════════════════════════════════════════════════════════════════════════
 * think-or-say: card framing and tile position
 *
 * The card used to render `You think: "<utterance>"`. That lead-in names one
 * of the two actions, and names it in the stem of the THINK IT tile - so a
 * learner tracking only the salient word answers every card correctly without
 * contacting the rule the programme is teaching, and the data says he has
 * mastered it. (RESEARCH.md, "Card framing"; Song et al. 2021, JABA.)
 *
 * A card now presents: the situation, a lead-in naming NEITHER action, the
 * candidate utterance, and a question naming BOTH actions in the card's own
 * verb pair. The question is GENERATED from the card's verb pair, so a card
 * whose question names only one action cannot be authored - these tests walk
 * the entire card set and assert that from the data, not card by card through
 * the UI.
 *
 * Tile LABELS stay THINK IT / SAY IT on every card: the response topography
 * must not change trial to trial. Only the tile POSITIONS counterbalance, and
 * only when the setting is on.
 * ════════════════════════════════════════════════════════════════════════
 */

const URL = '/think-or-say/';

/** Seed the settings store before the page's own boot reads it. */
async function seed(page, working) {
  await page.addInitScript((cfg) => {
    localStorage.setItem('nooutco.settings.think-or-say', JSON.stringify({ working: cfg }));
  }, working);
}

/**
 * The category select is EMPTY in the HTML - populateCategories() builds it in
 * the same synchronous init() that then loads the settings, so its first option
 * appearing is the signal that the stored configuration is in force.
 */
async function booted(page) {
  await expect(page.locator('#sel-category option').first()).toHaveText('All categories');
}

/** The authored deck, as the game itself holds it. */
async function cards(page) {
  return page.evaluate(() => window.__thinkOrSay.cards);
}

// ── The whole card set, from the data ──────────────────────────────────────

test.describe('every card, from the data', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await booted(page);
  });

  /**
   * The defect is a lead-in that names ONE action. The balanced question
   * unavoidably contains the words "you THINK" - "Should you THINK these
   * words, or SAY these words?" - and that is not the defect: it names the
   * other action in the same breath, in the same phrase, at the same length.
   * So the prose is held to "never says you think", and the card as a whole is
   * held to "never carries the `You think:` lead-in the base build shipped".
   */
  test('no card\'s prose says "you think", and no card carries the old lead-in', async ({ page }) => {
    const set = await cards(page);
    expect(set.length, 'the deck is not empty').toBeGreaterThan(0);

    const prose = set
      .filter(c => ['leadIn', 'situation', 'utterance', 'reason']
        .some(field => /you think/i.test(c[field])))
      .map(c => c.id);
    expect(prose, 'cards whose own prose gives the answer away').toEqual([]);

    const leadIns = set
      .filter(c => [c.leadIn, c.situation, c.utterance, c.question, c.reason]
        .join(' ').includes('You think:'))
      .map(c => c.id);
    expect(leadIns, 'cards still carrying the "You think:" lead-in').toEqual([]);
  });

  test('every card carries the lead-in, and it names neither action', async ({ page }) => {
    const set = await cards(page);
    for (const c of set) {
      expect(c.leadIn, `card ${c.id} lead-in`).toBe('You have a thought:');
    }
    // "THINK"/"SAY"/"ASK"/"TELL" must not appear in the lead-in in any form.
    const leadIn = set[0].leadIn.toLowerCase();
    for (const verb of ['think', 'say', 'ask', 'tell']) {
      expect(leadIn.includes(verb), `the lead-in names "${verb}"`).toBe(false);
    }
  });

  test('every card question names BOTH actions, in the card\'s own verb pair', async ({ page }) => {
    const set = await cards(page);
    const verbs = await page.evaluate(() => window.__thinkOrSay.sayVerbs);
    expect(verbs).toEqual(['say', 'ask', 'tell']);

    for (const c of set) {
      const spoken = c.sayVerb.toUpperCase();
      expect(verbs, `card ${c.id} verb`).toContain(c.sayVerb);
      expect(c.question, `card ${c.id} names THINK`).toContain('THINK');
      expect(c.question, `card ${c.id} names ${spoken}`).toContain(spoken);
      // Both halves are the same phrase, so neither action is the longer or the
      // more elaborated option on the page.
      expect(c.question.split(c.object).length - 1, `card ${c.id} object phrase, twice`).toBe(2);
      expect(c.question).toBe(`Should you THINK ${c.object}, or ${spoken} ${c.object}?`);
    }
  });

  test('the question generator names both actions for every verb it offers', async ({ page }) => {
    const built = await page.evaluate(() => {
      const { sayVerbs, balancedQuestion } = window.__thinkOrSay;
      return sayVerbs.map(v => balancedQuestion({ sayVerb: v, object: 'this question' }));
    });
    expect(built).toEqual([
      'Should you THINK this question, or SAY this question?',
      'Should you THINK this question, or ASK this question?',
      'Should you THINK this question, or TELL this question?',
    ]);
  });
});

// ── The rendered card ──────────────────────────────────────────────────────

test('the rendered card shows the lead-in and the balanced question, not "You think:"', async ({ page }) => {
  await seed(page, { category: 'all', order: 'sequential' });
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();

  const thought = page.locator('#scenario-thought');
  await expect(thought).toBeVisible();
  await expect(thought).toContainText('You have a thought:');
  await expect(thought, 'the one-sided lead-in is gone').not.toContainText('You think');
  await expect(thought.locator('.lead-in')).toHaveText('You have a thought:');
  await expect(page.locator('#scenario-card')).not.toContainText('You think:');

  const question = page.locator('#scenario-question');
  await expect(question).toBeVisible();
  await expect(question).toContainText('THINK');
  await expect(question).toContainText(/SAY|ASK|TELL/);

  // And the card the learner sees matches the card the game holds.
  const first = (await cards(page))[0];
  await expect(question).toHaveText(first.question);
  await expect(page.locator('#scenario-situation')).toHaveText(first.situation);
});

// ── Tile positions ─────────────────────────────────────────────────────────

/** Walk `n` trials, answering each correctly, and report the tile order seen. */
async function tileOrderOverTrials(page, n) {
  // These runs seed `order: sequential` and leave the level at its default, so
  // the deck IS Level 1's authored pool in its authored order.
  const answers = await page.evaluate(() =>
    window.__thinkOrSay.level(1).cards.map(c => c.answer));
  const seen = [];
  for (let i = 0; i < n; i++) {
    await page.locator('#reveal-panel').click();
    await expect(page.locator('#choices')).toBeVisible();
    seen.push(await page.locator('#choices .choice')
      .evaluateAll(els => els.map(e => e.dataset.answer)));
    // The labels are part of the topography: they must not travel with the tile.
    await expect(page.locator('#choices .choice[data-answer="think"] .choice-label'))
      .toHaveText('THINK IT');
    await expect(page.locator('#choices .choice[data-answer="say"] .choice-label'))
      .toHaveText('SAY IT');
    await page.locator(`#choices .choice[data-answer="${answers[i]}"]`).click();
    await page.locator('#btn-next').click();
  }
  return seen;
}

test('tile positions counterbalance between trials when the setting is on', async ({ page }) => {
  await seed(page, { category: 'all', order: 'sequential', counterbalance: true, showReason: false });
  await page.goto(URL);
  await booted(page);
  await expect(page.locator('#chk-counterbalance')).toBeChecked();

  await page.locator('#btn-play').click();
  expect(await tileOrderOverTrials(page, 4)).toEqual([
    ['think', 'say'],
    ['say', 'think'],
    ['think', 'say'],
    ['say', 'think'],
  ]);
});

test('tile positions stay fixed when the setting is off', async ({ page }) => {
  await seed(page, { category: 'all', order: 'sequential', counterbalance: false, showReason: false });
  await page.goto(URL);
  await booted(page);
  await expect(page.locator('#chk-counterbalance')).not.toBeChecked();

  await page.locator('#btn-play').click();
  expect(await tileOrderOverTrials(page, 4)).toEqual([
    ['think', 'say'],
    ['think', 'say'],
    ['think', 'say'],
    ['think', 'say'],
  ]);
});

test('the counterbalance switch is persisted, and defaults on', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  await expect(page.locator('#chk-counterbalance'), 'defaults on').toBeChecked();

  // The switch lives in the collapsed ⚙ Settings panel.
  await page.locator('#btn-extra-toggle').click();
  await expect(page.locator('#extra-panel')).toBeVisible();
  await page.locator('#chk-counterbalance').uncheck();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('nooutco.settings.think-or-say') || '{}'));
  expect(stored.working.counterbalance).toBe(false);
});
