import { expect, test } from '@playwright/test';

/**
 * End-to-end smoke test against the production build: the app boots, Phaser
 * renders a canvas, and the service worker precache completes (Ready offline).
 * Movement/simulation correctness is covered by deterministic unit tests.
 */
test('boots, renders the world canvas, and becomes offline-ready', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Elaris');

  const canvas = page.locator('#game canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);

  // Service worker finished precaching → cold-launch offline is possible.
  await expect(page.getByText('Ready offline')).toBeVisible({ timeout: 20_000 });
});

test('opens the diagnostics panel with a build identifier', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'App status and diagnostics' }).click();
  await expect(page.getByRole('heading', { name: /Diagnostics/ })).toBeVisible();
  await expect(page.getByText('Build', { exact: true })).toBeVisible();
});
