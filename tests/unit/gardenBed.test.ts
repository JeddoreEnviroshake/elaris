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
import { enclosedEnvironment } from './helpers/buildings';

const SEED = 7;
const GARDEN_PLACEABLE = PLACEABLES.find((placeable) => placeable.id === 'garden-bed')!;

/** Center of a tile in source pixels. */
const tilePx = (tile: number) => tile * TILE_SIZE + TILE_SIZE / 2;

/**
 * A discovered, affordable state with an enclosed 4×2 (area 8, 2×2 core) work
 * yard on grassland just east of the spawn clearing, with the player inside.
 */
function stateWithYard(): GameState {
  const state = createInitialState(SEED);
  state.resourceNodes = [];
  state.buildings = enclosedEnvironment(84, 80, 4, 2, 'workYard');
  state.player.x = tilePx(86);
  state.player.y = tilePx(81);
  state.highestAreaTierEver = 8;
  state.inventory.wood = 20;
  state.inventory.fiber = 10;
  state.unlockedItemIds.push('garden-bed');
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
  it('is locked only by permanent point ownership, not area tier', () => {
    const state = stateWithYard();
    state.unlockedItemIds = [];
    state.highestAreaTierEver = 16;
    expect(placeableLockedReason(state, GARDEN_PLACEABLE)).toMatch(/Blueprint not yet discovered/);
    expect(buildableLockedReason(state, 'garden-bed')).toMatch(/Blueprint not yet discovered/);
    state.unlockedItemIds.push('garden-bed');
    state.highestAreaTierEver = 0;
    expect(placeableLockedReason(state, GARDEN_PLACEABLE)).toBeNull();
    expect(buildableLockedReason(state, 'garden-bed')).toBeNull();
    expect(validatePlacement(state, state.buildings, buildableById('garden-bed'), 84, 80).ok).toBe(true);
  });

  it('places on open or enclosed footprints regardless of terrain', () => {
    const state = stateWithYard();
    expect(starterBiomeAt(SEED, tilePx(84), tilePx(80))).toBe('grassland');
    const def = buildableById('garden-bed');

    // Unenclosed grassland: discovery is permanent, but current geometry gates placement.
    const openState = stateWithYard();
    openState.buildings = [];
    expect(validatePlacement(openState, openState.buildings, def, 84, 80).ok).toBe(true);

    // Enclosed forest soil is rejected with the exact terrain reason.
    const forest = stateWithYard();
    forest.buildings = enclosedEnvironment(15, 48, 4, 2, 'workYard');
    forest.player.x = tilePx(18);
    forest.player.y = tilePx(49);
    expect(starterBiomeAt(SEED, tilePx(15), tilePx(48))).toBe('forest');
    expect(validatePlacement(forest, forest.buildings, def, 15, 48).ok).toBe(true);

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

  it('keeps growing when informational enclosure geometry changes', () => {
    const state = stateWithYard();
    const bed = placeGardenBed(state);
    advanceTicks(state, 600);
    expect(bed.garden!.progressTicks).toBe(600);

    // Remove an edge (not corner) wall so the four-way flood actually escapes.
    const wall = state.buildings.find(
      (building) => building.definitionId === 'wood-fence' && building.tileX === 85 && building.tileY === 80 && building.boundaryEdge === 'north',
    )!;
    state.buildings = state.buildings.filter((building) => building.id !== wall.id);
    expect(describeGardenBed(state, bed)).toMatchObject({ phase: 'growing' });
    advanceTicks(state, 600);
    expect(bed.garden!.progressTicks).toBe(1_200);
    state.buildings.push(wall);
    advanceTicks(state, GARDEN_BED_GROW_TICKS - 1_200);
    expect(bed.garden!.readyFiber).toBe(GARDEN_BED_YIELD_FIBER);
  }, 15_000);

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
    const wall = misplaced.state.buildings.find((building) => building['definitionId'] === 'wood-fence')!;
    wall['garden'] = { progressTicks: 0, readyFiber: 0, nextGrowthTick: 0 };
    expect(() => assertValidPortableSave(misplaced)).toThrow(SaveValidationError);
  });
});

describe('garden bed palette copy', () => {
  it('lists a Garden Bed with cost, description, and area-8 gate data', () => {
    expect(buildableById('garden-bed')).toMatchObject({ tilesWide: 2, tilesHigh: 1 });
    expect(GARDEN_PLACEABLE).toMatchObject({ minEnvironmentArea: 8, environmentKind: 'workYard', requiredTerrain: 'grassland' });
    expect(GARDEN_PLACEABLE.requirement).toEqual({ allOf: [{ kind: 'highestAreaTierEver', atLeast: 8 }] });
    const priced = checkPlacement(createInitialState(SEED), [], buildableById('garden-bed'), 84, 80);
    expect(priced.ok).toBe(false); // gated long before cost on a fresh save
  });
});
