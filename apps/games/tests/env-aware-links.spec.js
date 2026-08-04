import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Every product ships once per environment. A cross-product link that hardcodes
// a production origin drags a dev validation pass onto the live site mid-click - // silently, because the page it lands on looks identical.
//
//   prod   nooutco.me      games.nooutco.me      tools.nooutco.me
//   dev    d.nooutco.me    d-games.nooutco.me    d-tools.nooutco.me
//
// nav-bar.js is the canonical copy in packages/shared, synced into all three
// apps and pinned byte-identical by the CI drift check, so exercising the games
// copy exercises the tools and apex copies too.

const REPO = join(process.cwd(), '..', '..');
const NAV_BAR = readFileSync(join(REPO, 'apps/games/assets/nav-bar.js'), 'utf8');

// Serves a bare page under a chosen hostname so location.hostname is the real
// thing the resolver reads, rather than a value injected past it.
async function pageOn(page, host, body = '') {
  await page.route(`https://${host}/**`, async (route) => {
    const url = route.request().url();
    if (url.endsWith('/nav-bar.js')) {
      return route.fulfill({ status: 200, contentType: 'text/javascript', body: NAV_BAR });
    }
    return route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><html><body>${body}<script src="/nav-bar.js"></script></body></html>`,
    });
  });
  await page.goto(`https://${host}/`);
  await page.waitForFunction(() => !!window.NoabaSites);
}

test.describe('environment-aware site links', () => {
  // The whole matrix in one shot: for each host, where do the three products
  // resolve to? Asserted as a table so a wrong cell names itself.
  test('every host resolves its siblings inside its own environment', async ({ page }) => {
    await pageOn(page, 'd-games.nooutco.me');

    const table = await page.evaluate(() =>
      [
        'nooutco.me', 'games.nooutco.me', 'tools.nooutco.me',
        'd.nooutco.me', 'd-games.nooutco.me', 'd-tools.nooutco.me',
      ].map((h) => [h, ['apex', 'games', 'tools'].map((p) => window.NoabaSites.resolve(p, h)).join(' ')])
    );

    expect(Object.fromEntries(table)).toEqual({
      'nooutco.me':         'https://nooutco.me https://games.nooutco.me https://tools.nooutco.me',
      'games.nooutco.me':   'https://nooutco.me https://games.nooutco.me https://tools.nooutco.me',
      'tools.nooutco.me':   'https://nooutco.me https://games.nooutco.me https://tools.nooutco.me',
      'd.nooutco.me':       'https://d.nooutco.me https://d-games.nooutco.me https://d-tools.nooutco.me',
      'd-games.nooutco.me': 'https://d.nooutco.me https://d-games.nooutco.me https://d-tools.nooutco.me',
      'd-tools.nooutco.me': 'https://d.nooutco.me https://d-games.nooutco.me https://d-tools.nooutco.me',
    });
  });

  // The specific regression: apex-on-dev has no product token in its hostname,
  // so the old substring-swap resolver could not derive a sibling and handed
  // back production for both segments.
  test('the dev apex sends you to dev products, not production', async ({ page }) => {
    await pageOn(page, 'd.nooutco.me');

    const links = await page.evaluate(() => ({
      games: window.NoabaSites.href('games'),
      tools: window.NoabaSites.href('tools'),
    }));

    expect(links.games).toBe('https://d-games.nooutco.me');
    expect(links.tools).toBe('https://d-tools.nooutco.me');
  });

  // Pages hands out <hash>.<project>.pages.dev for per-deployment previews, so
  // the host is never an exact match for a known slot.
  test('a per-deployment Pages preview stays on the matching preview siblings', async ({ page }) => {
    await pageOn(page, 'd-tools.nooutco.me');

    const resolved = await page.evaluate(() =>
      window.NoabaSites.resolve('games', '9f2c1ab4.dev-tools-nooutco-me.pages.dev')
    );

    expect(resolved).toBe('https://dev-games-nooutco-me.pages.dev');
  });

  // A sibling's port is unknowable from localhost, and production is where these
  // links pointed before the resolver existed - so that is the documented floor,
  // asserted rather than left to chance.
  test('an unrecognised host falls back to production', async ({ page }) => {
    await pageOn(page, 'd.nooutco.me');

    const resolved = await page.evaluate(() => [
      window.NoabaSites.resolve('games', 'localhost'),
      window.NoabaSites.resolve('tools', '127.0.0.1'),
    ]);

    expect(resolved).toEqual(['https://games.nooutco.me', 'https://tools.nooutco.me']);
  });

  test('the rendered bar carries the environment through brand and product switch', async ({ page }) => {
    await pageOn(page, 'd-tools.nooutco.me', '<noaba-bar product="tools"></noaba-bar>');

    const hrefs = await page.evaluate(() => {
      const bar = document.querySelector('noaba-bar');
      return Array.from(bar.querySelectorAll('a')).map((a) => a.href);
    });

    expect(hrefs).toContain('https://d.nooutco.me/');
    expect(hrefs).toContain('https://d-games.nooutco.me/');
    expect(hrefs.some((h) => /(^|\/\/)(games|tools)\.nooutco\.me/.test(h))).toBe(false);
  });

  // Cross-product links authored in app HTML keep a real production href as the
  // no-JS floor; the resolver swaps only the origin, so the author's path,
  // query and hash have to survive intact.
  test('authored cross-product links keep their path when the origin is swapped', async ({ page }) => {
    await pageOn(
      page,
      'd.nooutco.me',
      '<a id="s" data-noaba-site="tools" href="https://tools.nooutco.me/SuggestFeature/?a=1#x">Suggest</a>'
    );

    await expect(page.locator('#s')).toHaveAttribute(
      'href',
      'https://d-tools.nooutco.me/SuggestFeature/?a=1#x'
    );
  });

  test('the same link is left alone in production', async ({ page }) => {
    // Pins that the test above proves the ENVIRONMENT swap, not a rewrite that
    // happens to fire everywhere.
    await pageOn(
      page,
      'nooutco.me',
      '<a id="s" data-noaba-site="tools" href="https://tools.nooutco.me/SuggestFeature/">Suggest</a>'
    );

    await expect(page.locator('#s')).toHaveAttribute(
      'href',
      'https://tools.nooutco.me/SuggestFeature/'
    );
  });
});

// Static guard. The runtime tests above only cover links that already opt in;
// this one fails when a new hardcoded cross-product URL is authored anywhere in
// the served HTML, which is how the apex tiles got missed in the first place.
test.describe('no unmanaged cross-product links', () => {
  const SKIP = new Set(['node_modules', 'design_handoff_site_overhaul', 'test-results', 'playwright-report', '.git']);

  function htmlFiles(dir, out = []) {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) htmlFiles(full, out);
      else if (name.endsWith('.html')) out.push(full);
    }
    return out;
  }

  test('every cross-product link in app HTML is environment-aware', () => {
    const offenders = [];
    for (const app of ['apex', 'games', 'tools']) {
      for (const file of htmlFiles(join(REPO, 'apps', app))) {
        const html = readFileSync(file, 'utf8');
        const tags = html.match(/<a\b[^>]*href=["']https:\/\/(?:games|tools)\.nooutco\.me[^"']*["'][^>]*>/g) || [];
        for (const tag of tags) {
          if (!tag.includes('data-noaba-site')) offenders.push(`${relative(REPO, file)}: ${tag.trim()}`);
        }
      }
    }

    expect(offenders, 'add data-noaba-site="games|tools" so the link follows its environment').toEqual([]);
  });
});
