import {
  ARROWS_CRAFT_COST,
  ARROWS_PER_CRAFT,
  BERRY_HEAL_BPS,
  CLOTH_MASK_CRAFT_COST,
  REINFORCED_SNARE_CRAFT_COST,
  REINFORCED_SNARE_TIER_BPS,
  REINFORCED_SNARES_PER_CRAFT,
  TAMING_SNARE_CRAFT_COST,
  SNARE_CHANCE_MAX_BPS,
  SNARE_CHANCE_MIN_BPS,
  TAMING_RANGE_PX,
  TAMING_SNARE_TIER_BPS,
  CREATURE_TAME_XP,
  gameCreatureDefinition,
  leveledCreatureDefinition,
  gameToolDefinition,
} from '../config/balance';
import { blueprintLockedReason } from './blueprintKnowledge';
import { scaleByLevel } from './enemyLevels';
import { MAX_CREATURE_ROSTER, type CombatStyle } from '../content/creatures';
import { companionAbility, creatureBondLevel, type CompanionAbilityDefinition } from '../content/companionAbilities';
import { canAddResourceAfterCost, equippedBow, equippedMagicStaff, nearestWildCreature, tryAddResource, type CommandResult } from './gameplayCommands';
import type { CompanionAbilityId, EncounterState, EnemyIntent, GameState, OwnedCreatureState, ResourceId, WildCreatureState } from './state';
import { applyPlayerRegen, attackPower, battleMoveDistance, defensePower, dodgeChanceBps, grantXp, hitChanceBonusBps, tamingChanceBonusBps } from './characterProgression';
import { beginPlayerDefeat, survivalSchedule } from './survivalCycle';
import { recordAbilityUse, recordCompanionWin, recordCraft, recordEncounter } from './questTracking';
import { awardCreatureDefeat } from './creatureDefeat';
import { reconcileResourceStacks } from './inventoryStacks';
import { acquireWildCreature } from './creatureAcquisition';
import { isOpeningTuftle, isOpeningGuardian } from '../content/onboarding';
import { recordOpeningGuard } from './onboardingProgress';

export type EncounterAction = CombatStyle | 'forward' | 'backward' | 'rest' | 'snare' | 'berry' | 'flee';

export interface PositionChange { from: number; to: number }

/** One resolved swing, structured so the battle screen can animate it. */
export interface StrikeOutcome {
  outcome: 'hit' | 'crit' | 'miss' | 'dodge';
  damage: number;
  style?: CombatStyle;
}

export interface EncounterCommandResult extends CommandResult {
  ended?: boolean;
  tamed?: boolean;
  /** The creature was defeated at 0 HP and its loot granted. */
  defeated?: boolean;
  playerDefeated?: boolean;
  fled?: boolean;
  playerStrike?: StrikeOutcome;
  creatureStrike?: StrikeOutcome;
  /** The snare missed this round; the creature acts next. */
  snareFailed?: boolean;
  playerMove?: PositionChange;
  creatureMove?: PositionChange;
  companionAbility?: CompanionAbilityOutcome;
}

export interface CompanionAbilityOutcome {
  abilityId: CompanionAbilityId;
  displayName: string;
  message: string;
  healed?: number;
  recoveredStamina?: number;
  guardedDamage?: number;
  enemyMove?: PositionChange;
  playerMove?: PositionChange;
  damage?: number;
}

interface CompanionTurnModifiers {
  playerDamageBonusBps: number;
  playerHitBonusBps: number;
  ignoredDefense: number;
  guard: number;
  playerDodgeBonusBps: number;
  enemyPowerReduction: number;
  interrupt: boolean;
  preventRetreat: boolean;
}

export const MAP_SIZE = 100;
export const PLAYER_START = 30;
export const CREATURE_START = 70;
export const MOVE_STEP = 10;
export const MELEE_RANGE = 10;
export const RANGED_RANGE = 30;
export const FORWARD_SP_COST = 5;
export const BACKWARD_SP_COST = 5;
export const MELEE_STAMINA_COST = 10;
export const REST_SP_RECOVER = 10;
export const MAGIC_MANA_COST = 10;
const FLEE_CHANCE_BPS = 7500;
const FLEE_COOLDOWN_TICKS = 300;

/** Per-style combat profile: reliability trades off against raw power. */
export const STYLE_PROFILES: Readonly<Record<CombatStyle, { label: string; hitBps: number; powerPercent: number }>> = {
  melee: { label: 'Melee', hitBps: 8500, powerPercent: 100 },
  ranged: { label: 'Ranged', hitBps: 9500, powerPercent: 90 },
  magic: { label: 'Magic', hitBps: 8000, powerPercent: 130 },
};

type CraftCost = Readonly<Partial<Record<ResourceId, number>>>;

/** The first resource the bag is short of, as a player-facing message. */
function craftShortfall(state: GameState, cost: CraftCost): string | null {
  const missing = Object.entries(cost)
    .find(([resource, amount]) => state.inventory[resource as ResourceId] < amount);
  if (!missing) return null;
  const [resource, amount] = missing;
  return `Need ${amount - state.inventory[resource as ResourceId]} more ${resource}`;
}

