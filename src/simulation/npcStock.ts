import { BAG_ITEM_LABELS } from '../config/balance';
import { SELL_PRICES } from '../content/economy';
import {
  ARCANE_STUDY_BASE_COST,
  PACK_RANK_CAPACITY_HUNDREDTHS,
  RESTOCK_MARKUP,
  RUMOUR_COST,
  SAFEGUARD_CHARM_COST,
  arcaneStudyCost,
  packRankCost,
} from '../content/npcStock';
import { learnBlueprint, unknownBlueprintIds } from './blueprintKnowledge';
import { removeCarriedBlueprint } from './carriedBlueprints';
import { creditCoins, spendCoins } from './coins';
import { tryAddResource, type CommandResult } from './gameplayCommands';
import { containerLabel } from './worldContainers';
import type { GameState, ResourceId } from './state';

/**
 * Purchase commands for per-NPC stock. Kept in its own module rather than added
 * to economy.ts so it stays clear of concurrent edits there, and so the whole
 * "what an NPC sells" surface can be read in one place.
 *
 * Every command here is atomic in the same way the rest of the economy is: the
 * cost is checked and spent before the goods are granted, and any failure after
 * that point refunds rather than leaving the player short.
 */

export function restockPrice(resource: ResourceId): number {
  return SELL_PRICES[resource] * RESTOCK_MARKUP;
}

/** Buy consumables back from the Market rather than crafting them. */
export function buySupply(state: GameState, resource: ResourceId, amount = 1): CommandResult {
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, message: 'Choose a positive whole amount' };
  const cost = restockPrice(resource) * amount;
  const label = BAG_ITEM_LABELS[resource];
  if (state.coins < cost) return { ok: false, message: `Need ${cost - state.coins} more coins` };
  // Space is checked before the coins move so a full bag never charges.
  if (!tryAddResource(state, resource, amount)) return { ok: false, message: 'Bag is full' };
  const transaction = spendCoins(state, cost, `Bought ${amount} ${label} for ${cost} coins`);
  if (!transaction.ok) {
    state.inventory[resource] -= amount;
    return transaction;
  }
  return transaction;
}

export function safeguardCharmBlockedReason(state: GameState): string | null {
  if (state.coins < SAFEGUARD_CHARM_COST) return `Need ${SAFEGUARD_CHARM_COST - state.coins} more coins`;
  return null;
}

/** Elowen's charm: carried insurance against losing everything on defeat. */
export function buySafeguardCharm(state: GameState): CommandResult {
  const blocked = safeguardCharmBlockedReason(state);
  if (blocked) return { ok: false, message: blocked };
  if (!tryAddResource(state, 'safeguard-charm', 1)) return { ok: false, message: 'Bag is full' };
  const transaction = spendCoins(state, SAFEGUARD_CHARM_COST, 'Elowen blesses a Safeguard Charm');
  if (!transaction.ok) {
    state.inventory['safeguard-charm'] -= 1;
    return transaction;
  }
  return transaction;
}

/** Carry capacity including every Reinforced Pack rank the player has bought. */
export function effectiveBagCapacityHundredths(state: GameState): number {
  return state.gameBalance.bagWeight.capacityHundredths
    + (state.packRanks ?? 0) * PACK_RANK_CAPACITY_HUNDREDTHS
    + state.player.attributes.carryWeight * state.gameBalance.attributeGains.carryWeightHundredths;
}

export function nextPackRankCost(state: GameState): number {
  return packRankCost(state.packRanks ?? 0);
}

/** Garrick's Reinforced Pack: one permanent, always-available carry upgrade. */
export function buyReinforcedPack(state: GameState): CommandResult {
  const cost = nextPackRankCost(state);
  const transaction = spendCoins(state, cost, `Reinforced Pack rank ${(state.packRanks ?? 0) + 1} fitted`);
  if (!transaction.ok) return transaction;
  state.packRanks = (state.packRanks ?? 0) + 1;
  return transaction;
}

export function nextArcaneStudyCost(state: GameState): number {
  return arcaneStudyCost(state.arcaneStudyPurchases ?? 0);
}

/**
 * Selene's Arcane Study: coins converted into one blueprint she has already
 * drafted. She teaches in a fixed order so the price you pay always buys a
 * known quantity, and she has nothing left to sell once you know everything.
 */
