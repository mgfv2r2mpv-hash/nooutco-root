import { test, expect } from '@playwright/test';

/**
 * ════════════════════════════════════════════════════════════════════════
 * think-or-say: the generalization-probe subsystem
 *
 * A PROBE is an untrained item run WITHOUT the instructional supports, so that a
 * correct response is evidence about the repertoire rather than about the prompt
 * (RESEARCH.md §4.2). Everything asserted here follows from that one sentence:
 *
 *   * probes are OFF unless a plan asks for them, and are configured PER LEVEL
 *   * on a probe trial, auto-prompt, errorless, the reason reveal and
 *     re-presentation are all withheld — but the Prompt BUTTON stays live,
 *     because clinical judgement is never blocked
 *   * a prompt delivered on a probe does not void the trial; it RE-CLASSIFIES it
 *     as a trained one, with the reason recorded
 *   * a generalization datum is written ONCE per item; every later run of that
 *     item is an ordinary trained trial, marked as a re-exposure
 *   * tags are a SET — near / far / deictic combine — and the report groups by
 *     the EXACT set, never by individual tag, because a far+deictic result
 *     counted under both would report four trials as eight
 *
 * The learner scope is three opaque letters. There is no name field anywhere in
 * this feature and this spec asserts that there is not: apps/games/CLAUDE.md §5
 * forbids player-identifiable data on the device.
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

/** A session with this level's probe block switched on. */
const probing = (level, over = {}) => ({
  level, category: 'all', order: 'sequential',
  showReason: true, represent: true, errorless: true,
  autoPrompt: false, counterbalance: false,
  ['probes' + level]: true,
  ['probeCount' + level]: 3,
  ['probePlacement' + level]: 'before',
  ...over,
});

const session = page => page.evaluate(() => window.__thinkOrSay.session());
const settings = page => page.evaluate(() => window.__thinkOrSay.settings());

/** Answer the card at deck position `i`, optionally prompting first. */
async function answerTrial(page, i, { prompt = false, errFirst = false } = {}) {
  const deck = (await session(page)).deck;
  const right = deck[i].answer;
  const wrong = right === 'think' ? 'say' : 'think';
  await page.locator('#reveal-panel').click();
  await expect(page.locator('#choices')).toBeVisible();
  if (prompt) await page.locator('#btn-prompt').click();
  if (errFirst) await page.locator(`#choices .choice[data-answer="${wrong}"]`).click();
  await page.locator(`#choices .choice[data-answer="${right}"]`).click();
  // A Level 3 trial is not over at the tile: the reason is the target, and the
  // trial does not advance until the technician has scored what was said. The
  // walk scores every one Correct, which is the case that must not be allowed to
  // change the probe classification — that is decided by supports, not by score.
  const rationale = page.locator('#rationale-panel');
  if (await rationale.isVisible()) {
    await page.locator('#rationale-scores button[data-score="correct"]').click();
  }
  const next = page.locator('#btn-next');
  if (await next.count()) await next.click();
}

/** Play a whole session out. `promptAt` names deck positions to prompt on. */
async function walkSession(page, promptAt = []) {
  // The deck can grow (a missed teaching card is re-presented once), so the
  // bound is re-read each time rather than captured up front.
  for (let i = 0; ; i++) {
    const total = (await session(page)).deck.length;
    if (i >= total) break;
    await answerTrial(page, i, { prompt: promptAt.indexOf(i) >= 0 });
  }
  return (await session(page)).results;
}

// ── Defaults, and where the block lives ────────────────────────────────────

test('probes are off by default at every level, and each level has its own block', async ({ page }) => {
  await page.goto(URL);
  await booted(page);

  const { defaults, fields, controls } = await settings(page);
  for (const L of [1, 2, 3]) {
    expect(defaults['probes' + L], `level ${L} probes default`).toBe(false);
    expect(defaults['probeCount' + L]).toBe(3);
    expect(defaults['probePlacement' + L]).toBe('interleaved');
    expect(defaults['probeTokens' + L], `level ${L} tokens on probes`).toBe(true);
    expect(Array.isArray(defaults['probeTags' + L]), `level ${L} tags are a set`).toBe(true);
  }
  // Level 3 items are all deictic — the response required there is a spoken
  // rationale — so a Level 3 selection without it would put nothing in play.
  expect(defaults.probeTags3).toContain('deictic');
  expect(defaults.probeTags1).not.toContain('deictic');

  // One panel row per persisted option, probe options included.
  expect(controls.slice().sort()).toEqual(fields.slice().sort());
  expect(new Set(controls).size, 'no option is edited by two controls').toBe(controls.length);

  // Off means off: the deck is the teaching pool and nothing else.
  const lv1 = await page.evaluate(() => window.__thinkOrSay.level(1).cards.length);
  await page.locator('#btn-play').click();
  await expect(page.locator('#progress-label')).toHaveText(`Card 1 of ${lv1}`);
  expect((await session(page)).deck.some(c => c.isProbe)).toBe(false);
  await expect(page.locator('#probe-banner')).toBeHidden();
});

