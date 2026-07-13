import { describe, expect, it } from 'vitest';
import {
  CAPTURE_FULL_BPS,
  craftArrows,
  craftTamingSnare,
  encounterAvailability,
  MAGIC_MANA_COST,
  MELEE_STAMINA_COST,
  resolveEncounterAction,
  startNearestEncounter,
} from '../../src/simulation/encounters';
import { creatureDefinition } from '../../src/content/creatures';
import { createInitialState, type GameState, type SpeciesId } from '../../src/simulation/state';

function besideSpecies(speciesId: SpeciesId, seed = 123): GameState {
  const state = createInitialState(seed);
  const wild = state.wildCreatures.find((creature) => creature.speciesId === speciesId);
  if (!wild) throw new Error(`seed ${seed} spawned no ${speciesId}`);
  state.player.x = wild.x;
  state.player.y = wild.y;
  return state;
}

/** Advance rngState until the given action's strike lands (hit or crit). */
function stateWhereStrikeLands(speciesId: SpeciesId, action: 'melee' | 'ranged' | 'magic'): GameState {
  for (let rng = 1; rng < 4000; rng += 1) {
    const state = besideSpecies(speciesId);
    startNearestEncounter(state);
    state.rngState = rng;
    const probe = structuredClone(state);
    const result = resolveEncounterAction(probe, action);
    if (result.playerStrike && (result.playerStrike.outcome === 'hit' || result.playerStrike.outcome === 'crit')) return state;
  }
  throw new Error('no rngState found where the strike lands');
}

