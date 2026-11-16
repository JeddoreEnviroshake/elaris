/**
 * Taming in the world (taming-chance-plan.md).
 *
 * Every wild creature has a visible Tame % the player raises by meeting its
 * species' requirements — wearing it down, offering its favourite, staying
 * unnoticed — and then cashes in with one thrown snare. There is no arena and
 * no beat menu: the throw resolves in place, against the number on the button.
 *
 * Determinism: every field this module writes is a whole tick count or basis
 * points, and the single roll per throw consumes the shared `rngState` exactly
 * the way the rest of the simulation does.
 */
import {
  CREATURE_TAME_XP,
  REINFORCED_SNARE_TIER_BPS,
  OFFER_RANGE_PX,
  SNARE_THROW_RANGE_PX,
  TAME_BASE_SHARE_BPS,
  TAME_BERRY_OFFER_BPS,
  TAME_CHANCE_MAX_BPS,
  TAME_CHANCE_MIN_BPS,
  TAME_EATING_TICKS,
  TAME_FAVOURITE_OFFER_BPS,
  TAME_PITY_PER_MISS_BPS,
  TAME_STAGGER_BONUS_BPS,
  TAME_STAGGER_HP_BPS,
  TAME_STAGGER_TICKS,
  TAMING_SNARE_TIER_BPS,
  gameCreatureDefinition,
  leveledCreatureDefinition,
} from '../config/balance';
import { MAX_CREATURE_ROSTER, creatureDefinition } from '../content/creatures';
import { isOpeningTuftle } from '../content/onboarding';
import { acquireWildCreature } from './creatureAcquisition';
import { CREATURE_FLEE_TICKS, provokeCreature } from './creatureCombat';
import { scaleByLevel } from './enemyLevels';
import { grantXp, tamingChanceBonusBps } from './characterProgression';
import { recordEncounter } from './questTracking';
import { reconcileResourceStacks } from './inventoryStacks';
import { activeSnare } from './supplyCrafting';
import type { CommandResult } from './gameplayCommands';
import type { GameState, ResourceId, WildCreatureState } from './state';

export type TameChancePartId = 'base' | 'hp' | 'stagger' | 'fed' | 'unnoticed' | 'pity' | 'luck';

export interface TameChance {
  /** The final chance a throw right now would roll against. */
  chanceBps: number;
  /** Each lever's contribution before the snare multiplier, for the breakdown chips. */
  parts: Readonly<Record<TameChancePartId, number>>;
  /** Multiplier of the snare a throw would spend (basic when none is carried). */
  tierBps: number;
}

export interface TameThrowResult extends CommandResult {
  creatureId?: string;
  tamed?: boolean;
  missed?: boolean;
  chanceBps?: number;
}

export const TAME_PART_LABELS: Readonly<Record<TameChancePartId, string>> = {
  base: 'Base', hp: 'Worn down', stagger: 'Staggered', fed: 'Fed', unnoticed: 'Unnoticed', pity: 'Persistence', luck: 'Luck',
};

export function isStaggered(state: GameState, wild: WildCreatureState): boolean {
  return (wild.staggerUntilTick ?? 0) > state.tick;
}

export function isEating(state: GameState, wild: WildCreatureState): boolean {
  return (wild.eatingUntilTick ?? 0) > state.tick;
}

/** Staggered or eating: the creature neither moves nor attacks this tick. */
export function isHeldInPlace(state: GameState, wild: WildCreatureState): boolean {
  return isStaggered(state, wild) || isEating(state, wild);
}

/** Not hunting and not fleeing: it has not noticed the player as a threat. */
export function isUnnoticed(state: GameState, wild: WildCreatureState): boolean {
  return wild.aggroUntilTick <= state.tick && wild.fleeUntilTick <= state.tick;
}

export type SnareItemId = 'taming-snare' | 'reinforced-snare';

export function snareTierBps(snareItemId: SnareItemId): number {
  return snareItemId === 'reinforced-snare' ? REINFORCED_SNARE_TIER_BPS : TAMING_SNARE_TIER_BPS;
}

