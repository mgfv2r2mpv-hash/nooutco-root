import { test, expect } from '@playwright/test';

// A moved sentence is not a deleted one, and the diff could not tell them apart.
//
// The expert is going to start putting misfiled content into the section that
// owns it, and restructuring a narrative without changing its temporal order.
// Both of those are moves. Shown through the old word-level diff they read as
// the technician's sentence being thrown away in one place and a stranger's
// sentence appearing in another.
//
// Word level was also the wrong granularity for it. LCS over a reordered
// paragraph yields alternating single-word insertions and deletions with no run
// longer than one word, so nothing pairable ever forms and the rendering is
// shrapnel. Measured on the three-sentence reorder below: 32 ops, longest run
// one word. Sentence-level alignment makes the same case two ops.
//
// This module decides only that a move happened and which two ends belong
// together. How each end is drawn is the renderer's, and is still open.

const BT_PAGE = '/notes/bt/index.html';

const ready = async (page) => {
  await page.goto(BT_PAGE);
  await page.waitForFunction(() => !!window.NoteDiff);
};

const sections = (page, before, after) =>
  page.evaluate(([b, a]) => window.NoteDiff.sections(b, a), [before, after]);

const marks = (ops) => ops.filter((o) => o.type !== 'same');

const S1 = 'Client engaged in screaming and staff redirected neutrally to FCR.';
const S2 = 'Episodes were shorter and less intense than previous sessions.';
const S3 = 'Staff reinforced the alternative response each time it occurred.';

test.describe('a sentence that changed place is a move', () => {
  test('reordering within one section is one move, not a rewrite', async ({ page }) => {
    await ready(page);
    const out = await sections(page, { b: `${S1} ${S2} ${S3}` }, { b: `${S2} ${S1} ${S3}` });
    const m = marks(out.b);
    // The whole point: two ops, not the 32 the word-level diff produced.
    expect(m).toHaveLength(2);
    expect(m.map((o) => o.type).sort()).toEqual(['move-in', 'move-out']);
    expect(m[0].moveId).toBe(m[1].moveId);
  });

  test('a misfiled sentence moved between sections pairs across both', async ({ page }) => {
    await ready(page);
    const out = await sections(
      page,
      { antecedentNarrative: `Gave a two minute warning before transitions. ${S1}`, behaviorPlanNarrative: 'Two instances of aggression were observed.' },
      { antecedentNarrative: 'Gave a two minute warning before transitions.', behaviorPlanNarrative: `Two instances of aggression were observed. ${S1}` },
    );
    const source = marks(out.antecedentNarrative);
    const dest = marks(out.behaviorPlanNarrative);
    expect(source).toHaveLength(1);
    expect(dest).toHaveLength(1);
    expect(source[0].type).toBe('move-out');
    expect(dest[0].type).toBe('move-in');
    // Each end names the other, so a renderer can lead from one to the other
    // without searching the note for it.
    expect(source[0].to).toBe('behaviorPlanNarrative');
    expect(dest[0].from).toBe('antecedentNarrative');
    expect(source[0].moveId).toBe(dest[0].moveId);
  });

  test('both ends keep their text, because neither end lost anything', async ({ page }) => {
    await ready(page);
    const out = await sections(page, { a: `${S1} ${S2}`, b: 'Nothing here.' }, { a: S2, b: `Nothing here. ${S1}` });
    expect(marks(out.a)[0].text).toContain('redirected neutrally to FCR');
    expect(marks(out.b)[0].text).toContain('redirected neutrally to FCR');
  });
});

test.describe('what is deliberately not a move', () => {
  test('a run too short to be distinctive is left alone', async ({ page }) => {
    await ready(page);
    // "calm" appears in every note ever written. Pairing on it would invent
    // moves that never happened.
    const out = await sections(page, { a: 'Client was calm today.', b: 'Session ran long.' }, { a: 'Client was today.', b: 'Session ran long. calm' });
    const types = [].concat(marks(out.a), marks(out.b)).map((o) => o.type);
    expect(types).not.toContain('move-in');
    expect(types).not.toContain('move-out');
  });

  test('an unrelated replacement is a replacement', async ({ page }) => {
    await ready(page);
    const out = await sections(page, { a: 'Ran tacting with a gestural prompt.' }, { a: 'Nothing about this resembles the original at all.' });
    const types = marks(out.a).map((o) => o.type).sort();
    expect(types).toEqual(['del', 'ins']);
  });

  test('a rewritten sentence still gets word-level detail inside it', async ({ page }) => {
    await ready(page);
    // The case words() was always good at, and it must survive the change.
    const out = await sections(page, { a: 'The client did well with imitation today.' }, { a: 'The client required full prompts for imitation today.' });
    const m = marks(out.a);
    expect(m.length).toBeGreaterThan(2);
    expect(m.every((o) => o.type === 'ins' || o.type === 'del')).toBe(true);
    // "The client" and "imitation today." were untouched and must not be marked.
    const marked = m.map((o) => o.text).join(' ');
    expect(marked).not.toContain('imitation');
  });
});

test.describe('the property that makes it safe to accept', () => {
  test('taking every change reproduces the new text exactly', async ({ page }) => {
    await ready(page);
    const after = { x: `${S2} ${S1}` };
    const out = await sections(page, { x: `${S1} ${S2}` }, after);
    const rebuilt = out.x.filter((o) => o.type !== 'del' && o.type !== 'move-out').map((o) => o.text).join('');
    // Byte-exact, including the spacing between sentences. A diff that cannot
    // rebuild its own output cannot be trusted to apply one change of it.
    expect(rebuilt).toBe(after.x);
  });

  test('and words() is untouched, so the existing revision view still works', async ({ page }) => {
    await ready(page);
    const ops = await page.evaluate(() => window.NoteDiff.words('the client was calm', 'the client was upset'));
    expect(ops.map((o) => o.type)).toEqual(['same', 'del', 'ins']);
    expect(await page.evaluate(() => window.NoteDiff.changed('a b c', 'a b c'))).toBe(false);
  });
});
