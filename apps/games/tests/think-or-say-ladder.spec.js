// @ts-check
/**
 * Think or Say? - the Why ladder keeps "higher rules win" on every card.
 *
 * The Learn screen tells the learner that higher rules win. The ladder shown
 * after a correct answer has to agree with that on every authored card, so
 * this walks all three pools as the page loads them:
 *   * exactly one row decides it;
 *   * the decider is not a weak row (truth) and not a gate that only removes
 *     a reason ("not private") unless nothing else could decide;
 *   * no row pulling AGAINST the answer sits above the decider - a higher
 *     rule never loses. A gate that held on a THINK card is `met`, and a rule
 *     the card declares does not apply here is `moot`, never `against`.
 */
import { test, expect } from '@playwright/test';

const URL = '/think-or-say/';

async function allLadders(page) {
  return page.evaluate(() => {
    const T = window.__thinkOrSay;
    const out = [];
    [1, 2, 3].forEach(lv => T.level(lv).cards.forEach(c => {
      out.push({ id: c.id, answer: c.answer, whyMoot: c.whyMoot || null, rows: T.whyLadder(c) });
    }));
    return out;
  });
}

test('every card has one decider and no higher rule pulling against it', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator('#sel-category option').first()).toHaveText('All categories');
  const cards = await allLadders(page);
  expect(cards.length).toBeGreaterThan(100);

  const problems = [];
  for (const c of cards) {
    const deciders = c.rows.filter(r => r.decides);
    if (deciders.length !== 1) { problems.push(`${c.id}: ${deciders.length} deciders`); continue; }
    const d = c.rows.findIndex(r => r.decides);
    const dec = c.rows[d];
    if (dec.weak) problems.push(`${c.id}: decided by weak row ${dec.dim}`);
    if (dec.stance !== 'agree') problems.push(`${c.id}: decider stance ${dec.stance}`);
    c.rows.slice(0, d).filter(r => r.stance === 'against')
      .forEach(r => problems.push(`${c.id}: ${r.dim} pulls against, above ${dec.dim}`));
    // A fallback gate ("not private") decides only when no other agreeing
    // rule could: nothing else agrees, or a live against-row sits above it.
    if (dec.gate && dec.value === 'not-private') {
      const other = c.rows.findIndex(r => r.stance === 'agree' && !r.weak && r !== dec);
      const firstAgainst = c.rows.findIndex(r => r.stance === 'against');
      if (other >= 0 && (firstAgainst < 0 || other < firstAgainst)) {
        problems.push(`${c.id}: "not private" decides although ${c.rows[other].dim} could`);
      }
    }
  }
  expect(problems).toEqual([]);
});

test('gates never push against, and neutral rows stay neutral', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator('#sel-category option').first()).toHaveText('All categories');
  const cards = await allLadders(page);
  const bad = [];
  for (const c of cards) {
    for (const r of c.rows) {
      if (r.gate && c.answer === 'think' && r.stance !== 'met') bad.push(`${c.id}: gate ${r.dim} is ${r.stance}`);
      if (r.gate && !r.decides && !r.weak) bad.push(`${c.id}: non-deciding gate ${r.dim} not weak`);
      if (r.lean === null && r.stance !== 'neutral') bad.push(`${c.id}: ${r.dim} has no lean but is ${r.stance}`);
      if (r.stance === 'met' && (r.outranked || r.decides)) bad.push(`${c.id}: met row ${r.dim} marked`);
      if (r.stance === 'moot' && (r.outranked || r.decides)) bad.push(`${c.id}: moot row ${r.dim} marked`);
    }
    // A moot note is honoured, and only on a rule that would otherwise sit
    // above the decider pulling against it.
    for (const dim of Object.keys(c.whyMoot || {})) {
      const i = c.rows.findIndex(r => r.dim === dim);
      const d = c.rows.findIndex(r => r.decides);
      if (i < 0 || c.rows[i].stance !== 'moot') bad.push(`${c.id}: whyMoot ${dim} not shown moot`);
      else if (i > d) bad.push(`${c.id}: whyMoot ${dim} sits below the decider; it is just outranked`);
      else if (c.rows[i].chip !== c.whyMoot[dim]) bad.push(`${c.id}: moot chip not the card's note`);
    }
  }
  expect(bad).toEqual([]);
});

test('the evaluated cards read the way higher rules win', async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator('#sel-category option').first()).toHaveText('All categories');
  const byId = Object.fromEntries((await allLadders(page)).map(c => [c.id, c]));
  const row = (id, dim) => byId[id].rows.find(r => r.dim === dim);
  const decider = id => byId[id].rows.find(r => r.decides).dim;

  for (const id of ['L1-08', 'L1-40', 'L2-34', 'L3-07']) {
    expect(row(id, 'changeability').stance, id).toBe('met');
    expect(decider(id), id).toBe('audience');
  }
  expect(row('L2-10', 'changeability').stance).toBe('met');
  expect(decider('L2-10')).toBe('timing');
  expect(row('L3-10', 'privacy').stance).toBe('met');
  expect(decider('L3-10')).toBe('timing');
  for (const id of ['L1-09', 'L2-09', 'L3-08']) {
    expect(row(id, 'privacy').stance, id).toBe('moot');
  }
  expect(decider('L3-04')).not.toBe('privacy');
  // "They can fix it now" is still the reason on a SAY card where it answers
  // "it would hurt".
  expect(decider('L2-05')).toBe('changeability');
  expect(row('L2-05', 'selfEsteem').outranked).toBe(true);
});
