import { test, expect } from '@playwright/test';
import { captureClipboard } from './helpers/clipboard.js';

// Horae Zone mails links of the form HZ_LINK_BASE#<code> and
// HZ_REOPEN_BASE#<token> (packages/account-engine/src/mailer.mjs fragmentLink).
// The deploy points those bases at /account/ and /account/reopen/ here. The
// page shows the code for the reader to paste into Sass C. Assistant, which
// makes the service call through its own bridge: the service answers POST only,
// so a browser page could not call it even if it wanted to.
//
// What these hold down: the code is shown and copies exactly, the address bar
// forgets it, no request leaves the page carrying it, a link without one says
// so, and the Worker sends the locked-down headers on both paths.

// base64url like the real thing (the mailer refuses anything else), and plainly
// not a real code.
const CODE = 'TESTnotARealCode_0123-x';

const PAGES = [
  {
    name: 'sign-up',
    path: '/account/',
    line: 'Paste this into Sass C. Assistant to finish signing up.',
  },
  {
    name: 'reopen',
    path: '/account/reopen/',
    line: 'Paste this into Sass C. Assistant to reopen your code path.',
  },
];

// Every request the page makes is recorded with everything that could carry
// the code, and anything off this host is refused so a third party cannot be
// reached even by accident.
async function recordRequests(page) {
  const seen = [];
  await page.route('**/*', async (route) => {
    const req = route.request();
    seen.push({
      url: req.url(),
      body: req.postData() || '',
      headers: JSON.stringify(await req.allHeaders()),
    });
    if (/^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(req.url())) return route.abort('failed');
    return route.continue();
  });
  return seen;
}

for (const p of PAGES) {
  test.describe(`${p.name} link page (${p.path})`, () => {
    test('shows the code from the link with the paste line', async ({ page }) => {
      await page.goto(`${p.path}#${CODE}`);

      await expect(page.locator('#code')).toHaveText(CODE);
      await expect(page.getByText(p.line)).toBeVisible();
      await expect(page.locator('#missing')).toBeHidden();
    });

    test('Copy puts exactly the code on the clipboard and says so', async ({ page }) => {
      await captureClipboard(page);
      await page.goto(`${p.path}#${CODE}`);

      await page.getByRole('button', { name: 'Copy' }).click();

      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE);
      await expect(page.locator('#copy-status')).toHaveText('Copied');
    });

    test('clears the code from the address bar after reading it', async ({ page }) => {
      await page.goto(`${p.path}#${CODE}`);
      await expect(page.locator('#code')).toHaveText(CODE);

      expect(page.url()).not.toContain('#');
      expect(page.url()).not.toContain(CODE);
      expect(await page.evaluate(() => location.hash)).toBe('');
      expect(new URL(page.url()).pathname).toBe(p.path);
    });

    test('no request the page makes carries the code', async ({ page }) => {
      const seen = await recordRequests(page);
      await captureClipboard(page);

      await page.goto(`${p.path}#${CODE}`);
      await expect(page.locator('#code')).toHaveText(CODE);
      await page.getByRole('button', { name: 'Copy' }).click();
      await expect(page.locator('#copy-status')).toHaveText('Copied');
      await page.waitForLoadState('networkidle');

      // The route saw the page itself, so an empty list would mean the check
      // never ran rather than that nothing leaked.
      expect(seen.some((r) => new URL(r.url).pathname === p.path)).toBe(true);
      const carrying = seen.filter((r) => [r.url, r.body, r.headers].some((s) => s.includes(CODE)));
      expect(carrying, 'a request carried the code').toEqual([]);
    });

    test('a link with no code says it is incomplete', async ({ page }) => {
      await page.goto(p.path);

      await expect(page.locator('#missing')).toBeVisible();
      await expect(page.locator('#missing')).toContainText('This link is incomplete.');
      await expect(page.locator('#missing')).toContainText('Open the newest email');
      await expect(page.locator('#found')).toBeHidden();
    });

    test('a fragment that is not a code is treated as no code', async ({ page }) => {
      await page.goto(`${p.path}#<img src=x onerror=alert(1)>`);

      await expect(page.locator('#missing')).toBeVisible();
      await expect(page.locator('#found')).toBeHidden();
      await expect(page.locator('img[src="x"]')).toHaveCount(0);
    });

    test('the Worker sends the locked-down headers', async ({ request }) => {
      const res = await request.get(p.path);
      expect(res.status()).toBe(200);
      const h = res.headers();

      const csp = h['content-security-policy'] || '';
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("style-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('connect-src');
      expect(h['referrer-policy']).toBe('no-referrer');
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['cache-control']).toBe('no-store');
    });

    test('the page runs under its own CSP without a violation of its own', async ({ page }) => {
      const violations = [];
      await page.exposeFunction('reportViolation', (v) => violations.push(v));
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          window.reportViolation(`${e.violatedDirective} ${e.blockedURI}`);
        });
      });

      await page.goto(`${p.path}#${CODE}`);
      await expect(page.locator('#code')).toHaveText(CODE);

      // The shared tokens.css @imports the web font from Google. This CSP
      // refuses it on purpose, so the page falls back to the system stack.
      // Anything else refused is the page breaking its own policy.
      const own = violations.filter((v) => !v.includes('fonts.googleapis.com'));
      expect(own).toEqual([]);
    });

    test('accessible: language, one heading, a named button and a live status', async ({ page }) => {
      await page.goto(`${p.path}#${CODE}`);

      expect(await page.locator('html').getAttribute('lang')).toBe('en');
      await expect(page.locator('h1:visible')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
      await expect(page.locator('#copy-status')).toHaveAttribute('aria-live', 'polite');
      // The heading names the code, and the section holding it is labelled by
      // that heading (an aria-label on a bare <code> is not allowed).
      await expect(page.locator('h1:visible')).toContainText('code');
      await expect(page.getByRole('region', { name: /code/ })).toContainText(CODE);

      await page.keyboard.press('Tab');
      await expect(page.getByRole('button', { name: 'Copy' })).toBeFocused();
    });
  });
}
