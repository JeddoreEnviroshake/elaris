import { expect, test, type Page } from '@playwright/test';
import { openApp } from './app';
import { tapWorld } from './interact';
import { gatherNearestResource } from './gather';

// Fixture geometry: the player stands at world (512, 512); the furnace and
// workbench are the two 2×1 facilities anchored at tile 31 (see seedIronChain).
const PLAYER = { x: 512, y: 512 };
const FURNACE_CENTER = { x: (31 + 1) * 16, y: (31 + 0.5) * 16 };
const WORKBENCH_CENTER = { x: (31 + 1) * 16, y: (32 + 0.5) * 16 };

async function seedIronChain(page: Page): Promise<void> {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('elaris:default', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('snapshots', 'readwrite');
      const store = transaction.objectStore('snapshots');
      const request = store.get('current');
      request.onsuccess = () => {
        const save = request.result as { state: Record<string, any> };
        const state = save.state;
        const center = 512;
        state.player.x = center;
        state.player.y = center;
        state.player.stamina = state.player.maxStamina;
        state.actionCooldownUntilTick = 0;
        state.resourceNodes = [
          { id: 'metal-e2e-1', kind: 'metal', x: center + 24, y: center, hp: 15, maxHp: 60, respawnAtTick: null },
          { id: 'metal-e2e-2', kind: 'metal', x: center + 36, y: center + 8, hp: 60, maxHp: 60, respawnAtTick: null },
        ];
        // Ample wood + ingots to cover the workbench Iron Pick recipe's scaled
        // cost. Spread rather than replace: save validation requires every
        // crafted-supply key (taming-snare, berry, arrow, cloth-mask) to be
        // present, and dropping them makes the whole save fail to load — which
        // silently falls back to a fresh world with no ore in it.
        state.inventory = { ...state.inventory, wood: 80, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 12 };
        state.inventoryStacks = { ...state.inventoryStacks, wood: [80], stone: [], fiber: [], 'iron-ore': [], 'iron-ingot': [12] };
        state.resourcesCollected['iron-ingot'] = 3;
        state.unlockedItemIds = [...new Set([...state.unlockedItemIds, 'furnace', 'stone-pick', 'iron-pick'])];
        state.tools = [{
          instanceId: 'tool-e2e-stone-pick', definitionId: 'stone-pick',
          durability: 96, maxDurability: 96, powerRank: 0, speedRank: 0, durabilityRank: 0,
        }];
        state.equippedToolId = 'tool-e2e-stone-pick';
        const buildings: Array<Record<string, unknown>> = [];
        let id = 1;
        const baseTile = 31;
        for (let y = baseTile; y < baseTile + 3; y += 1) for (let x = baseTile; x < baseTile + 3; x += 1) {
          buildings.push({ id: `surface-e2e-${id++}`, definitionId: 'wood-floor', tileX: x, tileY: y });
        }
        for (let x = baseTile; x < baseTile + 3; x += 1) {
          buildings.push({ id: `wall-e2e-${id++}`, definitionId: 'wood-wall', tileX: x, tileY: baseTile, boundaryEdge: 'north' });
          buildings.push({ id: `wall-e2e-${id++}`, definitionId: 'wood-wall', tileX: x, tileY: baseTile + 2, boundaryEdge: 'south' });
        }
        for (let y = baseTile; y < baseTile + 3; y += 1) {
          buildings.push({ id: `wall-e2e-${id++}`, definitionId: 'wood-wall', tileX: baseTile, tileY: y, boundaryEdge: 'west' });
          buildings.push({ id: `wall-e2e-${id++}`, definitionId: 'wood-wall', tileX: baseTile + 2, tileY: y, boundaryEdge: 'east' });
        }
        buildings.push(
          { id: 'marker-e2e', definitionId: 'environment-marker', tileX: baseTile + 2, tileY: baseTile + 2, environmentKind: 'indoor' },
          { id: 'workbench-e2e', definitionId: 'workbench', tileX: baseTile, tileY: baseTile + 1 },
          { id: 'furnace-e2e', definitionId: 'furnace', tileX: baseTile, tileY: baseTile, furnace: { queue: [] } },
        );
        state.buildings = buildings;
        state.nextEntityId = 500;
        store.put(save, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Gather' })).toBeVisible();
}

test('mine ore, smelt an ingot, craft an Iron tool, and verify its faster break time', async ({ page }) => {
  await seedIronChain(page);
  expect(await gatherNearestResource(page, 'metal')).toEqual([0]);

  // Clicking the furnace opens its focused panel.
  await tapWorld(page, FURNACE_CENTER, PLAYER);
  const facilityPanel = page.getByRole('dialog', { name: 'Facility actions' });
  await expect(facilityPanel).toBeVisible();
  const furnaceBox = await facilityPanel.boundingBox();
  const furnaceViewport = page.viewportSize();
  expect(Math.abs(furnaceBox!.x + furnaceBox!.width / 2 - furnaceViewport!.width / 2)).toBeLessThan(2);
  expect(Math.abs(furnaceBox!.y + furnaceBox!.height / 2 - furnaceViewport!.height / 2)).toBeLessThan(2);
  await facilityPanel.getByRole('button', { name: 'Smelt iron ingot' }).click();
  await expect(facilityPanel.getByText('1 iron ingot ready')).toBeVisible({ timeout: 8_000 });
  await facilityPanel.getByRole('button', { name: 'Collect iron ingots' }).click();
  await facilityPanel.getByRole('button', { name: 'Close' }).click();

  // Iron tools are workbench recipes, not handcraft. The adjacent workbench is
  // also in range, so clicking it directly (rather than a shared proximity
  // button) targets it unambiguously.
  await tapWorld(page, WORKBENCH_CENTER, PLAYER);
  const workbenchPanel = page.getByRole('dialog', { name: 'Facility actions' });
  await expect(workbenchPanel).toBeVisible();
  const ironPick = workbenchPanel.getByRole('button').filter({ hasText: 'Iron Pick' });
  await expect(ironPick).toBeEnabled();
  await ironPick.click();
  // Crafting auto-equips; assert via the hotbar since a quest-reward toast can
  // immediately replace the craft confirmation in the live region.
  await expect(page.getByRole('button', { name: /Hotbar slot \d+: Iron Pick/ })).toBeVisible();
  await workbenchPanel.getByRole('button', { name: 'Close' }).click();

  // The full vein falls in three Iron-pick hits (24 power), with gathering
  // progress verified from scene state because hit/cooldown text is hidden.
  expect(await gatherNearestResource(page, 'metal')).toEqual([36, 12, 0]);
});
