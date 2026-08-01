import { test, expect } from '@playwright/test';

/**
 * ════════════════════════════════════════════════════════════════════════
 * think-or-say: the Level 3 spoken rationale
 *
 * Level 3 is its own pool, authored so the REASON is the teaching target. The
 * tile is only half the trial: the learner chooses, the game asks "Tell me
 * why.", and the technician scores what the learner ACTUALLY SAID as Correct /
 * Partly correct / Not yet, plus an optional free-text note.
 *
 * The two properties that make that scoring honest, and that this spec exists
 * to hold in place:
 *
 *   * scoring is INDEPENDENT of the exemplar rationales the card carries. The
 *     technician is not picking which exemplar was matched. A correct reason
 *     nobody wrote down is the ideal outcome and must score fully Correct — so
 *     a score can be given without ever revealing the exemplars, and revealing
 *     them scores nothing.
 *   * the exemplars are a REVEAL, and a reveal is an instructional support. On
 *     a probe trial they are withheld, exactly like the reason reveal is,
 *     while the ask and the scoring still happen — a Level 3 probe is still a
 *     Level 3 item.
 *
 * The note is the technician's own words and never leaves the device
 * (apps/games/CLAUDE.md §5), which is why the field says "no names" on screen.
 * ════════════════════════════════════════════════════════════════════════
 */

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

const session = page => page.evaluate(() => window.__thinkOrSay.session());
const pool = page => page.evaluate(() => window.__thinkOrSay.level(3).cards);

/** A Level 3 session with the reveal on and every other support out of the way. */
const explaining = (over = {}) => ({
  level: 3, category: 'all', order: 'sequential',
  showReason: true, represent: false, errorless: false,
  autoPrompt: false, counterbalance: false,
  ...over,
});

/** Reveal the tiles and answer the card at deck position `i` correctly. */
async function chooseTile(page, i) {
  const deck = (await session(page)).deck;
  await page.locator('#reveal-panel').click();
  await expect(page.locator('#choices')).toBeVisible();
  await page.locator(`#choices .choice[data-answer="${deck[i].answer}"]`).click();
}

/** Answer a whole Level 3 trial: tile, then score, then advance. */
async function answerTrial(page, i, { score = 'correct', note = '' } = {}) {
  await chooseTile(page, i);
  if (note) await page.locator('#rationale-note').fill(note);
  await page.locator(`#rationale-scores button[data-score="${score}"]`).click();
  await page.locator('#btn-next').click();
}

// ── The ask ────────────────────────────────────────────────────────────────

test('a Level 3 trial asks for the reason once the tile is chosen', async ({ page }) => {
  await seed(page, explaining());
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();

  // Nothing is asked before the learner has answered.
  await expect(page.locator('#rationale-panel')).toBeHidden();
  await chooseTile(page, 0);

  await expect(page.locator('#rationale-panel')).toBeVisible();
  await expect(page.locator('#rationale-ask')).toHaveText('Tell me why.');
  // The trial does not advance on the tile alone: the reason is the target, so
  // there is no way past this card that leaves the reason unscored.
  await expect(page.locator('#btn-next')).toHaveCount(0);
});

test('Levels 1 and 2 ask for no reason at all', async ({ page }) => {
  for (const level of [1, 2]) {
    await seed(page, { level, category: 'all', order: 'sequential', showReason: false });
    await page.goto(URL);
    await booted(page);
    await page.locator('#btn-play').click();
    await chooseTile(page, 0);
    await expect(page.locator('#rationale-panel'), `level ${level}`).toBeHidden();
    // and the trial advances on the tile, as it always did
    await expect(page.locator('#btn-next')).toBeVisible();
  }
});

// ── The three-way score ────────────────────────────────────────────────────

test('the score is exactly three points, rendered from one declaration', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  const declared = await page.evaluate(() => window.__thinkOrSay.rationaleScores);
  expect(declared).toEqual(['correct', 'partial', 'not-yet']);

  const buttons = await page.locator('#rationale-scores button')
    .evaluateAll(els => els.map(e => ({ score: e.dataset.score, label: e.textContent })));
  expect(buttons.map(b => b.score)).toEqual(declared);
  expect(buttons.map(b => b.label)).toEqual(['Correct', 'Partly correct', 'Not yet']);
});

