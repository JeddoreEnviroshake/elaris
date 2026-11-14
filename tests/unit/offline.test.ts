import { describe, expect, it } from 'vitest';
import { GARDEN_BED_GROW_TICKS, OFFLINE_CAP_MS } from '../../src/config/balance';
import { settleOfflineTime } from '../../src/simulation/offline';
import { createGardenBedState, createInitialState } from '../../src/simulation/state';
import { beginPlayerDefeat } from '../../src/simulation/survivalCycle';
import { enclosedEnvironment } from './helpers/buildings';

describe('capped forward offline settlement', () => {
  it('decrements partial node timers, respawns due nodes, and ignores backward time', () => {
    const state = createInitialState(1); state.tick = 100;
    const [partial, due] = state.resourceNodes;
    partial!.hp = 0; partial!.respawnAtTick = state.tick + 3_600;
    due!.hp = 0; due!.respawnAtTick = state.tick + 600;
    expect(settleOfflineTime(state, 10_000)).toMatchObject({ appliedMs: 10_000, nodesRespawned: 1 });
    expect(partial!.respawnAtTick).toBe(state.tick + 3_000);
    expect(due).toMatchObject({ hp: due!.maxHp, respawnAtTick: null });
    const snapshot = structuredClone(state);
    expect(settleOfflineTime(state, -1)).toMatchObject({ appliedMs: 0 });
    expect(state).toEqual(snapshot);
  });

  it('advances valid growers up to storage and the eight-hour cap', () => {
    const state = createInitialState(2); state.resourceNodes = [];
    state.buildings = enclosedEnvironment(10, 10, 3, 3, 'workYard');
    const garden = { id: 'garden', definitionId: 'garden-bed' as const, tileX: 10, tileY: 10, garden: createGardenBedState(state.tick) };
    state.buildings.push(garden);
    const summary = settleOfflineTime(state, OFFLINE_CAP_MS * 2);
    expect(summary.appliedMs).toBe(OFFLINE_CAP_MS);
    expect(garden.garden.readyFiber).toBeGreaterThan(0);
    expect(garden.garden.readyFiber).toBeLessThanOrEqual(15);
    expect(garden.garden.progressTicks).toBeLessThanOrEqual(GARDEN_BED_GROW_TICKS);
  });

  it('does not settle offline simulation while a respawn choice is pending', () => {
    const state = createInitialState(3);
    const node = state.resourceNodes[0]!;
    node.hp = 0;
    node.respawnAtTick = state.tick + 60;
    beginPlayerDefeat(state, 'creature');

    expect(settleOfflineTime(state, OFFLINE_CAP_MS)).toEqual({
      appliedMs: 0,
      nodesRespawned: 0,
      fiberGrown: 0,
      woodGrown: 0,
      ingotsSmelted: 0,
      workerResourcesProduced: 0,
      expeditionsReturned: 0,
    });
    expect(node.hp).toBe(0);
  });
});
