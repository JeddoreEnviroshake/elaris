import {
  HANDS_ACTION_TICKS,
  HANDS_DAMAGE_TREE,
  FIELD_CACHE_STACK_SIZE,
  INTERACTION_RANGE_PX,
  TAMING_RANGE_PX,
  RESOURCE_BALANCE,
  RESOURCE_STACK_SIZE,
  toolDefinition,
  WOODEN_PICK,
} from '../config/balance';
import { AREA_TIERS, PLACEABLES, type PlaceableId } from '../config/areaGates';
import { MAX_ACTIVE_FOLLOWERS, creatureDefinition } from '../content/creatures';
import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import { starterBiomeAt } from './biomes';
import { evaluatePlaceableGate, measureEnclosedAreas, measureEnvironment, recordHighestAreaTier } from './environmentProgress';
import { createGardenBedState, createWoodlotPlanterState } from './state';
import type { BuildingDefinitionId, BuildingState, CreatureRole, GameState, GroundDropState, ResourceId, ResourceNodeState, ToolDefinitionId, ToolInstance, WildCreatureState } from './state';
import { actionCooldown, gatheringPowerBonus, grantXp, inventoryCapacity } from './characterProgression';

export interface CommandResult {
  ok: boolean;
  message: string;
  targetId?: string;
  depleted?: boolean;
  toolBroke?: boolean;
}

export type ResourceAmounts = Readonly<Partial<Record<ResourceId, number>>>;

export interface BuildableDefinition {
  id: BuildingDefinitionId;
  displayName: string;
  cost: ResourceAmounts;
  tilesWide: number;
  tilesHigh: number;
}
export interface PlacementCheck { ok: boolean; message: string }
export interface PlaceResult extends PlacementCheck { building?: BuildingState }
export const BUILD_RANGE_PX = TILE_SIZE * 4;
export const BUILDABLES: readonly BuildableDefinition[] = [
  { id: 'palisade-wall', displayName: 'Palisade Wall', cost: { wood: 1 }, tilesWide: 1, tilesHigh: 1 },
  { id: 'field-cache', displayName: 'Field Cache', cost: { wood: 4 }, tilesWide: 1, tilesHigh: 1 },
  { id: 'workbench', displayName: 'Workbench', cost: { wood: 8 }, tilesWide: 2, tilesHigh: 1 },
  { id: 'garden-bed', displayName: 'Garden Bed', cost: { wood: 4, fiber: 2 }, tilesWide: 2, tilesHigh: 1 },
  { id: 'woodlot-planter', displayName: 'Woodlot Planter', cost: { wood: 6, stone: 2 }, tilesWide: 2, tilesHigh: 2 },
];

export function buildableById(id: BuildingDefinitionId): BuildableDefinition {
  const definition = BUILDABLES.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`unknown buildable ${id}`);
  return definition;
}

