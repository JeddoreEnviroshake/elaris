import { releaseSaveWriter } from './save';
import { expect, test, type Page } from '@playwright/test';
import { createInitialState, createWorkerHousingState } from '../../src/simulation/state';
import { enclosedEnvironment } from '../unit/helpers/buildings';
import { openApp, waitForDebugHandles, reloadApp } from './app';

/**
 * A creature on Work duty should be visible at the facility it staffs.
 *
 * The unit suite proves the wander path; only the real page can show that the
 * scene actually draws a 3D model for it, keeps it near the pen, and keeps it
 * walking. Read from the live scene rather than a snapshot: the path is
 * presentation state and never reaches IndexedDB at all.
 */

const PEN = { tileX: 82, tileY: 78 };

async function workerPose(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const sprite = (globalThis as any).__renderer3d.workerRigs.get('worker-e2e')?.root;
    return sprite ? { x: sprite.position.x * 16, y: sprite.position.z * 16 } : null;
  });
}

/** Seed one Tuftle working a Small Pen, then reload into it. */
async function seedWorkingCreature(page: Page, query = ''): Promise<void> {
  await openApp(page, query);
  await waitForDebugHandles(page);
  await page.evaluate(async () => { await (globalThis as any).__controller.flushAndRelease(); });

  const state = createInitialState(4_204);
  state.player.x = 80 * 16;
  state.player.y = 80 * 16;
  state.buildings = [
    ...enclosedEnvironment(PEN.tileX, PEN.tileY, 4, 4, 'workYard'),
    { id: 'pen-e2e', definitionId: 'small-pen', tileX: PEN.tileX, tileY: PEN.tileY, housing: createWorkerHousingState() },
  ];
  state.ownedCreatures = [{
    id: 'worker-e2e', speciesId: 'tuftle', name: 'Moss', role: 'work', assignment: 'fiber',
    worksiteId: 'pen-e2e', housingId: 'pen-e2e', nextWorkTick: 0, bondXp: 0,
    selectedBattleAbilityId: 'tuftle-guard',
  }];
  state.nextEntityId = 100;

  await releaseSaveWriter(page);
  await page.evaluate(async (fixtureState) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1);
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
  await reloadApp(page);
  await waitForDebugHandles(page);
}

const PEN_CENTER = { x: (PEN.tileX + 1) * 16, y: (PEN.tileY + 1) * 16 };

test('a creature set to Work ambles around its worksite', async ({ page }) => {
  await seedWorkingCreature(page);

  // The worker is drawn, and it is drawn at the pen rather than anywhere else.
  const first = await workerPose(page);
  expect(first).not.toBeNull();
  const center = PEN_CENTER;
  expect(Math.hypot(first!.x - center.x, first!.y - center.y)).toBeLessThan(4 * 16);

  // And it is moving on its own, with the player standing still.
  await expect.poll(async () => {
    const pose = await workerPose(page);
    return pose ? Math.hypot(pose.x - first!.x, pose.y - first!.y) : 0;
  }, { timeout: 15_000, intervals: [250] }).toBeGreaterThan(6);

  const roaming = await workerPose(page);
  expect(Math.hypot(roaming!.x - center.x, roaming!.y - center.y)).toBeLessThan(4 * 16);

  // Resting drops the worker from the world again.
  await page.evaluate(() => {
    const scene = (globalThis as any).__game.scene.getScene('world');
    scene.state.ownedCreatures[0].role = 'rest';
    scene.state.ownedCreatures[0].worksiteId = null;
  });
  await expect.poll(async () => await workerPose(page), { timeout: 5_000, intervals: [250] }).toBeNull();
});

/** Worker rig position in world tiles, which is what the 3D scene works in. */
async function workerRig(page: Page): Promise<{ x: number; z: number } | null> {
  return page.evaluate(() => {
    const rig = (globalThis as any).__renderer3d.workerRigs.get('worker-e2e');
    return rig ? { x: rig.root.position.x, z: rig.root.position.z } : null;
  });
}

test('the 3D world walks the same worker around the pen', async ({ page }) => {
  await seedWorkingCreature(page, 'render=3d');

  const first = await workerRig(page);
  expect(first).not.toBeNull();
  const center = { x: PEN_CENTER.x / 16, z: PEN_CENTER.y / 16 };
  expect(Math.hypot(first!.x - center.x, first!.z - center.z)).toBeLessThan(4);

  await expect.poll(async () => {
    const pose = await workerRig(page);
    return pose ? Math.hypot(pose.x - first!.x, pose.z - first!.z) : 0;
    // Generous: a headless software-GL frame loop is far slower than a real one,
    // so the loop takes real seconds to carry the rig a visible distance.
  }, { timeout: 30_000, intervals: [250] }).toBeGreaterThan(0.4);

  const roaming = await workerRig(page);
  expect(Math.hypot(roaming!.x - center.x, roaming!.z - center.z)).toBeLessThan(4);
});
