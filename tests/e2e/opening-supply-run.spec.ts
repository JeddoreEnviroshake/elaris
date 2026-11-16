import { expect, test, type Page } from '@playwright/test';
import { readySupplyRun } from '../helpers/openingJourney';
import { openApp, reloadApp } from './app';
import { openMenuTab } from './menu';
import { releaseSaveWriter, readSavedState } from './save';
import { inventoryCapacity } from '../../src/simulation/characterProgression';
import { usedInventorySlots } from '../../src/simulation/gameplayCommands';
import { RESOURCE_STACK_SIZE } from '../../src/config/balance';
import type { GameState } from '../../src/simulation/state';

test.setTimeout(160_000);
const saved = async (page: Page) => await readSavedState(page) as unknown as GameState;
async function loadFixture(page: Page, fullBag = false) {
  await openApp(page, 'render=3d');
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await expect.poll(() => readSavedState(page)).not.toBeNull();
  const state = readySupplyRun(); const site = state.onboarding.supplyRun!.site!;
  state.player.x = (fullBag ? site.tileX + .5 : 48.5) * 16; state.player.y = (site.tileY + .5) * 16;
  if (fullBag) {
    state.inventory.fiber = 0; state.inventory.wood = 0;
    state.inventory.wood = (inventoryCapacity(state) - usedInventorySlots(state)) * RESOURCE_STACK_SIZE;
    expect(usedInventorySlots(state)).toBe(inventoryCapacity(state));
  }
  await releaseSaveWriter(page);
  await page.evaluate(async (fixture) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite'); const store = tx.objectStore('snapshots'); const request = store.get('current');
      request.onsuccess = () => { const current = request.result as { meta: Record<string, unknown> }; store.put({ meta: { ...current.meta, savedAt: Date.now() }, state: fixture }, 'current'); };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    });
  }, state);
  await reloadApp(page);
  await expect(page.getByRole('button', { name: 'Supply run guide', exact: true })).toBeVisible();
  return state;
}

test('3D supply run walks to the cart and saves one discovery', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const initial = await loadFixture(page); const site = initial.onboarding.supplyRun!.site!;
  await page.getByRole('button', { name: 'Supply run guide', exact: true }).click();
  await expect(page.getByLabel('Supply run route', { exact: true })).toContainText(`cart at X ${site.tileX}, Y ${site.tileY}`);
  await expect(page.getByLabel('Supply run route', { exact: true })).toContainText('walking tiles remaining');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({ path: `tmp/supply-run-route-${testInfo.project.name}.png` });
  await page.keyboard.down('a');
  try {
    await expect.poll(async () => Number((await page.getByRole('button', { name: 'Toggle world map', exact: true }).textContent())?.match(/X (\d+)/)?.[1]), { timeout: 30_000, intervals: [100, 100, 250] }).toBeLessThanOrEqual(site.tileX + 1);
  } finally { await page.keyboard.up('a'); }
  await page.getByRole('button', { name: 'Supply run guide', exact: true }).click();
  await page.getByRole('button', { name: 'Recover lost supplies', exact: true }).click();
  await expect.poll(async () => (await saved(page)).onboarding.completedMilestoneIds).toContain('collect-discovery');
  const recovered = await saved(page);
  expect(recovered.carriedBlueprints.filter((paper) => paper.blueprintId === 'garden-bed')).toHaveLength(1);
  expect(recovered.unlockedItemIds).not.toContain('garden-bed');
  await expect(page.getByLabel('Supply run route', { exact: true })).toContainText('public workbench at X 84, Y 83');
  await expect(page.getByRole('button', { name: 'Discovery collected', exact: true })).toBeDisabled();
  await page.screenshot({ path: `tmp/supply-run-discovery-${testInfo.project.name}.png` });
  await reloadApp(page); await openMenuTab(page, 'Supply Run');
  expect((await saved(page)).carriedBlueprints).toEqual(recovered.carriedBlueprints);
  expect(errors).toEqual([]);
});

test('3D supply discovery waits through a full bag and reload until a real space is freed', async ({ page }) => {
  await loadFixture(page, true);
  await page.getByRole('button', { name: 'Supply run guide', exact: true }).click();
  await page.getByRole('button', { name: 'Recover lost supplies', exact: true }).click();
  await expect.poll(async () => (await saved(page)).onboarding.supplyRun!.suppliesRecovered).toBe(true);
  expect((await saved(page)).onboarding.supplyRun!.blueprintClaimed).toBe(false);
  expect((await saved(page)).carriedBlueprints).toHaveLength(0);
  await reloadApp(page); await openMenuTab(page, 'Supply Run');
  await expect(page.getByRole('tabpanel', { name: 'Supply Run', exact: true })).toContainText('waiting safely');
  await openMenuTab(page, 'Bag');
  await page.getByRole('button', { name: /^Wood stack,/ }).first().click();
  await page.getByRole('dialog', { name: 'Wood stack actions', exact: true }).getByRole('button', { name: 'Drop', exact: true }).click();
  await openMenuTab(page, 'Supply Run');
  await page.getByRole('button', { name: 'Collect Garden Bed blueprint', exact: true }).click();
  await expect.poll(async () => (await saved(page)).onboarding.supplyRun!.blueprintClaimed).toBe(true);
  expect((await saved(page)).carriedBlueprints.filter((paper) => paper.blueprintId === 'garden-bed')).toHaveLength(1);
});
