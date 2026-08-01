import { test, expect } from '@playwright/test';

/**
 * ════════════════════════════════════════════════════════════════════════
 * think-or-say: three levels, coverage-derived pools, and the side split
 *
 * The deck used to be one flat 33-card set with a "tricky cards" checkbox. It
 * is now three separate pools, one card to exactly one level, and the cards in
 * each pool are chosen by a COVERAGE MATRIX rather than by a target count:
 * there is no established sufficient-N (Hupp 1986 — RESEARCH.md §3.4), so a
 * count is not a claim anybody can defend. What can be defended is that every
 * criterial dimension is sampled, and that each one carries a matched
 * MINIMUM-DIFFERENCE pair — two cards identical on every criterial feature but
 * one, with opposite answers (Horner, Albin & Ralph 1986). The contrast is what
 * teaches the defining feature.
 *
 * The side split is the other thing pinned here, and it is not the same claim
 * the source used to make. Alternating the tiles on the trial index guarantees
 * each POSITION holds each TILE equally often. It guarantees nothing about
 * which SIDE IS CORRECT: that is the interaction between the alternation and
 * the pool's own run of answers, so a pool whose answers alternate in step with
 * the tiles puts the correct tile on the same side every single trial. That is
 * a property of the AUTHORED ORDER, it is measurable, and it is measured here —
 * per pool, because a balanced total can hide a fully confounded single level.
 * ════════════════════════════════════════════════════════════════════════
 */

const URL = '/think-or-say/';

/** The split at which a pool is judged to be cueing the answer by position. */
const WORST_ACCEPTABLE_SHARE = 0.65;

/**
 * Words this game must never print. It teaches a learner not to say hurtful
 * things; a deck that quotes the vocabulary would be teaching it instead. Mild
 * utterances ("Go away!", "That smells gross") are quoted; anything harsher is
 * described, never printed.
 */
const NAME_CALLING = [
  'stupid', 'dumb', 'dummy', 'idiot', 'moron', 'jerk', 'loser', 'ugly',
  'fat', 'fatso', 'freak', 'weirdo', 'crybaby', 'stinky', 'smelly',
  'nasty', 'disgusting', 'pig', 'brat', 'shut up', 'hate you',
];

async function seed(page, working) {
  await page.addInitScript((cfg) => {
    localStorage.setItem('nooutco.settings.think-or-say', JSON.stringify({ working: cfg }));
  }, working);
}

async function booted(page) {
  await expect(page.locator('#sel-category option').first()).toHaveText('All categories');
}

/** The three pools and the model they were built against, as the game holds them. */
async function levels(page) {
  return page.evaluate(() => ({
    levels: window.__thinkOrSay.levels.map(lv => ({
      id: lv.id,
      name: lv.name,
      cards: lv.cards,
      pairs: lv.pairs,
      coverage: lv.coverage,
    })),
    dimensions: window.__thinkOrSay.dimensions,
    canHave: window.__thinkOrSay.canHave,
    minExemplars: window.__thinkOrSay.minExemplarsPerDimension,
    all: window.__thinkOrSay.cards,
  }));
}

/**
 * Which side the correct tile lands on, trial by trial, under
 * `order: sequential` with counterbalance ON.
 *
 * positionTiles() renders [think, say] on an even trial index and [say, think]
 * on an odd one, so the correct tile is on the LEFT exactly when the answer is
 * `think` on an even index or `say` on an odd one. A DOM walk below checks this
 * arithmetic against the real thing rather than trusting it.
 */
function correctSides(cards) {
  return cards.map((c, pos) => {
    const sayFirst = pos % 2 === 1;
    return (sayFirst ? c.answer === 'say' : c.answer === 'think') ? 'left' : 'right';
  });
}

