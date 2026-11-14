import { BAG_ITEM_LABELS, BLUEPRINT_BALANCE, INTERACTION_RANGE_PX } from '../config/balance';
import { BLUEPRINT_QUALITY_WEIGHTS } from '../content/blueprintQuality';
import { coordinateHash } from './biomes';
import { creditCoins } from './coins';
import { addGroundDrop, tryAddResource, type CommandResult } from './gameplayCommands';
import { resolveBlueprintFind, stormCacheBlueprint } from './blueprintFinds';
import { knowsBlueprint, learnBlueprint } from './blueprintKnowledge';
import { openingSideCacheId, openingSupplyCacheId } from '../content/onboarding';
import { openOpeningSideCache, recoverOpeningSupplies } from './openingSupplyRun';
import type {
  EditableBlueprintBalance, GameState, ResourceId, WorldContainerKind, WorldContainerState,
} from './state';

/**
 * Findable world containers.
 *
 * Contents are never persisted. A container's save footprint is one boolean,
 * and what is inside is re-derived from its stable id whenever it is opened, so
 * the same seed always yields the same cache and a save file cannot be edited
 * to reroll one. Opening is one-shot: the container stays in the world as an
 * emptied prop rather than disappearing, so a player can see where they have
 * already been.
 */

/**
 * Paid by a blueprint container once every blueprint is already known. Without
 * this a late-game cellar would quietly stop being worth the walk.
 */
export const EXHAUSTED_BLUEPRINT_COINS = 40;

interface LootEntry {
  readonly resource: ResourceId;
  readonly min: number;
  readonly max: number;
}

interface ContainerProfile {
  readonly label: string;
  /** Every entry is granted; ranges keep two caches of a kind from feeling identical. */
  readonly loot: readonly LootEntry[];
  readonly coinsMin: number;
  readonly coinsMax: number;
  /** Whether this kind can carry a blueprint at all. */
  readonly blueprint: boolean;
}

const PROFILES: Readonly<Record<WorldContainerKind, ContainerProfile>> = {
  'hollow-log': {
    label: 'Hollow Log',
    loot: [
      { resource: 'fiber', min: 4, max: 9 },
      { resource: 'berry', min: 2, max: 5 },
    ],
    coinsMin: 0,
    coinsMax: 0,
    blueprint: false,
  },
  'supply-cache': {
    label: 'Supply Cache',
    loot: [
      { resource: 'arrow', min: 4, max: 10 },
      { resource: 'cloth-mask', min: 1, max: 2 },
      { resource: 'iron-ore', min: 2, max: 5 },
    ],
    coinsMin: 15,
    coinsMax: 45,
    blueprint: false,
  },
  'collapsed-cellar': {
    label: 'Collapsed Cellar',
    loot: [
      { resource: 'iron-ingot', min: 2, max: 4 },
      { resource: 'taming-snare', min: 1, max: 3 },
    ],
    coinsMin: 60,
    coinsMax: 140,
    // Worth crossing a region for rather than being another pile of materials.
    blueprint: true,
  },
  // Scattered by an arcane storm and gone when it passes. The storm night has
  // nothing to fight, so these are what it is for: the only routine source of a
  // Legendary, guarded by an event that hurts anyone who stands still.
  'storm-cache': {
    label: 'Arcane Cache',
    loot: [
      { resource: 'iron-ore', min: 3, max: 7 },
      { resource: 'draft-parchment', min: 1, max: 3 },
    ],
    coinsMin: 30,
    coinsMax: 90,
    blueprint: true,
  },
};

export function containerLabel(kind: WorldContainerKind): string {
  return PROFILES[kind].label;
}

export interface ContainerContents {
  readonly resources: ReadonlyArray<readonly [ResourceId, number]>;
  readonly coins: number;
  /** Whether this kind carries a blueprint at all, regardless of what is left to learn. */
  readonly carriesBlueprint: boolean;
  /**
   * The unlockable this container teaches. Null when the kind carries no
   * blueprint, and also when the player already owns every unlockable — the
   * pool is drawn from what they have not learned, so a blueprint is never a
   * duplicate, it simply runs out.
   */
  readonly blueprintItemId: string | null;
}

/**
 * Resolve one container's contents. Pure: same container id and area seed
 * always produce the same result, and nothing here touches `state.rngState`, so
 * opening a cache never perturbs the encounter/gather RNG stream.
 */
