import { describe, expect, it } from 'vitest';
import { HANDS_WALL_DAMAGE, toolDefinition } from '../../src/config/balance';
import { MELEE_REACH_PX, strikeRaiderMelee } from '../../src/simulation/raids';
import {
  payStrikeCost,
  strikeBlockedReason,
  strikeProfile,
  strikeUseCost,
  STRIKE_STAMINA_COST,
} from '../../src/simulation/strike';
import { TILE_SIZE } from '../../src/config/platform';
import { createInitialState, type GameState, type RaiderState } from '../../src/simulation/state';

const SEED = 8181;

type TestToolId =
  | 'iron-axe' | 'wooden-axe' | 'iron-pick' | 'iron-sword' | 'wooden-sword'
  | 'magic-staff' | 'bow';

function equip(state: GameState, definitionId: TestToolId): void {
  const tool = {
    instanceId: `tool-${definitionId}`,
    definitionId,
    durability: toolDefinition(definitionId).maxDurability,
    maxDurability: toolDefinition(definitionId).maxDurability,
    powerRank: 0,
    speedRank: 0,
    durabilityRank: 0,
  };
  state.tools.push(tool as GameState['tools'][number]);
  state.equippedToolId = tool.instanceId;
}

/**
 * Raiders can only be fought in the open: the shared enclosure gate stops a
 * player farming bounties from inside a sealed room, and the starting position
 * inside Elaris counts as enclosed.
 */
function standInOpenGround(state: GameState): void {
  state.player.x = 40 * TILE_SIZE;
  state.player.y = 40 * TILE_SIZE;
}

function addRaider(state: GameState, hp = 30): RaiderState {
  const raider: RaiderState = {
    id: 'raider-strike',
    kindId: 'scavenger',
    x: Math.round(state.player.x + 8),
    y: Math.round(state.player.y),
    hp,
    maxHp: 30,
    level: 1,
    targetBuildingId: null,
    nextAttackTick: 0,
  };
  state.raiders.push(raider);
  return raider;
}

describe('strikeProfile', () => {
  it('reads the per-target table for a resource node', () => {
    const state = createInitialState(SEED);
    equip(state, 'iron-axe');
    expect(strikeProfile(state, 'tree').damage).toBe(24);
    // Off-primary: weak, and it wears twice as fast.
    expect(strikeProfile(state, 'plant').damage).toBe(10);
    expect(strikeProfile(state, 'plant').wear).toBeGreaterThan(strikeProfile(state, 'tree').wear);
  });

  it('is ineligible, free, and wearless against a target with no entry', () => {
    const state = createInitialState(SEED);
    equip(state, 'iron-axe');
    const profile = strikeProfile(state, 'stone');
    expect(profile.damage).toBe(0);
    expect(profile.wear).toBe(0);
  });

  it('preserves the pre-unification wall damage for a tool', () => {
    const state = createInitialState(SEED);
    equip(state, 'iron-axe');
    // Walls used to read the tool's headline `damage`; the structure row now
    // carries that same number so no save changes how fast a wall comes down.
    expect(strikeProfile(state, 'structure').damage).toBe(toolDefinition('iron-axe').damage);
  });

  it('preserves the pre-unification bare-handed wall damage', () => {
    const state = createInitialState(SEED);
    expect(strikeProfile(state, 'structure').damage).toBe(HANDS_WALL_DAMAGE);
  });

  it('folds a caller bonus into damage without touching wear', () => {
    const state = createInitialState(SEED);
    equip(state, 'iron-axe');
    const plain = strikeProfile(state, 'tree');
    const boosted = strikeProfile(state, 'tree', { bonusDamage: 7 });
    expect(boosted.damage).toBe(plain.damage + 7);
    expect(boosted.wear).toBe(plain.wear);
  });

  it('scales wear by hardness', () => {
    const state = createInitialState(SEED);
    equip(state, 'iron-pick');
    const soft = strikeProfile(state, 'stone', { hardness: 1 });
    const hard = strikeProfile(state, 'stone', { hardness: 3 });
    expect(hard.wear).toBe(soft.wear * 3);
  });
});

