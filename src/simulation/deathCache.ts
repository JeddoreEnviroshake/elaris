import { INTERACTION_RANGE_PX } from '../config/balance';
import { TILE_SIZE } from '../config/platform';
import { inventoryCapacity } from './characterProgression';
import { tryAddResource, usedInventorySlots, type CommandResult } from './gameplayCommands';
import type { DeathCacheState, GameState, ResourceId, ToolInstance } from './state';

/**
 * The bag you drop when you die, and the run back for it.
 *
 * Defeat charges the trip, not the inventory. Everything a Safeguard Charm did
 * not save is stacked where the player fell, a beacon is lit on the map, and a
 * countdown starts. Ten minutes is long enough to reach the spot from anywhere
 * a player can reasonably die and short enough that the decision has to be made
 * now — which is the whole point of a beacon rather than a mailbox.
 *
 * Carried blueprints keep their own drops (see carriedBlueprints) rather than
 * being folded in here. They lie at the same coordinates under the same ten
 * minutes, so the beacon covers both, and the raider heat a loose blueprint
 * radiates keeps working untouched.
 */

/**
 * How long the cache lies there: ten minutes at the fixed 60 Hz tick.
 *
 * Deliberately the same deadline a dropped blueprint gets. One death scatters
 * both, in one place, and a player counting down to their bag must never find
 * the paper gone first.
 */
export const DEATH_CACHE_TTL_TICKS = 10 * 60 * 60;

/** What the cache holds, as one flat list for the UI to count and name. */
export interface DeathCacheItemView {
  label: string;
  amount: number;
}

export interface DeathCacheView {
  cache: DeathCacheState;
  /** Whole seconds before it is gone for good. */
  secondsRemaining: number;
  /** `9:07`, the same countdown format the survival timer uses. */
  label: string;
  itemCount: number;
  items: DeathCacheItemView[];
  /** True while the player is standing in the region the beacon marks. */
  inCurrentArea: boolean;
  /** Tile coordinates, which is how the player reads position everywhere else. */
  tileX: number;
  tileY: number;
}

/**
 * Stack the losses where the player fell and light the beacon.
 *
 * Takes what was lost rather than reading the bag, because the caller has
 * already decided what the charms saved. An empty loss lights nothing: a
 * beacon over an empty patch of grass would send a player on a run for
 * nothing, which is worse than no beacon at all.
 *
 * A previous cache is replaced. Two would let a player bank losses and turn one
 * legible deadline into a list of them.
 */
export function stashDeathCache(
  state: GameState,
  resources: Partial<Record<ResourceId, number>>,
  tools: readonly ToolInstance[],
): DeathCacheState | null {
  const kept = Object.entries(resources).filter(([, amount]) => (amount ?? 0) > 0) as Array<[ResourceId, number]>;
  if (kept.length === 0 && tools.length === 0) {
    state.deathCache = null;
    return null;
  }

  const cache: DeathCacheState = {
    id: `death-cache-${state.nextEntityId}`,
    areaKey: state.currentArea.key,
    areaName: state.currentArea.name,
    areaX: state.currentArea.x,
    areaY: state.currentArea.y,
    x: Math.round(state.player.x),
    y: Math.round(state.player.y),
    resources: Object.fromEntries(kept),
    tools: tools.map((tool) => ({ ...tool })),
    createdAtTick: state.tick,
    expiresAtTick: state.tick + DEATH_CACHE_TTL_TICKS,
  };
  state.nextEntityId += 1;
  state.deathCache = cache;
  return cache;
}

/** How many things are in the cache: one per tool, one per resource kind. */
export function deathCacheItemCount(cache: DeathCacheState): number {
  return cache.tools.length + Object.values(cache.resources).filter((amount) => (amount ?? 0) > 0).length;
}

/** The beacon as the map, the respawn screen, and the HUD all read it. */
export function deathCacheView(state: GameState): DeathCacheView | null {
  const cache = state.deathCache;
  if (!cache) return null;
  const secondsRemaining = Math.max(0, Math.ceil((cache.expiresAtTick - state.tick) / 60));
  const items: DeathCacheItemView[] = [
    ...cache.tools.map((tool) => ({ label: tool.definitionId.replace(/-/g, ' '), amount: 1 })),
    ...(Object.entries(cache.resources) as Array<[ResourceId, number]>)
      .filter(([, amount]) => amount > 0)
      .map(([resource, amount]) => ({ label: resource.replace(/-/g, ' '), amount })),
  ];
  return {
    cache,
    secondsRemaining,
    label: `${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, '0')}`,
    itemCount: deathCacheItemCount(cache),
    items,
    inCurrentArea: cache.areaKey === state.currentArea.key,
    tileX: Math.floor(cache.x / TILE_SIZE),
    tileY: Math.floor(cache.y / TILE_SIZE),
  };
}

/** The cache when the player is standing over it, or null. */
export function deathCacheInReach(state: GameState, range = INTERACTION_RANGE_PX): DeathCacheState | null {
  const cache = state.deathCache;
  if (!cache || cache.areaKey !== state.currentArea.key) return null;
  return Math.hypot(cache.x - state.player.x, cache.y - state.player.y) <= range ? cache : null;
}

/**
 * Take back what fits, and leave the rest lying there.
 *
 * Partial recovery is the honest answer to a full bag: refusing outright would
 * make a player who died holding one stack too many watch the whole cache
 * expire, and emptying it into an overflowing bag would quietly delete the
 * remainder. Tools come out first — a tool is hours of durability and a rank
 * ladder, where a stack of wood is a walk to the nearest tree.
 */
export function recoverDeathCache(state: GameState, range = INTERACTION_RANGE_PX): CommandResult {
  const cache = state.deathCache;
  if (!cache) return { ok: false, message: 'Nothing of yours is waiting' };
  if (cache.areaKey !== state.currentArea.key) {
    return { ok: false, message: `Your cache is in ${cache.areaName}` };
  }
  if (!deathCacheInReach(state, range)) return { ok: false, message: 'Move closer to your cache' };

  let recovered = 0;
  while (cache.tools.length > 0 && usedInventorySlots(state) < inventoryCapacity(state)) {
    state.tools.push(cache.tools.shift()!);
    recovered += 1;
  }
  for (const [resource, amount] of Object.entries(cache.resources) as Array<[ResourceId, number]>) {
    if (amount <= 0) {
      delete cache.resources[resource];
      continue;
    }
    if (!tryAddResource(state, resource, amount)) continue;
    delete cache.resources[resource];
    recovered += 1;
  }

  const remaining = deathCacheItemCount(cache);
  if (remaining === 0) state.deathCache = null;
  if (recovered === 0) return { ok: false, message: 'Bag is full', targetId: cache.id };
  return {
    ok: true,
    message: remaining === 0
      ? `Recovered your cache — ${recovered} item${recovered === 1 ? '' : 's'}`
      : `Recovered ${recovered} item${recovered === 1 ? '' : 's'} · ${remaining} left in the cache`,
    targetId: cache.id,
  };
}

/**
 * Sweep the cache once its ten minutes are up. Returns true when something was
 * lost this tick, so the caller knows the save is dirty.
 */
export function advanceDeathCacheExpiry(state: GameState): boolean {
  const cache = state.deathCache;
  if (!cache || state.tick < cache.expiresAtTick) return false;
  state.deathCache = null;
  return true;
}
