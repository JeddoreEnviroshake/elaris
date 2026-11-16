import { expect, test, type Page } from '@playwright/test';
import { readyGarden } from '../helpers/openingJourney';
import { openApp, reloadApp } from './app';
import { stepDpad } from './routeInput';
import { openMenuTab } from './menu';
import { releaseSaveWriter, readSavedState } from './save';
import { openingGardenBuildRequest, openingGardenTarget, registerOpeningDiscovery } from '../../src/simulation/openingGarden';
import { reconcileQuestProgress } from '../../src/simulation/progression';
import { supplyRunRoute } from '../../src/simulation/openingSupplyRun';
import { placeBuildBatch } from '../../src/simulation/batchBuilding';
import { advanceGardenBeds } from '../../src/simulation/gardenBeds';
import { GARDEN_BED_GROW_TICKS, RESOURCE_STACK_SIZE } from '../../src/config/balance';
import { inventoryCapacity } from '../../src/simulation/characterProgression';
import { usedInventorySlots } from '../../src/simulation/gameplayCommands';
import type { GameState } from '../../src/simulation/state';

test.setTimeout(240_000);
const saved = async (page: Page) => await readSavedState(page) as unknown as GameState;
async function loadFixture(page: Page, prepare?: (state: GameState) => void, oldVersion = false) {
  await openApp(page, 'render=3d');
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await expect.poll(() => readSavedState(page)).not.toBeNull();
  const state = readyGarden(); prepare?.(state);
  if (oldVersion) {
    state.onboarding.version = 6; state.onboarding.status = 'complete';
    state.onboarding.completedMilestoneIds = state.onboarding.completedMilestoneIds.filter((id) => !['register-discovery', 'build-garden', 'harvest-garden'].includes(id));
    delete (state.onboarding as Partial<typeof state.onboarding>).garden;
  }
  await releaseSaveWriter(page);
  await page.evaluate(async ({ fixture, old }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite'); const store = tx.objectStore('snapshots'); const request = store.get('current');
      request.onsuccess = () => { const current = request.result as { meta: Record<string, unknown> }; store.put({ meta: { ...current.meta, savedAt: Date.now(), ...(old ? { saveVersion: 87, contentVersion: 65 } : {}) }, state: fixture }, 'current'); };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    });
  }, { fixture: state, old: oldVersion });
  await reloadApp(page);
  await expect(page.getByRole('button', { name: 'Garden guide', exact: true })).toBeVisible();
  return state;
}

async function coordinates(page: Page) {
  const text = await page.getByRole('button', { name: 'Toggle world map', exact: true }).textContent();
  const match = text?.match(/X (\d+)\s*[,·]?\s*Y (\d+)/); expect(match).not.toBeNull();
  return { tileX: Number(match![1]), tileY: Number(match![2]) };
}
/** Drive ordinary one-tile input, using the visible minimap for every step. */
async function walkTo(page: Page, model: GameState, target: { tileX: number; tileY: number }) {
  for (let step = 0; step < 220; step++) {
    const current = await coordinates(page);
    if (current.tileX === target.tileX && current.tileY === target.tileY) return;
    const route = supplyRunRoute({ ...model, player: { ...model.player, x: (current.tileX + .5) * 16, y: (current.tileY + .5) * 16 } }, target);
    expect(route).not.toBeNull(); const next = route![1]!;
    const direction = next.tileX < current.tileX ? 'left' : next.tileX > current.tileX ? 'right' : next.tileY < current.tileY ? 'up' : 'down';
    await stepDpad(page, direction);
    await expect.poll(() => coordinates(page), { timeout: 4000, intervals: [50, 100] }).toEqual(next);
    await page.waitForTimeout(200);
  }
  throw new Error('The visible walking route did not reach its destination');
}

