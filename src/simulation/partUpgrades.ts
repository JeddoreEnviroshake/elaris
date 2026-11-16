import { BAG_ITEM_LABELS } from '../config/balance';
import { BUILDABLES, buildableById, type BuildableDefinition, type BuildingMaterialId, type ResourceAmounts } from '../content/buildingParts';
import { MAX_BATCH_PARTS } from './batchBuilding';
import { buildingCenterPx } from './buildingGeometry';
import { BUILD_RANGE_PX, demolitionRefund, knowsBlueprint, updateAreaProgress, type CommandResult } from './gameplayCommands';
import { recordBuildingPlaced } from './questTracking';
import type { BoundaryEdge, BuildingState, GameState, ResourceId } from './state';
import { cellKey, environments } from './environmentProgress';
import { effectiveBoundaryEdge } from './buildingGeometry';

/**
 * Upgrading a placed surface or boundary part to the next material in place:
 * thatch → wood → stone → metal, keeping its kind (floor, wall, door…), id,
 * tile, edge and rotation. The price is the new part less what demolishing the
 * old one would have refunded, so upgrading never costs more than tearing down
 * and rebuilding, and never less than nothing.
 */

const MATERIAL_ORDER: readonly BuildingMaterialId[] = ['thatch', 'wood', 'stone', 'metal'];

/** The same part one material up, or null at metal or for a part without a material ladder. */
export function upgradeTarget(def: BuildableDefinition): BuildableDefinition | null {
  if ((def.layer !== 'surface' && def.layer !== 'boundary') || !def.material) return null;
  const next = MATERIAL_ORDER[MATERIAL_ORDER.indexOf(def.material) + 1];
  if (!next) return null;
  return BUILDABLES.find((candidate) => candidate.layer === def.layer
    && candidate.material === next
    && candidate.surfaceKind === def.surfaceKind
    && candidate.boundaryClass === def.boundaryClass
    && candidate.tilesWide === def.tilesWide
    && candidate.tilesHigh === def.tilesHigh
    && candidate.availableInPalette !== false) ?? null;
}

/** Target cost minus the current part's demolition refund, floored at zero per resource. */
export function partUpgradeCost(def: BuildableDefinition): ResourceAmounts | null {
  const target = upgradeTarget(def);
  if (!target) return null;
  const refund = new Map(demolitionRefund(def));
  const cost: Partial<Record<ResourceId, number>> = {};
  for (const [resource, amount] of Object.entries(target.cost) as Array<[ResourceId, number]>) {
    const owed = Math.max(0, amount - (refund.get(resource) ?? 0));
    if (owed > 0) cost[resource] = owed;
  }
  return cost;
}

export function isUpgradablePart(state: GameState, building: BuildingState): boolean {
  const target = upgradeTarget(buildableById(building.definitionId));
  return target !== null && knowsBlueprint(state, target.id);
}

function addCost(into: Partial<Record<ResourceId, number>>, cost: ResourceAmounts): void {
  for (const [resource, amount] of Object.entries(cost) as Array<[ResourceId, number]>) {
    into[resource] = (into[resource] ?? 0) + amount;
  }
}

function shortfall(state: GameState, cost: ResourceAmounts, suffix = ''): string | null {
  for (const [resource, amount] of Object.entries(cost) as Array<[ResourceId, number]>) {
    const short = amount - state.inventory[resource];
    if (short > 0) return `Need ${short} more ${BAG_ITEM_LABELS[resource]}${suffix}`;
  }
  return null;
}

/** Why this one part cannot be upgraded right now, or null. Range is checked by the callers. */
function partBlockedReason(state: GameState, building: BuildingState): string | null {
  const def = buildableById(building.definitionId);
  const target = upgradeTarget(def);
  if (!target) return def.material === 'metal' ? `${def.displayName} is already metal` : `${def.displayName} cannot be upgraded`;
  if (!knowsBlueprint(state, target.id)) return `Learn the ${target.displayName} blueprint first`;
  return null;
}

function withinBuildRange(state: GameState, building: BuildingState): boolean {
  const center = buildingCenterPx(building);
  return Math.hypot(center.x - state.player.x, center.y - state.player.y) <= BUILD_RANGE_PX;
}

export function partUpgradeBlockedReason(state: GameState, building: BuildingState): string | null {
  const blocked = partBlockedReason(state, building);
  if (blocked) return blocked;
  if (!withinBuildRange(state, building)) return 'Too far away';
  return shortfall(state, partUpgradeCost(buildableById(building.definitionId))!);
}

