import {
  BLACKSMITH_UPGRADE_COSTS,
  BLACKSMITH_CONTRACTS,
  FARM_ORDER_COSTS,
  FARM_ORDER_CONTRACTS,
  MAGIC_STAFF_COST,
  SKILL_POINT_COST,
  SELL_PRICES,
  TOOL_DURABILITY_BPS_PER_RANK,
  TOOL_POWER_PER_RANK,
  TOOL_SPEED_BPS_PER_RANK,
  WORLD_BLACKSMITH_MAX_RANK,
  type ToolUpgradeAxis,
} from '../content/economy';
import { MAX_CREATURE_ROSTER, creatureDefinition } from '../content/creatures';
import { signatureCompanionAbility } from '../content/companionAbilities';
import { gameToolDefinition, toolDefinition } from '../config/balance';
import type { CommandResult } from './gameplayCommands';
import type { GameState, OwnedCreatureState, ResourceId, SpeciesId, ToolInstance } from './state';
import type { AttributeId } from './state';
import { ATTRIBUTE_LABELS, canIncreaseAttribute, increaseAttribute, inventoryCapacity } from './characterProgression';
import { unlockBlockedReason } from './unlocks';
import { creditCoins, spendCoins } from './coins';
import { recordFarmOrder, recordResourceSale, recordUpgrade } from './questTracking';
import { resourceStacksForAmount } from './inventoryStacks';
import { assignCreatureHousing, availableHousing, releaseCreature } from './workerHousing';
import { TEMPER_COSTS, TOOL_SCRAP_IRON } from '../content/economy';
import { workbenchMaxTemperRank } from './facilityLevels';
import { FACILITY_INTERACTION_RANGE_PX, nearestUsableFacility, tryAddResource } from './gameplayCommands';
import { BAG_ITEM_LABELS } from '../config/balance';
import type { BuildingState } from './state';

export function sellResource(state: GameState, resource: ResourceId, amount: number): CommandResult {
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, message: 'Choose a positive whole amount' };
  if (state.inventory[resource] < amount) return { ok: false, message: `Only ${state.inventory[resource]} ${resource} available` };
  // A zero price marks a quest or key item (Sealed Satchel, Vault Key, Recall
  // Flare). Selling one would destroy it for nothing, so the trade is refused.
  if (SELL_PRICES[resource] <= 0) return { ok: false, message: 'Nobody will buy that' };
  const proceeds = SELL_PRICES[resource] * amount;
  const transaction = creditCoins(state, proceeds, `Sold ${amount} ${resource} for ${proceeds} coins`);
  if (!transaction.ok) return transaction;
  state.inventory[resource] -= amount;
  state.resourcesSold += amount;
  recordResourceSale(state, resource, amount);
  return transaction;
}

export function sellAllResource(state: GameState, resource: ResourceId): CommandResult {
  const amount = state.inventory[resource];
  return amount > 0 ? sellResource(state, resource, amount) : { ok: false, message: `No ${resource} to sell` };
}

/** Purchase and immediately apply one point to the trainer's named attribute. */
export function purchaseSkillPoint(state: GameState, attribute: AttributeId): CommandResult {
  if (!canIncreaseAttribute(state, attribute)) return { ok: false, message: `${ATTRIBUTE_LABELS[attribute]} cannot be increased further` };
  const transaction = spendCoins(
    state,
    SKILL_POINT_COST,
    `${ATTRIBUTE_LABELS[attribute]} increased to ${state.player.attributes[attribute] + 1}`,
  );
  if (!transaction.ok) return transaction;
  increaseAttribute(state, attribute);
  return transaction;
}

/** Exact shop gate shared by the command and Magic Shop presentation. */
export function magicStaffPurchaseBlockedReason(state: GameState): string | null {
  if (state.coins < MAGIC_STAFF_COST) return `Need ${MAGIC_STAFF_COST - state.coins} more coins`;
  const usedSlots = state.tools.length + (Object.entries(state.inventory) as Array<[ResourceId, number]>)
    .reduce((slots, [resource, amount]) => slots + resourceStacksForAmount(state, resource, amount).length, 0);
  if (usedSlots >= inventoryCapacity(state)) return 'Inventory full';
  return null;
}