function spendCraftCost(state: GameState, cost: CraftCost): void {
  for (const [resource, amount] of Object.entries(cost)) {
    const resourceId = resource as ResourceId;
    state.inventory[resourceId] -= amount;
    reconcileResourceStacks(state, resourceId);
  }
}

/** Add a recipe output atomically, evaluating bag space after its inputs leave. */
function addCraftOutput(state: GameState, resource: ResourceId, amount: number, cost: CraftCost): boolean {
  if (!canAddResourceAfterCost(state, resource, amount, cost)) return false;
  spendCraftCost(state, cost);
  // The capacity check above guarantees this succeeds. Keeping the actual add
  // in the inventory chokepoint also keeps persisted stack boundaries correct.
  return tryAddResource(state, resource, amount);
}

export function craftTamingSnare(state: GameState): CommandResult {
  const locked = blueprintLockedReason(state, 'taming-snare');
  if (locked) return { ok: false, message: locked };
  const shortfall = craftShortfall(state, TAMING_SNARE_CRAFT_COST);
  if (shortfall) return { ok: false, message: shortfall };
  if (!addCraftOutput(state, 'taming-snare', 1, TAMING_SNARE_CRAFT_COST)) return { ok: false, message: 'Bag is full' };
  recordCraft(state, 'taming-snare');
  grantXp(state, 10);
  return { ok: true, message: 'Crafted Taming Snare' };
}

/**
 * The trophy snare. Its cost is one material from every species, so reaching it
 * means having hunted the whole roster rather than farming the easiest creature
 * repeatedly — and what it buys is a better chance at keeping the next one.
 */
export function craftReinforcedSnare(state: GameState): CommandResult {
  const locked = blueprintLockedReason(state, 'reinforced-snare');
  if (locked) return { ok: false, message: locked };
  const shortfall = craftShortfall(state, REINFORCED_SNARE_CRAFT_COST);
  if (shortfall) return { ok: false, message: shortfall };
  if (!addCraftOutput(state, 'reinforced-snare', REINFORCED_SNARES_PER_CRAFT, REINFORCED_SNARE_CRAFT_COST)) {
    return { ok: false, message: 'Bag is full' };
  }
  recordCraft(state, 'reinforced-snare', REINFORCED_SNARES_PER_CRAFT);
  grantXp(state, 25);
  return { ok: true, message: `Crafted ${REINFORCED_SNARES_PER_CRAFT} Reinforced Snares` };
}

export function craftArrows(state: GameState): CommandResult {
  const locked = blueprintLockedReason(state, 'arrow');
  if (locked) return { ok: false, message: locked };
  const shortfall = craftShortfall(state, ARROWS_CRAFT_COST);
  if (shortfall) return { ok: false, message: shortfall };
  if (!addCraftOutput(state, 'arrow', ARROWS_PER_CRAFT, ARROWS_CRAFT_COST)) return { ok: false, message: 'Bag is full' };
  recordCraft(state, 'arrows', ARROWS_PER_CRAFT);
  grantXp(state, 5);
  return { ok: true, message: `Crafted ${ARROWS_PER_CRAFT} Arrows` };
}

/**
 * Handcrafted fog filter. Kept beside the other consumable recipes rather than
 * with the survival cycle: what the player does here is craft, and the mask is
 * spent for them by advanceSurvivalCycle without ever being "used".
 */
export function craftClothMask(state: GameState): CommandResult {
  const locked = blueprintLockedReason(state, 'cloth-mask');
  if (locked) return { ok: false, message: locked };
  const shortfall = craftShortfall(state, CLOTH_MASK_CRAFT_COST);
  if (shortfall) return { ok: false, message: shortfall };
  if (!addCraftOutput(state, 'cloth-mask', 1, CLOTH_MASK_CRAFT_COST)) return { ok: false, message: 'Bag is full' };
  recordCraft(state, 'cloth-mask');
  grantXp(state, 8);
  return { ok: true, message: 'Crafted Cloth Mask' };
}

export function startNearestEncounter(state: GameState): EncounterCommandResult {
  if (state.activeEncounter) return { ok: false, message: 'An encounter is already active' };
  const wild = nearestWildCreature(state);
  if (!wild) return { ok: false, message: 'Move closer to a wild creature' };
  return beginEncounter(state, wild);
}

/**
 * Start an encounter with a specific creature the player clicked. Clicking a
 * creature disambiguates it from any other nearby target, so this is targeted
 * rather than nearest — but it still enforces the same taming range.
 */
export function startEncounterWithCreature(
  state: GameState,
  creatureId: string,
  range = TAMING_RANGE_PX,
): EncounterCommandResult {
  if (state.activeEncounter) return { ok: false, message: 'An encounter is already active' };
  const wild = state.wildCreatures.find((creature) => creature.id === creatureId);
  if (!wild) return { ok: false, message: 'Move closer to a wild creature' };
  const distance = Math.hypot(wild.x - state.player.x, wild.y - state.player.y);
  if (distance > range) return { ok: false, message: 'Move closer to a wild creature' };
  return beginEncounter(state, wild);
}

