import { defineConfig, devices } from '@playwright/test';

// Overridable so a run can avoid colliding with whatever already holds 8788.
// `reuseExistingServer` will happily adopt an unrelated server on the default
// port — a plain static server answers most asset requests, so the suite can
// look green while never exercising _worker.js (version injection, the legacy
// /IDMatchGame → /matching redirects that market's image borrow depends on).
// Set GAMES_TEST_PORT to force this run's own wrangler instance.
const PORT = Number(process.env.GAMES_TEST_PORT) || 8788;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: `npx wrangler pages dev . --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI && !process.env.GAMES_TEST_PORT,
  },
});
