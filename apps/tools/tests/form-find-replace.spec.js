import { test, expect } from '@playwright/test';

/* FIND AND REPLACE ACROSS THE NOTE FORM.
   Kaleb asked for it on 9 Oct 2026 while filling the note tool forms: "Need a
   find/replace on form text fields". He dictates because of a wrist injury, so
   the bar exists to save him from retyping a word in five boxes by voice.

   What these tests hold the bar to:
   - It reaches every text field of the form and nothing else: never a password
     or hidden field, and never its own two boxes.
   - A replacement goes in the way typing does, through the input event, so the
     page's own listeners (autosave, counts, the scrub state) see it.
   - It only edits text in the page. No request leaves the page on a replace.
   - Masking tokens like [CLIENT] are plain text to it. */

const FIELD_A = '#field-fSession';
const FIELD_B = '#field-fLesson';
const FIELD_C = '#field-fAntecedent';

const load = async (page, path = '/notes/bt/') => {
  await page.goto(path);
  await page.waitForFunction(() => !!(window.NoteFindReplace && document.querySelector('[data-find-scope] textarea')));
};

const fillForm = async (page) => {
  await page.fill(FIELD_A, 'The cat sat. The Cat ran to the catalog.');
  await page.fill(FIELD_B, 'A cat and a dog.');
  await page.fill(FIELD_C, 'No match here.');
};

const bar = (page) => page.getByRole('search', { name: 'Find and replace' });
const findBox = (page) => bar(page).getByLabel('Find', { exact: true });
const replaceBox = (page) => bar(page).getByLabel('Replace with');
const count = (page) => bar(page).locator('[data-find-count]');

/* Where the bar is: the field holding the selection, and the mark drawn over
   it. Focus stays in the bar, so the field is read by id, not activeElement. */
const selectionIn = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return { start: el.selectionStart, end: el.selectionEnd, text: el.value.slice(el.selectionStart, el.selectionEnd) };
}, sel);

const markIsOn = (page, sel) => page.evaluate((s) => {
  const mark = document.querySelector('[data-find-highlight] .find-mark');
  if (!mark) return false;
  const m = mark.getBoundingClientRect();
  const f = document.querySelector(s).getBoundingClientRect();
  return m.width > 0 && m.left >= f.left && m.right <= f.right && m.top >= f.top && m.bottom <= f.bottom;
}, sel);

const openWithButton = async (page) => {
  await page.getByRole('button', { name: /find and replace/i }).first().click();
  await expect(bar(page)).toBeVisible();
};

