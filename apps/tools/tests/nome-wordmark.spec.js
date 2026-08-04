import { test, expect } from '@playwright/test';

// The assistant is branded NoMe, and the brand is a wordmark rather than a word
// set in the page font. A wrong path is the classic way this breaks: the layout
// still looks plausible with a broken image, and a screenshot check would not
// necessarily catch the alt text standing in for the mark. So these assert the
// bytes actually decoded.

function tokenFor() {
  const payload = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt', 'sup'] };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64}.not-a-real-signature`;
}

async function signedIn(page, path = '/notes/bt/') {
  await page.goto(path);
  await page.evaluate((t) => localStorage.setItem('notes_auth_token', t), tokenFor());
  await page.reload();
  await page.waitForSelector('#root h1', { timeout: 45000 });
}

/* An <img> has no width and is not `complete` until its bytes arrive, so
   checking either the moment it appears in the DOM is a race: it read 0 on
   firefox and false on chromium, on different runs, from the same mistake.
   Every check here goes through this, and a genuinely missing file still fails,
   it just fails on the timeout with the same message. */
async function decodedMark(page, selector) {
  await page.locator(selector).waitFor({ state: 'visible' });
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && el.complete && el.naturalWidth > 0 && el.getBoundingClientRect().width > 0;
    },
    selector,
    { timeout: 15000 },
  );
  return page.locator(selector).boundingBox();
}

test('the collapsed pill reads Ask and then the mark, and the mark decoded', async ({ page }) => {
  await signedIn(page);

  const fab = page.locator('.revision-fab');
  await expect(fab).toContainText('Ask');
  await expect(fab.locator('img.nome-mark')).toHaveAttribute('alt', 'NoMe');

  const box = await decodedMark(page, '.revision-fab img.nome-mark');
  expect(box.width).toBeGreaterThan(0);
});

test('the open panel header carries the mark, where it is what gets read aloud', async ({ page }) => {
  await signedIn(page);
  await page.locator('.revision-fab').click();

  const head = page.locator('.revision-panel-head');
  await expect(head).toContainText('Ask');
  await expect(head.locator('img.nome-mark')).toHaveAttribute('alt', 'NoMe');

  const box = await decodedMark(page, '.revision-panel-head img.nome-mark');
  expect(box.width).toBeGreaterThan(0);
});

test('the mark scales with its label rather than sitting at a fixed size', async ({ page }) => {
  await signedIn(page);
  const pill = await decodedMark(page, '.revision-fab img.nome-mark');
  await page.locator('.revision-fab').click();
  const header = await decodedMark(page, '.revision-panel-head img.nome-mark');

  // The pill sets 14px, the header bar 13px. Different sizes prove the em
  // sizing is live; a fixed pixel height would make these identical.
  expect(pill.height).toBeGreaterThan(header.height);
  // And it keeps its proportions in both.
  expect(pill.width / pill.height).toBeCloseTo(header.width / header.height, 1);
});

// It is the same assistant whether or not anyone has signed in, so it carries
// the same name. The label is also how someone locked out of the tool finds the
// thing that lets them say so.
test('signed out the pill still reads Ask NoMe', async ({ page }) => {
  await page.goto('/notes/bt/');
  await page.evaluate(() => localStorage.removeItem('notes_auth_token'));
  await page.reload();
  await page.waitForSelector('#root h1', { timeout: 45000 });

  const fab = page.locator('.revision-fab');
  await expect(fab).toContainText('Ask');
  await expect(fab.locator('img.nome-mark')).toHaveCount(1);
  await decodedMark(page, '.revision-fab img.nome-mark');
  // The accessible name still says what is actually available here.
  await expect(fab).toHaveAttribute('aria-label', /Sign in|report a problem/i);
});

test('the BCBA page gets the same mark from the same file', async ({ page }) => {
  await signedIn(page, '/notes/bcba/');
  await expect(page.locator('.revision-fab img.nome-mark')).toHaveCount(1);
  await decodedMark(page, '.revision-fab img.nome-mark');
});
