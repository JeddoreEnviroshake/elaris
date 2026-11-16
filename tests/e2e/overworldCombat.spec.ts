import { releaseSaveWriter } from './save';
import { expect, test, type Page } from '@playwright/test';
import { openApp } from './app';

/**
 * The full overworld combat loop through the real UI: a hostile stands in the
 * world, the action button targets it, swings land, and the body leaves loot.
 *
 * Asserted against the saved state in IndexedDB rather than against toasts,
 * which are transient and race the assertion.
 */

const PLAYER = { x: 40 * 16, y: 40 * 16 };

async function readState(page: Page): Promise<Record<string, any>> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('elaris:default', 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return await new Promise<Record<string, any>>((resolve, reject) => {
      const transaction = db.transaction('snapshots', 'readonly');
      const request = transaction.objectStore('snapshots').get('current');
      request.onsuccess = () => resolve((request.result as { state: Record<string, any> }).state);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  });
}

/**
 * `loadout` decides what the fight is fought with: a sword in reach by default,
 * or a bow with arrows and the hostile parked further out, which is the only
 * way to exercise the ranged path (a hostile inside melee reach is struck by
 * whatever is in hand before the bow ever matters).
 */
async function seedRoamerFight(
  page: Page,
  hostile = { kindId: 'drifter', hp: 24 },
  loadout: { definitionId: string; durability: number; arrows: number; offsetX: number } =
    { definitionId: 'iron-sword', durability: 230, arrows: 0, offsetX: 12 },
): Promise<void> {
  await openApp(page);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.waitForTimeout(500);
  await releaseSaveWriter(page);
  await page.evaluate(async ({ player, hostile: kind, loadout: gear }) => {
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
        // Open ground, well away from town: melee refuses while the player is
        // sealed indoors, which is also true of the starting position.
        state.player.x = player.x;
        state.player.y = player.y;
        state.player.stamina = state.player.maxStamina;
        state.actionCooldownUntilTick = 0;
        state.buildings = [];
        state.resourceNodes = [];
        state.groundDrops = [];
        state.inventory = { ...state.inventory, fiber: 0, arrow: gear.arrows };
        state.inventoryStacks = {
          ...state.inventoryStacks,
          fiber: [],
          arrow: gear.arrows > 0 ? [gear.arrows] : [],
        };
        state.tools = [{
          instanceId: 'tool-e2e-weapon', definitionId: gear.definitionId,
          durability: gear.durability, maxDurability: gear.durability,
          powerRank: 0, speedRank: 0, durabilityRank: 0,
        }];
        state.equippedToolId = 'tool-e2e-weapon';
        state.raiders = [{
          id: 'roamer-e2e', kindId: kind.kindId,
          x: player.x + gear.offsetX, y: player.y, hp: kind.hp, maxHp: kind.hp, level: 1,
          targetBuildingId: null, nextAttackTick: 0,
          roaming: true, homeX: player.x + gear.offsetX, homeY: player.y,
        }];
        store.put({ meta: { ...save.meta, appVersion: 'e2e', savedAt: Date.now() }, state }, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  }, { player: PLAYER, hostile, loadout });
  await page.reload();
  await expect(page.locator('[data-action-button]')).toBeVisible();
}

test('a sword kills a roaming hostile through the action button and it drops loot', async ({ page }) => {
  await seedRoamerFight(page);

  // The fixture must actually have loaded; a rejected save silently falls back
  // to a fresh world, which would make every assertion below meaningless.
  const seeded = await readState(page);
  expect(seeded.raiders?.[0]?.id).toBe('roamer-e2e');

  const action = page.locator('[data-action-button]');
  await expect.poll(async () => {
    await action.click();
    await page.waitForTimeout(150);
    const state = await readState(page);
    return state.raiders.length;
  }, { timeout: 20_000, intervals: [200] }).toBe(0);

  const after = await readState(page);
  // Fighting feeds the supply line: a Drifter leaves fiber behind. It is
  // asserted as "on the ground or already in the bag" on purpose — the action
  // button collects a nearby drop once there is nothing left to fight, so
  // pinning it to the ground would race the player's own pickup.
  const droppedFiber = after.groundDrops.some((drop: { resource: string }) => drop.resource === 'fiber');
  expect(droppedFiber || after.inventory.fiber > 0).toBe(true);
  // And a bounty is paid for having taken the fight in person.
  expect(after.coins).toBeGreaterThan(0);
});

test('the bow keeps firing while the player walks with the action held', async ({ page }) => {
  // A Breaker is tanky enough to survive the whole burst, so the arrows spent
  // measure the fire rate rather than how fast the target died. It starts most
  // of the way out to the 6-tile shot range and the player walks *at* it, which
  // keeps it in range for the duration without needing it to give chase.
  await seedRoamerFight(page, { kindId: 'breaker', hp: 90 }, {
    definitionId: 'bow', durability: 120, arrows: 40, offsetX: 90,
  });
  const seeded = await readState(page);
  expect(seeded.raiders?.[0]?.id).toBe('roamer-e2e');
  expect(seeded.inventory.arrow).toBe(40);

  // Walk and fire at the same time: D holds the direction, E holds the shot.
  // Neither is released until the burst is over, so nothing here can be
  // mistaken for the player stopping to take each shot.
  await page.keyboard.down('d');
  await page.keyboard.down('e');
  await page.waitForTimeout(1_500);
  await page.keyboard.up('e');
  await page.keyboard.up('d');

  // Spending arrows is an ordinary change, so it reaches IndexedDB on the
  // save controller's debounce rather than immediately — polled, not read once.
  //
  // The shot cooldown is 24 ticks (~0.4s), so a held action across 1.5s of
  // walking is worth several arrows. Two would already prove the press
  // repeated; three keeps the assertion honest without being frame-rate bound.
  await expect.poll(async () => 40 - (await readState(page)).inventory.arrow, {
    timeout: 15_000,
    intervals: [500],
  }).toBeGreaterThanOrEqual(3);
  const after = await readState(page);
  expect(after.player.x).toBeGreaterThan(seeded.player.x);
});

test('the action button names the hostile once it is targeted', async ({ page }) => {
  // A Poacher survives a swing an iron sword would use to one-shot a Drifter,
  // so there is a live locked target to read the label off.
  await seedRoamerFight(page, { kindId: 'poacher', hp: 40 });
  const action = page.locator('[data-action-button]');

  await action.click();

  await expect(action).toHaveAttribute('data-combat-target', /^raider:/);
  await expect(action).toHaveText(/Strike Poacher/);
});
