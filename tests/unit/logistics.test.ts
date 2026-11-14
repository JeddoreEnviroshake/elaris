import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION, SAVE_SCHEMA_VERSION, WORLD_GEN_VERSION } from '../../src/config/versions';
import { migrateToCurrent } from '../../src/persistence/migrations';
import { advanceLogisticsRouting, clearLogisticsRoute, setLogisticsRoute } from '../../src/simulation/logistics';
import {
  createLogisticsHubState, createInitialState, createWorkerHousingState,
  type BuildingState, type GameState, type OwnedCreatureState,
} from '../../src/simulation/state';
import { addStorageResource, storageBoxContents } from '../../src/simulation/storageBox';

function worker(): OwnedCreatureState {
  return {
    id: 'worker-a', speciesId: 'tuftle', name: 'Moss', role: 'work', assignment: 'fiber',
    worksiteId: 'pen', housingId: 'pen', nextWorkTick: 0, workRemainderMs: 0,
    bondXp: 0, selectedBattleAbilityId: 'tuftle-guard',
  };
}

function container(id: string, definitionId: 'field-cache' | 'warehouse'): BuildingState {
  return {
    id, definitionId, tileX: 0, tileY: 0,
    storage: {
      wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0,
      'taming-snare': 0, berry: 0, arrow: 0, 'cloth-mask': 0,
    },
    storageStacks: {
      wood: [], stone: [], fiber: [], 'iron-ore': [], 'iron-ingot': [],
      'taming-snare': [], berry: [], arrow: [], 'cloth-mask': [],
    },
    storedTools: [],
  };
}

function logisticsState(): GameState {
  const state = createInitialState(551);
  const housing = createWorkerHousingState();
  housing.bin.fiber = 8;
  housing.bin.berry = 3;
  state.buildings = [
    { id: 'pen', definitionId: 'small-pen', tileX: 0, tileY: 0, housing },
    { id: 'hub', definitionId: 'logistics-hub', tileX: 3, tileY: 0, logistics: createLogisticsHubState() },
    container('small', 'field-cache'),
    container('bulk', 'warehouse'),
  ];
  state.ownedCreatures = [worker()];
  return state;
}

describe('Logistics Hub', () => {
  it('routes each output to the first valid destination with space', () => {
    const state = logisticsState();
    const small = state.buildings.find((building) => building.id === 'small')!;
    small.storage = { wood: 594, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0 };
    small.storageStacks = { wood: [99, 99, 99, 99, 99, 99], stone: [], fiber: [], 'iron-ore': [], 'iron-ingot': [] };
    expect(setLogisticsRoute(state, 'hub', 'worker-a', ['small', 'bulk']).ok).toBe(true);
    expect(advanceLogisticsRouting(state)).toMatchObject({ transferred: 11 });
    expect(state.buildings[0]!.housing?.bin).toEqual({ fiber: 0, berry: 0 });
    expect(storageBoxContents(state.buildings.find((building) => building.id === 'bulk')!).inventory)
      .toMatchObject({ fiber: 8, berry: 3 });
    expect(advanceLogisticsRouting(state).transferred).toBe(0);
    expect(storageBoxContents(state.buildings.find((building) => building.id === 'bulk')!).inventory)
      .toMatchObject({ fiber: 8, berry: 3 });
  });

  it('gives Warehouses 24 spaces while small storage remains six spaces', () => {
    const state = logisticsState();
    const small = state.buildings.find((building) => building.id === 'small')!;
    const bulk = state.buildings.find((building) => building.id === 'bulk')!;
    expect(addStorageResource(small, 'wood', 7 * 99)).toBe(false);
    expect(addStorageResource(bulk, 'wood', 7 * 99)).toBe(true);
    expect(storageBoxContents(bulk).stacks.wood).toHaveLength(7);
  });

  it('retains output when every destination is full or invalid', () => {
    const state = logisticsState();
    const small = state.buildings.find((building) => building.id === 'small')!;
    small.storage = { wood: 594, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0 };
    small.storageStacks = { wood: [99, 99, 99, 99, 99, 99], stone: [], fiber: [], 'iron-ore': [], 'iron-ingot': [] };
    setLogisticsRoute(state, 'hub', 'worker-a', ['small']);
    expect(advanceLogisticsRouting(state).transferred).toBe(0);
    expect(state.buildings[0]!.housing?.bin).toEqual({ fiber: 8, berry: 3 });
    state.buildings.splice(state.buildings.findIndex((building) => building.id === 'small'), 1);
    expect(advanceLogisticsRouting(state).transferred).toBe(0);
    expect(state.buildings[0]!.housing?.bin).toEqual({ fiber: 8, berry: 3 });
  });

  it('relinks atomically, clears explicitly, and survives validated save reload', () => {
    const state = logisticsState();
    expect(setLogisticsRoute(state, 'hub', 'worker-a', ['small']).ok).toBe(true);
    expect(setLogisticsRoute(state, 'hub', 'worker-a', ['missing'])).toMatchObject({ ok: false });
    expect(state.buildings.find((building) => building.id === 'hub')!.logistics?.routes[0]?.destinationContainerIds)
      .toEqual(['small']);
    expect(setLogisticsRoute(state, 'hub', 'worker-a', ['bulk', 'small']).ok).toBe(true);
    const reloaded = migrateToCurrent(JSON.parse(JSON.stringify({
      meta: {
        saveVersion: SAVE_SCHEMA_VERSION, worldGenVersion: WORLD_GEN_VERSION,
        contentVersion: CONTENT_VERSION, appVersion: 'test', savedAt: 1,
      },
      state,
    }))).save.state;
    expect(reloaded.buildings.find((building) => building.id === 'hub')!.logistics?.routes[0])
      .toEqual({ sourceWorkerId: 'worker-a', destinationContainerIds: ['bulk', 'small'] });
    expect(clearLogisticsRoute(reloaded, 'hub', 'worker-a').ok).toBe(true);
    expect(reloaded.buildings.find((building) => building.id === 'hub')!.logistics?.routes).toEqual([]);
  });
});
