import { defineConfig, devices } from '@playwright/test';

/* The drill page, served from web/ by tests/serve.mjs. WebKit is the engine
   the Mac app actually runs, so it is a project here, not an afterthought.
   Set DRILLS_TEST_PORT to run beside another worktree; the server is never
   reused when it is set. */
const PORT = Number(process.env.DRILLS_TEST_PORT) || 8955;
const OWN_PORT = !!process.env.DRILLS_TEST_PORT;

export default defineConfig({
  testDir: './tests',
  testMatch: /.*\.spec\.js$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 3,
  reporter: process.env.CI ? 'line' : 'list',
  timeout: 30000,
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node tests/serve.mjs ${PORT}`,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: !OWN_PORT && !process.env.CI,
    timeout: 20000,
  },
});