describe('payStrikeCost', () => {
  it('spends stamina and sets the action cooldown', () => {
    const state = createInitialState(SEED);
    equip(state, 'iron-axe');
    const stamina = state.player.stamina;
    const profile = strikeProfile(state, 'tree');

    payStrikeCost(state, profile);

    expect(state.player.stamina).toBe(stamina - STRIKE_STAMINA_COST);
    expect(state.actionCooldownUntilTick).toBeGreaterThan(state.tick);
  });

  it('unequips a tool that broke on the hit', () => {
    const state = createInitialState(SEED);
    equip(state, 'wooden-axe');
    const tool = state.tools[0]!;
    tool.durability = 1;

    const broke = payStrikeCost(state, strikeProfile(state, 'tree'));

    expect(broke).toBe(true);
    expect(tool.durability).toBe(0);
    expect(state.equippedToolId).toBeNull();
  });

  it('leaves a bare-handed swing free of durability cost', () => {
    const state = createInitialState(SEED);
    expect(payStrikeCost(state, strikeProfile(state, 'tree'))).toBe(false);
  });
});

describe('cast values', () => {
  it('spends a sword swing out of stamina', () => {
    const state = createInitialState(SEED);
    equip(state, 'iron-sword');
    const stamina = state.player.stamina;
    const mana = state.player.mana;

    payStrikeCost(state, strikeProfile(state, 'creature'));

    expect(state.player.stamina).toBe(stamina - toolDefinition('iron-sword').useCost.amount);
    expect(state.player.mana).toBe(mana);
  });

  it('spends a staff swing out of mana, never stamina', () => {
    const state = createInitialState(SEED);
    equip(state, 'magic-staff');
    const stamina = state.player.stamina;
    const mana = state.player.mana;

    payStrikeCost(state, strikeProfile(state, 'creature'));

    expect(state.player.mana).toBe(mana - toolDefinition('magic-staff').useCost.amount);
    expect(state.player.stamina).toBe(stamina);
  });

  it('blocks a staff swing on empty mana and names the pool', () => {
    const state = createInitialState(SEED);
    equip(state, 'magic-staff');
    state.player.mana = 0;

    expect(strikeBlockedReason(state)).toBe('Not enough MP');
    // Full stamina must not talk a staff past its own gate.
    expect(state.player.stamina).toBeGreaterThan(0);
  });

  it('leaves a bow bash on stamina so an empty quiver is not helpless', () => {
    const state = createInitialState(SEED);
    equip(state, 'bow');
    state.inventory.arrow = 0;
    const stamina = state.player.stamina;

    expect(strikeUseCost(state).resource).toBe('stamina');
    expect(strikeBlockedReason(state)).toBeNull();
    payStrikeCost(state, strikeProfile(state, 'creature'));
    expect(state.player.stamina).toBe(stamina - STRIKE_STAMINA_COST);
  });

  it('prices a shot at the bow’s arrow cast value', () => {
    expect(toolDefinition('bow').useCost).toEqual({ resource: 'arrow', amount: 1 });
    // Every grade of bow is still an arrow a shot; the cost is the kind's.
    expect(toolDefinition('ancient-bow').useCost).toEqual({ resource: 'arrow', amount: 1 });
  });

  it('keeps gathering tools on the stamina cost they always had', () => {
    const state = createInitialState(SEED);
    equip(state, 'iron-axe');
    const stamina = state.player.stamina;

    payStrikeCost(state, strikeProfile(state, 'tree'));

    expect(state.player.stamina).toBe(stamina - STRIKE_STAMINA_COST);
  });
});

describe('strikeBlockedReason', () => {
  it('blocks while the action is on cooldown', () => {
    const state = createInitialState(SEED);
    state.actionCooldownUntilTick = state.tick + 10;
    expect(strikeBlockedReason(state)).toBe('Not ready yet');
  });

  it('blocks when stamina is short', () => {
    const state = createInitialState(SEED);
    state.player.stamina = 0;
    expect(strikeBlockedReason(state)).toBe('Not enough stamina');
  });

  it('allows a swing when rested and off cooldown', () => {
    expect(strikeBlockedReason(createInitialState(SEED))).toBeNull();
  });
});