export function tameChance(state: GameState, wild: WildCreatureState, snareItemId?: SnareItemId): TameChance {
  const definition = gameCreatureDefinition(state, wild.speciesId);
  const profile = definition.tame;
  const hpPercentBps = wild.maxHp > 0 ? Math.floor((wild.hp * 10_000) / wild.maxHp) : 10_000;
  const eating = isEating(state, wild);
  const parts: Record<TameChancePartId, number> = {
    base: Math.floor((definition.encounter.tameEaseBps * TAME_BASE_SHARE_BPS) / 10_000),
    hp: Math.floor((Math.max(0, 10_000 - hpPercentBps) * profile.hpWeightBps) / 10_000),
    stagger: isStaggered(state, wild) ? TAME_STAGGER_BONUS_BPS : 0,
    fed: Math.min(wild.captureBonusBps, profile.foodCapBps),
    unnoticed: isUnnoticed(state, wild) ? profile.unnoticedBps * (eating ? 2 : 1) : 0,
    pity: (wild.snareMisses ?? 0) * TAME_PITY_PER_MISS_BPS,
    luck: tamingChanceBonusBps(state),
  };
  const tierBps = snareItemId ? snareTierBps(snareItemId) : activeSnare(state)?.tierBps ?? TAMING_SNARE_TIER_BPS;
  const sum = Object.values(parts).reduce((total, value) => total + value, 0);
  const chanceBps = Math.max(TAME_CHANCE_MIN_BPS, Math.min(TAME_CHANCE_MAX_BPS, Math.floor((sum * tierBps) / 10_000)));
  return { chanceBps, parts, tierBps };
}

/**
 * The one place a wild creature loses health in the overworld, so the stagger
 * cannot be skipped by a damage source that forgot about it. A hit also ends a
 * meal — food is not worth standing still for while being struck.
 */
export function damageWildCreature(state: GameState, wild: WildCreatureState, damage: number): { staggered: boolean } {
  wild.hp = Math.max(0, wild.hp - damage);
  if (wild.eatingUntilTick) wild.eatingUntilTick = 0;
  if (wild.hp === 0 || wild.staggerSpent) return { staggered: false };
  if (wild.hp * 10_000 > wild.maxHp * TAME_STAGGER_HP_BPS) return { staggered: false };
  wild.staggerSpent = 1;
  wild.staggerUntilTick = state.tick + TAME_STAGGER_TICKS;
  return { staggered: true };
}

function distanceTo(state: GameState, wild: WildCreatureState): number {
  return Math.hypot(wild.x - state.player.x, wild.y - state.player.y);
}

function findWild(state: GameState, creatureId: string): WildCreatureState | undefined {
  return state.wildCreatures.find((creature) => creature.id === creatureId);
}

/** Why the roster cannot accept `wild`, or null when it can. */
function rosterBlockedReason(state: GameState, wild: WildCreatureState): string | null {
  const definition = creatureDefinition(wild.speciesId);
  if (state.ownedCreatures.length >= MAX_CREATURE_ROSTER) return 'Creature roster is full';
  if (state.ownedCreatures.filter((owned) => owned.speciesId === wild.speciesId).length >= definition.rosterLimit) {
    return `${definition.displayName} is already in your roster`;
  }
  return null;
}

/**
 * Why a snare cannot be thrown at `creatureId`, or null when it can. Shared by
 * the command and the HUD button so the button never offers a throw the
 * simulation would refuse.
 */
export function snareThrowBlockedReason(
  state: GameState, creatureId: string, range = SNARE_THROW_RANGE_PX, snareItemId?: SnareItemId,
): string | null {
  if (state.pendingRespawn) return 'Not right now';
  if (snareItemId ? state.inventory[snareItemId] <= 0 : !activeSnare(state)) return 'Craft a Taming Snare first';
  const wild = findWild(state, creatureId);
  if (!wild || wild.hp <= 0) return 'Move closer to a wild creature';
  if (isOpeningTuftle(state, wild.id)) return 'Choose Help Tuftle to earn its trust.';
  if (distanceTo(state, wild) > range) return 'Move closer to a wild creature';
  return rosterBlockedReason(state, wild);
}

/** The item an Offer would spend on `wild`: its favourite first, any berry second. */
export function offerItemFor(state: GameState, wild: WildCreatureState): ResourceId | null {
  const favourite = gameCreatureDefinition(state, wild.speciesId).tame.favourite;
  if (state.inventory[favourite] > 0) return favourite;
  if (state.inventory.berry > 0) return 'berry';
  return null;
}

/** Whether `item` is something this creature will eat: its favourite, or any berry. */
export function acceptsOffer(state: GameState, wild: WildCreatureState, item: ResourceId): boolean {
  return item === 'berry' || item === gameCreatureDefinition(state, wild.speciesId).tame.favourite;
}

