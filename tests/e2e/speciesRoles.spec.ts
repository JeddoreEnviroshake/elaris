import { expect, test } from '@playwright/test';
import { createCartDockState, createInitialState, createWorkerHousingState, createWorkerProducerState } from '../../src/simulation/state';
import { enclosedEnvironment } from '../unit/helpers/buildings';
import { openApp } from './app';
import { tapWorld } from './interact';
import { releaseSaveWriter, expectSavedState } from './save';

test('runs Craghopper and Glade Stag facilities through the primary 3D UI', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.waitForTimeout(500);

  const state = createInitialState(8_404);
  state.player.x = 84 * 16;
  state.player.y = 80 * 16;
  state.unlockedItemIds.push('barn', 'stone-yard', 'cart-dock', 'field-cache');
  const dockState = createCartDockState();
  dockState.linkedStorageId = 'box-e2e';
  state.buildings = [
    ...enclosedEnvironment(80, 78, 8, 6, 'workYard'),
    { id: 'barn-e2e', definitionId: 'barn', tileX: 80, tileY: 78, housing: createWorkerHousingState() },
    { id: 'yard-e2e', definitionId: 'stone-yard', tileX: 83, tileY: 78, producer: createWorkerProducerState() },
    { id: 'dock-e2e', definitionId: 'cart-dock', tileX: 85, tileY: 78, cartDock: dockState },
    {
      id: 'box-e2e', definitionId: 'field-cache', tileX: 80, tileY: 81,
      storage: {
        wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0,
        'taming-snare': 0, berry: 0, arrow: 0, 'cloth-mask': 0,
      },
      storageStacks: {
        wood: [], stone: [], fiber: [], 'iron-ore': [], 'iron-ingot': [],
        'taming-snare': [], berry: [], arrow: [], 'cloth-mask': [],
      }, storedTools: [],
    },
  ];
  state.inventory.wood = 5;
  state.inventoryStacks.wood = [5];
  state.ownedCreatures = [
    {
      id: 'crag-e2e', speciesId: 'craghopper', name: 'Slate', role: 'work', assignment: 'stone',
      worksiteId: 'yard-e2e', nextWorkTick: 60, housingId: 'barn-e2e', workRemainderMs: 59_000,
      bondXp: 0, selectedBattleAbilityId: 'craghopper-guard',
    },
    {
      id: 'stag-e2e', speciesId: 'glade-stag', name: 'Fern', role: 'work', assignment: null,
      worksiteId: 'dock-e2e', nextWorkTick: 0, housingId: 'barn-e2e', workRemainderMs: 0,
      bondXp: 0, selectedBattleAbilityId: 'glade-stag-forward',
    },
    {
      id: 'fox-e2e', speciesId: 'snarlfox', name: 'Ember', role: 'work', assignment: null,
      worksiteId: 'barn-e2e', nextWorkTick: 0, housingId: 'barn-e2e', workRemainderMs: 0,
      bondXp: 0, selectedBattleAbilityId: 'snarlfox-flank',
    },
  ];
  state.nextEntityId = 500;

  await releaseSaveWriter(page);
  await page.evaluate(async (fixtureState) => {
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
        const current = request.result as { meta: Record<string, unknown> };
        store.put({ meta: { ...current.meta, savedAt: Date.now() }, state: fixtureState }, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  }, state);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.waitForTimeout(2_000);

  const facility = page.getByRole('dialog', { name: 'Facility actions' });
  await tapWorld(page, { x: 84 * 16, y: 79 * 16 }, state.player);
  await expect(facility.getByText('Stone Yard', { exact: true })).toBeVisible();
  const collect = facility.getByRole('button', { name: 'Collect worker stone' });
  await expect(collect).toBeEnabled();
  await collect.click();
  await facility.getByRole('button', { name: 'Close', exact: true }).click();

  await tapWorld(page, { x: 86 * 16, y: 79 * 16 }, state.player);
  await expect(facility.getByText('Cart Dock', { exact: true })).toBeVisible();
  await expect(facility.getByText(/Fern assigned .* Unloaded 5 raw resources/)).toBeVisible();

  await expectSavedState(page, (saved) => {
    const yard = saved.buildings.find((building) => building.id === 'yard-e2e');
    const dock = saved.buildings.find((building) => building.id === 'dock-e2e');
    const box = saved.buildings.find((building) => building.id === 'box-e2e');
    return (saved.inventory.stone ?? 0) >= 2
      && yard?.producer?.bin.stone === 0
      && box?.storage?.wood === 5
      && dock?.cartDock?.lastTransferMessage === 'Unloaded 5 raw resources';
  });
});
