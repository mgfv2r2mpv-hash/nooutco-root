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

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.tool-ribbon button')).toHaveCount(ribbonTabs);
    await expect(page.locator('textarea').first()).toBeVisible();
    // Collapsed by default so it never covers the form on arrival.
    await expect(page.locator('.revision-fab')).toBeVisible();
    await expect(page.locator('.revision-panel')).toHaveCount(0);
    // The shared stylesheet is actually applied, not just linked.
    await expect(page.locator('#root')).toHaveCSS('padding-right', '20px');

    // A logged-out page 401s on /api/nonpii by design; anything else is a defect.
    const real = errors.filter((e) => !/401|Unauthorized|Failed to load resource/i.test(e));
    expect(real, `console errors on ${tool}: ${real.join(' | ')}`).toEqual([]);
  });
}
