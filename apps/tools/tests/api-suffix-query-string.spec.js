import { test, expect } from '@playwright/test';

// API_SUFFIX has to land on the PATH, not on the end of the whole URL.
//
// _worker.js exempts an /api/* request from Super Bot Fight Mode by testing
// url.pathname.endsWith(".js") and then stripping the suffix before routing. So the
// suffix is only doing its job while it is the last thing in the PATH. Appended to the
// end of a string that already carried a query, it corrupted the final parameter and
// left the pathname without the ".js" the exemption is keyed on - and because
// styleCardGet swallows its own failures and returns an empty card, the symptom was
// indistinguishable from "the profile store had nothing to say".
//
// These assert the URL that is actually sent rather than the return value, and the
// route glob below is deliberately broad enough to capture the BROKEN shape too. A glob
// written as "**/api/style-card.js*" would simply not match the old URL, the request
// would fall through, and the test would pass for the wrong reason. That is the exact
// way the existing suite missed this.

/** Log in with a token the page accepts. Only the server verifies the signature. */
async function login(page, tool = 'bt') {
  await page.goto(`/notes/${tool}/`);
  await page.evaluate((t) => {
    const payload = { role: 'user', kid: 'pw:tech-1', tools: [t], exp: Math.floor(Date.now() / 1000) + 3600 };
    const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    localStorage.setItem('notes_auth_token', `${b64}.local-test`);
  }, tool);
  await page.reload();
}

test.describe('API_SUFFIX lands on the path, not after the query string', () => {
  test('a path with no query still gets a .js pathname and a cache-buster', async ({ page }) => {
    await login(page);
    const built = await page.evaluate(() => window.NotesGate.apiUrl('/api/llm-call'));
    const url = new URL(built, 'https://example.test');

    expect(url.pathname).toBe('/api/llm-call.js');
    expect(url.searchParams.get('_')).toMatch(/^\d+$/);
  });

  test('a path carrying a query keeps every parameter intact', async ({ page }) => {
    await login(page);
    const built = await page.evaluate(() =>
      window.NotesGate.apiUrl('/api/style-card?tool=bt&seed=abc'));
    const url = new URL(built, 'https://example.test');

    // The half that broke the edge exemption.
    expect(url.pathname).toBe('/api/style-card.js');
    expect(url.pathname.endsWith('.js')).toBe(true);

    // The half that corrupted the payload: seed must be "abc", never "abc.js".
    expect(url.searchParams.get('tool')).toBe('bt');
    expect(url.searchParams.get('seed')).toBe('abc');
    expect(url.searchParams.get('_')).toMatch(/^\d+$/);
  });

  test('the suffix appears exactly once, wherever the query sits', async ({ page }) => {
    await login(page);
    const urls = await page.evaluate(() => [
      window.NotesGate.apiUrl('/api/style-card'),
      window.NotesGate.apiUrl('/api/style-card?tool=bt'),
      window.NotesGate.apiUrl('/api/style-card?tool=bt&seed=abc'),
    ]);
    for (const u of urls) {
      expect(u.split('.js').length - 1).toBe(1);
      expect(new URL(u, 'https://example.test').pathname).toBe('/api/style-card.js');
    }
  });

  test('the real style-card read sends a request the edge would exempt', async ({ page }) => {
    await login(page);

    // Broad on purpose: this matches the fixed URL AND the broken one.
    const sent = [];
    await page.route('**/api/style-card*', (route) => {
      sent.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ available: false, rules: [], block: '', shapeBlock: '' }),
      });
    });

    await page.evaluate(() => window.NotesGate.styleCard.get({ tool: 'bt', seed: 'abc' }));

    // The page reads the card on load as well, with no options, so more than one
    // request is expected. EVERY one of them has to carry the exempt pathname.
    expect(sent.length).toBeGreaterThan(0);
    for (const u of sent) {
      expect(new URL(u).pathname).toBe('/api/style-card.js');
    }

    // The seeded read is the one that was broken. It has to be here, and intact.
    const seeded = sent.map((u) => new URL(u)).filter((u) => u.searchParams.has('seed'));
    expect(seeded.length).toBe(1);
    expect(seeded[0].searchParams.get('seed')).toBe('abc');
    expect(seeded[0].searchParams.get('tool')).toBe('bt');
  });
});
