import { describe, expect, it } from 'vitest';
import {
  GARDEN_BED_GROW_TICKS,
  GARDEN_BED_READY_CAP,
  GARDEN_BED_YIELD_FIBER,
  RESOURCE_STACK_SIZE,
} from '../../src/config/balance';
import { PLACEABLES } from '../../src/config/areaGates';
import { TILE_SIZE } from '../../src/config/platform';
import { starterBiomeAt } from '../../src/simulation/biomes';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import {
  advanceGardenBeds,
  describeGardenBed,
  harvestGardenBed,
  nearestGardenBed,
} from '../../src/simulation/gardenBeds';
import {
  buildableById,
  checkPlacement,
  placeBuilding,
  placeableLockedReason,
  validatePlacement,
} from '../../src/simulation/gameplayCommands';
import { inventoryCapacity } from '../../src/simulation/characterProgression';
import { buildableLockedReason } from '../../src/scenes/buildPlacement';
import { assertValidPortableSave, migrateToCurrent, SaveValidationError } from '../../src/persistence/migrations';
import { SAVE_VERSION } from '../../src/persistence/types';
import { createInitialState, type BuildingState, type GameState } from '../../src/simulation/state';

const SEED = 7;
const GARDEN_PLACEABLE = PLACEABLES.find((placeable) => placeable.id === 'garden-bed')!;

/** Center of a tile in source pixels. */
const tilePx = (tile: number) => tile * TILE_SIZE + TILE_SIZE / 2;

function wallsAround(left: number, top: number, width: number, height: number): BuildingState[] {
  const walls: BuildingState[] = [];
  let id = 1;
  for (let x = left; x < left + width + 2; x += 1) {
    walls.push({ id: `wall-${id++}`, definitionId: 'palisade-wall', tileX: x, tileY: top });
    walls.push({ id: `wall-${id++}`, definitionId: 'palisade-wall', tileX: x, tileY: top + height + 1 });
  }
  for (let y = top + 1; y < top + height + 1; y += 1) {
    walls.push({ id: `wall-${id++}`, definitionId: 'palisade-wall', tileX: left, tileY: y });
    walls.push({ id: `wall-${id++}`, definitionId: 'palisade-wall', tileX: left + width + 1, tileY: y });
  }
  return walls;
}

/**
 * A discovered, affordable state with an enclosed 4×2 (area 8, 2×2 core) work
 * yard on grassland just east of the spawn clearing, with the player inside.
 */
function stateWithYard(): GameState {
  const state = createInitialState(SEED);
  state.resourceNodes = [];
  state.buildings = wallsAround(83, 79, 4, 2); // interior tiles x 84..87, y 80..81
  state.player.x = tilePx(86);
  state.player.y = tilePx(81);
  state.highestAreaTierEver = 8;
  state.inventory.wood = 20;
  state.inventory.fiber = 10;
  return state;
}

function placeGardenBed(state: GameState): BuildingState {
  const result = placeBuilding(state, state.buildings, buildableById('garden-bed'), 84, 80);
  expect(result.ok).toBe(true);
  return result.building!;
}

/** Drive only ticks + garden growth, like the fixed loop does for an idle player. */
function advanceTicks(state: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    state.tick += 1;
    advanceGardenBeds(state);
  }
}

function portableSaveOf(state: GameState): unknown {
  return JSON.parse(JSON.stringify({
    meta: { saveVersion: SAVE_VERSION, worldGenVersion: 5, contentVersion: 13, appVersion: 'test', savedAt: 1 },
    state,
  }));
}

