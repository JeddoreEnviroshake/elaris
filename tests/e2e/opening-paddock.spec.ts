import { expect, test, type Page } from '@playwright/test';
import { openApp } from './app';
import { openMenuTab } from './menu';
import { readSavedState } from './save';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { actOpeningTrust, beginOpeningTrust } from '../../src/simulation/onboarding';
import { recordOpeningGatherAssistance } from '../../src/simulation/onboardingProgress';
import { reconcileOpeningShelter, shelterLayout } from '../../src/simulation/openingShelter';
import { advanceOpeningFog } from '../../src/simulation/openingFog';
import { placeBuildBatch } from '../../src/simulation/batchBuilding';
import { reconcileQuestProgress } from '../../src/simulation/progression';
import { claimAllBlueprintGrants } from '../../src/simulation/blueprintGrants';
import { PADDOCK_STAGES, paddockLayout, startOpeningWork } from '../../src/simulation/openingPaddock';
import { settleWorkerProduction } from '../../src/simulation/workerHousing';

test.setTimeout(160_000);
const saved = async (page: Page) => await readSavedState(page) as unknown as GameState;
function fixture() {
  const state = createInitialState(42);
  state.player.x = 82 * 16; state.player.y = 82 * 16;
  beginOpeningTrust(state); for (let i = 0; i < 4; i++) actOpeningTrust(state, 'steady');
  recordOpeningGatherAssistance(state, state.onboarding.companionId!, 1); reconcileOpeningShelter(state);
  const home = state.onboarding.shelterPlan!;
  state.player.x = (home.tileX + 1.5) * 16; state.player.y = (home.tileY + 3) * 16;
  state.inventory.fiber = 200; state.inventory.wood = 200; state.inventory.stone = 100;
  for (const stage of shelterLayout(home)) placeBuildBatch(state, stage);
  state.player.y = (home.tileY + 1.5) * 16; reconcileQuestProgress(state);
  state.tick = state.onboarding.firstThreat!.fogStartsAtTick!;
  for (let i = 0; i < 60; i++) { advanceOpeningFog(state); state.tick++; }
  state.tick = state.onboarding.firstThreat!.fogEndsAtTick!; reconcileQuestProgress(state);
  state.onboarding.firstThreat!.aftermathAcknowledged = true;
  const plan = state.onboarding.production!.plan!;
  state.player.x = (plan.tileX + 2.5) * 16; state.player.y = (plan.tileY + 3) * 16;
  state.claimedQuestRewardIds = [...state.completedQuestIds]; claimAllBlueprintGrants(state);
  return state;
}
async function loadFixture(page: Page, prepare?: (state: GameState) => void) {
  await openApp(page, 'render=3d');
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await expect.poll(() => readSavedState(page)).not.toBeNull();
  const state = fixture();
  prepare?.(state);
  await page.evaluate(async (next) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('elaris:default', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite'); const store = tx.objectStore('snapshots'); const request = store.get('current');
      request.onsuccess = () => { const current = request.result as { meta: Record<string, unknown> }; store.put({ meta: { ...current.meta, savedAt: Date.now() }, state: next }, 'current'); };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    });
  }, state);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Paddock guide', exact: true })).toBeVisible();
  return state;
}

