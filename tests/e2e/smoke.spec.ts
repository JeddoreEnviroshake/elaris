import { expect, test } from '@playwright/test';
import { openApp, reloadApp } from './app';
import { openAppInStarterGrove, gatherStarterTree } from './gather';
import { openAdmin, openMenuTab, grantBlueprints } from './menu';

/**
 * End-to-end smoke test against the production build: the app boots, Three.js
 * renders a canvas, and the service worker precache completes (Ready offline).
 * Movement/simulation correctness is covered by deterministic unit tests.
 */
test('boots, renders the world canvas, and becomes offline-ready', async ({ page }) => {
  await openApp(page);
  await expect(page).toHaveTitle('Elaris');

  const canvas = page.locator('#elaris-three-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(0);
  expect(box?.height ?? 0).toBeGreaterThan(0);

  // Service worker finished precaching → cold-launch offline is possible.
  // Offline readiness now lives in the Admin menu (the panel polls for it).
  await openAdmin(page);
  await expect(page.getByText('Ready offline')).toBeVisible({ timeout: 20_000 });
});

test('opens the diagnostics panel with a build identifier', async ({ page }) => {
  await openApp(page);
  // Diagnostics now opens from the Admin menu.
  await openAdmin(page);
  await page.getByRole('button', { name: 'App status and diagnostics' }).click();
  const heading = page.getByRole('heading', { name: /Diagnostics/ });
  await expect(heading).toBeVisible();
  // Scope to the panel: "Build" also names the HUD's build-mode button.
  await expect(heading.locator('..').getByText('Build', { exact: true })).toBeVisible();
});

test('lays out the normal HUD in ordered corner stacks', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Gather' })).toBeVisible();

  const layout = await page.evaluate(() => {
    const box = (selector: string): DOMRect => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
    const hint = document.querySelector<HTMLElement>('[data-target-hint]')!;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      map: box('[aria-label="Toggle world map"]'),
      quests: box('[aria-label="Active quests"]'),
      stack: box('[data-hud-status-stack]'),
      timer: box('[data-survival-timer]'),
      hp: box('[data-player-health]'),
      stamina: box('[data-player-stamina]'),
      mana: box('[data-player-mana]'),
      xp: box('[data-player-xp]'),
      gold: box('[data-coin-score]'),
      hotbar: box('[aria-label="Hotbar"]'),
      resourceHint: { display: getComputedStyle(hint).display, text: hint.textContent },
    };
  });

  // Left column, top to bottom: Gold, mini map, Quests — all the same width.
  expect(layout.gold.left).toBeLessThan(20);
  expect(layout.gold.top).toBeLessThan(20);
  expect(layout.map.top).toBeGreaterThanOrEqual(layout.gold.bottom);
  expect(layout.quests.top).toBeGreaterThanOrEqual(layout.map.bottom);
  expect(layout.gold.width).toBe(layout.map.width);
  expect(layout.gold.width).toBe(layout.quests.width);
  expect(layout.viewport.width - layout.stack.right).toBeLessThan(20);
  expect(layout.stack.top).toBeLessThan(20);
  expect(layout.timer.top).toBeLessThan(layout.xp.top);
  expect(layout.xp.bottom).toBeLessThanOrEqual(layout.hp.top);
  expect(layout.hp.top).toBeLessThanOrEqual(layout.stamina.top);
  expect(layout.stamina.top).toBeLessThanOrEqual(layout.mana.top);
  expect(layout.viewport.height - layout.hotbar.bottom).toBeLessThan(28);
  expect(layout.resourceHint).toEqual({ display: 'none', text: '' });
});

test('gathers wood, crafts a pick, and restores it after reload', async ({ page }) => {
  test.setTimeout(120_000);
  await openAppInStarterGrove(page);
  // Two starter trees provide enough wood for the globally tuned pick recipe.
  await gatherStarterTree(page);
  await gatherStarterTree(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: 'Wood stack, 8', exact: true })).toBeVisible();
  await grantBlueprints(page, 'wooden-pick');
  await openMenuTab(page, 'Craft');
  await page.getByRole('button', { name: 'Craft & equip' }).click();
  await page.getByRole('tab', { name: 'Bag', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Wood stack, 3' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Wooden Pick \d+\/\d+, equipped/ })).toBeVisible();

  // The critical save is fired asynchronously; give the IndexedDB write a beat
  // to commit so an instant reload cannot abort it (slower mobile emulation
  // loses this race). Durable flush-before-navigation belongs to the save layer.
  await page.waitForTimeout(700);
  await reloadApp(page);
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('button', { name: 'Wood stack, 3' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Wooden Pick \d+\/\d+, equipped/ })).toBeVisible();
});
