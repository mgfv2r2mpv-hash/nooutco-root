import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

// The supervisor view of technician style profiles.
//
// The first design deliberately hid individual cards from BCBAs. That was
// overruled on 2026-08-04: the heuristics about staff have to be visible over
// time, and a rule out of line with company or best practice policy has to be
// removable, silently, reviewed in supervision.
//
// Visible to a supervisor is not visible to everyone, so these tests are mostly
// about who is turned away. They run against the real _worker.js through
// `wrangler pages dev`, with a genuinely signed token, because a test that
// mocks the auth proves nothing about the auth.
//
// bt-profile-api is not running during these tests, so every authorised call
// also exercises the unavailable path, which is the state production sits in
// whenever the store is down. Note that the binding itself IS present locally:
// `wrangler pages dev` reads apps/tools/wrangler.jsonc, which is why the reason
// below is a status rather than "unbound".

const SECRET = 'playwright-local-test-secret';
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function tokenFor({ kid = 'pw:tech-1', role = 'user', expiresInSec = 3600 } = {}) {
  const payload = { role, kid, tools: ['bt'], exp: Math.floor(Date.now() / 1000) + expiresInSec };
  const payloadStr = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', SECRET).update(payloadStr).digest());
  return `${payloadStr}.${sig}`;
}
const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

const ADMIN = () => tokenFor({ role: 'admin', kid: 'pw:admin' });
const TECH = () => tokenFor({ role: 'user', kid: 'pw:tech-1' });

const READ_ROUTES = [
  '/api/admin/profile/roster.js',
  '/api/admin/profile/card.js?kid=pw:tech-1',
  '/api/admin/profile/history.js?kid=pw:tech-1',
];

test.describe('who can reach a technician profile', () => {
  for (const path of READ_ROUTES) {
    test(`${path.split('?')[0]} refuses an unauthenticated request`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(401);
    });

    // The important one. A technician's own token must not open the supervisor
    // view, or the whole "reviewed in supervision" framing is decoration.
    test(`${path.split('?')[0]} refuses a signed technician token`, async ({ request }) => {
      const res = await request.get(path, { headers: auth(TECH()) });
      expect(res.status()).toBe(401);
    });
  }

  test('removing a rule refuses a signed technician token', async ({ request }) => {
    const res = await request.post('/api/admin/profile/suppress.js', {
      headers: auth(TECH()),
      data: { kid: 'pw:tech-1', feature: 'hedging', removed: true },
    });
    expect(res.status()).toBe(401);
  });

  test('a forged admin signature is refused', async ({ request }) => {
    const good = ADMIN();
    const payload = good.split('.')[0];
    const forged = `${payload}.${b64url(createHmac('sha256', 'wrong-secret').update(payload).digest())}`;
    const res = await request.get('/api/admin/profile/roster.js', { headers: auth(forged) });
    expect(res.status()).toBe(401);
  });

  test('an expired admin token is refused', async ({ request }) => {
    const res = await request.get('/api/admin/profile/roster.js', {
      headers: auth(tokenFor({ role: 'admin', expiresInSec: -60 })),
    });
    expect(res.status()).toBe(401);
  });
});

test.describe('the route surface is a closed list', () => {
  test('an unknown subroute is not forwarded', async ({ request }) => {
    const res = await request.get('/api/admin/profile/events.js', { headers: auth(ADMIN()) });
    expect(res.status()).toBe(404);
  });

  test('a read route cannot be called as a write', async ({ request }) => {
    const res = await request.post('/api/admin/profile/roster.js', {
      headers: auth(ADMIN()), data: {},
    });
    expect(res.status()).toBe(404);
  });

  test('a write route cannot be called as a read', async ({ request }) => {
    const res = await request.get('/api/admin/profile/suppress.js', { headers: auth(ADMIN()) });
    expect(res.status()).toBe(404);
  });
});

test.describe('when the profile store is unreachable', () => {
  // It is not bound in dev, which is the point: an admin gets a clear failure
  // rather than an empty list that reads as "this technician has no rules".
  for (const path of READ_ROUTES) {
    test(`${path.split('?')[0]} says it is unavailable rather than returning nothing`, async ({ request }) => {
      const res = await request.get(path, { headers: auth(ADMIN()) });
      expect(res.status()).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/unavailable/i);
      // The reason must name which of the ways it failed, so the next person
      // does not spend a day guessing between "no binding", "the Worker
      // answered with an error" and "the Worker never answered". Asserting the
      // closed shape rather than one value, because which one is true depends
      // on the environment and pinning the local one would test the harness.
      expect(body.reason, 'a failure must say which failure it was').toBeTruthy();
      expect(body.reason).toMatch(/^(unbound|status_\d{3}|[A-Za-z]+Error|error)$/);
      expect(body.reason).not.toBe('ok');
    });
  }
});

test.describe('the admin page carries the tab', () => {
  test('the profiles tab is present and its panel exists', async ({ page }) => {
    await page.goto('/admin/');
    // Shortened from "Style Profiles" when Knowledge became a seventh tab: the
    // nav has to hold every tab on one row at desktop width, and three shorter
    // labels bought that without touching the padding every tab shares.
    await expect(page.locator('.tab-btn[data-tab="profiles"]')).toHaveText(/Profiles/);
    await expect(page.locator('#tab-profiles')).toHaveCount(1);
    await expect(page.locator('#profRoster')).toHaveCount(1);
  });

  test('the page has no script errors, so the tab wiring parses', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/admin/');
    await page.waitForLoadState('domcontentloaded');
    expect(errors, `script errors on /admin/: ${errors.join(' | ')}`).toEqual([]);
  });
});
