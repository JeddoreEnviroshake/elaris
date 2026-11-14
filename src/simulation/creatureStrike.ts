/**
 * Striking a wild creature in the overworld.
 *
 * Deliberately modelled on `strikeRaiderMelee` rather than on the Encounter
 * screen: a creature is flesh a tool can hit, exactly as a raider is, and the
 * whole point of giving `StrikeTarget` a `'creature'` row is that one damage
 * table now describes a tool's entire relationship with the world.
 */
import { MELEE_REACH_PX, playerShotDamage, playerShotRangePx } from './raids';
import { isOpeningTuftle } from '../content/onboarding';
import {
  payStrikeCost,
  payUseCost,
  strikeBlockedReason,
  strikeProfile,
  strikeReachPx,
  useCostShortfall,
} from './strike';
import { awardCreatureDefeat } from './creatureDefeat';
import { provokeCreature } from './creatureCombat';
import { equippedBow } from './gameplayCommands';
import { gameToolDefinition, leveledCreatureDefinition } from '../config/balance';
import { creatureDefinition } from '../content/creatures';
import type { GameState, WildCreatureState } from './state';

export interface CreatureStrikeResult {
  ok: boolean;
  message: string;
  creatureId?: string;
  killed?: boolean;
  toolBroke?: boolean;
}

/**
 * Returned when a shot found no creature at all. Named for the same reason the
 * raider equivalent is: pressing the action with empty ground ahead is how a
 * player checks that nothing is there, and it must not toast on every press.
 */
export const NO_SHOT_CREATURE_MESSAGE = 'No creature in range';

export function strikeCreatureMelee(state: GameState, creatureId?: string): CreatureStrikeResult {
  const blocked = strikeBlockedReason(state);
  if (blocked) return { ok: false, message: blocked };

  const reachPx = strikeReachPx(state);
  const target = creatureId
    ? state.wildCreatures.find((creature) => creature.id === creatureId) ?? null
    : nearestCreatureInRange(state, reachPx);
  if (!target) return { ok: false, message: 'No creature in reach' };
  if (isOpeningTuftle(state, target.id)) return { ok: false, message: 'Choose Help Tuftle to earn its trust.' };
  if (distanceTo(state, target) > reachPx) {
    return { ok: false, message: 'Too far — move closer', creatureId: target.id };
  }

  const profile = strikeProfile(state, 'creature');
  if (profile.damage <= 0) {
    return { ok: false, message: 'That tool cannot be used as a weapon', creatureId: target.id };
  }
  if (profile.tool && profile.tool.durability <= 0) {
    return { ok: false, message: `Your ${profile.definition!.displayName} is broken`, creatureId: target.id };
  }

  const definition = leveledCreatureDefinition(state, target);
  const name = `Level ${target.level} ${definition.displayName}`;
  target.hp = Math.max(0, target.hp - profile.damage);
  // Hitting something makes it fight back. This finally wires up the aggro
  // machinery creatureCombat already had but nothing ever called.
  provokeCreature(state, target);
  const killed = target.hp === 0;
  const payout = killed ? awardCreatureDefeat(state, target) : null;
  const toolBroke = payStrikeCost(state, profile);

  return {
    ok: true,
    message: payout
      ? `${name} down · ${payout.granted.join(', ')}${toolBroke ? ' · Tool broke' : ''}`
      : `Hit ${name} (${target.hp}/${target.maxHp})${toolBroke ? ' · Tool broke' : ''}`,
    creatureId: target.id,
    killed,
    toolBroke,
  };
}

/**
 * A real-time shot at a wild creature, the exact counterpart of the raider
 * shot in `firePlayerShot`.
 *
 * A bow that could only ever be pointed at raiders made wildlife a melee-only
 * proposition: the one weapon built for distance had nothing to do between
 * danger minutes. The arrow, the wear, the cooldown, and the enclosure rule are
 * all the raider shot's — only what dies and what it drops differs, which is
 * `awardCreatureDefeat`'s business rather than this function's.
 */
