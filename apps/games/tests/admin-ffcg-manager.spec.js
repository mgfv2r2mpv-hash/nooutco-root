import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * AdminTools/FFCGManager against the shared stimulus library.
 *
 * `ffc/items.json` became a projection of `shared/stimuli/ffc.json` and stopped
 * carrying a label or a filename — the game resolves both from the library by
 * id at run time, which is what lets an upload reach ffc without re-committing
 * the document. `AdminTools/ImageManager` was joined to the library in the same
 * commit; this page was not, and it still read `item.label` and built its
 * thumbnails from `_Resources/_imgSource/items/ + item.img`. Both are
 * `undefined` on the projected shape, so every card rendered the word
 * "undefined" over a broken image.
 *
 * These tests drive the real page against the real committed files, so they
 * fail on the shape drift itself rather than on a fixture.
 *
 * The *write* path is a separate, deliberate state: `ffc-save-items`,
 * `ffc-save-image` and `ffc-remove-image` answer 409 while the ffc admin wiring
 * is outstanding (`FFC_WRITE_REFUSED` in `worker.js`). The last test pins that
 * the refusal is surfaced to the technician rather than swallowed.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..');

const readJson = (...parts) => JSON.parse(readFileSync(path.join(GAMES_ROOT, ...parts), 'utf8'));

const ITEMS = readJson('ffc', 'items.json');
const LIBRARY = readJson('shared', 'stimuli', 'stimuli.json');

const BY_ID = new Map(LIBRARY.stimuli.map((entry) => [entry.id, entry]));

/** What the page must render, derived the way the game derives it. */
const EXPECTED = ITEMS.items
  .filter((item) => BY_ID.has(item.id))
  .map((item) => {
    const entry = BY_ID.get(item.id);
    return { id: item.id, label: entry.label, image: entry.image || entry.placeholder || '' };
  });

async function openManager(page) {
  await page.addInitScript(() => {
    // The page only checks that a token is present; no admin call is made on load.
    localStorage.setItem('admin_token', 'test-token');
  });
  await page.goto('/AdminTools/FFCGManager/');
  await expect(page.locator('#image-grid .img-card').first()).toBeVisible();
}

test('every ffc item is rendered with the library label it resolves to', async ({ page }) => {
  await openManager(page);

  expect(EXPECTED.length, 'the join is not empty').toBeGreaterThan(50);
  await expect(page.locator('#image-grid .img-card')).toHaveCount(EXPECTED.length);

  const labels = await page.locator('#image-grid .img-card .label').allTextContents();
  expect(labels).toEqual(EXPECTED.map((e) => e.label));
  expect(labels.filter((l) => !l || l === 'undefined'), 'no card fell back to a missing field').toEqual([]);
});

test('every thumbnail is the library URL for that item, and it resolves', async ({ page, request }) => {
  await openManager(page);

  // Compared verbatim rather than via naturalWidth: deterministic across
  // webkit/firefox, and it fails on a path concatenation rather than on a
  // network hiccup.
  const srcs = await page.locator('#image-grid .img-card img').evaluateAll(
    (nodes) => nodes.map((n) => n.getAttribute('src')),
  );
  expect(srcs).toEqual(EXPECTED.map((e) => e.image));

  for (const src of new Set(srcs)) {
    expect(src, 'a library URL, not a legacy game-relative path').toMatch(/^\/shared\/stimuli\//);
    const res = await request.get(src);
    expect(res.status(), `${src} resolves`).toBe(200);
  }
});

test('the detail panel shows the library picture and label for the item clicked', async ({ page }) => {
  await openManager(page);

  const first = EXPECTED[0];
  await page.locator('#image-grid .img-card').first().click();

  await expect(page.locator('#dp-title')).toHaveText(first.label);
  await expect(page.locator('#dp-sub')).toHaveText('id: ' + first.id);
  await expect(page.locator('#dp-thumb')).toHaveAttribute('src', first.image);
  await expect(page.locator('#dp-label-input')).toHaveValue(first.label);
});

test('Mass Assign renders the same library pictures', async ({ page }) => {
  await openManager(page);
  await page.locator('#btn-mass-assign').click();

  const cells = page.locator('#ma-grid .ma-cell img');
  await expect(cells.first()).toBeVisible();
  const srcs = await cells.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('src')));
  expect(srcs.length).toBeGreaterThan(0);
  for (const src of srcs) expect(src).toMatch(/^\/shared\/stimuli\//);
});

test('a refused write is reported, not swallowed', async ({ page }) => {
  await openManager(page);
  await page.route('**/api/admin/ffc-save-items', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'FFC content now lives in the shared stimulus library.' }),
    }),
  );

  await page.locator('#image-grid .img-card').first().click();
  await page.locator('#dp-save').click();

  const status = page.locator('#dp-save-status');
  await expect(status).toHaveClass(/err/);
  await expect(status).toContainText('shared stimulus library');
});
