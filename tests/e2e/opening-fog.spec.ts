import { expect, test, type Page } from '@playwright/test';
import { befriendOpeningTuftle } from '../helpers/openingJourney';
import { openApp, reloadApp } from './app';
import { openMenuTab } from './menu';
import { releaseSaveWriter, readSavedState } from './save';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { recordOpeningGatherAssistance } from '../../src/simulation/onboardingProgress';
import { reconcileOpeningShelter, shelterLayout } from '../../src/simulation/openingShelter';
import { placeBuildBatch } from '../../src/simulation/batchBuilding';
import { reconcileQuestProgress } from '../../src/simulation/progression';
import { claimAllBlueprintGrants } from '../../src/simulation/blueprintGrants';

test.setTimeout(200_000);
const saved = async (page: Page) => await readSavedState(page) as unknown as GameState;

function fogFixture() {
  const state = createInitialState(42);
  state.player.x = 82 * 16; state.player.y = 82 * 16;
  befriendOpeningTuftle(state);
  recordOpeningGatherAssistance(state, state.onboarding.companionId!, 1);
  reconcileOpeningShelter(state);
  const site = state.onboarding.shelterPlan!;
  state.player.x = (site.tileX + 1.5) * 16; state.player.y = (site.tileY + 3) * 16;
  state.inventory.fiber = 100; state.inventory.wood = 100; state.inventory.stone = 100;
  for (const stage of shelterLayout(site)) placeBuildBatch(state, stage);
  state.player.y = (site.tileY + 1.5) * 16;
  state.tick = 73_107;
  reconcileQuestProgress(state);
  // Enter the real 45-second preparation with ten seconds left; the entire fog runs live.
  state.tick = state.onboarding.firstThreat!.fogStartsAtTick! - 10 * 60;
  state.claimedQuestRewardIds = [...state.completedQuestIds];
  claimAllBlueprintGrants(state);
  return state;
}

async function putFixture(page: Page, state: GameState) {
  await releaseSaveWriter(page);
  await page.evaluate(async (fixture) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite'); const store = tx.objectStore('snapshots'); const request = store.get('current');
      request.onsuccess = () => {
        const current = request.result as { meta: Record<string, unknown> };
        store.put({ meta: { ...current.meta, savedAt: Date.now() }, state: fixture }, 'current');
      };
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    });
  }, state);
}

test('3D first fog waits for shelter, resumes on reload, and saves the return to safety', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page, 'render=3d');
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  const timer = page.locator('[data-survival-timer]');
  await expect(timer).toHaveText('FIRST FOG · BUILD SHELTER');
  await expect.poll(() => readSavedState(page)).not.toBeNull();
  const fixture = fogFixture();
  await putFixture(page, fixture);
  await reloadApp(page);
  await expect(timer).toContainText('FIRST FOG IN');
  await expect.poll(async () => (await saved(page)).onboarding.firstThreat!.fogStartsAtTick).toBe(fixture.onboarding.firstThreat!.fogStartsAtTick);
  await reloadApp(page);
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  expect((await saved(page)).onboarding.firstThreat!.fogEndsAtTick).toBe(fixture.onboarding.firstThreat!.fogEndsAtTick);
  await expect(timer).toContainText('POISON FOG', { timeout: 25_000 });
  await expect(timer).toHaveAttribute('aria-label', /Poison fog.*sheltered/);
  await expect.poll(async () => (await saved(page)).onboarding.firstThreat!.shelteredTicks).toBe(60);
  await page.screenshot({ path: `tmp/opening-fog-active-${testInfo.project.name}.png` });
  await openMenuTab(page, 'Shelter');
  await expect(page.getByLabel('First fog lesson')).toContainText('You are protected here');
  await expect(page.getByLabel('First fog lesson')).toContainText('Organize your Storage Box');
  await openMenuTab(page, 'Bag');
  await expect(page.getByRole('tab', { name: 'Bag', exact: true })).toHaveAttribute('aria-selected', 'true');
  const beforeReload = await saved(page);
  await reloadApp(page);
  await expect(timer).toContainText('POISON FOG');
  const resumed = await saved(page);
  expect(resumed.tick).toBeGreaterThanOrEqual(beforeReload.tick);
  expect(resumed.onboarding.firstThreat!.fogStartsAtTick).toBe(fixture.onboarding.firstThreat!.fogStartsAtTick);
  expect(resumed.onboarding.firstThreat!.fogEndsAtTick).toBe(fixture.onboarding.firstThreat!.fogEndsAtTick);
  expect(resumed.onboarding.completedMilestoneIds).not.toContain('weather-fog');
  await openMenuTab(page, 'Shelter');
  await expect(page.getByLabel('First fog lesson')).toContainText('The air is clear', { timeout: 100_000 });
  await expect(timer).toContainText('NIGHT RAID IN');
  await expect.poll(async () => (await saved(page)).onboarding.completedMilestoneIds).toContain('weather-fog');
  const after = await saved(page);
  expect(after.player.hp).toBe(fixture.player.hp);
  expect(after.onboarding.status).toBe('active');
  expect(after.buildings).toHaveLength(22);
  await page.screenshot({ path: `tmp/opening-fog-aftermath-${testInfo.project.name}.png` });
  await reloadApp(page);
  await openMenuTab(page, 'Shelter');
  await expect(page.getByLabel('First fog lesson')).toContainText('The air is clear');
  await page.getByLabel('First fog lesson').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByLabel('First fog lesson')).toBeHidden();
  await expect.poll(async () => (await saved(page)).onboarding.firstThreat!.aftermathAcknowledged).toBe(true);
  await reloadApp(page);
  await openMenuTab(page, 'Shelter');
  await expect(page.getByLabel('First fog lesson')).toBeHidden();
  expect((await saved(page)).onboarding.completedMilestoneIds.filter((id) => id === 'weather-fog')).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('3D fog protection text fits and a broken wall explains exposure', async ({ page }, testInfo) => {
  await openApp(page, 'render=3d');
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await expect.poll(() => readSavedState(page)).not.toBeNull();
  const fixture = fogFixture();
  fixture.tick = fixture.onboarding.firstThreat!.fogStartsAtTick! + 3 * 60;
  await putFixture(page, fixture);
  await reloadApp(page);
  const timer = page.locator('[data-survival-timer]');
  await expect(timer).toContainText('SHELTERED');
  const fits = await timer.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return element.scrollWidth <= element.clientWidth && rect.right <= innerWidth && rect.left >= 0;
  });
  expect(fits).toBe(true);
  await page.screenshot({ path: `tmp/opening-fog-timer-${testInfo.project.name}.png` });
  const broken = await saved(page); const site = broken.onboarding.shelterPlan!;
  const wall = broken.buildings.find((building) => building.boundaryEdge === 'north')!;
  broken.buildings = broken.buildings.filter((building) => building.id !== wall.id);
  broken.player.x = (site.tileX + 3.5) * 16;
  await putFixture(page, broken);
  await reloadApp(page);
  await expect(timer).toHaveAttribute('aria-label', /Poison fog.*exposed/);
  await openMenuTab(page, 'Shelter');
  await expect(page.getByLabel('First fog lesson')).toContainText('You are exposed');
  await expect(page.getByRole('tabpanel', { name: 'Shelter', exact: true })).toContainText(`Close the north edge at X ${wall.tileX}, Y ${wall.tileY}`);
  await page.screenshot({ path: `tmp/opening-fog-broken-wall-${testInfo.project.name}.png` });
});