/**
 * Throw a snare at the creature the player has selected, which is now the only
 * way into a taming session.
 *
 * Tapping a creature used to open this panel, which meant the overworld had no
 * way to simply attack one — the tap was taming and nothing else. The tap is a
 * swing now, exactly as it is for a raider, and the snare is what says "I want
 * this one alive". A snare in the bag is the gate; the throw itself is spent
 * inside the session by the `snare` action, so nothing is consumed twice.
 */
export function throwSnareAtCreature(
  state: GameState,
  creatureId: string,
  range = TAMING_RANGE_PX,
): EncounterCommandResult {
  const blocked = snareThrowBlockedReason(state, creatureId, range);
  if (blocked) return { ok: false, message: blocked };
  return startEncounterWithCreature(state, creatureId, range);
}

/**
 * Why a snare cannot be thrown at `creatureId`, or null when it can. Exported
 * so the HUD's Throw Snare button carries the same answer the command would
 * give — a button that offers a throw the simulation will refuse is worse than
 * no button.
 */
export function snareThrowBlockedReason(
  state: GameState,
  creatureId: string,
  range = TAMING_RANGE_PX,
): string | null {
  if (state.activeEncounter) return 'An encounter is already active';
  if (!activeSnare(state)) return 'Craft a Taming Snare first';
  const wild = state.wildCreatures.find((creature) => creature.id === creatureId);
  if (!wild || wild.hp <= 0) return 'Move closer to a wild creature';
  if (Math.hypot(wild.x - state.player.x, wild.y - state.player.y) > range) {
    return 'Move closer to a wild creature';
  }
  // Refused before the session opens rather than on the throw inside it: a
  // roster that cannot accept this species means the whole session is a
  // pointless detour, and the player should hear that while they can still
  // just fight the thing.
  return snareBlockedReason(state, wild);
}

function beginEncounter(state: GameState, wild: WildCreatureState): EncounterCommandResult {
  if (isOpeningTuftle(state, wild.id)) return { ok: false, message: 'Choose Help Tuftle to earn this creature’s trust.' };
  if (wild.encounterCooldownUntilTick > state.tick) return { ok: false, message: 'This creature is keeping its distance' };
  // A battle takes the player's feet away, and the storm's only answer is to
  // move. Opening one mid-storm would be asking them to dodge without legs.
  const timer = survivalSchedule(state);
  if (timer.phase === 'danger' && timer.threat === 'storm') {
    return { ok: false, message: 'The Arcane Storm makes an encounter unsafe' };
  }
  const definition = leveledCreatureDefinition(state, wild);
  recordEncounter(state, wild.speciesId);
  const companion = activeBattleCompanion(state);
  state.activeEncounter = {
    wildCreatureId: wild.id,
    // Seeded from the creature's world health, not from its maximum. Health
    // lives on the creature now, so a battle opened against something already
    // worn down must not hand it a full bar back.
    creatureHp: Math.min(wild.hp, definition.encounter.maxHp),
    creatureMaxHp: definition.encounter.maxHp,
    round: 1,
    message: `A wild ${definition.displayName} approaches. Your turn.`,
    playerPos: PLAYER_START,
    creaturePos: CREATURE_START,
    companionCreatureId: companion?.id ?? null,
    selectedCompanionAbilityId: companion?.selectedBattleAbilityId ?? null,
    companionAbilityReadyRounds: {},
    enemyIntent: 'watch',
  };
  state.activeEncounter.enemyIntent = predictEnemyIntent(state.activeEncounter, definition.encounter);
  applyPlayerRegen(state, false, state.activeEncounter.round);
  return { ok: true, message: state.activeEncounter.message };
}

export function enemyIntentLabel(intent: EnemyIntent): string {
  if (intent === 'advance') return 'Advance';
  if (intent === 'strike') return 'Strike';
  if (intent === 'advance-strike') return 'Advance and Strike';
  if (intent === 'retreat-strike') return 'Retreat and Strike';
  return 'Watch';
}

/** Exact reason an ability cannot produce an effect at the current turn boundary. */
export function companionAbilityAvailability(state: GameState, abilityId: CompanionAbilityId): string | null {
  const encounter = state.activeEncounter;
  const companion = encounter ? encounterCompanion(state, encounter) : activeBattleCompanion(state);
  if (!companion) return 'No Battle Companion is available';
  const ability = companionAbility(companion.speciesId, abilityId);
  if (!ability) return 'This creature cannot use that ability';
  if (creatureBondLevel(companion) < ability.unlockBondLevel) return `Requires Bond ${ability.unlockBondLevel}`;
  if (!encounter) return null;
  const readyRound = encounter.companionAbilityReadyRounds[abilityId] ?? 1;
  if (encounter.round < readyRound) return `Cooldown ${readyRound - encounter.round}`;
  const effect = ability.effect;
  if (effect.kind === 'heal' && state.player.hp >= state.player.maxHp) return 'Health is full';
  if (effect.kind === 'recover-stamina' && state.player.stamina >= state.player.maxStamina) return 'Stamina is full';
  if (effect.kind === 'push-enemy' && encounterDistance(encounter) > effect.maxRange) return 'Enemy is too far away';
  if (effect.kind === 'move-player' && effect.direction === 'forward' && encounterDistance(encounter) === 0) return 'Already beside the enemy';
  if (effect.kind === 'move-player' && effect.direction === 'backward' && encounter.playerPos === 0) return 'Already at the arena edge';
  return null;
}

