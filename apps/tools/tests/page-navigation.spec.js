import { test, expect } from '@playwright/test';

// Page navigation on tools.nooutco.me.
//
// Every page below the home shows Tools › <page> in the shared bar, and "Tools"
// leads home. Before 2026-09-17 a page with a single crumb rendered it as its
// own dead title, so session flow, graphVA, Suggest and Admin had nothing on
// the bar that led back, and CPR had no bar at all.
//
// Every note tool has its own address. The four BCBA tools share one page,
// which the Worker serves at /notes/sup/, /notes/assess/, /notes/parent/ and
// /notes/sap/, and old /notes/bcba/?tool=<id> links rewrite themselves in place.

const BELOW_HOME = [
  { path: '/session-flow/', crumb: 'In-Home Session Flow' },
  { path: '/graphVA/', crumb: 'Graph Visual Analysis' },
  { path: '/SuggestFeature/', crumb: 'Suggest a Feature' },
  { path: '/admin/', crumb: 'Admin' },
  { path: '/cpr/dist/', crumb: 'Conditional Probability Record & Analysis' },
];

const NOTE_TOOLS = [
  { id: 'bt', crumb: 'BT Direct Service Note', h1: 'BT Direct Service Note Tool', tab: null },
  { id: 'sup', crumb: 'Supervision Note', h1: 'Supervision Note Tool', tab: 'Supervision' },
  { id: 'assess', crumb: 'Assessment Note', h1: 'Assessment Note Tool', tab: 'Assessment' },
  { id: 'parent', crumb: 'Parent Note', h1: 'Parent Note Tool', tab: 'Parent Training' },
  { id: 'sap', crumb: 'SAP Goals & Planning', h1: 'SAP Goals & Planning Tool', tab: 'SAP' },
];

async function expectTrail(page, current) {
  const bar = page.locator('noaba-bar');
  const crumbs = bar.locator('.noaba-crumb');
  await expect(crumbs).toHaveCount(2);
  await expect(crumbs.nth(0)).toHaveText('Tools');
  await expect(crumbs.nth(0)).toHaveAttribute('href', '/');
  await expect(crumbs.nth(1)).toHaveText(current);
  await expect(crumbs.nth(1)).toHaveAttribute('aria-current', 'page');
  // The lit Tools segment is a way home too.
  await expect(bar.locator('a.noaba-seg[aria-current]')).toHaveAttribute('href', '/');
}

// Babel compiles the note engine in the browser, which is slow on a cold page.
async function waitForTool(page) {
  await page.waitForSelector('.tool-panel h1', { timeout: 45000 });
}

test('the tools home has no trail and its Tools segment is not a link', async ({ page }) => {
  await page.goto('/');
  const bar = page.locator('noaba-bar');
  await expect(bar.locator('.noaba-row')).toBeVisible();
  await expect(bar.locator('.noaba-crumb')).toHaveCount(0);
  await expect(bar.locator('span.noaba-seg[aria-current="page"]')).toHaveText(/Tools/);
});

for (const { path, crumb } of BELOW_HOME) {
  test(`${path} shows Tools › ${crumb}`, async ({ page }) => {
    await page.goto(path);
    await expectTrail(page, crumb);
  });
}

// Pages that pad their body used to leave the bar floating inset, and session
// flow's sticky jump menu was drawn over it.
for (const path of ['/', '/session-flow/', '/SuggestFeature/']) {
  test(`${path} runs the bar edge to edge from the top`, async ({ page }) => {
    await page.goto(path);
    const bar = page.locator('noaba-bar');
    await expect(bar.locator('.noaba-row')).toBeVisible();
    const box = await bar.boundingBox();
    const width = page.viewportSize().width;
    expect({ x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width) }).toEqual({ x: 0, y: 0, w: width });
  });
}

test('session flow pins its jump menu below the bar, not under it', async ({ page }) => {
  await page.goto('/session-flow/');
  await expect(page.locator('noaba-bar .noaba-row')).toBeVisible();
  await page.mouse.wheel(0, 2500);
  await expect.poll(async () => page.evaluate(() => {
    const bar = document.querySelector('noaba-bar').getBoundingClientRect();
    const nav = document.querySelector('.topnav').getBoundingClientRect();
    return Math.round(nav.top) - Math.round(bar.bottom);
  })).toBe(0);
});

test('CPR no longer shows its own Back link, which always opened the live site', async ({ page }) => {
  await page.goto('/cpr/dist/');
  await page.waitForSelector('#root header', { timeout: 30000 });
  // Absent after the next rebuild, hidden by dist/index.html until then.
  await expect(page.locator('#root header a[href="https://tools.nooutco.me"]')).toBeHidden();
});

for (const { id, crumb, h1, tab } of NOTE_TOOLS) {
  test(`/notes/${id}/ opens ${h1} with its own trail and tab title`, async ({ page }) => {
    await page.goto(`/notes/${id}/`);
    await waitForTool(page);
    await expect(page.locator('.tool-panel h1')).toHaveText(h1);
    await expect(page).toHaveURL(new RegExp(`/notes/${id}/$`));
    await expect(page).toHaveTitle(`${crumb} - No Outcome ABA`);
    await expectTrail(page, crumb);
    if (tab) await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  });
}

