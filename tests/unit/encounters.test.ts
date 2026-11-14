import { describe, expect, it } from 'vitest';
import { learnBlueprint } from '../../src/simulation/blueprintKnowledge';
import {
  craftArrows,
  craftClothMask,
  craftTamingSnare,
  BACKWARD_SP_COST,
  encounterDistance,
  encounterAvailability,
  FORWARD_SP_COST,
  MAGIC_MANA_COST,
  MELEE_STAMINA_COST,
  REST_SP_RECOVER,
  resolveEncounterAction,
  snareChanceBps,
  startNearestEncounter,
} from '../../src/simulation/encounters';
import { creatureDefinition } from '../../src/content/creatures';
import { createInitialState, type GameState, type ResourceId, type SpeciesId } from '../../src/simulation/state';
import { usedInventorySlots } from '../../src/simulation/gameplayCommands';
import { inventoryCapacity } from '../../src/simulation/characterProgression';
import { chooseRespawn, respawnDestinations } from '../../src/simulation/survivalCycle';
import { enclosedEnvironment } from './helpers/buildings';

/** Equip a crafted Bow. The bow is an ordinary tool now, not a durable flag. */
function equipBow(state: { tools: any[]; equippedToolId: string | null }): void {
  state.tools.push({
    instanceId: 'tool-bow-test', definitionId: 'bow', durability: 120,
    maxDurability: 120, powerRank: 0, speedRank: 0, durabilityRank: 0,
  });
  state.equippedToolId = 'tool-bow-test';
}

function equipMagicStaff(state: { tools: any[]; equippedToolId: string | null }, durability = 240): void {
  state.tools.push({
    instanceId: 'tool-staff-test', definitionId: 'magic-staff', durability,
    maxDurability: 240, powerRank: 0, speedRank: 0, durabilityRank: 0,
  });
  state.equippedToolId = 'tool-staff-test';
}


function besideSpecies(speciesId: SpeciesId, seed = 123): GameState {
  const state = createInitialState(seed);
  const wild = state.wildCreatures.find((creature) => creature.speciesId === speciesId);
  if (!wild) throw new Error(`seed ${seed} spawned no ${speciesId}`);
  state.player.x = wild.x;
  state.player.y = wild.y;
  return state;
}

function withTuftleCompanion(state: GameState, selectedBattleAbilityId: 'tuftle-guard' | 'tuftle-heal' | 'tuftle-recover' | 'tuftle-push'): void {
  state.ownedCreatures.push({
    id: 'companion-tuftle', speciesId: 'tuftle', name: 'Moss', role: 'follow', assignment: null,
    worksiteId: null, nextWorkTick: 0, bondXp: 36, selectedBattleAbilityId,
  });
  state.battleCompanionId = 'companion-tuftle';
}

/** Advance rngState until the given action's strike lands (hit or crit). */
function stateWhereStrikeLands(speciesId: SpeciesId, action: 'melee' | 'ranged' | 'magic'): GameState {
  for (let rng = 1; rng < 4000; rng += 1) {
    const state = besideSpecies(speciesId);
    startNearestEncounter(state);
    state.activeEncounter!.playerPos = 60;
    state.activeEncounter!.creaturePos = 70;
    state.rngState = rng;
    const probe = structuredClone(state);
    const result = resolveEncounterAction(probe, action);
    if (result.playerStrike && (result.playerStrike.outcome === 'hit' || result.playerStrike.outcome === 'crit')) return state;
  }
  throw new Error('no rngState found where the strike lands');
}

