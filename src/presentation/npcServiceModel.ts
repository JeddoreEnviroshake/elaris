import { BAG_ITEM_IDS, BAG_ITEM_LABELS, toolDefinition } from '../config/balance';
import { CREATURE_DEFINITIONS } from '../content/creatures';
import {
  FARM_ORDER_COSTS,
  MAGIC_STAFF_COST,
  SELL_PRICES,
  SKILL_POINT_COST,
  type ToolUpgradeAxis,
} from '../content/economy';
import type { NpcService } from '../content/npcs';
import { ATTRIBUTE_DESCRIPTIONS, ATTRIBUTE_LABELS } from '../simulation/characterProgression';
import {
  effectiveToolActionTicks,
  effectiveToolDamage,
  farmOrderBlockedReason,
  magicStaffPurchaseBlockedReason,
  orderTrainedCreature,
  purchaseMagicStaff,
  purchaseSkillPoint,
  sellAllResource,
  sellResource,
  toolUpgradeCost,
  toolUpgradeRank,
  upgradeTool,
} from '../simulation/economy';
import type { CommandResult } from '../simulation/gameplayCommands';
import { repairTool, repairToolBlockedReason } from '../simulation/gameplayCommands';
import {
  PACK_RANK_CAPACITY_HUNDREDTHS,
  RESTOCK_ITEM_IDS,
  RESTOCK_MARKUP,
  RUMOUR_COST,
  SAFEGUARD_CHARM_COST,
} from '../content/npcStock';
import {
  buyArcaneStudy,
  buyReinforcedPack,
  buyRumour,
  buySafeguardCharm,
  buySupply,
  effectiveBagCapacityHundredths,
  nextArcaneStudyCost,
  nextPackRankCost,
  restockPrice,
  rumourBlockedReason,
  safeguardCharmBlockedReason,
  sellCarriedBlueprint,
  BLUEPRINT_SALE_PRICE,
} from '../simulation/npcStock';
import { formatWeight } from '../simulation/bagWeight';
import { unknownBlueprintIds } from '../simulation/blueprintKnowledge';
import { EXPEDITION_ROUTES, EXPEDITION_SPECIALTY, expeditionRoute } from '../content/expeditions';
import {
  collectBlockedReason,
  collectExpedition,
  dispatchBlockedReason,
  dispatchExpedition,
  formatRemaining,
  isCreatureAway,
  isExpeditionHome,
} from '../simulation/expeditions';
import type { AttributeId, GameState } from '../simulation/state';

/**
 * A renderer-neutral action exposed by an NPC service. DOM, Three.js, and the
 * retained 2D presentation can all invoke the same atomic command through this
 * descriptor.
 */
export interface NpcServiceActionModel {
  id: string;
  label: string;
  accessibilityLabel: string;
  disabledReason: string | null;
  title: string;
  execute: () => CommandResult;
}

/** One displayed service offer; an informational offer may have no actions. */
export interface NpcServiceOfferModel {
  id: string;
  title: string;
  detail: string;
  accessibilityLabel: string | null;
  actions: readonly NpcServiceActionModel[];
}

export interface NpcServiceModel {
  service: NpcService;
  balance: string;
  offers: readonly NpcServiceOfferModel[];
}

/** Build a fresh view over mutable state whenever a service surface refreshes. */
export function npcServiceModel(state: GameState, service: NpcService): NpcServiceModel {
  return {
    service,
    balance: `Coin purse: ${state.coins} · Overall score: ${state.coins} · Spending coins lowers your score.`,
    offers: serviceOffers(state, service),
  };
}

function serviceOffers(state: GameState, service: NpcService): readonly NpcServiceOfferModel[] {
  switch (service) {
    case 'market': return [...blueprintSaleOffers(state), ...marketOffers(state), ...restockOffers(state)];
    case 'weaponsmith': return weaponsmithOffers(state);
    case 'farm': return [...farmOffers(state), ...expeditionOffers(state)];
    case 'church': return [...skillOffers(state, ['luck', 'health', 'healthRegen']), safeguardCharmOffer(state)];
    // Carry Weight trains where the pack is sold, so the two ways to carry more
    // sit at the same counter.
    case 'armoury': return [...skillOffers(state, ['dexterity', 'carryWeight']), reinforcedPackOffer(state)];
    case 'magic-shop': return [...magicShopOffers(state), arcaneStudyOffer(state)];
    case 'tavern': return [...skillOffers(state, ['mana', 'manaRegen']), rumourOffer(state)];
    case 'arena': return skillOffers(state, ['stamina', 'staminaRegen', 'speed']);
  }
}

/**
 * The per-NPC stock added on top of the original service list. Each of these is
 * repeatable, which is the point: before them the coin economy had only finite
 * sinks and stopped mattering once a player had bought everything once.
 */
