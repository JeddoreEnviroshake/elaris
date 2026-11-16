import { describe, expect, it } from 'vitest';
import { gatherNearest, gatherResource } from '../../src/simulation/gameplayCommands';
import { createInitialState } from '../../src/simulation/state';

function miningState() {
  const state = createInitialState(42);
  state.player.x = 640; state.player.y = 640;
  state.resourceNodes = [
    { id: 'aimed-rock', kind: 'stone', x: 640, y: 616, hp: 100, maxHp: 100, respawnAtTick: null },
    { id: 'closer-rock', kind: 'stone', x: 640, y: 652, hp: 100, maxHp: 100, respawnAtTick: null },
  ];
  state.tools = [{ instanceId: 'pick', definitionId: 'iron-pick', durability: 240, maxDurability: 240, powerRank: 0, speedRank: 0, durabilityRank: 0 }];
  state.equippedToolId = 'pick';
  return state;
}

describe('targeted resource gathering', () => {
  it('strikes the requested rock while nearest gathering retains its original selection', () => {
    const state = miningState();
    expect(gatherResource(state, 'aimed-rock')).toMatchObject({ ok: true, targetId: 'aimed-rock' });
    expect(state.resourceNodes[0]!.hp).toBeLessThan(100);
    expect(state.resourceNodes[1]!.hp).toBe(100);
    state.tick = state.actionCooldownUntilTick;
    expect(gatherNearest(state)).toMatchObject({ ok: true, targetId: 'closer-rock' });
  });

  it.each(['missing', 'depleted', 'out-of-reach'] as const)('rejects a %s target without falling back to a closer rock or charging costs', condition => {
    const state = miningState();
    if (condition === 'depleted') state.resourceNodes[0]!.hp = 0;
    if (condition === 'out-of-reach') state.resourceNodes[0]!.y = 1000;
    const before = JSON.stringify(state);
    expect(gatherResource(state, condition === 'missing' ? 'unknown' : 'aimed-rock').ok).toBe(false);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('retains tool requirements and cooldown validation for a selected rock', () => {
    const state = miningState();
    state.equippedToolId = null;
    expect(gatherResource(state, 'aimed-rock')).toMatchObject({ ok: false, message: 'Stone needs a pick' });
    state.equippedToolId = 'pick'; state.actionCooldownUntilTick = state.tick + 1;
    const before = JSON.stringify(state);
    expect(gatherResource(state, 'aimed-rock')).toMatchObject({ ok: false, message: 'Not ready yet' });
    expect(JSON.stringify(state)).toBe(before);
  });
});