/** Null when the action is currently usable, otherwise the disabling reason. */
export function encounterAvailability(state: GameState, action: EncounterAction): string | null {
  const encounter = state.activeEncounter;
  if (!encounter) return 'No active encounter';
  if (action === 'snare' && isOpeningGuardian(state, encounter.wildCreatureId)) return 'This is optional guard practice. Defeat the creature or retreat; no snare is needed.';
  const distance = encounterDistance(encounter);
  if (action === 'forward') {
    if (distance === 0) return 'Already beside the creature';
    if (state.player.stamina < FORWARD_SP_COST) return 'Not enough SP';
  }
  if (action === 'backward') {
    if (encounter.playerPos === 0) return 'Already at the edge of the arena';
    if (state.player.stamina < BACKWARD_SP_COST) return 'Not enough SP';
  }
  if (action === 'melee') {
    if (distance > MELEE_RANGE) return 'Too far — move closer';
    if (state.player.stamina < MELEE_STAMINA_COST) return 'Not enough SP';
  }
  if (action === 'ranged') {
    if (distance > RANGED_RANGE) return 'Too far — move closer';
    if (!equippedBow(state)) return 'Equip a bow to loose arrows';
    if (state.inventory.arrow <= 0) return 'Craft arrows first';
  }
  if (action === 'magic' && state.player.mana < MAGIC_MANA_COST) return 'Not enough MP';
  if (action === 'snare') {
    // Disabled — before item consumption or RNG — when the roster cannot
    // accept the creature, so a throw can never waste a snare pointlessly.
    if (!activeSnare(state)) return 'Craft a Taming Snare first';
    return snareBlockedReason(state);
  }
  if (action === 'berry') {
    if (state.inventory.berry <= 0) return 'No berries available';
    if (state.player.hp >= state.player.maxHp) return 'Health is already full';
  }
  return null;
}

/**
 * Why the roster cannot accept `target`, or null when it can. Defaults to the
 * creature in the open session so the battle button can ask about the fight it
 * is in; the overworld snare throw passes the creature it is aimed at, which is
 * how the same rule gets enforced before a session ever opens.
 */
function snareBlockedReason(state: GameState, target?: WildCreatureState): string | null {
  const encounter = state.activeEncounter;
  const wild = target ?? (encounter ? findWild(state, encounter) : undefined);
  if (!wild) return null;
  const definition = leveledCreatureDefinition(state, wild);
  if (state.ownedCreatures.length >= MAX_CREATURE_ROSTER) return 'Creature roster is full';
  if (state.ownedCreatures.filter((owned) => owned.speciesId === wild.speciesId).length >= definition.rosterLimit) {
    return `${definition.displayName} is already in your roster`;
  }
  return null;
}