test('the probe block on screen is the one for the level in play', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-extra-toggle').click();

  await expect(page.locator('#probe-level-label')).toHaveText('Level 1');
  await expect(page.locator('#probe-level-1')).toBeVisible();
  await expect(page.locator('#probe-level-2')).toBeHidden();
  await expect(page.locator('#probe-level-3')).toBeHidden();

  await page.locator('#sel-level').selectOption('3');
  await expect(page.locator('#probe-level-label')).toHaveText('Level 3');
  await expect(page.locator('#probe-level-3')).toBeVisible();
  await expect(page.locator('#probe-level-1')).toBeHidden();

  // A level keeps its own block. Switching away and back does not reset it, and
  // switching a level on does not switch the others on.
  await page.locator('#chk-probes-3').check();
  await page.locator('#sel-level').selectOption('1');
  await expect(page.locator('#chk-probes-1')).not.toBeChecked();
  await page.locator('#sel-level').selectOption('3');
  await expect(page.locator('#chk-probes-3')).toBeChecked();

  const { cfg } = await settings(page);
  expect(cfg.probes3).toBe(true);
  expect(cfg.probes1).toBe(false);
  expect(cfg.probes2).toBe(false);
});

// ── Tagging ────────────────────────────────────────────────────────────────

test('tags are a combinable set with one canonical spelling per set', async ({ page }) => {
  await page.goto(URL);
  await booted(page);

  const seen = await page.evaluate(() => {
    const P = window.__thinkOrSay.probes;
    const out = {};
    for (const level of [1, 2, 3]) {
      const pool = P.poolFor(level);
      out[level] = {
        size: pool.length,
        keys: Array.from(new Set(pool.map(i => i.tagKey))).sort(),
        canonical: pool.every(i => i.tagKey === P.tagKey(i.probeTags)),
        // The spelling does not depend on the order the caller happens to hold.
        orderFree: pool.every(i => P.tagKey(i.probeTags.slice().reverse()) === i.tagKey),
        known: pool.every(i => i.probeTags.every(t => P.TAGS.indexOf(t) >= 0)),
        tagged: pool.every(i => i.probeTags.length > 0),
      };
    }
    return out;
  });

  for (const level of [1, 2, 3]) {
    expect(seen[level].size, `level ${level} probe pool is non-empty`).toBeGreaterThan(0);
    expect(seen[level].canonical, `level ${level} canonical key`).toBe(true);
    expect(seen[level].orderFree, `level ${level} order-free key`).toBe(true);
    expect(seen[level].known).toBe(true);
    expect(seen[level].tagged).toBe(true);
  }
  // near and far both occur at levels 1 and 2, or the tag distinguishes nothing.
  expect(seen[1].keys).toEqual(['far', 'near']);
  expect(seen[2].keys).toEqual(['far', 'near']);
  // Level 3 COMBINES: every item is deictic, and also near or far.
  expect(seen[3].keys).toEqual(['far+deictic', 'near+deictic']);
});

test('near and far are measured against what the level actually teaches', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  const check = await page.evaluate(() => {
    const P = window.__thinkOrSay.probes;
    const taught = window.__thinkOrSay.level(1).cards;
    return P.poolFor(1).map((it) => {
      const dim = it.dim;
      const value = it.features[dim];
      const same = taught.filter(c => c.features[dim] === value);
      // Every sampled can-have value that the teaching pool never pairs with
      // this criterial configuration.
      const novel = it.sampled.filter(k => !same.some(c => c.vary[k] === it.vary[k]));
      return { key: it.tagKey, novel: novel.length, sampled: it.sampled.length };
    });
  });
  expect(check.length).toBeGreaterThan(0);
  for (const it of check) {
    expect(it.sampled, 'a probe varies at least one surface feature').toBeGreaterThan(0);
    if (it.key === 'near') expect(it.novel, 'near means nothing untrained was sampled').toBe(0);
    else expect(it.novel, 'far means at least one untrained value was sampled').toBeGreaterThan(0);
  }
  expect(check.some(i => i.key === 'near')).toBe(true);
  expect(check.some(i => i.key === 'far')).toBe(true);
});

