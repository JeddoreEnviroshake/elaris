import type { ToolUseCost } from '../config/balance';
import type { ResourceAmounts } from '../content/buildingParts';
import type { GameState, ResourceId } from '../simulation/state';

/**
 * One home for recipe/blueprint cost copy, shared by the Craft panel, the Build
 * palette, the facility panels, and the repair menu.
 *
 * Every cost is written carried-over-required per resource — "12/1 wood + 0/1
 * stone" — rather than as a bare price. A bare price made a card look craftable
 * when the bag was empty; showing the stock beside it says exactly which line is
 * short. Buttons priced this way must also be disabled by `canAffordCost`, so
 * an unaffordable action reads as inactive instead of failing on click.
 */
export function stockedCostText(state: GameState, cost: ResourceAmounts): string {
  return Object.entries(cost)
    .map(([resource, amount]) => `${state.inventory[resource as ResourceId]}/${amount} ${resource}`)
    .join(' + ');
}

/** Whether the bag covers every line of a cost. */
export function canAffordCost(state: GameState, cost: ResourceAmounts): boolean {
  return Object.entries(cost).every(
    ([resource, amount]) => state.inventory[resource as ResourceId] >= amount,
  );
}

/**
 * A tool's cast value as the player reads it: "1 SP per swing", "1 arrow per
 * shot". Stamina and mana are written as the HUD bars label them, and the bow
 * says "shot" because its cast value buys an arrow rather than a swing.
 */
export function useCostLabel(cost: ToolUseCost): string {
  const unit = cost.resource === 'arrow'
    ? `${cost.amount === 1 ? 'arrow' : 'arrows'} per shot`
    : `${cost.resource === 'mana' ? 'MP' : 'SP'} per swing`;
  return `${cost.amount} ${unit}`;
}

/** The bare price, for places with no player to compare against. */
export function costText(cost: ResourceAmounts): string {
  return Object.entries(cost)
    .map(([resource, amount]) => `${amount} ${resource}`)
    .join(' + ');
}
