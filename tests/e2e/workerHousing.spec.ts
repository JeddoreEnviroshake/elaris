import { expect, test } from '@playwright/test';
import { createInitialState, createWorkerHousingState } from '../../src/simulation/state';
import { enclosedEnvironment } from '../unit/helpers/buildings';
import { openApp } from './app';
import { tapWorld } from './interact';
import { releaseSaveWriter, expectSavedState } from './save';

test('orders, houses, works, and collects a Tuftle through the 3D facility flow', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.waitForTimeout(500);

  const state = createInitialState(4_204);
  state.player.x = 80 * 16;
  state.player.y = 80 * 16;
  state.coins = 500;
  state.highestRatingEverTenths = 2_500;
  state.firstTamedSpeciesIds = ['tuftle'];
  state.unlockedItemIds.push('farm-counter', 'small-pen');
  state.buildings = [
    { id: 'counter-floor-a', definitionId: 'wood-floor', tileX: 80, tileY: 80 },
    { id: 'counter-floor-b', definitionId: 'wood-floor', tileX: 81, tileY: 80 },
    { id: 'farm-counter-e2e', definitionId: 'farm-counter', tileX: 80, tileY: 80 },
    ...enclosedEnvironment(82, 78, 4, 4, 'workYard'),
    { id: 'pen-e2e', definitionId: 'small-pen', tileX: 82, tileY: 78, housing: createWorkerHousingState() },
  ];
  state.nextEntityId = 100;

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

  await tapWorld(page, { x: 81 * 16, y: 80.5 * 16 }, state.player);
  const facility = page.getByRole('dialog', { name: 'Facility actions' });
  await expect(facility).toBeVisible();
  await expect(facility.getByText('Farm Counter', { exact: true })).toBeVisible();
  const order = facility.getByRole('button', { name: 'Order trained Tuftle' });
  await expect(order).toBeEnabled();
  await order.click();

  await facility.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Creatures', exact: true }).click();
  const work = page.getByRole('button', { name: 'Work selected creature' });
  await expect(work).toBeEnabled();
  await work.click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // One deterministic Tuftle producer cycle is 15 seconds.
  await page.waitForTimeout(16_000);
  await tapWorld(page, { x: 83 * 16, y: 79 * 16 }, state.player);
  await expect(facility).toBeVisible();
  await expect(facility.getByText('Small Pen', { exact: true })).toBeVisible();
  const collect = facility.getByRole('button', { name: 'Collect worker fiber' });
  await expect(collect).toBeEnabled();
  await collect.click();

  await expectSavedState(page, (saved) => {
    const pen = saved.buildings.find((building) => building.id === 'pen-e2e');
    return (saved.inventory.fiber ?? 0) >= 2
      && saved.workerResourcesProduced >= 2
      && pen?.housing?.bin.fiber === 0;
  });
});