/** Purchase, carry, and equip one shop-exclusive Magic Staff atomically. */
export function purchaseMagicStaff(state: GameState): CommandResult {
  const blocked = magicStaffPurchaseBlockedReason(state);
  if (blocked) return { ok: false, message: blocked };
  const definition = gameToolDefinition(state, 'magic-staff');
  const transaction = spendCoins(state, MAGIC_STAFF_COST, 'Purchased and equipped Magic Staff');
  if (!transaction.ok) return transaction;
  const tool: ToolInstance = {
    instanceId: `tool-${state.nextEntityId}`,
    definitionId: 'magic-staff',
    durability: definition.maxDurability,
    maxDurability: definition.maxDurability,
    powerRank: 0,
    speedRank: 0,
    durabilityRank: 0,
  };
  state.nextEntityId += 1;
  state.tools.push(tool);
  state.equippedToolId = tool.instanceId;
  return transaction;
}

export function toolUpgradeRank(tool: ToolInstance, axis: ToolUpgradeAxis): number {
  return axis === 'power' ? tool.powerRank : axis === 'speed' ? tool.speedRank : tool.durabilityRank;
}

export function toolUpgradeCost(tool: ToolInstance, axis: ToolUpgradeAxis): number | null {
  const rank = toolUpgradeRank(tool, axis);
  return rank >= WORLD_BLACKSMITH_MAX_RANK ? null : BLACKSMITH_UPGRADE_COSTS[rank]!;
}

export function upgradeTool(state: GameState, toolId: string, axis: ToolUpgradeAxis): CommandResult {
  const tool = state.tools.find((candidate) => candidate.instanceId === toolId);
  if (!tool) return { ok: false, message: 'Tool not found' };
  const cost = toolUpgradeCost(tool, axis);
  if (cost === null) return { ok: false, message: `${axis} is already rank ${WORLD_BLACKSMITH_MAX_RANK}` };
  const contract = BLACKSMITH_CONTRACTS.find((candidate) => candidate.axis === axis && candidate.rank === toolUpgradeRank(tool, axis) + 1)!;
  const locked = unlockBlockedReason(state, contract.requirement);
  if (locked) return { ok: false, message: locked };
  const transaction = spendCoins(
    state,
    cost,
    `${toolDefinition(tool.definitionId).displayName} ${axis} upgraded to rank ${toolUpgradeRank(tool, axis) + 1}`,
  );
  if (!transaction.ok) return transaction;
  applyToolRank(state, tool, axis);
  return transaction;
}

/** Raise one axis a rank. Shared by Mara's coin upgrade and bench tempering. */
function applyToolRank(state: GameState, tool: ToolInstance, axis: ToolUpgradeAxis): void {
  if (axis === 'power') tool.powerRank += 1;
  else if (axis === 'speed') tool.speedRank += 1;
  else {
    tool.durabilityRank += 1;
    const oldMax = tool.maxDurability;
    tool.maxDurability = effectiveToolMaxDurability(state, tool);
    tool.durability += tool.maxDurability - oldMax;
  }
  recordUpgrade(state, axis, toolUpgradeRank(tool, axis));
}

/* -------------------------------------------------------------------------- */
/* Tempering and scrapping at your own Workbench                               */
/* -------------------------------------------------------------------------- */

/** The player's own usable Workbench in reach, if any. The town bench does not temper. */
export function nearestOwnWorkbench(state: GameState): BuildingState | null {
  return nearestUsableFacility(
    state,
    FACILITY_INTERACTION_RANGE_PX,
    state.buildings.filter((building) => building.definitionId === 'workbench'),
  );
}

/** Salvage cost of the next temper on an axis, or null at rank 4. */
export function temperCost(tool: ToolInstance, axis: ToolUpgradeAxis): Readonly<Partial<Record<ResourceId, number>>> | null {
  const rank = toolUpgradeRank(tool, axis);
  return rank >= WORLD_BLACKSMITH_MAX_RANK ? null : TEMPER_COSTS[rank]!;
}

