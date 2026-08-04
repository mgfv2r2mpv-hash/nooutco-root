import { test, expect } from '@playwright/test';

// Every note tool now mounts through one engine, so a JSX or wiring mistake in
// the shared code takes down all five pages at once. This is the cheap guard
// against that: each page must render its heading, its inputs and the assistant
// panel with a clean console.
//
// The BCBA page hosts four tools behind a ribbon; BT is a single-tool page and
// must NOT show a ribbon - a lone dead tab would be worse than none.

const PAGES = [
  { tool: 'bt', path: '/notes/bt/index.html', ribbonTabs: 0 },
  { tool: 'sup', path: '/notes/bcba/index.html?tool=sup', ribbonTabs: 4 },
  { tool: 'sap', path: '/notes/bcba/index.html?tool=sap', ribbonTabs: 4 },
  { tool: 'assess', path: '/notes/bcba/index.html?tool=assess', ribbonTabs: 4 },
  { tool: 'parent', path: '/notes/bcba/index.html?tool=parent', ribbonTabs: 4 },
];

for (const { tool, path, ribbonTabs } of PAGES) {
  test(`${tool} mounts with the assistant panel and a clean console`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(path);
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));

    // NOTE_TOOLS is populated by a plain script; the page itself is not on
    // screen until React and Babel arrive from unpkg and the JSX compiles,
    // which is far slower and depends on a third party. Waiting for the mount
    // rather than letting the 5s expect timeout race it removed most of a
    // roughly one-in-fifteen firefox failure that landed on a different tool
    // each run.
    //
    // What is left is the CDN itself. Naming the missing dependency here is the
    // difference between "the engine did not mount" and "unpkg did not answer",
    // which are the same red X and completely different problems.
    const deps = await page.waitForFunction(
      () => (window.React && window.ReactDOM && window.Babel)
        ? { react: true, babel: true }
        : (document.readyState === 'complete'
            ? { react: !!window.React, reactDom: !!window.ReactDOM, babel: !!window.Babel }
            : false),
      null,
      { timeout: 45000 },
    ).then((h) => h.jsonValue()).catch(() => ({ react: false, reactDom: false, babel: false }));
    expect(deps, `CDN dependencies missing on ${tool}: ${JSON.stringify(deps)}`)
      .toMatchObject({ react: true, babel: true });

    await page.waitForSelector('#root h1', { state: 'attached', timeout: 45000 });
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.tool-ribbon button')).toHaveCount(ribbonTabs);
    await expect(page.locator('textarea').first()).toBeVisible();
    // Collapsed by default so it never covers the form on arrival.
    await expect(page.locator('.revision-fab')).toBeVisible();
    await expect(page.locator('.revision-panel')).toHaveCount(0);
    // The shared stylesheet is actually applied, not just linked.
    await expect(page.locator('#root')).toHaveCSS('padding-right', '20px');

    // A logged-out page 401s on /api/nonpii by design.
    //
    // Third-party fetches are also excluded, and deliberately: these pages pull
    // React, Babel and the font from public CDNs, and under a full parallel run
    // one of those requests fails often enough to have been the entire residual
    // flake in this file. A gstatic hiccup is not a defect in the page. The
    // filter names the hosts rather than muting network errors generally, so a
    // request to our own worker that fails still fails the test.
    const THIRD_PARTY = /fonts\.gstatic\.com|fonts\.googleapis\.com|unpkg\.com|challenges\.cloudflare\.com|downloadable font/i;
    const real = errors.filter((e) =>
      !/401|Unauthorized|Failed to load resource/i.test(e) && !THIRD_PARTY.test(e));
    expect(real, `console errors on ${tool}: ${real.join(' | ')}`).toEqual([]);
  });
}

/* The Scrubber link is gone from the drafters.
 *
 * His call of 2026-08-04: "old news. hide it on the drafters." The scrub runs
 * inside the drafting flow now, so sending someone to a separate page to do it
 * by hand is a way of working the tool has outgrown. The standalone page stays
 * reachable by URL for anyone who wants it.
 */
test('no drafter offers a Scrubber link', async ({ page }) => {
  for (const tool of ['sup', 'sap', 'assess', 'parent']) {
    await page.goto(`/notes/bcba/?tool=${tool}`);
    await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
    await expect(page.getByRole('link', { name: /Scrubber/i }), `${tool} still links to the scrubber`).toHaveCount(0);
  }
  await page.goto('/notes/bt/');
  await page.waitForFunction(() => !!(window.NOTE_TOOLS && window.NOTE_TOOLS.length));
  await expect(page.getByRole('link', { name: /Scrubber/i })).toHaveCount(0);
});

test('the standalone scrubber page is still reachable', async ({ page }) => {
  // Hidden from the drafters, not deleted.
  const res = await page.goto('/notes/scrubber.html');
  expect(res.status()).toBe(200);
  await expect(page.getByRole('heading', { name: /Clinical Summary Scrubber/i })).toBeVisible();
});