test('3D paddock builds, produces with the original Tuftle, collects once and saves Follow', async ({ page, isMobile }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  const initial = await loadFixture(page);
  await page.getByRole('button', { name: 'Paddock guide', exact: true }).click();
  await expect(page.getByLabel('Paddock and Tuftle assignment')).toContainText('19 fiber');
  await page.getByRole('button', { name: 'Collect paddock supplies', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Paddock supplies collected', exact: true })).toBeDisabled();
  let total = 22; const counts = [8, 2, 1, 1, 1, 1, 1];
  for (const [index, stage] of PADDOCK_STAGES.entries()) {
    if (index > 0) await page.getByRole('button', { name: 'Paddock guide', exact: true }).click();
    await page.getByRole('button', { name: `Preview paddock ${stage}`, exact: true }).click();
    const build = page.getByRole('button', { name: `Build ${counts[index]}`, exact: true });
    await expect(build).toBeEnabled();
    if (index === 0) await page.screenshot({ path: `tmp/opening-paddock-preview-${testInfo.project.name}.png` });
    if (isMobile) await build.tap(); else await build.click();
    total += counts[index]!;
    await expect.poll(async () => (await saved(page)).buildings.length).toBe(total);
  }
  await page.getByRole('button', { name: 'Paddock guide', exact: true }).click();
  await expect(page.getByRole('button', { name: 'House Tuftle and start Work', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'House Tuftle and start Work', exact: true }).click();
  const companion = (state: GameState) => state.ownedCreatures.find((creature) => creature.id === state.onboarding.companionId)!;
  await expect.poll(async () => companion(await saved(page)).role).toBe('work');
  await expect.poll(async () => companion(await saved(page)).workRemainderMs).toBeGreaterThan(0);
  const working = await saved(page);
  expect(companion(working).id).toBe(initial.onboarding.companionId);
  await page.screenshot({ path: `tmp/opening-paddock-working-${testInfo.project.name}.png` });
  await page.reload();
  await openMenuTab(page, 'Paddock');
  expect(companion(await saved(page)).housingId).toBe(companion(working).housingId);
  const collect = page.getByRole('button', { name: 'Collect Pen fiber', exact: true });
  await expect(collect).toBeEnabled({ timeout: 40_000 });
  await expect(collect).toHaveText('Collect 2 fiber');
  const beforeCollection = await saved(page);
  await collect.click();
  await expect.poll(async () => (await saved(page)).onboarding.completedMilestoneIds).toContain('collect-production');
  expect((await saved(page)).inventory.fiber).toBe(beforeCollection.inventory.fiber + 2);
  await expect(collect).toBeDisabled();
  await page.getByRole('button', { name: 'Bring Tuftle along · Follow', exact: true }).click();
  await expect.poll(async () => (await saved(page)).onboarding.completedMilestoneIds).toContain('return-to-follow');
  await expect(page.getByLabel('Paddock and Tuftle assignment')).toContainText('Ready to travel together');
  await page.screenshot({ path: `tmp/opening-paddock-complete-${testInfo.project.name}.png` });
  await page.reload();
  await openMenuTab(page, 'Paddock');
  const after = await saved(page);
  expect(after.ownedCreatures).toHaveLength(1);
  expect(companion(after)).toMatchObject({ id: initial.onboarding.companionId, role: 'follow', housingId: companion(working).housingId });
  expect(after.onboarding.completedMilestoneIds.filter((id) => id === 'collect-production')).toHaveLength(1);
  expect(after.onboarding.completedMilestoneIds).toContain('return-to-follow');
  expect(after.onboarding.issuedRewardIds.filter((id) => id === 'paddock-supplies')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('3D paddock recovery preserves output and housing through a broken fence', async ({ page }, testInfo) => {
  const initial = await loadFixture(page, (state) => {
    for (const stage of paddockLayout(state.onboarding.production!.plan!)) placeBuildBatch(state, stage);
    reconcileQuestProgress(state); startOpeningWork(state); settleWorkerProduction(state, 15_000);
    const fence = state.buildings.find((building) => building.definitionId === 'thatch-fence' && building.boundaryEdge === 'north')!;
    state.buildings = state.buildings.filter((building) => building.id !== fence.id);
  });
  const original = initial.ownedCreatures[0]!;
  await page.getByRole('button', { name: 'Paddock guide', exact: true }).click();
  const card = page.getByLabel('Tuftle assignment', { exact: true });
  await expect(card).toContainText('Close the north edge');
  await expect(card).toContainText('Bin 2/12');
  await expect.poll(async () => (await saved(page)).ownedCreatures[0]!.role).toBe('rest');
  expect((await saved(page)).ownedCreatures[0]!.housingId).toBe(original.housingId);
  await page.screenshot({ path: `tmp/opening-paddock-paused-${testInfo.project.name}.png` });
  await page.getByRole('button', { name: 'Collect Pen fiber', exact: true }).click();
  await expect.poll(async () => (await saved(page)).onboarding.production!.collectedFiber).toBe(2);
  await page.getByRole('button', { name: 'Preview paddock North fence', exact: true }).click();
  await page.getByRole('button', { name: 'Build 1', exact: true }).click();
  await page.getByRole('button', { name: 'Paddock guide', exact: true }).click();
  await expect(page.getByRole('button', { name: 'House Tuftle and start Work', exact: true })).toBeEnabled();
  const follow = page.getByRole('button', { name: 'Bring Tuftle along · Follow', exact: true });
  const [followBox, panelBox] = await Promise.all([follow.boundingBox(), page.getByLabel('Paddock and Tuftle assignment', { exact: true }).boundingBox()]);
  expect(followBox!.y + followBox!.height).toBeLessThanOrEqual(panelBox!.y + panelBox!.height);
  await page.screenshot({ path: `tmp/opening-paddock-repaired-${testInfo.project.name}.png` });
  await follow.click();
  await expect.poll(async () => (await saved(page)).onboarding.completedMilestoneIds).toContain('return-to-follow');
  expect((await saved(page)).ownedCreatures[0]).toMatchObject({ id: original.id, role: 'follow', housingId: original.housingId });
});
