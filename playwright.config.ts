import { defineConfig, devices } from '@playwright/test';

/**
 * Browser (e2e) tests run against the production build served by `vite preview`
 * — the same artifact CI deploys — so install/offline behavior is exercised for
 * real. Covers one desktop and one mobile-emulated context per the spec.
 */
const PORT = 4173;
/**
 * Specs that drive the simulation through `__game`/`__renderer3d`, which
 * main.ts deliberately strips from production builds — so they cannot run
 * against the preview dist and get their own dev-server project instead. The
 * storm spec is here for the clock: reaching cycle 4 any other way is a
 * forty-minute wait.
 */
const DEV_PORT = 5173;
const DEV_HANDLES = /(?:three-mode|first-person-polish|first-person-hands|character-models|character-animations|combat-effects|ui-overhaul|town-entrance|world-style|feature5|interior-polish|arcane-storm|creatureWander|workerCreatureAmble|enemyLevels|movement-performance|three-only-saves)\.spec\.ts/;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Each browser runs a live Phaser simulation. Serial CI execution prevents
  // runner CPU contention from starving fixed-step input/cooldown timing.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] }, testIgnore: DEV_HANDLES },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] }, testIgnore: DEV_HANDLES },
    {
      name: 'dev-chrome',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${DEV_PORT}` },
      testMatch: DEV_HANDLES,
    },
  ],
  // Invoke Vite through Node so these also work on Windows machines where
  // PowerShell script execution policy blocks npm.ps1 child processes.
  webServer: [
    {
      // dist must already be built (CI builds before this step; locally run
      // `npm run build` first). Preview enables the service worker + offline path.
      command: `node ./node_modules/vite/bin/vite.js preview --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `node ./node_modules/vite/bin/vite.js dev --port ${DEV_PORT} --strictPort`,
      url: `http://127.0.0.1:${DEV_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