/** Presentation-compatible pure validation; persisted state is authoritative. */
export function validatePlacement(state: GameState, _placed: readonly BuildingState[], def: BuildableDefinition, tileX: number, tileY: number): PlacementCheck {
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || tileX < 0 || tileY < 0 || tileX + def.tilesWide > WORLD_TILES || tileY + def.tilesHigh > WORLD_TILES)
    return { ok: false, message: 'Out of bounds' };
  for (const other of state.buildings) {
    const otherDef = buildableById(other.definitionId);
    if (rectsOverlap(tileX, tileY, def.tilesWide, def.tilesHigh, other.tileX, other.tileY, otherDef.tilesWide, otherDef.tilesHigh)) return { ok: false, message: 'Blocked' };
  }
  for (const node of state.resourceNodes) {
    const x = Math.floor(node.x / TILE_SIZE); const y = Math.floor(node.y / TILE_SIZE);
    if (x >= tileX && x < tileX + def.tilesWide && y >= tileY && y < tileY + def.tilesHigh) return { ok: false, message: 'Blocked' };
  }
  const playerX = Math.floor(state.player.x / TILE_SIZE); const playerY = Math.floor(state.player.y / TILE_SIZE);
  if (playerX >= tileX && playerX < tileX + def.tilesWide && playerY >= tileY && playerY < tileY + def.tilesHigh) return { ok: false, message: "You're standing there" };
  const centerX = (tileX + def.tilesWide / 2) * TILE_SIZE; const centerY = (tileY + def.tilesHigh / 2) * TILE_SIZE;
  if (Math.hypot(centerX - state.player.x, centerY - state.player.y) > BUILD_RANGE_PX) return { ok: false, message: 'Too far away' };
  if (def.id !== 'palisade-wall') {
    const placeable = PLACEABLES.find((candidate) => candidate.id === def.id as PlaceableId);
    if (!placeable) return { ok: false, message: 'Unknown placeable' };
    const locked = placeableLockedReason(state, placeable);
    if (locked) return { ok: false, message: locked };
    if ('requiredTerrain' in placeable) {
      for (let dy = 0; dy < def.tilesHigh; dy += 1) for (let dx = 0; dx < def.tilesWide; dx += 1) {
        const centerX = (tileX + dx) * TILE_SIZE + TILE_SIZE / 2;
        const centerY = (tileY + dy) * TILE_SIZE + TILE_SIZE / 2;
        if (starterBiomeAt(state.seed, centerX, centerY) !== placeable.requiredTerrain) {
          return { ok: false, message: `Requires open ${placeable.requiredTerrain} soil` };
        }
      }
    }
    const kind = 'environmentKind' in placeable ? placeable.environmentKind : 'indoor';
    const gate = evaluatePlaceableGate(placeable, measureEnvironment(state.buildings, tileX, tileY, kind));
    if (!gate.ok) return { ok: false, message: gate.reason ?? 'Environment requirements not met' };
  }
  return { ok: true, message: '' };
}

/**
 * Sticky discovery gate: a placeable with `discoverAtAreaTier` stays locked
 * until `highestAreaTierEver` reaches that tier, and never re-locks afterwards.
 * Returns the exact reason while locked, or null once discovered.
 */
export function placeableLockedReason(
  state: GameState,
  placeable: (typeof PLACEABLES)[number],
): string | null {
  if (!('discoverAtAreaTier' in placeable)) return null;
  if (state.highestAreaTierEver >= placeable.discoverAtAreaTier) return null;
  const tier = AREA_TIERS.find((candidate) => candidate.area === placeable.discoverAtAreaTier);
  return `Locked — first enclose a ${placeable.discoverAtAreaTier}-tile ${tier?.label ?? 'area'}`;
}

export function checkPlacement(state: GameState, placed: readonly BuildingState[], def: BuildableDefinition, tileX: number, tileY: number): PlacementCheck {
  const check = validatePlacement(state, placed, def, tileX, tileY);
  if (!check.ok) return check;
  const missing = firstMissingResource(state, def.cost);
  return missing ? { ok: false, message: `Need ${missing.amount} more ${missing.resource}` } : check;
}

/** Atomically validates, pays for, and persists a building. */
export function placeBuilding(state: GameState, placed: BuildingState[], def: BuildableDefinition, tileX: number, tileY: number, _allocateId?: () => string): PlaceResult {
  const check = checkPlacement(state, placed, def, tileX, tileY);
  if (!check.ok) return check;
  for (const [resource, amount] of Object.entries(def.cost) as Array<[ResourceId, number]>) state.inventory[resource] -= amount;
  const building: BuildingState = {
    id: `building-${state.nextEntityId}`,
    definitionId: def.id,
    tileX,
    tileY,
    ...(def.id === 'field-cache' ? { storage: { wood: 0, stone: 0, fiber: 0 } } : {}),
    ...(def.id === 'garden-bed' ? { garden: createGardenBedState(state.tick) } : {}),
    ...(def.id === 'woodlot-planter' ? { woodlot: createWoodlotPlanterState(state.tick) } : {}),
  };
  state.nextEntityId += 1; state.buildings.push(building);
  updateAreaProgress(state);
  grantXp(state, 25);
  return { ok: true, message: `Placed ${def.displayName}`, building };
}

