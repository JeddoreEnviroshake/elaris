import { expect, test } from '@playwright/test';
import { openApp, reloadApp } from './app';
import { releaseSaveWriter, readSavedState } from './save';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { DEFAULT_WORLD_SEED } from '../../src/config/platform';
import { beginOpeningTrust, actOpeningTrust, nameOpeningCompanion } from '../../src/simulation/onboarding';
import { starterGroveAnchor } from '../../src/simulation/worldGeneration';

test.setTimeout(60_000);

test('3D assisted harvest shows the partner contribution and saves shelter knowledge', async ({ page, isMobile }, testInfo) => {
  await openApp(page, 'render=3d');
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  await expect.poll(() => readSavedState(page)).not.toBeNull();
  const state = createInitialState(DEFAULT_WORLD_SEED);
  state.player.x = 82 * 16; state.player.y = 82 * 16;
  beginOpeningTrust(state);
  for (let index = 0; index < 4; index++) actOpeningTrust(state, 'steady');
  nameOpeningCompanion(state, 'Moss');
  Object.assign(state.player, starterGroveAnchor(state.seed));
  state.gameBalance.objects.plant.yieldMin = 4;
  state.gameBalance.objects.plant.yieldMax = 4;
  state.gameBalance.objects.plant.maxHp = 1;
  state.resourceNodes = [{ id: 'assisted-plant', kind: 'plant', x: state.player.x + 16, y: state.player.y, hp: 1, maxHp: 1, respawnAtTick: null }];
  await releaseSaveWriter(page);
  await page.evaluate(async (fixture) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('snapshots', 'readwrite');
      const store = tx.objectStore('snapshots');
      const request = store.get('current');
      request.onsuccess = () => {
        const current = request.result as { meta: Record<string, unknown> };
        store.put({ meta: { ...current.meta, savedAt: Date.now() }, state: fixture }, 'current');
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  }, state);
  await reloadApp(page);
  await expect(page.locator('#elaris-three-canvas')).toBeVisible();
  await expect(page.locator('[data-target-hint]')).toHaveAttribute('data-resource-target-kind', 'plant');
  const action = page.locator('[data-action-button]');
  if (isMobile) await action.tap(); else await action.click();
  await expect(page.getByText(/Moss helped: \+1 fiber · Shelter recipes learned/)).toBeVisible();
  const contribution = await page.locator('[data-gather-assistance]').boundingBox();
  expect(contribution).not.toBeNull();
  for (const id of ['quest-complete-banner', 'blueprint-unlocked-banner']) {
    const banner = await page.getByTestId(id).boundingBox();
    if (banner) expect(contribution!.y).toBeGreaterThanOrEqual(banner.y + banner.height + 8);
  }
  await page.screenshot({ path: `tmp/cooperative-gathering-${testInfo.project.name}.png` });
  await expect.poll(async () => (await readSavedState(page))?.inventory.fiber).toBe(5);
  const saved = await readSavedState(page) as unknown as GameState;
  expect(saved.onboarding.status).toBe('active');
  expect(saved.onboarding.issuedRewardIds).toEqual(expect.arrayContaining(['starter-partner', 'shelter-recipes']));
  expect(saved.unlockedItemIds).toContain('air-purifier');
  expect(saved.unlockedItemIds).toContain('field-cache');
  await reloadApp(page);
  await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
  const loaded = await readSavedState(page) as unknown as GameState;
  expect(loaded.onboarding).toEqual(saved.onboarding);
  expect(loaded.ownedCreatures.find((creature) => creature.id === loaded.onboarding.companionId)).toMatchObject({ name: 'Moss', role: 'follow' });
  expect(loaded.unlockedItemIds.filter((id) => id === 'field-cache')).toHaveLength(1);
});