test.describe('find and replace on the note form', () => {
  test('a visible button near the form opens the bar with the cursor in Find', async ({ page }) => {
    await load(page);
    const opener = page.locator('[data-find-scope]').getByRole('button', { name: /find and replace/i });
    await expect(opener).toBeVisible();
    await opener.click();
    await expect(bar(page)).toBeVisible();
    await expect(findBox(page)).toBeFocused();
  });

  test('the keyboard shortcut opens it without taking the browser\'s own Cmd+F', async ({ page }) => {
    await load(page);
    await page.focus(FIELD_A);
    await page.keyboard.press('Control+Alt+KeyF');
    await expect(bar(page)).toBeVisible();
    await expect(findBox(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(bar(page)).toBeHidden();

    await page.focus(FIELD_A);
    await page.keyboard.press('Meta+Alt+KeyF');
    await expect(bar(page)).toBeVisible();
    await page.keyboard.press('Escape');

    // Plain Cmd+F and Ctrl+F stay the browser's: the page does not open the bar.
    await page.focus(FIELD_A);
    await page.keyboard.press('Control+KeyF');
    await expect(bar(page)).toBeHidden();
  });

  test('a word selected in a field seeds Find, so he does not have to say it again', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await page.evaluate((sel) => { const el = document.querySelector(sel); el.focus(); el.setSelectionRange(4, 7); }, FIELD_A);
    await page.keyboard.press('Control+Alt+KeyF');
    await expect(findBox(page)).toHaveValue('cat');
  });

  test('counts matches and the fields they are in', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await openWithButton(page);
    await findBox(page).fill('cat');
    // Not case-sensitive and not whole-word by default: cat, Cat, catalog, cat.
    await expect(count(page)).toHaveText('4 matches in 2 fields');
    await findBox(page).fill('dog');
    await expect(count(page)).toHaveText('1 match in 1 field');
    await findBox(page).fill('zebra');
    await expect(count(page)).toHaveText('No matches');
  });

  test('Match case narrows the count', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await openWithButton(page);
    await findBox(page).fill('Cat');
    await expect(count(page)).toHaveText('4 matches in 2 fields');
    const toggle = bar(page).getByRole('button', { name: 'Match case' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(count(page)).toHaveText('1 match in 1 field');
  });

  test('Whole word skips a match inside a longer word', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await openWithButton(page);
    await findBox(page).fill('cat');
    const toggle = bar(page).getByRole('button', { name: 'Whole word' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // "catalog" drops out.
    await expect(count(page)).toHaveText('3 matches in 2 fields');
  });

  test('Next scrolls to, selects and marks each match in its field, in page order, and wraps', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await openWithButton(page);
    await findBox(page).fill('cat');
    const next = bar(page).getByRole('button', { name: 'Next match' });

    await next.click();
    expect(await selectionIn(page, FIELD_A)).toEqual({ start: 4, end: 7, text: 'cat' });
    await expect(page.locator(FIELD_A)).toBeInViewport();
    expect(await markIsOn(page, FIELD_A)).toBe(true);
    await expect(bar(page).locator('[data-find-position]')).toHaveText('1 of 4');

    await next.click();
    expect(await selectionIn(page, FIELD_A)).toEqual({ start: 17, end: 20, text: 'Cat' });
    await next.click();
    expect(await selectionIn(page, FIELD_A)).toEqual({ start: 32, end: 35, text: 'cat' });
    await next.click();
    expect(await selectionIn(page, FIELD_B)).toEqual({ start: 2, end: 5, text: 'cat' });
    await expect(page.locator(FIELD_B)).toBeInViewport();
    expect(await markIsOn(page, FIELD_B)).toBe(true);
    await expect(bar(page).locator('[data-find-position]')).toHaveText('4 of 4');
    await next.click();
    expect(await selectionIn(page, FIELD_A)).toEqual({ start: 4, end: 7, text: 'cat' });
    await expect(bar(page).locator('[data-find-position]')).toHaveText('1 of 4');
  });

  test('Enter in Find steps on, and a second Enter never types into the field', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await openWithButton(page);
    await findBox(page).fill('cat');
    await findBox(page).press('Enter');
    await expect(findBox(page)).toBeFocused();
    expect(await selectionIn(page, FIELD_A)).toEqual({ start: 4, end: 7, text: 'cat' });
    await findBox(page).press('Enter');
    await findBox(page).press('Enter');
    await findBox(page).press('Enter');
    expect(await selectionIn(page, FIELD_B)).toEqual({ start: 2, end: 5, text: 'cat' });
    await expect(page.locator(FIELD_A)).toHaveValue('The cat sat. The Cat ran to the catalog.');
    await expect(page.locator(FIELD_B)).toHaveValue('A cat and a dog.');
  });

  test('Typing in the field retires the mark, since the match it marked has moved', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await openWithButton(page);
    await findBox(page).fill('dog');
    await findBox(page).press('Enter');
    expect(await markIsOn(page, FIELD_B)).toBe(true);
    await page.locator(FIELD_B).press('Home');
    await page.keyboard.type('Big ');
    await expect(page.locator('[data-find-highlight]')).toHaveCount(0);
    await expect(bar(page).locator('[data-find-position]')).toHaveText('');
  });

  test('Replace swaps the current match and moves to the next one', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await openWithButton(page);
    await findBox(page).fill('cat');
    await bar(page).getByRole('button', { name: 'Match case' }).click();
    await bar(page).getByRole('button', { name: 'Whole word' }).click();
    await expect(count(page)).toHaveText('2 matches in 2 fields');
    await replaceBox(page).fill('kitten');

    const replace = bar(page).getByRole('button', { name: 'Replace', exact: true });
    await replace.click();
    await expect(page.locator(FIELD_A)).toHaveValue('The kitten sat. The Cat ran to the catalog.');
    await expect(count(page)).toHaveText('1 match in 1 field');
    // The next match is selected and ready for the next press.
    expect(await selectionIn(page, FIELD_B)).toEqual({ start: 2, end: 5, text: 'cat' });

    await replace.click();
    await expect(page.locator(FIELD_B)).toHaveValue('A kitten and a dog.');
    await expect(count(page)).toHaveText('No matches');
  });

  test('Replace all changes every field, and the page autosave sees it', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await openWithButton(page);
    await findBox(page).fill('cat');
    await bar(page).getByRole('button', { name: 'Whole word' }).click();
    await replaceBox(page).fill('dog');
    await bar(page).getByRole('button', { name: 'Replace all' }).click();

    await expect(page.locator(FIELD_A)).toHaveValue('The dog sat. The dog ran to the catalog.');
    await expect(page.locator(FIELD_B)).toHaveValue('A dog and a dog.');
    await expect(page.locator(FIELD_C)).toHaveValue('No match here.');
    await expect(count(page)).toHaveText('No matches');
    await expect(bar(page).locator('[data-find-status]')).toHaveText('Replaced 3 in 2 fields');

    // The engine saves the draft from its own state, which only moves when its
    // onChange runs. A value set under React would leave this on the old text.
    const saved = await page.evaluate(() => window.NotesGate.draft.load('bt'));
    expect(saved.fSession).toBe('The dog sat. The dog ran to the catalog.');
    expect(saved.fLesson).toBe('A dog and a dog.');
  });

  test('a replace fires the input events the page listens to', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await page.evaluate(() => {
      window.__heard = [];
      document.querySelector('[data-find-scope]').addEventListener('input', (e) => {
        window.__heard.push({ id: e.target.id, value: e.target.value, bubbles: e.bubbles });
      });
    });
    await openWithButton(page);
    await findBox(page).fill('dog');
    await replaceBox(page).fill('pup');
    await bar(page).getByRole('button', { name: 'Replace all' }).click();
    const heard = await page.evaluate(() => window.__heard.filter((h) => h.id));
    expect(heard).toEqual([{ id: 'field-fLesson', value: 'A cat and a pup.', bubbles: true }]);
  });

  test('Replace all is one step back with Undo', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await openWithButton(page);
    await findBox(page).fill('cat');
    await replaceBox(page).fill('X');
    await bar(page).getByRole('button', { name: 'Replace all' }).click();
    await expect(page.locator(FIELD_B)).toHaveValue('A X and a dog.');

    await bar(page).getByRole('button', { name: 'Undo replace all' }).click();
    await expect(page.locator(FIELD_A)).toHaveValue('The cat sat. The Cat ran to the catalog.');
    await expect(page.locator(FIELD_B)).toHaveValue('A cat and a dog.');
    const saved = await page.evaluate(() => window.NotesGate.draft.load('bt'));
    expect(saved.fSession).toBe('The cat sat. The Cat ran to the catalog.');
    await expect(bar(page).getByRole('button', { name: 'Undo replace all' })).toBeHidden();
  });

  test('a Replace goes in as an edit the field can undo with the keyboard', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await openWithButton(page);
    await findBox(page).fill('dog');
    await replaceBox(page).fill('pup');
    await bar(page).getByRole('button', { name: 'Replace', exact: true }).click();
    await expect(page.locator(FIELD_B)).toHaveValue('A cat and a pup.');
    await page.focus(FIELD_B);
    await page.keyboard.press('ControlOrMeta+KeyZ');
    await expect(page.locator(FIELD_B)).toHaveValue('A cat and a dog.');
    const saved = await page.evaluate(() => window.NotesGate.draft.load('bt'));
    expect(saved.fLesson).toBe('A cat and a dog.');
  });

  test('no request leaves the page while finding and replacing', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await page.waitForLoadState('networkidle');
    const sent = [];
    page.on('request', (r) => sent.push(r.method() + ' ' + r.url()));

    await openWithButton(page);
    await findBox(page).fill('cat');
    await replaceBox(page).fill('dog');
    await bar(page).getByRole('button', { name: 'Next match' }).click();
    await bar(page).getByRole('button', { name: 'Replace', exact: true }).click();
    await bar(page).getByRole('button', { name: 'Replace all' }).click();
    await page.waitForTimeout(500);
    expect(sent).toEqual([]);
  });

  test('masking tokens are plain text, and whole word still finds them', async ({ page }) => {
    await load(page);
    await page.fill(FIELD_A, '[CLIENT] arrived. [CLIENT]s toy. [CLIENT2] left.');
    await openWithButton(page);
    await findBox(page).fill('[CLIENT]');
    await expect(count(page)).toHaveText('2 matches in 1 field');
    await bar(page).getByRole('button', { name: 'Whole word' }).click();
    await expect(count(page)).toHaveText('1 match in 1 field');
    // Regex characters in Find are never read as a pattern.
    await findBox(page).fill('.*');
    await expect(count(page)).toHaveText('No matches');
  });

  test('never reaches a password or hidden field, or its own boxes', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await page.evaluate(() => {
      const scope = document.querySelector('[data-find-scope]');
      for (const type of ['password', 'hidden']) {
        const el = document.createElement('input');
        el.type = type;
        el.value = 'cat';
        el.setAttribute('data-test-extra', type);
        scope.appendChild(el);
      }
    });
    await openWithButton(page);
    await findBox(page).fill('cat');
    await replaceBox(page).fill('cat cat');
    await expect(count(page)).toHaveText('4 matches in 2 fields');
    await bar(page).getByRole('button', { name: 'Replace all' }).click();
    const extras = await page.evaluate(() => [...document.querySelectorAll('[data-test-extra]')].map((e) => e.value));
    expect(extras).toEqual(['cat', 'cat']);
    await expect(findBox(page)).toHaveValue('cat');
  });

  test('Esc closes the bar and puts him in the field with the match selected', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await openWithButton(page);
    await findBox(page).fill('dog');
    await findBox(page).press('Enter');
    await page.keyboard.press('Escape');
    await expect(bar(page)).toBeHidden();
    await expect(page.locator('[data-find-highlight]')).toHaveCount(0);
    await expect(page.locator(FIELD_B)).toBeFocused();
    expect(await selectionIn(page, FIELD_B)).toEqual({ start: 12, end: 15, text: 'dog' });
    // Dictating now goes over the word he found.
    await page.keyboard.type('pup');
    await expect(page.locator(FIELD_B)).toHaveValue('A cat and a pup.');
  });

  test('Enter in Replace replaces and steps on, keeping him in the Replace box', async ({ page }) => {
    await load(page);
    await fillForm(page);
    await openWithButton(page);
    await findBox(page).fill('cat');
    await bar(page).getByRole('button', { name: 'Whole word' }).click();
    await replaceBox(page).fill('dog');
    await replaceBox(page).press('Enter');
    await replaceBox(page).press('Enter');
    await expect(replaceBox(page)).toBeFocused();
    await expect(page.locator(FIELD_A)).toHaveValue('The dog sat. The dog ran to the catalog.');
    await expect(page.locator(FIELD_B)).toHaveValue('A cat and a dog.');
    await expect(count(page)).toHaveText('1 match in 1 field');
  });

  test('the BCBA tools share it', async ({ page }) => {
    for (const tool of ['sup', 'assess', 'sap', 'parent']) {
      await load(page, `/notes/${tool}/`);
      await openWithButton(page);
      await page.keyboard.press('Escape');
    }
  });

  test('fits a phone with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await load(page);
    await fillForm(page);
    await openWithButton(page);
    await findBox(page).fill('cat');
    const box = await bar(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(wide).toBeLessThanOrEqual(375);

    // Next brings the field out from under the bar, not just onto the screen.
    await findBox(page).fill('dog');
    await bar(page).getByRole('button', { name: 'Next match' }).click();
    const barBottom = (await bar(page).boundingBox()).y + (await bar(page).boundingBox()).height;
    const fieldTop = (await page.locator(FIELD_B).boundingBox()).y;
    expect(fieldTop).toBeGreaterThanOrEqual(barBottom);
  });
});