test('each of the three scores reaches the trial record and the printed report', async ({ page }) => {
  // A three-card category, played out, so the sheet the technician hands over is
  // the one the report assertions read — buildPrint runs at session end.
  await seed(page, explaining({ category: 'private' }));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();
  await expect(page.locator('#progress-label')).toHaveText('Card 1 of 3');

  const scores = ['correct', 'partial', 'not-yet'];
  for (let i = 0; i < scores.length; i++) await answerTrial(page, i, { score: scores[i] });
  await expect(page.locator('#done-card')).toBeVisible();

  const rows = (await session(page)).results;
  expect(rows.map(r => r.rationaleScore)).toEqual(scores);
  expect(rows.every(r => r.level === 3)).toBe(true);

  const cells = await page.locator('#results-body tr')
    .evaluateAll(trs => trs.map(tr => tr.querySelectorAll('td')[11].textContent));
  expect(cells).toEqual(['Correct', 'Partly correct', 'Not yet']);
});

test('the optional note is recorded, and stays optional', async ({ page }) => {
  await seed(page, explaining({ category: 'work' }));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();
  await expect(page.locator('#progress-label')).toHaveText('Card 1 of 2');

  await answerTrial(page, 0, { score: 'partial', note: 'Said it would be mean, not why' });
  // The field carries a blank note into the next card rather than the last one's.
  await expect(page.locator('#rationale-note')).toHaveValue('');
  await answerTrial(page, 1, { score: 'correct' });      // no note at all

  const rows = (await session(page)).results;
  expect(rows[0].rationaleNote).toBe('Said it would be mean, not why');
  expect(rows[1].rationaleNote).toBe('');

  // The note travels beside the score on the sheet, not folded into it.
  const first = await page.locator('#results-body tr').first()
    .evaluate(tr => tr.querySelectorAll('td')[11].textContent);
  expect(first).toBe('Partly correct - Said it would be mean, not why');
});

test('the report tallies the reason scores', async ({ page }) => {
  await seed(page, explaining({ category: 'private' }));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();

  await answerTrial(page, 0, { score: 'correct' });
  await answerTrial(page, 1, { score: 'correct' });
  await answerTrial(page, 2, { score: 'not-yet' });
  await expect(page.locator('#done-card')).toBeVisible();

  const summary = await page.locator('#print-summary').textContent();
  expect(summary).toContain('Reasons:');
  expect(summary).toContain('2 correct');
  expect(summary).toContain('0 partly correct');
  expect(summary).toContain('1 not yet');
});

// ── Scoring is independent of the exemplars ────────────────────────────────

test('the exemplars are a reveal that waits, and are named as examples', async ({ page }) => {
  await seed(page, explaining());
  await page.goto(URL);
  await booted(page);
  const cards = await pool(page);
  expect(cards[0].rationales.length, 'the first Level 3 card carries exemplars')
    .toBeGreaterThanOrEqual(2);
  expect(cards[0].rationales.length).toBeLessThanOrEqual(4);

  await page.locator('#btn-play').click();
  await chooseTile(page, 0);

  // The ask lands first. Model answers on screen beside "Tell me why." would be
  // a prompt delivered by the layout, so they wait behind the button.
  await expect(page.locator('#rationale-examples')).toBeHidden();
  await expect(page.locator('#btn-rationale-reveal')).toBeVisible();

  await page.locator('#btn-rationale-reveal').click();
  await expect(page.locator('#rationale-examples')).toBeVisible();
  await expect(page.locator('#rationale-examples-label')).toContainText('not a scoring key');
  const shown = await page.locator('#rationale-examples-list li')
    .evaluateAll(els => els.map(e => e.textContent));
  expect(shown).toEqual(cards[0].rationales);
  // The card's own reason reveals with them.
  await expect(page.locator('#scenario-reason')).toBeVisible();
});

test('a reason can be scored Correct without the exemplars ever being revealed', async ({ page }) => {
  await seed(page, explaining());
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();
  await chooseTile(page, 0);

  // The ideal outcome: a correct reason nobody wrote down. Nothing is revealed,
  // nothing is matched, and it scores fully Correct.
  await expect(page.locator('#rationale-examples')).toBeHidden();
  await page.locator('#rationale-scores button[data-score="correct"]').click();
  await expect(page.locator('#rationale-examples')).toBeHidden();
  await page.locator('#btn-next').click();

  const rows = (await session(page)).results;
  expect(rows[0].rationaleScore).toBe('correct');
});

test('revealing the exemplars scores nothing on its own', async ({ page }) => {
  await seed(page, explaining());
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();
  await chooseTile(page, 0);

  await page.locator('#btn-rationale-reveal').click();
  await expect(page.locator('#rationale-examples')).toBeVisible();
  // Reading the exemplars is not a judgement about the learner, so the trial is
  // still unscored and still will not advance.
  await expect(page.locator('#btn-next')).toHaveCount(0);
  await expect(page.locator('#rationale-scores button.is-picked')).toHaveCount(0);
});