function restockOffers(state: GameState): readonly NpcServiceOfferModel[] {
  return RESTOCK_ITEM_IDS.map((resource) => {
    const price = restockPrice(resource);
    const label = BAG_ITEM_LABELS[resource];
    const unavailable = state.coins < price ? `Need ${price - state.coins} more coins` : null;
    return offer(
      `restock-${resource}`,
      `Buy ${label} · ${price} coins each`,
      `Carrying ${state.inventory[resource]} · Tavi resells at ${RESTOCK_MARKUP}× her buying price`,
      [
        action(
          `buy-one-${resource}`,
          'Buy 1',
          `Buy 1 ${label}`,
          unavailable,
          unavailable ?? `Buy one ${label} for ${price} coins`,
          () => buySupply(state, resource, 1),
        ),
        action(
          `buy-five-${resource}`,
          'Buy 5',
          `Buy 5 ${label}`,
          state.coins < price * 5 ? `Need ${price * 5 - state.coins} more coins` : null,
          `Buy five ${label} for ${price * 5} coins`,
          () => buySupply(state, resource, 5),
        ),
      ],
      `${label} restock row`,
    );
  });
}

function safeguardCharmOffer(state: GameState): NpcServiceOfferModel {
  const unavailable = safeguardCharmBlockedReason(state);
  return offer(
    'safeguard-charm',
    `Safeguard Charm · ${SAFEGUARD_CHARM_COST} coins`,
    `Carrying ${state.inventory['safeguard-charm']} · Spent automatically on defeat to keep your bag and tools`,
    [action(
      'purchase-safeguard-charm',
      `Purchase${unavailable === null ? ` · score → ${state.coins - SAFEGUARD_CHARM_COST}` : ''}`,
      'Purchase Safeguard Charm',
      unavailable,
      unavailable ?? 'One defeat will cost you nothing carried',
      () => buySafeguardCharm(state),
    )],
  );
}

function reinforcedPackOffer(state: GameState): NpcServiceOfferModel {
  const cost = nextPackRankCost(state);
  const unavailable = state.coins < cost ? `Need ${cost - state.coins} more coins` : null;
  return offer(
    'reinforced-pack',
    `Reinforced Pack rank ${state.packRanks + 1} · ${cost} coins`,
    `Carry limit ${formatWeight(effectiveBagCapacityHundredths(state))} · each rank adds `
    + `${formatWeight(PACK_RANK_CAPACITY_HUNDREDTHS)} permanently`,
    [action(
      'purchase-reinforced-pack',
      `Fit rank ${state.packRanks + 1}${unavailable === null ? ` · score → ${state.coins - cost}` : ''}`,
      `Fit Reinforced Pack rank ${state.packRanks + 1}`,
      unavailable,
      unavailable ?? `Raise the carry limit to ${formatWeight(effectiveBagCapacityHundredths(state) + PACK_RANK_CAPACITY_HUNDREDTHS)}`,
      () => buyReinforcedPack(state),
    )],
  );
}

function arcaneStudyOffer(state: GameState): NpcServiceOfferModel {
  const cost = nextArcaneStudyCost(state);
  const [next] = unknownBlueprintIds(state);
  const unavailable = !next
    ? 'Selene has nothing left to teach you'
    : state.coins < cost ? `Need ${cost - state.coins} more coins` : null;
  const lesson = next ? next.replace(/-/g, ' ') : 'nothing';
  return offer(
    'arcane-study',
    `Arcane Study · ${cost} coins`,
    `Next lesson: ${lesson} · studied ${state.arcaneStudyPurchases} times; each lesson costs more`,
    [action(
      'purchase-arcane-study',
      `Study${unavailable === null ? ` · score → ${state.coins - cost}` : ''}`,
      'Purchase Arcane Study',
      unavailable,
      unavailable ?? `Learn the ${lesson} blueprint`,
      () => buyArcaneStudy(state),
    )],
  );
}

/**
 * Orin's expedition ledger: one row per creature that is away, then one row per
 * resting creature offering each route. Dispatching through the Farm keeps the
 * whole "creature work" surface in one place rather than adding another rail.
 */
