import type { EncounterAction, EncounterCommandResult } from '../simulation/encounters';
import type { EnemyIntent, GameState, SpeciesId } from '../simulation/state';

export interface BattlePresentationSnapshot {
  readonly encounterId: string;
  readonly speciesId: SpeciesId;
  readonly companionSpeciesId: SpeciesId | null;
  readonly magicStaffEquipped: boolean;
  readonly round: number;
  readonly playerHp: number;
  readonly playerMaxHp: number;
  readonly creatureHp: number;
  readonly creatureMaxHp: number;
  readonly playerPos: number;
  readonly creaturePos: number;
  readonly enemyIntent: EnemyIntent;
}

export interface BattleRoundPresentation {
  readonly action: EncounterAction;
  readonly result: EncounterCommandResult;
  readonly before: BattlePresentationSnapshot;
  readonly resolved: BattlePresentationSnapshot;
}

export function captureBattleSnapshot(state: GameState): BattlePresentationSnapshot | null {
  const encounter = state.activeEncounter;
  if (!encounter) return null;
  const wild = state.wildCreatures.find((creature) => creature.id === encounter.wildCreatureId);
  if (!wild) return null;
  const companion = encounter.companionCreatureId
    ? state.ownedCreatures.find((creature) => creature.id === encounter.companionCreatureId) ?? null
    : null;
  const equippedTool = state.tools.find((tool) => tool.instanceId === state.equippedToolId);
  return {
    encounterId: encounter.wildCreatureId,
    speciesId: wild.speciesId,
    companionSpeciesId: companion?.speciesId ?? null,
    magicStaffEquipped: equippedTool?.definitionId === 'magic-staff' && equippedTool.durability > 0,
    round: encounter.round,
    playerHp: state.player.hp,
    playerMaxHp: state.player.maxHp,
    creatureHp: encounter.creatureHp,
    creatureMaxHp: encounter.creatureMaxHp,
    playerPos: encounter.playerPos,
    creaturePos: encounter.creaturePos,
    enemyIntent: encounter.enemyIntent,
  };
}

/** Preserve the terminal pose after the simulation removes an ended encounter. */
export function resolvedBattleSnapshot(
  before: BattlePresentationSnapshot,
  state: GameState,
  result: EncounterCommandResult,
): BattlePresentationSnapshot {
  const current = captureBattleSnapshot(state);
  if (current?.encounterId === before.encounterId) return current;
  const playerDamage = result.creatureStrike && result.creatureStrike.outcome !== 'dodge'
    ? result.creatureStrike.damage : 0;
  const creatureDamage = result.playerStrike
    && result.playerStrike.outcome !== 'miss'
    && result.playerStrike.outcome !== 'dodge'
    ? result.playerStrike.damage : 0;
  return {
    ...before,
    round: before.round + (result.ok ? 1 : 0),
    playerHp: result.playerDefeated ? 0 : Math.max(0, before.playerHp - playerDamage),
    creatureHp: result.defeated
      ? 0
      : Math.max(0, before.creatureHp - creatureDamage - (result.companionAbility?.damage ?? 0)),
    playerPos: result.companionAbility?.playerMove?.to ?? result.playerMove?.to ?? before.playerPos,
    creaturePos: result.companionAbility?.enemyMove?.to ?? result.creatureMove?.to ?? before.creaturePos,
  };
}

export function battleTrackToWorld(position: number): number {
  return -4 + Math.max(0, Math.min(100, position)) * 0.08;
}
