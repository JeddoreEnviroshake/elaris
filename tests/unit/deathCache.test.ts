import { describe, expect, it } from 'vitest';
import { INVENTORY_SLOTS, INTERACTION_RANGE_PX, RESOURCE_STACK_SIZE } from '../../src/config/balance';
import {
  DEATH_CACHE_TTL_TICKS,
  advanceDeathCacheExpiry,
  deathCacheInReach,
  deathCacheItemCount,
  deathCacheView,
  recoverDeathCache,
} from '../../src/simulation/deathCache';
import { beginPlayerDefeat, chooseRespawn } from '../../src/simulation/survivalCycle';
import { collectNearestGroundDrop, usedInventorySlots } from '../../src/simulation/gameplayCommands';
import { reconcileResourceStacks } from '../../src/simulation/inventoryStacks';
import { createInitialState, type GameState, type ToolInstance } from '../../src/simulation/state';

function makeTool(instanceId: string, definitionId: ToolInstance['definitionId'] = 'stone-axe'): ToolInstance {
  return {
    instanceId,
    definitionId,
    durability: 40,
    maxDurability: 60,
    powerRank: 0,
    speedRank: 0,
    durabilityRank: 0,
  };
}

/** A player carrying something worth losing, standing somewhere specific. */
function loaded(): GameState {
  const state = createInitialState(7);
  state.player.x = 600;
  state.player.y = 480;
  // The starting berries and arrows are cleared so every assertion below is
  // about what this fixture put in the bag, not the new-character kit.
  state.inventory.berry = 0;
  state.inventory.arrow = 0;
  state.inventory.wood = 30;
  state.inventory.stone = 12;
  for (const resource of ['berry', 'arrow', 'wood', 'stone'] as const) reconcileResourceStacks(state, resource);
  state.tools = [makeTool('tool-1'), makeTool('tool-2', 'stone-pick')];
  state.equippedToolId = 'tool-1';
  return state;
}

