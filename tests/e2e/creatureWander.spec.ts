import { releaseSaveWriter } from './save';
import { expect, test, type Page } from '@playwright/test';
import { openApp, waitForDebugHandles, reloadApp } from './app';
import { tapWorld } from './interact';

/**
 * Wild creatures as live inhabitants, asserted through the browser.
 *
 * The unit suite already proves the wander rules; what only a real page can
 * show is that the world the player looks at agrees with the world the
 * simulation is running. Creature sprites used to be repositioned only when the
 * roster changed, so a creature could walk the whole map in state while its
 * picture stayed on the spawn point.
 *
 * State is read from IndexedDB rather than from toasts, and the sprite is read
 * from the scene, so neither assertion depends on a transient message.
 */

const PLAYER = { x: 40 * 16, y: 40 * 16 };

async function readState(page: Page): Promise<Record<string, any>> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(document.documentElement.dataset.worldDatabase ?? 'elaris:default', 1);
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
 * One creature in an otherwise empty world, far enough from the player that
 * nothing here is a chase — a creature that moved because it was hunting would
 * prove the old behavior, not the new one.
 */
async function seedIdleCreature(
  page: Page,
  loadout: { definitionId: string; arrows: number } | null = null,
  /** Offset from the player, so a test can park the creature inside bow range. */
  offset: { x: number; y: number } = { x: 160, y: -160 },
): Promise<void> {
  await openApp(page);
  await waitForDebugHandles(page);
  // Hand the writer lease back before seeding. The controller flushes the live
  // state on `pagehide`, so a fixture written and then reloaded straight into
  // that flush is silently overwritten by the world it was meant to replace —
  // and a save the migrator rejects falls back to `lastKnownGood` without a
  // word, which is a fixture that appears to load and quietly is not there.
  await page.evaluate(async () => { await (globalThis as any).__controller.flushAndRelease(); });
  await releaseSaveWriter(page);
  await page.evaluate(async ({ player, loadout: gear, place }) => {
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
        const save = request.result as { meta: Record<string, unknown>; state: Record<string, any> };
        const state = save.state;
        state.player.x = player.x;
        state.player.y = player.y;
        state.player.stamina = state.player.maxStamina;
        state.actionCooldownUntilTick = 0;
        state.buildings = [];
        state.resourceNodes = [];
        state.groundDrops = [];
        state.raiders = [];
        // A Glade Stag: the widest wander radius on the roster, so the movement
        // is unmistakable within a few seconds of real time. Two tiles off the
        // player is inside nothing — its aggro range is zero.
        const home = { x: player.x + place.x, y: player.y + place.y };
        state.wildCreatures = [{
          id: 'wander-e2e', speciesId: 'glade-stag',
          x: home.x, y: home.y, hp: 46, maxHp: 46,
          homeX: home.x, homeY: home.y,
          aggroUntilTick: 0, nextAttackTick: 0, fleeUntilTick: 0,
          captureBonusBps: 0, encounterCooldownUntilTick: 0, level: 1,
        }];
        if (gear) {
          state.inventory = { ...state.inventory, arrow: gear.arrows };
          state.inventoryStacks = {
            ...state.inventoryStacks,
            arrow: gear.arrows > 0 ? [gear.arrows] : [],
          };
          state.tools = [{
            instanceId: 'tool-e2e-weapon', definitionId: gear.definitionId,
            durability: 120, maxDurability: 120,
            powerRank: 0, speedRank: 0, durabilityRank: 0,
          }];
          state.equippedToolId = 'tool-e2e-weapon';
        }
        store.put({ meta: { ...save.meta, appVersion: 'e2e', savedAt: Date.now() }, state }, 'current');
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  }, { player: PLAYER, loadout, place: offset });
  await reloadApp(page);
  await waitForDebugHandles(page);
  await expect(page.locator('[data-action-button]')).toBeVisible();
}

test('an unprovoked creature wanders its patch and its sprite follows', async ({ page }) => {
  await seedIdleCreature(page);
  const seeded = await readState(page);
  expect(seeded.wildCreatures?.[0]?.id).toBe('wander-e2e');
  const home = { x: seeded.wildCreatures[0].homeX, y: seeded.wildCreatures[0].homeY };

  // It leaves the spawn point on its own, with the player standing still.
  await expect.poll(async () => {
    const state = await readState(page);
    const creature = state.wildCreatures[0];
    return Math.hypot(creature.x - home.x, creature.y - home.y);
  }, { timeout: 30_000, intervals: [500] }).toBeGreaterThan(8);

  // And it stays inside its own territory rather than walking off the screen.
  const roaming = await readState(page);
  const wandered = roaming.wildCreatures[0];
  expect(Math.hypot(wandered.x - home.x, wandered.y - home.y)).toBeLessThanOrEqual(160);
  // Never aggroed: this is the world moving, not the world reacting.
  expect(wandered.aggroUntilTick).toBe(0);

  // The picture agrees with the simulation. Sprite and creature are read in the
  // same evaluate, because the creature is still walking: comparing a live
  // sprite against the saved snapshot would measure how stale the snapshot is,
  // not whether the sprite is following. A sprite left behind at the spawn
  // point is exactly the bug this guards.
  const pose = await page.evaluate(() => {
    const scene = (globalThis as any).__game.scene.getScene('world');
    const creature = scene.state.wildCreatures.find((candidate: any) => candidate.id === 'wander-e2e');
    const sprite = (globalThis as any).__renderer3d.creatureRigs.get('wander-e2e')?.root;
    return creature && sprite
      ? { creature: { x: creature.x, y: creature.y }, sprite: { x: sprite.position.x * 16, y: sprite.position.z * 16 } }
      : null;
  });
  expect(pose).not.toBeNull();
  expect(Math.hypot(pose!.sprite.x - pose!.creature.x, pose!.sprite.y - pose!.creature.y))
    .toBeLessThanOrEqual(8);
  // And it is genuinely off its spawn point in the live world too, so the
  // sprite is tracking a creature that moved rather than one that never did.
  expect(Math.hypot(pose!.creature.x - home.x, pose!.creature.y - home.y)).toBeGreaterThan(8);
});

