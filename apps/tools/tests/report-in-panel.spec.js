import { test, expect } from '@playwright/test';

// The error report and the assistant were two round buttons pinned to the same
// corner: #eb-float-btn at bottom 14/right 14, .revision-fab at 18/18. One sat
// on top of the other.
//
// The report now lives inside the assistant panel on the notes pages only, and
// it has to survive being logged out, because the bug most worth reporting from
// the login screen is the login screen.

const NOTES_PAGES = ['/notes/bt/', '/notes/bcba/'];

function tokenFor(role = 'user', tools = ['bt', 'sup']) {
  const payload = { role, kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools };
  const b64 = Buffer.from(JSON.stringify(payload))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${b64}.not-a-real-signature`;
}

test.describe('the report button and the assistant do not share a corner', () => {
  for (const path of NOTES_PAGES) {
    test(`${path} ships no floating report circle`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('.revision-fab')).toBeVisible();
      await expect(page.locator('#eb-float-btn')).toHaveCount(0);
    });
  }

  // The other half of the claim. Removing the circle everywhere would also make
  // the assertions above pass, and would quietly cost every non-notes page its
  // only way to report anything.
  test('pages without an assistant keep the floating circle', async ({ page }) => {
    await page.goto('/session-flow/');
    await expect(page.locator('#eb-float-btn')).toHaveCount(1);
  });

  // If the circle ever comes back to a notes page, this is the failure it
  // caused: two fixed controls occupying the same pixels.
  test('nothing overlaps the assistant pill on the BT page', async ({ page }) => {
    await page.goto('/notes/bt/');
    const fab = page.locator('.revision-fab');
    await expect(fab).toBeVisible();

    // Scans every fixed control on the page for one sitting on the pill.
    const scan = () => page.evaluate(() => {
      const pill = document.querySelector('.revision-fab');
      const b = pill.getBoundingClientRect();
      const hits = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('.revision-fab')) continue;
        // The pill's own container is not a collision. .revision-dock holds the
        // pill and the point-mode selector side by side, so it contains the
        // pill's box by design; flagging an ancestor would make this permanently
        // red without anything ever stacking.
        if (el.contains(pill)) continue;
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (cs.pointerEvents === 'none') continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const overlaps = r.left < b.right && r.right > b.left &&
                         r.top < b.bottom && r.bottom > b.top;
        if (overlaps) hits.push(el.id || String(el.className) || el.tagName);
      }
      return hits;
    });

    expect(await scan()).toEqual([]);

    // Proves the scan can see a collision rather than being vacuously green:
    // put a decoy back at the exact geometry the old floating report circle
    // used - bottom 14px, right 14px, 40 square - and it must be found.
    await page.evaluate(() => {
      const decoy = document.createElement('div');
      decoy.id = 'decoy-float-btn';
      decoy.setAttribute('style',
        'position:fixed;bottom:14px;right:14px;width:40px;height:40px;z-index:500;background:#d97706;');
      document.body.appendChild(decoy);
    });
    expect(await scan()).toContain('decoy-float-btn');
  });
});

test.describe('reporting a problem from inside the assistant', () => {
  test('is reachable while logged out, which is when a login bug happens', async ({ page }) => {
    await page.goto('/notes/bt/');
    await page.evaluate(() => localStorage.removeItem('notes_auth_token'));
    await page.reload();

    // Same pill, same name, signed in or not - what changes is what is inside.
    const fab = page.locator('.revision-fab');
    await expect(fab).toContainText('Ask');
    await fab.click();
    await expect(page.locator('.revision-panel-head')).toContainText('Ask');

    const report = page.getByRole('button', { name: /Report a problem/i });
    await expect(report).toBeVisible();
    await report.click();

    await expect(page.locator('#eb-backdrop')).toBeVisible();
    // The category picker is what makes a report valid on its own, so a person
    // who cannot log in can still file one without typing anything.
    await expect(page.locator('#eb-kind')).toBeVisible();
  });

  test('is reachable while logged in, under the composer', async ({ page }) => {
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.reload();

    const fab = page.locator('.revision-fab');
    await expect(fab).toContainText('Ask');
    await fab.click();

    // The composer is still the primary thing in the footer.
    await expect(page.locator('.revision-input')).toBeVisible();

    const report = page.getByRole('button', { name: /Report a problem/i });
    await expect(report).toBeVisible();
    await report.click();
    await expect(page.locator('#eb-backdrop')).toBeVisible();
  });

  test('opening the report does not collapse the panel behind it', async ({ page }) => {
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
    await page.reload();

    await page.locator('.revision-fab').click();
    await page.getByRole('button', { name: /Report a problem/i }).click();
    await expect(page.locator('#eb-backdrop')).toBeVisible();

    // Clicking inside the modal is a click outside the panel. The panel must
    // not treat that as "tap off to collapse" - the conversation is usually
    // what the report is about.
    await page.locator('#eb-kind').click();
    await expect(page.locator('.revision-panel')).toBeVisible();
  });

  test('the report modal opens above the login dialog, not behind it', async ({ page }) => {
    await page.goto('/notes/bt/');
    const z = await page.evaluate(() => {
      const s = document.createElement('div');
      s.id = 'eb-backdrop';
      document.body.appendChild(s);
      const v = getComputedStyle(s).zIndex;
      s.remove();
      return parseInt(v, 10);
    });
    // notes-gate's login backdrop is 9999 and notes-scrub's review is 10000.
    expect(z).toBeGreaterThan(10000);
  });
});
