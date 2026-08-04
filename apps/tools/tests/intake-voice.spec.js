import { test, expect } from '@playwright/test';

// Two changes aimed at the first draft, both from measurement rather than taste.
//
// Measured 2026-08-04: rewriting the register moved the uniformity score not at
// all, 26 under the old prompt and 26 under the new, on the same intake. Two
// rounds of the technician revising by hand took it to 16. The old prompt said
// "one idea per sentence" and produced 8.2-word sentences; the new said "name
// the actor" and produced 20.1-word ones. Both obeyed, both were uniform, and
// uniformity is the signal.
//
// So: peg a target to the technician's own writing today rather than to a house
// rule, and have the tool do the first revision itself instead of shipping a
// draft that needs one.

const M = (page, text) => page.evaluate((t) => window.IntakeVoice.measure(t), text);
const T = (page, text) => page.evaluate((t) => window.IntakeVoice.target(window.IntakeVoice.measure(t)), text);
const B = (page, text) => page.evaluate((t) => window.IntakeVoice.block(t), text);

const SHORTHAND = `DTT money program, 3 item array.
started full physical faded to gestural by trial 6.
8/12 correct. no SIB today.
elopement x2, blocked and redirected.
caregiver came in at end, asked about the AAC device at home.`;

const FLOWING = `The client came in settled today and we got straight to the money program without any of the usual negotiation at the door.
I started with full physical prompting because last week he was reaching for the wrong bill before I finished the instruction, and by the sixth trial he was orienting to the right one on his own so I faded to a gesture.
He eloped from the table twice, both times right after I presented the ten, which makes me think the array is too hard rather than the demand being too long.`;

test.beforeEach(async ({ page }) => {
  await page.goto('/notes/bt/');
  await page.waitForFunction(() => !!window.IntakeVoice);
});

test.describe('measuring what the technician actually typed', () => {
  test('shorthand is read as short sentences, not one long one', async ({ page }) => {
    // Intake is line-broken as often as it is punctuated. Splitting only on
    // full stops would report a mean nobody wrote.
    const m = await M(page, SHORTHAND);
    expect(m.sentences).toBeGreaterThan(3);
    expect(m.mean).toBeLessThan(12);
  });

  test('flowing prose is read as long sentences', async ({ page }) => {
    const m = await M(page, FLOWING);
    expect(m.mean).toBeGreaterThan(25);
  });

  test('it notices contractions and fragments, which are theirs', async ({ page }) => {
    const withContractions = await M(page, SHORTHAND + "\nhe's doing well with the timer, didn't need a second warning.");
    expect(withContractions.contractions).toBe(true);
    const m = await M(page, SHORTHAND);
    expect(m.fragments).toBeGreaterThan(0);
  });

  test('too little to read returns null rather than a made-up number', async ({ page }) => {
    expect(await M(page, 'elopement x2')).toBeNull();
    expect(await M(page, '')).toBeNull();
  });
});

test.describe('the target is pegged to them, but inside a clinical band', () => {
  test('shorthand is inflated rather than copied literally', async ({ page }) => {
    // His rule: pegged from the BT, inflated a bit if they are too brief. A
    // 6-word shorthand mean must not become a 6-word clinical note.
    const t = await T(page, SHORTHAND);
    const m = await M(page, SHORTHAND);
    expect(t.centre).toBeGreaterThan(m.median);
    expect(t.centre).toBeGreaterThanOrEqual(12);
  });

  test('run-on prose is pulled back rather than copied literally', async ({ page }) => {
    const t = await T(page, FLOWING);
    const m = await M(page, FLOWING);
    expect(t.centre).toBeLessThan(m.median);
    expect(t.centre).toBeLessThanOrEqual(24);
  });

  test('a longer writer still gets a higher target than a terse one', async ({ page }) => {
    // The whole point of pegging. If both landed on the same number this would
    // be a house rule wearing a measurement costume.
    const terse = await T(page, SHORTHAND);
    const flowing = await T(page, FLOWING);
    expect(flowing.centre).toBeGreaterThan(terse.centre);
  });

  test('the band is wide, because a single number is what caused this', async ({ page }) => {
    const t = await T(page, SHORTHAND);
    expect(t.high).toBeGreaterThan(t.low * 2);
  });
});

test.describe('the prompt block', () => {
  test('names a median and a range, not a rule', async ({ page }) => {
    const b = await B(page, SHORTHAND);
    expect(b).toMatch(/MEDIAN sentence of about \d+ words/);
    expect(b).toMatch(/some sentences near \d+ words, some near \d+/);
    // The reason, stated, because a rule without one gets optimised around.
    expect(b).toMatch(/sameness|same\s+length/i);
  });

  test('a thin intake asks for more rather than padding', async ({ page }) => {
    // His rule: inflate, "but not with filler - give prompts to get them to
    // give a little more".
    const b = await B(page, SHORTHAND);
    expect(b).toMatch(/Do not pad/i);
    expect(b).toMatch(/hint asking for the missing detail/i);
  });

  test('it mentions contractions only when they use them', async ({ page }) => {
    const without = await B(page, SHORTHAND);
    expect(without).not.toMatch(/contractions/i);
    const withThem = await B(page, SHORTHAND + "\nhe's settled, didn't need the second warning at all today.");
    expect(withThem).toMatch(/contractions/i);
  });

  test('nothing measurable means an empty block, so the note drafts as before', async ({ page }) => {
    expect(await B(page, 'elopement x2')).toBe('');
  });

  test('the block carries numbers, never the words it measured', async ({ page }) => {
    const b = await B(page, SHORTHAND);
    for (const word of ['elopement', 'caregiver', 'AAC', 'gestural', 'DTT']) {
      expect(b, `the block leaked "${word}" from the intake`).not.toContain(word);
    }
  });
});
