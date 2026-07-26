import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * AdminTools/ImageManager against the shared stimulus library.
 *
 * Two things broke when clock, receptive and matching were repointed, and both
 * are invisible from the Worker side:
 *
 *   1. every thumbnail was built as `'../../' + gameId + '/' + gameId + '/' +
 *      path`, which for a library URL concatenates to
 *      `../../IDMatchGame/IDMatchGame//shared/stimuli/img/…` — a page of broken
 *      images with no error anywhere
 *   2. a successful save appended a card built from a *guessed* path
 *      (`_Resources/_imgSource/<folder>/<file>`), which the commit no longer
 *      writes — so the technician was shown a card for something that does not
 *      exist at that address
 *
 * The fix for (2) is to render from the manifests the batch response carries
 * back. It has to be the response and not a re-fetch: the deployed
 * `manifest.json` is still the pre-commit build until Pages republishes, so a
 * read-back over HTTP would show a *successful* save as missing.
 *
 * These tests drive the real page and stub only `/api/admin/batch`, so the
 * client half of that contract is asserted here; the Worker half (that the
 * response really carries the committed projection) is asserted in
 * `stimulus-library-worker.spec.js`.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = path.resolve(HERE, '..');

const MANIFESTS = Object.fromEntries(
  ['matching', 'receptive', 'clock'].map(folder => [
    folder,
    JSON.parse(readFileSync(path.join(GAMES_ROOT, folder, 'manifest.json'), 'utf8')),
  ]),
);

const clone = (v) => JSON.parse(JSON.stringify(v));

/** Every manifest, with `mutate` applied to each one. */
function projectedManifests(mutate) {
  return Object.fromEntries(
    Object.entries(MANIFESTS).map(([folder, m]) => {
      const copy = clone(m);
      mutate(copy, folder);
      return [folder, copy];
    }),
  );
}

async function openManager(page) {
  await page.addInitScript(() => {
    // The page only checks that a token is present; the Worker is stubbed.
    localStorage.setItem('admin_token', 'test-token');
  });
  await page.goto('/AdminTools/ImageManager/');
  await expect(page.locator('.game-tab').first()).toBeVisible();
  await expect(page.locator('#image-grid .img-card').first()).toBeVisible();
}

/** Stub `/api/admin/batch`; resolves with the operations the page posted. */
async function stubBatch(page, response, status = 200) {
  const posted = [];
  await page.route('**/api/admin/batch', async (route) => {
    posted.push(JSON.parse(route.request().postData() || '{}'));
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(typeof response === 'function' ? response() : response),
    });
  });
  return posted;
}

/** Fail the test if any admin endpoint other than `batch` is called. */
async function forbidOtherAdminCalls(page) {
  const stray = [];
  await page.route('**/api/admin/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith('/batch')) {
      stray.push(url.pathname);
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"unexpected endpoint"}' });
      return;
    }
    await route.fallback();
  });
  return stray;
}

async function openAddForm(page) {
  await page.locator('.btn-add-image').click();
  await expect(page.locator('.add-form.open')).toBeVisible();
}

test.describe('ImageManager reads the shared stimulus library', () => {
  test('clock is a registered game and loads its own manifest', async ({ page }) => {
    const manifestRequests = [];
    page.on('request', (r) => {
      const p = new URL(r.url()).pathname;
      if (p.endsWith('manifest.json')) manifestRequests.push(p);
    });

    await openManager(page);

    const clockTab = page.locator('.game-tab', { hasText: 'Hickory Dickory Dock' });
    await expect(clockTab).toHaveCount(1);
    await clockTab.click();

    // Its own manifest, fetched from where clock is actually served.
    await expect.poll(() => manifestRequests).toContain('/clock/manifest.json');
    await expect(page.locator('.folder-tab')).toHaveCount(MANIFESTS.clock.folders.length);
    await expect(page.locator('#image-grid .img-card').first()).toBeVisible();
  });

  test('every thumbnail renders the manifest URL itself, and it resolves', async ({ page }) => {
    await openManager(page);

    const folder = MANIFESTS.matching.folders[0];
    const srcs = await page.locator('#image-grid img').evaluateAll(
      (imgs) => imgs.map(i => i.getAttribute('src')),
    );

    // Verbatim, in order — the pre-fix code produced
    // `../../IDMatchGame/IDMatchGame//shared/stimuli/img/T_animals/bear.jpg`.
    expect(srcs).toEqual(MANIFESTS.matching.images[folder]);

    for (const src of srcs) {
      const res = await page.request.get(src);
      expect(res.status(), `${src} should serve`).toBe(200);
    }
  });
});

