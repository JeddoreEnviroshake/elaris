import type { EncounterAction, EncounterCommandResult } from '../simulation/encounters';
import type { EnemyIntent, GameState, SpeciesId } from '../simulation/state';
import type {CombatStyle} from '../content/creatures';

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
    creaturePos: result.creatureMove?.to ?? result.companionAbility?.enemyMove?.to ?? before.creaturePos,
  };
}

export function battleTrackToWorld(position: number): number {
  return -4 + Math.max(0, Math.min(100, position)) * 0.08;
}

/** Species identity supplies the presentation style when a resolved strike has no explicit style. */
export function creatureAttackStyle(species:SpeciesId):CombatStyle {
  return species==='mistmoth'||species==='snarlfox'?'magic':species==='quillfinch'||species==='slingtail'?'ranged':'melee';
}

/** One spatial timeline shared by the fighters and their projectile endpoints. */
export function battleActorPositions(event:BattleRoundPresentation,progress:number,reducedMotion=false):{playerX:number;creatureX:number} {
  const smooth=(x:number):number=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
  const lerp=(from:number,to:number,t:number):number=>battleTrackToWorld(from)+(battleTrackToWorld(to)-battleTrackToWorld(from))*smooth(t);
  let playerX=battleTrackToWorld(event.before.playerPos),creatureX=battleTrackToWorld(event.before.creaturePos);
  if(reducedMotion)return {playerX:battleTrackToWorld(event.resolved.playerPos),creatureX:battleTrackToWorld(event.resolved.creaturePos)};
  const result=event.result,assist=result.companionAbility;
  if(result.playerMove)playerX=lerp(result.playerMove.from,result.playerMove.to,progress/.34);
  if(assist?.playerMove&&progress>=.39)playerX=lerp(assist.playerMove.from,assist.playerMove.to,(progress-.39)/.27);
  if(assist?.enemyMove&&progress>=.39)creatureX=lerp(assist.enemyMove.from,assist.enemyMove.to,(progress-.39)/.18);
  const enemyStart=assist?.enemyMove ? .58 : .42;
  if(result.creatureMove&&progress>=enemyStart)creatureX=lerp(result.creatureMove.from,result.creatureMove.to,(progress-enemyStart)/(assist?.enemyMove ? .18 : .30));
  if(event.action==='melee'&&progress<.42)playerX+=Math.min(1.3,Math.max(.4,creatureX-playerX-.4))*Math.sin(Math.min(1,progress/.4)*Math.PI);
  if(result.creatureStrike&&(result.creatureStrike.style??creatureAttackStyle(event.before.speciesId))==='melee'&&progress>.63)
    creatureX-=Math.min(1.1,Math.max(.35,creatureX-playerX-.35))*Math.sin(Math.min(1,(progress-.63)/.32)*Math.PI);
  return {playerX,creatureX};
}
