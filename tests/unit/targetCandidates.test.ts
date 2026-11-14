import { describe, expect, it } from 'vitest';
import { nearestLiveNode, nearestWildCreature } from '../../src/simulation/gameplayCommands';
import { createInitialState, type ResourceNodeState, type WildCreatureState } from '../../src/simulation/state';
import { newWildCreature } from '../../src/simulation/worldGeneration';

describe('chunk-local target candidates', () => {
  it('searches only supplied resource candidates and preserves last-wins ties', () => {
    const state = createInitialState(44);
    state.player.x = 100;
    state.player.y = 100;
    const ignored: ResourceNodeState = {
      id: 'ignored', kind: 'tree', x: 100, y: 100, hp: 10, maxHp: 10, respawnAtTick: null,
    };
    const first: ResourceNodeState = {
      id: 'first', kind: 'tree', x: 90, y: 100, hp: 10, maxHp: 10, respawnAtTick: null,
    };
    const second: ResourceNodeState = {
      id: 'second', kind: 'stone', x: 110, y: 100, hp: 10, maxHp: 10, respawnAtTick: null,
    };
    state.resourceNodes = [ignored, first, second];

    expect(nearestLiveNode(state, 42, [first, second])?.id).toBe('second');
    expect(nearestLiveNode(state, 42, [second, first])?.id).toBe('first');
    expect(nearestLiveNode(state, 42, [])).toBeNull();
  });

  it('searches only supplied creature candidates with unchanged range behavior', () => {
    const state = createInitialState(45);
    state.player.x = 200;
    state.player.y = 200;
    const nearby: WildCreatureState = newWildCreature('nearby', 'tuftle', 220, 200);
    const excluded: WildCreatureState = newWildCreature('excluded', 'craghopper', 200, 200);
    state.wildCreatures = [excluded, nearby];

    expect(nearestWildCreature(state, 42, [nearby])?.id).toBe('nearby');
    expect(nearestWildCreature(state, 10, [nearby])).toBeNull();
  });
});
