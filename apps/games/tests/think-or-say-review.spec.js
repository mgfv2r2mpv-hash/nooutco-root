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

/**
 * His label calls, verbatim, as a table of id -> the criterial labels the card
 * has to declare. These are RULINGS: a card may carry more than the table asks
 * for, never less, so each entry is asserted as a subset of the card's declared
 * features.
 */
const REQUIRED_LABELS = {
  'L1-04': { note: 'self-esteem: lifts as well', features: { selfEsteem: 'lifts' } },
  'L1-07': { note: 'Also safety-related (an undone lace is a trip hazard)',
             features: { override: 'help-or-safety' } },
  'L1-21': { note: 'self-esteem: hurts', features: { selfEsteem: 'hurts' } },
  'L1-24': { note: 'is is also not help-or-safety', features: { override: 'none' } },
  'L1-28': { note: 'who: close-friend', features: { relationship: 'close-friend' } },
  'L2-03': { note: 'and others can hear, and it is not fixable',
             features: { audience: 'others-hear', changeability: 'not-fixable' } },
  'L2-04': { note: 'also help-or safety', features: { override: 'help-or-safety' } },
  'L2-06': { note: 'self-esteeme: hurts', features: { selfEsteem: 'hurts' } },
  'L2-16': { note: 'also not fixable, and liking is not help or safety',
             features: { changeability: 'not-fixable', override: 'none' } },
  'L2-19': { note: 'and not fixable right now', features: { changeability: 'not-fixable' } },
  'L2-22': { note: 'not fixable, either', features: { changeability: 'not-fixable' } },
  'L2-24': { note: 'not changeable in that moment', features: { changeability: 'not-fixable' } },
  'L2-25': { note: 'never met is a stranger', features: { relationship: 'stranger' } },
};

/**
 * The systematic finding behind them — "A lot of these are missing cross
 * labels". These are the labels the Level 1 audit added because the card's own
 * REASON names them: a technician debriefing the card would say "it is true and
 * true is not the test", or "they cannot change their lunch now", so the card
 * has to declare it. Pinned here so a later edit cannot quietly thin the
 * coverage matrix back out.
 */