export function temperToolBlockedReason(state: GameState, toolId: string, axis: ToolUpgradeAxis): string | null {
  const tool = state.tools.find((candidate) => candidate.instanceId === toolId);
  if (!tool) return 'Tool not found';
  const cost = temperCost(tool, axis);
  if (!cost) return `${axis} is already rank ${WORLD_BLACKSMITH_MAX_RANK}`;
  const bench = nearestOwnWorkbench(state);
  if (!bench) return 'Stand at your own Workbench';
  const target = toolUpgradeRank(tool, axis) + 1;
  const cap = workbenchMaxTemperRank(bench);
  if (target > cap) return `Rank ${target} needs a level ${target >= 4 ? 3 : 2} Workbench`;
  for (const [resource, amount] of Object.entries(cost) as Array<[ResourceId, number]>) {
    const short = amount - state.inventory[resource];
    if (short > 0) return `Need ${short} more ${BAG_ITEM_LABELS[resource]}`;
  }
  return null;
}

/** Buy the next rank on an axis with salvage, at a Workbench whose level allows it. */
export function temperTool(state: GameState, toolId: string, axis: ToolUpgradeAxis): CommandResult {
  const blocked = temperToolBlockedReason(state, toolId, axis);
  if (blocked) return { ok: false, message: blocked };
  const tool = state.tools.find((candidate) => candidate.instanceId === toolId)!;
  for (const [resource, amount] of Object.entries(temperCost(tool, axis)!) as Array<[ResourceId, number]>) {
    state.inventory[resource] -= amount;
  }
  applyToolRank(state, tool, axis);
  return { ok: true, message: `Tempered ${toolDefinition(tool.definitionId).displayName} ${axis} to rank ${toolUpgradeRank(tool, axis)}` };
}

/** Scrap Iron a tool would break down into now, or null for a tool that cannot be scrapped. */
export function toolScrapValue(tool: ToolInstance): number | null {
  const id = tool.definitionId;
  const base = id.startsWith('ancient-') ? TOOL_SCRAP_IRON.ancient
    : id.startsWith('masterwork-') ? TOOL_SCRAP_IRON.masterwork
      : id.startsWith('reinforced-') ? TOOL_SCRAP_IRON.reinforced
        : toolDefinition(id).tier === 'iron' ? TOOL_SCRAP_IRON.iron
          : toolDefinition(id).tier === 'stone' ? TOOL_SCRAP_IRON.stone
            : null;
  if (base === null || tool.maxDurability <= 0) return null;
  return Math.floor((base * tool.durability) / tool.maxDurability);
}

export function scrapToolBlockedReason(state: GameState, toolId: string): string | null {
  const tool = state.tools.find((candidate) => candidate.instanceId === toolId);
  if (!tool) return 'Tool not found';
  if (toolScrapValue(tool) === null) return 'Wooden tools cannot be scrapped';
  if (!nearestOwnWorkbench(state)) return 'Stand at your own Workbench';
  return null;
}

/** Destroy a tool for Scrap Iron. A worn tool returns less; one with nothing left returns nothing. */
export function scrapTool(state: GameState, toolId: string): CommandResult {
  const blocked = scrapToolBlockedReason(state, toolId);
  if (blocked) return { ok: false, message: blocked };
  const index = state.tools.findIndex((candidate) => candidate.instanceId === toolId);
  const tool = state.tools[index]!;
  const value = toolScrapValue(tool)!;
  // Check room before destroying anything: the tool's own slot frees up first.
  state.tools.splice(index, 1);
  if (value > 0 && !tryAddResource(state, 'scrap-iron', value)) {
    state.tools.splice(index, 0, tool);
    return { ok: false, message: 'No room in the bag for the scrap' };
  }
  if (state.equippedToolId === tool.instanceId) state.equippedToolId = null;
  const name = toolDefinition(tool.definitionId).displayName;
  return { ok: true, message: value > 0 ? `Scrapped ${name} for ${value} Scrap Iron` : `Scrapped ${name}; nothing usable left in it` };
}