function expeditionOffers(state: GameState): readonly NpcServiceOfferModel[] {
  const offers: NpcServiceOfferModel[] = [];

  for (const expedition of state.expeditions) {
    const creature = state.ownedCreatures.find((candidate) => candidate.id === expedition.creatureId);
    const route = expeditionRoute(expedition.routeId);
    const home = isExpeditionHome(expedition);
    const blocked = collectBlockedReason(state, expedition.id);
    offers.push(offer(
      `expedition-${expedition.id}`,
      `${creature?.name ?? 'Party'} · ${route.displayName}`,
      home ? 'Returned — goods waiting at the ledger' : `Away · ${formatRemaining(expedition.remainingMs)} to go`,
      [action(
        `collect-${expedition.id}`,
        home ? 'Collect' : formatRemaining(expedition.remainingMs),
        `Collect ${creature?.name ?? 'party'} expedition`,
        blocked,
        blocked ?? 'Take delivery of everything they carried home',
        () => collectExpedition(state, expedition.id),
      )],
    ));
  }

  const resting = state.ownedCreatures.filter(
    (creature) => creature.role === 'rest' && !isCreatureAway(state, creature.id),
  );
  if (resting.length === 0) {
    offers.push(offer(
      'expedition-none-available',
      'No creature free to send',
      state.ownedCreatures.length === 0
        ? 'Tame or order a creature first.'
        : 'Set a creature to Rest and Orin will find them a route.',
    ));
    return offers;
  }

  for (const creature of resting) {
    const specialty = EXPEDITION_SPECIALTY[creature.speciesId];
    offers.push(offer(
      `expedition-dispatch-${creature.id}`,
      `Send ${creature.name} out`,
      `Brings back ${specialty} · longer routes pay more`,
      EXPEDITION_ROUTES.map((route) => {
        const blocked = dispatchBlockedReason(state, creature.id, route.id);
        return action(
          `dispatch-${creature.id}-${route.id}`,
          `${route.displayName} · ${formatRemaining(route.durationMs)}`,
          `Send ${creature.name} on the ${route.displayName}`,
          blocked,
          blocked ?? route.summary,
          () => dispatchExpedition(state, creature.id, route.id),
        );
      }),
    ));
  }
  return offers;
}

function rumourOffer(state: GameState): NpcServiceOfferModel {
  const unavailable = rumourBlockedReason(state);
  return offer(
    'tavern-rumour',
    `Rumour · ${RUMOUR_COST} coins`,
    'Bram points you at the nearest cache still unopened in this region',
    [action(
      'purchase-rumour',
      'Ask around',
      'Buy a rumour from Bram',
      unavailable,
      unavailable ?? 'Learn a bearing and rough distance',
      () => buyRumour(state),
    )],
  );
}

/**
 * Tavi buys unregistered blueprints, one row per piece of paper in the bag.
 * Listed above the resource rows because a player standing here holding one is
 * almost certainly here for exactly this.
 */
function blueprintSaleOffers(state: GameState): readonly NpcServiceOfferModel[] {
  return state.carriedBlueprints.map((carried) => {
    const name = carried.blueprintId.replace(/-/g, ' ');
    return offer(
      `blueprint-sale-${carried.instanceId}`,
      `Blueprint: ${name} · ${BLUEPRINT_SALE_PRICE} coins`,
      'Unregistered. Selling it means giving up the recipe.',
      [action(
        `sell-blueprint-${carried.instanceId}`,
        'Sell',
        `Sell the ${name} blueprint`,
        null,
        `Sell the ${name} blueprint for ${BLUEPRINT_SALE_PRICE} coins`,
        () => sellCarriedBlueprint(state, carried.instanceId),
      )],
    );
  });
}

function marketOffers(state: GameState): readonly NpcServiceOfferModel[] {
  return BAG_ITEM_IDS.map((resource) => {
    const label = BAG_ITEM_LABELS[resource];
    const unavailable = state.inventory[resource] <= 0 ? `No ${resource} to sell` : null;
    return offer(
      `market-${resource}`,
      `${label} · ${SELL_PRICES[resource]} coins each`,
      `Owned ${state.inventory[resource]}`,
      [
        action(
          `sell-one-${resource}`,
          'Sell 1',
          `Sell 1 ${resource}`,
          unavailable,
          unavailable ?? `Sell one ${resource}`,
          () => sellResource(state, resource, 1),
        ),
        action(
          `sell-all-${resource}`,
          'Sell all',
          `Sell all ${resource}`,
          unavailable,
          unavailable ?? `Sell all ${state.inventory[resource]} ${resource}`,
          () => sellAllResource(state, resource),
        ),
      ],
      `${label} market row`,
    );
  });
}

