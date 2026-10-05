import { test, expect } from '@playwright/test';

/* KALEB'S ASSESSMENT NOTE, 2026-10-04: "decent okay quality on the merits but
 * 100% AI suspect and registers as generated rather than my voice". On the
 * merits it also ticked Client Observation and Review results with parent when
 * neither happened, invented a comparison ("unsupervised baseline"), and kept a
 * guess his own answer had overturned. Each test pins one fix in the prompt the
 * Assessment tool sends, or in the code that holds a pick. The last pins the
 * header every tool's answers ride under. */

async function assess(page) {
  await page.goto('/notes/bcba/index.html');
  await page.waitForFunction(() => (window.NOTE_TOOLS || []).some((t) => t.id === 'assess'));
}
const prompt = (page) => page.evaluate(() => {
  const t = window.NOTE_TOOLS.find((x) => x.id === 'assess');
  return t.buildSystem() + '\n' + t.buildUserPrompt({ summaryNotes: 'x' });
});

test.describe('the Assessment prompt carries each fix', () => {
  const RULES = [
    ['his own finished sentences are kept', /keep its subject, its verb and its order/],
    ['verbs, not nouns made from them', /"after supervision resumed", never "following resumption of supervision"/],
    ['no trailing -ing clause', /Never end a sentence on a trailing clause that opens with an -ing word/],
    ['the hedge sits inside the sentence', /"which suggests" or "consistent with", inside the sentence/],
    ['numbers go in Results only', /The numbers go in Results of Assessment only/],
    ['a comparison stays in the notes\' words', /never relabel it \("unsupervised baseline"\)/],
    ['an answer overrides what it corrects', /Where an answer to a follow-up question corrects the notes, write the answer's version and drop what it corrected/],
    ['Client Observation needs an observation in this service', /"Client Observation" only when BCBA observed the client during this service/],
    ['Review results with parent needs a parent in this service', /"Review results with parent" only when the notes say the results were gone over with a parent or caregiver/],
  ];
  for (const [name, re] of RULES) {
    test(name, async ({ page }) => {
      await assess(page);
      expect(await prompt(page)).toMatch(re);
    });
  }
});

test.describe('Review results with parent is held by code', () => {
  const norm = (page, raw, ctx) => page.evaluate(({ raw, ctx }) =>
    window.NOTE_TOOLS.find((t) => t.id === 'assess').normalizeOutput(raw, ctx), { raw, ctx });
  const PICKED = { activities: ['Functional Behavior Assessment', 'Review results with parent'], reporting: [], narrative: 'x', results: 'y', hints: [] };

  test('notes with no parent or caregiver in them cannot carry the pick, and a hint says so', async ({ page }) => {
    await assess(page);
    const out = await norm(page, PICKED, { intake: 'BCBA reviewed FBA data across the authorization and updated the background sections.' });
    expect(out.activities).toEqual(['Functional Behavior Assessment']);
    expect(out.hints.some((h) => /parent/i.test(h.detail || ''))).toBe(true);
  });

  test('notes that name a parent keep it', async ({ page }) => {
    await assess(page);
    const out = await norm(page, PICKED, { intake: 'Met with mom and dad for an hour to go over the results.' });
    expect(out.activities).toContain('Review results with parent');
  });

  test('without the intake (not a draft) the pick is left as it came', async ({ page }) => {
    await assess(page);
    const out = await norm(page, PICKED);
    expect(out.activities).toContain('Review results with parent');
  });
});

test('every tool reads an answer that corrects the notes as the version that stands', async ({ page }) => {
  await page.goto('/notes/bcba/index.html');
  await page.waitForFunction(() => typeof window.ANSWERS_HEADER === 'string');
  const header = await page.evaluate(() => window.ANSWERS_HEADER);
  expect(header).toContain('where an answer corrects the notes, the answer wins and what it corrected goes');
});
