/**
 * Handcrafted consumables: snares, arrows and the cloth mask. These lived in
 * encounters.ts beside the battle arena they were first made for; the arena is
 * gone (taming-chance-plan.md) and the recipes are plain crafting.
 */
import {
  ARROWS_CRAFT_COST,
  ARROWS_PER_CRAFT,
  CLOTH_MASK_CRAFT_COST,
  REINFORCED_SNARE_CRAFT_COST,
  REINFORCED_SNARE_TIER_BPS,
  REINFORCED_SNARES_PER_CRAFT,
  TAMING_SNARE_CRAFT_COST,
  TAMING_SNARE_TIER_BPS,
} from '../config/balance';
import { blueprintLockedReason } from './blueprintKnowledge';
import { canAddResourceAfterCost, tryAddResource, type CommandResult } from './gameplayCommands';
import type { GameState, ResourceId } from './state';
import { grantXp } from './characterProgression';
import { recordCraft } from './questTracking';
import { reconcileResourceStacks } from './inventoryStacks';

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

/**
 * The snare a throw would spend, strongest first. The player chooses by what
 * they pack rather than by a second button: carrying a Reinforced Snare means it
 * gets used.
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