describe('death cache', () => {
  it('leaves the bag where the player fell instead of destroying it', () => {
    const state = loaded();
    const result = beginPlayerDefeat(state, 'raider');

    // The bag is still emptied — the cost of dying is the walk back.
    expect(state.inventory.wood).toBe(0);
    expect(state.tools).toEqual([]);
    expect(state.equippedToolId).toBeNull();
    expect(result.lostItemCount).toBe(30 + 12 + 2);

    const cache = state.deathCache!;
    expect(cache.x).toBe(600);
    expect(cache.y).toBe(480);
    expect(cache.areaKey).toBe(state.currentArea.key);
    expect(cache.resources).toEqual({ wood: 30, stone: 12 });
    expect(cache.tools.map((tool) => tool.instanceId)).toEqual(['tool-1', 'tool-2']);
    // Durability and ranks come back exactly as they went in.
    expect(cache.tools[0]!.durability).toBe(40);
    expect(cache.expiresAtTick - cache.createdAtTick).toBe(DEATH_CACHE_TTL_TICKS);
  });

  it('gives ten in-game minutes, counted from the death tick', () => {
    const state = loaded();
    state.tick = 1_000;
    beginPlayerDefeat(state);
    expect(DEATH_CACHE_TTL_TICKS).toBe(10 * 60 * 60);

    const view = deathCacheView(state)!;
    expect(view.secondsRemaining).toBe(600);
    expect(view.label).toBe('10:00');

    state.tick += 53 * 60;
    expect(deathCacheView(state)!.label).toBe('9:07');
  });

  it('holds the cache while the respawn screen is up, then expires on the tick', () => {
    const state = loaded();
    beginPlayerDefeat(state);
    // The simulation is frozen until a destination is chosen, so the timer
    // genuinely starts when the player awakens rather than while they read.
    expect(chooseRespawn(state, 'elaris-sanctuary').ok).toBe(true);
    expect(deathCacheView(state)!.secondsRemaining).toBe(600);

    state.tick += DEATH_CACHE_TTL_TICKS - 1;
    expect(advanceDeathCacheExpiry(state)).toBe(false);
    expect(state.deathCache).not.toBeNull();

    state.tick += 1;
    expect(advanceDeathCacheExpiry(state)).toBe(true);
    expect(state.deathCache).toBeNull();
    expect(deathCacheView(state)).toBeNull();
  });

  it('lights no beacon when a full purse of charms saved everything', () => {
    const state = createInitialState(3);
    state.inventory.wood = 5;
    reconcileResourceStacks(state, 'wood');
    state.inventory['safeguard-charm'] = 4;
    reconcileResourceStacks(state, 'safeguard-charm');

    const result = beginPlayerDefeat(state);
    expect(result.lostItemCount).toBe(0);
    expect(state.inventory.wood).toBe(5);
    expect(state.deathCache).toBeNull();
  });

  it('is only recoverable in the region that holds it, and only up close', () => {
    const state = loaded();
    beginPlayerDefeat(state);
    chooseRespawn(state, 'elaris-sanctuary');
    const cache = state.deathCache!;

    state.player.x = cache.x + INTERACTION_RANGE_PX * 3;
    state.player.y = cache.y;
    expect(deathCacheInReach(state)).toBeNull();
    expect(recoverDeathCache(state).message).toBe('Move closer to your cache');

    state.player.x = cache.x;
    expect(deathCacheInReach(state)).not.toBeNull();
    const result = recoverDeathCache(state);
    expect(result.ok).toBe(true);
    expect(state.inventory.wood).toBe(30);
    expect(state.tools.map((tool) => tool.instanceId)).toEqual(['tool-1', 'tool-2']);
    expect(state.deathCache).toBeNull();
  });

  it('refuses across regions and names where the cache is', () => {
    const state = loaded();
    beginPlayerDefeat(state);
    state.currentArea = { ...state.currentArea, key: '1,0', x: 1, name: 'Verdant Reach' };

    expect(deathCacheInReach(state)).toBeNull();
    expect(deathCacheView(state)!.inCurrentArea).toBe(false);
    expect(recoverDeathCache(state).message).toContain('Elaris');
  });

  it('takes what fits and leaves the rest lying there', () => {
    const state = loaded();
    beginPlayerDefeat(state);
    chooseRespawn(state, 'elaris-sanctuary');
    const cache = state.deathCache!;
    state.player.x = cache.x;
    state.player.y = cache.y;

    // Fill the bag to one free slot, so exactly one thing can come back.
    state.tools = [];
    state.inventory.berry = RESOURCE_STACK_SIZE * (INVENTORY_SLOTS - 1);
    reconcileResourceStacks(state, 'berry');
    expect(usedInventorySlots(state)).toBe(INVENTORY_SLOTS - 1);

    const result = recoverDeathCache(state);
    expect(result.ok).toBe(true);
    // Tools first: hours of durability outrank a stack of wood.
    expect(state.tools.map((tool) => tool.instanceId)).toEqual(['tool-1']);
    expect(state.deathCache).not.toBeNull();
    expect(deathCacheItemCount(state.deathCache!)).toBe(3);

    // A second attempt with no room at all reports the bag rather than
    // silently emptying the cache into nowhere.
    const blocked = recoverDeathCache(state);
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toBe('Bag is full');
    expect(deathCacheItemCount(state.deathCache!)).toBe(3);
  });

  it('answers the collect button ahead of loose drops', () => {
    const state = loaded();
    beginPlayerDefeat(state);
    chooseRespawn(state, 'elaris-sanctuary');
    const cache = state.deathCache!;
    state.player.x = cache.x;
    state.player.y = cache.y;
    state.groundDrops.push({
      id: 'drop-test', resource: 'fiber', amount: 3,
      x: cache.x, y: cache.y, expiresAtTick: null,
    });

    const result = collectNearestGroundDrop(state);
    expect(result.ok).toBe(true);
    expect(state.deathCache).toBeNull();
    // The loose fiber is still there: one press takes the cache, not both.
    expect(state.groundDrops).toHaveLength(1);
  });

  it('replaces a previous cache rather than banking two of them', () => {
    const state = loaded();
    beginPlayerDefeat(state);
    chooseRespawn(state, 'elaris-sanctuary');
    const first = state.deathCache!.id;

    state.inventory.fiber = 4;
    reconcileResourceStacks(state, 'fiber');
    state.player.x = 200;
    state.player.y = 200;
    beginPlayerDefeat(state, 'creature');

    expect(state.deathCache!.id).not.toBe(first);
    expect(state.deathCache!.resources).toEqual({ fiber: 4 });
    expect(state.deathCache!.x).toBe(200);
  });
});