export function removeBuilding(state: GameState, buildingId: string): CommandResult {
  const index = state.buildings.findIndex((building) => building.id === buildingId);
  if (index < 0) return { ok: false, message: 'Building not found' };
  const building = state.buildings[index]!; const def = buildableById(building.definitionId);
  const centerX = (building.tileX + def.tilesWide / 2) * TILE_SIZE; const centerY = (building.tileY + def.tilesHigh / 2) * TILE_SIZE;
  if (Math.hypot(centerX - state.player.x, centerY - state.player.y) > BUILD_RANGE_PX) return { ok: false, message: 'Too far away' };
  state.buildings.splice(index, 1); updateAreaProgress(state);
  return { ok: true, message: `Removed ${def.displayName}`, targetId: building.id };
}

function updateAreaProgress(state: GameState): void {
  for (const measurement of measureEnclosedAreas(state.buildings)) recordHighestAreaTier(state, measurement);
}

function rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

export function nearestLiveNode(
  state: GameState,
  range = INTERACTION_RANGE_PX,
): ResourceNodeState | null {
  let nearest: ResourceNodeState | null = null;
  let nearestDistance = range;
  for (const node of state.resourceNodes) {
    if (node.hp <= 0) continue;
    const distance = Math.hypot(node.x - state.player.x, node.y - state.player.y);
    if (distance <= nearestDistance) {
      nearest = node;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function nearestWildCreature(state: GameState, range = TAMING_RANGE_PX): WildCreatureState | null {
  let nearest: WildCreatureState | null = null;
  let nearestDistance = range;
  for (const creature of state.wildCreatures) {
    const distance = Math.hypot(creature.x - state.player.x, creature.y - state.player.y);
    if (distance <= nearestDistance) {
      nearest = creature;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** The initial taming loop is intentionally peaceful: offer three fiber to a nearby Tuftle. */
export function tameNearestCreature(state: GameState): CommandResult {
  const creature = nearestWildCreature(state);
  if (!creature) return { ok: false, message: 'Move closer to a wild creature' };
  const definition = creatureDefinition(creature.speciesId);
  if (state.ownedCreatures.filter((owned) => owned.speciesId === creature.speciesId).length >= definition.rosterLimit) {
    return { ok: false, message: `${definition.displayName} is already in your roster`, targetId: creature.id };
  }
  const missing = firstMissingResource(state, definition.tameCost);
  if (missing) return { ok: false, message: `Need ${missing.amount} ${missing.resource} to tame ${definition.displayName}`, targetId: creature.id };
  for (const [resource, amount] of Object.entries(definition.tameCost) as Array<[ResourceId, number]>) state.inventory[resource] -= amount;
  state.wildCreatures = state.wildCreatures.filter((candidate) => candidate.id !== creature.id);
  state.ownedCreatures.push({
    id: `creature-${state.nextEntityId}`,
    speciesId: creature.speciesId,
    name: definition.displayName,
    role: 'rest',
    assignment: null,
    worksiteId: null,
    nextWorkTick: state.tick,
  });
  state.nextEntityId += 1;
  grantXp(state, 40);
  return { ok: true, message: `${definition.displayName} tamed!`, targetId: creature.id };
}

function buildingCenter(building: BuildingState): { x: number; y: number } {
  const definition = buildableById(building.definitionId);
  return { x: (building.tileX + definition.tilesWide / 2) * TILE_SIZE, y: (building.tileY + definition.tilesHigh / 2) * TILE_SIZE };
}

export function eligibleCreatureWorksites(state: GameState, creatureId: string): BuildingState[] {
  const creature = state.ownedCreatures.find((candidate) => candidate.id === creatureId);
  if (!creature) return [];
  const definition = creatureDefinition(creature.speciesId);
  if (!definition.work) return [];
  const work = definition.work;
  return state.buildings
    .filter((building) => work.eligibleWorksites.includes(building.definitionId))
    .sort((left, right) => {
      const a = buildingCenter(left); const b = buildingCenter(right);
      return Math.hypot(a.x - state.player.x, a.y - state.player.y) - Math.hypot(b.x - state.player.x, b.y - state.player.y) || left.id.localeCompare(right.id);
    });
}

/** Atomic role transition. Work chooses the nearest eligible stable worksite. */
export function setCreatureRole(state: GameState, creatureId: string, role: CreatureRole): CommandResult {
  const creature = state.ownedCreatures.find((candidate) => candidate.id === creatureId);
  if (!creature) return { ok: false, message: 'Creature not found' };
  const definition = creatureDefinition(creature.speciesId);
  if (role === 'follow' && creature.role !== 'follow') {
    const activeFollowers = state.ownedCreatures.filter((candidate) => candidate.role === 'follow').length;
    if (activeFollowers >= MAX_ACTIVE_FOLLOWERS) {
      return { ok: false, message: `Choose a follower to rest first (${MAX_ACTIVE_FOLLOWERS}/${MAX_ACTIVE_FOLLOWERS} active)` };
    }
  }
  if (role === 'work') {
    if (!definition.work) return { ok: false, message: `${creature.name}'s work role is not unlocked yet` };
    const worksite = eligibleCreatureWorksites(state, creatureId)[0];
    if (!worksite) return { ok: false, message: `Place a ${definition.work.eligibleWorksites.map((id) => buildableById(id).displayName).join(' or ')} first` };
    if (!fieldCache(state)) return { ok: false, message: 'Place a Field Cache before assigning work' };
    creature.role = 'work';
    creature.assignment = definition.work.resource;
    creature.worksiteId = worksite.id;
    creature.nextWorkTick = state.tick + definition.work.intervalTicks;
    return { ok: true, message: `${creature.name} assigned to ${buildableById(worksite.definitionId).displayName}` };
  }
  creature.role = role;
  creature.assignment = null;
  creature.worksiteId = null;
  return {
    ok: true,
    message: role === 'follow'
      ? definition.followMode === 'mount'
        ? `${creature.name} mounted · ${definition.travelSpeedMultiplier}× travel speed`
        : `${creature.name} is following`
      : `${creature.name} is resting`,
  };
}

/** The first Field Cache is the shared destination for all early automation. */
export function fieldCache(state: GameState): BuildingState | null {
  return state.buildings.find((building) => building.definitionId === 'field-cache') ?? null;
}

/** Explicitly assign or rest a tamed Tuftle. A cache prevents invisible loss. */
export function assignTuftle(state: GameState, creatureId: string, assignment: ResourceId | null): CommandResult {
  const creature = state.ownedCreatures.find((candidate) => candidate.id === creatureId);
  if (!creature) return { ok: false, message: 'Tuftle not found' };
  if (assignment !== null && !fieldCache(state)) {
    return { ok: false, message: 'Place a Field Cache before assigning Tuftle' };
  }
  creature.role = assignment === null ? 'rest' : 'work';
  creature.assignment = assignment;
  creature.worksiteId = assignment === null ? null : fieldCache(state)!.id;
  const work = creatureDefinition(creature.speciesId).work;
  if (!work) return { ok: false, message: `${creature.name}'s work role is not unlocked yet` };
  creature.nextWorkTick = state.tick + work.intervalTicks;
  return { ok: true, message: assignment ? `Tuftle assigned to ${assignment}` : 'Tuftle is resting' };
}

/**
 * Deterministic background work, called once per fixed simulation tick. A
 * completed node yields directly to cache storage; full caches simply pause
 * that worker until room is made, with no resource loss.
 */
export function advanceTuftleWork(state: GameState): boolean {
  const cache = fieldCache(state);
  if (!cache) return false;
  cache.storage ??= { wood: 0, stone: 0, fiber: 0 };
  let changed = false;
  for (const creature of state.ownedCreatures) {
    if (creature.role !== 'work' || !creature.assignment || !creature.worksiteId || state.tick < creature.nextWorkTick) continue;
    if (!state.buildings.some((building) => building.id === creature.worksiteId)) {
      creature.role = 'rest'; creature.assignment = null; creature.worksiteId = null; changed = true; continue;
    }
    const node = state.resourceNodes.find((candidate) => candidate.hp > 0 && RESOURCE_BALANCE[candidate.kind].resource === creature.assignment);
    if (!node) continue;
    const reward = RESOURCE_BALANCE[node.kind];
    // Do not damage a resource if there is nowhere to put its completed yield.
    const definition = creatureDefinition(creature.speciesId);
    if (!definition.work) {
      creature.role = 'rest'; creature.assignment = null; creature.worksiteId = null; changed = true; continue;
    }
    if (node.hp <= definition.work.damage && cache.storage[reward.resource] + reward.yieldAmount > FIELD_CACHE_STACK_SIZE) continue;
    node.hp = Math.max(0, node.hp - definition.work.damage);
    creature.nextWorkTick = state.tick + definition.work.intervalTicks;
    changed = true;
    if (node.hp === 0) {
      node.respawnAtTick = state.tick + reward.respawnTicks;
      cache.storage[reward.resource] += reward.yieldAmount;
      state.resourcesCollected[reward.resource] += reward.yieldAmount;
      state.workerResourcesProduced += reward.yieldAmount;
    }
  }
  return changed;
}

/** Move cache goods into the player's inventory without destroying overflow. */
export function withdrawFromFieldCache(state: GameState, resource: ResourceId): CommandResult {
  const cache = fieldCache(state);
  const available = cache?.storage?.[resource] ?? 0;
  if (!cache || available <= 0) return { ok: false, message: `No ${resource} in Field Cache` };
  if (!tryAddResource(state, resource, available)) return { ok: false, message: 'Inventory full' };
  cache.storage![resource] = 0;
  return { ok: true, message: `Collected ${available} ${resource} from Field Cache` };
}

/** Resolve one context-gather command after atomically revalidating state. */
export function gatherNearest(state: GameState): CommandResult {
  if (state.tick < state.actionCooldownUntilTick) {
    return { ok: false, message: 'Not ready yet' };
  }

  const node = nearestLiveNode(state);
  if (!node) return { ok: false, message: 'Move closer to a resource' };
  if (state.player.stamina < 2) return { ok: false, message: 'Not enough stamina', targetId: node.id };

  const tool = equippedTool(state);
  let damage = 0;
  let cooldown = HANDS_ACTION_TICKS;
  let wear = 0;

  const definition = tool ? toolDefinition(tool.definitionId) : null;
  const requiredKind = node.kind === 'tree' ? 'axe' : node.kind === 'stone' ? 'pick' : 'sickle';
  if (tool && tool.durability <= 0) {
    return { ok: false, message: `Your ${definition!.displayName} is broken`, targetId: node.id };
  }
  if (definition?.kind === requiredKind) {
    damage = definition.damage;
    cooldown = definition.actionTicks;
    wear = definition.wearPerHit;
  } else if (node.kind === 'tree' || node.kind === 'plant') {
    damage = HANDS_DAMAGE_TREE;
  } else {
    return {
      ok: false,
      message: 'Stone requires a pick',
      targetId: node.id,
    };
  }

  damage += gatheringPowerBonus(state);
  node.hp = Math.max(0, node.hp - damage);
  state.player.stamina -= 2;
  state.actionCooldownUntilTick = state.tick + actionCooldown(state, cooldown);

  let toolBroke = false;
  if (tool && wear > 0) {
    tool.durability = Math.max(0, tool.durability - wear);
    if (tool.durability === 0) {
      state.equippedToolId = null;
      toolBroke = true;
    }
  }

  if (node.hp > 0) {
    return {
      ok: true,
      message: `${label(node.kind)} ${node.hp}/${node.maxHp}`,
      targetId: node.id,
      toolBroke,
    };
  }

  const drop = RESOURCE_BALANCE[node.kind];
  node.respawnAtTick = state.tick + drop.respawnTicks;
  state.resourcesCollected[drop.resource] += drop.yieldAmount;
  grantXp(state, 10);
  const dropped = !tryAddResource(state, drop.resource, drop.yieldAmount);
  if (dropped) addGroundDrop(state, drop.resource, drop.yieldAmount, node.x, node.y);
  return {
    ok: true,
    message: dropped
      ? `${drop.yieldAmount} ${drop.resource} dropped (inventory full)${toolBroke ? ' · Tool broke' : ''}`
      : `+${drop.yieldAmount} ${drop.resource}${toolBroke ? ' · Tool broke' : ''}`,
    targetId: node.id,
    depleted: true,
    toolBroke,
  };
}

/** Renew every due resource in stable node order. Returns true when state changed. */
export function advanceResourceRenewal(state: GameState): boolean {
  let changed = false;
  for (const node of state.resourceNodes) {
    if (node.hp > 0 || node.respawnAtTick === null || state.tick < node.respawnAtTick) continue;
    node.hp = node.maxHp;
    node.respawnAtTick = null;
    changed = true;
  }
  return changed;
}

/** Atomic handcraft recipe for the first progression tool. */
export function craftWoodenPick(state: GameState): CommandResult {
  return craftTool(state, WOODEN_PICK.definitionId);
}

/** Atomically craft and equip any defined tool. */
export function craftTool(state: GameState, definitionId: ToolDefinitionId): CommandResult {
  const definition = toolDefinition(definitionId);
  const missing = firstMissingResource(state, definition.craftCost);
  if (missing) return { ok: false, message: `Need ${missing.amount} more ${missing.resource}` };
  if (usedInventorySlotsAfterCost(state, definition.craftCost) + 1 > inventoryCapacity(state)) {
    return { ok: false, message: 'Inventory full' };
  }
  for (const [resource, amount] of Object.entries(definition.craftCost) as Array<[ResourceId, number]>) state.inventory[resource] -= amount;
  const tool: ToolInstance = {
    instanceId: `tool-${state.nextEntityId}`,
    definitionId,
    durability: definition.maxDurability,
    maxDurability: definition.maxDurability,
  };
  state.nextEntityId += 1;
  state.tools.push(tool);
  state.equippedToolId = tool.instanceId;
  grantXp(state, 20);
  return { ok: true, message: `Crafted and equipped ${definition.displayName}` };
}

/** Repairs a retained tool with its definition's proportional material basis. */
export function repairTool(state: GameState, toolId: string): CommandResult {
  const tool = state.tools.find((candidate) => candidate.instanceId === toolId);
  if (!tool) return { ok: false, message: 'Tool not found' };
  const missing = tool.maxDurability - tool.durability;
  if (missing <= 0) return { ok: false, message: 'Tool is already fully repaired' };

  const restored = Math.min(missing, Math.max(1, Math.ceil(tool.maxDurability * 0.25)));
  const cost = repairCost(toolDefinition(tool.definitionId).repairBasisCost, restored, tool.maxDurability);
  const missingResource = firstMissingResource(state, cost);
  if (missingResource) {
    return { ok: false, message: `Need ${missingResource.amount} more ${missingResource.resource}` };
  }

  for (const [resource, amount] of Object.entries(cost) as Array<[ResourceId, number]>) {
    state.inventory[resource] -= amount;
  }
  tool.durability += restored;
  state.repairsMade += 1;
  return { ok: true, message: `Repaired ${restored} durability` };
}

/** Equipping is explicit so repairing a broken tool never changes loadout unexpectedly. */
export function equipTool(state: GameState, toolId: string): CommandResult {
  const tool = state.tools.find((candidate) => candidate.instanceId === toolId);
  if (!tool) return { ok: false, message: 'Tool not found' };
  if (tool.durability <= 0) return { ok: false, message: 'Repair this tool before equipping it' };
  state.equippedToolId = tool.instanceId;
  return { ok: true, message: `Equipped ${toolDefinition(tool.definitionId).displayName}` };
}

/** Attempts to collect the whole nearby drop. A full inventory leaves it in place. */
export function collectNearestGroundDrop(state: GameState, range = INTERACTION_RANGE_PX): CommandResult {
  const drop = nearestGroundDrop(state, range);
  if (!drop) return { ok: false, message: 'Move closer to a dropped resource' };
  if (!tryAddResource(state, drop.resource, drop.amount)) {
    return { ok: false, message: 'Inventory full', targetId: drop.id };
  }
  state.groundDrops = state.groundDrops.filter((item) => item.id !== drop.id);
  return { ok: true, message: `Picked up ${drop.amount} ${drop.resource}`, targetId: drop.id };
}

export function equippedTool(state: GameState): ToolInstance | null {
  if (state.equippedToolId === null) return null;
  return state.tools.find((tool) => tool.instanceId === state.equippedToolId) ?? null;
}

/** Number of resource stacks plus one slot per non-stackable tool instance. */
export function usedInventorySlots(state: GameState): number {
  return state.tools.length + Object.values(state.inventory).reduce(
    (slots, amount) => slots + Math.ceil(amount / RESOURCE_STACK_SIZE),
    0,
  );
}

function usedInventorySlotsAfterCost(state: GameState, cost: ResourceAmounts): number {
  return state.tools.length + Object.entries(state.inventory).reduce(
    (slots, [resource, amount]) =>
      slots + Math.ceil((amount - (cost[resource as ResourceId] ?? 0)) / RESOURCE_STACK_SIZE),
    0,
  );
}

export function tryAddResource(state: GameState, resource: ResourceId, amount: number): boolean {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  const current = state.inventory[resource];
  const currentSlots = Math.ceil(current / RESOURCE_STACK_SIZE);
  const resultingSlots = Math.ceil((current + amount) / RESOURCE_STACK_SIZE);
  if (usedInventorySlots(state) - currentSlots + resultingSlots > inventoryCapacity(state)) return false;
  state.inventory[resource] += amount;
  return true;
}

function nearestGroundDrop(state: GameState, range: number): GroundDropState | null {
  let nearest: GroundDropState | null = null;
  let nearestDistance = range;
  for (const drop of state.groundDrops) {
    const distance = Math.hypot(drop.x - state.player.x, drop.y - state.player.y);
    if (distance <= nearestDistance) {
      nearest = drop;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function addGroundDrop(state: GameState, resource: ResourceId, amount: number, x: number, y: number): void {
  state.groundDrops.push({
    id: `drop-${state.nextEntityId}`,
    resource,
    amount,
    x,
    y,
  });
  state.nextEntityId += 1;
}

function repairCost(basis: ResourceAmounts, restored: number, maxDurability: number): ResourceAmounts {
  return Object.fromEntries(
    Object.entries(basis).map(([resource, amount]) => [
      resource,
      Math.max(1, Math.ceil((amount * 0.5 * restored) / maxDurability)),
    ]),
  ) as ResourceAmounts;
}

function firstMissingResource(
  state: GameState,
  costs: ResourceAmounts,
): { resource: ResourceId; amount: number } | null {
  for (const [resource, cost] of Object.entries(costs) as Array<[ResourceId, number]>) {
    const missing = cost - state.inventory[resource];
    if (missing > 0) return { resource, amount: missing };
  }
  return null;
}

function label(kind: ResourceNodeState['kind']): string {
  if (kind === 'tree') return 'Tree';
  if (kind === 'stone') return 'Stone';
  return 'Plant';
}