test('a tag selection puts in play only items whose whole set was selected', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  const counts = await page.evaluate(() => {
    const P = window.__thinkOrSay.probes;
    return {
      nearOnly: P.inPlay(1, ['near']).map(i => i.tagKey),
      farOnly: P.inPlay(1, ['far']).map(i => i.tagKey),
      l3WithoutDeictic: P.inPlay(3, ['near', 'far']).length,
      l3WithDeictic: P.inPlay(3, ['near', 'far', 'deictic']).length,
      none: P.inPlay(1, []).length,
    };
  });
  expect(counts.nearOnly.length).toBeGreaterThan(0);
  expect(new Set(counts.nearOnly)).toEqual(new Set(['near']));
  expect(new Set(counts.farOnly)).toEqual(new Set(['far']));
  // A Level 3 item carries deictic as well, so selecting only near/far selects
  // nothing at all — the subset rule, as an observable consequence.
  expect(counts.l3WithoutDeictic).toBe(0);
  expect(counts.l3WithDeictic).toBeGreaterThan(0);
  expect(counts.none).toBe(0);
});

test('a probe block samples across criterial dimensions, not off the top of one', async ({ page }) => {
  await page.goto(URL);
  await booted(page);
  const dims = await page.evaluate(() =>
    window.__thinkOrSay.probes.select(1, ['near', 'far'], 5, 0).map(i => i.dim));
  expect(dims.length).toBe(5);
  expect(new Set(dims).size, 'five probes turn on five different dimensions').toBe(5);
});

// ── Placement ──────────────────────────────────────────────────────────────

for (const [placement, describe] of [
  ['before', 'leads the deck'], ['after', 'trails the deck'], ['interleaved', 'is spread through it'],
]) {
  test(`placement "${placement}": the probe block ${describe}`, async ({ page }) => {
    // A category with a long teaching deck: "interleaved" only has room to mean
    // anything when there are more teaching cards than probes to spread between.
    await seed(page, probing(1, { probePlacement1: placement, probeCount1: 2, category: 'kind' }));
    await page.goto(URL);
    await booted(page);
    await page.locator('#btn-play').click();
    const deck = (await session(page)).deck;
    const at = deck.map((c, i) => (c.isProbe ? i : -1)).filter(i => i >= 0);
    expect(at.length).toBe(2);
    if (placement === 'before') expect(at).toEqual([0, 1]);
    else if (placement === 'after') expect(at).toEqual([deck.length - 2, deck.length - 1]);
    else {
      expect(at[0], 'not bunched at the front').toBeGreaterThan(0);
      expect(at[1], 'not bunched at the back').toBeLessThan(deck.length - 1);
      expect(at[1] - at[0], 'not adjacent to each other either').toBeGreaterThan(1);
    }
  });
}

// ── Suppression ────────────────────────────────────────────────────────────

test('a probe trial withholds the supports and says so on screen', async ({ page }) => {
  await seed(page, probing(1, {
    probeCount1: 1, category: 'looks',
    errorless: true, showReason: true, autoPrompt: true, promptDelay: false,
  }));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();

  await expect(page.locator('#probe-banner')).toBeVisible();
  await expect(page.locator('#probe-banner')).toContainText('supports off');

  const deck = (await session(page)).deck;
  expect(deck[0].isProbe).toBe(true);
  const right = deck[0].answer;
  const wrong = right === 'think' ? 'say' : 'think';

  await page.locator('#reveal-panel').click();
  await expect(page.locator('#choices')).toBeVisible();

  // AUTO-PROMPT is on in the configuration and suppressed here: no tile lights
  // up, however long the learner takes.
  await page.waitForTimeout(400);
  await expect(page.locator('#choices .choice.prompt-sparkle')).toHaveCount(0);
  await expect(page.locator('#choices .choice.prompt-outline')).toHaveCount(0);

  // ERRORLESS is on and suppressed: the wrong tile stays live after an error,
  // and no prompt is delivered off the back of it.
  await page.locator(`#choices .choice[data-answer="${wrong}"]`).click();
  await expect(page.locator(`#choices .choice[data-answer="${wrong}"]`)).toBeEnabled();
  await expect(page.locator('#choices .choice.prompt-sparkle')).toHaveCount(0);

  // The Prompt BUTTON is live throughout — clinical judgement is never blocked.
  await expect(page.locator('#btn-prompt')).toBeEnabled();

  await page.locator(`#choices .choice[data-answer="${right}"]`).click();
  // THE REASON REVEAL is on and suppressed.
  await expect(page.locator('#scenario-reason')).toBeHidden();

  const rows = (await session(page)).results;
  expect(rows[0].prompted, 'an error is not a delivered support').toBe(false);
  expect(rows[0].trialClass).toBe('generalization');
});