export function resolveEncounterAction(state: GameState, action: EncounterAction): EncounterCommandResult {
  const disabled = encounterAvailability(state, action);
  if (disabled) return { ok: false, message: disabled };
  const encounter = state.activeEncounter!;
  const wild = findWild(state, encounter);
  if (!wild) { state.activeEncounter = null; return { ok: false, ended: true, message: 'The creature is no longer here' }; }
  const definition = leveledCreatureDefinition(state, wild);

  let playerMessage = '';
  let companionMessage = '';
  const result: EncounterCommandResult = { ok: true, message: '' };
  const companion = encounterCompanion(state, encounter);
  const selectedAbility = companion && encounter.selectedCompanionAbilityId
    ? companionAbility(companion.speciesId, encounter.selectedCompanionAbilityId)
    : null;
  const abilityReady = selectedAbility !== null
    && creatureBondLevel(companion!) >= selectedAbility.unlockBondLevel
    && encounter.round >= (encounter.companionAbilityReadyRounds[selectedAbility.id] ?? 1);
  const modifiers: CompanionTurnModifiers = {
    playerDamageBonusBps: 0,
    playerHitBonusBps: 0,
    ignoredDefense: 0,
    guard: 0,
    playerDodgeBonusBps: 0,
    enemyPowerReduction: 0,
    interrupt: false,
    preventRetreat: false,
  };
  const recordAbility = (ability: CompanionAbilityDefinition, message: string, details: Omit<CompanionAbilityOutcome, 'abilityId' | 'displayName' | 'message'> = {}): void => {
    encounter.companionAbilityReadyRounds[ability.id] = encounter.round + ability.cooldownTurns + 1;
    result.companionAbility = { abilityId: ability.id, displayName: ability.displayName, message, ...details };
    companionMessage = message;
    recordAbilityUse(state, ability.id);
  };

  if (abilityReady && selectedAbility?.timing === 'beforePlayerAction' && isAttackAction(action)) {
    const effect = selectedAbility.effect;
    if (effect.kind === 'player-damage-bonus') modifiers.playerDamageBonusBps = effect.bonusBps;
    else if (effect.kind === 'player-hit-bonus') modifiers.playerHitBonusBps = effect.bonusBps;
    else if (effect.kind === 'ignore-defense') modifiers.ignoredDefense = effect.amount;
    if (modifiers.playerDamageBonusBps || modifiers.playerHitBonusBps || modifiers.ignoredDefense) {
      recordAbility(selectedAbility, `${companion!.name} uses ${selectedAbility.displayName}.`);
    }
  }

  if (action === 'melee' || action === 'ranged' || action === 'magic') {
    const toolBroke = payStyleCost(state, action);
    if (toolBroke) result.toolBroke = true;
    const strike = rollPlayerStrike(state, action, definition.encounter, modifiers);
    result.playerStrike = strike;
    const brokenSuffix = result.toolBroke ? ' · Staff broke' : '';
    if (strike.outcome === 'miss') {
      playerMessage = `Your ${STYLE_PROFILES[action].label.toLowerCase()} attack misses.${brokenSuffix}`;
    } else if (strike.outcome === 'dodge') {
      playerMessage = `${definition.displayName} dodges!${brokenSuffix}`;
    } else {
      encounter.creatureHp = Math.max(0, encounter.creatureHp - strike.damage);
      playerMessage = `${STYLE_PROFILES[action].label} hits for ${strike.damage}${strike.outcome === 'crit' ? ' — critical!' : '.'}${brokenSuffix}`;
      if (encounter.creatureHp === 0) return defeatCreature(state, wild, result, playerMessage);
    }
  } else if (action === 'forward') {
    state.player.stamina -= FORWARD_SP_COST;
    const from = encounter.playerPos;
    encounter.playerPos = Math.min(encounter.creaturePos, encounter.playerPos + battleMoveDistance(state, MOVE_STEP));
    result.playerMove = { from, to: encounter.playerPos };
    playerMessage = `You move forward to distance ${encounterDistance(encounter)}.`;
  } else if (action === 'backward') {
    state.player.stamina -= BACKWARD_SP_COST;
    const from = encounter.playerPos;
    encounter.playerPos = Math.max(0, encounter.playerPos - battleMoveDistance(state, MOVE_STEP));
    result.playerMove = { from, to: encounter.playerPos };
    playerMessage = `You move backward to distance ${encounterDistance(encounter)}.`;
  } else if (action === 'rest') {
    const recovered = Math.min(REST_SP_RECOVER, state.player.maxStamina - state.player.stamina);
    state.player.stamina += recovered;
    playerMessage = `You rest and recover ${recovered} SP.`;
  } else if (action === 'snare') {
    // Spec formula per throw; the item and turn are spent either way.
    const snare = activeSnare(state)!;
    state.inventory[snare.itemId] -= 1;
    const chanceBps = snareChanceBps(state);
    if (rollBps(state) < chanceBps) {
      return tame(state, wild, result, `The ${snare.label} holds — ${definition.displayName} is captured!`);
    }
    result.snareFailed = true;
    playerMessage = `${definition.displayName} slips out of the ${snare.label} (${Math.round(chanceBps / 100)}% chance).`;
  } else if (action === 'berry') {
    state.inventory.berry -= 1;
    const healed = Math.min(Math.floor(state.player.maxHp * BERRY_HEAL_BPS / 10000), state.player.maxHp - state.player.hp);
    state.player.hp += healed;
    playerMessage = `Berry restores ${healed} HP.`;
  } else {
    if (isOpeningGuardian(state, wild.id) || rollBps(state) < FLEE_CHANCE_BPS) {
      wild.encounterCooldownUntilTick = isOpeningGuardian(state, wild.id) ? state.tick : state.tick + FLEE_COOLDOWN_TICKS;
      wild.hp = encounter.creatureHp;
      state.activeEncounter = null;
      return { ...result, ended: true, fled: true, message: 'You got away safely.' };
    }
    playerMessage = 'You fail to get away.';
  }

  if (abilityReady && selectedAbility?.timing === 'afterPlayerAction' && !result.companionAbility) {
    const effect = selectedAbility.effect;
    if (effect.kind === 'heal') {
      const healed = Math.min(effect.amount, state.player.maxHp - state.player.hp);
      if (healed > 0) {
        state.player.hp += healed;
        recordAbility(selectedAbility, `${companion!.name}'s ${selectedAbility.displayName} restores ${healed} HP.`, { healed });
      }
    } else if (effect.kind === 'recover-stamina') {
      const recovered = Math.min(effect.amount, state.player.maxStamina - state.player.stamina);
      if (recovered > 0) {
        state.player.stamina += recovered;
        recordAbility(selectedAbility, `${companion!.name}'s ${selectedAbility.displayName} restores ${recovered} SP.`, { recoveredStamina: recovered });
      }
    } else if (effect.kind === 'push-enemy' && encounterDistance(encounter) <= effect.maxRange) {
      const from = encounter.creaturePos;
      encounter.creaturePos = Math.min(MAP_SIZE, encounter.creaturePos + effect.distance);
      if (encounter.creaturePos !== from) recordAbility(selectedAbility, `${companion!.name} pushes the enemy back.`, { enemyMove: { from, to: encounter.creaturePos } });
    } else if (effect.kind === 'move-player') {
      const from = encounter.playerPos;
      encounter.playerPos = effect.direction === 'forward'
        ? Math.min(encounter.creaturePos, encounter.playerPos + effect.distance)
        : Math.max(0, encounter.playerPos - effect.distance);
      if (encounter.playerPos !== from) recordAbility(selectedAbility, `${companion!.name} carries you ${effect.direction}.`, { playerMove: { from, to: encounter.playerPos } });
    } else if (effect.kind === 'nonlethal-damage') {
      const damage = Math.min(effect.amount, Math.max(0, encounter.creatureHp - 1));
      if (damage > 0) {
        encounter.creatureHp -= damage;
        recordAbility(selectedAbility, `${companion!.name}'s ${selectedAbility.displayName} deals ${damage} nonlethal damage.`, { damage });
      }
    }
  }

  if (abilityReady && selectedAbility?.timing === 'beforeEnemyAction' && !result.companionAbility) {
    const effect = selectedAbility.effect;
    if (effect.kind === 'guard') {
      modifiers.guard = effect.amount;
      recordAbility(selectedAbility, `${companion!.name} guards you for ${effect.amount} damage.`);
    } else if (effect.kind === 'player-dodge-bonus') {
      modifiers.playerDodgeBonusBps = effect.bonusBps;
      recordAbility(selectedAbility, `${companion!.name}'s ${selectedAbility.displayName} conceals your movement.`);
    } else if (effect.kind === 'reduce-enemy-power') {
      modifiers.enemyPowerReduction = effect.amount;
      recordAbility(selectedAbility, `${companion!.name} harasses the enemy.`);
    } else if (effect.kind === 'interrupt' && intentIncludesStrike(encounter.enemyIntent)) {
      modifiers.interrupt = true;
      recordAbility(selectedAbility, `${companion!.name}'s ${selectedAbility.displayName} interrupts the attack.`);
    } else if (effect.kind === 'prevent-retreat' && definition.encounter.behavior === 'kite' && encounterDistance(encounter) < (definition.encounter.preferredRange ?? definition.encounter.attackRange)) {
      modifiers.preventRetreat = true;
      recordAbility(selectedAbility, `${companion!.name} blocks the enemy's retreat.`);
    }
  }

  const creatureTurn = resolveCreatureTurn(state, definition.encounter, modifiers);
  if (creatureTurn.move) result.creatureMove = creatureTurn.move;
  const counter = creatureTurn.strike;
  if (counter) result.creatureStrike = counter;
  let creatureMessage = creatureTurn.message;
  if (counter?.outcome === 'dodge') creatureMessage = `${creatureMessage} You dodge ${definition.displayName}'s attack.`;
  if (counter && counter.outcome !== 'dodge') {
    if (modifiers.guard > 0) {
      const guarded = Math.min(modifiers.guard, counter.damage);
      counter.damage -= guarded;
      if (result.companionAbility) result.companionAbility.guardedDamage = guarded;
      recordOpeningGuard(state, wild.id, guarded);
    }
    state.player.hp = Math.max(0, state.player.hp - counter.damage);
    if (state.player.hp === 0) return defeatPlayer(state, wild, result, playerMessage);
    creatureMessage = `${creatureMessage} ${definition.displayName} deals ${counter.damage} damage.`;
  }
  encounter.round += 1;
  wild.hp = encounter.creatureHp;
  applyPlayerRegen(state, false, encounter.round);
  encounter.enemyIntent = predictEnemyIntent(encounter, definition.encounter);
  encounter.message = `${playerMessage} ${companionMessage} ${creatureMessage} Your turn.`.replace(/\s+/g, ' ').trim();
  return { ...result, message: encounter.message };
}

