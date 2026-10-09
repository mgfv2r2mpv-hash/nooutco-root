import { defineConfig, devices } from '@playwright/test';

// Overridable so a run can avoid colliding with whatever already holds 8788.
// `reuseExistingServer` will happily adopt an unrelated server on the default
// port - a plain static server answers most asset requests, so the suite can
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
  /* CI: a line per test as well as the HTML report. With 'html' alone, the
     firefox job cancelled at the 35-minute cap on #312 (2026-10-09) left a log
     with no test names in it. reportSlowTests names the slowest files. */
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'html',
  reportSlowTests: { max: 10, threshold: 60000 },
  /* CI: the run ends itself under the job cap. games-test.yml sets
     PW_GLOBAL_TIMEOUT_MINUTES from what is left of the job's clock, so a long
     run names the tests it interrupted and still uploads its report, instead
     of being cancelled by the runner with nothing written. 0 means no limit. */
  globalTimeout: process.env.CI
    ? (Number(process.env.PW_GLOBAL_TIMEOUT_MINUTES) || 0) * 60000
    : 0,
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
    // wrangler downloads and boots workerd on a cold CI runner; the 60s default
    // is tight enough that a slow boot looks like a test failure.
    timeout: 180_000,
    // Surface workerd's own output. When the server died mid-run the only
    // evidence was a bare "Connection refused" on every subsequent test - // piping its stderr is what turned that into a diagnosable crash.
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
