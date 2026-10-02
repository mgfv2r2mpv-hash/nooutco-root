import { test, expect } from '@playwright/test';

/* The word floor on the BT intake.
 *
 * Two things are held here. The numbers (65, 8 / 26 / 13 / 18, the gold line and
 * the five colours) are derived in scripts/min-words-model.mjs and carried by
 * notes/bcba/min-words.js, and the first block fails if the two ever disagree.
 * The second block drives the real page: a box is not painted until the
 * technician has been in it, it shifts from red toward green as the words come,
 * it turns gold a fragment past the floor, and Generate refuses a short intake
 * by showing every short box and moving the cursor to the one furthest short.
 */

const MinWords = require('../notes/bcba/min-words.js');

// The model script is an ES module and this package is CommonJS, so it is loaded
// with a real dynamic import (the Function wrapper keeps the transpiler from
// rewriting it into require).
const loadModel = new Function('p', 'return import(p)');
let buildModel, TOTAL_WORDS, WEIGHTS;
test.beforeAll(async () => {
  const url = require('node:url').pathToFileURL(require('node:path').join(__dirname, '../scripts/min-words-model.mjs')).href;
  ({ buildModel, TOTAL_WORDS, WEIGHTS } = await loadModel(url));
});

const BT_PAGE = '/notes/bt/index.html';
const BT_CFG = { total: 65, weights: { fSession: 2.5, fLesson: 8, fAntecedent: 4, fBehavior: 5.5 }, optional: ['fFollowUp'] };

// n distinct words, so the repeat rule in count() never trims them.
const words = (n, tag = 'w') => Array.from({ length: n }, (_, i) => `${tag}${i + 1}`).join(' ');

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

