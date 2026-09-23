import { test, expect } from '@playwright/test';

// Smoke coverage for Red Carpet Convos (a version of the Famous Person game).
// Drives the two-phase flow far enough to prove each screen mounts, the roster
// loads from people.json, and the hub card links to it.

test.describe('Red Carpet Convos', () => {
  test('setup screen loads with heading and CTA', async ({ page }) => {
    await page.goto('/red-carpet-convos/');
    await expect(page.getByRole('heading', { name: /Meet and discuss someone famous/ })).toBeVisible();
    await expect(page.locator('[data-act="begin"]')).toBeVisible();
  });

  test('runs from Setup → Meet → Talk with a karaoke prompt', async ({ page }) => {
    await page.goto('/red-carpet-convos/');

    // Setup → Meet
    await page.locator('[data-act="begin"]').click();
    await expect(page.locator('[data-act="newPerson"]')).toBeVisible(); // Meet header

    // Reveal all facts, then start the conversation
    for (let i = 0; i < 3; i++) {
      const next = page.locator('[data-act="revealNext"]');
      if (await next.count()) await next.click();
    }
    await page.locator('[data-act="startTalk"]').first().click();

    // Talk: the support/score row and a sayable (karaoke) prompt are present
    await expect(page.locator('[data-act="score"]')).toBeVisible();
    await expect(page.locator('[data-act="miss"]')).toBeVisible();
    await expect(page.locator('#rcc [data-say]')).toHaveCount(1);

    // Scoring a comment advances to the volley
    await page.locator('[data-act="score"]').click();
    await expect(page.getByText('Ask a question back')).toBeVisible();
  });

  test('roster loads from people.json (search finds a person)', async ({ page }) => {
    await page.goto('/red-carpet-convos/');
    await page.locator('[data-act="begin"]').click();
    await page.locator('[data-act="toggleSearch"]').click();
    await page.locator('#rcc-search-input').fill('Serena');
    await expect(page.locator('#rcc-search-results').getByText('Serena Williams')).toBeVisible();
  });

  test('games hub links to the new game', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('a.card[href="./red-carpet-convos/"]');
    await expect(card).toBeVisible();
    await expect(card.getByText('Red Carpet Convos')).toBeVisible();
  });
});

// Roster integrity. The game only surfaces people flagged converted, so a
// malformed entry does not crash anything: it plays a broken card mid-session.
// These checks read people.json directly so every live person is covered.
const FACT_FIELDS = ['text', 'topic', 'say', 'sayShort', 'ask', 'askYou', 'bridge'];
const DASHES = /[–—]/;

test.describe('Red Carpet Convos roster', () => {
  test('every live person has four complete facts', async ({ request }) => {
    const res = await request.get('/red-carpet-convos/people.json');
    expect(res.ok()).toBe(true);
    const live = (await res.json()).people.filter((p) => p.converted === true);
    const problems = [];
    const seen = new Set();
    for (const p of live) {
      if (seen.has(p.name)) problems.push(`${p.name}: listed twice`);
      seen.add(p.name);
      for (const k of ['name', 'years', 'tag', 'emoji', 'img']) {
        if (typeof p[k] !== 'string' || !p[k].trim()) problems.push(`${p.name}: no ${k}`);
      }
      if (!Array.isArray(p.facts) || p.facts.length !== 4) {
        problems.push(`${p.name}: ${p.facts?.length ?? 0} facts`);
        continue;
      }
      p.facts.forEach((f, i) => {
        for (const k of FACT_FIELDS) {
          const v = f[k];
          if (typeof v !== 'string') problems.push(`${p.name} fact ${i + 1}: no ${k}`);
          else if (k === 'bridge' && i === 0 ? v !== '' : !v.trim()) problems.push(`${p.name} fact ${i + 1}: bad ${k}`);
          else if (DASHES.test(v)) problems.push(`${p.name} fact ${i + 1}: dash in ${k}`);
        }
      });
    }
    expect(live.length).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test('every live person has a portrait that is an image', async ({ request, browserName }) => {
    // One browser is enough: this reads files over HTTP and never renders.
    test.skip(browserName !== 'chromium', 'network-only check');
    test.setTimeout(120_000);
    const live = (await (await request.get('/red-carpet-convos/people.json')).json()).people.filter((p) => p.converted === true);
    const notImages = [];
    for (let i = 0; i < live.length; i += 20) {
      await Promise.all(live.slice(i, i + 20).map(async (p) => {
        // A missing portrait falls through to the SPA fallback as 200 text/html,
        // so the content type is the real signal, not the status.
        const r = await request.get(p.img);
        const type = r.headers()['content-type'] || '';
        if (!r.ok() || !type.startsWith('image/')) notImages.push(`${p.name}: ${r.status()} ${type}`);
      }));
    }
    expect(notImages).toEqual([]);
  });
});

// The older Famous Person Game is retired in favour of Red Carpet Convos. Its
// page visits are sent on, but its files stay: the ImageManager fetches the page
// for the portrait roster, and the portraits live under its folder.
test.describe('Retired Famous Person Game', () => {
  test('a visit to the old game lands on Red Carpet Convos', async ({ page }) => {
    await page.goto('/famous-person/');
    await expect(page).toHaveURL(/\/red-carpet-convos\/$/);
    await page.goto('/FamousPersonGame/');
    await expect(page).toHaveURL(/\/red-carpet-convos\/$/);
  });

  test('the games hub no longer links to it', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('a.card[href="./red-carpet-convos/"]')).toBeVisible();
    await expect(page.locator('a[href*="famous-person"]')).toHaveCount(0);
  });

  test('a fetch still reads the old roster page for the ImageManager', async ({ page }) => {
    await page.goto('/');
    const html = await page.evaluate(async () => (await fetch('/FamousPersonGame/index.html')).text());
    expect(html).toContain('const PEOPLE = [');
  });
});