describe('strikeRaiderMelee', () => {
  it('damages a raider in reach using the tool raider row', () => {
    const state = createInitialState(SEED);
    standInOpenGround(state);
    equip(state, 'iron-axe');
    const raider = addRaider(state);

    const result = strikeRaiderMelee(state);

    expect(result.ok).toBe(true);
    expect(raider.hp).toBe(30 - toolDefinition('iron-axe').baseDamageByTarget.raider!);
  });

  it('lets a bare-handed player fight rather than stand there helpless', () => {
    const state = createInitialState(SEED);
    standInOpenGround(state);
    const raider = addRaider(state);

    const result = strikeRaiderMelee(state);

    expect(result.ok).toBe(true);
    expect(raider.hp).toBeLessThan(30);
  });

  it('wears the tool for being used as a weapon', () => {
    const state = createInitialState(SEED);
    standInOpenGround(state);
    equip(state, 'iron-axe');
    addRaider(state);
    const tool = state.tools[0]!;
    const before = tool.durability;

    strikeRaiderMelee(state);

    expect(tool.durability).toBeLessThan(before);
  });

  it('refuses a raider beyond melee reach', () => {
    const state = createInitialState(SEED);
    standInOpenGround(state);
    const raider = addRaider(state);
    raider.x = Math.round(state.player.x + MELEE_REACH_PX + 20);

    const result = strikeRaiderMelee(state);

    expect(result.ok).toBe(false);
    expect(raider.hp).toBe(30);
  });

  it('reaches a distant raider once the tool Range is widened', () => {
    const state = createInitialState(SEED);
    standInOpenGround(state);
    equip(state, 'iron-sword');
    const raider = addRaider(state);
    raider.x = Math.round(state.player.x + MELEE_REACH_PX + 20);

    expect(strikeRaiderMelee(state).ok).toBe(false);

    state.gameBalance.tools['iron-sword'].rangePx = MELEE_REACH_PX + 40;
    const result = strikeRaiderMelee(state);

    expect(result.ok).toBe(true);
    expect(raider.hp).toBeLessThan(30);
  });

  it('pays a bounty and removes the raider on a kill', () => {
    const state = createInitialState(SEED);
    standInOpenGround(state);
    equip(state, 'iron-axe');
    addRaider(state, 1);

    const result = strikeRaiderMelee(state);

    expect(result.ok).toBe(true);
    expect(result.killed).toBe(true);
    expect(state.raiders).toHaveLength(0);
  });

  it('respects the shared action cooldown', () => {
    const state = createInitialState(SEED);
    standInOpenGround(state);
    addRaider(state);
    state.actionCooldownUntilTick = state.tick + 10;

    expect(strikeRaiderMelee(state).ok).toBe(false);
  });
});

describe('swords', () => {
  it('fights far better than a tool used as a weapon', () => {
    const state = createInitialState(SEED);
    equip(state, 'iron-sword');
    const sword = strikeProfile(state, 'raider').damage;
    state.tools.length = 0;
    equip(state, 'iron-axe');
    expect(sword).toBeGreaterThan(strikeProfile(state, 'raider').damage);
  });

  it('harvests every node kind a specialist tool refuses', () => {
    const state = createInitialState(SEED);
    equip(state, 'iron-sword');
    // The whole point of the traveller's kit: one slot, everything eligible.
    for (const kind of ['tree', 'stone', 'plant', 'berry-bush'] as const) {
      expect(strikeProfile(state, kind).damage).toBeGreaterThan(0);
    }
  });

  it('cannot mine metal, so ore still needs a pick', () => {
    const state = createInitialState(SEED);
    equip(state, 'iron-sword');
    expect(strikeProfile(state, 'metal').damage).toBe(0);
  });

  it('harvests slower than the specialist it replaces', () => {
    const state = createInitialState(SEED);
    equip(state, 'iron-sword');
    const swordOnTree = strikeProfile(state, 'tree').damage;
    state.tools.length = 0;
    equip(state, 'iron-axe');
    expect(swordOnTree).toBeLessThan(strikeProfile(state, 'tree').damage);
  });

  it('pays for its versatility in durability on every resource', () => {
    const state = createInitialState(SEED);
    equip(state, 'iron-sword');
    const swordWear = strikeProfile(state, 'tree').wear;
    state.tools.length = 0;
    equip(state, 'iron-axe');
    expect(swordWear).toBeGreaterThan(strikeProfile(state, 'tree').wear);
  });
});
