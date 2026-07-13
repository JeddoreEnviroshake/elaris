import { expect, test } from '@playwright/test';
import { gatherStarterTree } from './gather';

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
  const heading = page.getByRole('heading', { name: /Diagnostics/ });
  await expect(heading).toBeVisible();
  // Scope to the panel: "Build" also names the HUD's build-mode button.
  await expect(heading.locator('..').getByText('Build', { exact: true })).toBeVisible();
});

test('gathers wood, crafts a pick, and restores it after reload', async ({ page }) => {
  await page.goto('/');
  // Two six-hit starter trees provide eight wood.
  await gatherStarterTree(page);
  await gatherStarterTree(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByText('wood', { exact: true })).toBeVisible();
  await expect(page.getByText('×8')).toBeVisible();
  await page.getByRole('tab', { name: 'Craft', exact: true }).click();
  await page.getByRole('button', { name: 'Craft & equip' }).click();
  await page.getByRole('tab', { name: 'Bag', exact: true }).click();
  await expect(page.getByText('×3', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wooden Pick 48/48, equipped' })).toBeVisible();
  await expect(page.getByText('Saved')).toBeVisible();

  // The critical save is fired asynchronously; give the IndexedDB write a beat
  // to commit so an instant reload cannot abort it (slower mobile emulation
  // loses this race). Durable flush-before-navigation belongs to the save layer.
  await page.waitForTimeout(700);
  await page.reload();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByText('×3', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Wooden Pick 48/48, equipped' })).toBeVisible();
});