// ── Probes ─────────────────────────────────────────────────────────────────

test('a Level 3 probe withholds the exemplars but still records a reason score', async ({ page }) => {
  await seed(page, explaining({
    probes3: true, probeCount3: 2, probePlacement3: 'before', category: 'looks',
  }));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();

  const deck = (await session(page)).deck;
  expect(deck[0].isProbe, 'the block is placed before the deck').toBe(true);

  await chooseTile(page, 0);
  await expect(page.locator('#probe-banner')).toBeVisible();
  // The ask and the scoring are what Level 3 IS, so they happen on a probe too.
  await expect(page.locator('#rationale-panel')).toBeVisible();
  await expect(page.locator('#rationale-ask')).toHaveText('Tell me why.');
  // The reveal is an instructional support, so it is not offered at all.
  await expect(page.locator('#btn-rationale-reveal')).toBeHidden();
  await expect(page.locator('#rationale-examples')).toBeHidden();
  await expect(page.locator('#scenario-reason')).toBeHidden();

  await page.locator('#rationale-scores button[data-score="not-yet"]').click();
  await page.locator('#btn-next').click();

  const rows = (await session(page)).results;
  expect(rows[0].trialClass, 'a clean probe is still a generalization datum').toBe('generalization');
  expect(rows[0].rationaleScore).toBe('not-yet');
});

test('the reason score does not decide the probe classification', async ({ page }) => {
  await seed(page, explaining({
    probes3: true, probeCount3: 2, probePlacement3: 'before', category: 'looks',
  }));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();

  // Two probes, scored at opposite ends. The tile was correct and no support was
  // delivered on either, so both are clean generalization data — what the
  // technician thought of the REASON is a separate datum and must not
  // reclassify the trial.
  await answerTrial(page, 0, { score: 'correct' });
  await answerTrial(page, 1, { score: 'not-yet' });

  const rows = (await session(page)).results;
  expect(rows.map(r => r.trialClass)).toEqual(['generalization', 'generalization']);
  expect(rows.map(r => r.rationaleScore)).toEqual(['correct', 'not-yet']);
});

// ── The record ─────────────────────────────────────────────────────────────

test('the latency recorded is the learner\'s, not the technician\'s scoring time', async ({ page }) => {
  await seed(page, explaining());
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();

  await chooseTile(page, 0);
  // The technician takes their time over the score — reading the exemplars,
  // typing a note. None of that is the learner's response latency.
  await page.locator('#btn-rationale-reveal').click();
  await page.waitForTimeout(2600);
  await page.locator('#rationale-note').fill('took a while to write this');
  await page.locator('#rationale-scores button[data-score="correct"]').click();
  await page.locator('#btn-next').click();

  const rows = (await session(page)).results;
  expect(rows[0].secs).toBeLessThanOrEqual(1);
});

test('Levels 1 and 2 leave the reason columns blank rather than filling them in',
  async ({ page }) => {
    await seed(page, { level: 1, category: 'work', order: 'sequential', showReason: false });
    await page.goto(URL);
    await booted(page);
    await page.locator('#btn-play').click();
    await expect(page.locator('#progress-label')).toHaveText('Card 1 of 3');

    for (let i = 0; i < 3; i++) {
      await chooseTile(page, i);
      await page.locator('#btn-next').click();
    }
    await expect(page.locator('#done-card')).toBeVisible();

    const rows = (await session(page)).results;
    expect(rows.every(r => r.rationaleScore === '')).toBe(true);
    expect(rows.every(r => r.rationaleNote === '')).toBe(true);
    const cells = await page.locator('#results-body tr')
      .evaluateAll(trs => trs.map(tr => tr.querySelectorAll('td')[11].textContent));
    expect(cells).toEqual(['-', '-', '-']);
    // No tally is printed for a session that was never asked for a reason.
    const summary = await page.locator('#print-summary').textContent();
    expect(summary).not.toContain('Reasons:');
  });

test('the note field asks for no names', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  // apps/games/CLAUDE.md §5: nothing player-identifiable belongs on the device,
  // and a free-text field is the one place a technician could put a name.
  await expect(page.locator('#rationale-note-label')).toContainText('no names');
  await expect(page.locator('#rationale-note')).toHaveAttribute('maxlength', '200');
});