export function buyArcaneStudy(state: GameState): CommandResult {
  const [next] = unknownBlueprintIds(state);
  if (!next) return { ok: false, message: 'Selene has nothing left to teach you' };
  const cost = nextArcaneStudyCost(state);
  const name = next.replace(/-/g, ' ');
  const transaction = spendCoins(state, cost, `Selene walks you through a rune; learned ${name}`);
  if (!transaction.ok) return transaction;
  state.arcaneStudyPurchases = (state.arcaneStudyPurchases ?? 0) + 1;
  learnBlueprint(state, next);
  return transaction;
}

export { RUMOUR_COST, ARCANE_STUDY_BASE_COST, SAFEGUARD_CHARM_COST };

export function rumourBlockedReason(state: GameState): string | null {
  if (state.coins < RUMOUR_COST) return `Need ${RUMOUR_COST - state.coins} more coins`;
  if (!state.containers.some((container) => !container.opened)) {
    return 'Bram knows of nothing left unopened in this region';
  }
  return null;
}

/**
 * Bram's rumour: a bearing to the nearest unopened container in this region.
 * Deliberately a direction and distance rather than a map pin — it should send
 * the player looking, not walk them there.
 */
export function buyRumour(state: GameState): CommandResult {
  const blocked = rumourBlockedReason(state);
  if (blocked) return { ok: false, message: blocked };

  let nearest = null as null | { container: (typeof state.containers)[number]; distance: number };
  for (const container of state.containers) {
    if (container.opened) continue;
    const distance = Math.hypot(container.x - state.player.x, container.y - state.player.y);
    if (!nearest || distance < nearest.distance) nearest = { container, distance };
  }
  if (!nearest) return { ok: false, message: 'Bram knows of nothing left unopened in this region' };

  const transaction = spendCoins(state, RUMOUR_COST, '');
  if (!transaction.ok) return transaction;
  const { container, distance } = nearest;
  const bearing = compassBearing(container.x - state.player.x, container.y - state.player.y);
  return {
    ok: true,
    message: `Bram leans in: a ${containerLabel(container.kind)} lies ${bearing}, about ${Math.round(distance)} paces off.`,
  };
}

/** Eight-point compass in screen space, where +y is south. */
function compassBearing(dx: number, dy: number): string {
  const vertical = Math.abs(dy) > Math.abs(dx) * 0.4 ? (dy < 0 ? 'north' : 'south') : '';
  const horizontal = Math.abs(dx) > Math.abs(dy) * 0.4 ? (dx < 0 ? 'west' : 'east') : '';
  return `${vertical}${horizontal}` || 'close by';
}

/**
 * What Tavi pays for one unregistered blueprint.
 *
 * Held above what the blueprint's parchment would fetch, so selling one whole
 * is always better than breaking it up. Scrapping stays the floor — what you do
 * when you want the material rather than the coins — instead of becoming the
 * obviously correct move that makes this row dead content.
 *
 * Covered by a test: raising the parchment price without raising this one would
 * silently invert the two.
 */
export const BLUEPRINT_SALE_PRICE = 600;

/**
 * Sell a carried blueprint to the market.
 *
 * No workbench needed: Tavi is buying the paper, not filing it. That keeps the
 * two dispositions honestly different — the bench is where a blueprint becomes
 * yours or becomes parchment, and the market is where it stops being yours.
 */
export function sellCarriedBlueprint(state: GameState, instanceId: string): CommandResult {
  if (state.onboarding.supplyRun?.blueprintInstanceId === instanceId && !state.unlockedItemIds.includes('garden-bed')) return { ok: false, message: 'Bring this supply-run discovery to a workbench to register it first' };
  const carried = removeCarriedBlueprint(state, instanceId);
  if (!carried) return { ok: false, message: 'You are not carrying that blueprint' };
  const name = carried.blueprintId.replace(/-/g, ' ');
  creditCoins(state, BLUEPRINT_SALE_PRICE, `Sold ${name} · +${BLUEPRINT_SALE_PRICE} coins`);
  return { ok: true, message: `Sold ${name} · +${BLUEPRINT_SALE_PRICE} coins` };
}
