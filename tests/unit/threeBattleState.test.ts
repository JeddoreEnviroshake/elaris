import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../src/simulation/state';
import {
  battleTrackToWorld,
  captureBattleSnapshot,
  resolvedBattleSnapshot,
} from '../../src/three/battleState';

function encounterState() {
  const state = createInitialState(456);
  const wild = state.wildCreatures[0]!;
  state.activeEncounter = {
    wildCreatureId: wild.id,
    creatureHp: 30,
    creatureMaxHp: 40,
    round: 2,
    message: 'Fight',
    playerPos: 35,
    creaturePos: 68,
    companionCreatureId: null,
    selectedCompanionAbilityId: null,
    companionAbilityReadyRounds: {},
    enemyIntent: 'advance',
  };
  return state;
}

describe('3D battle presentation state', () => {
  it('captures the authoritative encounter without mutating it', () => {
    const state = encounterState();
    state.tools.push({
      instanceId: 'staff-test', definitionId: 'magic-staff', durability: 10, maxDurability: 240,
      powerRank: 0, speedRank: 0, durabilityRank: 0,
    });
    state.equippedToolId = 'staff-test';
    const snapshot = captureBattleSnapshot(state)!;
    expect(snapshot).toMatchObject({
      round: 2, creatureHp: 30, creatureMaxHp: 40,
      playerPos: 35, creaturePos: 68, enemyIntent: 'advance', magicStaffEquipped: true,
    });
    expect(snapshot.speciesId).toBe(state.wildCreatures[0]!.speciesId);
    expect(state.activeEncounter!.creatureHp).toBe(30);
  });

  it('retains a resolved terminal pose after the simulation closes combat', () => {
    const state = encounterState();
    const before = captureBattleSnapshot(state)!;
    state.activeEncounter = null;
    const resolved = resolvedBattleSnapshot(before, state, {
      ok: true,
      ended: true,
      defeated: true,
      message: 'Victory',
      playerStrike: { outcome: 'crit', damage: 30, style: 'melee' },
      creatureMove: { from: 68, to: 60 },
    });
    expect(resolved).toMatchObject({ creatureHp: 0, creaturePos: 60, round: 3 });
  });

  it('maps the simulation battle track into the arena and clamps its edges', () => {
    expect(battleTrackToWorld(0)).toBe(-4);
    expect(battleTrackToWorld(50)).toBe(0);
    expect(battleTrackToWorld(100)).toBe(4);
    expect(battleTrackToWorld(-20)).toBe(-4);
    expect(battleTrackToWorld(140)).toBe(4);
  });
});