function weaponsmithOffers(state: GameState): readonly NpcServiceOfferModel[] {
  const offers = [...skillOffers(state, ['strength'])];
  if (state.tools.length === 0) {
    offers.push(offer('weaponsmith-no-tools', 'No tools to upgrade', 'Craft a tool first, then bring it to Mara.'));
    return offers;
  }
  for (const tool of state.tools) {
    const definition = toolDefinition(tool.definitionId);
    const repairBlocked = repairToolBlockedReason(state, tool.instanceId);
    const repairAction = action(
      `repair-${tool.instanceId}`,
      'Repair',
      `Repair ${definition.displayName}`,
      repairBlocked,
      repairBlocked ?? 'Restore full durability for half the tool’s crafting materials',
      () => repairTool(state, tool.instanceId),
    );
    const upgradeActions = (['power', 'speed', 'durability'] as const).map((axis) => {
      const rank = toolUpgradeRank(tool, axis);
      const cost = toolUpgradeCost(tool, axis);
      const unavailable = cost === null
        ? 'Maximum rank reached'
        : state.coins < cost
          ? `Need ${cost - state.coins} more coins`
          : null;
      const label = cost === null
        ? `${axisLabel(axis)} R${rank} max`
        : `${axisLabel(axis)} R${rank + 1} · ${cost}c${state.coins >= cost ? ` → score ${state.coins - cost}` : ''}`;
      return action(
        `upgrade-${tool.instanceId}-${axis}`,
        label,
        label,
        unavailable,
        cost === null ? 'Maximum rank reached' : unavailable ?? `Score after purchase: ${state.coins - cost}`,
        () => upgradeTool(state, tool.instanceId, axis),
      );
    });
    offers.push(offer(
      `tool-${tool.instanceId}`,
      `${definition.displayName} · ${effectiveToolDamage(state, tool)} power · ${effectiveToolActionTicks(state, tool)} ticks`,
      `${tool.durability}/${tool.maxDurability} durability`,
      [repairAction, ...upgradeActions],
    ));
  }
  return offers;
}

function skillOffers(state: GameState, attributes: readonly AttributeId[]): readonly NpcServiceOfferModel[] {
  return attributes.map((attribute) => {
    const current = state.player.attributes[attribute];
    const unavailable = state.coins < SKILL_POINT_COST ? `Need ${SKILL_POINT_COST - state.coins} more coins` : null;
    return offer(
      `skill-${attribute}`,
      `${ATTRIBUTE_LABELS[attribute]} skill point · ${SKILL_POINT_COST} coins`,
      `Current ${current} · ${ATTRIBUTE_DESCRIPTIONS[attribute]}`,
      [action(
        `purchase-skill-${attribute}`,
        `Purchase +1${state.coins >= SKILL_POINT_COST ? ` · score → ${state.coins - SKILL_POINT_COST}` : ''}`,
        `Purchase ${ATTRIBUTE_LABELS[attribute]} skill point`,
        unavailable,
        unavailable ?? `Increase ${ATTRIBUTE_LABELS[attribute]} to ${current + 1}`,
        () => purchaseSkillPoint(state, attribute),
      )],
    );
  });
}

function magicShopOffers(state: GameState): readonly NpcServiceOfferModel[] {
  const offers = [...skillOffers(state, ['magic'])];
  const unavailable = magicStaffPurchaseBlockedReason(state);
  const owned = state.tools.filter((tool) => tool.definitionId === 'magic-staff').length;
  offers.push(offer(
    'magic-staff',
    `Magic Staff · ${MAGIC_STAFF_COST} coins`,
    `Owned ${owned} · Iron-tier staff effective against every resource`,
    [action(
      'purchase-magic-staff',
      `Purchase${unavailable === null ? ` · score → ${state.coins - MAGIC_STAFF_COST}` : ''}`,
      'Purchase Magic Staff',
      unavailable,
      unavailable ?? `Score after purchase: ${state.coins - MAGIC_STAFF_COST}`,
      () => purchaseMagicStaff(state),
    )],
  ));
  return offers;
}

function farmOffers(state: GameState): readonly NpcServiceOfferModel[] {
  return CREATURE_DEFINITIONS.map((definition) => {
    const unavailable = farmOrderBlockedReason(state, definition.speciesId);
    const cost = FARM_ORDER_COSTS[definition.speciesId];
    return offer(
      `farm-order-${definition.speciesId}`,
      `Trained ${definition.displayName} · ${cost} coins`,
      unavailable ?? 'Discovered and ready to order',
      [action(
        `order-${definition.speciesId}`,
        `Place order${state.coins >= cost ? ` · score → ${state.coins - cost}` : ''}`,
        `Order trained ${definition.displayName}`,
        unavailable,
        unavailable ?? `Score after purchase: ${state.coins - cost}`,
        () => orderTrainedCreature(state, definition.speciesId),
      )],
    );
  });
}

function offer(
  id: string,
  title: string,
  detail: string,
  actions: readonly NpcServiceActionModel[] = [],
  accessibilityLabel: string | null = null,
): NpcServiceOfferModel {
  return { id, title, detail, accessibilityLabel, actions };
}

function action(
  id: string,
  label: string,
  accessibilityLabel: string,
  disabledReason: string | null,
  title: string,
  execute: () => CommandResult,
): NpcServiceActionModel {
  return { id, label, accessibilityLabel, disabledReason, title, execute };
}

function axisLabel(axis: ToolUpgradeAxis): string {
  return axis[0]!.toUpperCase() + axis.slice(1);
}