describe('battle-screen encounters', () => {
  it('starts with a fresh capture meter and full creature HP', () => {
    const state = besideSpecies('tuftle');
    expect(startNearestEncounter(state)).toMatchObject({ ok: true });
    const maxHp = creatureDefinition('tuftle').encounter.maxHp;
    expect(state.activeEncounter).toMatchObject({ creatureHp: maxHp, creatureMaxHp: maxHp, round: 1, captureBps: 0 });
  });

  it('melee costs stamina and reports a structured strike outcome', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    const result = resolveEncounterAction(state, 'melee');
    expect(result.ok).toBe(true);
    expect(state.player.stamina).toBe(100 - MELEE_STAMINA_COST);
    expect(result.playerStrike).toBeDefined();
    expect(['hit', 'crit', 'miss', 'dodge']).toContain(result.playerStrike!.outcome);
  });

  it('ranged consumes an arrow and magic consumes mana, with availability gates', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    resolveEncounterAction(state, 'ranged');
    expect(state.consumables.arrows).toBe(4);
    resolveEncounterAction(state, 'magic');
    expect(state.player.mana).toBe(30 - MAGIC_MANA_COST);

    state.consumables.arrows = 0;
    expect(encounterAvailability(state, 'ranged')).toBe('Craft arrows first');
    state.player.mana = MAGIC_MANA_COST - 1;
    expect(encounterAvailability(state, 'magic')).toBe('Not enough mana');
    state.player.stamina = MELEE_STAMINA_COST - 1;
    expect(encounterAvailability(state, 'melee')).toBe('Not enough stamina');
  });

  it('deals more damage with the weakness style than the resisted style on identical rolls', () => {
    // Craghopper is weak to magic and resists melee. Cloned states consume the
    // same roll sequence, so both strikes land and only the multiplier differs.
    const base = stateWhereStrikeLands('craghopper', 'melee');
    const weak = resolveEncounterAction(structuredClone(base), 'magic');
    const resisted = resolveEncounterAction(structuredClone(base), 'melee');
    expect(weak.playerStrike!.damage).toBeGreaterThan(resisted.playerStrike!.damage);
  });

  it('snares fill the visible capture meter and capture at 100%', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    state.consumables.tamingSnares = 3;
    // Full-HP Tuftle snare: floor(7000 * 10000 / 20000) = 3500 bps, no RNG.
    expect(resolveEncounterAction(state, 'snare')).toMatchObject({ ok: true, captureGainBps: 3500 });
    expect(state.activeEncounter).toMatchObject({ captureBps: 3500 });
    resolveEncounterAction(state, 'snare');
    const third = resolveEncounterAction(state, 'snare');
    expect(third).toMatchObject({ ok: true, ended: true, tamed: true, captureGainBps: 3000 });
    expect(state.consumables.tamingSnares).toBe(0);
    expect(state.ownedCreatures).toHaveLength(1);
    expect(state.ownedCreatures[0]).toMatchObject({ speciesId: 'tuftle' });
    expect(state.wildCreatures.some((wild) => wild.speciesId === 'tuftle')).toBe(false);
  });

  it('feeding a berry calms the creature: capture progress and no counterattack', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    const result = resolveEncounterAction(state, 'feed');
    expect(result).toMatchObject({ ok: true, captureGainBps: 1500 });
    expect(result.creatureStrike).toBeUndefined();
    expect(state.player.hp).toBe(100);
    expect(state.consumables.berries).toBe(1);
  });

  it('grants the species loot when the creature is defeated at 0 HP', () => {
    const state = stateWhereStrikeLands('tuftle', 'melee');
    state.activeEncounter!.creatureHp = 1;
    const result = resolveEncounterAction(state, 'melee');
    expect(result).toMatchObject({ ok: true, ended: true, defeated: true });
    expect(state.inventory.fiber).toBe(creatureDefinition('tuftle').encounter.loot.fiber);
    expect(state.wildCreatures.some((wild) => wild.speciesId === 'tuftle')).toBe(false);
    expect(state.activeEncounter).toBeNull();
  });

  it('drops a share of carried resources where you fell when defeated', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    state.player.hp = 1;
    state.inventory.wood = 10;
    const fellX = state.player.x;
    const result = resolveEncounterAction(state, 'melee');
    expect(result).toMatchObject({ ok: true, ended: true, playerDefeated: true });
    expect(state.inventory.wood).toBe(7);
    expect(state.groundDrops).toContainEqual(expect.objectContaining({ resource: 'wood', amount: 3, x: fellX }));
    expect(state.player.hp).toBe(state.player.maxHp);
    expect(state.activeEncounter).toBeNull();
  });

  it('does not consume an unavailable snare or RNG', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    const rng = state.rngState;
    expect(encounterAvailability(state, 'snare')).toBe('Craft a Taming Snare first');
    expect(resolveEncounterAction(state, 'snare')).toMatchObject({ ok: false });
    expect(state.rngState).toBe(rng);
  });

  it('eats a berry for exactly 30% max HP and rejects use at full health', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    expect(resolveEncounterAction(state, 'berry')).toMatchObject({ ok: false, message: 'Health is already full' });
    state.player.hp = 50;
    const result = resolveEncounterAction(state, 'berry');
    expect(result.ok).toBe(true);
    const counter = result.creatureStrike!.damage;
    expect(state.player.hp).toBe(50 + 30 - counter);
    expect(state.consumables.berries).toBe(1);
  });

  it('crafts arrows atomically from wood and stone', () => {
    const state = createInitialState(1);
    expect(craftArrows(state)).toMatchObject({ ok: false });
    state.inventory.wood = 1; state.inventory.stone = 1;
    expect(craftArrows(state)).toMatchObject({ ok: true });
    expect(state.inventory).toMatchObject({ wood: 0, stone: 0 });
    expect(state.consumables.arrows).toBe(5 + 3);
  });

  it('caps the capture meter at 100%', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    state.activeEncounter!.captureBps = CAPTURE_FULL_BPS - 100;
    state.consumables.tamingSnares = 1;
    const result = resolveEncounterAction(state, 'snare');
    expect(result).toMatchObject({ tamed: true, captureGainBps: 100 });
  });

  it('replays identically from the same saved turn boundary', () => {
    const state = besideSpecies('tuftle', 99);
    startNearestEncounter(state);
    state.consumables.tamingSnares = 1;
    const reloaded = structuredClone(state);
    expect(resolveEncounterAction(state, 'melee')).toEqual(resolveEncounterAction(reloaded, 'melee'));
    expect(reloaded).toEqual(state);
  });

  it('still crafts and consumes taming snares atomically', () => {
    const state = createInitialState(1);
    state.inventory.wood = 1; state.inventory.fiber = 2;
    expect(craftTamingSnare(state)).toMatchObject({ ok: true });
    expect(state.inventory).toMatchObject({ wood: 0, fiber: 0 });
    expect(state.consumables.tamingSnares).toBe(1);
  });
});