export function offerBlockedReason(state: GameState, creatureId: string, range = OFFER_RANGE_PX, item?: ResourceId): string | null {
  if (state.pendingRespawn) return 'Not right now';
  const wild = findWild(state, creatureId);
  if (!wild || wild.hp <= 0) return 'Move closer to a wild creature';
  if (isOpeningTuftle(state, wild.id)) return 'Choose Help Tuftle to earn its trust.';
  if (distanceTo(state, wild) > range) return 'Move closer to offer food';
  if (isEating(state, wild)) return 'It is still eating';
  if (wild.fleeUntilTick > state.tick) return 'It is too spooked to eat';
  if (wild.captureBonusBps >= gameCreatureDefinition(state, wild.speciesId).tame.foodCapBps) return 'It has eaten its fill';
  if (item !== undefined) {
    if (state.inventory[item] <= 0) return `No ${item} left`;
    if (!acceptsOffer(state, wild, item)) return `The ${gameCreatureDefinition(state, wild.speciesId).displayName} sniffs the ${item} and turns away`;
    return null;
  }
  if (!offerItemFor(state, wild)) return `Carry ${gameCreatureDefinition(state, wild.speciesId).tame.favourite} or a berry`;
  return null;
}

/**
 * Toss food to a creature. It settles to eat with its back to the player —
 * hostility dropped, held in place — and the meal adds lasting tame progress.
 */
export function offerToCreature(state: GameState, creatureId: string, chosen?: ResourceId, range = OFFER_RANGE_PX): CommandResult {
  const blocked = offerBlockedReason(state, creatureId, range, chosen);
  if (blocked) return { ok: false, message: blocked };
  const wild = findWild(state, creatureId)!;
  const definition = gameCreatureDefinition(state, wild.speciesId);
  const item = chosen ?? offerItemFor(state, wild)!;
  const favourite = item === definition.tame.favourite;
  state.inventory[item] -= 1;
  reconcileResourceStacks(state, item);
  const gain = favourite ? TAME_FAVOURITE_OFFER_BPS : TAME_BERRY_OFFER_BPS;
  wild.captureBonusBps = Math.min(definition.tame.foodCapBps, wild.captureBonusBps + gain);
  wild.eatingUntilTick = state.tick + TAME_EATING_TICKS;
  wild.aggroUntilTick = 0;
  wild.fleeUntilTick = 0;
  recordEncounter(state, wild.speciesId);
  return {
    ok: true,
    message: favourite
      ? `The ${definition.displayName} loves it and settles in to eat`
      : `The ${definition.displayName} nibbles the berry`,
  };
}

function rollBps(state: GameState): number {
  let x = state.rngState >>> 0;
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  state.rngState = x >>> 0;
  return state.rngState % 10_000;
}

/**
 * Throw a snare: spend it, roll once against the shown chance, and either take
 * the creature or let it break free. A miss never resets the bar to zero — half
 * the food progress stays, and each miss makes the next throw likelier — so a
 * miss stings without wasting the work that set it up.
 */
export function throwSnareAtCreature(
  state: GameState, creatureId: string, range = SNARE_THROW_RANGE_PX, snareItemId?: SnareItemId,
): TameThrowResult {
  const blocked = snareThrowBlockedReason(state, creatureId, range, snareItemId);
  if (blocked) return { ok: false, message: blocked, creatureId };
  const wild = findWild(state, creatureId)!;
  const definition = leveledCreatureDefinition(state, wild);
  const snare = snareItemId
    ? { itemId: snareItemId, label: snareItemId === 'reinforced-snare' ? 'reinforced snare' : 'snare' }
    : activeSnare(state)!;
  const { chanceBps } = tameChance(state, wild, snare.itemId);
  state.inventory[snare.itemId] -= 1;
  reconcileResourceStacks(state, snare.itemId);
  recordEncounter(state, wild.speciesId);
  if (rollBps(state) < chanceBps) {
    const level = wild.level;
    const acquired = acquireWildCreature(state, wild);
    if (!acquired) return { ok: false, message: 'Make room in your creature roster first.', creatureId };
    grantXp(state, scaleByLevel(CREATURE_TAME_XP, level, definition.encounter.levelMultiplierBps));
    return {
      ok: true, tamed: true, chanceBps, creatureId,
      message: `The ${snare.label} holds — Level ${level} ${definition.displayName} joined you!`,
    };
  }
  wild.captureBonusBps = Math.floor(wild.captureBonusBps / 2);
  wild.snareMisses = (wild.snareMisses ?? 0) + 1;
  wild.eatingUntilTick = 0;
  if (definition.temperament === 'passive') wild.fleeUntilTick = state.tick + CREATURE_FLEE_TICKS;
  else provokeCreature(state, wild);
  return {
    ok: true, missed: true, chanceBps, creatureId,
    message: `The ${definition.displayName} breaks free of the ${snare.label} (${Math.floor(chanceBps / 100)}%)`,
  };
}
