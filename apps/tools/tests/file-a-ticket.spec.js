import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

// "If I am logged in as an admin and I get feedback on something like hate, the
// Page is doing this and I don't like it, it should be smart and asked me if I
// want to submit that as a ticket stub that can be grilled and made into
// something proper for development later."
//
// His answer on where it goes: a GitHub issue on nooutco-root, because that is
// where the work already lives.
//
// It needs GITHUB_ISSUE_TOKEN: a fine-grained token with Issues: write and
// nothing else, set as a Pages secret. Until it exists the route says so rather
// than pretending to have filed anything, which is what these tests pin.

const SECRET = 'playwright-local-test-secret';
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function signed({ role = 'admin', kid = 'pw:admin' } = {}) {
  const payload = { role, kid, tools: ['bt'], exp: Math.floor(Date.now() / 1000) + 3600 };
  const p = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${p}.${b64url(createHmac('sha256', SECRET).update(p).digest())}`;
}
const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });

test.describe('who may file a ticket', () => {
  test('an unauthenticated request is refused', async ({ request }) => {
    const res = await request.post('/api/admin/ticket.js', { data: { note: 'the page is doing a thing' } });
    expect(res.status()).toBe(401);
  });

  test('a signed technician token is refused', async ({ request }) => {
    // The tracker is not a place a technician should be able to write to.
    const res = await request.post('/api/admin/ticket.js', {
      headers: auth(signed({ role: 'user', kid: 'pw:tech' })),
      data: { note: 'the page is doing a thing' },
    });
    expect(res.status()).toBe(401);
  });

  test('an empty note is refused rather than filed', async ({ request }) => {
    const res = await request.post('/api/admin/ticket.js', {
      headers: auth(signed()), data: { note: '  ' },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe('when no issue token is configured', () => {
  test('it says so plainly instead of pretending', async ({ request }) => {
    // An admin who believes they filed a ticket and did not is worse off than
    // one told the wiring is missing.
    const res = await request.post('/api/admin/ticket.js', {
      headers: auth(signed()),
      data: { note: 'the assistant panel covers the follow-up section on a laptop' },
    });
    expect(res.status()).toBe(503);
    const body = await res.json();
    expect(body.error).toMatch(/nothing was filed/i);
    expect(body.reason).toBe('no_issue_token');
  });
});

test.describe('the offer in the panel', () => {
  function tokenFor(role) {
    const p = { role, kid: 'k', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
    return Buffer.from(JSON.stringify(p)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.sig';
  }

  async function pointAtThePage(page, role) {
    await page.goto('/notes/bt/');
    await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor(role));
    await page.goto('/notes/bt/');
    await page.waitForSelector('#root h1', { timeout: 45000 });
    await page.locator('.point-toggle').click();
    await page.locator('h1').click();
  }

  test('an admin pointing at the page gets offered a stub, not a revision', async ({ page }) => {
    await pointAtThePage(page, 'admin');
    await expect(page.locator('.revision-chip')).toContainText('About the page');

    let llmCalls = 0;
    await page.route('**/api/llm-call**', (r) => { llmCalls++; return r.abort(); });

    await page.locator('.revision-input').fill('I hate that this heading takes a whole row');
    await page.locator('.revision-send').click();

    const offer = page.locator('.ticket-offer');
    await expect(offer).toBeVisible();
    await expect(offer).toContainText('I hate that this heading takes a whole row');
    // Feedback about the tool must never be sent to the note model.
    expect(llmCalls, 'page feedback must not become a revision').toBe(0);
  });

  test('declining keeps the text in the conversation', async ({ page }) => {
    await pointAtThePage(page, 'admin');
    await page.locator('.revision-input').fill('the panel covers the follow-up section');
    await page.locator('.revision-send').click();
    await expect(page.locator('.ticket-offer')).toBeVisible();

    await page.getByRole('button', { name: 'Not now' }).click();
    await expect(page.locator('.ticket-offer')).toHaveCount(0);
    // Nothing is lost by declining.
    await expect(page.locator('.revision-panel-body')).toContainText('the panel covers the follow-up section');
  });

  test('a failure to file says so and keeps the text', async ({ page }) => {
    await pointAtThePage(page, 'admin');
    await page.route('**/api/admin/ticket**', (r) => r.fulfill({
      status: 503, contentType: 'application/json',
      body: JSON.stringify({ error: 'No GitHub token is configured, so nothing was filed.', reason: 'no_issue_token' }),
    }));
    await page.locator('.revision-input').fill('the timer pill overlaps the nav on a phone');
    await page.locator('.revision-send').click();
    await page.getByRole('button', { name: 'File it' }).click();

    await expect(page.locator('.revision-panel-body')).toContainText(/Could not file it/i);
    await expect(page.locator('.revision-panel-body')).toContainText(/Nothing was lost/i);
    await expect(page.locator('.revision-panel-body')).toContainText('the timer pill overlaps the nav on a phone');
  });

  test('filing reports the issue number', async ({ page }) => {
    await pointAtThePage(page, 'admin');
    await page.route('**/api/admin/ticket**', (r) => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, number: 412, url: 'https://github.com/x/y/issues/412' }),
    }));
    await page.locator('.revision-input').fill('the copy button is easy to hit by accident');
    await page.locator('.revision-send').click();
    await page.getByRole('button', { name: 'File it' }).click();

    await expect(page.locator('.revision-panel-body')).toContainText('#412');
    // Labelled a stub so nobody builds it before he has grilled it.
    await expect(page.locator('.revision-panel-body')).toContainText(/stub/i);
    await expect(page.locator('.ticket-offer')).toHaveCount(0);
  });

  test('a technician never gets the offer, because they cannot point at the page', async ({ page }) => {
    await pointAtThePage(page, 'user');
    // The click on the heading did nothing at all for a technician.
    await expect(page.locator('.revision-chip')).toHaveCount(0);
    await expect(page.locator('.ticket-offer')).toHaveCount(0);
  });
});
