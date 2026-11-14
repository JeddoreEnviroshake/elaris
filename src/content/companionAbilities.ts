import type { CompanionAbilityId, OwnedCreatureState, SpeciesId } from '../simulation/state';

export type CompanionAbilityTiming = 'beforePlayerAction' | 'afterPlayerAction' | 'beforeEnemyAction';

export type CompanionAbilityEffect =
  | { kind: 'guard'; amount: number }
  | { kind: 'heal'; amount: number }
  | { kind: 'recover-stamina'; amount: number }
  | { kind: 'push-enemy'; distance: number; maxRange: number }
  | { kind: 'move-player'; direction: 'forward' | 'backward'; distance: number }
  | { kind: 'nonlethal-damage'; amount: number }
  | { kind: 'player-damage-bonus'; bonusBps: number }
  | { kind: 'player-hit-bonus'; bonusBps: number }
  | { kind: 'ignore-defense'; amount: number }
  | { kind: 'player-dodge-bonus'; bonusBps: number }
  | { kind: 'reduce-enemy-power'; amount: number }
  | { kind: 'interrupt' }
  | { kind: 'prevent-retreat' };

export interface CompanionAbilityDefinition {
  id: CompanionAbilityId;
  displayName: string;
  description: string;
  timing: CompanionAbilityTiming;
  cooldownTurns: number;
  unlockBondLevel: number;
  effect: CompanionAbilityEffect;
}

export const BOND_LEVEL_XP: readonly number[] = [0, 3, 8, 15, 24, 36];

export function creatureBondLevel(creature: Pick<OwnedCreatureState, 'bondXp'>): number {
  let level = 1;
  for (let index = 1; index < BOND_LEVEL_XP.length; index += 1) {
    if (creature.bondXp < BOND_LEVEL_XP[index]!) break;
    level = index + 1;
  }
  return level;
}

