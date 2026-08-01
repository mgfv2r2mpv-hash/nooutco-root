import { test, expect } from '@playwright/test';

/**
 * ════════════════════════════════════════════════════════════════════════
 * think-or-say: the maintainer's clinical review of the card decks
 *
 * A BCBA read all 81 cards and annotated 22 of them. His annotations are
 * rulings, and this file is where the rulings become assertions so a later edit
 * cannot quietly undo one.
 *
 * Two of them generalise past the cards he happened to mark, and are asserted
 * over the WHOLE deck rather than card by card:
 *
 *   1. No situation may state what another person THINKS or KNOWS. A learner
 *      standing on a playground cannot observe a mind, so a card that hands
 *      them one is asking for an inference it never made available — his note
 *      on L2-18, "how do we know what the classmate thinks?".
 *
 *   2. No situation may open with the stock phrase "It is true". His note on
 *      L2-14 and L2-15: the truth-is-not-the-test dimension has to be carried
 *      by what the card describes, not by a lead-in bolted to the front of it.
 *      A card that announces its own criterial feature teaches the announcement.
 *
 * The rest is a table: the specific cards he rejected, and what each one has to
 * say or stop saying for his note to be answered.
 * ════════════════════════════════════════════════════════════════════════
 */

const URL = '/think-or-say/';

async function booted(page) {
  await expect(page.locator('#sel-category option').first()).toHaveText('All categories');
}

async function allCards(page) {
  return page.evaluate(() => window.__thinkOrSay.cards);
}

/**
 * Phrases that assert another person's mental state. The learner is being
 * taught to notice what is observable; a situation that reports a thought has
 * given them a fact no child could have.
 */
const MIND_READING = [
  'think nobody',
  'thinks nobody',
  'when they think',
  'when he thinks',
  'when she thinks',
  'thinks that',
  'knows that',
];

/**
 * The rejected cards, and what answers the note. `features` is asserted as a
 * subset of the card's declared criterial features, so a card may carry more.
 */
const REWRITTEN = {
  // "wrong moment too. muddy shoes outside is when one expects to see them.
  //  this is not helpful here."
  'L1-14': {
    note: 'muddy shoes on a playground are expected, so there is nothing to notice',
    mustNotMatch: [/mud/i],
    features: { timing: 'wrong-moment', override: 'none' },
  },
  // "No idea who they are asking. Asking a peer who is doing their work? not
  //  ideal. See a teacher walk by or raise hand to ask teacher? better."
  'L1-18': {
    note: 'the situation must name who is being asked, and it is the teacher',
    mustMatch: [/teacher/i, /hand/i],
  },
  // "weird phrasing"
  'L1-20': {
    note: 'reads naturally aloud',
    mustNotMatch: [/it is true/i],
  },
  // "change reads to \"finishes reading\""
  'L1-30': {
    note: 'the teacher finishes reading before the laugh',
    mustMatch: [/finishes reading/i],
  },
  // "if the friend is showing you, i agree they wnat to talk but the coded
  //  items don't reflect that nuance."
  'L2-09': {
    note: 'the invitation has to be in the coding, not only in the prose',
    mustMatch: [/show/i],
    features: { relationship: 'close-friend', timing: 'right-moment' },
  },
  // "nothing on here even tells me that I think they are having a headache."
  'L2-12': {
    note: 'the headache has to be inferable from something observable',
    mustMatch: [/holding their head|hands on their head|head hurts/i],
  },
  // "The \"it is true\" lead in on this and L2-15 is weird"
  'L2-14': {
    note: 'truth carried by substance, not by a stock lead-in',
    mustNotMatch: [/it is true/i],
  },
  'L2-15': {
    note: 'truth carried by substance, not by a stock lead-in',
    mustNotMatch: [/it is true/i],
  },
  // "how do we know what the classmate thinks?"
  'L2-18': {
    note: 'only what the learner can observe',
    mustNotMatch: [/think/i],
  },
};

