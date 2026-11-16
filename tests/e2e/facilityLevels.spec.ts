import { expect, test, type Page } from '@playwright/test';
import { openApp, reloadApp } from './app';
import { releaseSaveWriter } from './save';
import { tapCanvasCenter } from './interact';
import { TILE_SIZE } from '../../src/config/platform';
import { createOpeningChapter } from '../../src/content/onboarding';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { enclosedEnvironment } from '../unit/helpers/buildings';
import { QUEST_IDS } from '../../src/content/quests';

const SEED = 12;

/** Standing on your own Workbench in a closed room, carrying a two-site haul and a stone pick. */
function benchFixture(): GameState {
  const state = createInitialState(SEED);
  state.onboarding = createOpeningChapter(SEED, true);
  state.buildings = enclosedEnvironment(10, 10, 3, 3, 'indoor');
  state.buildings.push({ id: 'workbench-e2e', definitionId: 'workbench', tileX: 11, tileY: 11 });
  state.player.x = 11.5 * TILE_SIZE;
  state.player.y = 11.5 * TILE_SIZE;
  state.raiders = [];
  state.wildCreatures = [];
  // The room would complete building quests whose banners cover the panel; this
  // spec is about the bench, so those are already done and collected.
  state.completedQuestIds = [...QUEST_IDS];
  state.claimedQuestRewardIds = [...QUEST_IDS];
  Object.assign(state.inventory, { 'scrap-iron': 24, clockwork: 6 });
  state.tools.push({ instanceId: 'pick-e2e', definitionId: 'stone-pick', durability: 100, maxDurability: 100, powerRank: 0, speedRank: 0, durabilityRank: 0 });
  return state;
}

async function seed(page: Page, fixture: GameState): Promise<void> {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await releaseSaveWriter(page);
  await page.evaluate(async (state: GameState) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite'); const store = tx.objectStore('snapshots');
      const request = store.get('current');
      request.onsuccess = () => store.put({ ...request.result, state }, 'current');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    });
  }, fixture);
  await reloadApp(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
}

async function savedBench(page: Page): Promise<{ level: number; powerRank: number; scrap: number } | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return new Promise<{ level: number; powerRank: number; scrap: number } | null>((resolve, reject) => {
      const request = db.transaction('snapshots').objectStore('snapshots').get('current');
      request.onsuccess = () => {
        db.close();
        const state = (request.result as { state?: GameState } | undefined)?.state;
        if (!state) { resolve(null); return; }
        const bench = state.buildings.find((building) => building.id === 'workbench-e2e');
        const pick = state.tools.find((tool) => tool.instanceId === 'pick-e2e');
        resolve({ level: bench?.level ?? 1, powerRank: pick?.powerRank ?? -1, scrap: state.inventory['scrap-iron'] });
      };
      request.onerror = () => reject(request.error);
    });
  });
}

test('a two-site haul buys a level 2 Workbench that tempers a tool past rank 1', async ({ page }) => {
  test.setTimeout(90_000);
  await seed(page, benchFixture());
  await tapCanvasCenter(page);
  const panel = page.getByRole('dialog', { name: 'Facility actions' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-facility-level-status]')).toHaveAttribute('data-facility-level-status', '1');

  const power = panel.locator('[data-temper-tool="pick-e2e"] [data-temper-axis="power"]');
  // Level 1 tempers to rank 1 only.
  await power.click();
  await expect(power).toBeDisabled();

  await panel.locator('[data-facility-upgrade]').click();
  await expect(panel.locator('[data-facility-level-status]')).toHaveAttribute('data-facility-level-status', '2');
  await expect(power).toBeEnabled();
  await power.click();

  await expect.poll(() => savedBench(page), { timeout: 15_000 }).toMatchObject({ level: 2, powerRank: 2 });
  // 24 scrap - 4 (rank 1) - 12 (level 2) - 8 (rank 2).
  expect((await savedBench(page))!.scrap).toBe(0);
});
