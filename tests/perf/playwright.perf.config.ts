import { defineConfig, devices } from '@playwright/test';

/**
 * Performance baselines for open-world-plan.md. Not part of the regular suite:
 * run with `npx playwright test -c tests/perf/playwright.perf.config.ts`.
 *
 * Uses the dev server (the measurement needs the DEV-only `__game` handles) on
 * its own port so it never collides with another project's server on 5173, and
 * launches Chromium on the hardware GPU — software GL is ~25× slower and would
 * measure swiftshader, not the game.
 */
const PORT = 5191;
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: '.',
  testMatch: /\.perf\.ts$/,
  outputDir: '../../tmp/perf/results',
  timeout: 300_000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}`, launchOptions: { args: GPU_ARGS } },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions: { args: GPU_ARGS } } },
    { name: 'phone-viewport', use: { ...devices['Pixel 7'], launchOptions: { args: GPU_ARGS } } },
  ],
  webServer: {
    command: `node ./node_modules/vite/bin/vite.js dev --port ${PORT} --strictPort`,
    // Run from the repo root, like the GPU e2e config.
    cwd: process.cwd(),
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
