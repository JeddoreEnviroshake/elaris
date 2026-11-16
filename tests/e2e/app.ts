import { expect, type Page } from '@playwright/test';

/**
 * Every browser test loads the app through here. `localBalance` pins the
 * bundled defaults instead of the published Firebase global values, so a spec
 * asserting a balance number cannot be broken by an admin publishing a new
 * revision — and a developer with real Firebase credentials in `.env.local`
 * gets the same result as CI, which has none. `admin` shows the Admin menu,
 * while the production Menu also includes Admin by default.
 */
export const APP_URL = '/?localBalance=1&admin=1';

/** Open the app, optionally with extra query parameters (`render=3d`, …). */
export async function openApp(page: Page, query = ''): Promise<void> {
  await page.goto(query ? `${APP_URL}&${query}` : APP_URL);
}

/**
 * Wait for main.ts's dev-only debug handles *and* for the world scene to have
 * finished `create()`. Boot awaits the save load and the global-balance fetch,
 * so the handles appear well after the page `load` event, and Phaser runs
 * `create()` later still — calling a scene method before then finds half-built
 * fields like `hud` undefined. The Menu button is the scene's own ready signal.
 * Only the dev server exposes these handles; production builds strip them.
 */
export async function waitForDebugHandles(page: Page): Promise<void> {
  await page.waitForFunction(() => '__game' in globalThis && '__renderer3d' in globalThis);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
}