function applyUpgrade(state: GameState, building: BuildingState): void {
  const target = upgradeTarget(buildableById(building.definitionId))!;
  building.definitionId = target.id;
  delete building.hp;
  recordBuildingPlaced(state, target.id);
}

export function upgradeBuildingMaterial(state: GameState, buildingId: string): CommandResult {
  const building = state.buildings.find((candidate) => candidate.id === buildingId);
  if (!building) return { ok: false, message: 'Building not found' };
  const blocked = partUpgradeBlockedReason(state, building);
  if (blocked) return { ok: false, message: blocked, targetId: building.id };
  const before = buildableById(building.definitionId);
  for (const [resource, amount] of Object.entries(partUpgradeCost(before)!) as Array<[ResourceId, number]>) {
    state.inventory[resource] -= amount;
  }
  applyUpgrade(state, building);
  updateAreaProgress(state);
  return { ok: true, message: `Upgraded ${before.displayName} to ${buildableById(building.definitionId).displayName}`, targetId: building.id };
}

/** The two cells a boundary part separates. */
function cellsBeside(building: BuildingState): [string, string] {
  const edge: BoundaryEdge = effectiveBoundaryEdge(building);
  const { tileX: x, tileY: y } = building;
  const other = edge === 'north' ? [x, y - 1] : edge === 'south' ? [x, y + 1] : edge === 'west' ? [x - 1, y] : [x + 1, y];
  return [cellKey(x, y), cellKey(other[0]!, other[1]!)];
}

/**
 * Every wall and door around the room the given wall or door belongs to — the
 * enclosure on either side of it — that can climb a material. Empty when the
 * part is not a wall or door, or borders no room.
 */
export function roomUpgradeIds(state: GameState, building: BuildingState): string[] {
  const def = buildableById(building.definitionId);
  if (def.layer !== 'boundary' || (def.boundaryClass !== 'wall' && def.boundaryClass !== 'door')) return [];
  const beside = cellsBeside(building);
  const rooms = environments(state.buildings).filter((environment) => environment.enclosed
    && beside.some((cell) => environment.cells.has(cell)));
  const room = rooms.sort((a, b) => a.area - b.area)[0];
  if (!room) return [];
  return state.buildings.filter((candidate) => {
    const candidateDef = buildableById(candidate.definitionId);
    if (candidateDef.layer !== 'boundary' || (candidateDef.boundaryClass !== 'wall' && candidateDef.boundaryClass !== 'door')) return false;
    if (!upgradeTarget(candidateDef)) return false;
    return cellsBeside(candidate).some((cell) => room.cells.has(cell));
  }).map((candidate) => candidate.id);
}

/** Combined price of upgrading every listed part, or null if any of them cannot be upgraded. */
export function partUpgradeBatchCost(state: GameState, ids: readonly string[]): ResourceAmounts | null {
  const total: Partial<Record<ResourceId, number>> = {};
  for (const id of new Set(ids)) {
    const building = state.buildings.find((candidate) => candidate.id === id);
    if (!building || partBlockedReason(state, building)) return null;
    addCost(total, partUpgradeCost(buildableById(building.definitionId))!);
  }
  return total;
}

/**
 * Upgrade a group of parts — a whole room's walls and doors — all or nothing.
 * The player must be in build range of at least one part of the group, the
 * same way a room is built from where you stand rather than tile by tile.
 */
export function upgradeBuildingBatch(state: GameState, ids: readonly string[]): CommandResult {
  const unique = [...new Set(ids)];
  if (unique.length === 0 || unique.length > MAX_BATCH_PARTS) return { ok: false, message: `Choose between 1 and ${MAX_BATCH_PARTS} parts` };
  const buildings: BuildingState[] = [];
  for (const id of unique) {
    const building = state.buildings.find((candidate) => candidate.id === id);
    if (!building) return { ok: false, message: 'Building not found' };
    const blocked = partBlockedReason(state, building);
    if (blocked) return { ok: false, message: blocked, targetId: building.id };
    buildings.push(building);
  }
  if (!buildings.some((building) => withinBuildRange(state, building))) return { ok: false, message: 'Too far away' };
  const total = partUpgradeBatchCost(state, unique)!;
  const short = shortfall(state, total, ' for the whole group');
  if (short) return { ok: false, message: short };
  for (const [resource, amount] of Object.entries(total) as Array<[ResourceId, number]>) state.inventory[resource] -= amount;
  for (const building of buildings) applyUpgrade(state, building);
  updateAreaProgress(state);
  return { ok: true, message: `Upgraded ${buildings.length} part${buildings.length === 1 ? '' : 's'}` };
}