describe('garden bed unlock and placement', () => {
  it('stays locked below area tier 8 and unlocks exactly at it', () => {
    const state = stateWithYard();
    for (const tier of [0, 4] as const) {
      state.highestAreaTierEver = tier;
      expect(placeableLockedReason(state, GARDEN_PLACEABLE)).toMatch(/8-tile Shelter/);
      expect(buildableLockedReason(state, 'garden-bed')).toMatch(/8-tile Shelter/);
      const check = validatePlacement(state, state.buildings, buildableById('garden-bed'), 84, 80);
      expect(check).toMatchObject({ ok: false });
      expect(check.message).toMatch(/Locked/);
    }
    state.highestAreaTierEver = 8;
    expect(placeableLockedReason(state, GARDEN_PLACEABLE)).toBeNull();
    expect(buildableLockedReason(state, 'garden-bed')).toBeNull();
    expect(validatePlacement(state, state.buildings, buildableById('garden-bed'), 84, 80).ok).toBe(true);
  });

  it('requires grassland soil and a currently qualifying enclosed work yard, atomically', () => {
    const state = stateWithYard();
    expect(starterBiomeAt(SEED, tilePx(84), tilePx(80))).toBe('grassland');
    const def = buildableById('garden-bed');

    // Unenclosed grassland: discovery is permanent, but current geometry gates placement.
    const openState = stateWithYard();
    openState.buildings = [];
    expect(validatePlacement(openState, openState.buildings, def, 84, 80).message).toMatch(/Needs 8-tile area/);

    // Enclosed forest soil is rejected with the exact terrain reason.
    const forest = stateWithYard();
    forest.buildings = wallsAround(14, 14, 4, 2); // interior tiles x 15..18, y 15..16
    forest.player.x = tilePx(18);
    forest.player.y = tilePx(16);
    expect(starterBiomeAt(SEED, tilePx(15), tilePx(15))).toBe('forest');
    expect(validatePlacement(forest, forest.buildings, def, 15, 15).message).toBe('Requires open grassland soil');

    // A failed placement never consumes resources or mutates state.
    const before = canonicalizeGameState(forest);
    expect(placeBuilding(forest, forest.buildings, def, 15, 15).ok).toBe(false);
    expect(canonicalizeGameState(forest)).toBe(before);

    // The qualifying grassland yard accepts it and pays exactly once.
    const placed = placeGardenBed(state);
    expect(placed.garden).toEqual({ progressTicks: 0, readyFiber: 0, nextGrowthTick: state.tick + 60 });
    expect(state.inventory.wood).toBe(16);
    expect(state.inventory.fiber).toBe(8);
  });
});

