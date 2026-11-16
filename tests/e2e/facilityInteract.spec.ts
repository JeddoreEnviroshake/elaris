import { releaseSaveWriter } from './save';
import { expect, test } from '@playwright/test';
import { openApp, reloadApp } from './app';
import { tapCanvasCenter } from './interact';

/**
 * Click-to-use facility interaction: clicking a placed workbench opens a focused
 * panel of its recipes, so it never competes with other nearby targets for a
 * shared proximity button.
 */
test('clicking an in-range workbench opens its recipe panel', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();

  // The initial snapshot is written on first load; give it a beat, then inject a
  // floored workbench on the player's own tile.
  await page.waitForTimeout(500);

  await releaseSaveWriter(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('snapshots', 'readwrite');
      const store = transaction.objectStore('snapshots');
      const request = store.get('current');
      request.onsuccess = () => {
        const save = request.result as {
          state: {
            player: { x: number; y: number };
            buildings: Array<Record<string, unknown>>;
            inventory: Record<string, number>;
            unlockedItemIds: string[];
          };
        };
        // Place the workbench on the player's own tile so a canvas-centre click
        // (where the followed player renders) lands on the workbench sprite.
        const tileX = Math.round(save.state.player.x / 16);
        const tileY = Math.round(save.state.player.y / 16);
        save.state.buildings.push(
          { id: 'wb-floor-a', definitionId: 'wood-floor', tileX, tileY },
          { id: 'wb-floor-b', definitionId: 'wood-floor', tileX: tileX + 1, tileY },
          { id: 'wb-test', definitionId: 'workbench', tileX, tileY },
        );
        save.state.inventory.wood = 100;
        save.state.inventory['iron-ingot'] = 20;
        save.state.unlockedItemIds = [...new Set([...save.state.unlockedItemIds, 'iron-axe'])];
        store.put(save, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  });
  await reloadApp(page);

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Craft', exact: true }).click();
  await expect(page.getByText(/Best enclosed area: .*Workbench target: Shelter \(8 tiles\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // Clicking the workbench itself opens its focused panel.
  await tapCanvasCenter(page);
  const panel = page.getByRole('dialog', { name: 'Facility actions' });
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect(Math.abs(panelBox!.x + panelBox!.width / 2 - viewport!.width / 2)).toBeLessThan(2);
  expect(Math.abs(panelBox!.y + panelBox!.height / 2 - viewport!.height / 2)).toBeLessThan(2);
  const ironAxe = panel.getByRole('button').filter({ hasText: 'Iron Axe' });
  await expect(ironAxe).toBeVisible();
  await expect(ironAxe).toBeEnabled();
  await ironAxe.click();
  // A quest finished by this craft now announces itself on its own banner, so
  // the shared status line keeps the craft confirmation.
  await expect(page.getByRole('status').filter({ hasText: 'Crafted and equipped Iron Axe' }))
    .toBeVisible();
});