test.describe("the maintainer's rulings on the card decks", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await booted(page);
  });

  test('no card situation asserts what another person thinks or knows', async ({ page }) => {
    const cards = await allCards(page);
    const offenders = [];
    for (const c of cards) {
      const situation = c.situation.toLowerCase();
      for (const phrase of MIND_READING) {
        if (situation.includes(phrase)) offenders.push(`${c.id}: "${phrase}"`);
      }
    }
    expect(offenders, 'a learner cannot observe what another person thinks').toEqual([]);
  });

  test('no card situation opens with the stock phrase "It is true"', async ({ page }) => {
    const cards = await allCards(page);
    const offenders = cards
      .filter(c => /^\s*it is true\b/i.test(c.situation))
      .map(c => `${c.id}: "${c.situation.slice(0, 40)}..."`);
    expect(offenders, 'the card has to carry the truth in its substance').toEqual([]);
  });

  test('every rejected card now answers the note it was rejected for', async ({ page }) => {
    const cards = await allCards(page);
    const byId = Object.fromEntries(cards.map(c => [c.id, c]));

    for (const [id, want] of Object.entries(REWRITTEN)) {
      const card = byId[id];
      expect(card, `${id} still exists`).toBeTruthy();

      for (const re of want.mustMatch || []) {
        expect(card.situation, `${id} (${want.note}) should match ${re}`).toMatch(re);
      }
      for (const re of want.mustNotMatch || []) {
        expect(card.situation, `${id} (${want.note}) should not match ${re}`).not.toMatch(re);
      }
      for (const [dim, value] of Object.entries(want.features || {})) {
        expect(card.features[dim], `${id} (${want.note}) declares ${dim}=${value}`).toBe(value);
      }
    }
  });

  test('a label forced onto one half of a pair is carried by both halves', async ({ page }) => {
    const { levels } = await page.evaluate(() => ({
      levels: window.__thinkOrSay.levels.map(lv => ({ id: lv.id, cards: lv.cards, pairs: lv.pairs })),
    }));
    const byId = Object.fromEntries(levels.flatMap(l => l.cards).map(c => [c.id, c]));

    // Rewriting a card is allowed to change what it says. It is not allowed to
    // change which side of its pair it holds down.
    const ANSWERS = {
      'L1-14': 'think', 'L1-18': 'say', 'L1-20': 'think', 'L1-30': 'say',
      'L2-09': 'say', 'L2-12': 'say', 'L2-14': 'think', 'L2-15': 'say', 'L2-18': 'say',
    };
    for (const [id, answer] of Object.entries(ANSWERS)) {
      expect(byId[id].answer, `${id} keeps its answer`).toBe(answer);
    }

    const pairIds = new Set(levels.flatMap(l => l.pairs).flatMap(p => [p.a, p.b]));
    for (const id of ['L1-14', 'L2-09', 'L2-12', 'L2-14', 'L2-15']) {
      expect(pairIds.has(id), `${id} is still one half of a matched pair`).toBe(true);
    }

    // A criterial label cannot be added to one card on its own: the pair only
    // survives if its partner carries the same KEY. These two pairs gained
    // `timing` because the rulings on L1-14 ("wrong moment too") and L2-09 ("the
    // coded items don't reflect that nuance") required it, so the partner had to
    // take a value that keeps exactly one dimension differing.
    const FORCED = [
      { a: 'L1-13', b: 'L1-14', key: 'timing', value: 'wrong-moment' },
      { a: 'L2-08', b: 'L2-09', key: 'timing', value: 'right-moment' },
    ];
    for (const { a, b, key, value } of FORCED) {
      expect(byId[a].features[key], `${a} carries ${key}`).toBe(value);
      expect(byId[b].features[key], `${b} carries ${key}`).toBe(value);
      expect(Object.keys(byId[a].features).sort(), `${a}/${b} turn on the same dimensions`)
        .toEqual(Object.keys(byId[b].features).sort());
      const differing = Object.keys(byId[a].features)
        .filter(k => byId[a].features[k] !== byId[b].features[k]);
      expect(differing.length, `${a}/${b} still differ on exactly one feature`).toBe(1);
      expect(differing[0], `${a}/${b} do not flip on the label that was added`).not.toBe(key);
    }
  });
});