test('a teaching trial in the same session keeps every support', async ({ page }) => {
  await seed(page, probing(1, {
    probeCount1: 1, category: 'looks', errorless: true, showReason: true,
  }));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();

  await answerTrial(page, 0);                       // the probe

  await expect(page.locator('#probe-banner')).toBeHidden();
  const deck = (await session(page)).deck;
  const right = deck[1].answer;
  const wrong = right === 'think' ? 'say' : 'think';
  await page.locator('#reveal-panel').click();
  await page.locator(`#choices .choice[data-answer="${wrong}"]`).click();
  // Errorless is back: the wrong tile is disabled and the correct one prompted.
  await expect(page.locator(`#choices .choice[data-answer="${wrong}"]`)).toBeDisabled();
  await expect(page.locator(`#choices .choice[data-answer="${right}"]`)).toHaveClass(/prompt-sparkle/);
  await page.locator(`#choices .choice[data-answer="${right}"]`).click();
  await expect(page.locator('#scenario-reason')).toBeVisible();
});

// ── Lifecycle ──────────────────────────────────────────────────────────────

test('a clean probe writes one generalization datum; a prompted one is a trained trial', async ({ page }) => {
  await seed(page, probing(1, { probeCount1: 3, category: 'looks', showReason: false }));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();

  const deck = (await session(page)).deck;
  const at = deck.map((c, i) => (c.isProbe ? i : -1)).filter(i => i >= 0);
  expect(at.length).toBe(3);

  const rows = await walkSession(page, [at[1]]);    // prompt on the second probe

  const probes = rows.filter(r => r.probeTags);
  expect(probes.length, 'every probe trial is recorded').toBe(3);

  const clean = probes.filter(r => r.trialClass === 'generalization');
  expect(clean.length, 'two clean probes, two generalization data').toBe(2);
  expect(clean.every(r => r.probeNote === '')).toBe(true);

  const supported = probes.filter(r => r.trialClass === 'trained');
  expect(supported.length, 'the prompted probe is not a generalization datum').toBe(1);
  expect(supported[0].probeNote).toBe('prompt delivered');
  expect(supported[0].prompted).toBe(true);

  // Nothing is uncounted, and a teaching card carries no probe tags at all.
  expect(rows.every(r => r.trialClass === 'trained' || r.trialClass === 'generalization')).toBe(true);
  expect(rows.filter(r => !r.probeTags).every(r => r.trialClass === 'trained')).toBe(true);
  expect((await session(page)).probeSeen.length).toBe(3);
});

test('asking for more probes than exist re-runs items, and a re-run is a trained trial', async ({ page }) => {
  // The Level 1 privacy universe holds six generated items; the plan asks for
  // ten probe trials. The extra four are the same items again — recorded, and
  // recorded as trained re-exposures rather than as extra generalization data.
  await seed(page, probing(1, { probeCount1: 10, category: 'private', showReason: false }));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();

  const deck = (await session(page)).deck;
  const probes = deck.filter(c => c.isProbe);
  expect(probes.length, 'the block is the length the plan asked for').toBe(10);
  const distinct = new Set(probes.map(p => p.id));
  expect(distinct.size, 'and it holds fewer distinct items than that').toBeLessThan(10);

  const rows = await walkSession(page);
  const probeRows = rows.filter(r => r.probeTags);
  expect(probeRows.length).toBe(10);

  const gen = probeRows.filter(r => r.trialClass === 'generalization');
  expect(gen.length, 'one generalization datum per distinct item, no more').toBe(distinct.size);

  const repeats = probeRows.filter(r => r.probeNote === 're-exposure');
  expect(repeats.length).toBe(10 - distinct.size);
  expect(repeats.every(r => r.trialClass === 'trained')).toBe(true);
  // A re-exposure keeps the item's tags: it is the same question, asked again.
  expect(repeats.every(r => r.probeTags)).toBe(true);
});