export function effectiveToolDamage(tool: ToolInstance): number;
export function effectiveToolDamage(state: GameState, tool: ToolInstance): number;
export function effectiveToolDamage(stateOrTool: GameState | ToolInstance, maybeTool?: ToolInstance): number {
  const tool = maybeTool ?? stateOrTool as ToolInstance;
  const base = maybeTool
    ? gameToolDefinition(stateOrTool as GameState, tool.definitionId).damage
    : toolDefinition(tool.definitionId).damage;
  return base + tool.powerRank * TOOL_POWER_PER_RANK;
}

export function effectiveToolActionTicks(tool: ToolInstance): number;
export function effectiveToolActionTicks(state: GameState, tool: ToolInstance): number;
export function effectiveToolActionTicks(stateOrTool: GameState | ToolInstance, maybeTool?: ToolInstance): number {
  const tool = maybeTool ?? stateOrTool as ToolInstance;
  const base = maybeTool
    ? gameToolDefinition(stateOrTool as GameState, tool.definitionId).actionTicks
    : toolDefinition(tool.definitionId).actionTicks;
  return Math.max(1, Math.ceil(base * (10_000 - tool.speedRank * TOOL_SPEED_BPS_PER_RANK) / 10_000));
}

export function effectiveToolMaxDurability(tool: ToolInstance): number;
export function effectiveToolMaxDurability(state: GameState, tool: ToolInstance): number;
export function effectiveToolMaxDurability(stateOrTool: GameState | ToolInstance, maybeTool?: ToolInstance): number {
  const tool = maybeTool ?? stateOrTool as ToolInstance;
  const base = maybeTool
    ? gameToolDefinition(stateOrTool as GameState, tool.definitionId).maxDurability
    : toolDefinition(tool.definitionId).maxDurability;
  return Math.floor(base * (10_000 + tool.durabilityRank * TOOL_DURABILITY_BPS_PER_RANK) / 10_000);
}

export function farmOrderBlockedReason(state: GameState, speciesId: SpeciesId): string | null {
  const contract = FARM_ORDER_CONTRACTS.find((candidate) => candidate.speciesId === speciesId)!;
  const locked = unlockBlockedReason(state, contract.requirement);
  if (locked) return locked;
  if (state.ownedCreatures.length >= MAX_CREATURE_ROSTER) return `Roster full (${MAX_CREATURE_ROSTER}/${MAX_CREATURE_ROSTER})`;
  if (!availableHousing(state)) return 'Build an operational Small Pen or Barn with a free housing slot';
  const cost = FARM_ORDER_COSTS[speciesId];
  if (state.coins < cost) return `Need ${cost - state.coins} more coins`;
  return null;
}

export function orderTrainedCreature(state: GameState, speciesId: SpeciesId): CommandResult {
  const blocked = farmOrderBlockedReason(state, speciesId);
  if (blocked) return { ok: false, message: blocked };
  const definition = creatureDefinition(speciesId);
  const transaction = spendCoins(
    state,
    FARM_ORDER_COSTS[speciesId],
    `${definition.displayName} order complete; the new creature is resting`,
  );
  if (!transaction.ok) return transaction;
  const creature: OwnedCreatureState = {
    id: `creature-${state.nextEntityId}`,
    speciesId,
    name: definition.displayName,
    role: 'rest',
    assignment: null,
    worksiteId: null,
    nextWorkTick: state.tick,
    bondXp: 0,
    selectedBattleAbilityId: signatureCompanionAbility(speciesId),
    housingId: null,
    workRemainderMs: 0,
    // Farm-raised stock is level 1 by definition: a levelled creature is
    // something the player went out and caught, not something they bought.
    level: 1,
  };
  state.ownedCreatures.push(creature);
  state.nextEntityId += 1;
  const housed = assignCreatureHousing(state, creature.id);
  if (!housed.ok) {
    state.ownedCreatures.pop();
    state.nextEntityId -= 1;
    state.coins += FARM_ORDER_COSTS[speciesId];
    return housed;
  }
  recordFarmOrder(state, speciesId);
  return transaction;
}

export { releaseCreature };