test.describe('the three pools', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(URL);
    await booted(page);
  });

  test('there are three levels, each pool is non-empty, and they are disjoint by id', async ({ page }) => {
    const { levels: lv, all } = await levels(page);
    expect(lv.map(l => l.id)).toEqual([1, 2, 3]);
    expect(lv.map(l => l.name)).toEqual(['Clear', 'Nuanced', 'Explain']);

    const ids = [];
    for (const level of lv) {
      expect(level.cards.length, `level ${level.id} is not empty`).toBeGreaterThan(0);
      for (const c of level.cards) {
        expect(c.level, `card ${c.id} declares its own level`).toBe(level.id);
        ids.push(c.id);
      }
    }
    expect(new Set(ids).size, 'a card belongs to exactly one level').toBe(ids.length);
    expect(all.length, 'the flat view is every card, once').toBe(ids.length);
  });

  test('every pool covers every criterial dimension with at least three exemplars', async ({ page }) => {
    const { levels: lv, dimensions, minExemplars } = await levels(page);
    expect(dimensions.length, 'eight criterial dimensions').toBe(8);
    expect(minExemplars).toBe(3);

    for (const level of lv) {
      for (const dim of dimensions) {
        const exemplars = level.coverage[dim];
        expect(exemplars, `level ${level.id} covers ${dim}`).toBeTruthy();
        expect(exemplars.length,
          `level ${level.id} / ${dim}: ${exemplars.length} exemplars`)
          .toBeGreaterThanOrEqual(minExemplars);
        // The coverage matrix has to be a report of the cards, not a claim
        // alongside them.
        for (const id of exemplars) {
          const card = level.cards.find(c => c.id === id);
          expect(card.features[dim], `${id} really declares ${dim}`).toBeTruthy();
        }
      }
    }
  });

  test('every criterial dimension carries a matched minimum-difference pair', async ({ page }) => {
    const { levels: lv, dimensions } = await levels(page);

    for (const level of lv) {
      expect(level.pairs.map(p => p.dim).sort(), `level ${level.id} pairs`)
        .toEqual(dimensions.slice().sort());

      for (const pair of level.pairs) {
        const a = level.cards.find(c => c.id === pair.a);
        const b = level.cards.find(c => c.id === pair.b);
        const where = `level ${level.id} / ${pair.dim} pair (${pair.a}, ${pair.b})`;

        expect(a && b, `${where} names real cards`).toBeTruthy();
        expect(a.answer === b.answer, `${where} has opposite answers`).toBe(false);

        // Identical on every criterial feature except one — that is what makes
        // it minimum difference rather than merely a contrast.
        expect(Object.keys(a.features).sort(), `${where} turns on the same dimensions`)
          .toEqual(Object.keys(b.features).sort());
        const differing = Object.keys(a.features).filter(k => a.features[k] !== b.features[k]);
        expect(differing.length, `${where} differs on exactly one feature`).toBe(1);

        if (pair.kind === 'defeater') {
          // Dimension 8. Truth is HELD CONSTANT across both cards and something
          // else flips: that is the demonstration that truth is not the test.
          expect(pair.dim, 'only truthRank is a defeater').toBe('truthRank');
          expect(a.features[pair.dim], `${where} holds ${pair.dim}`).toBe(b.features[pair.dim]);
          expect(a.features[pair.dim], `${where} holds it at true`).toBe('true');
          expect(differing[0], `${where} flips something other than ${pair.dim}`).not.toBe(pair.dim);
        } else {
          expect(differing[0], `${where} flips ${pair.dim} itself`).toBe(pair.dim);
        }
      }
    }
  });

  test('a help-or-safety card always answers SAY', async ({ page }) => {
    const { all } = await levels(page);
    const overrides = all.filter(c => c.features.override === 'help-or-safety');
    expect(overrides.length, 'the override is in play somewhere').toBeGreaterThan(0);
    expect(overrides.filter(c => c.answer !== 'say').map(c => c.id),
      'an override that does not override').toEqual([]);
  });

  test('Level 3 carries exemplar rationales, and no other level does', async ({ page }) => {
    const { levels: lv } = await levels(page);
    for (const level of lv) {
      for (const c of level.cards) {
        if (level.id === 3) {
          expect(c.rationales.length, `${c.id} offers 2-4 exemplar rationales`)
            .toBeGreaterThanOrEqual(2);
          expect(c.rationales.length, `${c.id} offers 2-4 exemplar rationales`)
            .toBeLessThanOrEqual(4);
        } else {
          expect(c.rationales, `${c.id} is not a Level 3 card`).toEqual([]);
        }
      }
    }
  });

  test('no card in any pool prints a name-calling word', async ({ page }) => {
    const { all } = await levels(page);
    const offenders = [];
    for (const c of all) {
      const text = [c.situation, c.utterance, c.question, c.reason]
        .concat(c.rationales || []).join(' ').toLowerCase();
      for (const word of NAME_CALLING) {
        if (new RegExp('\\b' + word + '\\b').test(text)) offenders.push(`${c.id}: "${word}"`);
      }
    }
    expect(offenders, 'the game must not teach the vocabulary it warns against').toEqual([]);
  });

  test('can-have features vary, and none of them is confounded with the answer', async ({ page }) => {
    const { levels: lv, canHave } = await levels(page);
    expect(canHave).toEqual(['setting', 'person', 'topic', 'form']);

    const confounded = [];
    for (const level of lv) {
      for (const key of canHave) {
        const values = new Set(level.cards.map(c => c.vary[key]));
        expect(values.size, `level ${level.id} varies ${key}`).toBeGreaterThan(1);
        for (const value of values) {
          const using = level.cards.filter(c => c.vary[key] === value);
          // A value seen once or twice cannot be shown to be non-confounded, so
          // the rule applies where it can bite: a surface feature the learner
          // has met three times and only ever on one answer has quietly become
          // criterial, and the POOL gets fixed, not the rule.
          if (using.length < 3) continue;
          if (new Set(using.map(c => c.answer)).size < 2) {
            confounded.push(`level ${level.id} ${key}=${value} (${using.length} cards, all ${using[0].answer})`);
          }
        }
      }
    }
    expect(confounded, 'a can-have feature perfectly predicts the answer').toEqual([]);
  });
});