test.describe('a save renders what the commit produced', () => {
  const NEW_URL = '/shared/stimuli/img/T_animals/zebra.jpg';
  const GUESSED_PATH = '_Resources/_imgSource/T_animals/zebra.jpg';

  const withZebra = () => projectedManifests((m) => {
    m.images.T_animals = [...m.images.T_animals, NEW_URL];
    m.displayNames[NEW_URL] = 'Zebra';
  });

  async function submitZebra(page) {
    await openAddForm(page);
    await page.locator('.add-form.open [name=display-name]').fill('Zebra');
    await page.locator('.add-form.open [name=url]').fill('https://example.invalid/zebra.jpg');
    await page.locator('.add-form.open .btn-submit').click();
  }

  test('an upload adopts the committed manifest instead of a guessed path', async ({ page }) => {
    await openManager(page);
    const before = await page.locator('#image-grid .img-card').count();

    const posted = await stubBatch(page, {
      ok: true,
      results: [{ ok: true, path: NEW_URL, url: NEW_URL, id: 'animals-zebra', filename: 'zebra.jpg' }],
      manifests: withZebra(),
    });

    await submitZebra(page);
    await expect(page.locator('#add-form-status')).toHaveText('Saved!');

    expect(posted).toHaveLength(1);
    expect(posted[0].operations[0]).toMatchObject({ type: 'save-image', game: 'IDMatchGame', folder: 'T_animals' });

    await expect(page.locator('#image-grid .img-card')).toHaveCount(before + 1);
    await expect(page.locator(`#image-grid img[src="${NEW_URL}"]`)).toHaveCount(1);
    await expect(page.locator(`#image-grid img[src*="${GUESSED_PATH}"]`)).toHaveCount(0);
    await expect(page.locator('#image-grid .img-card', { hasText: 'Zebra' })).toHaveCount(1);
  });

  test('a response with no manifest says the grid is stale rather than inventing a card', async ({ page }) => {
    await openManager(page);
    const before = await page.locator('#image-grid .img-card').count();

    await stubBatch(page, {
      ok: true,
      results: [{ ok: true, path: NEW_URL, filename: 'zebra.jpg' }],
    });

    await submitZebra(page);
    await expect(page.locator('#add-form-status')).toHaveText('Saved! Reload to see it.');
    await expect(page.locator('#image-grid .img-card')).toHaveCount(before);
    await expect(page.locator(`#image-grid img[src*="${GUESSED_PATH}"]`)).toHaveCount(0);
  });

  test('a failed operation leaves the grid exactly as it was', async ({ page }) => {
    await openManager(page);
    const before = await page.locator('#image-grid .img-card').count();

    await stubBatch(page, {
      ok: false,
      results: [{ ok: false, error: 'Failed to load image: 404' }],
    });

    await submitZebra(page);
    await expect(page.locator('#add-form-status')).toHaveText('Failed to load image: 404');
    await expect(page.locator('#image-grid .img-card')).toHaveCount(before);
    await expect(page.locator(`#image-grid img[src="${NEW_URL}"]`)).toHaveCount(0);
  });
});

test.describe('a removal renders what the commit produced', () => {
  test('the excluded stimulus disappears because the re-projection dropped it', async ({ page }) => {
    page.on('dialog', (d) => d.accept());
    await openManager(page);

    const dropped = MANIFESTS.matching.images.T_animals[0];
    const before = await page.locator('#image-grid .img-card').count();

    // matching stops offering it; receptive and clock keep the same picture.
    await stubBatch(page, {
      ok: true,
      results: [{ ok: true, id: 'animals-bear', excluded: true }],
      manifests: projectedManifests((m, folder) => {
        if (folder !== 'matching') return;
        m.images.T_animals = m.images.T_animals.filter(p => p !== dropped);
      }),
    });

    await page.locator(`#image-grid .img-card:has(img[src="${dropped}"])`).click();
    await expect(page.locator('#detail-panel')).toHaveClass(/open/);
    await page.locator('#dp-remove-btn').click();

    await expect(page.locator('#dp-remove-status')).toHaveText('Removed.');
    await expect(page.locator('#image-grid .img-card')).toHaveCount(before - 1);
    await expect(page.locator(`#image-grid img[src="${dropped}"]`)).toHaveCount(0);
  });
});

test.describe('a new topic comes back in the manifest, not from the client', () => {
  test('the folder is created through the batch endpoint and read back', async ({ page }) => {
    const FOLDER = 'T_test-topic';
    const IMAGE = `/shared/stimuli/img/${FOLDER}/kite.jpg`;

    await openManager(page);
    const stray = await forbidOtherAdminCalls(page);
    const posted = await stubBatch(page, {
      ok: true,
      results: [{ ok: true, path: IMAGE, id: 'test-topic-kite', filename: 'kite.jpg' }],
      manifests: projectedManifests((m) => {
        m.folders = [...m.folders, FOLDER];
        m.images[FOLDER] = [IMAGE];
        m.displayNames[IMAGE] = 'Kite';
      }),
    });

    await page.locator('.btn-new-topic').click();
    await page.locator('#nt-name').fill('test-topic');
    await page.locator('#nt-filename').fill('kite.jpg');
    await page.locator('#nt-url').fill('https://example.invalid/kite.jpg');
    await page.locator('#nt-submit').click();

    // The new topic exists because the committed manifest lists it.
    await expect(page.locator('.folder-tab.active')).toHaveText('test-topic');
    await expect(page.locator(`#image-grid img[src="${IMAGE}"]`)).toHaveCount(1);

    expect(stray, 'admin endpoints other than /batch').toEqual([]);
    expect(posted).toHaveLength(1);
    expect(posted[0].operations[0]).toMatchObject({ type: 'save-image', folder: FOLDER, filename: 'kite.jpg' });
  });
});