test('3D journey returns home, registers, builds and harvests a real garden, then saves a next direction', async ({ page, isMobile }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const initial = await loadFixture(page, (state) => { state.player.x = 48.5 * 16; state.player.y = 85.5 * 16; });
  await page.getByRole('button', { name: 'Garden guide', exact: true }).click();
  const register = page.getByRole('button', { name: 'Register Garden Bed discovery', exact: true });
  await expect(register).toBeDisabled();
  await expect(page.getByLabel('Garden journey directions', { exact: true })).toContainText('Public workbench');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await walkTo(page, initial, { tileX: 84, tileY: 83 });
  await page.getByRole('button', { name: 'Garden guide', exact: true }).click();
  await expect(register).toBeEnabled(); if (isMobile) await register.tap(); else await register.click();
  await expect.poll(async () => (await saved(page)).onboarding.completedMilestoneIds).toContain('register-discovery');
  const permanent = await saved(page); expect(permanent.unlockedItemIds).toContain('garden-bed'); expect(permanent.carriedBlueprints).toHaveLength(0);
  await page.screenshot({ path: `tmp/opening-garden-registered-${testInfo.project.name}.png` });
  await reloadApp(page);
  const registered = await saved(page); expect(registered.unlockedItemIds).toContain('garden-bed'); expect(registered.carriedBlueprints).toHaveLength(0);
  await walkTo(page, registered, openingGardenTarget(registered)!);
  await page.getByRole('button', { name: 'Garden guide', exact: true }).click();
  await page.getByRole('button', { name: 'Preview Garden Bed', exact: true }).click();
  const build = page.getByRole('button', { name: 'Build 1', exact: true }); await expect(build).toBeEnabled();
  await page.screenshot({ path: `tmp/opening-garden-preview-${testInfo.project.name}.png` });
  const bag = (await saved(page)).inventory;
  if (isMobile) await build.tap(); else await build.click();
  await expect.poll(async () => (await saved(page)).onboarding.completedMilestoneIds).toContain('build-garden');
  const planted = await saved(page); expect(planted.inventory.wood).toBe(bag.wood - 4); expect(planted.inventory.fiber).toBe(bag.fiber - 2);
  expect(planted.ownedCreatures[0]!.id).toBe(initial.onboarding.companionId); expect(planted.ownedCreatures[0]!.role).toBe('follow');
  await page.getByRole('button', { name: 'Garden guide', exact: true }).click();
  await expect(page.getByLabel('Garden growth and harvest', { exact: true })).toContainText('No creature assignment is needed');
  const harvest = page.getByRole('button', { name: 'Collect garden fiber', exact: true }); await expect(harvest).toBeDisabled();
  await harvest.scrollIntoViewIfNeeded();
  const panel = page.getByRole('tabpanel', { name: 'Garden', exact: true });
  const scrollTop = await panel.evaluate((element) => element.scrollTop); expect(scrollTop).toBeGreaterThan(0);
  await expect.poll(async () => (await saved(page)).buildings.find((bed) => bed.id === planted.onboarding.garden!.bedId)!.garden!.progressTicks, { timeout: 20_000 }).toBeGreaterThanOrEqual(300);
  expect(await panel.evaluate((element) => element.scrollTop)).toBeGreaterThanOrEqual(scrollTop - 5);
  const partial = await saved(page); await reloadApp(page); await openMenuTab(page, 'Garden');
  expect((await saved(page)).buildings.find((bed) => bed.id === planted.onboarding.garden!.bedId)!.garden!.progressTicks).toBeGreaterThanOrEqual(partial.buildings.find((bed) => bed.id === planted.onboarding.garden!.bedId)!.garden!.progressTicks);
  await expect(harvest).toBeEnabled({ timeout: 90_000 });
  await page.screenshot({ path: `tmp/opening-garden-ready-${testInfo.project.name}.png` });
  const beforeHarvest = await saved(page); if (isMobile) await harvest.tap(); else await harvest.click();
  await expect.poll(async () => (await saved(page)).onboarding.status).toBe('complete');
  expect((await saved(page)).inventory.fiber).toBe(beforeHarvest.inventory.fiber + 5);
  const recap = page.getByLabel('First journey recap', { exact: true }); await expect(recap).toBeVisible(); await expect(recap).toContainText('first chapter is complete');
  await expect(recap).toContainText('weathered the first fog'); await expect(recap).not.toContainText('Shell Guard prevented');
  await page.screenshot({ path: `tmp/opening-garden-recap-${testInfo.project.name}.png` });
  await page.getByRole('button', { name: 'Explore beyond Elaris', exact: true }).click();
  await expect.poll(async () => (await saved(page)).onboarding.garden!.nextGoal).toBe('explore');
  await reloadApp(page); await openMenuTab(page, 'Garden'); await expect(page.getByRole('button', { name: 'Explore beyond Elaris', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const final = await saved(page); expect(final.buildings.filter((bed) => bed.definitionId === 'garden-bed')).toHaveLength(1); expect(final.ownedCreatures).toHaveLength(1);
  expect(final.onboarding.garden).toMatchObject({ harvestedFiber: 5, recapAcknowledged: true, nextGoal: 'explore' }); expect(errors).toEqual([]);
});

test('3D upgraded garden keeps its output through a full bag and reload, then credits one collection', async ({ page }) => {
  const initial = await loadFixture(page, (state) => {
    registerOpeningDiscovery(state); reconcileQuestProgress(state);
    const plan = state.onboarding.garden!.plan!; state.player.x = (plan.tileX + 1.5) * 16; state.player.y = (plan.tileY + 1.5) * 16;
    expect(placeBuildBatch(state, openingGardenBuildRequest(state)).ok).toBe(true); reconcileQuestProgress(state);
    for (let i = 0; i < GARDEN_BED_GROW_TICKS; i++) { state.tick++; advanceGardenBeds(state); }
    state.inventory.fiber = 0; state.inventory.wood = 0; state.inventory.wood = (inventoryCapacity(state) - usedInventorySlots(state)) * RESOURCE_STACK_SIZE;
  }, true);
  await page.getByRole('button', { name: 'Garden guide', exact: true }).click();
  const harvest = page.getByRole('button', { name: 'Collect garden fiber', exact: true }); await expect(harvest).toBeEnabled();
  await harvest.click(); await expect(page.getByLabel('Garden growth and harvest', { exact: true })).toContainText('Stored 5/15');
  expect((await saved(page)).onboarding.garden!.harvestedFiber).toBe(0);
  await reloadApp(page); await openMenuTab(page, 'Garden'); await expect(page.getByLabel('Garden growth and harvest', { exact: true })).toContainText('Stored 5/15');
  await openMenuTab(page, 'Bag'); await page.getByRole('button', { name: /^Wood stack,/ }).first().click();
  await page.getByRole('dialog', { name: 'Wood stack actions', exact: true }).getByRole('button', { name: 'Drop', exact: true }).click();
  await openMenuTab(page, 'Garden'); await harvest.click(); await expect.poll(async () => (await saved(page)).onboarding.status).toBe('complete');
  const result = await saved(page); expect(result.inventory.fiber).toBe(5); expect(result.buildings.filter((bed) => bed.definitionId === 'garden-bed')).toHaveLength(1);
  expect(result.ownedCreatures).toEqual(initial.ownedCreatures); expect(result.onboarding.supplyRun).toEqual(initial.onboarding.supplyRun);
  await page.getByRole('button', { name: 'Keep playing freely', exact: true }).click(); await expect.poll(async () => (await saved(page)).onboarding.garden!.recapAcknowledged).toBe(true);
});
