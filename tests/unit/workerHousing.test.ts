import { describe, expect, it } from 'vitest';
import { OFFLINE_CAP_MS } from '../../src/config/balance';
import { orderTrainedCreature } from '../../src/simulation/economy';
import { setCreatureRole } from '../../src/simulation/gameplayCommands';
import { settleOfflineTime } from '../../src/simulation/offline';
import { createInitialState, createWorkerHousingState, type GameState } from '../../src/simulation/state';
import {
  collectHousingBin,
  housingCapacityForBuilding,
  reconcileCreatureHousing,
  releaseCreature,
  settleWorkerProduction,
} from '../../src/simulation/workerHousing';
import { enclosedEnvironment } from './helpers/buildings';

function housedState(width = 4, height = 4): GameState {
  const state = createInitialState(9001);
  state.buildings = enclosedEnvironment(10, 10, width, height, 'workYard');
  state.buildings.push({
    id: 'pen', definitionId: 'small-pen', tileX: 10, tileY: 10,
    housing: createWorkerHousingState(),
  });
  return state;
}

function orderTuftle(state: GameState): void {
  state.firstTamedSpeciesIds.push('tuftle');
  state.highestRatingEverTenths = 2_500;
  state.coins = 500;
  expect(orderTrainedCreature(state, 'tuftle')).toMatchObject({ ok: true });
}

describe('worker housing and producer settlement', () => {
  it('caps slots by both valid housing and paddock area', () => {
    const state = housedState(4, 4);
    const pen = state.buildings.find((building) => building.id === 'pen')!;
    state.buildings.push({ id: 'barn', definitionId: 'barn', tileX: 11, tileY: 12, housing: createWorkerHousingState() });
    expect(housingCapacityForBuilding(state, pen)).toMatchObject({ area: 16, buildingSlots: 4, capacity: 2, assigned: 0, available: 2 });
  });

  it('orders atomically only with housing, then releases for exactly 25 percent', () => {
    const state = housedState();
    orderTuftle(state);
    expect(state.ownedCreatures[0]).toMatchObject({ role: 'rest', housingId: 'pen' });
    expect(state.coins).toBe(380);
    expect(releaseCreature(state, state.ownedCreatures[0]!.id)).toMatchObject({ ok: false });
    expect(releaseCreature(state, state.ownedCreatures[0]!.id, true)).toMatchObject({ ok: true });
    expect(state.coins).toBe(410);
    expect(state.ownedCreatures).toHaveLength(0);
  });

  it('produces into a finite bin, collects explicitly, and never bursts after full storage', () => {
    const state = housedState();
    orderTuftle(state);
    expect(setCreatureRole(state, state.ownedCreatures[0]!.id, 'work')).toMatchObject({ ok: true });
    expect(settleWorkerProduction(state, 15_000)).toEqual({ completedCycles: 1, produced: 2 });
    const pen = state.buildings.find((building) => building.id === 'pen')!;
    expect(pen.housing!.bin.fiber).toBe(2);
    pen.housing!.bin.fiber = 12;
    expect(settleWorkerProduction(state, OFFLINE_CAP_MS)).toEqual({ completedCycles: 0, produced: 0 });
    expect(collectHousingBin(state, pen.id, 'fiber')).toMatchObject({ ok: true });
    expect(settleWorkerProduction(state, 0)).toEqual({ completedCycles: 0, produced: 0 });
  });

  it('settles at most eight hours once, accumulates sub-cycles, and ignores backward time', () => {
    const state = housedState();
    orderTuftle(state);
    setCreatureRole(state, state.ownedCreatures[0]!.id, 'work');
    expect(settleWorkerProduction(state, 5_000).produced).toBe(0);
    expect(settleWorkerProduction(state, 10_000).produced).toBe(2);
    const before = structuredClone(state);
    expect(settleOfflineTime(state, -1).workerResourcesProduced).toBe(0);
    expect(state).toEqual(before);
    const capped = housedState(); orderTuftle(capped); setCreatureRole(capped, capped.ownedCreatures[0]!.id, 'work');
    expect(settleOfflineTime(capped, OFFLINE_CAP_MS * 3).appliedMs).toBe(OFFLINE_CAP_MS);
    expect(settleOfflineTime(capped, 0).workerResourcesProduced).toBe(0);
  });

  it('rests safely when the paddock breaks without deleting the creature or bin', () => {
    const state = housedState(); orderTuftle(state); setCreatureRole(state, state.ownedCreatures[0]!.id, 'work');
    const pen = state.buildings.find((building) => building.id === 'pen')!;
    pen.housing!.bin.fiber = 4;
    state.buildings = state.buildings.filter((building) => !(building.boundaryEdge === 'north' && building.tileX === 10));
    expect(reconcileCreatureHousing(state)).toBe(true);
    expect(state.ownedCreatures[0]).toMatchObject({ role: 'rest', housingId: 'pen' });
    expect(pen.housing!.bin.fiber).toBe(4);
  });

  it('keeps deterministic occupants and unhouses only overflow after capacity shrinks', () => {
    const state = housedState(); orderTuftle(state);
    const first = state.ownedCreatures[0]!;
    state.ownedCreatures.push({ ...structuredClone(first), id: 'zzz-overflow', role: 'work', assignment: 'fiber', worksiteId: 'pen' });
    expect(reconcileCreatureHousing(state)).toBe(true);
    expect(first.housingId).toBe('pen');
    expect(state.ownedCreatures[1]).toMatchObject({ role: 'rest', housingId: null, assignment: null, worksiteId: null });
    expect(reconcileCreatureHousing(state)).toBe(false);
  });
});