export const COMPANION_ABILITIES: Readonly<Record<SpeciesId, readonly CompanionAbilityDefinition[]>> = {
  tuftle: [
    { id: 'tuftle-guard', displayName: 'Shell Guard', description: 'Reduce the next enemy strike this round by 4.', timing: 'beforeEnemyAction', cooldownTurns: 1, unlockBondLevel: 1, effect: { kind: 'guard', amount: 4 } },
    { id: 'tuftle-heal', displayName: 'Gentle Mend', description: 'Restore 5 HP after your action.', timing: 'afterPlayerAction', cooldownTurns: 3, unlockBondLevel: 2, effect: { kind: 'heal', amount: 5 } },
    { id: 'tuftle-recover', displayName: 'Second Wind', description: 'Restore 6 SP after your action.', timing: 'afterPlayerAction', cooldownTurns: 2, unlockBondLevel: 4, effect: { kind: 'recover-stamina', amount: 6 } },
    { id: 'tuftle-push', displayName: 'Bumper Push', description: 'Push a nearby enemy back 8 distance.', timing: 'afterPlayerAction', cooldownTurns: 2, unlockBondLevel: 6, effect: { kind: 'push-enemy', distance: 8, maxRange: 15 } },
  ],
  craghopper: [
    { id: 'craghopper-guard', displayName: 'Stoneguard', description: 'Reduce the next enemy strike this round by 6.', timing: 'beforeEnemyAction', cooldownTurns: 2, unlockBondLevel: 1, effect: { kind: 'guard', amount: 6 } },
    { id: 'craghopper-fracture', displayName: 'Fracture', description: 'Your current attack ignores 3 defense.', timing: 'beforePlayerAction', cooldownTurns: 2, unlockBondLevel: 2, effect: { kind: 'ignore-defense', amount: 3 } },
    { id: 'craghopper-tremor', displayName: 'Tremor', description: 'Interrupt the enemy action this round.', timing: 'beforeEnemyAction', cooldownTurns: 4, unlockBondLevel: 4, effect: { kind: 'interrupt' } },
    { id: 'craghopper-slam', displayName: 'Bounding Slam', description: 'Deal 4 nonlethal damage after your action.', timing: 'afterPlayerAction', cooldownTurns: 2, unlockBondLevel: 6, effect: { kind: 'nonlethal-damage', amount: 4 } },
  ],
  'glade-stag': [
    { id: 'glade-stag-forward', displayName: 'Carry Forward', description: 'Move forward 8 distance without spending SP.', timing: 'afterPlayerAction', cooldownTurns: 2, unlockBondLevel: 1, effect: { kind: 'move-player', direction: 'forward', distance: 8 } },
    { id: 'glade-stag-withdraw', displayName: 'Withdraw', description: 'Move backward 8 distance without spending SP.', timing: 'afterPlayerAction', cooldownTurns: 2, unlockBondLevel: 2, effect: { kind: 'move-player', direction: 'backward', distance: 8 } },
    { id: 'glade-stag-veil', displayName: 'Canopy Veil', description: 'Gain 25% dodge chance this enemy turn.', timing: 'beforeEnemyAction', cooldownTurns: 3, unlockBondLevel: 4, effect: { kind: 'player-dodge-bonus', bonusBps: 2500 } },
    { id: 'glade-stag-charge', displayName: 'Antler Charge', description: 'Deal 5 nonlethal damage after your action.', timing: 'afterPlayerAction', cooldownTurns: 2, unlockBondLevel: 6, effect: { kind: 'nonlethal-damage', amount: 5 } },
  ],
  snarlfox: [
    { id: 'snarlfox-flank', displayName: 'Flank', description: 'Increase your current attack damage by 25%.', timing: 'beforePlayerAction', cooldownTurns: 2, unlockBondLevel: 1, effect: { kind: 'player-damage-bonus', bonusBps: 2500 } },
    { id: 'snarlfox-harass', displayName: 'Harass', description: 'Reduce the enemy strike this round by 4.', timing: 'beforeEnemyAction', cooldownTurns: 2, unlockBondLevel: 2, effect: { kind: 'reduce-enemy-power', amount: 4 } },
    { id: 'snarlfox-pursue', displayName: 'Pursue', description: 'Prevent the enemy from retreating this round.', timing: 'beforeEnemyAction', cooldownTurns: 2, unlockBondLevel: 4, effect: { kind: 'prevent-retreat' } },
    { id: 'snarlfox-feint', displayName: 'Feint', description: 'Increase current attack accuracy by 15%.', timing: 'beforePlayerAction', cooldownTurns: 2, unlockBondLevel: 6, effect: { kind: 'player-hit-bonus', bonusBps: 1500 } },
  ],
  // The homestead-defence roster. Their battle kits lean the way their Work
  // passives do — the Masonmole absorbs, the Boar holds ground, the Quillfinch
  // and Slingtail chip from range, the Mistmoth blunts what is coming.
  masonmole: [
    { id: 'masonmole-brace', displayName: 'Brace', description: 'Reduce the next enemy strike this round by 7.', timing: 'beforeEnemyAction', cooldownTurns: 2, unlockBondLevel: 1, effect: { kind: 'guard', amount: 7 } },
    { id: 'masonmole-shore-up', displayName: 'Shore Up', description: 'Restore 7 HP after your action.', timing: 'afterPlayerAction', cooldownTurns: 3, unlockBondLevel: 2, effect: { kind: 'heal', amount: 7 } },
    { id: 'masonmole-burrow', displayName: 'Burrow', description: 'Gain 20% dodge chance this enemy turn.', timing: 'beforeEnemyAction', cooldownTurns: 3, unlockBondLevel: 4, effect: { kind: 'player-dodge-bonus', bonusBps: 2000 } },
    { id: 'masonmole-collapse', displayName: 'Collapse', description: 'Your current attack ignores 5 defense.', timing: 'beforePlayerAction', cooldownTurns: 3, unlockBondLevel: 6, effect: { kind: 'ignore-defense', amount: 5 } },
  ],
  'bulwark-boar': [
    { id: 'bulwark-boar-bulwark', displayName: 'Bulwark', description: 'Reduce the next enemy strike this round by 9.', timing: 'beforeEnemyAction', cooldownTurns: 3, unlockBondLevel: 1, effect: { kind: 'guard', amount: 9 } },
    { id: 'bulwark-boar-gore', displayName: 'Gore', description: 'Deal 6 nonlethal damage after your action.', timing: 'afterPlayerAction', cooldownTurns: 2, unlockBondLevel: 2, effect: { kind: 'nonlethal-damage', amount: 6 } },
    { id: 'bulwark-boar-stand', displayName: 'Hold the Line', description: 'Prevent the enemy from retreating this round.', timing: 'beforeEnemyAction', cooldownTurns: 2, unlockBondLevel: 4, effect: { kind: 'prevent-retreat' } },
    { id: 'bulwark-boar-charge', displayName: 'Charge', description: 'Push a nearby enemy back 10 distance.', timing: 'afterPlayerAction', cooldownTurns: 3, unlockBondLevel: 6, effect: { kind: 'push-enemy', distance: 10, maxRange: 18 } },
  ],
  quillfinch: [
    { id: 'quillfinch-volley', displayName: 'Volley', description: 'Deal 3 nonlethal damage after your action.', timing: 'afterPlayerAction', cooldownTurns: 1, unlockBondLevel: 1, effect: { kind: 'nonlethal-damage', amount: 3 } },
    { id: 'quillfinch-pin', displayName: 'Pin', description: 'Prevent the enemy from retreating this round.', timing: 'beforeEnemyAction', cooldownTurns: 3, unlockBondLevel: 2, effect: { kind: 'prevent-retreat' } },
    { id: 'quillfinch-dart', displayName: 'Dart', description: 'Increase current attack accuracy by 20%.', timing: 'beforePlayerAction', cooldownTurns: 2, unlockBondLevel: 4, effect: { kind: 'player-hit-bonus', bonusBps: 2000 } },
    { id: 'quillfinch-barb', displayName: 'Barb', description: 'Reduce the enemy strike this round by 5.', timing: 'beforeEnemyAction', cooldownTurns: 2, unlockBondLevel: 6, effect: { kind: 'reduce-enemy-power', amount: 5 } },
  ],
  mistmoth: [
    { id: 'mistmoth-veil', displayName: 'Veil', description: 'Gain 30% dodge chance this enemy turn.', timing: 'beforeEnemyAction', cooldownTurns: 3, unlockBondLevel: 1, effect: { kind: 'player-dodge-bonus', bonusBps: 3000 } },
    { id: 'mistmoth-filter', displayName: 'Clear Air', description: 'Restore 8 SP after your action.', timing: 'afterPlayerAction', cooldownTurns: 3, unlockBondLevel: 2, effect: { kind: 'recover-stamina', amount: 8 } },
    { id: 'mistmoth-dust', displayName: 'Choking Dust', description: 'Interrupt the enemy action this round.', timing: 'beforeEnemyAction', cooldownTurns: 4, unlockBondLevel: 4, effect: { kind: 'interrupt' } },
    { id: 'mistmoth-lull', displayName: 'Lull', description: 'Reduce the enemy strike this round by 6.', timing: 'beforeEnemyAction', cooldownTurns: 2, unlockBondLevel: 6, effect: { kind: 'reduce-enemy-power', amount: 6 } },
  ],
  slingtail: [
    { id: 'slingtail-lob', displayName: 'Lob', description: 'Deal 4 nonlethal damage after your action.', timing: 'afterPlayerAction', cooldownTurns: 2, unlockBondLevel: 1, effect: { kind: 'nonlethal-damage', amount: 4 } },
    { id: 'slingtail-sling', displayName: 'Sling', description: 'Increase your current attack damage by 30%.', timing: 'beforePlayerAction', cooldownTurns: 3, unlockBondLevel: 2, effect: { kind: 'player-damage-bonus', bonusBps: 3000 } },
    { id: 'slingtail-stagger', displayName: 'Stagger', description: 'Push a nearby enemy back 12 distance.', timing: 'afterPlayerAction', cooldownTurns: 3, unlockBondLevel: 4, effect: { kind: 'push-enemy', distance: 12, maxRange: 24 } },
    { id: 'slingtail-barrage', displayName: 'Barrage', description: 'Deal 8 nonlethal damage after your action.', timing: 'afterPlayerAction', cooldownTurns: 4, unlockBondLevel: 6, effect: { kind: 'nonlethal-damage', amount: 8 } },
  ],
};

export const COMPANION_ABILITY_IDS: ReadonlySet<string> = new Set(
  Object.values(COMPANION_ABILITIES).flat().map((ability) => ability.id),
);

export function companionAbilities(speciesId: SpeciesId): readonly CompanionAbilityDefinition[] {
  return COMPANION_ABILITIES[speciesId];
}

export function companionAbility(speciesId: SpeciesId, id: CompanionAbilityId): CompanionAbilityDefinition | null {
  return COMPANION_ABILITIES[speciesId].find((ability) => ability.id === id) ?? null;
}

export function signatureCompanionAbility(speciesId: SpeciesId): CompanionAbilityId {
  return COMPANION_ABILITIES[speciesId][0]!.id;
}

export function isCompanionAbilityId(value: unknown): value is CompanionAbilityId {
  return typeof value === 'string' && COMPANION_ABILITY_IDS.has(value);
}
