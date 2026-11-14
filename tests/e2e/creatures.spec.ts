import { expect, test, type Page } from '@playwright/test';
import { openApp } from './app';
import { createInitialState, type GameState } from '../../src/simulation/state';

/**
 * Tapping a creature attacks it now, so taming is entered by throwing a snare
 * at the creature the player is standing next to — that button, not the tap, is
 * what these fixtures drive.
 */
async function throwSnare(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Throw snare at creature' }).click();
}

/** Put snares in the bag, stacks included, so the throw has something to spend. */
function carrySnares(state: GameState, count: number): void {
  state.inventory['taming-snare'] = count;
  state.inventoryStacks['taming-snare'] = count > 0 ? [count] : [];
}

test('uses the rocky hills arena for a Craghopper encounter', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Gather' })).toBeVisible();

  const state = createInitialState(321);
  const wild = state.wildCreatures.find((creature) => creature.speciesId === 'craghopper')!;
  wild.x = state.player.x + 180;
  wild.y = state.player.y;
  state.player.x = wild.x;
  state.player.y = wild.y;
  state.ownedCreatures.push({
    id: 'companion-e2e', speciesId: 'tuftle', name: 'Moss', role: 'follow', assignment: null,
    worksiteId: null, nextWorkTick: 0, bondXp: 36, selectedBattleAbilityId: 'tuftle-heal',
  });
  state.battleCompanionId = 'companion-e2e';
  carrySnares(state, 1);
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
        const current = request.result as { meta?: Record<string, unknown> };
        if (!current.meta) { reject(new Error('Current save metadata was not available')); return; }
        store.put({ meta: { ...current.meta, appVersion: 'e2e', savedAt: Date.now() }, state: fixtureState }, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  }, state);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Gather' })).toBeVisible();
  await throwSnare(page);

  const encounter = page.getByRole('dialog', { name: 'Wild creature encounter' });
  await expect(encounter).toBeVisible();
  await expect(encounter).toHaveAttribute('data-habitat', 'hills');
  await expect(encounter).toHaveCSS('background-image', /hills-arena\.png/);
  await expect(encounter.getByText('Wild Craghopper', { exact: true })).toBeVisible();
  await expect(encounter.getByText(/Intent: Advance/)).toBeVisible();
  await expect(encounter.getByRole('button', { name: /Moss: Gentle Mend/ })).toHaveAttribute('aria-pressed', 'true');
});

test('uses the ancient forest arena for a Glade Stag encounter', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Gather' })).toBeVisible();

  const state = createInitialState(654);
  const wild = state.wildCreatures.find((creature) => creature.speciesId === 'glade-stag')!;
  wild.x = state.player.x + 180;
  wild.y = state.player.y;
  state.player.x = wild.x;
  state.player.y = wild.y;
  carrySnares(state, 1);
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
        const current = request.result as { meta?: Record<string, unknown> };
        if (!current.meta) { reject(new Error('Current save metadata was not available')); return; }
        store.put({ meta: { ...current.meta, appVersion: 'e2e', savedAt: Date.now() }, state: fixtureState }, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  }, state);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Gather' })).toBeVisible();
  await throwSnare(page);

  const encounter = page.getByRole('dialog', { name: 'Wild creature encounter' });
  await expect(encounter).toBeVisible();
  await expect(encounter).toHaveAttribute('data-habitat', 'forest');
  await expect(encounter).toHaveCSS('background-image', /forest-arena\.png/);
  await expect(encounter.getByText('Wild Glade Stag', { exact: true })).toBeVisible();
});

test('tames, assigns, and restores a Tuftle through reload', async ({ page }) => {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Gather' })).toBeVisible();

  const state = createInitialState(123);
  const wild = state.wildCreatures.find((creature) => creature.speciesId === 'tuftle')!;
  // Keep this encounter fixture away from the protected service NPCs, which
  // intentionally take context-action priority when they are nearby.
  wild.x = state.player.x + 300;
  wild.y = state.player.y;
  state.player.x = wild.x;
  state.player.y = wild.y;
  // Three full-HP Tuftle snares fill the capture meter (3500 + 3500 + 3000 bps).
  state.inventory.wood = 3;
  state.inventory.fiber = 6;
  state.buildings.push(
    {
      id: 'cache-fixture', definitionId: 'field-cache', tileX: 2, tileY: 2,
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
    { id: 'planter-fixture', definitionId: 'woodlot-planter', tileX: 34, tileY: 27 },
  );
  state.nextEntityId = 3;
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
        const current = request.result as { meta?: Record<string, unknown> };
        if (!current.meta) {
          reject(new Error('Current save metadata was not available'));
          return;
        }
        store.put({
          meta: { ...current.meta, appVersion: 'e2e', savedAt: Date.now() },
          state: fixtureState,
        }, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  }, state);
  // Reload through the normal repository path so the test exercises the same
  // validated current-schema snapshot loading as a returning player.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Gather' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Craft', exact: true }).click();
  await page.getByRole('button', { name: 'Craft Taming Snare' }).click();
  await page.getByRole('button', { name: 'Craft Taming Snare' }).click();
  await page.getByRole('button', { name: 'Craft Taming Snare' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await throwSnare(page);
  await expect(page.getByRole('dialog', { name: 'Wild creature encounter' })).toBeVisible();
  await expect(page.getByText('Distance 40 · Melee ≤10 · Ranged ≤30 · Magic ∞')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Melee attack' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Ranged attack' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Magic attack' })).toBeEnabled();
  await page.getByRole('button', { name: 'Move forward' }).click();
  await expect(page.getByText('Distance 25 · Melee ≤10 · Ranged ≤30 · Magic ∞')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rest' })).toBeVisible();
  await page.getByRole('button', { name: 'Throw Snare' }).click();
  await page.getByRole('button', { name: 'Throw Snare' }).click();
  await page.getByRole('button', { name: 'Throw Snare' }).click();
  await expect(page.getByText(/joined you/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Creatures' }).click();
  await expect(page.getByText('Creature roster', { exact: true })).toBeVisible();
  await expect(page.getByText('Travels with you · Improves nearby plant gathering')).toBeVisible();
  await expect(page.getByText('Automatically gathers fiber at the nearest eligible worksite.')).toBeVisible();
  await expect(page.getByText('Stops following or working and remains inactive.')).toBeVisible();
  await page.getByRole('button', { name: 'Follow selected creature' }).click();
  await page.getByRole('button', { name: 'Set as Battle Companion' }).click();
  await expect(page.getByText(/Battle Companion · Bond 1/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Shell Guard/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: /Gentle Mend.*Requires Bond 2/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Work selected creature' }).click();
  await expect(page.getByText(/Tuftle assigned to/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Select Tuftle, Tuftle, currently work/ })).toBeVisible();

  await page.waitForTimeout(700);
  await page.reload();
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('tab', { name: 'Creatures' }).click();
  await expect(page.getByRole('button', { name: /Select Tuftle, Tuftle, currently work/ })).toBeVisible();
  await expect(page.getByText(/Worksite: woodlot-planter/)).toBeVisible();
});
