import { describe, expect, it } from 'vitest';
import { learnBlueprint } from '../../src/simulation/blueprintKnowledge';
import { newWildCreature } from '../../src/simulation/worldGeneration';
import { activeSnare, craftReinforcedSnare } from '../../src/simulation/supplyCrafting';
import { tameChance, throwSnareAtCreature } from '../../src/simulation/tameChance';
import { strikeCreatureMelee } from '../../src/simulation/creatureStrike';
import {
  REINFORCED_SNARE_CRAFT_COST,
  REINFORCED_SNARES_PER_CRAFT,
  TROPHY_DEFEATS_PER_DROP,
} from '../../src/config/balance';
import { CREATURE_DEFINITIONS, creatureDefinition } from '../../src/content/creatures';
import { SELL_PRICES } from '../../src/content/economy';
import { createInitialState, type GameState, type ResourceId, type SpeciesId } from '../../src/simulation/state';

const TROPHIES = CREATURE_DEFINITIONS.map((definition) => definition.encounter.trophy);

/**
 * Stand on a wild creature of the given species and land melee swings until it
 * falls. The creature is pinned at 1 HP between swings so the test exercises
 * the defeat payout rather than the damage curve, but the kill still has to go
 * through a real attack action — that is the only path that grants loot.
 */
function defeatOne(state: GameState, speciesId: SpeciesId): void {
  const wild = state.wildCreatures.find((creature) => creature.speciesId === speciesId);
  if (!wild) throw new Error(`no wild ${speciesId} remaining`);
  state.player.x = wild.x;
  state.player.y = wild.y;
  for (let attempt = 0; attempt < 500; attempt += 1) {
    wild.hp = 1;
    state.actionCooldownUntilTick = 0;
    state.player.stamina = state.player.maxStamina;
    state.player.hp = state.player.maxHp;
    if (strikeCreatureMelee(state, wild.id).killed) return;
    state.tick += 60;
  }
  throw new Error(`could not defeat ${speciesId}`);
}

/** Restock one wild creature so a species can be defeated repeatedly. */
function respawn(state: GameState, speciesId: SpeciesId, index: number): void {
  state.wildCreatures.push({
    ...newWildCreature(`respawn-${speciesId}-${index}`, speciesId, state.player.x, state.player.y),
  });
}

describe('creature trophies', () => {
  it('gives every species a distinct trophy', () => {
    expect(new Set(TROPHIES).size).toBe(CREATURE_DEFINITIONS.length);
  });

  it('prices every trophy above any gathered resource', () => {
    const gathered = Math.max(SELL_PRICES.wood, SELL_PRICES.stone, SELL_PRICES.fiber, SELL_PRICES['iron-ore']);
    for (const trophy of TROPHIES) expect(SELL_PRICES[trophy]).toBeGreaterThan(gathered);
  });

  it('yields no trophy before the counter is reached', () => {
    const state = createInitialState(123);
    for (let i = 0; i < TROPHY_DEFEATS_PER_DROP - 1; i += 1) {
      respawn(state, 'tuftle', i);
      defeatOne(state, 'tuftle');
    }
    expect(state.inventory['tuftle-down']).toBe(0);
  });

  it('yields exactly one trophy on the Nth defeat of that species', () => {
    const state = createInitialState(123);
    for (let i = 0; i < TROPHY_DEFEATS_PER_DROP; i += 1) {
      respawn(state, 'tuftle', i);
      defeatOne(state, 'tuftle');
    }
    expect(state.questProgress.creatureDefeats.tuftle).toBe(TROPHY_DEFEATS_PER_DROP);
    expect(state.inventory['tuftle-down']).toBe(1);
  });

  it('counts each species separately', () => {
    const state = createInitialState(123);
    for (let i = 0; i < TROPHY_DEFEATS_PER_DROP; i += 1) {
      respawn(state, 'craghopper', i);
      defeatOne(state, 'craghopper');
    }
    expect(state.inventory['craghopper-shell']).toBe(1);
    expect(state.inventory['tuftle-down']).toBe(0);
  });

  it('is deterministic: the same defeat sequence always pays the same trophies', () => {
    const run = () => {
      const state = createInitialState(4242);
      for (let i = 0; i < TROPHY_DEFEATS_PER_DROP * 2; i += 1) {
        respawn(state, 'snarlfox', i);
        defeatOne(state, 'snarlfox');
      }
      return state.inventory['snarlfox-pelt'];
    };
    expect(run()).toBe(2);
    expect(run()).toBe(run());
  });

  it('pays base loot worth more than a single gather swing', () => {
    for (const definition of CREATURE_DEFINITIONS) {
      const total = Object.values(definition.encounter.loot).reduce((sum, amount) => sum + (amount ?? 0), 0);
      expect(total).toBeGreaterThanOrEqual(5);
    }
  });
});

