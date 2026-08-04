import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The note tools compile JSX in the browser, so React, ReactDOM and Babel are
// the page rather than an enhancement of it. While they came from unpkg, a slow
// or failed request gave a technician a nav bar over an empty white rectangle,
// with no error and nothing to retry. A full parallel test run reproduced it.
//
// These tests hold the fix down from both ends: nothing under notes/ may name a
// public CDN, and each page must still mount with every third-party host
// unreachable.

const ROOT = join(__dirname, '..');

const PAGES = [
  { tool: 'bt', path: '/notes/bt/index.html', file: 'notes/bt/index.html' },
  { tool: 'sup', path: '/notes/bcba/index.html?tool=sup', file: 'notes/bcba/index.html' },
  { tool: 'sap', path: '/notes/bcba/index.html?tool=sap', file: 'notes/bcba/index.html' },
];

// Everything the pages are allowed to want from somewhere else. Turnstile has to
// be remote, it is the bot check. The font is remote but the page stays usable
// without it, falling back through the stack.
const ALLOWED_THIRD_PARTY = /challenges\.cloudflare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/;

test.describe('the notes pages do not depend on a CDN to render', () => {
  test('no page under notes/ loads a script from a public CDN', () => {
    for (const file of ['notes/bt/index.html', 'notes/bcba/index.html']) {
      const html = readFileSync(join(ROOT, file), 'utf8');
      const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
      const remote = scripts.filter((s) => /^https?:/.test(s) && !ALLOWED_THIRD_PARTY.test(s));
      expect(remote, `${file} still loads scripts from off-site`).toEqual([]);
    }
  });

  for (const { tool, path } of PAGES) {
    test(`${tool} mounts with every third-party host unreachable`, async ({ page }) => {
      const blocked = [];
      // Fail the request outright rather than stalling it - a technician on a
      // dead DNS or a blocked domain gets an error, not a slow success.
      await page.route('**/*', async (route) => {
        const url = route.request().url();
        if (/^https?:\/\/(?!localhost|127\.0\.0\.1)/.test(url)) {
          blocked.push(url);
          return route.abort('failed');
        }
        return route.continue();
      });

      await page.goto(path);
      await page.waitForFunction(
        () => !!(window.React && window.ReactDOM && window.Babel),
        null,
        { timeout: 30000 },
      );
      await page.waitForSelector('#root h1', { timeout: 30000 });

      // The page is genuinely usable, not merely present.
      await expect(page.locator('textarea').first()).toBeVisible();
      await expect(page.locator('.revision-fab')).toBeVisible();

      // And the block really was in force, so this is not passing by accident.
      expect(blocked.length, 'no third-party request was blocked, so the block did nothing')
        .toBeGreaterThan(0);
    });
  }

  // Turnstile has to stay remote, so the question is not whether it can fail but
  // what a technician sees when it does. It used to be nothing: the widget poll
  // ran out after five seconds and left Log in disabled forever, with no reason
  // given and no way to tell that from "I typed my password wrong".
  test('a Turnstile that never loads says so instead of leaving a dead button', async ({ page }) => {
    await page.route('**/challenges.cloudflare.com/**', (route) => route.abort('failed'));
    await page.goto('/notes/bt/');
    await page.waitForSelector('#root h1', { timeout: 45000 });

    await page.evaluate(() => window.NotesGate.openLogin());
    await expect(page.locator('#notes-login-pw')).toBeVisible();

    // The poll is 25 tries at 200ms, so the message cannot arrive before 5s.
    await expect(page.locator('#notes-login-err'))
      .toContainText(/verification check could not load/i, { timeout: 20000 });
    await expect(page.locator('#notes-login-err')).toBeVisible();
  });

  test('the vendored files are the ones the pages ask for', () => {
    const html = readFileSync(join(ROOT, 'notes/bt/index.html'), 'utf8');
    for (const name of [
      'react-18.3.1.production.min.js',
      'react-dom-18.3.1.production.min.js',
      'babel-standalone-7.29.8.min.js',
    ]) {
      expect(html, `notes/bt/index.html does not load ${name}`).toContain(name);
      // Present and non-trivial. A truncated download is the quiet failure here.
      const bytes = readFileSync(join(ROOT, 'vendor', name)).length;
      expect(bytes, `vendor/${name} looks truncated`).toBeGreaterThan(9000);
    }
  });
});
