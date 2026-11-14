import { storageBoxContents } from './storageBox';
import type { BuildingState, GameState } from './state';

/**
 * The danger a blueprint brings with it.
 *
 * An unregistered blueprint is the only thing in the game that makes the world
 * more hostile for holding it. Raiders hunt the carrier: they come more often
 * and notice from further away. That pressure is the entire reason the run home
 * is worth anything, and it ends the moment the blueprint is filed.
 *
 * Heat is **flat**. One blueprint or five is the same heat — a stacking rule
 * would push players into single-item round trips, which is tedious rather than
 * tense, and it would be far harder to reason about mid-raid.
 */

/** Aggression radius multiplier while a blueprint is in the open, in basis points. */
export const BLUEPRINT_AGGRO_BPS = 12_500;

/** Extra raiders per wave while a blueprint is in the open. */
export const BLUEPRINT_EXTRA_RAIDERS = 1;

/** Unregistered blueprints in the bag. */
export function carriesBlueprint(state: GameState): boolean {
  return state.carriedBlueprints.length > 0;
}

/**
 * Whether this container is holding blueprints.
 *
 * A Storage Box is a legitimate place to leave one, but it is not a hiding
 * place: the box radiates the same heat from its own position, so stashing
 * moves the danger to the base rather than removing it from the world.
 */
export function boxHoldsBlueprint(box: BuildingState): boolean {
  return storageBoxContents(box).blueprints.length > 0;
}

/** Any blueprint in the area still unregistered — carried or stashed. */
export function areaHasBlueprintHeat(state: GameState): boolean {
  return carriesBlueprint(state) || state.buildings.some(boxHoldsBlueprint);
}

/**
 * The aggression radius raiders actually use, in pixels. Applied at the range
 * check rather than baked into balance, so the Admin panel keeps showing the
 * tuned base value rather than a number that silently moves.
 */
export function effectiveAggroRangePx(state: GameState, baseRangePx: number): number {
  if (!carriesBlueprint(state)) return baseRangePx;
  return Math.floor(baseRangePx * BLUEPRINT_AGGRO_BPS / 10_000);
}

/** How many extra raiders a wave brings because of blueprints in the open. */
export function blueprintWaveBonus(state: GameState): number {
  return areaHasBlueprintHeat(state) ? BLUEPRINT_EXTRA_RAIDERS : 0;
}
