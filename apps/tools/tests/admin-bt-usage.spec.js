import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

/* THE BT USAGE REPORT. His words, 3 Oct 2026: "I do want some reporting on BT
 * note tool use so that I can guide their performance. Can't do that blind."
 * Per BT and per tool: how often a NoMe suggestion was accepted as is, edited,
 * replaced with their own words, or left unrefined. Counts and rates only.
 *
 * The route tests run the real _worker.js under `wrangler pages dev`, where
 * bt-profile-api is not running, so an admin reaches the unavailable path. The
 * page tests mock the report. Every label, id and count below is invented. */

const SECRET = 'playwright-local-test-secret';
const TOKEN_KEY = 'notes_auth_token';
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function tokenFor({ kid = 'pw:tech-1', role = 'user' } = {}) {
  const payload = { role, kid, tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
  const payloadStr = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', SECRET).update(payloadStr).digest());
  return `${payloadStr}.${sig}`;
}
const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

const line = (tool, sends, counts) => {
  const questions = Object.values(counts).reduce((a, b) => a + b, 0);
  const rates = Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, questions ? Math.round((v / questions) * 1000) / 1000 : null]));
  return { tool, sends, questions, counts, rates };
};

const REPORT = {
  windowDays: 30,
  rowCap: 20000,
  capped: false,
  skipped: 0,
  technicians: [
    {
      kid: 'a1b2c3',
      tools: [line('bt', 6, { accepted_as_is: 12, edited: 4, own_words: 3, not_refined: 1 })],
      total: line('all', 6, { accepted_as_is: 12, edited: 4, own_words: 3, not_refined: 1 }),
    },
    {
      kid: 'd4e5f6',
      tools: [line('bt', 3, { accepted_as_is: 1, edited: 2, own_words: 5, not_refined: 0 })],
      total: line('all', 3, { accepted_as_is: 1, edited: 2, own_words: 5, not_refined: 0 }),
    },
  ],
  tools: [line('bt', 9, { accepted_as_is: 13, edited: 6, own_words: 8, not_refined: 1 })],
};

async function openProfiles(page, { report = REPORT, status = 200, passwords = null } = {}) {
  const asked = [];
  await page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, tokenFor({ role: 'admin', kid: 'pw:admin' })]);
  await page.route('**/api/admin/profile/roster**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ technicians: [] }) }));
  await page.route('**/api/admin/profile/usage**', (route) => {
    asked.push(new URL(route.request().url()).searchParams.get('days'));
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(status === 200 ? report : { error: 'Style profile is unavailable right now.' }),
    });
  });
  await page.route('**/api/admin/passwords**', (route) =>
    passwords
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ passwords }) })
      : route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"down"}' }));
  await page.goto('/admin/');
  await page.getByRole('button', { name: 'Profiles', exact: true }).click();
  return { asked };
}

test.describe('the usage route is admin only', () => {
  test('an admin reaches the route rather than a 404', async ({ request }) => {
    const res = await request.get('/api/admin/profile/usage.js?days=30', { headers: auth(tokenFor({ role: 'admin', kid: 'pw:admin' })) });
    expect(res.status(), 'the usage route is not on the allowlist').not.toBe(404);
    expect([200, 503]).toContain(res.status());
  });

  test('a technician cannot read it', async ({ request }) => {
    const res = await request.get('/api/admin/profile/usage.js?days=30', { headers: auth(tokenFor()) });
    expect(res.status()).toBe(401);
  });

  test('an unauthenticated request cannot read it', async ({ request }) => {
    const res = await request.get('/api/admin/profile/usage.js');
    expect(res.status()).toBe(401);
  });

  test('it cannot be called as a write', async ({ request }) => {
    const res = await request.post('/api/admin/profile/usage.js', { headers: auth(tokenFor({ role: 'admin', kid: 'pw:admin' })), data: {} });
    expect(res.status()).toBe(404);
  });
});