const rgb = (hex) => {
  const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${n.join(', ')})`;
};

const ready = async (page) => {
  await page.goto(BT_PAGE);
  await page.waitForFunction(() => !!window.MinWords && !!window.NOTE_TOOLS && window.NOTE_TOOLS.length > 0);
  await page.waitForSelector('#field-fLesson');
};

test.describe('the numbers match their derivation', () => {
  test('the minimums add to 65 and follow the weights', () => {
    const plan = MinWords.plan(BT_CFG);
    const model = buildModel();
    expect(TOTAL_WORDS).toBe(65);
    expect(WEIGHTS).toEqual(BT_CFG.weights);
    expect(plan.fields.map((f) => f.min).reduce((a, b) => a + b, 0)).toBe(65);
    model.sections.forEach((s) => {
      expect(plan.byId[s.id].min, `${s.id} minimum`).toBe(s.min);
      expect(plan.byId[s.id].gold, `${s.id} gold line`).toBe(s.gold);
    });
    // The two sections the clinical weight sits in are the two largest.
    const mins = Object.fromEntries(plan.fields.map((f) => [f.id, f.min]));
    expect(mins.fLesson).toBeGreaterThan(mins.fBehavior);
    expect(mins.fBehavior).toBeGreaterThan(mins.fAntecedent);
    expect(mins.fAntecedent).toBeGreaterThan(mins.fSession);
  });

  test('the five colours are the ones the model solved, and each clears 3:1', () => {
    const model = buildModel();
    ['red', 'orange', 'yellow', 'green', 'gold'].forEach((id) => {
      expect(MinWords.PALETTE[id], id).toBe(model.palette[id]);
    });
    model.contrastRows.forEach((r) => {
      expect(r.onBox, `${r.id} on the box`).toBeGreaterThanOrEqual(3);
      expect(r.onPage, `${r.id} on the page`).toBeGreaterThanOrEqual(3);
    });
    // The blend never dips under 3:1 on the way from red to green either.
    model.curve.forEach((c) => {
      expect(c.onBox, `p=${c.p}`).toBeGreaterThanOrEqual(3);
      expect(c.onPage, `p=${c.p}`).toBeGreaterThanOrEqual(3);
    });
  });

  test('the blend the page draws equals the blend the model draws', async () => {
    const model = buildModel();
    model.curve.forEach((c) => {
      expect(MinWords.colourFor(c.p), `p=${c.p}`).toBe(c.hex);
    });
  });

  test('the gold margin is one fragment, and the fragment is what the form shows', () => {
    const model = buildModel();
    expect(MinWords.FRAGMENT_WORDS).toBe(model.fragment.median);
    expect(MinWords.GOLD_FRACTION).toBe(0.2);
  });
});

test.describe('counting', () => {
  test('bullets, arrows and lone dashes are not words', () => {
    expect(MinWords.count('- offered a choice\n- used first-then → worked')).toBe(6);
    expect(MinWords.count('   ')).toBe(0);
    expect(MinWords.count('')).toBe(0);
    expect(MinWords.count(null)).toBe(0);
  });

  test('a hyphenated word and a measure are one word each', () => {
    expect(MinWords.count('face-to-face x2 3-item')).toBe(3);
  });

  test('a word typed over and over counts once', () => {
    expect(MinWords.count('ok ok ok ok ok')).toBe(1);
    expect(MinWords.count('ok fine ok fine')).toBe(4);
  });
});

test.describe('reading an intake against the plan', () => {
  const plan = MinWords.plan(BT_CFG);

  test('a long lesson cannot make up for a missing antecedent', () => {
    const r = MinWords.read(plan, { fSession: words(8), fLesson: words(200), fAntecedent: '', fBehavior: words(18) });
    expect(r.filled).toBe(8 + 26 + 0 + 18);
    expect(r.ready).toBe(false);
    expect(r.remaining).toBe(13);
  });

  test('ready exactly when every section has met its floor', () => {
    const r = MinWords.read(plan, { fSession: words(8), fLesson: words(26), fAntecedent: words(13), fBehavior: words(18) });
    expect(r.ready).toBe(true);
    expect(r.filled).toBe(65);
    expect(r.color).toBe(MinWords.PALETTE.green);
  });

  test('every section a fragment past its floor reads gold, and so does the bar', () => {
    const r = MinWords.read(plan, {
      fSession: words(14), fLesson: words(32), fAntecedent: words(19), fBehavior: words(24),
    });
    Object.values(r.fields).filter((f) => f.state !== 'optional').forEach((f) => expect(f.state, f.id).toBe('gold'));
    expect(r.color).toBe(MinWords.PALETTE.gold);
  });

  test('the follow-up box is counted but has no floor', () => {
    const r = MinWords.read(plan, { fSession: words(8), fLesson: words(26), fAntecedent: words(13), fBehavior: words(18), fFollowUp: '' });
    expect(r.fields.fFollowUp.state).toBe('optional');
    expect(r.ready).toBe(true);
  });

  test('shortfall names the sections furthest short first', () => {
    const s = MinWords.shortfall(plan, { fSession: words(8), fLesson: words(10), fAntecedent: words(12), fBehavior: '' }, (id) => id);
    expect(s.map((x) => x.id)).toEqual(['fBehavior', 'fLesson', 'fAntecedent']);
    expect(s[0].remaining).toBe(18);
  });
});

test.describe('the intake on the page', () => {
  test('nothing is outlined before anyone has been in a box', async ({ page }) => {
    await ready(page);
    await expect(page.locator('#field-fLesson')).not.toHaveAttribute('data-word-state', /.+/);
    await expect(page.locator('[data-word-count="fLesson"]')).toContainText('0 / 26 words');
    await expect(page.locator('[data-word-count="fFollowUp"]')).toContainText('0 words');
    await expect(page.locator('[data-ready-bar]')).toContainText('65 more words to go');
  });

  test('clicking into a box outlines it red, and it stays red after she leaves', async ({ page }) => {
    await ready(page);
    const box = page.locator('#field-fLesson');
    await box.click();
    const border = () => box.evaluate((el) => getComputedStyle(el).borderTopColor);
    await expect(box).toHaveAttribute('data-word-state', 'short');
    // Polled: the border eases in over the colour transition.
    await expect.poll(border).toBe(rgb(MinWords.PALETTE.red));
    await page.locator('#field-fAntecedent').click();
    await expect(box).toHaveAttribute('data-word-state', 'short');
    await expect.poll(border).toBe(rgb(MinWords.PALETTE.red));
  });

  test('the outline moves toward green as words arrive, and is green at the floor', async ({ page }) => {
    await ready(page);
    const box = page.locator('#field-fLesson');
    const colourAt = async (n) => {
      await box.fill(words(n));
      return box.evaluate((el) => getComputedStyle(el).borderTopColor);
    };
    // The 250ms colour transition has to settle before a computed colour is read.
    const settled = async (n) => { const c = await colourAt(n); await page.waitForTimeout(320); return box.evaluate((el) => getComputedStyle(el).borderTopColor); };
    const early = await settled(3);
    const mid = await settled(15);
    const full = await settled(26);
    expect(new Set([early, mid, full]).size).toBe(3);
    expect(full).toBe(rgb(MinWords.PALETTE.green));
    await expect(box).toHaveAttribute('data-word-state', 'met');
    await expect(page.locator('[data-word-count="fLesson"]')).toContainText('enough to write from');
  });

  test('a fragment past the floor turns the box gold', async ({ page }) => {
    await ready(page);
    const box = page.locator('#field-fLesson');
    await box.fill(words(32));
    await expect(box).toHaveAttribute('data-word-state', 'gold');
    await page.waitForTimeout(320);
    expect(await box.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(rgb(MinWords.PALETTE.gold));
    await expect(page.locator('[data-word-count="fLesson"]')).toContainText('plenty to write from');
  });

  test('the ready bar fills with each section capped at its own floor', async ({ page }) => {
    await ready(page);
    const bar = page.locator('[role="progressbar"]');
    await page.locator('#field-fLesson').fill(words(100));
    await expect(bar).toHaveAttribute('aria-valuenow', '26');
    await page.locator('#field-fSession').fill(words(8));
    await expect(bar).toHaveAttribute('aria-valuenow', '34');
    await expect(page.locator('[data-ready-bar]')).toContainText('31 more words to go');
    await page.locator('#field-fAntecedent').fill(words(13));
    await page.locator('#field-fBehavior').fill(words(18));
    await expect(bar).toHaveAttribute('aria-valuenow', '65');
    await expect(page.locator('[data-ready-bar]')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('[data-ready-bar]')).toContainText('Ready to generate');
  });

  test('Generate on a short intake lists the short boxes, outlines them all, and goes to the worst', async ({ page }) => {
    // Signed in, because logged out the button is "Log in" and never reaches the check.
    await page.goto(BT_PAGE);
    await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
    await ready(page);
    await page.locator('#field-fLesson').fill(words(10));
    await page.locator('#field-fAntecedent').fill(words(12));
    // Nothing has been clicked into on the other two, so they are not outlined yet.
    await expect(page.locator('#field-fBehavior')).not.toHaveAttribute('data-word-state', /.+/);
    // Forced: the button is aria-disabled on purpose (it stays clickable so the
    // click can explain itself), and Playwright treats that as not enabled.
    await page.getByRole('button', { name: 'Generate Note' }).click({ force: true });
    const msg = page.locator('p', { hasText: 'A little more from you first' });
    await expect(msg).toContainText('Skill Acquisition / Lesson Progress: 16 more words');
    await expect(msg).toContainText('Behavior & Staff Response: 18 more words');
    await expect(msg).toContainText('Antecedent Strategies: 1 more word');
    await expect(msg).toContainText('Session Start & Context: 8 more words');
    await expect(msg).not.toContainText('Follow-Up');
    // Every short box is now outlined, including the two nobody had been in.
    for (const id of ['fSession', 'fLesson', 'fAntecedent', 'fBehavior']) {
      await expect(page.locator('#field-' + id)).toHaveAttribute('data-word-state', 'short');
    }
    // The cursor is in the box furthest short.
    await expect(page.locator('#field-fBehavior')).toBeFocused();
    // Nothing was sent: the refusal is local.
    await expect(page.locator('button', { hasText: 'Generating' })).toHaveCount(0);
  });

  test('the button looks and announces itself as not ready until the floor is met', async ({ page }) => {
    await page.goto(BT_PAGE);
    await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
    await ready(page);
    const btn = page.getByRole('button', { name: 'Generate Note' });
    await expect(btn).toHaveAttribute('aria-disabled', 'true');
    await page.locator('#field-fSession').fill(words(8));
    await page.locator('#field-fLesson').fill(words(26));
    await page.locator('#field-fAntecedent').fill(words(13));
    await page.locator('#field-fBehavior').fill(words(18));
    await expect(btn).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('validate passes an intake at the floor and names nothing', async ({ page }) => {
    await ready(page);
    const err = await page.evaluate((w) => window.NOTE_TOOLS.find((t) => t.id === 'bt').validate(w), {
      fSession: words(8), fLesson: words(26), fAntecedent: words(13), fBehavior: words(18),
    });
    expect(err).toBeNull();
  });
});

test.describe('the follow-up sentence when there is nothing for the BCBA', () => {
  const FULL = { fSession: words(8, 's'), fLesson: words(26, 'l'), fAntecedent: words(13, 'a'), fBehavior: words(18, 'b') };

  test('a blank box and "N/A" both hand the model a sentence to write', async ({ page }) => {
    await ready(page);
    const prompts = await page.evaluate((f) => {
      const bt = window.NOTE_TOOLS.find((t) => t.id === 'bt');
      return ['', 'N/A', 'none', 'No new concerns this session', 'nothing'].map((fu) => bt.buildUserPrompt({ ...f, fFollowUp: fu }));
    }, FULL);
    prompts.forEach((p) => expect(p).toMatch(/Write followUpNarrative as exactly this sentence/));
  });

  test('the old stiff default is gone from the prompt and from the pool', async ({ page }) => {
    await ready(page);
    const all = await page.evaluate((f) => {
      const bt = window.NOTE_TOOLS.find((t) => t.id === 'bt');
      const seen = [];
      for (let i = 0; i < 60; i++) seen.push(bt.buildUserPrompt({ ...f, fLesson: f.fLesson + ' v' + i, fFollowUp: '' }));
      return seen;
    }, FULL);
    all.forEach((p) => {
      expect(p).not.toMatch(/No new questions or concerns/i);
      expect(p).not.toMatch(/no new reported concerns/i);
    });
  });

  test('different notes get different sentences, and one note always gets the same one', async ({ page }) => {
    await ready(page);
    const { distinct, stable } = await page.evaluate((f) => {
      const bt = window.NOTE_TOOLS.find((t) => t.id === 'bt');
      const pick = (v) => /exactly this sentence and nothing else: "([^"]+)"/.exec(bt.buildUserPrompt(v))[1];
      const picks = [];
      for (let i = 0; i < 60; i++) picks.push(pick({ ...f, fLesson: f.fLesson + ' v' + i, fFollowUp: '' }));
      const once = pick({ ...f, fFollowUp: '' });
      return { distinct: new Set(picks).size, stable: [1, 2, 3, 4, 5].every(() => pick({ ...f, fFollowUp: '' }) === once) };
    }, FULL);
    expect(distinct).toBeGreaterThanOrEqual(8);
    expect(stable).toBe(true);
  });

  test('a real concern is passed through and no sentence is forced on it', async ({ page }) => {
    await ready(page);
    const p = await page.evaluate((f) => window.NOTE_TOOLS.find((t) => t.id === 'bt').buildUserPrompt({ ...f, fFollowUp: 'Parent asked about the schedule for next week' }), FULL);
    expect(p).toContain('Parent asked about the schedule for next week');
    expect(p).not.toMatch(/exactly this sentence/);
  });
});

test.describe('what the prompt tells the model', () => {
  const read = (page) => page.evaluate(() => {
    const bt = window.NOTE_TOOLS.find((t) => t.id === 'bt');
    return { system: bt.buildSystem(), triage: bt.triageSystem, labeled: bt.buildLabeledPrompt({}) };
  });

  test('BT or staff, never "the behavior technician" as the example register', async ({ page }) => {
    await ready(page);
    const { system } = await read(page);
    expect(system).toMatch(/Name the actor \\?"BT\\?" or \\?"staff\\?"/);
    expect(system).not.toMatch(/The behavior technician implemented/);
    expect(system).not.toMatch(/\\"The behavior technician ran mixed trials\\"/);
    // The phrase may still appear, but only as the thing it forbids.
    const uses = system.match(/the behavior technician/gi) || [];
    uses.forEach(() => expect(system).toMatch(/NEVER write \\?"the behavior technician\\?"/));
  });

  test('a program is never declared complete and a plan is never invented', async ({ page }) => {
    await ready(page);
    const { system } = await read(page);
    expect(system).toMatch(/WHAT THE NOTE MAY CLAIM/);
    expect(system).toMatch(/Never write that a program, target or goal is complete, mastered/);
    expect(system).toMatch(/never write a plan or a next step/);
  });

  test('prompting is "independently" or "with prompts" and the direction, not a prompt type', async ({ page }) => {
    await ready(page);
    const { system } = await read(page);
    expect(system).toMatch(/\\?"independently\\?" or \\?"with prompts\\?"/);
    expect(system).not.toMatch(/Name prompt types specifically/);
  });

  test('no behavior, and a strategy that failed, each have their shape', async ({ page }) => {
    await ready(page);
    const { system } = await read(page);
    expect(system).toMatch(/WHEN NO BEHAVIOR OF CONCERN OCCURRED/);
    expect(system).toMatch(/effective in reducing its frequency/);
    expect(system).toMatch(/WHEN A STRATEGY DID NOT WORK/);
    expect(system).toMatch(/ABC data/);
    expect(system).toMatch(/preference assessment/);
  });

  test('triage asks for direction, and for a second antecedent without forcing one', async ({ page }) => {
    await ready(page);
    const { triage } = await read(page);
    expect(triage).toMatch(/A PROGRAM WITH NO DIRECTION/);
    expect(triage).toMatch(/Never ask for a prompt type or a count/);
    expect(triage).toMatch(/FEWER THAN TWO ANTECEDENT STRATEGIES/);
    expect(triage).toMatch(/only one, that is a complete answer/);
    expect(triage).toMatch(/A STRATEGY THAT DID NOT WORK, WITH NOTHING AFTER IT/);
  });
});