describe('garden bed growth simulation', () => {
  it('produces one fiber batch after exactly the configured grow time', () => {
    const state = stateWithYard();
    const bed = placeGardenBed(state);

    advanceTicks(state, GARDEN_BED_GROW_TICKS - 1);
    expect(bed.garden!.readyFiber).toBe(0);
    expect(describeGardenBed(state, bed)).toMatchObject({ phase: 'growing' });

    advanceTicks(state, 1);
    expect(bed.garden!.readyFiber).toBe(GARDEN_BED_YIELD_FIBER);
    expect(bed.garden!.progressTicks).toBe(0);
    expect(state.resourcesCollected.fiber).toBe(GARDEN_BED_YIELD_FIBER);
    expect(describeGardenBed(state, bed)).toMatchObject({ phase: 'ready' });
  });

  it('is idempotent when advanced repeatedly with no elapsed time', () => {
    const state = stateWithYard();
    placeGardenBed(state);
    advanceTicks(state, 120);
    const before = canonicalizeGameState(state);
    advanceGardenBeds(state);
    advanceGardenBeds(state);
    expect(canonicalizeGameState(state)).toBe(before);
  });

  it('survives save/reload mid-cycle and continues identically', () => {
    const state = stateWithYard();
    placeGardenBed(state);
    advanceTicks(state, 1_500);

    const { save, migrated } = migrateToCurrent(portableSaveOf(state));
    expect(migrated).toBe(false);
    expect(canonicalizeGameState(save.state)).toBe(canonicalizeGameState(state));

    advanceTicks(state, GARDEN_BED_GROW_TICKS);
    advanceTicks(save.state, GARDEN_BED_GROW_TICKS);
    expect(canonicalizeGameState(save.state)).toBe(canonicalizeGameState(state));
  });

  it('suspends when the enclosure breaks and resumes without retroactive growth', () => {
    const state = stateWithYard();
    const bed = placeGardenBed(state);
    advanceTicks(state, 600);
    expect(bed.garden!.progressTicks).toBe(600);

    // Remove an edge (not corner) wall so the four-way flood actually escapes.
    const wall = state.buildings.find(
      (building) => building.definitionId === 'palisade-wall' && building.tileX === 85 && building.tileY === 79,
    )!;
    state.buildings = state.buildings.filter((building) => building.id !== wall.id);
    expect(describeGardenBed(state, bed)).toMatchObject({ phase: 'suspended' });
    expect(describeGardenBed(state, bed).message).toMatch(/suspended/);

    // A long invalid interval neither grows nor grants anything on recovery.
    advanceTicks(state, 6_000);
    expect(bed.garden!.progressTicks).toBe(600);
    expect(bed.garden!.readyFiber).toBe(0);

    state.buildings.push(wall);
    advanceTicks(state, 60);
    expect(bed.garden!.progressTicks).toBe(660);
    advanceTicks(state, GARDEN_BED_GROW_TICKS - 660);
    expect(bed.garden!.readyFiber).toBe(GARDEN_BED_YIELD_FIBER);
  });

  it('pauses at a full output store with no invisible backlog, then emits exactly one held batch', () => {
    const state = stateWithYard();
    const bed = placeGardenBed(state);
    const cycles = GARDEN_BED_READY_CAP / GARDEN_BED_YIELD_FIBER;
    advanceTicks(state, GARDEN_BED_GROW_TICKS * cycles);
    expect(bed.garden!.readyFiber).toBe(GARDEN_BED_READY_CAP);

    // The next cycle matures, then holds: blocked, not accumulating.
    advanceTicks(state, GARDEN_BED_GROW_TICKS * 3);
    expect(bed.garden!.readyFiber).toBe(GARDEN_BED_READY_CAP);
    expect(bed.garden!.progressTicks).toBe(GARDEN_BED_GROW_TICKS);
    expect(describeGardenBed(state, bed)).toMatchObject({ phase: 'blocked' });

    // Harvest releases the block; only the one held batch emits, not a backlog.
    const collected = state.inventory.fiber;
    expect(harvestGardenBed(state, bed.id)).toMatchObject({ ok: true });
    expect(state.inventory.fiber).toBe(collected + GARDEN_BED_READY_CAP);
    expect(bed.garden!.readyFiber).toBe(0);
    advanceTicks(state, 60);
    expect(bed.garden!.readyFiber).toBe(GARDEN_BED_YIELD_FIBER);
    expect(bed.garden!.progressTicks).toBe(0);
  });

  it('harvest is atomic: a full inventory changes nothing, and range is enforced', () => {
    const state = stateWithYard();
    const bed = placeGardenBed(state);
    advanceTicks(state, GARDEN_BED_GROW_TICKS);
    expect(nearestGardenBed(state)?.id).toBe(bed.id);

    state.inventory.wood = RESOURCE_STACK_SIZE * inventoryCapacity(state);
    const before = canonicalizeGameState(state);
    expect(harvestGardenBed(state, bed.id)).toMatchObject({ ok: false, message: 'Inventory full' });
    expect(canonicalizeGameState(state)).toBe(before);

    state.inventory.wood = 0;
    state.player.x = tilePx(10);
    expect(harvestGardenBed(state, bed.id)).toMatchObject({ ok: false, message: 'Too far away' });
    expect(nearestGardenBed(state)).toBeNull();
  });
});

describe('garden bed persistence validation', () => {
  it('accepts a current save containing a garden bed and rejects corrupt growth state', () => {
    const state = stateWithYard();
    placeGardenBed(state);
    advanceTicks(state, 90);
    expect(() => assertValidPortableSave(portableSaveOf(state))).not.toThrow();

    const negative = portableSaveOf(state) as { state: { buildings: Array<Record<string, unknown>> } };
    const bed = negative.state.buildings.find((building) => building['definitionId'] === 'garden-bed')!;
    (bed['garden'] as Record<string, unknown>)['progressTicks'] = -1;
    expect(() => assertValidPortableSave(negative)).toThrow(SaveValidationError);

    const misplaced = portableSaveOf(state) as { state: { buildings: Array<Record<string, unknown>> } };
    const wall = misplaced.state.buildings.find((building) => building['definitionId'] === 'palisade-wall')!;
    wall['garden'] = { progressTicks: 0, readyFiber: 0, nextGrowthTick: 0 };
    expect(() => assertValidPortableSave(misplaced)).toThrow(SaveValidationError);
  });
});

describe('garden bed palette copy', () => {
  it('lists a Garden Bed with cost, description, and area-8 gate data', () => {
    expect(buildableById('garden-bed')).toMatchObject({ tilesWide: 2, tilesHigh: 1 });
    expect(GARDEN_PLACEABLE).toMatchObject({ minEnvironmentArea: 8, environmentKind: 'workYard', requiredTerrain: 'grassland', discoverAtAreaTier: 8 });
    const priced = checkPlacement(createInitialState(SEED), [], buildableById('garden-bed'), 84, 80);
    expect(priced.ok).toBe(false); // gated long before cost on a fresh save
  });
});