// ── The report ─────────────────────────────────────────────────────────────

test('the report splits trained from generalization and groups by the exact tag set', async ({ page }) => {
  await seed(page, probing(3, { probeCount3: 4, category: 'looks', showReason: false }));
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();

  const at = (await session(page)).deck.map((c, i) => (c.isProbe ? i : -1)).filter(i => i >= 0);
  const rows = await walkSession(page, [at[0]]);    // one supported probe
  expect(rows.filter(r => r.probeTags).length).toBe(4);
  await expect(page.locator('#done-card')).toBeVisible();

  await expect(page.locator('#print-generalization')).not.toHaveAttribute('hidden', '');
  const table = await page.locator('#generalization-body tr').evaluateAll(trs =>
    trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent)));
  const buckets = table.map(r => r[0]);

  expect(buckets[0]).toBe('Trained');
  const genBuckets = buckets.filter(b => b.startsWith('Generalization'));
  expect(genBuckets.length).toBeGreaterThan(0);
  // Every generalization bucket names a whole tag SET. At Level 3 they all
  // carry deictic; none is a bare individual tag double-counting a combination.
  for (const b of genBuckets) expect(b).toContain('deictic');
  expect(new Set(genBuckets).size).toBe(genBuckets.length);
  // The supported probe is accounted for inside the trained bucket.
  expect(buckets.some(b => b.includes('prompt delivered'))).toBe(true);

  // Counts add up: trained + every generalization bucket = the whole session.
  const trained = Number(table[0][1]);
  const gen = table.filter(r => r[0].startsWith('Generalization'))
    .reduce((a, r) => a + Number(r[1]), 0);
  expect(trained + gen).toBe(rows.length);

  // The per-trial table carries the class and the tag set on every row.
  const cells = await page.locator('#results-body tr').evaluateAll(trs =>
    trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent)));
  expect(cells.length).toBe(rows.length);
  expect(cells.every(c => c[9] === 'Trained' || c[9] === 'Generalization')).toBe(true);
  expect(cells.filter(c => c[10].includes('deictic')).length).toBe(4);
});

test('a session with no probes prints no generalization block', async ({ page }) => {
  await seed(page, { level: 1, category: 'smells', order: 'sequential', showReason: false });
  await page.goto(URL);
  await booted(page);
  await page.locator('#btn-play').click();
  const rows = await walkSession(page);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every(r => r.trialClass === 'trained' && !r.probeTags)).toBe(true);
  await expect(page.locator('#print-generalization')).toHaveAttribute('hidden', '');
});

// ── Learner slots ──────────────────────────────────────────────────────────

test('the learner slots are three opaque letters, each holding its own settings', async ({ page }) => {
  await page.goto(URL);
  await booted(page);

  // No free-text field anywhere in the settings surface: nothing on this panel
  // can be made to hold a learner's name.
  const textish = await page.locator(
    '#settings-bar input[type=text], #settings-bar input:not([type]), #settings-bar textarea, ' +
    '#extra-panel input[type=text], #extra-panel input:not([type]), #extra-panel textarea').count();
  expect(textish, 'nothing on this panel takes a learner name').toBe(0);
  expect(await page.locator('#sel-learner option').allTextContents())
    .toEqual(['Learner A', 'Learner B', 'Learner C']);

  await page.locator('#btn-extra-toggle').click();
  await page.locator('#chk-probes-1').check();

  // Slot B has its own configuration, and adopting it does not disturb A's.
  await page.locator('#sel-learner').selectOption('B');
  await page.locator('#chk-probes-1').uncheck();
  await page.locator('#sel-learner').selectOption('A');
  await expect(page.locator('#sel-learner')).toHaveValue('A');
  await expect(page.locator('#chk-probes-1')).toBeChecked();

  await page.locator('#sel-learner').selectOption('B');
  await expect(page.locator('#chk-probes-1')).not.toBeChecked();

  // The slot survives a reload, and what is stored is a letter and nothing else.
  await page.reload();
  await booted(page);
  await expect(page.locator('#sel-learner')).toHaveValue('B');
  const stored = await page.evaluate(k => localStorage.getItem(k), STORE);
  expect(stored).toContain('Learner B');
  expect(JSON.parse(stored).sets['Learner A'].probes1).toBe(true);
  expect(JSON.parse(stored).sets['Learner B'].probes1).toBe(false);
});
