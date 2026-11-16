import { expect, test } from '@playwright/test';
import { createInitialState, createLogisticsHubState, createWorkerHousingState } from '../../src/simulation/state';
import { enclosedEnvironment } from '../unit/helpers/buildings';
import { openApp, waitForDebugHandles, reloadApp } from './app';
import { releaseSaveWriter, expectSavedState } from './save';

test('links a worker to bulk storage through the primary 3D Logistics Hub UI', async ({ page }) => {
  await openApp(page, 'render=3d');
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();

  const state = createInitialState(8_505);
  state.player.x = 81 * 16;
  state.player.y = 80 * 16;
  state.unlockedItemIds.push(
    'stone-floor', 'stone-wall', 'metal-floor', 'metal-wall', 'warehouse', 'logistics-hub',
  );
  const housing = createWorkerHousingState();
  housing.bin.fiber = 8;
  housing.bin.berry = 3;
  state.buildings = [
    ...enclosedEnvironment(80, 78, 8, 6, 'indoor'),
    ...enclosedEnvironment(80, 88, 4, 4, 'workYard'),
    { id: 'hub-e2e', definitionId: 'logistics-hub', tileX: 80, tileY: 78, logistics: createLogisticsHubState() },
    {
      id: 'bulk-e2e', definitionId: 'warehouse', tileX: 83, tileY: 78,
      storage: {
        wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0,
        'taming-snare': 0, berry: 0, arrow: 0, 'cloth-mask': 0,
      },
      storageStacks: {
        wood: [], stone: [], fiber: [], 'iron-ore': [], 'iron-ingot': [],
        'taming-snare': [], berry: [], arrow: [], 'cloth-mask': [],
      },
      storedTools: [],
    },
    { id: 'pen-e2e', definitionId: 'small-pen', tileX: 80, tileY: 88, housing },
  ];
  state.ownedCreatures = [{
    id: 'worker-e2e', speciesId: 'tuftle', name: 'Moss', role: 'work', assignment: 'fiber',
    worksiteId: 'pen-e2e', housingId: 'pen-e2e', nextWorkTick: 999_999, workRemainderMs: 0,
    bondXp: 0, selectedBattleAbilityId: 'tuftle-guard',
  }];
  state.nextEntityId = 600;

  await releaseSaveWriter(page);
  await page.evaluate(async (fixtureState) => {
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
        const current = request.result as { meta: Record<string, unknown> };
        store.put({ meta: { ...current.meta, savedAt: Date.now() }, state: fixtureState }, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  }, state);
  await reloadApp(page);
  await expect(page.locator('html')).toHaveAttribute('data-presentation', '3d');
  await waitForDebugHandles(page);
  await page.waitForTimeout(1_000);

  await page.evaluate(() => {
    const game = (globalThis as unknown as {
      __game: { scene: { getScene: (key: string) => {
        state: { buildings: Array<{ id: string }> };
        openFacilityInteraction: (building: { id: string }) => void;
      } } };
    }).__game;
    const scene = game.scene.getScene('world');
    scene.openFacilityInteraction(scene.state.buildings.find((building) => building.id === 'hub-e2e')!);
  });
  const facility = page.getByRole('dialog', { name: 'Facility actions' });
  await expect(facility.getByText('Logistics Hub', { exact: true })).toBeVisible();
  await facility.getByRole('button', { name: /Add Warehouse bulk-e2e/ }).click();
  await expect(facility.getByText(/Moss .* 1 destination/)).toBeVisible();

  await expectSavedState(page, (saved) => {
    const pen = saved.buildings.find((building) => building.id === 'pen-e2e');
    const warehouse = saved.buildings.find((building) => building.id === 'bulk-e2e');
    return pen?.housing?.bin.fiber === 0
      && pen.housing.bin.berry === 0
      && warehouse?.storage?.fiber === 8
      && warehouse.storage.berry === 3;
  });
});