export function containerContents(
  container: WorldContainerState,
  areaSeed: number,
  unlockedItemIds: readonly string[] = [],
  blueprints: EditableBlueprintBalance = BLUEPRINT_BALANCE,
): ContainerContents {
  const profile = PROFILES[container.kind];
  // coordinateHash's final XOR is signed, so it can return a negative value.
  // Fold it into [0,1) before use, exactly as describeArea does.
  const hash = (salt: number, index: number) => {
    const raw = coordinateHash((areaSeed ^ salt) >>> 0, container.x + index, container.y - index);
    return ((raw % 1) + 1) % 1;
  };
  const between = (value: number, min: number, max: number) => min + Math.floor(value * (max - min + 1));

  const resources = profile.loot.map((entry, index) => [
    entry.resource,
    Math.max(1, Math.min(entry.max, between(hash(0x4c4f_4f54, index), entry.min, entry.max))),
  ] as const);

  const coins = profile.coinsMax > 0
    ? between(hash(0x434f_494e, 0), profile.coinsMin, profile.coinsMax)
    : 0;

  return {
    resources,
    coins,
    carriesBlueprint: profile.blueprint,
    blueprintItemId: profile.blueprint
      ? pickContainerBlueprint(container.kind, blueprints, unlockedItemIds, hash(0x424c_5052, 0), hash(0x5449_4552, 0))
      : null,
  };
}

/**
 * What a container's blueprint slot is holding.
 *
 * A cellar always holds one and draws from everything below Legendary: it is
 * the generalist source, the reward for exploring rather than for surviving
 * anything. A storm cache draws from the storm pool and may hold nothing at
 * all — a guaranteed Legendary route would make the storm an errand, and the
 * point of walking through one is that it might not have been worth it.
 */
function pickContainerBlueprint(
  kind: WorldContainerKind,
  blueprints: EditableBlueprintBalance,
  unlockedItemIds: readonly string[],
  roll: number,
  tierRoll: number,
): string | null {
  if (kind === 'storm-cache') {
    return stormCacheBlueprint(blueprints, unlockedItemIds, roll, tierRoll);
  }
  return resolveBlueprintFind(
    unlockedItemIds, 'cellar', BLUEPRINT_QUALITY_WEIGHTS, roll, { allowDuplicate: false },
  );
}

export function nearestUnopenedContainer(
  state: GameState,
  range = INTERACTION_RANGE_PX,
): WorldContainerState | null {
  let nearest: WorldContainerState | null = null;
  let nearestDistance = range;
  for (const container of state.containers) {
    if (container.opened) continue;
    const distance = Math.hypot(container.x - state.player.x, container.y - state.player.y);
    if (distance <= nearestDistance) {
      nearest = container;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Open the nearest unopened container. Anything the bag cannot take falls at
 * the container's feet as an ordinary ground drop, exactly as an over-full
 * gather or creature defeat does — so a full bag costs the player a second trip
 * rather than the reward.
 */
export function openNearestContainer(state: GameState, range = INTERACTION_RANGE_PX): CommandResult {
  const container = nearestUnopenedContainer(state, range);
  if (!container) return { ok: false, message: 'Move closer to an unopened container' };
  if (container.id === openingSupplyCacheId(state.seed)) return recoverOpeningSupplies(state);
  if (container.id === openingSideCacheId(state.seed)) return openOpeningSideCache(state);

  const contents = containerContents(
    container, state.currentArea.seed, state.unlockedItemIds, state.gameBalance.blueprints,
  );
  container.opened = true;

  const found: string[] = [];
  for (const [resource, amount] of contents.resources) {
    if (amount <= 0) continue;
    if (!tryAddResource(state, resource, amount)) addGroundDrop(state, resource, amount, container.x, container.y);
    found.push(`+${amount} ${BAG_ITEM_LABELS[resource]}`);
  }
  if (contents.coins > 0) {
    creditCoins(state, contents.coins, `+${contents.coins} coins`);
    found.push(`+${contents.coins} coins`);
  }
  if (contents.carriesBlueprint) {
    // knowsBlueprint is still checked because unlockedItemIds could have grown
    // between resolving contents and applying them in a future caller.
    if (contents.blueprintItemId && !knowsBlueprint(state, contents.blueprintItemId)) {
      learnBlueprint(state, contents.blueprintItemId);
      found.push(`Blueprint: ${contents.blueprintItemId.replace(/-/g, ' ')}`);
    } else {
      creditCoins(state, EXHAUSTED_BLUEPRINT_COINS, `+${EXHAUSTED_BLUEPRINT_COINS} coins`);
      found.push(`+${EXHAUSTED_BLUEPRINT_COINS} coins`);
    }
  }

  const label = containerLabel(container.kind);
  return {
    ok: true,
    message: found.length > 0 ? `${label} opened · ${found.join(' · ')}` : `${label} was empty`,
    targetId: container.id,
  };
}
