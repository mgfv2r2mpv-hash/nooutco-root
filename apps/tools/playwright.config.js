import { defineConfig, devices } from '@playwright/test';

// Mirrors apps/games/playwright.config.js. Serves the static tools app via the
// Cloudflare Pages dev server so the shared assets (/assets/notes-gate.js) and
// note pages load exactly as in production.

/* PORT: set TOOLS_TEST_PORT to run beside another worktree.
 *
 * This machine keeps several worktrees of this repo, and 8789 was hardcoded
 * with reuseExistingServer on. When another worktree already had a dev server
 * up, this suite silently ADOPTED it and spent ten minutes testing that
 * worktree's files: 281 failures on 2026-08-04 that had nothing to do with the
 * tree under test, and every one of them looked like a real regression.
 *
 * Check before you trust a number:
 *   lsof -nP -iTCP:8789 -sTCP:LISTEN -t | xargs -I{} lsof -a -p {} -d cwd
 *
 * With TOOLS_TEST_PORT set, the server is never reused, so the run is
 * guaranteed to be against this working tree.
 */
const PORT = Number(process.env.TOOLS_TEST_PORT) || 8789;
const OWN_PORT = !!process.env.TOOLS_TEST_PORT;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // React and Babel are vendored now, so the old CDN saturation reason is gone,
  // but every page still compiles JSX in the browser and that is CPU the dev
  // server and the browsers share. The cap stays for deterministic runs.
  workers: 2,
  reporter: 'html',
  // In-browser JSX compilation on every page load; give it headroom so a busy
  // machine does not read as a failure.
  timeout: 90000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    // ADMIN_SECRET is bound to a throwaway value so tests can mint a real signed
    // session token and exercise authenticated /api/* routes against the actual
    // worker, instead of only ever mocking them. It is not a credential - it
    // unlocks nothing beyond this local dev server, which has no API key and no
    // KV data. Tests that assert unauthenticated behaviour still get 401,
    // because a missing or forged token fails the HMAC check regardless.
    command: `npx wrangler pages dev . --port ${PORT} --binding ADMIN_SECRET=playwright-local-test-secret`,
    url: `http://localhost:${PORT}`,
    // Never adopt a stranger's server on an explicitly chosen port. That is the
    // whole reason the option exists.
    reuseExistingServer: !process.env.CI && !OWN_PORT,
    timeout: 120000,
  },
});
