import { buildableById } from '../content/buildingParts';
import type { BoundaryEdge, BuildingDefinitionId, BuildingState, GameState, ResourceId } from './state';
import { placeBuilding, validatePlacement, undoBuildingPlacement, type CommandResult, type PlacementCheck } from './gameplayCommands';

export interface BuildRequest { definitionId: BuildingDefinitionId; tileX: number; tileY: number; boundaryEdge?: BoundaryEdge; rotated?: boolean }
export type PlacementShape = 'single' | 'area' | 'line';
export const MAX_BATCH_PARTS = 64;

export function shapedBuildRequests(id: BuildingDefinitionId, shape: PlacementShape, start: { tileX: number; tileY: number }, end: { tileX: number; tileY: number }, edge: BoundaryEdge = 'north'): BuildRequest[] {
  const def = buildableById(id);
  if (shape === 'single') return [{ definitionId: id, ...end, ...(def.layer === 'boundary' ? { boundaryEdge: edge } : {}) }];
  if (shape === 'area' && def.layer !== 'surface') return [];
  if (shape === 'line' && (def.layer !== 'boundary' || def.tilesWide !== 1 || def.tilesHigh !== 1)) return [];
  const horizontal = edge === 'north' || edge === 'south';
  const left = Math.min(start.tileX, end.tileX); const right = Math.max(start.tileX, end.tileX);
  const top = Math.min(start.tileY, end.tileY); const bottom = Math.max(start.tileY, end.tileY);
  const count = shape === 'area' ? (right - left + 1) * (bottom - top + 1) : horizontal ? right - left + 1 : bottom - top + 1;
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_BATCH_PARTS) return [];
  const requests: BuildRequest[] = [];
  if (shape === 'area') {
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) requests.push({ definitionId: id, tileX: x, tileY: y });
  } else for (let index = 0; index < count; index++) requests.push({
    definitionId: id, tileX: horizontal ? left + index : start.tileX,
    tileY: horizontal ? start.tileY : top + index, boundaryEdge: edge,
  });
  return requests;
}

export function batchCost(requests: readonly BuildRequest[]): Partial<Record<ResourceId, number>> {
  const cost: Partial<Record<ResourceId, number>> = {};
  for (const request of requests) for (const [id, amount] of Object.entries(buildableById(request.definitionId).cost)) {
    const resource = id as ResourceId; cost[resource] = (cost[resource] ?? 0) + amount;
  }
  return cost;
}

/** Validates every piece against a private occupancy list, without granting XP or touching the world. */
export function checkBuildBatch(state: GameState, requests: readonly BuildRequest[]): PlacementCheck {
  if (!requests.length || requests.length > MAX_BATCH_PARTS) return { ok: false, message: `Choose between 1 and ${MAX_BATCH_PARTS} parts` };
  const draft = { ...state, buildings: [...state.buildings] };
  for (const [index, request] of requests.entries()) {
    const check = validatePlacement(draft, draft.buildings, buildableById(request.definitionId), request.tileX, request.tileY, request);
    if (!check.ok) return { ...check, message: `${request.tileX},${request.tileY}: ${check.message}` };
    draft.buildings.push({ id: `batch-preview-${index}`, ...request });
  }
  for (const [id, amount] of Object.entries(batchCost(requests))) {
    if (state.inventory[id as ResourceId] < amount) return { ok: false, message: `Need ${amount - state.inventory[id as ResourceId]} more ${id} for the whole group` };
  }
  return { ok: true, message: '' };
}

export interface BatchBuildResult extends CommandResult { buildings?: BuildingState[] }
export function placeBuildBatch(state: GameState, requests: readonly BuildRequest[]): BatchBuildResult {
  const check = checkBuildBatch(state, requests);
  if (!check.ok) return check;
  const before = structuredClone(state);
  const buildings: BuildingState[] = [];
  for (const request of requests) {
    const result = placeBuilding(state, state.buildings, buildableById(request.definitionId), request.tileX, request.tileY, request);
    if (!result.ok || !result.building) {
      Object.assign(state, before);
      return { ok: false, message: result.message || 'Placement changed; no materials spent' };
    }
    buildings.push(result.building);
  }
  return { ok: true, message: `Placed ${buildings.length} parts`, buildings };
}

export function undoBuildGroup(state: GameState, ids: readonly string[]): CommandResult {
  const remaining = [...new Set(ids)].filter((id) => state.buildings.some((building) => building.id === id));
  if (!remaining.length) return { ok: false, message: 'Nothing to undo' };
  // Filled storage and facilities cannot be silently discarded by group Undo.
  if (remaining.some((id) => {
    const building = state.buildings.find((candidate) => candidate.id === id)!;
    return buildableById(building.definitionId).layer === 'footprint';
  })) return { ok: false, message: 'Undo facilities individually before undoing a group' };
  for (const id of remaining.reverse()) undoBuildingPlacement(state, id);
  return { ok: true, message: `Undid ${remaining.length} parts; full material cost returned` };
}
