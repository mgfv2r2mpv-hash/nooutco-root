import { test, expect } from '@playwright/test';

// A proposed rewrite is read as one run, not as word confetti.
//
// His screenshot, 2026-09-23: a reworded Behavior Analyst Follow Up drawn by
// the word-level diff alternated a struck word with its replacement down two
// full lines. "This is hard to read." NoteDiff.hunks() groups those ops into
// runs, and the Accept/Discard view draws a rewrite as its new wording on a
// candystripe with the old wording behind a tap.

const BT_PAGE = '/notes/bt/index.html';

const ready = async (page) => {
  await page.goto(BT_PAGE);
  await page.waitForFunction(() => !!window.NoteDiff && !!window.PendingDiff);
};

const hunks = (page, before, after) =>
  page.evaluate(([b, a]) => window.NoteDiff.hunks(b, a), [before, after]);

// The sentence from his screenshot, with the token already restored.
const BEFORE = 'Verify caregiver procedural fidelity on redirects for grabbing and touching others across future sessions, measured against the goals of Minimal Block/Redirect to FCT for grabbing and Minimal Redirect (Request Attn) for touching others.';
const AFTER = 'Check in with caregiver after next week sessions to verify procedural fidelity on Minimal Block/Redirect to FCT for grabbing and Minimal Redirect (Request Attn) for touching others, prior to next coordination of care session with providers.';

test.describe('NoteDiff.hunks', () => {
  test('a reworded clause is one change carrying both wordings', async ({ page }) => {
    await ready(page);
    const out = await hunks(page, 'The technician utilized a three-item array.', 'The technician used a three-item array.');
    expect(out).toEqual([
      { type: 'same', text: 'The technician ' },
      { type: 'change', text: 'used', was: 'utilized' },
      { type: 'same', text: ' a three-item array.' },
    ]);
  });

  test('his sentence reads as two runs, not as word confetti', async ({ page }) => {
    await ready(page);
    const out = await hunks(page, BEFORE, AFTER);
    const marked = out.filter((h) => h.type !== 'same');
    // The word-level diff drew this as more than twenty alternating spans.
    const words = await page.evaluate(([b, a]) => window.NoteDiff.words(b, a).filter((o) => o.type !== 'same').length, [BEFORE, AFTER]);
    expect(words).toBeGreaterThan(20);
    expect(marked.length).toBeLessThanOrEqual(3);
    expect(marked[0].type).toBe('change');
    expect(marked[0].text).toMatch(/^Check in with caregiver/);
    expect(marked[0].was).toMatch(/^Verify caregiver procedural fidelity/);
  });

  test('the new side of the hunks rebuilds the proposed text exactly, and the old side the original', async ({ page }) => {
    await ready(page);
    const out = await hunks(page, BEFORE, AFTER);
    const newSide = out.filter((h) => h.type !== 'del').map((h) => h.text).join('');
    const oldSide = out.filter((h) => h.type !== 'ins').map((h) => (h.type === 'change' ? h.was : h.text)).join('');
    expect(newSide).toBe(AFTER);
    // Unchanged runs carry the NEW spacing, so compare the old side on words.
    expect(oldSide.replace(/\s+/g, ' ')).toBe(BEFORE.replace(/\s+/g, ' '));
  });

  test('an unchanged stretch longer than the bridge keeps two changes apart', async ({ page }) => {
    await ready(page);
    const out = await hunks(page,
      'Alpha one two three four five omega.',
      'Beta one two three four five sigma.');
    expect(out.filter((h) => h.type === 'change')).toHaveLength(2);
  });

  test('a pure addition stays ins and a pure removal stays del', async ({ page }) => {
    await ready(page);
    // words() keeps punctuation on its word, so the addition sits mid-sentence
    // here: "well." to "well today." would rightly be a rewrite of "well.".
    const added = await hunks(page, 'Client engaged well in the session.', 'Client engaged well today in the session.');
    expect(added.filter((h) => h.type !== 'same')).toEqual([{ type: 'ins', text: 'today ' }]);
    const cut = await hunks(page, 'Client engaged very well.', 'Client engaged well.');
    expect(cut.filter((h) => h.type !== 'same').map((h) => h.type)).toEqual(['del']);
  });
});

test.describe('the Accept/Discard view', () => {
  const mount = (page, before, after) => page.evaluate(([b, a]) => {
    const host = document.createElement('div');
    host.id = 'pd-host';
    host.style.cssText = 'width:600px;margin:40px';
    document.body.prepend(host);
    window.__asked = [];
    ReactDOM.createRoot(host).render(React.createElement(window.PendingDiff, {
      before: b, after: a, onAsk: (h) => window.__asked.push(h.text),
    }));
  }, [before, after]);

  test('shows the proposed note and nothing of the old wording until asked', async ({ page }) => {
    await ready(page);
    await mount(page, BEFORE, AFTER);
    const view = page.locator('#pd-host .pd-view');
    await expect(view).toHaveText(AFTER);
    await expect(view).not.toContainText('Verify caregiver');

    await view.locator('[data-pending-hunk="change"]').first().click();
    await expect(view.locator('[data-pending-pop]')).toContainText('Verify caregiver procedural fidelity');

    // A click elsewhere puts it away.
    await page.mouse.click(5, 5);
    await expect(view.locator('[data-pending-pop]')).toHaveCount(0);
  });

  test('a removal is an empty watermark, and its words show on tap', async ({ page }) => {
    await ready(page);
    await mount(page, 'Client engaged very well.', 'Client engaged well.');
    const view = page.locator('#pd-host .pd-view');
    const mark = view.locator('[data-pending-hunk="del"]');
    await expect(mark).toHaveCount(1);
    expect(await mark.evaluate((el) => el.childNodes.length)).toBe(0);
    await expect(view).toHaveText('Client engaged well.');
    await mark.click();
    await expect(view.locator('[data-pending-pop]')).toContainText('very');
  });

  test('the circle hands the change to the panel', async ({ page }) => {
    await ready(page);
    await mount(page, 'The technician utilized a three-item array.', 'The technician used a three-item array.');
    const view = page.locator('#pd-host .pd-view');
    await view.locator('[data-pending-hunk="change"]').click();
    await view.locator('[data-pending-ask]').click();
    expect(await page.evaluate(() => window.__asked)).toEqual(['used']);
    await expect(view.locator('[data-pending-pop]')).toHaveCount(0);
  });

  test('the keyboard opens and closes it', async ({ page }) => {
    await ready(page);
    await mount(page, 'The technician utilized a three-item array.', 'The technician used a three-item array.');
    const view = page.locator('#pd-host .pd-view');
    await view.locator('[data-pending-hunk="change"]').focus();
    await page.keyboard.press('Enter');
    await expect(view.locator('[data-pending-pop]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(view.locator('[data-pending-pop]')).toHaveCount(0);
  });
});