// ── The correct-tile side split, per pool ──────────────────────────────────

test('no pool puts the correct tile on one side more than 65% of the time', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  const { levels: lv } = await levels(page);

  const report = [];
  for (const level of lv) {
    const sides = correctSides(level.cards);
    const left = sides.filter(s => s === 'left').length;
    const share = left / sides.length;
    report.push(`level ${level.id}: ${left} left / ${sides.length - left} right of ${sides.length}`);
    // Asserted PER POOL, not over the pools combined — a balanced total can
    // hide a fully confounded single level.
    expect(share, `level ${level.id} correct-tile-left share (${report[report.length - 1]})`)
      .toBeGreaterThan(1 - WORST_ACCEPTABLE_SHARE);
    expect(share, `level ${level.id} correct-tile-left share (${report[report.length - 1]})`)
      .toBeLessThan(WORST_ACCEPTABLE_SHARE);
  }
  expect(report.length).toBe(3);
});

test('the predicted side is the side the learner actually sees', async ({ page }) => {
  await seed(page, { level: 1, category: 'all', order: 'sequential', counterbalance: true, showReason: false });
  await page.goto(URL);
  await booted(page);
  const { levels: lv } = await levels(page);
  const pool = lv[0].cards;
  const predicted = correctSides(pool);

  await page.locator('#btn-play').click();
  const seen = [];
  for (let i = 0; i < 10; i++) {
    await page.locator('#reveal-panel').click();
    await expect(page.locator('#choices')).toBeVisible();
    const order = await page.locator('#choices .choice')
      .evaluateAll(els => els.map(e => e.dataset.answer));
    seen.push(order[0] === pool[i].answer ? 'left' : 'right');
    await page.locator(`#choices .choice[data-answer="${pool[i].answer}"]`).click();
    await page.locator('#btn-next').click();
  }
  expect(seen, 'the arithmetic above matches positionTiles()').toEqual(predicted.slice(0, 10));
});

// ── The level selector ─────────────────────────────────────────────────────

test('the level selector chooses the pool, and defaults to Level 1', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  await expect(page.locator('#sel-level')).toHaveValue('1');
  await expect(page.locator('#level-blurb')).not.toBeEmpty();

  const { levels: lv } = await levels(page);
  await page.locator('#btn-play').click();
  await expect(page.locator('#progress-label')).toHaveText(`Card 1 of ${lv[0].cards.length}`);
});

test('a stored Level 3 runs the Level 3 pool, first card and all', async ({ page }) => {
  await seed(page, { level: 3, category: 'all', order: 'sequential' });
  await page.goto(URL);
  await booted(page);
  await expect(page.locator('#sel-level')).toHaveValue('3');

  const { levels: lv } = await levels(page);
  const pool = lv[2].cards;
  await page.locator('#btn-play').click();
  await expect(page.locator('#progress-label')).toHaveText(`Card 1 of ${pool.length}`);
  await expect(page.locator('#scenario-situation')).toHaveText(pool[0].situation);
  await expect(page.locator('#scenario-question')).toHaveText(pool[0].question);
});

test('the retired includeTricky still loads, and folds onto a level', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A settings blob written before the level selector existed.
  await seed(page, { category: 'all', order: 'sequential', includeTricky: true, showReason: true });
  await page.goto(URL);
  await booted(page);

  await expect(page.locator('#sel-level'), 'tricky cards were the nuanced ones').toHaveValue('2');
  await expect(page.locator('#chk-show-reason'), 'the rest of the blob survives').toBeChecked();
  await page.locator('#btn-play').click();
  const { levels: lv } = await levels(page);
  await expect(page.locator('#progress-label')).toHaveText(`Card 1 of ${lv[1].cards.length}`);
  expect(errors, 'a pre-change settings blob loads cleanly').toEqual([]);
});

test('the level reaches the printed report', async ({ page }) => {
  await seed(page, { level: 2, category: 'smells', order: 'sequential', showReason: false });
  await page.goto(URL);
  await booted(page);

  await page.locator('#btn-play').click();
  const { levels: lv } = await levels(page);
  const card = lv[1].cards.find(c => c.cat === 'smells');
  await page.locator('#reveal-panel').click();
  await page.locator(`#choices .choice[data-answer="${card.answer}"]`).click();

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('nooutco.results.think-or-say') || '[]'));
  expect(stored.length).toBe(1);
  expect(stored[0].level, 'the trial record carries the level').toBe(2);
});