test('an old ?tool= link opens that tool and rewrites the address, keeping other switches', async ({ page }) => {
  await page.goto('/notes/bcba/?tool=parent&schema=off');
  await waitForTool(page);
  await expect(page.locator('.tool-panel h1')).toHaveText('Parent Note Tool');
  await expect(page).toHaveURL(/\/notes\/parent\/\?schema=off$/);
  await expectTrail(page, 'Parent Note');
});

test('/notes/bcba/ with no tool opens the first tool at its own address', async ({ page }) => {
  await page.goto('/notes/bcba/');
  await waitForTool(page);
  await expect(page).toHaveURL(/\/notes\/sup\/$/);
  await expect(page.locator('.tool-panel h1')).toHaveText('Supervision Note Tool');
});

test('a ribbon click moves the address, trail and title, and Back restores them', async ({ page }) => {
  await page.goto('/notes/assess/?expert=off');
  await waitForTool(page);

  await page.getByRole('tab', { name: 'SAP' }).click();
  await expect(page).toHaveURL(/\/notes\/sap\/\?expert=off$/);
  await expect(page.locator('.tool-panel h1')).toHaveText('SAP Goals & Planning Tool');
  await expect(page).toHaveTitle('SAP Goals & Planning - No Outcome ABA');
  await expectTrail(page, 'SAP Goals & Planning');

  await page.goBack();
  await expect(page).toHaveURL(/\/notes\/assess\/\?expert=off$/);
  await expect(page.locator('.tool-panel h1')).toHaveText('Assessment Note Tool');
  await expectTrail(page, 'Assessment Note');

  await page.reload();
  await waitForTool(page);
  await expect(page.locator('.tool-panel h1')).toHaveText('Assessment Note Tool');
});

test('redrawing the trail keeps the signed-in admin controls', async ({ page }) => {
  await page.goto('/graphVA/');
  const bar = page.locator('noaba-bar');
  await expect(bar.locator('.noaba-row')).toBeVisible();
  await page.evaluate(() => document.dispatchEvent(
    new CustomEvent('noaba:auth-state', { detail: { authed: true, admin: true } })));
  await expect(bar.locator('.noaba-admin')).toBeVisible();

  await page.evaluate(() => document.querySelector('noaba-bar').setAttribute('crumbs', 'Somewhere Else'));
  await expect(bar.locator('.noaba-crumb').nth(1)).toHaveText('Somewhere Else');
  await expect(bar.locator('.noaba-admin')).toBeVisible();
  await expect(bar.locator('.noaba-gear')).toHaveAttribute('data-authed', 'true');
});

// Server-side routing, checked hop by hop without a browser.
const REDIRECTS = [
  ['/NoteDrafter/SupNotes', '/notes/sup/'],
  ['/NoteDrafter/PTNotes', '/notes/parent/'],
  ['/NoteDrafter/AssessNotes', '/notes/assess/'],
  ['/NoteDrafter/SAPGoalsDrafter', '/notes/sap/'],
  ['/NoteDrafter/BTNotes', '/notes/bt/'],
  ['/NoteDrafter', '/'],
  ['/SessionFlow', '/session-flow/'],
  ['/CPRAnalyzer', '/cpr/'],
  ['/cpr/', '/cpr/dist/'],
  ['/cpr', '/cpr/dist/'],
];

for (const [from, to] of REDIRECTS) {
  test(`${from} redirects to ${to}`, async ({ request }) => {
    const res = await request.get(from, { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(new URL(res.headers()['location']).pathname).toBe(to);
  });
}

// These addresses used to 301 to ?tool=<id>. A redirect back would loop for any
// browser that cached the old one, so they must be served, never redirected.
for (const id of ['sup', 'assess', 'parent', 'sap']) {
  test(`/notes/${id}/ is served directly, not redirected`, async ({ request }) => {
    for (const path of [`/notes/${id}/`, `/notes/${id}`]) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status(), path).toBe(200);
      expect(await res.text(), path).toContain('/notes/bcba/tool-nav.js');
    }
  });
}

// The sweep: every link a visitor can see, crumbs included, has to land on a
// real page. Pages answers a missing path with the tools home and a 200, so a
// 200 is not enough; a non-home path that serves the home page counts as broken.
test('every rendered link on the tools site resolves to a real page', async ({ page, request, browserName }) => {
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
    if (!type.includes('text/html') || /\.(pdf|png|jpe?g|svg|csv|xlsx?|json|js|css)$/i.test(finalPath)) continue;

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
  const mustReach = ['/session-flow/', '/notes/bt/', '/notes/sup/', '/notes/assess/', '/notes/parent/',
    '/notes/sap/', '/cpr/dist/', '/graphVA/', '/SuggestFeature/'];
  expect(mustReach.filter((p) => !seen.has(p)), 'tool pages the walk never reached').toEqual([]);
});