/**
 * What the loadout actually is once the world has booted. Read from the live
 * scene rather than from IndexedDB: the app writes its own snapshot during boot,
 * so a read of the persisted save immediately after the reload races that write
 * and can return the pre-fixture state.
 */
async function equippedLoadout(page: Page): Promise<{ equipped: string | null; raiders: number }> {
  return page.evaluate(() => {
    const state = (globalThis as any).__game.scene.getScene('world').state;
    return { equipped: state.equippedToolId, raiders: state.raiders.length };
  });
}

test('the action button reads Shoot whenever a bow is in hand', async ({ page }) => {
  // No raider anywhere in the world: the bow alone decides the label. Before
  // this the button said "Gather" outside a raid, promising a swing the bow's
  // damage table cannot make — its only row is `raider`.
  await seedIdleCreature(page, { definitionId: 'bow', arrows: 20 });
  expect(await equippedLoadout(page)).toEqual({ equipped: 'tool-e2e-weapon', raiders: 0 });

  await expect(page.locator('[data-action-button]')).toHaveText('Shoot');
});

test('the action button still reads Gather with a gathering tool in hand', async ({ page }) => {
  await seedIdleCreature(page, { definitionId: 'stone-axe', arrows: 0 });
  expect(await equippedLoadout(page)).toEqual({ equipped: 'tool-e2e-weapon', raiders: 0 });

  await expect(page.locator('[data-action-button]')).toHaveText('Gather');
});

/**
 * The creature as the simulation currently has it. Read live for the same
 * reason `equippedLoadout` is: a wild creature is walking, and the persisted
 * snapshot lags it by a debounce.
 */
async function liveCreature(page: Page): Promise<{ hp: number; aggroUntilTick: number; arrows: number }> {
  return page.evaluate(() => {
    const state = (globalThis as any).__game.scene.getScene('world').state;
    const creature = state.wildCreatures.find((candidate: any) => candidate.id === 'wander-e2e');
    return { hp: creature.hp, aggroUntilTick: creature.aggroUntilTick, arrows: state.inventory.arrow };
  });
}

test('tapping a placid creature attacks it instead of opening a taming session', async ({ page }) => {
  // A Glade Stag is placid: it used to be untouchable in the overworld, because
  // a tap on one opened the taming panel and the action button refused to
  // auto-acquire it. Two tiles away, well inside a sword's reach.
  await seedIdleCreature(page, { definitionId: 'iron-sword', arrows: 0 }, { x: 32, y: 0 });
  const before = await liveCreature(page);
  expect(before.hp).toBe(46);

  await tapWorld(page, { x: PLAYER.x + 32, y: PLAYER.y }, PLAYER);

  // Struck, provoked, and emphatically not a dialog.
  await expect.poll(async () => (await liveCreature(page)).hp, { timeout: 10_000, intervals: [200] })
    .toBeLessThan(46);
  expect((await liveCreature(page)).aggroUntilTick).toBeGreaterThan(0);
  await expect(page.getByRole('dialog', { name: 'Wild creature encounter' })).toHaveCount(0);
  // And the tap locked it, so the thumb button now names what it will hit.
  await expect(page.locator('[data-action-button]')).toHaveAttribute('data-combat-target', /^creature:/);
});

test('a bow shoots a creature at range, spending an arrow per hit', async ({ page }) => {
  // Five tiles out: further than any swing reaches, so a hit here can only be
  // an arrow. The bow used to have nothing to shoot but raiders.
  await seedIdleCreature(page, { definitionId: 'bow', arrows: 20 }, { x: 80, y: 0 });
  expect(await equippedLoadout(page)).toEqual({ equipped: 'tool-e2e-weapon', raiders: 0 });

  await tapWorld(page, { x: PLAYER.x + 80, y: PLAYER.y }, PLAYER);

  await expect.poll(async () => (await liveCreature(page)).hp, { timeout: 10_000, intervals: [200] })
    .toBeLessThan(46);
  expect((await liveCreature(page)).arrows).toBeLessThan(20);
  await expect(page.locator('[data-action-button]')).toHaveText(/Shoot Glade Stag/);
});
