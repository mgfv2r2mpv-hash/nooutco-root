import { test, expect } from '@playwright/test';
import { createHmac } from 'node:crypto';

/* The admin area, reachable from anywhere in tools.
 *
 * WHAT WAS WRONG. The gear is on every page, but what it does was decided per
 * page: the tools landing page opens a modal that carries the 🛠️ link, and the
 * note pages wire the same gear to clinician login and logout instead. So the
 * only door into /admin/ was the landing page, and getting there from a note
 * meant leaving the note.
 *
 * WHAT REPLACED IT. The bar renders the admin-area link itself, beside the
 * gear, on every page that has a gear at all. It is a link rather than an
 * event because unlike "who am I", "where is the admin area" has one answer
 * everywhere, and a page has nothing to add to it.
 *
 * WHO SEES IT. Only a login whose token says role "admin". This is a display
 * rule and not a security one - every /api/admin/ route re-checks the role
 * server-side - so the tests below assert what is SHOWN, and the worker's own
 * tests own what is allowed.
 */

const SECRET = 'playwright-local-test-secret';
const TOKEN_KEY = 'notes_auth_token';
const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function token(role) {
  const payload = { role, kid: `pw:${role}`, exp: Math.floor(Date.now() / 1000) + 3600 };
  const payloadStr = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = b64url(createHmac('sha256', SECRET).update(payloadStr).digest());
  return `${payloadStr}.${sig}`;
}

const signIn = (page, role) =>
  page.addInitScript(([key, tok]) => localStorage.setItem(key, tok), [TOKEN_KEY, token(role)]);

// Every tools page that carries a gear. The landing page reads the token
// directly; the other three go through NotesGate. Both paths have to report
// admin-ness, so both are covered rather than one standing in for the other.
const GEARED = [
  { name: 'tools landing', path: '/' },
  { name: 'graphVA', path: '/graphVA/index.html' },
  { name: 'BT note', path: '/notes/bt/index.html' },
  { name: 'BCBA note', path: '/notes/bcba/index.html' },
];

// Pages that opt out of admin entirely with `no-admin`. The admin page is in
// the list on purpose: a link back to where you already are is noise.
const NO_ADMIN = [
  { name: 'session flow', path: '/session-flow/index.html' },
  { name: 'suggest a feature', path: '/SuggestFeature/index.html' },
  { name: 'admin', path: '/admin/index.html' },
];

const adminLink = (page) => page.locator('noaba-bar a.noaba-admin');

for (const { name, path } of GEARED) {
  test(`${name}: an admin gets the admin-area link in the bar`, async ({ page }) => {
    await signIn(page, 'admin');
    await page.goto(path);
    const link = adminLink(page);
    await expect(link).toBeVisible();
    // Resolved rather than raw, so a page that shipped a relative href and
    // worked only at the site root fails here.
    expect(new URL(await link.evaluate((a) => a.href)).pathname).toBe('/admin/');
    await expect(link).toHaveAttribute('aria-label', 'Admin area');
  });

  test(`${name}: a non-admin login does not get it`, async ({ page }) => {
    // role "user" is a managed access password: signed in, allowed to draft,
    // and never an admin. The gear still fills; this control stays hidden.
    await signIn(page, 'user');
    await page.goto(path);
    // PRESENT but hidden, asserted in that order on purpose. toBeHidden alone
    // is satisfied by a node that was never rendered, so on its own it would
    // pass against a build with no such control at all, and it would go on
    // passing if somebody removed the control tomorrow. The mid-session reveal
    // below is the reason presence is the contract rather than an artefact.
    await expect(adminLink(page)).toHaveCount(1);
    await expect(adminLink(page)).toBeHidden();
    await expect(page.locator('noaba-bar .noaba-gear')).toBeVisible();
  });

  test(`${name}: logged out does not get it`, async ({ page }) => {
    await page.goto(path);
    await expect(adminLink(page)).toHaveCount(1);
    await expect(adminLink(page)).toBeHidden();
  });
}

for (const { name, path } of NO_ADMIN) {
  test(`${name}: no-admin suppresses the admin link as well as the gear`, async ({ page }) => {
    // `no-admin` predates this control. A page that opted out of the gear did
    // not opt into a new one.
    await signIn(page, 'admin');
    await page.goto(path);
    await expect(page.locator('noaba-bar .noaba-gear')).toHaveCount(0);
    await expect(adminLink(page)).toHaveCount(0);
  });
}

test('the link actually lands on the admin page, from a note', async ({ page }) => {
  // The whole complaint in one assertion: he is in a note, and he wants to be
  // in the admin area without going back to the landing page first.
  await signIn(page, 'admin');
  await page.goto('/notes/bcba/index.html');
  await adminLink(page).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(page.locator('noaba-bar')).toBeVisible();
});

test('signing in as admin reveals the link without a reload', async ({ page }) => {
  // The bar listens for `noaba:auth-state` rather than reading the token, so a
  // page that signs somebody in mid-session has to be able to say so. Hiding
  // rather than removing the node is what makes that cheap.
  await page.goto('/');
  await expect(adminLink(page)).toHaveCount(1);
  await expect(adminLink(page)).toBeHidden();
  await page.evaluate(() => {
    document.dispatchEvent(
      new CustomEvent('noaba:auth-state', { detail: { authed: true, admin: true } }),
    );
  });
  await expect(adminLink(page)).toBeVisible();
});

test('a page that reports only `authed` keeps working and shows no link', async ({ page }) => {
  // apex and games still emit the one-key detail. The bar must not read a
  // missing `admin` as anything but false, and must not throw on it.
  await page.goto('/');
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('noaba:auth-state', { detail: { authed: true } }));
  });
  await expect(page.locator('noaba-bar .noaba-gear')).toHaveAttribute('data-authed', 'true');
  await expect(adminLink(page)).toHaveCount(1);
  await expect(adminLink(page)).toBeHidden();
});
