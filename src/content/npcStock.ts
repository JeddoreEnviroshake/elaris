import { BAG_WEIGHT_SCALE } from '../config/balance';
import type { ResourceId } from '../simulation/state';

/**
 * Per-NPC stock: the goods only one settlement character will sell you.
 *
 * The economy's original shape was a dead end — four of the eight NPCs sold the
 * identical 100-coin skill point, and every other sink was finite, so a player
 * who maxed their attributes and bought the staff had permanently worthless
 * coins. Everything here is deliberately **repeatable**, and the two escalating
 * lines below never reach a final rank, so coins keep meaning something for as
 * long as a save runs.
 *
 * Prices are plain integers in one place so the service model can quote exactly
 * what the command will charge.
 */

/** Tavi resells consumables at this multiple of what she pays for them. */
export const RESTOCK_MARKUP = 2;

/** What the Market will sell back. Raw materials stay player-gathered. */
export const RESTOCK_ITEM_IDS: readonly ResourceId[] = ['arrow', 'taming-snare', 'cloth-mask', 'berry'];

/**
 * Elowen's charm. Flat-priced and repeatable: it is the answer to the one loss
 * in the game that cannot be undone, so it should always be purchasable rather
 * than climbing out of reach.
 */
export const SAFEGUARD_CHARM_COST = 400;

/**
 * Garrick's Reinforced Pack. Each rank adds real carry weight and costs one
 * step more than the last, so it absorbs coins indefinitely without ever
 * becoming unaffordable.
 */
export const PACK_RANK_BASE_COST = 250;
export const PACK_RANK_CAPACITY_HUNDREDTHS = 10 * BAG_WEIGHT_SCALE;
/**
 * The Carry Weight attribute improves what the character can carry without
 * replacing pack upgrades. The live per-point value is a Global Value
 * (`attributeGains.carryWeightHundredths`); this is only its default.
 */
export { CARRY_WEIGHT_CAPACITY_HUNDREDTHS } from '../config/balance';

export function packRankCost(currentRanks: number): number {
  return PACK_RANK_BASE_COST * (currentRanks + 1);
}

/**
 * Selene's Arcane Study: coins into blueprints. This is the one route that
 * converts trade back into the build tree, which is why it climbs faster than
 * the pack — it must stay a considered purchase, not a grind shortcut.
 */
export const ARCANE_STUDY_BASE_COST = 150;

export function arcaneStudyCost(purchases: number): number {
  return ARCANE_STUDY_BASE_COST * (purchases + 1);
}

/**
 * Bram's rumour. Cheap on purpose: its job is to point a player at the
 * exploration content that already exists, not to be a gate in front of it.
 */
export const RUMOUR_COST = 60;