function isAttackAction(action: EncounterAction): action is CombatStyle {
  return action === 'melee' || action === 'ranged' || action === 'magic';
}

function intentIncludesStrike(intent: EnemyIntent): boolean {
  return intent === 'strike' || intent === 'advance-strike' || intent === 'retreat-strike';
}

export function encounterDistance(encounter: EncounterState): number {
  return Math.max(0, encounter.creaturePos - encounter.playerPos);
}

function predictEnemyIntent(
  encounter: EncounterState,
  enemy: { moveSpeed: number; attackRange: number; behavior: 'chase' | 'kite'; preferredRange?: number },
): EnemyIntent {
  const distance = encounterDistance(encounter);
  if (enemy.behavior === 'kite') {
    const preferred = enemy.preferredRange ?? enemy.attackRange;
    if (distance < preferred) return distance <= enemy.attackRange ? 'retreat-strike' : 'advance';
    if (distance > preferred) return distance - enemy.moveSpeed <= enemy.attackRange ? 'advance-strike' : 'advance';
    return distance <= enemy.attackRange ? 'strike' : 'watch';
  }
  if (distance <= enemy.attackRange) return 'strike';
  return distance - enemy.moveSpeed <= enemy.attackRange ? 'advance-strike' : 'advance';
}

function activeBattleCompanion(state: GameState): OwnedCreatureState | null {
  if (!state.battleCompanionId) return null;
  return state.ownedCreatures.find((creature) => creature.id === state.battleCompanionId && creature.role === 'follow') ?? null;
}

