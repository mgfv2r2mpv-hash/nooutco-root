import { defineConfig, devices } from '@playwright/test';

// Mirrors apps/games/playwright.config.js. Serves the static tools app via the
// Cloudflare Pages dev server so the shared assets (/assets/notes-gate.js) and
// note pages load exactly as in production.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Each page pulls React/Babel from a CDN; too many parallel workers saturate the
  // CDN/dev-server and cause load timeouts. Cap concurrency for deterministic runs.
  workers: 2,
  reporter: 'html',
  // Pages load React/Babel from a CDN and compile JSX in-browser; give slow/parallel
  // CDN fetches headroom so the suite doesn't flake under load.
  timeout: 90000,
  use: {
    baseURL: 'http://localhost:8789',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npx wrangler pages dev . --port 8789',
    url: 'http://localhost:8789',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
