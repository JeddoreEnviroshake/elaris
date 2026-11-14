import { expect, test, type Page } from '@playwright/test';
import { openApp, waitForDebugHandles } from './app';

/**
 * Levels and aggression zones, asserted through the browser.
 *
 * The unit suite already proves the arithmetic. What only a real page can show
 * is that the world a player looks at agrees with the world the simulation is
 * running: that a level is drawn above the thing that carries it, and that
 * walking into a hostile's zone is what starts the chase.
 *
 * State is read from the live scene rather than from toasts, because both
 * populations are moving while the assertions run.
 */

const PLAYER = { x: 40 * 16, y: 40 * 16 };

/**
 * One levelled roamer at a chosen distance, in an otherwise empty world.
 *
 * The writer lease is handed back before the fixture is written: the controller
 * flushes live state on `pagehide`, so a fixture written and reloaded straight
 * into that flush is silently replaced by the world it was meant to override.
 */
async function seedRoamer(page: Page, offsetX: number, level: number): Promise<void> {
  await openApp(page);
  await waitForDebugHandles(page);
  await page.evaluate(async () => { await (globalThis as any).__controller.flushAndRelease(); });
  await page.evaluate(async ({ player, offset, roamerLevel }) => {
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
        const save = request.result as { meta: Record<string, unknown>; state: Record<string, any> };
        const state = save.state;
        state.player.x = player.x;
        state.player.y = player.y;
        state.buildings = [];
        state.resourceNodes = [];
        state.groundDrops = [];
        state.wildCreatures = [];
        // Outside Elaris: the town safe zone holds every hostile off, which
        // would make a chase test pass or fail for the wrong reason.
        state.currentArea = { ...state.currentArea, key: '1,0', x: 1, y: 0, theme: 'forest' };
        state.raiders = [{
          id: 'roamer-level-e2e', kindId: 'poacher',
          x: player.x + offset, y: player.y, hp: 40, maxHp: 40, level: roamerLevel,
          targetBuildingId: null, nextAttackTick: 0,
          roaming: true, homeX: player.x + offset, homeY: player.y,
        }];
        store.put({ meta: { ...save.meta, appVersion: 'e2e', savedAt: Date.now() }, state }, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  }, { player: PLAYER, offset: offsetX, roamerLevel: level });
  await page.reload();
  await waitForDebugHandles(page);
  await expect(page.locator('[data-action-button]')).toBeVisible();
}

/** The live roamer and its level plate, read together so neither is stale. */
async function readRoamer(page: Page): Promise<{ x: number; level: number; plate: string | null } | null> {
  return page.evaluate(() => {
    const scene = (globalThis as any).__game.scene.getScene('world');
    const roamer = scene.state.raiders.find((candidate: any) => candidate.id === 'roamer-level-e2e');
    if (!roamer) return null;
    const plate = scene.levelPlates.get('roamer-level-e2e');
    return { x: roamer.x, level: roamer.level, plate: plate ? plate.text : null };
  });
}

test('a hostile inside its aggression zone chases, and wears its level above it', async ({ page }) => {
  // A Poacher's zone is 144px; two tiles inside it is unambiguously within.
  await seedRoamer(page, 112, 3);
  const seeded = await readRoamer(page);
  expect(seeded).not.toBeNull();
  expect(seeded!.level).toBe(3);

  // The plate says what the simulation says, so a player can read the fight
  // before they take it.
  await expect.poll(async () => (await readRoamer(page))?.plate, { timeout: 15_000, intervals: [250] })
    .toBe('Lv 3');

  // And it closes the distance on its own, with the player standing still.
  await expect.poll(async () => (await readRoamer(page))?.x, { timeout: 15_000, intervals: [250] })
    .toBeLessThan(seeded!.x);
});

test('a hostile outside its aggression zone stays where it is', async ({ page }) => {
  // Well past the Poacher's 144px zone, and past its leash from home too.
  await seedRoamer(page, 320, 1);
  const seeded = await readRoamer(page);
  expect(seeded).not.toBeNull();

  // Given the same wall-clock time the chase test needs, it still has not moved.
  await page.waitForTimeout(3_000);
  expect((await readRoamer(page))!.x).toBe(seeded!.x);
});
