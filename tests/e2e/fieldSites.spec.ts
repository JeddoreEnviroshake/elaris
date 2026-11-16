import { expect, test, type Page } from '@playwright/test';
import { openApp, reloadApp } from './app';
import { releaseSaveWriter } from './save';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { createOpeningChapter } from '../../src/content/onboarding';
import { enterWorldArea } from '../../src/simulation/areas';
import { liveAreaSites } from '../../src/simulation/sites';

const SEED = 2024;
const SALVAGE = ['scrap-iron', 'clockwork', 'lens', 'arcane-dust', 'construct-core', 'ancient-alloy'] as const;

/** A character standing on the strongbox of the first field site out of town. */
function siteFixture(): { state: GameState; siteId: string; strongbox: number } {
  const state = createInitialState(SEED);
  state.onboarding = createOpeningChapter(SEED, true);
  for (const [x, y] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
    enterWorldArea(state, x, y);
    const site = liveAreaSites(state)[0];
    if (!site) continue;
    const strongbox = site.containers.at(-1)!;
    state.player.x = strongbox.x;
    state.player.y = strongbox.y;
    // Nothing may wander in and interrupt the search.
    state.raiders = [];
    state.wildCreatures = [];
    return { state, siteId: site.id, strongbox: strongbox.index };
  }
  throw new Error('no field site next to Elaris for the fixture seed');
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

async function savedSite(page: Page, siteId: string): Promise<{ salvage: number; searched: number[] } | null> {
  return page.evaluate(async ({ siteId, salvageIds }) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    return new Promise<{ salvage: number; searched: number[] } | null>((resolve, reject) => {
      const request = db.transaction('snapshots').objectStore('snapshots').get('current');
      request.onsuccess = () => {
        db.close();
        const state = (request.result as { state?: { inventory: Record<string, number>; siteProgress?: Record<string, { searched: number[] }> } } | undefined)?.state;
        if (!state) { resolve(null); return; }
        resolve({
          salvage: salvageIds.reduce((sum, id) => sum + (state.inventory[id] ?? 0), 0),
          searched: state.siteProgress?.[siteId]?.searched ?? [],
        });
      };
      request.onerror = () => reject(request.error);
    });
  }, { siteId, salvageIds: [...SALVAGE] });
}

test('searching a field site strongbox puts salvage in the bag and marks it searched', async ({ page }) => {
  test.setTimeout(90_000);
  const { state, siteId, strongbox } = siteFixture();
  await seed(page, state);

  const action = page.locator('[data-action-button]');
  await expect(action).toHaveText('Search Strongbox');
  await action.click();
  // Standing still for the strongbox's three seconds completes the search.
  await expect.poll(() => savedSite(page, siteId), { timeout: 20_000 })
    .toMatchObject({ searched: [strongbox] });
  const saved = await savedSite(page, siteId);
  expect(saved!.salvage).toBeGreaterThan(0);
  // Searched this refill: the strongbox no longer offers a search.
  await expect(action).not.toHaveText('Search Strongbox');
});
