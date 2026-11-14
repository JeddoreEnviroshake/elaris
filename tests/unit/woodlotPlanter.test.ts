import { describe, expect, it } from 'vitest';
import {
  WOODLOT_GROW_TICKS,
  WOODLOT_READY_CAP,
  WOODLOT_YIELD_WOOD,
} from '../../src/config/balance';
import { TILE_SIZE } from '../../src/config/platform';
import { buildableById, placeBuilding, validatePlacement } from '../../src/simulation/gameplayCommands';
import { createInitialState, type BuildingState, type GameState } from '../../src/simulation/state';
import {
  advanceWoodlotPlanters,
  describeWoodlotPlanter,
  harvestWoodlotPlanter,
} from '../../src/simulation/woodlotPlanters';
import { enclosedEnvironment } from './helpers/buildings';

const SEED = 7;
const tilePx = (tile: number) => tile * TILE_SIZE + TILE_SIZE / 2;

function stateWithForestYard(): GameState {
  const state = createInitialState(SEED);
  state.resourceNodes = [];
  state.buildings = enclosedEnvironment(15, 48, 4, 4, 'workYard');
  state.player.x = tilePx(18);
  state.player.y = tilePx(51);
  state.highestAreaTierEver = 16;
  state.inventory.wood = 20;
  state.inventory.stone = 10;
  state.unlockedItemIds.push('woodlot-planter');
  return state;
}

function placePlanter(state: GameState): BuildingState {
  const result = placeBuilding(state, state.buildings, buildableById('woodlot-planter'), 15, 48);
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
  it('uses point ownership and allows any open in-range footprint', () => {
    const state = stateWithForestYard();
    const definition = buildableById('woodlot-planter');
    state.unlockedItemIds = [];
    expect(validatePlacement(state, state.buildings, definition, 15, 48).message).toMatch(/Blueprint not yet discovered/);
    state.unlockedItemIds.push('woodlot-planter');
    state.highestAreaTierEver = 0;
    expect(validatePlacement(state, state.buildings, definition, 15, 48).ok).toBe(true);

    const open = stateWithForestYard();
    open.buildings = [];
    expect(validatePlacement(open, open.buildings, definition, 15, 48).ok).toBe(true);

    const grassland = stateWithForestYard();
    grassland.buildings = enclosedEnvironment(44, 39, 4, 4, 'workYard');
    grassland.player.x = tilePx(47);
    grassland.player.y = tilePx(42);
    expect(placeBuilding(grassland, grassland.buildings, definition, 44, 39).ok).toBe(true);
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
    state.player.y = tilePx(49);
    const beforeWood = state.inventory.wood;
    expect(harvestWoodlotPlanter(state, planter.id).ok).toBe(true);
    expect(state.inventory.wood).toBe(beforeWood + WOODLOT_YIELD_WOOD);
    expect(planter.woodlot!.readyWood).toBe(0);
  });

  it('keeps growing when the yard breaks and blocks at capacity', () => {
    const state = stateWithForestYard();
    const planter = placePlanter(state);
    advanceTicks(state, 600);
    const progress = planter.woodlot!.progressTicks;
    const breachedWall = state.buildings.findIndex((building) =>
      building.tileX === 16 && building.tileY === 48 && building.boundaryEdge === 'north',
    );
    state.buildings.splice(breachedWall, 1);
    advanceTicks(state, 600);
    expect(planter.woodlot!.progressTicks).toBe(progress + 600);
    expect(describeWoodlotPlanter(state, planter).phase).toBe('growing');

    state.buildings = enclosedEnvironment(15, 48, 4, 4, 'workYard').concat(planter);
    planter.woodlot!.readyWood = WOODLOT_READY_CAP;
    planter.woodlot!.progressTicks = WOODLOT_GROW_TICKS;
    advanceTicks(state, 60);
    expect(planter.woodlot!.readyWood).toBe(WOODLOT_READY_CAP);
    expect(describeWoodlotPlanter(state, planter).phase).toBe('blocked');
  });
});
