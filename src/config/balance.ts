import type { ResourceId, ResourceNodeKind, ToolDefinitionId } from '../simulation/state';

/** First vertical-slice balance values. All simulation values are integers. */
export const INTERACTION_RANGE_PX = 42;
export const TAMING_RANGE_PX = 42;
export const TUFTLE_TAME_FIBER_COST = 3;
/** One Tuftle work attempt every three real-time seconds at the fixed 60 Hz tick. */
export const TUFTLE_WORK_TICKS = 180;
/** Tuftles work without tools, so a node takes several visits to harvest. */
export const TUFTLE_WORK_DAMAGE = 10;
/** Each Field Cache has a separate stack for each basic resource. */
export const FIELD_CACHE_STACK_SIZE = 99;
export const INVENTORY_SLOTS = 20;
export const RESOURCE_STACK_SIZE = 99;

export interface ResourceBalance {
  maxHp: number;
  yieldAmount: number;
  resource: ResourceId;
  /** Fixed simulation ticks before a depleted node renews. */
  respawnTicks: number;
}

export const RESOURCE_BALANCE: Readonly<Record<ResourceNodeKind, ResourceBalance>> = {
  tree: { maxHp: 30, yieldAmount: 4, resource: 'wood', respawnTicks: 7_200 },
  stone: { maxHp: 40, yieldAmount: 3, resource: 'stone', respawnTicks: 10_800 },
  plant: { maxHp: 20, yieldAmount: 5, resource: 'fiber', respawnTicks: 3_600 },
};

export const HANDS_DAMAGE_TREE = 5;
export const HANDS_ACTION_TICKS = 30;

/**
 * Garden Bed: renewable fiber growth inside a qualifying grassland work yard.
 * One batch matches a plant node's yield and respawn pacing, but grows next to
 * the player's base. All values are integers on the fixed 60 Hz tick.
 */
export const GARDEN_BED_GROW_TICKS = 3_600;
export const GARDEN_BED_YIELD_FIBER = 5;
/** Grown fiber waits in the bed up to this cap; a full bed pauses growth. */
export const GARDEN_BED_READY_CAP = 15;
/** Growth advances in one-second quanta so environment validity is re-derived cheaply. */
export const GARDEN_BED_GROWTH_STEP_TICKS = 60;

/** Woodlot Planter: slower renewable wood from a qualifying forest work yard. */
export const WOODLOT_GROW_TICKS = 7_200;
export const WOODLOT_YIELD_WOOD = 4;
export const WOODLOT_READY_CAP = 12;
export const WOODLOT_GROWTH_STEP_TICKS = 60;

export type ToolKind = 'axe' | 'pick' | 'sickle';
export interface ToolDefinition {
  definitionId: ToolDefinitionId;
  displayName: string;
  kind: ToolKind;
  tier: 'wooden' | 'stone';
  craftCost: Readonly<Partial<Record<ResourceId, number>>>;
  maxDurability: number;
  damage: number;
  actionTicks: number;
  wearPerHit: number;
  repairBasisCost: Readonly<Partial<Record<ResourceId, number>>>;
  efficiencyAxes: readonly ('break' | 'uptime')[];
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  { definitionId: 'wooden-axe', displayName: 'Wooden Axe', kind: 'axe', tier: 'wooden', craftCost: { wood: 5 }, maxDurability: 48, damage: 10, actionTicks: 24, wearPerHit: 1, repairBasisCost: { wood: 5 }, efficiencyAxes: ['break', 'uptime'] },
  { definitionId: 'wooden-pick', displayName: 'Wooden Pick', kind: 'pick', tier: 'wooden', craftCost: { wood: 5 }, maxDurability: 48, damage: 10, actionTicks: 24, wearPerHit: 1, repairBasisCost: { wood: 5 }, efficiencyAxes: ['break', 'uptime'] },
  { definitionId: 'wooden-sickle', displayName: 'Wooden Sickle', kind: 'sickle', tier: 'wooden', craftCost: { wood: 4 }, maxDurability: 44, damage: 10, actionTicks: 22, wearPerHit: 1, repairBasisCost: { wood: 4 }, efficiencyAxes: ['break', 'uptime'] },
  { definitionId: 'stone-axe', displayName: 'Stone Axe', kind: 'axe', tier: 'stone', craftCost: { wood: 2, stone: 6 }, maxDurability: 96, damage: 15, actionTicks: 18, wearPerHit: 1, repairBasisCost: { wood: 2, stone: 6 }, efficiencyAxes: ['break', 'uptime'] },
  { definitionId: 'stone-pick', displayName: 'Stone Pick', kind: 'pick', tier: 'stone', craftCost: { wood: 2, stone: 6 }, maxDurability: 96, damage: 15, actionTicks: 18, wearPerHit: 1, repairBasisCost: { wood: 2, stone: 6 }, efficiencyAxes: ['break', 'uptime'] },
  { definitionId: 'stone-sickle', displayName: 'Stone Sickle', kind: 'sickle', tier: 'stone', craftCost: { wood: 2, stone: 5 }, maxDurability: 88, damage: 15, actionTicks: 17, wearPerHit: 1, repairBasisCost: { wood: 2, stone: 5 }, efficiencyAxes: ['break', 'uptime'] },
];

export function toolDefinition(id: ToolDefinitionId): ToolDefinition {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.definitionId === id);
  if (!definition) throw new Error(`unknown tool ${id}`);
  return definition;
}

/** Compatibility export retained for existing callers and saves/tests. */
export const WOODEN_PICK = {
  ...toolDefinition('wooden-pick'),
  woodCost: toolDefinition('wooden-pick').craftCost.wood!,
  stoneDamage: toolDefinition('wooden-pick').damage,
} as const;
