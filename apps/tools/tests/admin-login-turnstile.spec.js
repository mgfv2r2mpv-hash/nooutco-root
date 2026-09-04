import { test, expect } from '@playwright/test';

// Regression for "Verification failed. Please complete the challenge and retry."
// on a correct admin password.
//
// The worker enforces Turnstile on /api/login whenever TURNSTILE_SECRET is set,
// and verifyTurnstile() returns false on an empty token before any password
// comparison. Both admin doors - the sign-in modal on / and the login card on
// /admin/ - posted { password } with no token and never rendered a widget, so a
// correct password came back 403 and the message pointed the operator at a
// challenge that was not on screen. Neither page loaded the Turnstile script.
//
// These tests assert on the body the page actually posts, so they fail against
// the old markup for the real reason rather than a stubbed stand-in.

// The real widget cannot be solved headless. Stub window.turnstile with a manual
// trigger so each test controls exactly when the token appears, and block the
// CDN so the genuine api.js cannot overwrite the stub.
const STUB_TOKEN = 'stub-turnstile-token';

async function stubTurnstile(page, { autoFire = false } = {}) {
  await page.route('https://challenges.cloudflare.com/**', route => route.abort());
  await page.addInitScript(([token, auto]) => {
    window.__tsRenderCount = 0;
    window.__fireTurnstile = null;
    window.turnstile = {
      render(container, opts) {
        window.__tsRenderCount++;
        window.__fireTurnstile = () => opts.callback(token);
        if (auto) setTimeout(window.__fireTurnstile, 0);
        return 'stub-widget-id';
      },
      reset() {},
      remove() {},
    };
  }, [STUB_TOKEN, autoFire]);
}

// A token shaped like the worker's: base64url(JSON payload) + "." + signature.
// The pages decode the first segment to read exp/role, so a garbage string would
// send them down the logged-out path and hide a real failure.
function fakeSessionToken(role = 'admin') {
  const payload = { exp: Math.floor(Date.now() / 1000) + 3600, role };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.stub-signature`;
}

// Capture the login body and answer as the worker would on success.
async function captureLogin(page) {
  const captured = {};
  await page.route('**/api/login**', async route => {
    captured.body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: fakeSessionToken('admin'), role: 'admin' }),
    });
  });
  return captured;
}

test.describe('admin sign-in modal (/)', () => {
  test('posts the Turnstile token with the password', async ({ page }) => {
    await stubTurnstile(page);
    const captured = await captureLogin(page);

    await page.goto('/');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('noaba:admin-invoke')));

    // The widget must actually be asked for - a page that never renders one is
    // the defect itself.
    await expect.poll(() => page.evaluate(() => window.__tsRenderCount)).toBe(1);

    await page.fill('#adminPw', 'correct-horse-battery-staple');
    await page.evaluate(() => window.__fireTurnstile());
    await page.click('#adminUnlock');

    await expect.poll(() => captured.body).toBeTruthy();
    expect(captured.body.password).toBe('correct-horse-battery-staple');
    expect(captured.body.turnstileToken).toBe(STUB_TOKEN);
  });

  test('holds Unlock until the challenge passes', async ({ page }) => {
    await stubTurnstile(page);
    await page.goto('/');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('noaba:admin-invoke')));

    await expect(page.locator('#adminUnlock')).toBeDisabled();
    await page.evaluate(() => window.__fireTurnstile());
    await expect(page.locator('#adminUnlock')).toBeEnabled();
  });

  test('names the failure when the Turnstile script never loads', async ({ page }) => {
    // No stub at all: window.turnstile stays undefined, as it does when
    // challenges.cloudflare.com is blocked or unreachable.
    await page.route('https://challenges.cloudflare.com/**', route => route.abort());

    await page.goto('/');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('noaba:admin-invoke')));

    // A silent dead button reads as "I typed the wrong password". The page must
    // say what broke instead.
    await expect(page.locator('#adminError')).toContainText(/verification check could not load/i, {
      timeout: 15000,
    });
  });

  test('says so when the gate helper itself fails to load', async ({ page }) => {
    // A 404 on /assets/turnstile-gate.js used to throw inside renderModal and
    // leave Unlock bound to nothing - a button that does nothing, silently.
    await stubTurnstile(page);
    await page.route('**/assets/turnstile-gate.js', route => route.abort());

    await page.goto('/');
    await page.evaluate(() => document.dispatchEvent(new CustomEvent('noaba:admin-invoke')));

    await expect(page.locator('#adminError')).toContainText(/could not load/i);
    await expect(page.locator('#adminUnlock')).toBeDisabled();
  });
});

test.describe('admin passwords page (/admin/)', () => {
  test('posts the Turnstile token with the password', async ({ page }) => {
    await stubTurnstile(page);
    // The page loads its tables straight after a successful login; keep those
    // calls from erroring into the console and muddying the failure output.
    // Registered BEFORE the login route on purpose - Playwright matches handlers
    // newest-first, so a catch-all added last would swallow /api/login.
    await page.route('**/api/**', route => route.fulfill({
      status: 200, contentType: 'application/json', body: '{}',
    }));
    const captured = await captureLogin(page);

    await page.goto('/admin/');
    await expect.poll(() => page.evaluate(() => window.__tsRenderCount)).toBe(1);

    await page.fill('#pw', 'correct-horse-battery-staple');
    await page.evaluate(() => window.__fireTurnstile());
    await page.click('#loginBtn');

    await expect.poll(() => captured.body).toBeTruthy();
    expect(captured.body.password).toBe('correct-horse-battery-staple');
    expect(captured.body.turnstileToken).toBe(STUB_TOKEN);
  });

  test('holds Log in until the challenge passes', async ({ page }) => {
    await stubTurnstile(page);
    await page.goto('/admin/');

    await expect(page.locator('#loginBtn')).toBeDisabled();
    await page.evaluate(() => window.__fireTurnstile());
    await expect(page.locator('#loginBtn')).toBeEnabled();
  });
});
