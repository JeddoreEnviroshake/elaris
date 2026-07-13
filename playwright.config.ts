import { defineConfig, devices } from '@playwright/test';

/**
 * Browser (e2e) tests run against the production build served by `vite preview`
 * — the same artifact CI deploys — so install/offline behavior is exercised for
 * real. Covers one desktop and one mobile-emulated context per the spec.
 */
const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Each browser runs a live Phaser simulation. Serial CI execution prevents
  // runner CPU contention from starving fixed-step input/cooldown timing.
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    // dist must already be built (CI builds before this step; locally run
    // `npm run build` first). Preview enables the service worker + offline path.
    // Invoke Vite through Node so this also works on Windows machines where
    // PowerShell script execution policy blocks npm.ps1 child processes.
    command: `node ./node_modules/vite/bin/vite.js preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