describe('reinforced snare', () => {
  function withTrophies(state: GameState): void {
    for (const [resource, amount] of Object.entries(REINFORCED_SNARE_CRAFT_COST) as Array<[ResourceId, number]>) {
      state.inventory[resource] = amount;
    }
  }

  // Deliberately the founding four, not the whole roster: the homestead-defence
  // species are acquired with the snare this recipe produces, so pricing it in
  // their trophies would gate the capture tool behind itself.
  const SNARE_TROPHY_SPECIES = ['tuftle', 'craghopper', 'glade-stag', 'snarlfox'];

  it('requires one trophy from each founding species', () => {
    for (const definition of CREATURE_DEFINITIONS) {
      const cost = REINFORCED_SNARE_CRAFT_COST[definition.encounter.trophy];
      if (SNARE_TROPHY_SPECIES.includes(definition.speciesId)) expect(cost).toBeGreaterThan(0);
      else expect(cost).toBeUndefined();
    }
  });

  it('refuses to craft without the full trophy set', () => {
    const state = createInitialState(1);
    learnBlueprint(state, 'reinforced-snare');
    withTrophies(state);
    state.inventory['snarlfox-pelt'] = 0;
    const result = craftReinforcedSnare(state);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('snarlfox-pelt');
  });

  it('crafts a pair and consumes the trophies', () => {
    const state = createInitialState(1);
    learnBlueprint(state, 'reinforced-snare');
    withTrophies(state);
    expect(craftReinforcedSnare(state).ok).toBe(true);
    expect(state.inventory['reinforced-snare']).toBe(REINFORCED_SNARES_PER_CRAFT);
    for (const trophy of TROPHIES) expect(state.inventory[trophy]).toBe(0);
  });

  it('is preferred over a basic snare when both are carried', () => {
    const state = createInitialState(1);
    state.inventory['taming-snare'] = 3;
    state.inventory['reinforced-snare'] = 1;
    expect(activeSnare(state)?.itemId).toBe('reinforced-snare');
    state.inventory['reinforced-snare'] = 0;
    expect(activeSnare(state)?.itemId).toBe('taming-snare');
  });

  it('reports no snare when the bag holds neither', () => {
    expect(activeSnare(createInitialState(1))).toBeNull();
  });

  it('raises the capture chance over a basic snare', () => {
    const beside = (speciesId: SpeciesId) => {
      const state = createInitialState(123);
      const wild = state.wildCreatures.find((creature) => creature.speciesId === speciesId)!;
      state.player.x = wild.x;
      state.player.y = wild.y;
      wild.hp = Math.floor(wild.maxHp / 2);
      return { state, wild };
    };
    const basic = beside('tuftle');
    basic.state.inventory['taming-snare'] = 1;
    const reinforced = beside('tuftle');
    reinforced.state.inventory['reinforced-snare'] = 1;
    expect(tameChance(reinforced.state, reinforced.wild).chanceBps)
      .toBeGreaterThan(tameChance(basic.state, basic.wild).chanceBps);
  });

  it('spends the reinforced snare on a throw', () => {
    const state = createInitialState(123);
    const wild = state.wildCreatures.find((creature) => creature.speciesId === 'tuftle')!;
    state.player.x = wild.x;
    state.player.y = wild.y;
    wild.hp = 1;
    state.inventory['reinforced-snare'] = 2;
    state.inventory['taming-snare'] = 2;
    throwSnareAtCreature(state, wild.id);
    expect(state.inventory['reinforced-snare']).toBe(1);
    expect(state.inventory['taming-snare']).toBe(2);
  });

  it('keeps the shipped snare tier for the basic snare', () => {
    const state = createInitialState(1);
    state.inventory['taming-snare'] = 1;
    expect(activeSnare(state)?.tierBps).toBe(10_000);
  });

  it('names a trophy on every creature definition', () => {
    for (const definition of CREATURE_DEFINITIONS) {
      expect(creatureDefinition(definition.speciesId).encounter.trophy).toBe(definition.encounter.trophy);
    }
  });
});
