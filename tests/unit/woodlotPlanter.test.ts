import { describe, expect, it } from 'vitest';
import {
  WOODLOT_GROW_TICKS,
  WOODLOT_READY_CAP,
  WOODLOT_YIELD_WOOD,
} from '../../src/config/balance';
import { TILE_SIZE } from '../../src/config/platform';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { buildableById, placeBuilding, validatePlacement } from '../../src/simulation/gameplayCommands';
import { createInitialState, type BuildingState, type GameState } from '../../src/simulation/state';
import {
  advanceWoodlotPlanters,
  describeWoodlotPlanter,
  harvestWoodlotPlanter,
} from '../../src/simulation/woodlotPlanters';

const SEED = 7;
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

function stateWithForestYard(): GameState {
  const state = createInitialState(SEED);
  state.resourceNodes = [];
  state.buildings = wallsAround(14, 14, 4, 4);
  state.player.x = tilePx(18);
  state.player.y = tilePx(18);
  state.highestAreaTierEver = 16;
  state.inventory.wood = 20;
  state.inventory.stone = 10;
  return state;
}

function placePlanter(state: GameState): BuildingState {
  const result = placeBuilding(state, state.buildings, buildableById('woodlot-planter'), 15, 15);
  expect(result.ok).toBe(true);
  return result.building!;
}

function advanceTicks(state: GameState, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    state.tick += 1;
    advanceWoodlotPlanters(state);
  }
}

describe('Woodlot Planter', () => {
  it('unlocks at 16 and requires forest soil plus a current 16-tile work yard', () => {
    const state = stateWithForestYard();
    const definition = buildableById('woodlot-planter');
    state.highestAreaTierEver = 8;
    expect(validatePlacement(state, state.buildings, definition, 15, 15).message).toMatch(/Locked/);
    state.highestAreaTierEver = 16;
    expect(validatePlacement(state, state.buildings, definition, 15, 15).ok).toBe(true);

    const open = stateWithForestYard();
    open.buildings = [];
    expect(validatePlacement(open, open.buildings, definition, 15, 15).message).toMatch(/Needs 16-tile area/);

    const grassland = stateWithForestYard();
    grassland.buildings = wallsAround(83, 78, 4, 4);
    grassland.player.x = tilePx(87);
    grassland.player.y = tilePx(82);
    const before = canonicalizeGameState(grassland);
    expect(placeBuilding(grassland, grassland.buildings, definition, 84, 79).message).toBe('Requires open forest soil');
    expect(canonicalizeGameState(grassland)).toBe(before);
  });

  it('grows a deterministic wood batch and harvests it atomically', () => {
    const state = stateWithForestYard();
    const planter = placePlanter(state);
    expect(planter.woodlot).toEqual({ progressTicks: 0, readyWood: 0, nextGrowthTick: 60 });
    advanceTicks(state, WOODLOT_GROW_TICKS - 1);
    expect(planter.woodlot!.readyWood).toBe(0);
    advanceTicks(state, 1);
    expect(planter.woodlot!.readyWood).toBe(WOODLOT_YIELD_WOOD);
    expect(state.resourcesCollected.wood).toBe(WOODLOT_YIELD_WOOD);
    expect(describeWoodlotPlanter(state, planter).phase).toBe('ready');

    state.player.x = tilePx(16);
    state.player.y = tilePx(16);
    const beforeWood = state.inventory.wood;
    expect(harvestWoodlotPlanter(state, planter.id).ok).toBe(true);
    expect(state.inventory.wood).toBe(beforeWood + WOODLOT_YIELD_WOOD);
    expect(planter.woodlot!.readyWood).toBe(0);
  });

  it('suspends without catch-up when the yard breaks and blocks at capacity', () => {
    const state = stateWithForestYard();
    const planter = placePlanter(state);
    advanceTicks(state, 600);
    const progress = planter.woodlot!.progressTicks;
    const breachedWall = state.buildings.findIndex((building) => building.tileX === 16 && building.tileY === 14);
    state.buildings.splice(breachedWall, 1);
    advanceTicks(state, 600);
    expect(planter.woodlot!.progressTicks).toBe(progress);
    expect(describeWoodlotPlanter(state, planter).phase).toBe('suspended');

    state.buildings = wallsAround(14, 14, 4, 4).concat(planter);
    planter.woodlot!.readyWood = WOODLOT_READY_CAP;
    planter.woodlot!.progressTicks = WOODLOT_GROW_TICKS;
    advanceTicks(state, 60);
    expect(planter.woodlot!.readyWood).toBe(WOODLOT_READY_CAP);
    expect(describeWoodlotPlanter(state, planter).phase).toBe('blocked');
  });
});
