import { test, expect } from '@playwright/test';

// Page navigation on games.nooutco.me.
//
// Every page below the games home shows Games › <page> in the shared bar, and
// "Games" leads home. Before 2026-09-17 a game's single crumb rendered as its
// own dead title, and the Game Master managers linked "Game Master" to the
// games home instead of /GM/.

test('a game page shows Games › its name, with Games linking home', async ({ page }) => {
  await page.goto('/think-or-say/');
  const crumbs = page.locator('noaba-bar .noaba-crumb');
  await expect(crumbs).toHaveCount(2);
  await expect(crumbs.nth(0)).toHaveText('Games');
  await expect(crumbs.nth(0)).toHaveAttribute('href', '/');
  await expect(crumbs.nth(1)).toHaveText('Think or Say?');
  await expect(page.locator('noaba-bar a.noaba-seg[aria-current]')).toHaveAttribute('href', '/');
});

// Glam is the one React game; its bar sits outside the <x-dc> app it renders.
test('Glam Team Makeover shows the shared bar like every other game', async ({ page }) => {
  await page.goto('/glam-team-makeover/');
  const crumbs = page.locator('noaba-bar .noaba-crumb');
  await expect(crumbs).toHaveCount(2);
  await expect(crumbs.nth(0)).toHaveText('Games');
  await expect(crumbs.nth(0)).toHaveAttribute('href', '/');
  await expect(crumbs.nth(1)).toHaveText('Glam Team Makeover');
  const box = await page.locator('noaba-bar').boundingBox();
  expect({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width) })
    .toEqual({ x: 0, y: 0, w: page.viewportSize().width });
});

test('a Game Master manager links both parents', async ({ page }) => {
  await page.goto('/AdminTools/ImageManager/');
  const crumbs = page.locator('noaba-bar .noaba-crumb');
  await expect(crumbs).toHaveCount(3);
  await expect(crumbs.nth(0)).toHaveAttribute('href', '/');
  await expect(crumbs.nth(1)).toHaveText('Game Master');
  await expect(crumbs.nth(1)).toHaveAttribute('href', '/GM/');
  await expect(crumbs.nth(2)).toHaveText('Image Manager');
});

test('the games home has no trail and its admin link points at Game Master', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('noaba-bar .noaba-row')).toBeVisible();
  // The body padding used to leave the bar floating inset.
  const box = await page.locator('noaba-bar').boundingBox();
  expect({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width) })
    .toEqual({ x: 0, y: 0, w: page.viewportSize().width });
  await expect(page.locator('noaba-bar .noaba-crumb')).toHaveCount(0);
  await expect(page.locator('noaba-bar .noaba-admin')).toHaveAttribute('href', '/GM/');
});

// The sweep: every link a visitor can see, crumbs included, has to land on a
// real page. Pages answers a missing path with the games home and a 200, so a
// non-home path that serves the home page counts as broken.
test('every rendered link on the games site resolves to a real page', async ({ page, request, browserName }) => {
  test.skip(browserName !== 'chromium', 'one browser is enough to walk the links');
  test.setTimeout(300000);

  const homeBody = await (await request.get('/')).text();
  const missing = await request.get('/__page-navigation-negative-control__/');
  expect(await missing.text(), 'the fallback check must be able to fail').toBe(homeBody);

  const seen = new Map([['/', '(start)']]);
  const queue = ['/'];
  const broken = [];

  while (queue.length) {
    const path = queue.shift();
    const res = await request.get(path);
    const finalPath = new URL(res.url()).pathname;
    const type = res.headers()['content-type'] || '';
    const body = type.includes('text/html') ? await res.text() : '';
    if (res.status() >= 400) { broken.push(`${res.status()} ${path} (from ${seen.get(path)})`); continue; }
    if (finalPath !== '/' && body && body === homeBody) { broken.push(`fallback ${path} (from ${seen.get(path)})`); continue; }
    if (!type.includes('text/html') || /\.(pdf|png|jpe?g|webp|svg|csv|json|js|css|mp3)$/i.test(finalPath)) continue;

    await page.goto(path);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const here = new URL(page.url());
    const hrefs = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]'), (a) => a.href));
    for (const href of hrefs) {
      let u;
      try { u = new URL(href); } catch { continue; }
      if (u.origin !== here.origin) continue;
      const key = u.pathname + u.search;
      if (key === here.pathname + here.search) continue;
      if (!seen.has(key)) { seen.set(key, here.pathname + here.search); queue.push(key); }
    }
  }
  expect(broken, `broken links:\n${broken.join('\n')}`).toEqual([]);
  // A walk that stopped early would also find nothing broken.
  const mustReach = ['/think-or-say/', '/matching/', '/sequences/', '/emotions/', '/famous-person/', '/glam-team-makeover/'];
  expect(mustReach.filter((p) => !seen.has(p)), 'game pages the walk never reached').toEqual([]);
});
