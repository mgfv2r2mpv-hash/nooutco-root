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
 *      them one is asking for an inference it never made available - his note
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
 * The systematic finding behind them - "A lot of these are missing cross
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
  'L1-21': { truthRank: 'true' },
  'L1-25': { changeability: 'not-fixable', truthRank: 'true' },
  'L1-27': { truthRank: 'true' },
  'L1-29': { truthRank: 'true' },
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
  // Level 3, the last pool audited and the one that needed it most: all
  // eighteen cards went to review declaring exactly two criterial features. The
  // labels below are the ones each card's own reason was already leaning on -
  // the reading pair is "true and it hurts" against "true and it lifts", the
  // lunch-table cluster is three not-private things that turn on fixability and
  // audience, and the two override cards are heard by the whole class either
  // way. Only the ADDED labels are listed; the card's original two still stand.
  'L3-01': { truthRank: 'true' },
  'L3-02': { truthRank: 'true' },
  'L3-03': { relationship: 'close-friend', truthRank: 'true' },
  'L3-04': { relationship: 'close-friend', truthRank: 'true' },
  'L3-05': { relationship: 'close-friend', privacy: 'not-private' },
  'L3-06': { relationship: 'close-friend', privacy: 'not-private' },
  'L3-07': { relationship: 'close-friend', privacy: 'not-private' },
  'L3-08': { truthRank: 'not-sure' },
  'L3-09': { truthRank: 'not-sure' },
  'L3-10': { override: 'none', privacy: 'not-private' },
  'L3-11': { override: 'none', privacy: 'not-private' },
  'L3-12': { relationship: 'grown-up', audience: 'others-hear' },
  'L3-13': { relationship: 'grown-up', audience: 'others-hear' },
  'L3-14': { relationship: 'classmate' },
  'L3-15': { relationship: 'classmate' },
  'L3-16': { truthRank: 'true', changeability: 'not-fixable' },
  'L3-17': { relationship: 'stranger', timing: 'right-moment' },
  'L3-18': { relationship: 'classmate', changeability: 'not-fixable' },
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

  test('no Level 3 card is still carrying the two labels it went to review with', async ({ page }) => {
    const { level3 } = await page.evaluate(() => {
      const lv = window.__thinkOrSay.levels.find(l => l.id === 3);
      return { level3: { cards: lv.cards } };
    });

    // "A lot of these are missing cross labels" was written on a Level 2 card,
    // but Level 3 is where it bit hardest: every one of the eighteen declared
    // exactly two criterial features, on the level whose whole target is the
    // learner SAYING what decides the card. A card cannot teach a reason it does
    // not claim.
    const thin = level3.cards
      .filter(c => Object.keys(c.features).length < 3)
      .map(c => `${c.id}: ${Object.keys(c.features).length} labels`);
    expect(thin, 'the Level 3 audit raised every card off two labels').toEqual([]);

    // And the pool as a whole now claims at least what the other two do. Level 1
    // averages 2.57 and Level 2 2.93; Level 3 was 2.00 flat.
    const total = level3.cards.reduce((n, c) => n + Object.keys(c.features).length, 0);
    expect(total / level3.cards.length,
      `Level 3 declares ${total} labels across ${level3.cards.length} cards`)
      .toBeGreaterThan(2.93);
  });

  test('the Level 3 pairs carry every added label on BOTH halves', async ({ page }) => {
    const { level3 } = await page.evaluate(() => {
      const lv = window.__thinkOrSay.levels.find(l => l.id === 3);
      return { level3: { cards: lv.cards, pairs: lv.pairs } };
    });
    const byId = Object.fromEntries(level3.cards.map(c => [c.id, c]));

    // The constraint that makes the audit hard, asserted where it was paid: a
    // criterial label cannot be added to one card on its own, so each of these
    // keys had to be honest on the partner too, at a value that keeps exactly
    // one dimension differing. L3-05 anchors TWO pairs, so its key set is shared
    // by L3-06 and L3-07 at once.
    const FORCED = [
      { dim: 'selfEsteem',    a: 'L3-01', b: 'L3-02', added: { truthRank: 'true' } },
      { dim: 'privacy',       a: 'L3-03', b: 'L3-04',
        added: { relationship: 'close-friend', truthRank: 'true' } },
      { dim: 'changeability', a: 'L3-05', b: 'L3-06',
        added: { relationship: 'close-friend', privacy: 'not-private' } },
      { dim: 'audience',      a: 'L3-05', b: 'L3-07',
        added: { relationship: 'close-friend', privacy: 'not-private' } },
      { dim: 'relationship',  a: 'L3-08', b: 'L3-09', added: { truthRank: 'not-sure' } },
      { dim: 'timing',        a: 'L3-10', b: 'L3-11',
        added: { override: 'none', privacy: 'not-private' } },
      { dim: 'override',      a: 'L3-12', b: 'L3-13',
        added: { relationship: 'grown-up', audience: 'others-hear' } },
      { dim: 'truthRank',  a: 'L3-14', b: 'L3-15', added: { relationship: 'classmate' } },
    ];

    for (const { dim, a, b, added } of FORCED) {
      const pair = level3.pairs.find(p => p.dim === dim);
      expect([pair.a, pair.b].sort(), `the Level 3 ${dim} pair is still ${a}/${b}`)
        .toEqual([a, b].sort());

      for (const [key, value] of Object.entries(added)) {
        expect(byId[a].features[key], `${a} carries the added ${key}`).toBe(value);
        expect(byId[b].features[key], `${b} carries it too`).toBe(value);
      }
      // Minimum difference survived the additions.
      expect(Object.keys(byId[a].features).sort(), `${a}/${b} turn on the same dimensions`)
        .toEqual(Object.keys(byId[b].features).sort());
      const differing = Object.keys(byId[a].features)
        .filter(k => byId[a].features[k] !== byId[b].features[k]);
      expect(differing.length, `${a}/${b} still differ on exactly one feature`).toBe(1);
      expect(byId[a].answer === byId[b].answer, `${a}/${b} still answer opposite ways`).toBe(false);
    }
  });

  test('the audit reached the one criterial value no card had ever sampled', async ({ page }) => {
    const { cards, dimensions } = await page.evaluate(() => ({
      cards: window.__thinkOrSay.cards,
      // The universe itself, not the game's summary of it - the values live on
      // the model, and this test is about a value the decks never reached.
      dimensions: Object.fromEntries(Object.entries(window.ThinkOrSayModel.DIMENSIONS)
        .map(([dim, d]) => [dim, d.values])),
    }));
    expect(Object.keys(dimensions).length, 'the model declares eight dimensions').toBe(8);

    // `truthRank` declares two values and the decks only ever used one of
    // them. "Not sure" is the honest label for the pair that turns on red, wet
    // eyes: what the learner can see is not the same as what happened, and that
    // is precisely why one half asks and the other leaves it alone.
    const notSure = cards.filter(c => c.features.truthRank === 'not-sure').map(c => c.id);
    expect(notSure.length, 'not-sure is a declared value, so some card must sample it')
      .toBeGreaterThan(0);

    // Stated generally so the next unsampled value shows up here too, rather
    // than only the one this audit happened to find.
    const sampled = new Set(cards.flatMap(c => Object.values(c.features)));
    const unused = Object.entries(dimensions)
      .flatMap(([dim, values]) => values.filter(v => !sampled.has(v)).map(v => `${dim}=${v}`));
    expect(unused, 'the universe declares a value no card teaches').toEqual([]);
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

/**
 * ════════════════════════════════════════════════════════════════════════
 * His structural ruling: "Level 1 should state the rule (bring the unspoken
 * rules to light)".
 *
 * Level 1 is early acquisition, so the rule it teaches is a VISIBLE support
 * rather than something to be induced from 35 cards of feedback (RESEARCH.md
 * §1). Four properties make that true rather than merely present:
 *
 *   1. the rule is declared ONCE, in the level pool's data, and never on a card
 *   2. it is on screen for the whole Level 1 trial, so a technician never
 *      leaves the card to check it
 *   3. it renders at Level 1 only - Level 2's answer turns on the situation and
 *      Level 3's target is the spoken reason, so a rule left up there is wrong
 *      or is the answer sheet
 *   4. it cannot give the card away: it names BOTH answers, and it is the same
 *      text on a THINK card and on a SAY card
 * ════════════════════════════════════════════════════════════════════════
 */
test.describe('Level 1 states the rule on screen', () => {
  const ruleOf = (page, id) => page.evaluate(l => window.__thinkOrSay.level(l).rule || null, id);

  /** The rule strip as a technician reads it: the tags, the tests, the tip. */
  const strip = page => page.evaluate(() => {
    const panel = document.getElementById('rule-panel');
    return {
      hidden: panel.hidden,
      title: document.getElementById('rule-title').textContent,
      lead: document.getElementById('rule-lead').textContent,
      tip: document.getElementById('rule-tip').textContent,
      tags: Array.from(panel.querySelectorAll('.rule-row .tag')).map(t => t.textContent),
      tests: Array.from(panel.querySelectorAll('.rule-list li')).map(t => t.textContent),
      text: panel.textContent.replace(/\s+/g, ' ').trim(),
    };
  });

  /** Answer the card on screen correctly and move to the next one. */
  async function answerAndAdvance(page) {
    const answer = await page.evaluate(() => {
      const s = window.__thinkOrSay.session();
      return s.deck[s.results.length].answer;
    });
    await page.locator('#reveal-panel').click();
    await page.locator(`#choices .choice[data-answer="${answer}"]`).click();
    await page.locator('#btn-next').click();
  }

  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await booted(page);
  });

  test('the rule is declared once in the level data, and no card carries a copy', async ({ page }) => {
    const rule = await ruleOf(page, 1);
    expect(rule, 'Level 1 declares the rule it teaches').toBeTruthy();
    expect(rule.title).toBeTruthy();
    expect(rule.lead).toBeTruthy();

    // Both answers named, which is what stops the strip answering the card.
    for (const answer of ['think', 'say']) {
      expect(rule.branches.filter(b => b.answer === answer).length,
        `the rule states at least one ${answer} branch`).toBeGreaterThan(0);
    }
    for (const branch of rule.branches) expect(branch.test).toBeTruthy();

    // Levels 2 and 3 state none: at Level 2 the situation decides, and at Level
    // 3 the learner has to supply the reason the rule would hand them.
    expect(await ruleOf(page, 2), 'Level 2 states no rule').toBeNull();
    expect(await ruleOf(page, 3), 'Level 3 states no rule').toBeNull();

    // One place in the data. A per-card rule line would be 81 copies to drift.
    const cards = await allCards(page);
    expect(cards.filter(c => c.rule != null).map(c => c.id),
      'no card carries its own copy of the rule').toEqual([]);
  });

  test('the rule is on screen for the whole Level 1 trial', async ({ page }) => {
    const rule = await ruleOf(page, 1);
    await page.locator('#sel-level').selectOption('1');
    await page.locator('#btn-play').click();
    await expect(page.locator('#rule-panel')).toBeVisible();

    const shown = await strip(page);
    expect(shown.title).toBe(rule.title);
    expect(shown.lead).toBe(rule.lead);
    expect(shown.tip).toBe(rule.tip);
    expect(shown.tags, 'the rule speaks in the tile vocabulary').toEqual(['THINK IT', 'SAY IT']);
    expect(shown.tests.slice().sort(), 'every branch of the rule is rendered')
      .toEqual(rule.branches.map(b => b.test).sort());

    // Through the whole trial: while the card is being read, once the tiles are
    // up, and after the answer has been scored. A support the technician has to
    // leave the trial to see is not on screen.
    await page.locator('#reveal-panel').click();
    await expect(page.locator('#choices')).toBeVisible();
    await expect(page.locator('#rule-panel')).toBeVisible();
    const answer = await page.evaluate(() => window.__thinkOrSay.session().deck[0].answer);
    await page.locator(`#choices .choice[data-answer="${answer}"]`).click();
    await expect(page.locator('#rule-panel')).toBeVisible();
    await page.locator('#btn-next').click();
    await expect(page.locator('#rule-panel')).toBeVisible();
  });

  test('the rule does not render at Level 2 or Level 3', async ({ page }) => {
    // Attached AND hidden, in that order: a missing element is trivially hidden,
    // so asserting only the second would pass against a build that has no rule
    // strip at all and would tell us nothing.
    await expect(page.locator('#rule-panel')).toBeAttached();
    for (const level of ['2', '3']) {
      await page.locator('#sel-level').selectOption(level);
      await page.locator('#btn-play').click();
      await expect(page.locator('#progress-label')).toContainText('Card 1 of');
      await expect(page.locator('#rule-panel'),
        `level ${level} states no rule, so nothing renders`).toBeHidden();
      await expect(page.locator('#rule-body')).toBeEmpty();
    }
  });

  test('the rule reads the same on a THINK card and on a SAY card', async ({ page }) => {
    // The strip is a support, not a cue. If its text moved with the answer it
    // would be the shortest route to faulty stimulus control in the whole game:
    // a learner would read the strip instead of the card.
    await page.locator('#sel-level').selectOption('1');
    await page.locator('#sel-order').selectOption('sequential');
    await page.locator('#btn-play').click();
    await expect(page.locator('#rule-panel')).toBeVisible();

    const seen = new Map();
    for (let i = 0; i < 6; i++) {
      const answer = await page.evaluate(() => {
        const s = window.__thinkOrSay.session();
        return s.deck[s.results.length].answer;
      });
      const text = (await strip(page)).text;
      if (!seen.has(answer)) seen.set(answer, text);
      expect(text, 'the rule text is the same on every card').toBe(seen.get(answer));
      await answerAndAdvance(page);
    }
    expect(Array.from(seen.keys()).sort(), 'both answers were sampled').toEqual(['say', 'think']);
    expect(new Set(seen.values()).size, 'THINK cards and SAY cards show identical rule text').toBe(1);
  });

  test('a probe trial withholds the rule, the way it withholds every other support', async ({ page }) => {
    // A probe is an untrained item run WITHOUT the teaching supports, so that a
    // correct answer is evidence about the repertoire (RESEARCH.md §4.2). The
    // stated rule is the strongest support in the game: left on screen it would
    // turn a Level 1 probe into a reading test.
    expect(await page.evaluate(() => window.__thinkOrSay.probes.SUPPRESSED),
      'the rule is on the suppression list, not special-cased').toContain('showRule');

    await page.addInitScript(cfg => {
      localStorage.setItem('nooutco.settings.think-or-say', JSON.stringify({ working: cfg }));
    }, {
      level: 1, category: 'all', order: 'sequential', counterbalance: false,
      probes1: true, probeCount1: 2, probePlacement1: 'before',
    });
    await page.reload();
    await booted(page);
    await page.locator('#btn-play').click();

    const isProbe = await page.evaluate(() =>
      window.__thinkOrSay.session().deck.map(c => c.isProbe));
    expect(isProbe[0], 'the deck opens on the probes').toBe(true);
    await expect(page.locator('#probe-banner')).toBeVisible();
    await expect(page.locator('#rule-panel'), 'no rule on a probe trial').toBeHidden();

    // And it comes back the moment the deck reaches a teaching trial: the
    // suppression is a property of the trial, not a setting the probe changed.
    for (let i = 0; i < isProbe.indexOf(false); i++) await answerAndAdvance(page);
    await expect(page.locator('#probe-banner')).toBeHidden();
    await expect(page.locator('#rule-panel'), 'a teaching trial gets it back').toBeVisible();
  });

  test('Show the Rule fades the support, and defaults to on', async ({ page }) => {
    const { defaults } = await page.evaluate(() => window.__thinkOrSay.settings());
    expect(defaults.showRule, 'an early-acquisition learner should not need it switched on')
      .toBe(true);

    await page.locator('#sel-level').selectOption('1');
    await page.locator('#btn-play').click();
    await expect(page.locator('#rule-panel')).toBeVisible();

    // Fading it takes effect on the card already on screen, not on the next one.
    await page.locator('#btn-extra-toggle').click();
    await expect(page.locator('#extra-panel')).toBeVisible();
    await page.locator('#chk-show-rule').uncheck();
    await expect(page.locator('#rule-panel')).toBeHidden();
    await page.locator('#btn-extra-close').click();

    await answerAndAdvance(page);
    await expect(page.locator('#rule-panel'), 'the fade holds across cards').toBeHidden();

    // And it is a persisted option like every other one, so it survives a reload.
    await page.reload();
    await booted(page);
    expect((await page.evaluate(() => window.__thinkOrSay.settings())).cfg.showRule).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════
 * The stated rule has to decide the deck it is stated over.
 *
 * A rule shown to an early-acquisition learner is only teaching if applying
 * it yields the answer the game scores. The first version of this rule did
 * not: it contradicted three cards outright (L1-05, L1-09, L1-11), was right
 * on a fourth only if you happened to read top-to-bottom, and was silent on
 * seven. A learner who correctly applied it was marked wrong.
 *
 * So the rule now carries machine-checkable predicates and this walks every
 * Level 1 card through them. Three separate failures are possible and all
 * three are caught here:
 *   CONTRADICTED - the rule fires and disagrees with the scored answer
 *   BOTH WAYS    - a THINK question and a SAY question fire on one card, which
 *                  would make the answer depend on reading order; the panel
 *                  renders the columns grouped by answer, so there IS no order
 *   UNDECIDED    - nothing fires, and the learner is left with no rule at all
 *
 * This is what stops a future card edit from quietly breaking the rule.
 * ══════════════════════════════════════════════════════════════════════ */

/** Evaluate one `when` clause against a card's criterial features. */
function matches(when, features) {
  if (!when) return false;
  for (const [k, v] of Object.entries(when.is || {})) if (features[k] !== v) return false;
  for (const [k, v] of Object.entries(when.isNot || {})) if (features[k] === v) return false;
  return true;
}

test('the Level 1 rule decides every Level 1 card, and contradicts none', async ({ page }) => {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await booted(page);

  const lv = await page.evaluate(() => {
    const level = window.__thinkOrSay.levels.find(l => l.id === 1);
    return { rule: level.rule, cards: level.cards };
  });

  expect(lv.rule, 'Level 1 declares a rule').toBeTruthy();
  expect(lv.rule.always, 'the safety override is stated').toBeTruthy();

  const contradicted = [];
  const bothWays = [];
  const undecided = [];

  for (const card of lv.cards) {
    // Safety outranks the columns, so it is checked first and alone.
    if (matches(lv.rule.always.when, card.features)) {
      if (card.answer !== lv.rule.always.answer) {
        contradicted.push(`${card.id}: override says ${lv.rule.always.answer}, scored ${card.answer}`);
      }
      continue;
    }
    const hits = lv.rule.branches.filter(b => matches(b.when, card.features));
    if (!hits.length) { undecided.push(card.id); continue; }
    const answers = [...new Set(hits.map(h => h.answer))];
    if (answers.length > 1) {
      bothWays.push(`${card.id}: ${hits.map(h => `${h.answer} "${h.test}"`).join(' and ')}`);
      continue;
    }
    if (answers[0] !== card.answer) {
      contradicted.push(`${card.id}: rule says ${answers[0]}, scored ${card.answer}`);
    }
  }

  expect(contradicted, 'no card is contradicted by the rule it is taught under').toEqual([]);
  expect(bothWays, 'no card satisfies a THINK question and a SAY question at once').toEqual([]);
  expect(undecided, 'no card is left undecided by the rule').toEqual([]);
});

test('the rule never names the answer to the card on screen', async ({ page }) => {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await booted(page);

  const rule = await page.evaluate(() =>
    window.__thinkOrSay.levels.find(l => l.id === 1).rule);

  // Both columns are always populated, so the strip poses questions rather than
  // delivering a verdict. A column that emptied would answer every card in the
  // deck by elimination.
  for (const answer of ['think', 'say']) {
    expect(rule.branches.filter(b => b.answer === answer).length,
      `the ${answer} column is never empty`).toBeGreaterThan(0);
  }
});
