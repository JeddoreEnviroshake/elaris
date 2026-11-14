import { creatureDefinition, MAX_CREATURE_ROSTER } from '../content/creatures';
import { signatureCompanionAbility } from '../content/companionAbilities';
import type { GameState, OwnedCreatureState, WildCreatureState } from './state';

/** The common, atomic ownership transfer for captures and the opening partnership. */
export function acquireWildCreature(state: GameState, wild: WildCreatureState): OwnedCreatureState | null {
  const definition = creatureDefinition(wild.speciesId);
  if (!state.wildCreatures.some((candidate) => candidate.id === wild.id)
    || state.ownedCreatures.length >= MAX_CREATURE_ROSTER
    || state.ownedCreatures.filter((creature) => creature.speciesId === wild.speciesId).length >= definition.rosterLimit) return null;
  const creature: OwnedCreatureState = {
    id: `creature-${state.nextEntityId}`, speciesId: wild.speciesId, name: definition.displayName,
    role: 'rest', assignment: null, worksiteId: null, nextWorkTick: state.tick,
    housingId: null, workRemainderMs: 0, bondXp: 0,
    selectedBattleAbilityId: signatureCompanionAbility(wild.speciesId), level: wild.level,
  };
  state.wildCreatures = state.wildCreatures.filter((candidate) => candidate.id !== wild.id);
  state.ownedCreatures.push(creature);
  if (!state.firstTamedSpeciesIds.includes(wild.speciesId)) state.firstTamedSpeciesIds.push(wild.speciesId);
  state.nextEntityId += 1;
  return creature;
}