describe('battle-screen encounters', () => {
  it('starts with full creature HP at a deterministic turn boundary', () => {
    const state = besideSpecies('tuftle');
    expect(startNearestEncounter(state)).toMatchObject({ ok: true });
    const maxHp = creatureDefinition('tuftle').encounter.maxHp;
    expect(state.activeEncounter).toMatchObject({ creatureHp: maxHp, creatureMaxHp: maxHp, round: 1, playerPos: 30, creaturePos: 70 });
  });

  it('melee costs stamina and reports a structured strike outcome', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    state.activeEncounter!.playerPos = 60;
    const result = resolveEncounterAction(state, 'melee');
    expect(result.ok).toBe(true);
    expect(state.player.stamina).toBe(100 - MELEE_STAMINA_COST + state.gameBalance.characterDefaults.staminaRegenBaseHundredths / 100);
    expect(result.playerStrike).toBeDefined();
    expect(['hit', 'crit', 'miss', 'dodge']).toContain(result.playerStrike!.outcome);
  });

  it('ranged consumes an arrow and magic consumes mana, with availability gates', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    state.activeEncounter!.playerPos = 40;
    equipBow(state);
    resolveEncounterAction(state, 'ranged');
    expect(state.inventory.arrow).toBe(4);
    resolveEncounterAction(state, 'magic');
    expect(state.player.mana).toBe(30 - MAGIC_MANA_COST + state.gameBalance.characterDefaults.manaRegenBaseHundredths / 100);

    state.inventory.arrow = 0;
    expect(encounterAvailability(state, 'ranged')).toBe('Craft arrows first');
    state.player.mana = MAGIC_MANA_COST - 1;
    expect(encounterAvailability(state, 'magic')).toBe('Not enough MP');
    state.player.stamina = MELEE_STAMINA_COST - 1;
    state.activeEncounter!.playerPos = state.activeEncounter!.creaturePos - 10;
    expect(encounterAvailability(state, 'melee')).toBe('Not enough SP');
  });

  it('makes the Magic Staff an optional spell focus that adds power and wears per cast', () => {
    const base = stateWhereStrikeLands('craghopper', 'magic');
    const innate = structuredClone(base);
    const focused = structuredClone(base);
    equipMagicStaff(focused);

    const innateResult = resolveEncounterAction(innate, 'magic');
    const focusedResult = resolveEncounterAction(focused, 'magic');

    expect(focusedResult.playerStrike!.damage).toBeGreaterThan(innateResult.playerStrike!.damage);
    expect(focused.tools.at(-1)!.durability).toBe(239);
    expect(focused.equippedToolId).toBe('tool-staff-test');
  });

  it('unequips a Magic Staff that breaks on a cast and reports it in the round result', () => {
    const state = stateWhereStrikeLands('craghopper', 'magic');
    equipMagicStaff(state, 1);

    const result = resolveEncounterAction(state, 'magic');

    expect(result.toolBroke).toBe(true);
    expect(result.message).toContain('Staff broke');
    expect(state.tools.at(-1)!.durability).toBe(0);
    expect(state.equippedToolId).toBeNull();
  });

  it('deals more damage with the weakness style than the resisted style on identical rolls', () => {
    // Craghopper is weak to magic and resists melee. Cloned states consume the
    // same roll sequence, so both strikes land and only the multiplier differs.
    const base = stateWhereStrikeLands('craghopper', 'melee');
    const weak = resolveEncounterAction(structuredClone(base), 'magic');
    const resisted = resolveEncounterAction(structuredClone(base), 'melee');
    expect(weak.playerStrike!.damage).toBeGreaterThan(resisted.playerStrike!.damage);
  });

  it('resolves a snare throw atomically from the displayed chance', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    // The area holds a whole population now, so "gone" means this individual
    // left the world, not that the species did.
    const tamedId = state.activeEncounter!.wildCreatureId;
    state.activeEncounter!.playerPos = 60;
    state.inventory['taming-snare'] = 1;
    expect(snareChanceBps(state)).toBeGreaterThanOrEqual(500);
    for (let rng = 1; rng < 10_000; rng += 1) {
      const probe = structuredClone(state); probe.rngState = rng;
      if (resolveEncounterAction(probe, 'snare').tamed) { state.rngState = rng; break; }
    }
    expect(resolveEncounterAction(state, 'snare')).toMatchObject({ ok: true, ended: true, tamed: true });
    expect(state.inventory['taming-snare']).toBe(0);
    expect(state.ownedCreatures).toHaveLength(1);
    expect(state.ownedCreatures[0]).toMatchObject({ speciesId: 'tuftle' });
    expect(state.firstTamedSpeciesIds).toContain('tuftle');
    expect(state.wildCreatures.some((wild) => wild.id === tamedId)).toBe(false);
  });

  it('grants the species loot when the creature is defeated at 0 HP', () => {
    const state = stateWhereStrikeLands('tuftle', 'melee');
    const defeatedId = state.activeEncounter!.wildCreatureId;
    state.activeEncounter!.creatureHp = 1;
    const result = resolveEncounterAction(state, 'melee');
    expect(result).toMatchObject({ ok: true, ended: true, defeated: true });
    expect(state.inventory.fiber).toBe(creatureDefinition('tuftle').encounter.loot.fiber);
    expect(state.wildCreatures.some((wild) => wild.id === defeatedId)).toBe(false);
    expect(state.activeEncounter).toBeNull();
  });

  it('loses carried inventory and waits for an explicit Bed choice when defeated', () => {
    const state = besideSpecies('tuftle');
    state.buildings = enclosedEnvironment(10, 10, 3, 2, 'indoor');
    state.buildings.push({ id: 'bed-encounter', definitionId: 'bed', tileX: 10, tileY: 10 });
    state.buildings.push({ id: 'purifier-encounter', definitionId: 'air-purifier', tileX: 12, tileY: 11 });
    startNearestEncounter(state);
    state.activeEncounter!.playerPos = 60;
    state.player.hp = 1;
    state.inventory.wood = 10;
    const result = resolveEncounterAction(state, 'melee');
    expect(result).toMatchObject({ ok: true, ended: true, playerDefeated: true });
    expect(state.inventory.wood).toBe(0);
    expect(state.groundDrops).toEqual([]);
    expect(state.player.hp).toBe(0);
    expect(state.pendingRespawn).toMatchObject({ cause: 'creature', lostItemCount: 17 });
    expect(state.activeEncounter).toBeNull();
    const bed = respawnDestinations(state).find((destination) => destination.kind === 'bed')!;
    expect(chooseRespawn(state, bed.id).ok).toBe(true);
    expect(state.player.hp).toBe(state.player.maxHp);
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
    expect(result.creatureStrike).toBeUndefined();
    expect(state.player.hp).toBe(50 + 30);
    expect(state.inventory.berry).toBe(1);
  });

  it('crafts arrows atomically from wood and stone', () => {
    const state = createInitialState(1);
    learnBlueprint(state, 'arrow');
    expect(craftArrows(state)).toMatchObject({ ok: false });
    state.inventory.wood = 1; state.inventory.stone = 1;
    expect(craftArrows(state)).toMatchObject({ ok: true });
    expect(state.inventory).toMatchObject({ wood: 0, stone: 0 });
    expect(state.inventory.arrow).toBe(5 + 3);
  });

  it('crafts stackable Cloth Masks atomically from fiber', () => {
    const state = createInitialState(1);
    learnBlueprint(state, 'cloth-mask');
    expect(craftClothMask(state)).toMatchObject({ ok: false });
    state.inventory.fiber = 9;
    expect(craftClothMask(state)).toMatchObject({ ok: true });
    expect(craftClothMask(state)).toMatchObject({ ok: true });
    expect(state.inventory.fiber).toBe(1);
    expect(state.inventory['cloth-mask']).toBe(2);
  });

  it('refuses the ranged action unless a bow is in hand, whatever the quiver holds', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    state.activeEncounter!.playerPos = 40;
    state.inventory.arrow = 5;
    expect(encounterAvailability(state, 'ranged')).toBe('Equip a bow to loose arrows');
    equipBow(state);
    expect(encounterAvailability(state, 'ranged')).toBeNull();
  });

  it('clamps the live snare chance between 5% and 90%', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    state.activeEncounter!.playerPos = 60;
    state.activeEncounter!.creatureHp = 1;
    state.player.attributes.luck = 100;
    expect(snareChanceBps(state)).toBe(9000);
  });

  it('replays identically from the same saved turn boundary', () => {
    const state = besideSpecies('tuftle', 99);
    startNearestEncounter(state);
    state.activeEncounter!.playerPos = 60;
    state.inventory['taming-snare'] = 1;
    const reloaded = structuredClone(state);
    expect(resolveEncounterAction(state, 'melee')).toEqual(resolveEncounterAction(reloaded, 'melee'));
    expect(reloaded).toEqual(state);
  });

  it('still crafts and consumes taming snares atomically', () => {
    const state = createInitialState(1);
    learnBlueprint(state, 'taming-snare');
    state.inventory.wood = 1; state.inventory.fiber = 2;
    expect(craftTamingSnare(state)).toMatchObject({ ok: true });
    expect(state.inventory).toMatchObject({ wood: 0, fiber: 0 });
    expect(state.inventory['taming-snare']).toBe(1);
  });

  it('crafts a taming snare in a full bag when its ingredients free a slot', () => {
    const state = createInitialState(1);
    learnBlueprint(state, 'taming-snare');
    for (const resource of Object.keys(state.inventory) as ResourceId[]) state.inventory[resource] = 0;
    state.inventory.wood = 1;
    state.inventory.fiber = 2;
    const fillers = (Object.keys(state.inventory) as ResourceId[])
      .filter((resource) => resource !== 'wood' && resource !== 'fiber' && resource !== 'taming-snare');
    for (const resource of fillers) {
      if (usedInventorySlots(state) >= inventoryCapacity(state)) break;
      state.inventory[resource] = 1;
    }
    expect(usedInventorySlots(state)).toBe(inventoryCapacity(state));

    expect(craftTamingSnare(state)).toMatchObject({ ok: true });
    expect(state.inventory).toMatchObject({ wood: 0, fiber: 0, 'taming-snare': 1 });
    expect(usedInventorySlots(state)).toBeLessThanOrEqual(inventoryCapacity(state));
  });

  it('gates melee and ranged by distance while magic remains global', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    expect(encounterDistance(state.activeEncounter!)).toBe(40);
    expect(encounterAvailability(state, 'melee')).toBe('Too far — move closer');
    expect(encounterAvailability(state, 'ranged')).toBe('Too far — move closer');
    expect(encounterAvailability(state, 'magic')).toBeNull();
  });

  it('moves without overshooting either the creature or the map edge', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    state.activeEncounter!.playerPos = 65;
    state.activeEncounter!.creaturePos = 70;
    const forward = resolveEncounterAction(state, 'forward');
    expect(forward.playerMove).toEqual({ from: 65, to: 70 });
    expect(state.activeEncounter!.playerPos).toBe(70);
    expect(state.player.stamina).toBe(100 - FORWARD_SP_COST + 5);

    state.activeEncounter!.playerPos = 4;
    state.activeEncounter!.creaturePos = 40;
    const backward = resolveEncounterAction(state, 'backward');
    expect(backward.playerMove).toEqual({ from: 4, to: 0 });
    expect(state.activeEncounter!.playerPos).toBe(0);
    expect(BACKWARD_SP_COST).toBe(5);
  });

  it('applies attribute regen at encounter start and after the creature turn', () => {
    const state = besideSpecies('tuftle');
    state.player.hp = 50; state.player.stamina = 50; state.player.mana = 10;
    // Half a health a turn lands as a whole point every other turn, which is
    // what the round-numbered pulse counts out.
    state.player.attributes.healthRegen = 2;
    state.player.attributes.staminaRegen = 4;
    state.player.attributes.manaRegen = 4;
    startNearestEncounter(state);
    expect(state.player).toMatchObject({ hp: 51, stamina: 56, mana: 13 });
    resolveEncounterAction(state, 'forward');
    // The stride forward spends five stamina before the round's pulse pays six.
    expect(state.player).toMatchObject({ hp: 51, stamina: 57, mana: 16 });
  });

  it('stacks Rest recovery with the next turn-start regen', () => {
    const state = besideSpecies('tuftle');
    state.player.stamina = 50;
    startNearestEncounter(state);
    expect(state.player.stamina).toBe(55);
    const result = resolveEncounterAction(state, 'rest');
    expect(result.ok).toBe(true);
    expect(state.player.stamina).toBe(55 + REST_SP_RECOVER + 5);
  });

  it('has chase creatures advance and attack after entering their range', () => {
    const state = besideSpecies('tuftle');
    startNearestEncounter(state);
    const first = resolveEncounterAction(state, 'magic');
    expect(first.creatureMove).toEqual({ from: 70, to: 65 });
    expect(first.creatureStrike).toBeUndefined();
    state.activeEncounter!.playerPos = 55;
    const second = resolveEncounterAction(state, 'rest');
    expect(second.creatureMove).toEqual({ from: 65, to: 60 });
    expect(second.creatureStrike).toBeDefined();
  });

  it('has kite creatures retreat to preferred range and then attack', () => {
    const state = besideSpecies('snarlfox');
    startNearestEncounter(state);
    state.activeEncounter!.playerPos = 50;
    state.activeEncounter!.creaturePos = 60;
    const result = resolveEncounterAction(state, 'rest');
    expect(result.creatureMove).toEqual({ from: 60, to: 72 });
    expect(encounterDistance(state.activeEncounter!)).toBe(22);
    expect(result.creatureStrike).toBeDefined();
  });

  it('snapshots the chosen follower and a deterministic enemy intent at encounter start', () => {
    const state = besideSpecies('tuftle');
    withTuftleCompanion(state, 'tuftle-guard');
    startNearestEncounter(state);
    expect(state.activeEncounter).toMatchObject({
      companionCreatureId: 'companion-tuftle', selectedCompanionAbilityId: 'tuftle-guard',
      companionAbilityReadyRounds: {}, enemyIntent: 'advance',
    });
  });

  it('uses Gentle Mend after the player action and persists its absolute cooldown', () => {
    const state = besideSpecies('tuftle');
    withTuftleCompanion(state, 'tuftle-heal');
    state.player.hp = 50;
    startNearestEncounter(state);
    const result = resolveEncounterAction(state, 'forward');
    expect(result.companionAbility).toMatchObject({ abilityId: 'tuftle-heal', healed: 5 });
    expect(state.player.hp).toBe(55);
    expect(state.activeEncounter).toMatchObject({ round: 2, companionAbilityReadyRounds: { 'tuftle-heal': 5 } });
  });

  it('lets Bumper Push change the enemy response before its turn', () => {
    const state = besideSpecies('tuftle');
    withTuftleCompanion(state, 'tuftle-push');
    startNearestEncounter(state);
    state.activeEncounter!.playerPos = 60;
    state.activeEncounter!.creaturePos = 70;
    const result = resolveEncounterAction(state, 'rest');
    expect(result.companionAbility).toMatchObject({ abilityId: 'tuftle-push', enemyMove: { from: 70, to: 78 } });
    expect(result.creatureMove).toEqual({ from: 78, to: 73 });
    expect(result.creatureStrike).toBeUndefined();
  });

  it('applies Shell Guard to only the current enemy strike', () => {
    const state = besideSpecies('tuftle');
    withTuftleCompanion(state, 'tuftle-guard');
    state.player.hp = 50;
    startNearestEncounter(state);
    state.activeEncounter!.playerPos = 62;
    state.activeEncounter!.creaturePos = 70;
    const result = resolveEncounterAction(state, 'rest');
    expect(result.companionAbility).toMatchObject({ abilityId: 'tuftle-guard', guardedDamage: 4 });
    expect(result.creatureStrike?.damage).toBe(0);
    expect(state.player.hp).toBe(50);
    const next = resolveEncounterAction(state, 'rest');
    expect(next.companionAbility).toBeUndefined();
    expect(next.creatureStrike?.damage).toBe(4);
    expect(state.player.hp).toBe(46);
  });
});