function encounterCompanion(state: GameState, encounter: EncounterState): OwnedCreatureState | null {
  if (!encounter.companionCreatureId) return null;
  return state.ownedCreatures.find((creature) => creature.id === encounter.companionCreatureId) ?? null;
}

/** Chase creatures attack after entering range; kiters reposition first, then attack. */
function resolveCreatureTurn(
  state: GameState,
  enemy: { attackPower: number; moveSpeed: number; attackRange: number; behavior: 'chase' | 'kite'; preferredRange?: number },
  modifiers: CompanionTurnModifiers,
): { move?: PositionChange; strike?: StrikeOutcome; message: string } {
  const encounter = state.activeEncounter!;
  const from = encounter.creaturePos;
  let distance = encounterDistance(encounter);

  if (enemy.behavior === 'chase' && distance > enemy.attackRange) {
    encounter.creaturePos = Math.max(encounter.playerPos, encounter.creaturePos - enemy.moveSpeed);
  } else if (enemy.behavior === 'kite') {
    const preferred = enemy.preferredRange ?? enemy.attackRange;
    if (distance > preferred) {
      encounter.creaturePos = Math.max(encounter.playerPos, encounter.creaturePos - Math.min(enemy.moveSpeed, distance - preferred));
    } else if (distance < preferred && !modifiers.preventRetreat) {
      encounter.creaturePos = Math.min(MAP_SIZE, encounter.creaturePos + Math.min(enemy.moveSpeed, preferred - distance));
    }
  }

  distance = encounterDistance(encounter);
  const move = from === encounter.creaturePos ? undefined : { from, to: encounter.creaturePos };
  const moveMessage = move
    ? encounter.creaturePos < from ? 'The creature advances.' : 'The creature retreats.'
    : '';
  if (modifiers.interrupt) return move
    ? { move, message: `${moveMessage} The enemy is interrupted.`.trim() }
    : { message: 'The enemy is interrupted.' };
  if (distance > enemy.attackRange) return move
    ? { move, message: moveMessage }
    : { message: 'The creature watches from out of range.' };
  const strike = rollCreatureStrike(state, Math.max(0, enemy.attackPower - modifiers.enemyPowerReduction), modifiers.playerDodgeBonusBps);
  return move ? { move, strike, message: moveMessage } : { strike, message: moveMessage };
}

function payStyleCost(state: GameState, style: CombatStyle): boolean {
  if (style === 'melee') {
    state.player.stamina -= MELEE_STAMINA_COST;
    return false;
  }
  if (style === 'ranged') {
    state.inventory.arrow -= 1;
    return false;
  }

  state.player.mana -= MAGIC_MANA_COST;
  const staff = equippedMagicStaff(state);
  if (!staff) return false;
  const definition = gameToolDefinition(state, staff.definitionId);
  const wear = Math.max(1, definition.wearPerHit * (definition.wearMultiplierByTarget.raider ?? 1));
  staff.durability = Math.max(0, staff.durability - wear);
  if (staff.durability > 0) return false;
  state.equippedToolId = null;
  return true;
}

/** Fixed roll order (hit → dodge → crit) keeps replays deterministic. */
function rollPlayerStrike(
  state: GameState,
  style: CombatStyle,
  enemy: { defense: number; weakTo: CombatStyle; resistTo: CombatStyle; dodgeBps: number },
  modifiers: Pick<CompanionTurnModifiers, 'playerDamageBonusBps' | 'playerHitBonusBps' | 'ignoredDefense'>,
): StrikeOutcome {
  const hitBps = Math.min(10_000, STYLE_PROFILES[style].hitBps + hitChanceBonusBps(state) + modifiers.playerHitBonusBps);
  if (rollBps(state) >= hitBps) return { outcome: 'miss', damage: 0, style };
  if (rollBps(state) < enemy.dodgeBps) return { outcome: 'dodge', damage: 0, style };
  let power = Math.floor(attackPower(state, style) * STYLE_PROFILES[style].powerPercent / 100);
  power = Math.floor(power * (10_000 + modifiers.playerDamageBonusBps) / 10_000);
  if (style === enemy.weakTo) power = Math.floor(power * 150 / 100);
  if (style === enemy.resistTo) power = Math.floor(power * 50 / 100);
  return { outcome: 'hit', damage: Math.max(1, power - Math.max(0, enemy.defense - modifiers.ignoredDefense)), style };
}