export function fireCreatureShot(state: GameState, creatureId?: string): CreatureStrikeResult {
  if (state.tick < state.actionCooldownUntilTick) return { ok: false, message: 'Not ready yet' };
  const bow = equippedBow(state);
  if (!bow) return { ok: false, message: 'Equip a bow to shoot' };
  // The bow's cast value is the shot's price, so how many arrows one loosing
  // takes is a property of the bow rather than a constant here.
  const shotCost = gameToolDefinition(state, bow.definitionId).useCost;
  const shortfall = useCostShortfall(state, shotCost);
  if (shortfall) return { ok: false, message: shortfall };
  // The same rule the raider shot has: shots ignore line of sight, so a player
  // behind a wall can shoot out while the creature they provoked cannot bite
  // back through it.
  const rangePx = playerShotRangePx(state);
  const target = creatureId
    ? state.wildCreatures.find((creature) => creature.id === creatureId) ?? null
    : nearestHuntableCreature(state, rangePx);
  if (!target || target.hp <= 0) return { ok: false, message: NO_SHOT_CREATURE_MESSAGE };
  if (isOpeningTuftle(state, target.id)) return { ok: false, message: 'Choose Help Tuftle to earn its trust.' };
  if (distanceTo(state, target) > rangePx) {
    return { ok: false, message: 'Too far away', creatureId: target.id };
  }

  payUseCost(state, shotCost);
  state.actionCooldownUntilTick = state.tick + state.gameBalance.defense.playerShotCooldownTicks;
  // Fired, not swung: the bow wears and costs no stamina, so this deliberately
  // does not go through payStrikeCost.
  const bowDefinition = gameToolDefinition(state, bow.definitionId);
  bow.durability = Math.max(0, bow.durability - Math.max(1, bowDefinition.wearPerHit));
  const bowBroke = bow.durability === 0;
  if (bowBroke) state.equippedToolId = null;

  const definition = leveledCreatureDefinition(state, target);
  const name = `Level ${target.level} ${definition.displayName}`;
  target.hp = Math.max(0, target.hp - playerShotDamage(state));
  // An arrow is a provocation like any other. Shooting something from six tiles
  // away and having it keep grazing would read as the shot having missed.
  provokeCreature(state, target);
  const killed = target.hp === 0;
  const payout = killed ? awardCreatureDefeat(state, target) : null;

  return {
    ok: true,
    message: (payout
      ? `${name} down · ${payout.granted.join(', ')}`
      : `Hit ${name} (${target.hp}/${target.maxHp})`) + (bowBroke ? ' · Bow broke' : ''),
    creatureId: target.id,
    killed,
    toolBroke: bowBroke,
  };
}

/**
 * The nearest creature that may be engaged without a deliberate tap: hostile
 * ones only. See `isHuntable` — this is the guard that keeps the action button
 * from turning a passing herd into loot.
 */
export function nearestHuntableCreature(state: GameState, range = MELEE_REACH_PX): WildCreatureState | null {
  let nearest: WildCreatureState | null = null;
  let nearestDistance = range;
  for (const creature of state.wildCreatures) {
    if (creature.hp <= 0 || !isHuntable(state, creature)) continue;
    const distance = distanceTo(state, creature);
    if (distance <= nearestDistance) {
      nearest = creature;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function nearestCreatureInRange(state: GameState, range = MELEE_REACH_PX): WildCreatureState | null {
  let nearest: WildCreatureState | null = null;
  let nearestDistance = range;
  for (const creature of state.wildCreatures) {
    if (creature.hp <= 0) continue;
    const distance = distanceTo(state, creature);
    if (distance <= nearestDistance) {
      nearest = creature;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function distanceTo(state: GameState, creature: WildCreatureState): number {
  return Math.hypot(creature.x - state.player.x, creature.y - state.player.y);
}

/**
 * Whether a wild creature may be engaged without a deliberate tap.
 *
 * Only creatures already coming for the player qualify: an aggressive species,
 * or any species the player has already provoked. A grazing Tuftle is scenery
 * until the player taps it, which is what keeps "walk past a herd with a sword
 * equipped" from being a massacre — and what keeps the deer you meant to snare
 * alive long enough to snare.
 *
 * This gates automatic engagement only — the action button and sustained fire.
 * A deliberate tap can attack anything with health, which is the whole point of
 * a tap: it names one creature, and nothing about it is accidental.
 */
export function isHuntable(state: GameState, creature: WildCreatureState): boolean {
  if (isEngaged(state, creature)) return true;
  return creatureDefinition(creature.speciesId).temperament === 'aggressive';
}

/**
 * Whether a creature is *actually* coming for the player right now.
 *
 * Deliberately narrower than `isHuntable`: an aggressive Snarlfox asleep across
 * the clearing is a legal target but must not outrank the tree the player is
 * mid-swing on. Only something that has actually noticed the player gets to
 * interrupt what they were doing.
 */
export function isEngaged(state: GameState, creature: WildCreatureState): boolean {
  return creature.aggroUntilTick > state.tick;
}
