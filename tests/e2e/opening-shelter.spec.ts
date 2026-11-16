import { expect, test, type Page } from '@playwright/test';
import { befriendOpeningTuftle } from '../helpers/openingJourney';
import { openApp, reloadApp } from './app';
import { openMenuTab } from './menu';
import { releaseSaveWriter, readSavedState } from './save';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { recordOpeningGatherAssistance } from '../../src/simulation/onboardingProgress';
import { reconcileOpeningShelter, SHELTER_STAGE_LABELS } from '../../src/simulation/openingShelter';

test.setTimeout(120_000);
const saved = async (page: Page) => await readSavedState(page) as unknown as GameState;

async function loadBuilder(page: Page) {
  await openApp(page, 'render=3d');
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await expect.poll(() => readSavedState(page)).not.toBeNull();
  const state = createInitialState(42);
  state.player.x = 82 * 16; state.player.y = 82 * 16;
  befriendOpeningTuftle(state);
  recordOpeningGatherAssistance(state, state.onboarding.companionId!, 1);
  reconcileOpeningShelter(state);
  const site = state.onboarding.shelterPlan!;
  state.player.x = (site.tileX + 1.5) * 16; state.player.y = (site.tileY + 3) * 16;
  state.inventory.fiber = 100; state.inventory.wood = 100; state.inventory.stone = 100;
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
  await reloadApp(page);
  await expect(page.getByRole('button', { name: 'Shelter guide', exact: true })).toBeVisible();
  return site;
}

test('3D shelter guide previews grouped costs, undoes floors, and saves a protected home', async ({ page, isMobile }, testInfo) => {
  const site = await loadBuilder(page);
  await page.getByRole('button', { name: 'Shelter guide', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Shelter', exact: true })).toContainText('33 fiber');
  await page.getByRole('button', { name: 'Collect building supplies', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Building supplies collected', exact: true })).toBeDisabled();
  const counts = [8, 4, 3, 2, 2, 1, 1, 1];
  let total = 0;
  for (const [index, label] of SHELTER_STAGE_LABELS.entries()) {
    if (index > 0) await page.getByRole('button', { name: 'Shelter guide', exact: true }).click();
    await page.getByRole('button', { name: `Preview ${label}`, exact: true }).click();
    const build = page.getByRole('button', { name: `Build ${counts[index]}`, exact: true });
    await expect(build).toBeEnabled();
    await expect(page.locator('[data-placing-title]')).toContainText('Total:');
    if (index === 0) await page.screenshot({ path: `tmp/shelter-preview-${testInfo.project.name}.png` });
    if (isMobile) await build.tap(); else await build.click();
    total += counts[index]!;
    await expect.poll(async () => (await saved(page)).buildings.length).toBe(total);
    if (index === 0) {
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect.poll(async () => (await saved(page)).buildings.length).toBe(0);
      await expect.poll(async () => (await saved(page)).inventory.fiber).toBe(116);
      await expect(build).toBeEnabled();
      await build.click();
      await expect.poll(async () => (await saved(page)).buildings.length).toBe(8);
    }
  }
  await expect.poll(async () => (await saved(page)).onboarding.completedMilestoneIds).toContain('build-shelter');
  await page.keyboard.press('Escape');
  await page.keyboard.down('w');
  try {
    await expect.poll(async () => Math.floor((await saved(page)).player.y / 16)).toBeLessThan(site.tileY + 2);
  } finally { await page.keyboard.up('w'); }
  await openMenuTab(page, 'Shelter');
  await expect(page.getByRole('tabpanel', { name: 'Shelter', exact: true })).toContainText('Shelter ready');
  await expect(page.getByRole('tabpanel', { name: 'Shelter', exact: true })).toContainText('You are protected here.');
  await page.screenshot({ path: `tmp/opening-shelter-${testInfo.project.name}.png` });
  const before = await saved(page);
  await reloadApp(page);
  await openMenuTab(page, 'Shelter');
  await expect(page.getByRole('tabpanel', { name: 'Shelter', exact: true })).toContainText('Shelter ready');
  const after = await saved(page);
  expect(after.onboarding.shelterHome).toEqual(before.onboarding.shelterHome);
  expect(after.onboarding.completedMilestoneIds).toContain('build-shelter');
  expect(after.buildings).toHaveLength(22);
  expect(after.onboarding.issuedRewardIds.filter((id) => id === 'shelter-supplies')).toHaveLength(1);
});