function rollCreatureStrike(state: GameState, power: number, companionDodgeBonusBps = 0): StrikeOutcome {
  const playerDodgeBps = Math.min(10_000, dodgeChanceBps(state) + companionDodgeBonusBps);
  if (playerDodgeBps > 0 && rollBps(state) < playerDodgeBps) return { outcome: 'dodge', damage: 0 };
  return { outcome: 'hit', damage: Math.max(1, power - defensePower(state)) };
}

/**
 * The snare a throw would spend, strongest first. The player chooses by what
 * they pack rather than by a second battle button: carrying a Reinforced Snare
 * means it gets used, which keeps the encounter's action list unchanged.
 */
export function activeSnare(state: GameState): { itemId: 'reinforced-snare' | 'taming-snare'; tierBps: number; label: string } | null {
  if (state.inventory['reinforced-snare'] > 0) {
    return { itemId: 'reinforced-snare', tierBps: REINFORCED_SNARE_TIER_BPS, label: 'reinforced snare' };
  }
  if (state.inventory['taming-snare'] > 0) {
    return { itemId: 'taming-snare', tierBps: TAMING_SNARE_TIER_BPS, label: 'snare' };
  }
  return null;
}

/**
 * Current Throw Snare success chance in basis points, from the spec formula
 *   chance = clamp(speciesEase × snareTier × (1.5 − hpPercent), 0.05, 0.90)
 * evaluated in integer fixed point, plus the Luck attribute bonus. The tier is
 * the one belonging to the snare a throw would actually spend.
 * Exported so the battle UI can show the live chance on the button.
 */
export function snareChanceBps(state: GameState): number {
  const encounter = state.activeEncounter;
  const wild = encounter ? findWild(state, encounter) : undefined;
  if (!encounter || !wild) return 0;
  const ease = gameCreatureDefinition(state, wild.speciesId).encounter.tameEaseBps;
  const hpPercentBps = Math.floor((encounter.creatureHp * 10_000) / encounter.creatureMaxHp);
  const tiered = Math.floor((ease * (activeSnare(state)?.tierBps ?? TAMING_SNARE_TIER_BPS)) / 10_000);
  const raw = Math.floor((tiered * (15_000 - hpPercentBps)) / 10_000) + tamingChanceBonusBps(state);
  return Math.max(SNARE_CHANCE_MIN_BPS, Math.min(SNARE_CHANCE_MAX_BPS, raw));
}

function defeatCreature(state: GameState, wild: WildCreatureState, result: EncounterCommandResult, prefix: string): EncounterCommandResult {
  const companionSpecies = encounterCompanion(state, state.activeEncounter!)?.speciesId ?? null;
  // Loot, the trophy counter, world removal, and XP are shared with the
  // overworld kill path — see creatureDefeat.ts. Only the encounter-specific
  // teardown belongs here.
  const payout = awardCreatureDefeat(state, wild);
  recordCompanionWin(state, companionSpecies);
  grantEncounterBond(state, 3);
  state.activeEncounter = null;
  return { ...result, ended: true, defeated: true, message: `${prefix} Level ${payout.level} ${payout.displayName} is defeated! ${payout.granted.join(', ')}` };
}

function defeatPlayer(state: GameState, wild: WildCreatureState, result: EncounterCommandResult, prefix: string): EncounterCommandResult {
  wild.encounterCooldownUntilTick = state.tick + FLEE_COOLDOWN_TICKS;
  wild.hp = state.activeEncounter?.creatureHp ?? wild.hp;
  const defeat = beginPlayerDefeat(state, 'creature');
  const lossNote = defeat.lostItemCount > 0 ? ' Your carried inventory was lost; storage boxes remain safe.' : '';
  return {
    ...result,
    ended: true,
    playerDefeated: true,
    message: `${prefix} You were defeated. Choose where to awaken.${lossNote}`,
  };
}

function tame(state: GameState, wild: WildCreatureState, result: EncounterCommandResult, message: string): EncounterCommandResult {
  const definition = leveledCreatureDefinition(state, wild);
  const acquired = acquireWildCreature(state, wild);
  if (!acquired) return { ok: false, message: 'Make room in your creature roster first.' };
  grantEncounterBond(state, 3);
  state.activeEncounter = null;
  grantXp(state, scaleByLevel(CREATURE_TAME_XP, wild.level, definition.encounter.levelMultiplierBps));
  return { ...result, ended: true, tamed: true, message: `${message} Level ${wild.level} ${definition.displayName} joined you.` };
}

function grantEncounterBond(state: GameState, amount: number): void {
  const encounter = state.activeEncounter;
  if (!encounter?.companionCreatureId) return;
  const companion = state.ownedCreatures.find((creature) => creature.id === encounter.companionCreatureId);
  if (companion) companion.bondXp += amount;
}


function rollBps(state: GameState): number { let x = state.rngState >>> 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; state.rngState = x >>> 0; return state.rngState % 10000; }
function findWild(state: GameState, encounter: EncounterState): WildCreatureState | undefined { return state.wildCreatures.find((item) => item.id === encounter.wildCreatureId); }
