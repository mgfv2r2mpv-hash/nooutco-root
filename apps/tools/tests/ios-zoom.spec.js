import { test, expect, devices } from '@playwright/test';

/* The page must not zoom when a technician taps a field.
 *
 * iOS Safari zooms a focused form control whose text is under 16px, and it does
 * not zoom back out when the field is blurred. The page is left scrolled
 * sideways, the section the technician was reading is off screen, and getting
 * back means pinching. Every intake box, every section box and the composer sat
 * under that line: 14, 14.5 and 13.
 *
 * His requirement is that this stays usable on an iPhone screen. A page that
 * demands a pinch after every tap is not.
 *
 * THE CONTROL IS IN THIS FILE. The last test asserts the desktop design keeps
 * its own sizes, so this is a phone rule and not a global font bump.
 */

function tokenFor() {
  const p = { role: 'user', kid: 'test-kid', exp: Math.floor(Date.now() / 1000) + 3600, tools: ['bt'] };
  return Buffer.from(JSON.stringify(p)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.not-a-real-signature';
}

async function load(page) {
  await page.goto('/notes/bt/');
  await page.evaluate(() => localStorage.clear());
  await page.evaluate((tok) => localStorage.setItem('notes_auth_token', tok), tokenFor());
  await page.goto('/notes/bt/');
  await expect(page.getByRole('textbox', { name: /Skill Acquisition/i })).toBeVisible({ timeout: 15000 });
}

// Every control a person can put a caret in, with the size the browser resolved.
const fieldSizes = (page) => page.evaluate(() => {
  const out = [];
  document.querySelectorAll('input, textarea, select').forEach((el) => {
    const t = (el.getAttribute('type') || 'text').toLowerCase();
    if (t === 'checkbox' || t === 'radio' || t === 'hidden' || t === 'button' || t === 'submit') return;
    if (!el.offsetParent && el.tagName !== 'BODY') return;
    out.push({
      what: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '')
        + (el.getAttribute('data-section-id') ? '[' + el.getAttribute('data-section-id') + ']' : ''),
      size: parseFloat(getComputedStyle(el).fontSize),
    });
  });
  return out;
});

test.describe('on the phone they actually use', () => {
  const { defaultBrowserType, ...IPHONE } = devices['iPhone 14'];
  test.use(IPHONE);

  test('no intake field is small enough to zoom the page', async ({ page }) => {
    await load(page);
    const fields = await fieldSizes(page);
    expect(fields.length).toBeGreaterThan(3);
    const small = fields.filter((f) => f.size < 16);
    expect(small, 'these fields zoom iOS Safari on focus: ' + JSON.stringify(small)).toEqual([]);
  });

  test('the box a revision gets typed into does not zoom either', async ({ page }) => {
    await load(page);
    const fab = page.locator('.revision-fab');
    if (await fab.isVisible({ timeout: 10000 }).catch(() => false)) await fab.click();
    await expect(page.locator('.revision-input')).toBeVisible({ timeout: 10000 });
    const size = await page.locator('.revision-input')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeGreaterThanOrEqual(16);
  });
});

test.describe('and the desktop design is left alone', () => {
  /* THE CONTROL. If this went green beside the phone tests by making every
     field 16px everywhere, the fix would be a redesign wearing a bug fix's
     clothes. The composer is deliberately smaller at a desk. */
  test('the composer keeps its own size at a desk', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await load(page);
    const fab = page.locator('.revision-fab');
    if (await fab.isVisible({ timeout: 10000 }).catch(() => false)) await fab.click();
    await expect(page.locator('.revision-input')).toBeVisible({ timeout: 10000 });
    const size = await page.locator('.revision-input')
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(size).toBeLessThan(16);
  });
});