test.describe('the BT usage card', () => {
  test('one block per BT and a cohort line, with each kind as a rate and a count', async ({ page }) => {
    await openProfiles(page);
    const card = page.locator('#usageCard');
    await expect(card.locator('[data-usage-kid]')).toHaveCount(3);
    await expect(card.locator('[data-usage-kid="all"]')).toContainText('All BTs');

    const first = card.locator('[data-usage-kid="a1b2c3"] [data-usage-tool="bt"]');
    await expect(first).toContainText('BT Direct Session');
    await expect(first).toContainText('20 questions');
    await expect(first.locator('[data-kind="accepted_as_is"]')).toHaveText('60%Accepted as is (12)');
    await expect(first.locator('[data-kind="edited"]')).toHaveText('20%Edited (4)');
    await expect(first.locator('[data-kind="own_words"]')).toHaveText('15%Own words (3)');
    await expect(first.locator('[data-kind="not_refined"]')).toHaveText('5%Left unrefined (1)');
    await expect(first.locator('.use-bar')).toHaveAttribute('aria-label', /Accepted as is 60%, Edited 20%, Own words 15%, Left unrefined 5%/);
  });

  test('a BT is named by their password label when the list knows it, and by id otherwise', async ({ page }) => {
    await openProfiles(page, { passwords: [{ id: 'a1b2c3', label: 'Avery T.' }] });
    await expect(page.locator('[data-usage-kid="a1b2c3"] .use-who strong')).toHaveText('Avery T.');
    await expect(page.locator('[data-usage-kid="a1b2c3"] .use-who code')).toHaveText('a1b2c3');
    await expect(page.locator('[data-usage-kid="d4e5f6"] .use-who strong')).toHaveText('d4e5f6');
  });

  test('a failed Passwords read still shows the report', async ({ page }) => {
    await openProfiles(page, { passwords: null });
    await expect(page.locator('[data-usage-kid="a1b2c3"] .use-who strong')).toHaveText('a1b2c3');
  });

  test('the window buttons ask for that many days, and 30 is the default', async ({ page }) => {
    const { asked } = await openProfiles(page);
    await expect(page.locator('[data-usage-days="30"]')).toHaveClass(/active/);
    await page.locator('[data-usage-days="7"]').click();
    await expect(page.locator('[data-usage-days="7"]')).toHaveClass(/active/);
    await expect.poll(() => asked).toEqual(['30', '7']);
  });

  test('an empty window says so rather than drawing nothing', async ({ page }) => {
    await openProfiles(page, { report: { ...REPORT, technicians: [], tools: [] } });
    await expect(page.locator('#usageEmpty')).toBeVisible();
    await expect(page.locator('#usageRows [data-usage-kid]')).toHaveCount(0);
  });

  test('a store that is down says so in the card', async ({ page }) => {
    await openProfiles(page, { status: 503 });
    await expect(page.locator('#usageError')).toBeVisible();
    await expect(page.locator('#usageError')).toContainText(/unavailable/i);
  });

  test('the card shows no text but labels, ids, tool names and numbers', async ({ page }) => {
    await openProfiles(page);
    await expect(page.locator('#usageRows [data-usage-kid]')).toHaveCount(3);
    const text = await page.locator('#usageRows').innerText();
    // Split on space and punctuation only, so an id like a1b2c3 stays whole.
    const words = text.split(/[\s()·]+/).filter((w) => w && !/^\d+%?$/.test(w));
    const allowed = new Set(['All', 'BTs', 'BT', 'Direct', 'Session', 'questions', 'Sends', 'Send', 'Accepted', 'as', 'is',
      'Edited', 'Own', 'words', 'Left', 'unrefined', 'a1b2c3', 'd4e5f6']);
    for (const w of words) expect(allowed.has(w), `unexpected word in the report: ${w}`).toBe(true);
  });

  test('at phone width the card scrolls nothing sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openProfiles(page);
    await expect(page.locator('[data-usage-kid="a1b2c3"]')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