const AUDIT_LABELS = {
  'L1-03': { selfEsteem: 'lifts', privacy: 'private' },
  'L1-17': { audience: 'others-hear' },
  'L1-18': { timing: 'right-moment' },
  'L1-19': { timing: 'right-moment' },
  'L1-20': { audience: 'others-hear' },
  'L1-21': { truthNotTest: 'true' },
  'L1-25': { changeability: 'not-fixable', truthNotTest: 'true' },
  'L1-27': { truthNotTest: 'true' },
  'L1-29': { truthNotTest: 'true' },
  'L1-30': { timing: 'right-moment' },
  'L1-32': { relationship: 'close-friend' },
  'L1-33': { selfEsteem: 'lifts' },
  // Level 2. The same test applied pool by pool: the card's reason names the
  // dimension, so the card declares it.
  'L2-03': { selfEsteem: 'hurts' },
  'L2-05': { privacy: 'not-private', selfEsteem: 'hurts' },
  'L2-07': { privacy: 'not-private', selfEsteem: 'hurts' },
  'L2-10': { changeability: 'fixable-now' },
  'L2-11': { changeability: 'fixable-now' },
  'L2-17': { selfEsteem: 'hurts' },
  'L2-20': { changeability: 'fixable-now', selfEsteem: 'hurts' },
  'L2-25': { changeability: 'not-fixable' },
  'L2-26': { selfEsteem: 'hurts' },
  'L2-28': { privacy: 'not-private', audience: 'others-hear' },
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

  test('no card situation carries the stock phrase "It is true"', async ({ page }) => {
    const cards = await allCards(page);
    // Not merely as an opening: L1-15 and L1-16 buried the identical device in
    // their second sentence ("It is true that your classmate has the fewest"),
    // which is the same card announcing its own criterial feature. The truth has
    // to be something the learner DID - counted the chart, watched the race.
    const offenders = cards
      .filter(c => /\bit is true\b/i.test(c.situation))
      .map(c => `${c.id}: "${c.situation.slice(0, 60)}..."`);
    expect(offenders, 'the card has to carry the truth in its substance').toEqual([]);
  });

  test('every card the maintainer relabelled declares the labels he called for', async ({ page }) => {
    const cards = await allCards(page);
    const byId = Object.fromEntries(cards.map(c => [c.id, c]));

    for (const [id, want] of Object.entries(REQUIRED_LABELS)) {
      expect(byId[id], `${id} still exists`).toBeTruthy();
      for (const [dim, value] of Object.entries(want.features)) {
        expect(byId[id].features[dim], `${id} ("${want.note}") declares ${dim}=${value}`)
          .toBe(value);
      }
    }
  });

  test('the cross-labels the audit found are still declared', async ({ page }) => {
    const cards = await allCards(page);
    const byId = Object.fromEntries(cards.map(c => [c.id, c]));

    for (const [id, features] of Object.entries(AUDIT_LABELS)) {
      expect(byId[id], `${id} still exists`).toBeTruthy();
      for (const [dim, value] of Object.entries(features)) {
        expect(byId[id].features[dim], `${id} declares ${dim}=${value}`).toBe(value);
      }
    }
  });

  test('a help-or-safety card is only ever half of an override pair', async ({ page }) => {
    const { levels } = await page.evaluate(() => ({
      levels: window.__thinkOrSay.levels.map(lv => ({ id: lv.id, cards: lv.cards, pairs: lv.pairs })),
    }));

    // The collision that moved L1-07 out of the audience pair, stated as an
    // invariant rather than as a comment. A pair's two halves must declare the
    // same criterial KEYS, and any card declaring override=help-or-safety must
    // answer SAY - so a partner carrying that key at that value could not be the
    // THINK half. The only pair a help-or-safety card can sit in is the one that
    // flips `override` itself.
    const wrong = [];
    for (const level of levels) {
      const byId = Object.fromEntries(level.cards.map(c => [c.id, c]));
      for (const pair of level.pairs) {
        for (const id of [pair.a, pair.b]) {
          if (byId[id].features.override === 'help-or-safety' && pair.dim !== 'override') {
            wrong.push(`level ${level.id}: ${id} is in the ${pair.dim} pair`);
          }
        }
      }
    }
    expect(wrong, 'help-or-safety can only be contrasted against no-override').toEqual([]);
  });

  test('L1-07 keeps the safety label, and the audience pair moved to carry it', async ({ page }) => {
    const { level1 } = await page.evaluate(() => {
      const lv = window.__thinkOrSay.levels.find(l => l.id === 1);
      return { level1: { cards: lv.cards, pairs: lv.pairs } };
    });
    const byId = Object.fromEntries(level1.cards.map(c => [c.id, c]));

    expect(byId['L1-07'].features.override, 'an undone lace is a trip hazard')
      .toBe('help-or-safety');
    expect(byId['L1-07'].answer, 'a safety card always answers SAY').toBe('say');

    const audience = level1.pairs.find(p => p.dim === 'audience');
    expect([audience.a, audience.b].includes('L1-07'),
      'L1-07 cannot hold the audience pair once it carries the override').toBe(false);
    // The pair that replaced it is still minimum difference: same fixability,
    // and only who can hear moves.
    const a = byId[audience.a];
    const b = byId[audience.b];
    expect(a.features.changeability, 'the audience pair holds changeability')
      .toBe(b.features.changeability);
    expect(a.features.audience).not.toBe(b.features.audience);
  });

  test('the Level 1 privacy pair holds self-esteem constant, and holds it at lifts', async ({ page }) => {
    const { level1 } = await page.evaluate(() => {
      const lv = window.__thinkOrSay.levels.find(l => l.id === 1);
      return { level1: { cards: lv.cards, pairs: lv.pairs } };
    });
    const byId = Object.fromEntries(level1.cards.map(c => [c.id, c]));
    const privacy = level1.pairs.find(p => p.dim === 'privacy');

    // "L1-04 self-esteem: lifts as well" could not be added to one half alone.
    // Holding it at `lifts` on BOTH halves is what let the label land, and it is
    // the better card for it: kind words can still be private words.
    for (const id of [privacy.a, privacy.b]) {
      expect(byId[id].features.selfEsteem, `${id} declares the lift`).toBe('lifts');
    }
  });

  test('L2-04 carries the safety label, and the privacy pair moved to carry it', async ({ page }) => {
    const { level2 } = await page.evaluate(() => {
      const lv = window.__thinkOrSay.levels.find(l => l.id === 2);
      return { level2: { cards: lv.cards, pairs: lv.pairs } };
    });
    const byId = Object.fromEntries(level2.cards.map(c => [c.id, c]));

    expect(byId['L2-04'].features.override, 'a sticker about to be lost is help')
      .toBe('help-or-safety');
    expect(byId['L2-04'].answer, 'a safety card always answers SAY').toBe('say');

    // Level 1's L1-07 collision, repeated exactly: the label costs the card its
    // pair, because no THINK half can carry the same key at the same value.
    const held = level2.pairs.filter(p => p.a === 'L2-04' || p.b === 'L2-04');
    expect(held.map(p => p.dim), 'L2-04 holds no pair but an override one')
      .toEqual([]);

    // And the pair that replaced it is minimum difference in prose as well as in
    // features: the same lunch table, the same quiet voice, the same thing they
    // could put right in a second.
    const privacy = level2.pairs.find(p => p.dim === 'privacy');
    const a = byId[privacy.a];
    const b = byId[privacy.b];
    expect(a.features.privacy).not.toBe(b.features.privacy);
    for (const key of ['audience', 'changeability', 'selfEsteem']) {
      expect(a.features[key], `the privacy pair holds ${key}`).toBe(b.features[key]);
    }
  });

  test('the self-esteem label he called for on L2-06 is carried by its whole cluster', async ({ page }) => {
    const { level2 } = await page.evaluate(() => {
      const lv = window.__thinkOrSay.levels.find(l => l.id === 2);
      return { level2: { cards: lv.cards, pairs: lv.pairs } };
    });
    const byId = Object.fromEntries(level2.cards.map(c => [c.id, c]));

    // "self-esteeme: hurts" lands on L2-06, and a criterial label cannot land on
    // one half of a pair. L2-05 anchors three pairs, so the ruling reaches four
    // cards: the sting is the same words on the same person every time, and what
    // moves is fixability, audience, or whether it was private to notice at all.
    for (const id of ['L2-05', 'L2-06', 'L2-07', 'L2-20']) {
      expect(byId[id].features.selfEsteem, `${id} carries the sting`).toBe('hurts');
    }
    const anchored = level2.pairs.filter(p => p.a === 'L2-05' || p.b === 'L2-05');
    expect(anchored.map(p => p.dim).sort(), 'L2-05 anchors three contrasts')
      .toEqual(['audience', 'changeability', 'privacy']);
  });

  test('L2-25 says in its reason why a stranger is another reason to stay quiet', async ({ page }) => {
    const cards = await allCards(page);
    const card = cards.find(c => c.id === 'L2-25');

    // "never met is a stranger, so taht is another reason to not ask...". The
    // relationship was labelled all along; his point is that a card teaches what
    // its reason says, and the reason never said it.
    expect(card.features.relationship).toBe('stranger');
    expect(card.reason, 'the reason names the relationship it is labelled with')
      .toMatch(/stranger/i);
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
