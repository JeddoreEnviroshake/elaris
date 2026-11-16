import {
  INTERACTION_RANGE_PX,
  TAMING_RANGE_PX,
  REQUIRED_TOOL_LABEL,
  TOOL_TIER_RANK,
  WALL_ATTACK_RANGE_PX,
  FACILITY_MAX_HP,
  WALL_MAX_HP,
  gameToolDefinition,
  isHandcraftTool,
  toolDefinition,
  WOODEN_PICK,
} from '../config/balance';
import { PLACEABLES, type PlaceableDefinition } from '../config/areaGates';
import { BUILDABLES, buildableById, type BuildableDefinition } from '../content/buildingParts';
import { MAX_ACTIVE_FOLLOWERS, creatureDefinition } from '../content/creatures';
import { companionAbility, creatureBondLevel } from '../content/companionAbilities';
import { isTownFootprintTile, townBuildingsInArea } from '../content/townBuildings';
import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import {
  cellKey,
  boundaryEdgeKey,
  boundaryRemovalMergeConflict,
  buildOccupancy,
  evaluateRequiredSurfaceGate,
  recordHighestAreaTier,
} from './environmentProgress';
import { recordHighestRating } from './scoring';
import { createCartDockState, createGardenBedState, createLogisticsHubState, createWoodlotPlanterState, createWorkerHousingState, createWorkerProducerState } from './state';
import type { BasicResourceId, GatherableResourceId, BoundaryEdge, BuildingDefinitionId, BuildingState, CreatureRole, EnvironmentKind, GameBalanceState, GameState, GroundDropState, ResourceId, ResourceNodeState, StructureFacilityId, ToolDefinitionId, ToolGroundDrop, ToolInstance, WildCreatureState } from './state';
import { resourceStacksForAmount } from './inventoryStacks';
import { payStrikeCost, strikeCostShortfall, strikeProfile, strikeReachPx } from './strike';
import { doubleDropChanceBps, gatheringPowerBonus, grantXp, inventoryCapacity } from './characterProgression';
import { boundarySegmentAnchors, boundarySpan, buildingCenterPx, effectiveBoundaryEdge, effectiveBuildingDimensions, effectiveDimensions, placementDimensions } from './buildingGeometry';
import { terrainAt, terrainAtWithBuildings, terrainCapabilities } from './landscape';
import { blueprintLockedReason, knowsBlueprint, learnBlueprint } from './blueprintKnowledge';
import { describeFind, rollNodeBlueprint } from './blueprintFinds';
import { dropBlueprintAt, nearestBlueprintDrop, recoverBlueprintDrop } from './carriedBlueprints';
import { deathCacheInReach, recoverDeathCache } from './deathCache';
import { elarisPublicWorkbenchFacility, isElarisPublicWorkbenchId } from './elarisWorkbench';
import { createRng } from './rng';
import { createFurnaceState } from './processing';
import { recordBuildingPlaced, recordBuildingRemoved, recordCraft, recordFollowerGather } from './questTracking';
import {
  addStorageResource,
  canAddStorageResource,
  clearStorageResource,
  removeStorageResourceStack,
  storageBoxContents,
  isStorageContainer,
  storageContainerSlots,
  usedStorageBoxSlots,
} from './storageBox';
import { recordRegionalGather } from './regionalProgress';
import { advanceWorkerProduction, assignCreatureHousing, availableHousing } from './workerHousing';
import { creatureWorksiteOperationGate, activeFollowerGatherAssistance } from './creatureRoles';
import { recordOpeningGatherAssistance } from './onboardingProgress';
import { isCreatureAway } from './expeditions';
import { liveSiteBlockingRect, SITE_HALF_TILES } from './sites';
import { leveledMaxHp } from './facilityLevels';

export interface CommandResult {
  ok: boolean;
  message: string;
  targetId?: string;
  depleted?: boolean;
  toolBroke?: boolean;
  /** Important reward state changed and should be saved immediately. */
  critical?: boolean;
  gatherAssistance?: {
    creatureId: string; creatureName: string; resource: GatherableResourceId; bonusUnits: number; openingCompleted: boolean;
  };
}

export type ResourceAmounts = Readonly<Partial<Record<ResourceId, number>>>;

export { BUILDABLES, buildableById };
export type { BuildableDefinition };
export interface PlacementBlockedCell {
  readonly tileX: number;
  readonly tileY: number;
  readonly reason: string;
}
export interface PlacementCheck {
  ok: boolean;
  message: string;
  /** Exact footprint cells that explain a failed placement, when applicable. */
  blockedCells?: readonly PlacementBlockedCell[];
}
export interface PlaceResult extends PlacementCheck { building?: BuildingState }
export interface PlacementOptions { boundaryEdge?: BoundaryEdge; environmentKind?: EnvironmentKind; rotated?: boolean }
// Player coordinates sit on tile boundaries, while placement is measured from
// structure centers. The extra tile keeps six full surrounding tiles in range.
export const BUILD_RANGE_PX = TILE_SIZE * 7;
export const FACILITY_INTERACTION_RANGE_PX = TILE_SIZE * 4;
export const ROWBOAT_CRAFT_COST: Readonly<Partial<Record<ResourceId, number>>> = { wood: 24, fiber: 8 };
export { knowsBlueprint, learnBlueprint };

/** Which occupancy layers may share one tile: surfaces underlie everything else. */
function footprintConflict(
  buildings: readonly BuildingState[],
  def: BuildableDefinition,
  tileX: number,
  tileY: number,
  options: PlacementOptions,
): BuildingState | null {
  if (def.layer === 'boundary') {
    const edge = effectiveBoundaryEdge({ boundaryEdge: options.boundaryEdge, rotated: options.rotated });
    const keys = new Set(boundarySegmentAnchors(tileX, tileY, edge, boundarySpan(def)).map(
      (segment) => boundaryEdgeKey(segment.tileX, segment.tileY, segment.edge),
    ));
    return buildings.find((other) => {
      const otherDef = buildableById(other.definitionId);
      if (otherDef.layer !== 'boundary') return false;
      const otherEdge = effectiveBoundaryEdge(other);
      return boundarySegmentAnchors(other.tileX, other.tileY, otherEdge, boundarySpan(otherDef)).some(
        (segment) => keys.has(boundaryEdgeKey(segment.tileX, segment.tileY, segment.edge)),
      );
    }) ?? null;
  }
  const dimensions = effectiveDimensions(def, options.rotated);
  for (const other of buildings) {
    const otherDef = buildableById(other.definitionId);
    if (otherDef.layer === 'boundary') continue;
    const otherDimensions = effectiveBuildingDimensions(other);
    if (!rectsOverlap(tileX, tileY, dimensions.tilesWide, dimensions.tilesHigh, other.tileX, other.tileY, otherDimensions.tilesWide, otherDimensions.tilesHigh)) continue;
    // Compatibility-only markers are metadata, not physical furniture. Existing
    // saves may keep one until the player removes it, so it must not consume a
    // facility cell or make an otherwise valid room unusable.
    if (def.footprintKind === 'marker' || otherDef.footprintKind === 'marker') continue;
    // A bridge is the visible, walkable layer above a water landscaping tile.
    // The pair remains independently removable so deleting the bridge reveals
    // the channel beneath it.
    if (def.footprintKind === 'landscape' && otherDef.footprintKind === 'landscape'
      && def.landscapeKind !== otherDef.landscapeKind) continue;
    // A surface may sit beneath an object footprint; footprints exclude each other.
    const pair = [def.layer, otherDef.layer];
    if (pair.includes('surface') && pair.includes('footprint')
      && def.footprintKind !== 'landscape' && otherDef.footprintKind !== 'landscape') continue;
    return other;
  }
  return null;
}

function blockedPlacement(message: string, tileX: number, tileY: number, reason = message): PlacementCheck {
  return { ok: false, message, blockedCells: [{ tileX, tileY, reason }] };
}

export function defaultBoundaryEdgeFromFacing(facing: GameState['player']['facing']): BoundaryEdge {
  switch (facing) {
    case 'down': return 'north';
    case 'up': return 'south';
    case 'right': return 'west';
    case 'left': return 'east';
  }
}

/** Presentation-compatible pure validation; persisted state is authoritative. */
export function validatePlacement(state: GameState, _placed: readonly BuildingState[], def: BuildableDefinition, tileX: number, tileY: number, options: PlacementOptions = {}): PlacementCheck {
  const resolvedOptions: PlacementOptions = def.layer === 'boundary'
    ? { ...options, boundaryEdge: options.boundaryEdge ?? defaultBoundaryEdgeFromFacing(state.player.facing) }
    : options;
  const dimensions = placementDimensions(def, resolvedOptions);
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || tileX < 0 || tileY < 0 || tileX + dimensions.tilesWide > WORLD_TILES || tileY + dimensions.tilesHigh > WORLD_TILES)
    return { ok: false, message: 'Out of bounds' };
  if (townBuildingsInArea(state.currentArea.key).length > 0) {
    for (let y = tileY; y < tileY + dimensions.tilesHigh; y += 1) {
      for (let x = tileX; x < tileX + dimensions.tilesWide; x += 1) {
        if (isTownFootprintTile(x, y, state.currentArea.key)) {
          return blockedPlacement(`Reserved for ${state.currentArea.name}`, x, y);
        }
      }
    }
  }
  // Field sites are derived ruins: building over one would delete a refilling
  // loot source the player cannot get back.
  const ruin = liveSiteBlockingRect(state, tileX, tileY, dimensions.tilesWide, dimensions.tilesHigh);
  if (ruin) {
    return blockedPlacement(
      'Ruins are in the way',
      Math.min(Math.max(tileX, ruin.anchorTileX - SITE_HALF_TILES), tileX + dimensions.tilesWide - 1),
      Math.min(Math.max(tileY, ruin.anchorTileY - SITE_HALF_TILES), tileY + dimensions.tilesHigh - 1),
    );
  }
  for (let y = tileY; y < tileY + dimensions.tilesHigh; y += 1) {
    for (let x = tileX; x < tileX + dimensions.tilesWide; x += 1) {
      const generatedTerrain = terrainAt(state.seed, state.currentArea, x, y);
      const resolvedTerrain = terrainAtWithBuildings(state.seed, state.currentArea, state.buildings, x, y);
      if (def.landscapeKind === 'bridge') {
        if (resolvedTerrain !== 'shallow-water' && resolvedTerrain !== 'deep-water' && resolvedTerrain !== 'bridge') {
          return blockedPlacement('Bridge must span water', x, y, 'Not water');
        }
      } else if (def.landscapeKind === 'water') {
        if (!terrainCapabilities(generatedTerrain).buildable) return blockedPlacement('Water requires open ground', x, y, 'Terrain is not open ground');
      } else if (!terrainCapabilities(resolvedTerrain).buildable) {
        return blockedPlacement('Requires solid ground', x, y, 'Terrain is not solid ground');
      }
    }
  }
  const conflictingBuilding = footprintConflict(state.buildings, def, tileX, tileY, resolvedOptions);
  if (conflictingBuilding) {
    const conflictingDefinition = buildableById(conflictingBuilding.definitionId);
    const message = def.layer === 'boundary'
      ? `Edge occupied by ${conflictingDefinition.displayName}`
      : `Occupied by ${conflictingDefinition.displayName}`;
    const blockedX = Math.max(tileX, conflictingBuilding.tileX);
    const blockedY = Math.max(tileY, conflictingBuilding.tileY);
    return blockedPlacement(message, blockedX, blockedY, conflictingDefinition.displayName);
  }
  // Only standing resources block a footprint. A knocked-down node is cleared
  // ground the player earned: building over it is allowed, and `placeBuilding`
  // removes it so it can never renew under the structure.
  for (const node of def.layer === 'boundary' ? [] : state.resourceNodes) {
    if (node.hp <= 0) continue;
    const x = Math.floor(node.x / TILE_SIZE); const y = Math.floor(node.y / TILE_SIZE);
    if (x >= tileX && x < tileX + dimensions.tilesWide && y >= tileY && y < tileY + dimensions.tilesHigh) {
      const nodeLabel = label(node.kind);
      return blockedPlacement(`${nodeLabel} is in the way`, x, y, nodeLabel);
    }
  }
  // Standing on a new floor tile is fine; solid parts cannot appear under you.
  if (def.layer === 'footprint') {
    const playerX = Math.floor(state.player.x / TILE_SIZE); const playerY = Math.floor(state.player.y / TILE_SIZE);
    if (playerX >= tileX && playerX < tileX + dimensions.tilesWide && playerY >= tileY && playerY < tileY + dimensions.tilesHigh) {
      return blockedPlacement("You're standing there", playerX, playerY, 'Player');
    }
  }
  const center = def.layer === 'boundary'
    ? buildingCenterPx({
      id: '', definitionId: def.id, tileX, tileY, rotated: resolvedOptions.rotated === true,
      ...(resolvedOptions.boundaryEdge ? { boundaryEdge: resolvedOptions.boundaryEdge } : {}),
    })
    : { x: (tileX + dimensions.tilesWide / 2) * TILE_SIZE, y: (tileY + dimensions.tilesHigh / 2) * TILE_SIZE };
  const centerX = center.x; const centerY = center.y;
  if (Math.hypot(centerX - state.player.x, centerY - state.player.y) > BUILD_RANGE_PX) {
    return { ok: false, message: 'Outside build range — move closer' };
  }

  const placeable = def.footprintKind === 'facility'
    ? PLACEABLES.find((candidate) => candidate.id === def.id)
    : undefined;
  if (placeable?.requiredSurface) {
    const surfaceGate = evaluateRequiredSurfaceGate(
      state.buildings, placeable.requiredSurface, tileX, tileY, dimensions.tilesWide, dimensions.tilesHigh,
    );
    if (!surfaceGate.ok) return { ok: false, message: surfaceGate.reason ?? 'Requires a different surface' };
  }

  const locked = buildableLockedReason(state, def.id);
  if (locked) return { ok: false, message: locked };

  return { ok: true, message: '' };
}

/**
 * Typed unlock ownership for the palette and placement: facilities carry an
 * UnlockRequirement (sticky area-tier discovery); structural parts unlock by
 * discovering their material. Returns the exact reason, or null when usable.
 */
export function buildableLockedReason(state: GameState, id: BuildingDefinitionId): string | null {
  return id === 'environment-marker' ? null : blueprintLockedReason(state, id);
}

/** Typed placeable unlock alias used by system tests and non-palette callers. */
export function placeableLockedReason(state: GameState, placeable: PlaceableDefinition): string | null {
  return blueprintLockedReason(state, placeable.id);
}

export function checkPlacement(state: GameState, placed: readonly BuildingState[], def: BuildableDefinition, tileX: number, tileY: number, options: PlacementOptions = {}): PlacementCheck {
  const check = validatePlacement(state, placed, def, tileX, tileY, options);
  if (!check.ok) return check;
  const missing = firstMissingResource(state, def.cost);
  return missing ? { ok: false, message: `Need ${missing.amount} more ${missing.resource}` } : check;
}

/** Atomically validates, pays for, and persists a building. */
export function placeBuilding(state: GameState, placed: BuildingState[], def: BuildableDefinition, tileX: number, tileY: number, options: PlacementOptions = {}): PlaceResult {
  const resolvedOptions: PlacementOptions = def.layer === 'boundary'
    ? { ...options, boundaryEdge: options.boundaryEdge ?? defaultBoundaryEdgeFromFacing(state.player.facing) }
    : options;
  const check = checkPlacement(state, placed, def, tileX, tileY, resolvedOptions);
  if (!check.ok) return check;
  for (const [resource, amount] of Object.entries(def.cost) as Array<[ResourceId, number]>) state.inventory[resource] -= amount;
  const building: BuildingState = {
    id: `building-${state.nextEntityId}`,
    definitionId: def.id,
    tileX,
    tileY,
    rotated: resolvedOptions.rotated === true,
    ...(def.layer === 'boundary' ? { boundaryEdge: resolvedOptions.boundaryEdge } : {}),
    ...(def.footprintKind === 'marker' ? {
      environmentKind: resolvedOptions.environmentKind ?? markerKindForPlacement(state, tileX, tileY),
    } : {}),
    ...(def.id === 'field-cache' || def.id === 'warehouse' ? {
      storage: {
        wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0,
        'taming-snare': 0, 'reinforced-snare': 0, berry: 0, arrow: 0, 'cloth-mask': 0,
        'tuftle-down': 0, 'craghopper-shell': 0, 'stag-antler': 0, 'snarlfox-pelt': 0,
        'masonmole-claw': 0, 'boar-tusk': 0, 'quillfinch-quill': 0, 'mistmoth-scale': 0,
        'slingtail-stone': 0,
        'scrap-iron': 0, 'clockwork': 0, 'lens': 0, 'arcane-dust': 0, 'construct-core': 0, 'ancient-alloy': 0, 'sealed-satchel': 0, 'vault-key': 0, 'recall-flare': 0,
      },
      storageStacks: {
        wood: [], stone: [], fiber: [], 'iron-ore': [], 'iron-ingot': [],
        'taming-snare': [], 'reinforced-snare': [], berry: [], arrow: [], 'cloth-mask': [],
        'tuftle-down': [], 'craghopper-shell': [], 'stag-antler': [], 'snarlfox-pelt': [],
        'masonmole-claw': [], 'boar-tusk': [], 'quillfinch-quill': [], 'mistmoth-scale': [],
        'slingtail-stone': [],
        'scrap-iron': [], 'clockwork': [], 'lens': [], 'arcane-dust': [], 'construct-core': [], 'ancient-alloy': [], 'sealed-satchel': [], 'vault-key': [], 'recall-flare': [],
      },
      storedTools: [],
    } : {}),
    ...(def.id === 'furnace' ? { furnace: createFurnaceState() } : {}),
    ...(def.id === 'small-pen' || def.id === 'barn' ? { housing: createWorkerHousingState() } : {}),
    ...(def.id === 'stone-yard' ? { producer: createWorkerProducerState() } : {}),
    ...(def.id === 'cart-dock' ? { cartDock: createCartDockState() } : {}),
    ...(def.id === 'logistics-hub' ? { logistics: createLogisticsHubState() } : {}),
    ...(def.id === 'garden-bed' ? { garden: createGardenBedState(state.tick) } : {}),
    ...(def.id === 'woodlot-planter' ? { woodlot: createWoodlotPlanterState(state.tick) } : {}),
  };
  state.nextEntityId += 1; state.buildings.push(building);
  clearDepletedNodesUnderFootprint(state, def, tileX, tileY, resolvedOptions);
  recordBuildingPlaced(state, def.id);
  updateAreaProgress(state);
  grantXp(state, def.footprintKind === 'facility' ? 25 : def.footprintKind === 'marker' ? 10 : 2);
  return { ok: true, message: `Placed ${def.displayName}`, building };
}

/**
 * Reverse a placement made during the current build session. This deliberately
 * bypasses demolition's half refund: Undo is mistake recovery, not harvesting.
 */
export function undoBuildingPlacement(state: GameState, buildingId: string): CommandResult {
  const index = state.buildings.findIndex((building) => building.id === buildingId);
  if (index < 0) return { ok: false, message: 'Nothing to undo' };
  const pending = state.buildings[index]!;
  if ((pending.storedBlueprints?.length ?? 0) > 0) return { ok: false, message: `Empty the ${buildableById(pending.definitionId).displayName} first`, targetId: pending.id };
  const [building] = state.buildings.splice(index, 1);
  if (!building) return { ok: false, message: 'Nothing to undo' };
  const definition = buildableById(building.definitionId);
  const center = buildingCenterPx(building);
  for (const [resource, amount] of Object.entries(definition.cost) as Array<[ResourceId, number]>) {
    if (!tryAddResource(state, resource, amount)) {
      addGroundDrop(state, resource, amount, center.x, center.y);
    }
  }
  recordBuildingRemoved(state, building.definitionId);
  updateAreaProgress(state);
  return { ok: true, message: `Undid ${definition.displayName}` };
}

/**
 * Building over knocked-down resources retires them permanently: the node is
 * dropped from the world so nothing renews beneath the structure, and the
 * ground stays clear even after the building is later demolished.
 */
function clearDepletedNodesUnderFootprint(
  state: GameState,
  def: BuildableDefinition,
  tileX: number,
  tileY: number,
  options: PlacementOptions,
): void {
  if (def.layer === 'boundary') return;
  const dimensions = effectiveDimensions(def, options.rotated);
  state.resourceNodes = state.resourceNodes.filter((node) => {
    if (node.hp > 0) return true;
    const x = Math.floor(node.x / TILE_SIZE); const y = Math.floor(node.y / TILE_SIZE);
    return !(x >= tileX && x < tileX + dimensions.tilesWide && y >= tileY && y < tileY + dimensions.tilesHigh);
  });
}

function markerKindForPlacement(state: GameState, tileX: number, tileY: number): EnvironmentKind {
  const surface = buildOccupancy(state.buildings).surfaces.get(cellKey(tileX, tileY));
  return surface && buildableById(surface.definitionId).surfaceKind === 'floor' ? 'indoor' : 'workYard';
}

/**
 * Demolition: guarded so nothing is silently lost, then refunds 50% of the
 * original building-material inputs, rounded down per material. Refunds never
 * include stored contents and never exceed original inputs.
 */
/** The 50%-of-inputs demolition refund, rounded down per material; empty entries dropped. */
export function demolitionRefund(def: BuildableDefinition): Array<[ResourceId, number]> {
  return (Object.entries(def.cost) as Array<[ResourceId, number]>)
    .map(([resource, amount]) => [resource, Math.floor(amount / 2)] as [ResourceId, number])
    .filter(([, refund]) => refund > 0);
}

export function removeBuilding(state: GameState, buildingId: string): CommandResult {
  const index = state.buildings.findIndex((building) => building.id === buildingId);
  if (index < 0) return { ok: false, message: 'Building not found' };
  const building = state.buildings[index]!; const def = buildableById(building.definitionId);
  const center = buildingCenterPx(building);
  const centerX = center.x; const centerY = center.y;
  if (Math.hypot(centerX - state.player.x, centerY - state.player.y) > BUILD_RANGE_PX) return { ok: false, message: 'Too far away' };

  const blocked = removalBlockedReason(state, building, def);
  if (blocked) return { ok: false, message: blocked, targetId: building.id };

  state.buildings.splice(index, 1);
  for (const creature of state.ownedCreatures) {
    if (creature.housingId !== building.id && creature.worksiteId !== building.id) continue;
    creature.role = 'rest';
    creature.assignment = null;
    creature.worksiteId = null;
    if (creature.housingId === building.id) creature.housingId = null;
    creature.workRemainderMs = 0;
    if (state.battleCompanionId === creature.id) state.battleCompanionId = null;
  }
  recordBuildingRemoved(state, building.definitionId);
  const refunded: string[] = [];
  for (const [resource, refund] of demolitionRefund(def)) {
    if (!tryAddResource(state, resource, refund)) addGroundDrop(state, resource, refund, centerX, centerY);
    refunded.push(`${refund} ${resource}`);
  }
  updateAreaProgress(state);
  const refundNote = refunded.length > 0 ? ` (+${refunded.join(', ')})` : '';
  return { ok: true, message: `Removed ${def.displayName}${refundNote}`, targetId: building.id };
}

/**
 * Structure health. Walls derive their pool from their material; facilities
 * carry an explicit pool. Doors, fences, gates, and player surfaces have no
 * pool and return null, so they are never targeted or damaged. An absent `hp`
 * means undamaged, so full health is derived rather than written at placement
 * time and an untouched structure costs nothing to persist.
 *
 * The optional balance argument is how the Admin panel retunes these pools;
 * callers without a GameState in hand fall back to the shipped defaults.
 */
export function structureMaxHp(building: BuildingState, balance?: GameBalanceState): number | null {
  const def = buildableById(building.definitionId);
  if (def.footprintKind === 'facility' || def.footprintKind === 'marker') {
    const editable = balance?.structures.facilityHp[building.definitionId as StructureFacilityId];
    const base = editable ?? FACILITY_MAX_HP[building.definitionId] ?? null;
    // Each facility level adds half the base pool again.
    return base === null ? null : leveledMaxHp(base, building);
  }
  if (def.boundaryClass !== 'wall' || !def.material) return null;
  return balance?.structures.wallHp[def.material] ?? WALL_MAX_HP[def.material];
}

export function structureHp(building: BuildingState, balance?: GameBalanceState): number | null {
  const max = structureMaxHp(building, balance);
  return max === null ? null : Math.min(building.hp ?? max, max);
}

/** True once a structure has taken damage, which is also what puts a bar above it. */
export function isStructureDamaged(building: BuildingState, balance?: GameBalanceState): boolean {
  const max = structureMaxHp(building, balance);
  return max !== null && structureHp(building, balance)! < max;
}

/**
 * Walls only. Retained because striking, targeting, and repair reach are still
 * wall-specific player affordances: a player swings at walls, not at their own
 * Furnace. Raiders use structureMaxHp and can damage either.
 */
export function wallMaxHp(building: BuildingState, balance?: GameBalanceState): number | null {
  const def = buildableById(building.definitionId);
  if (def.boundaryClass !== 'wall' || !def.material) return null;
  return balance?.structures.wallHp[def.material] ?? WALL_MAX_HP[def.material];
}

export function wallHp(building: BuildingState, balance?: GameBalanceState): number | null {
  const max = wallMaxHp(building, balance);
  return max === null ? null : Math.min(building.hp ?? max, max);
}

export function isWallDamaged(building: BuildingState, balance?: GameBalanceState): boolean {
  const max = wallMaxHp(building, balance);
  return max !== null && wallHp(building, balance)! < max;
}

export interface StructureDamageResult {
  ok: boolean;
  /** Health left after the hit; 0 means the structure was removed. */
  remaining: number;
  destroyed: boolean;
}

/**
 * The single chokepoint for damaging anything the player built. Both the
 * player's own swing and a raider's hit route through here, so the two can
 * never drift apart on what "destroyed" means.
 *
 * Destruction removes the building outright rather than leaving a disabled
 * husk. That is what makes losing an Air Purifier immediately end shelter,
 * a lost wall immediately re-open a room, and a lost Workbench immediately
 * lock its recipes — every one of those systems already reacts to a building
 * simply not being in `state.buildings`, with no extra "disabled" concept.
 * Nothing is refunded; salvage is what demolition is for.
 */
export function damageStructure(state: GameState, buildingId: string, amount: number): StructureDamageResult {
  const index = state.buildings.findIndex((building) => building.id === buildingId);
  const building = index < 0 ? null : state.buildings[index]!;
  if (!building || structureMaxHp(building, state.gameBalance) === null) return { ok: false, remaining: 0, destroyed: false };

  const remaining = Math.max(0, structureHp(building, state.gameBalance)! - Math.max(0, Math.floor(amount)));
  building.hp = remaining;
  if (remaining > 0) return { ok: true, remaining, destroyed: false };

  spillStoredContents(state, building);
  state.buildings.splice(index, 1);
  for (const creature of state.ownedCreatures) {
    if (creature.housingId !== building.id && creature.worksiteId !== building.id) continue;
    creature.role = 'rest';
    creature.assignment = null;
    creature.worksiteId = null;
    if (creature.housingId === building.id) creature.housingId = null;
    creature.workRemainderMs = 0;
    if (state.battleCompanionId === creature.id) state.battleCompanionId = null;
  }
  recordBuildingRemoved(state, building.definitionId);
  updateAreaProgress(state);
  return { ok: true, remaining: 0, destroyed: true };
}

/**
 * A destroyed container drops what it held rather than deleting it. Losing the
 * box is already the punishment; silently erasing a season of stored iron on
 * top of that is not a loss the player can see coming.
 */
function spillStoredContents(state: GameState, building: BuildingState): void {
  const dimensions = effectiveBuildingDimensions(building);
  const centerX = (building.tileX + dimensions.tilesWide / 2) * TILE_SIZE;
  const centerY = (building.tileY + dimensions.tilesHigh / 2) * TILE_SIZE;
  for (const [resource, amount] of Object.entries(building.storage ?? {}) as Array<[ResourceId, number]>) {
    if (amount > 0) addGroundDrop(state, resource, amount, centerX, centerY);
  }
  for (const tool of building.storedTools ?? []) state.tools.push(tool);
  for (const paper of building.storedBlueprints ?? []) dropBlueprintAt(state, paper, centerX, centerY);
  // A Turret's loaded arrows return to the world as well.
  if (building.turret && building.turret.ammo > 0) addGroundDrop(state, 'arrow', building.turret.ammo, centerX, centerY);
  if (building.producer && building.producer.bin.stone > 0) {
    addGroundDrop(state, 'stone', building.producer.bin.stone, centerX, centerY);
  }
}

/**
 * Repairing restores a structure to full for half the price of building a new
 * one, with no partial-damage scaling. Reach matches demolition, so the same
 * structures a player can tear down are the ones they can patch up.
 *
 * Repair is strictly pre-emptive: once something reaches 0 it is gone from the
 * world, and getting it back means building it again.
 */
export function repairStructure(state: GameState, buildingId: string): CommandResult {
  const target = state.buildings.find((building) => building.id === buildingId);
  if (!target || structureMaxHp(target, state.gameBalance) === null) return { ok: false, message: 'Structure not found' };
  const def = buildableById(target.definitionId);
  if (!isStructureDamaged(target, state.gameBalance)) return { ok: false, message: `${def.displayName} is not damaged`, targetId: target.id };

  const center = buildingCenterPx(target);
  if (Math.hypot(center.x - state.player.x, center.y - state.player.y) > BUILD_RANGE_PX) {
    return { ok: false, message: 'Too far away', targetId: target.id };
  }
  const cost = repairCost(def.cost);
  const missing = firstMissingResource(state, cost);
  if (missing) return { ok: false, message: `Need ${missing.amount} more ${missing.resource}`, targetId: target.id };

  for (const [resource, amount] of Object.entries(cost) as Array<[ResourceId, number]>) {
    state.inventory[resource] -= amount;
  }
  // Back to the undamaged representation, so a repaired structure persists
  // exactly like a freshly placed one and drops its health bar.
  delete target.hp;
  return { ok: true, message: `Repaired ${def.displayName}`, targetId: target.id };
}

/** Wall-specific alias retained for the existing wall repair affordance. */
export function repairWall(state: GameState, wallId: string): CommandResult {
  const wall = state.buildings.find((building) => building.id === wallId);
  if (!wall || wallMaxHp(wall) === null) return { ok: false, message: 'Wall not found' };
  return repairStructure(state, wallId);
}

/** Unit vector the player is facing; walls are only struck in front of them. */
function facingVector(facing: GameState['player']['facing']): { x: number; y: number } {
  switch (facing) {
    case 'up': return { x: 0, y: -1 };
    case 'down': return { x: 0, y: 1 };
    case 'left': return { x: -1, y: 0 };
    case 'right': return { x: 1, y: 0 };
  }
}

/**
 * Nearest breakable wall the player is facing, within melee reach. Facing is
 * required so this never becomes an ambient proximity target: walls are struck
 * deliberately, and nothing highlights one just because the player walked past.
 */
export function nearestFacedWall(
  state: GameState,
  range = WALL_ATTACK_RANGE_PX,
  candidates: Iterable<BuildingState> = state.buildings,
): BuildingState | null {
  const facing = facingVector(state.player.facing);
  let nearest: BuildingState | null = null;
  let nearestDistance = range;
  for (const building of candidates) {
    if (wallMaxHp(building) === null) continue;
    const center = buildingCenterPx(building);
    const dx = center.x - state.player.x;
    const dy = center.y - state.player.y;
    if (dx * facing.x + dy * facing.y <= 0) continue;
    const distance = Math.hypot(dx, dy);
    if (distance <= nearestDistance) {
      nearest = building;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Strike the wall in front of the player with the equipped tool. Unlike
 * gathering there is no per-target eligibility: any tool (or bare hands) does
 * its headline damage. A wall broken this way is destroyed, not demolished, so
 * it yields no salvage refund.
 */
export function attackFacedWall(state: GameState, wallId?: string): CommandResult {
  if (state.tick < state.actionCooldownUntilTick) return { ok: false, message: 'Not ready yet' };

  const wall = wallId
    ? state.buildings.find((building) => building.id === wallId && wallMaxHp(building) !== null) ?? null
    : nearestFacedWall(state);
  if (!wall) return { ok: false, message: 'No wall in reach' };
  // The loadout's cast value, not a flat stamina figure: a staff pays MP to
  // break a wall exactly as it pays MP to swing at anything else.
  const wallCostShortfall = strikeCostShortfall(state);
  if (wallCostShortfall) return { ok: false, message: wallCostShortfall, targetId: wall.id };

  const tool = equippedTool(state);
  const definition = tool ? gameToolDefinition(state, tool.definitionId) : null;
  if (tool && tool.durability <= 0) {
    return { ok: false, message: `Your ${definition!.displayName} is broken`, targetId: wall.id };
  }

  // 'structure' is an ordinary strike target now, so a wall reads the same
  // per-target table a tree does instead of the tool's headline damage number.
  const profile = strikeProfile(state, 'structure');
  const maxHp = wallMaxHp(wall)!;
  const { remaining, destroyed } = damageStructure(state, wall.id, profile.damage);
  const toolBroke = payStrikeCost(state, profile);

  const def = buildableById(wall.definitionId);
  if (!destroyed) {
    return {
      ok: true,
      message: `${def.displayName} ${remaining}/${maxHp}`,
      targetId: wall.id,
      toolBroke,
    };
  }

  return {
    ok: true,
    message: `${def.displayName} destroyed${toolBroke ? ' · Tool broke' : ''}`,
    targetId: wall.id,
    depleted: true,
    toolBroke,
  };
}

function removalBlockedReason(state: GameState, building: BuildingState, def: BuildableDefinition): string | null {
  if (def.layer === 'boundary' && boundaryRemovalMergeConflict(state.buildings, building)) {
    return 'This would merge two marked environments';
  }
  if (def.layer === 'surface') {
    const key = cellKey(building.tileX, building.tileY);
    for (const other of state.buildings) {
      const otherDef = buildableById(other.definitionId);
      if (otherDef.footprintKind === 'facility' && footprintCovers(other, otherDef, key)) {
        return `Demolish the ${otherDef.displayName} first`;
      }
    }
    return null;
  }
  // Environment markers are now compatibility-only metadata and can always be
  // removed without suspending or deleting facilities in the inferred region.
  if (def.footprintKind === 'marker') return null;
  if (isStorageContainer(building) && building.storage) {
    const stored = Object.values(building.storage).reduce((sum, amount) => sum + amount, 0);
    if (stored > 0 || (building.storedTools?.length ?? 0) > 0 || (building.storedBlueprints?.length ?? 0) > 0) return `Empty the ${def.displayName} first`;
  }
  if (building.definitionId === 'furnace' && (building.furnace?.queue.length ?? 0) > 0) {
    return 'Empty the Furnace queue first';
  }
  if ((building.definitionId === 'small-pen' || building.definitionId === 'barn')
    && ((building.housing?.bin.fiber ?? 0) > 0 || (building.housing?.bin.berry ?? 0) > 0)) {
    return `Empty the ${def.displayName} collection bin first`;
  }
  if (building.definitionId === 'stone-yard' && (building.producer?.bin.stone ?? 0) > 0) {
    return 'Empty the Stone Yard collection bin first';
  }
  return null;
}

function footprintCovers(building: BuildingState, def: BuildableDefinition, key: string): boolean {
  const dimensions = effectiveDimensions(def, building.rotated);
  for (let dy = 0; dy < dimensions.tilesHigh; dy += 1) for (let dx = 0; dx < dimensions.tilesWide; dx += 1) {
    if (cellKey(building.tileX + dx, building.tileY + dy) === key) return true;
  }
  return false;
}

/** Exported for in-place part upgrades, which update progress the way placement does. */
export function updateAreaProgress(state: GameState): void {
  recordHighestAreaTier(state);
  recordHighestRating(state);
}

function rectsOverlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

export function nearestLiveNode(
  state: GameState,
  range = INTERACTION_RANGE_PX,
  candidates: Iterable<ResourceNodeState> = state.resourceNodes,
): ResourceNodeState | null {
  let nearest: ResourceNodeState | null = null;
  let nearestDistance = range;
  for (const node of candidates) {
    if (node.hp <= 0) continue;
    const distance = Math.hypot(node.x - state.player.x, node.y - state.player.y);
    if (distance <= nearestDistance) {
      nearest = node;
      nearestDistance = distance;
    }
  }
  return nearest;
}

export function nearestWildCreature(
  state: GameState,
  range = TAMING_RANGE_PX,
  candidates: Iterable<WildCreatureState> = state.wildCreatures,
): WildCreatureState | null {
  let nearest: WildCreatureState | null = null;
  let nearestDistance = range;
  for (const creature of candidates) {
    const distance = Math.hypot(creature.x - state.player.x, creature.y - state.player.y);
    if (distance <= nearestDistance) {
      nearest = creature;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/**
 * Every facility the player can use from where they stand: their own buildings
 * plus the town's public workbench, which is town content rather than a row in
 * `state.buildings` and so has to be added back in here.
 */
export function usableFacilityCandidates(state: GameState): BuildingState[] {
  const townBench = elarisPublicWorkbenchFacility(state);
  return townBench ? [...state.buildings, townBench] : state.buildings;
}

function nearestUsableFacilityMatching(
  state: GameState,
  range: number,
  definitionId?: BuildingDefinitionId,
  candidates: Iterable<BuildingState> = usableFacilityCandidates(state),
): BuildingState | null {
  let nearest: BuildingState | null = null;
  let nearestDistance = range;
  for (const building of candidates) {
    const definition = buildableById(building.definitionId);
    if (definition.footprintKind !== 'facility' || (definitionId && building.definitionId !== definitionId)) continue;
    const placeable = PLACEABLES.find((candidate) => candidate.id === building.definitionId);
    const dimensions = effectiveBuildingDimensions(building);
    // The town keeps its own bench in repair. Nobody has to floor the square
    // for it, so the player-built surface gate does not apply.
    if (!isElarisPublicWorkbenchId(building.id) && placeable?.requiredSurface && !evaluateRequiredSurfaceGate(
      state.buildings, placeable.requiredSurface, building.tileX, building.tileY,
      dimensions.tilesWide, dimensions.tilesHigh,
    ).ok) continue;
    const centerX = (building.tileX + dimensions.tilesWide / 2) * TILE_SIZE;
    const centerY = (building.tileY + dimensions.tilesHigh / 2) * TILE_SIZE;
    const distance = Math.hypot(centerX - state.player.x, centerY - state.player.y);
    if (distance <= nearestDistance) {
      nearest = building;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Nearest facility whose declared player-built surface covers its full footprint. */
export function nearestUsableFacility(
  state: GameState,
  range = FACILITY_INTERACTION_RANGE_PX,
  candidates: Iterable<BuildingState> = usableFacilityCandidates(state),
): BuildingState | null {
  return nearestUsableFacilityMatching(state, range, undefined, candidates);
}

function buildingCenter(building: BuildingState): { x: number; y: number } {
  const dimensions = effectiveBuildingDimensions(building);
  return { x: (building.tileX + dimensions.tilesWide / 2) * TILE_SIZE, y: (building.tileY + dimensions.tilesHigh / 2) * TILE_SIZE };
}

export function eligibleCreatureWorksites(state: GameState, creatureId: string): BuildingState[] {
  const creature = state.ownedCreatures.find((candidate) => candidate.id === creatureId);
  if (!creature) return [];
  const definition = creatureDefinition(creature.speciesId);
  if (!definition.work) return [];
  const work = definition.work;
  return state.buildings
    .filter((building) => work.eligibleWorksites.includes(building.definitionId))
    .filter((building) => creatureWorksiteOperationGate(state, building))
    .sort((left, right) => {
      const a = buildingCenter(left); const b = buildingCenter(right);
      return Math.hypot(a.x - state.player.x, a.y - state.player.y) - Math.hypot(b.x - state.player.x, b.y - state.player.y) || left.id.localeCompare(right.id);
    });
}

/** Atomic role transition. Work chooses the nearest eligible stable worksite. */
export function setCreatureRole(state: GameState, creatureId: string, role: CreatureRole): CommandResult {
  const creature = state.ownedCreatures.find((candidate) => candidate.id === creatureId);
  if (!creature) return { ok: false, message: 'Creature not found' };
  // A creature on an expedition is not in the settlement to be reassigned.
  if (isCreatureAway(state, creatureId)) return { ok: false, message: `${creature.name} is away on an expedition` };
  const definition = creatureDefinition(creature.speciesId);
  if (role === 'follow' && creature.role !== 'follow') {
    const activeFollowers = state.ownedCreatures.filter((candidate) => candidate.role === 'follow').length;
    if (activeFollowers >= MAX_ACTIVE_FOLLOWERS) {
      return { ok: false, message: `Choose a follower to rest first (${MAX_ACTIVE_FOLLOWERS}/${MAX_ACTIVE_FOLLOWERS} active)` };
    }
  }
  if (role === 'work') {
    if (!definition.work) return { ok: false, message: `${creature.name}'s work role is not unlocked yet` };
    if (!creature.housingId) {
      const housing = availableHousing(state);
      if (!housing) return { ok: false, message: 'Build an operational Small Pen or Barn with a free housing slot' };
      const assigned = assignCreatureHousing(state, creature.id, housing.id);
      if (!assigned.ok) return assigned;
    }
    const eligible = eligibleCreatureWorksites(state, creatureId);
    const worksite = creature.speciesId === 'tuftle'
      ? eligible.find((building) => building.id === creature.housingId) ?? null
      : eligible.find((building) => building.id === creature.worksiteId) ?? eligible[0] ?? null;
    if (!worksite) {
      const names = definition.work.eligibleWorksites.map((id) => buildableById(id).displayName).join(' or ');
      return { ok: false, message: `Build an operational ${names}` };
    }
    creature.role = 'work';
    creature.assignment = definition.work.resource;
    creature.worksiteId = worksite.id;
    creature.nextWorkTick = state.tick + definition.work.intervalTicks;
    creature.workRemainderMs = 0;
    if (state.battleCompanionId === creature.id) state.battleCompanionId = null;
    state.questProgress.rolesAssigned.work += 1;
    return { ok: true, message: `${creature.name} assigned to ${buildableById(worksite.definitionId).displayName}` };
  }
  creature.role = role;
  creature.assignment = null;
  creature.worksiteId = null;
  if (role !== 'follow' && state.battleCompanionId === creature.id) state.battleCompanionId = null;
  state.questProgress.rolesAssigned[role] += 1;
  return {
    ok: true,
    message: role === 'follow'
      ? definition.followMode === 'mount'
        ? `${creature.name} mounted · ${definition.travelSpeedMultiplier}× travel speed`
        : `${creature.name} is following`
      : `${creature.name} is resting`,
  };
}

/** Select one eligible follower to support future encounters, or clear it. */
export function setBattleCompanion(state: GameState, creatureId: string | null): CommandResult {
  if (state.activeEncounter) return { ok: false, message: 'Choose a battle companion outside an encounter' };
  if (creatureId === null) {
    state.battleCompanionId = null;
    return { ok: true, message: 'Battle companion cleared' };
  }
  const creature = state.ownedCreatures.find((candidate) => candidate.id === creatureId);
  if (!creature) return { ok: false, message: 'Creature not found' };
  if (isCreatureAway(state, creatureId)) return { ok: false, message: `${creature.name} is away on an expedition` };
  if (creature.role !== 'follow') return { ok: false, message: 'Assign this creature to Follow before selecting it for battle' };
  state.battleCompanionId = creature.id;
  return { ok: true, message: `${creature.name} is your Battle Companion` };
}

/** Free deterministic tactic selection. It never advances a turn or consumes RNG. */
export function selectCompanionAbility(state: GameState, abilityId: import('./state').CompanionAbilityId, creatureId?: string): CommandResult {
  const companionId = state.activeEncounter?.companionCreatureId ?? creatureId ?? state.battleCompanionId;
  const creature = state.ownedCreatures.find((candidate) => candidate.id === companionId);
  if (!creature) return { ok: false, message: 'No Battle Companion is available' };
  const ability = companionAbility(creature.speciesId, abilityId);
  if (!ability) return { ok: false, message: 'This creature cannot use that ability' };
  if (creatureBondLevel(creature) < ability.unlockBondLevel) return { ok: false, message: `Requires Bond ${ability.unlockBondLevel}` };
  creature.selectedBattleAbilityId = ability.id;
  if (state.activeEncounter) state.activeEncounter.selectedCompanionAbilityId = ability.id;
  return { ok: true, message: `${ability.displayName} selected` };
}

/** The first Storage Box (small) is the shared destination for all early automation. */
export function fieldCache(state: GameState): BuildingState | null {
  return state.buildings.find((building) => building.definitionId === 'field-cache') ?? null;
}

/** Explicitly assign or rest a tamed Tuftle. A cache prevents invisible loss. */
export function assignTuftle(state: GameState, creatureId: string, assignment: GatherableResourceId | null): CommandResult {
  const creature = state.ownedCreatures.find((candidate) => candidate.id === creatureId);
  if (!creature) return { ok: false, message: 'Tuftle not found' };
  return setCreatureRole(state, creatureId, assignment === null ? 'rest' : 'work');
}

/**
 * Deterministic background work, called once per fixed simulation tick. A
 * completed node yields directly to cache storage; full caches simply pause
 * that worker until room is made, with no resource loss.
 */
export function advanceTuftleWork(state: GameState): boolean {
  return advanceWorkerProduction(state);
}

/** Move cache goods into the player's inventory without destroying overflow. */
export function withdrawFromFieldCache(state: GameState, resource: BasicResourceId, cacheId?: string): CommandResult {
  const cache = cacheId
    ? state.buildings.find((building) => building.id === cacheId && building.definitionId === 'field-cache') ?? null
    : fieldCache(state);
  const available = cache ? storageBoxContents(cache).inventory[resource] : 0;
  if (!cache || available <= 0) return { ok: false, message: `No ${resource} in Storage Box (small)` };
  if (!tryAddResource(state, resource, available)) return { ok: false, message: 'Inventory full' };
  clearStorageResource(cache, resource);
  return { ok: true, message: `Collected ${available} ${resource} from Storage Box (small)` };
}

function cacheById(state: GameState, cacheId: string): BuildingState | null {
  return state.buildings.find((building) => building.id === cacheId && isStorageContainer(building)) ?? null;
}

/** Move one selected Bag stack into a specific six-space Storage Box. */
export function depositResourceStackInFieldCache(
  state: GameState,
  resource: ResourceId,
  stackIndex: number,
  cacheId: string,
): CommandResult {
  const cache = cacheById(state, cacheId);
  if (!cache) return { ok: false, message: 'Storage Box (small) not found' };
  const stacks = resourceStacksForAmount(state, resource, state.inventory[resource]);
  const amount = stacks[stackIndex];
  if (amount === undefined) return { ok: false, message: `${resource} stack not found` };
  if (!canAddStorageResource(cache, resource, amount)) return { ok: false, message: 'Storage Box (small) is full' };
  addStorageResource(cache, resource, amount);
  stacks.splice(stackIndex, 1);
  state.inventory[resource] -= amount;
  state.inventoryStacks[resource] = stacks;
  state.questProgress.storageDeposits += amount;
  return { ok: true, message: `Stored ${amount} ${resource}` };
}

/** Move one selected storage stack into the Bag without losing it on overflow. */
export function withdrawResourceStackFromFieldCache(
  state: GameState,
  resource: ResourceId,
  stackIndex: number,
  cacheId: string,
): CommandResult {
  const cache = cacheById(state, cacheId);
  if (!cache) return { ok: false, message: 'Storage Box (small) not found' };
  const amount = storageBoxContents(cache).stacks[resource][stackIndex];
  if (amount === undefined) return { ok: false, message: `${resource} stack not found` };
  if (!tryAddResource(state, resource, amount)) return { ok: false, message: 'Bag is full' };
  removeStorageResourceStack(cache, resource, stackIndex);
  return { ok: true, message: `Moved ${amount} ${resource} to Bag` };
}

/** Non-stackable tools consume one space in either inventory. */
export function depositToolInFieldCache(state: GameState, toolId: string, cacheId: string): CommandResult {
  const cache = cacheById(state, cacheId);
  if (!cache) return { ok: false, message: 'Storage Box (small) not found' };
  const index = state.tools.findIndex((tool) => tool.instanceId === toolId);
  if (index < 0) return { ok: false, message: 'Tool not found' };
  if (usedStorageBoxSlots(cache) >= storageContainerSlots(cache)) return { ok: false, message: `${buildableById(cache.definitionId).displayName} is full` };
  const [tool] = state.tools.splice(index, 1);
  storageBoxContents(cache).tools.push(tool!);
  state.questProgress.storageDeposits += 1;
  if (state.equippedToolId === toolId) state.equippedToolId = null;
  return { ok: true, message: `Stored ${toolDefinition(tool!.definitionId).displayName}` };
}

export function withdrawToolFromFieldCache(state: GameState, toolId: string, cacheId: string): CommandResult {
  const cache = cacheById(state, cacheId);
  if (!cache) return { ok: false, message: 'Storage Box (small) not found' };
  const contents = storageBoxContents(cache);
  const index = contents.tools.findIndex((tool) => tool.instanceId === toolId);
  if (index < 0) return { ok: false, message: 'Tool not found' };
  if (usedInventorySlots(state) >= inventoryCapacity(state)) return { ok: false, message: 'Bag is full' };
  const [tool] = contents.tools.splice(index, 1);
  state.tools.push(tool!);
  return { ok: true, message: `Moved ${toolDefinition(tool!.definitionId).displayName} to Bag` };
}

/** Resolve one context-gather command after atomically revalidating state. */
export function gatherNearest(state: GameState): CommandResult {
  return gatherNode(state, nearestLiveNode(state, strikeReachPx(state)));
}

/** An explicit aim or lock must never silently strike another resource. */
export function gatherResource(state: GameState, nodeId: string): CommandResult {
  return gatherNode(state, state.resourceNodes.find(node => node.id === nodeId) ?? null);
}

function gatherNode(state: GameState, node: ResourceNodeState | null): CommandResult {
  if (state.tick < state.actionCooldownUntilTick) {
    return { ok: false, message: 'Not ready yet' };
  }

  // Reach is the equipped tool's Range, so a long-reach tool gathers from as
  // far as it fights rather than from an unrelated fixed distance.
  if (!node || node.hp <= 0 || Math.hypot(node.x - state.player.x, node.y - state.player.y) > strikeReachPx(state)) {
    return { ok: false, message: 'Move closer to a resource' };
  }
  const costShortfall = strikeCostShortfall(state);
  if (costShortfall) return { ok: false, message: costShortfall, targetId: node.id };

  const tool = equippedTool(state);
  const definition = tool ? gameToolDefinition(state, tool.definitionId) : null;
  const balance = state.gameBalance.objects[node.kind];
  if (tool && tool.durability <= 0) {
    return { ok: false, message: `Your ${definition!.displayName} is broken`, targetId: node.id };
  }

  // Per-target eligibility: a missing damage entry means zero, not one. An
  // ineligible action deals no damage, consumes no durability, and names the
  // exact requirement. Off-primary entries are weak and wear about 2× faster.
  const baseDamage = definition
    ? definition.baseDamageByTarget[node.kind] ?? 0
    : state.gameBalance.hands.damageByTarget[node.kind];
  if (baseDamage <= 0) {
    return { ok: false, message: `${label(node.kind)} needs ${REQUIRED_TOOL_LABEL[node.kind]}`, targetId: node.id };
  }
  const toolTier = definition ? TOOL_TIER_RANK[definition.tier] : 0;
  const minimumToolTier = balance.minimumToolTier;
  if (toolTier < minimumToolTier) {
    return { ok: false, message: `${label(node.kind)} needs ${REQUIRED_TOOL_LABEL[node.kind]} of tier ${minimumToolTier} or better`, targetId: node.id };
  }

  // Damage, wear, and cooldown all come from the shared strike path, so a swing
  // at a tree and a swing at a wall can never drift apart again. The gathering
  // power bonus is passed in rather than baked in: it is progression for
  // harvesting and has no business scaling combat.
  const profile = strikeProfile(state, node.kind, {
    hardness: balance.hardness,
    bonusDamage: gatheringPowerBonus(state),
  });
  node.hp = Math.max(0, node.hp - profile.damage);
  const toolBroke = payStrikeCost(state, profile);

  if (node.hp > 0) {
    return {
      ok: true,
      message: `${label(node.kind)} ${node.hp}/${node.maxHp}`,
      targetId: node.id,
      toolBroke,
    };
  }

  const drop = state.gameBalance.objects[node.kind];
  node.respawnAtTick = state.tick + drop.respawnTicks;
  const baseYield = rollBaseYield(state, drop.yieldMin, drop.yieldMax);
  const doubled = rollChanceBps(state, doubleDropChanceBps(state));
  const assistance = activeFollowerGatherAssistance(state, node, drop.resource);
  const baseUnits = baseYield * (doubled ? 2 : 1);
  const awardedYield = applyDeterministicYield(state, drop.resource, baseUnits, assistance?.amountBps ?? 0);
  const bonusUnits = awardedYield - baseUnits;
  state.resourcesCollected[drop.resource] += awardedYield;
  recordFollowerGather(state, drop.resource, awardedYield);
  const regional = recordRegionalGather(state, drop.resource, awardedYield);
  const berries = drop.berryYield * (doubled ? 2 : 1);
  if (berries > 0 && !tryAddResource(state, 'berry', berries)) addGroundDrop(state, 'berry', berries, node.x, node.y);
  grantXp(state, 10);
  const dropped = !tryAddResource(state, drop.resource, awardedYield);
  if (dropped) addGroundDrop(state, drop.resource, awardedYield, node.x, node.y);
  // Counted here rather than per swing: the counter is in felled trees, not in
  // axe strokes, so a tougher node is never a slower blueprint. After the yield
  // is banked, so a find can never cost the resource the player came for.
  const find = rollNodeBlueprint(state, node);
  const openingCompleted = assistance && bonusUnits > 0
    ? recordOpeningGatherAssistance(state, assistance.creatureId, bonusUnits) : false;
  const gatherAssistance = assistance && bonusUnits > 0
    ? { ...assistance, resource: drop.resource, bonusUnits, openingCompleted } : undefined;
  return {
    ok: true,
    message: (dropped
      ? `${awardedYield} ${drop.resource} dropped (inventory full)${doubled ? ' · Lucky 2x drop' : ''}${toolBroke ? ' · Tool broke' : ''}`
      : `+${awardedYield} ${drop.resource}${doubled ? ' · Lucky 2x drop' : ''}${toolBroke ? ' · Tool broke' : ''}`)
      + (regional ? ` · ${regional.message}` : '')
      + (find ? ` · ${describeFind(find)}` : '')
      + (gatherAssistance ? ` · ${gatherAssistance.creatureName} helped: +${bonusUnits} ${drop.resource}` : ''),
    targetId: node.id,
    depleted: true,
    toolBroke,
    critical: regional?.completed === true || openingCompleted,
    ...(gatherAssistance ? { gatherAssistance } : {}),
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

/** Workbench recipe for the unique portable rowboat. */
export function craftRowboat(state: GameState): CommandResult {
  if (state.rowboatOwned) return { ok: false, message: 'You already own a rowboat' };
  const locked = blueprintLockedReason(state, 'rowboat');
  if (locked) return { ok: false, message: locked };
  if (!nearestUsableFacilityMatching(state, FACILITY_INTERACTION_RANGE_PX, 'workbench')) {
    return { ok: false, message: 'Craft at a workbench' };
  }
  const missing = firstMissingResource(state, ROWBOAT_CRAFT_COST);
  if (missing) return { ok: false, message: `Need ${missing.amount} more ${missing.resource}` };
  for (const [resource, amount] of Object.entries(ROWBOAT_CRAFT_COST) as Array<[ResourceId, number]>) {
    state.inventory[resource] -= amount;
  }
  state.rowboatOwned = true;
  grantXp(state, 30);
  return { ok: true, message: 'Crafted Rowboat · face the water and use E / Space to launch' };
}

/**
 * Whether a bow is in hand. The bow stopped being a durable flag and became an
 * ordinary tool: it takes a bag slot, wears out, and — the point of the change —
 * has to be equipped to be used, so carrying a bow means not carrying an axe.
 */
export function equippedBow(state: GameState): ToolInstance | null {
  const tool = equippedTool(state);
  if (!tool) return null;
  return gameToolDefinition(state, tool.definitionId).kind === 'bow' ? tool : null;
}

/** A usable Magic Staff currently in hand, or null while casting innately. */
export function equippedMagicStaff(state: GameState): ToolInstance | null {
  const tool = equippedTool(state);
  if (!tool || tool.durability <= 0) return null;
  return tool.definitionId === 'magic-staff' ? tool : null;
}

/** Context hint for launching at water or stepping ashore from water. */
export function rowboatActionLabel(state: GameState): string | null {
  if (!state.rowboatOwned) return null;
  const tileX = Math.floor(state.player.x / TILE_SIZE);
  const tileY = Math.floor(state.player.y / TILE_SIZE);
  const targetX = tileX + (state.player.facing === 'left' ? -1 : state.player.facing === 'right' ? 1 : 0);
  const targetY = tileY + (state.player.facing === 'up' ? -1 : state.player.facing === 'down' ? 1 : 0);
  if (targetX < 0 || targetY < 0 || targetX >= WORLD_TILES || targetY >= WORLD_TILES) return null;
  const target = terrainAtWithBuildings(state.seed, state.currentArea, state.buildings, targetX, targetY);
  if (state.player.traversalMode === 'foot' && terrainCapabilities(target).boatable) return 'Launch Rowboat · E / Space';
  if (state.player.traversalMode === 'boat' && terrainCapabilities(target).walkable) return 'Step ashore · E / Space';
  return null;
}

/** Move one tile across a shoreline and switch traversal modes atomically. */
export function toggleRowboat(state: GameState): CommandResult {
  const label = rowboatActionLabel(state);
  if (!label) return { ok: false, message: state.rowboatOwned ? 'Face a shoreline' : 'Craft a rowboat at a workbench' };
  const dx = state.player.facing === 'left' ? -1 : state.player.facing === 'right' ? 1 : 0;
  const dy = state.player.facing === 'up' ? -1 : state.player.facing === 'down' ? 1 : 0;
  const targetX = Math.floor(state.player.x / TILE_SIZE) + dx;
  const targetY = Math.floor(state.player.y / TILE_SIZE) + dy;
  state.player.x = (targetX + 0.5) * TILE_SIZE;
  state.player.y = (targetY + 0.5) * TILE_SIZE;
  state.player.traversalMode = state.player.traversalMode === 'foot' ? 'boat' : 'foot';
  return { ok: true, message: state.player.traversalMode === 'boat' ? 'Rowboat launched' : 'Stepped ashore' };
}

/** Exact recipe lock line, or null once the tool's requirement passes. */
export function toolUnlockReason(state: GameState, definitionId: ToolDefinitionId): string | null {
  const definition = toolDefinition(definitionId);
  if (definition.shopService === 'magic-shop') return 'Purchase at the Magic Shop';
  const ownership = blueprintLockedReason(state, definitionId);
  if (ownership) return ownership;
  // Stone and Iron tools are workbench recipes; the Wooden starters and the
  // handcraft-flagged exceptions (the Bow) are made anywhere.
  if (!isHandcraftTool(gameToolDefinition(state, definitionId))) {
    if (nearestUsableFacilityMatching(state, FACILITY_INTERACTION_RANGE_PX, 'workbench')) return null;
    const hasUsableWorkbench = nearestUsableFacilityMatching(state, Number.POSITIVE_INFINITY, 'workbench') !== null;
    return hasUsableWorkbench ? 'Craft at a workbench' : 'Build a workbench on a floor';
  }
  return null;
}

/** Atomically craft and equip any defined tool. */
export function craftTool(state: GameState, definitionId: ToolDefinitionId): CommandResult {
  const definition = gameToolDefinition(state, definitionId);
  const locked = toolUnlockReason(state, definitionId);
  if (locked) return { ok: false, message: locked };
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
    powerRank: 0,
    speedRank: 0,
    durabilityRank: 0,
  };
  state.nextEntityId += 1;
  state.tools.push(tool);
  state.equippedToolId = tool.instanceId;
  recordCraft(state, definitionId);
  grantXp(state, 20);
  return { ok: true, message: `Crafted and equipped ${definition.displayName}` };
}

/** Repairing a tool always takes it back to full, whatever it was worn down to. */
function repairRestored(tool: ToolInstance): number {
  return tool.maxDurability - tool.durability;
}

/**
 * What a Repair press costs: half the tool's crafting materials, flat. Exported
 * so the Craft panel can price and disable the button from the same numbers
 * `repairTool` charges, instead of offering a repair the bag cannot pay for.
 */
export function nextRepairCost(state: GameState, tool: ToolInstance): ResourceAmounts {
  return repairCost(gameToolDefinition(state, tool.definitionId).repairBasisCost);
}

/** Pure availability check shared by repair surfaces and the atomic command. */
export function repairToolBlockedReason(state: GameState, toolId: string): string | null {
  const tool = state.tools.find((candidate) => candidate.instanceId === toolId);
  if (!tool) return 'Tool not found';
  if (tool.maxDurability - tool.durability <= 0) return 'Tool is already fully repaired';
  const missingResource = firstMissingResource(state, nextRepairCost(state, tool));
  return missingResource ? `Need ${missingResource.amount} more ${missingResource.resource}` : null;
}

export function repairTool(state: GameState, toolId: string): CommandResult {
  const tool = state.tools.find((candidate) => candidate.instanceId === toolId);
  if (!tool) return { ok: false, message: 'Tool not found' };
  const missing = tool.maxDurability - tool.durability;
  if (missing <= 0) return { ok: false, message: 'Tool is already fully repaired' };
  const restored = repairRestored(tool);
  const cost = nextRepairCost(state, tool);
  const missingResource = firstMissingResource(state, cost);
  if (missingResource) {
    return { ok: false, message: `Need ${missingResource.amount} more ${missingResource.resource}` };
  }

  for (const [resource, amount] of Object.entries(cost) as Array<[ResourceId, number]>) {
    state.inventory[resource] -= amount;
  }
  if (tool.definitionId.startsWith('iron-') && tool.durability * 4 < tool.maxDurability
    && !state.questProgress.criticalIronRepairCandidates.includes(tool.instanceId)) {
    state.questProgress.criticalIronRepairCandidates.push(tool.instanceId);
  }
  tool.durability = tool.maxDurability;
  state.repairsMade += 1;
  if (tool.durability === tool.maxDurability) {
    const candidate = state.questProgress.criticalIronRepairCandidates.indexOf(tool.instanceId);
    if (candidate >= 0) {
      state.questProgress.criticalIronRepairCandidates.splice(candidate, 1);
      state.questProgress.ironToolsRestoredFromCritical += 1;
    }
  }
  return { ok: true, message: `Repaired ${restored} durability to full` };
}

/** Equipping is explicit so repairing a broken tool never changes loadout unexpectedly. */
export function equipTool(state: GameState, toolId: string): CommandResult {
  const tool = state.tools.find((candidate) => candidate.instanceId === toolId);
  if (!tool) return { ok: false, message: 'Tool not found' };
  if (tool.durability <= 0) return { ok: false, message: 'Repair this tool before equipping it' };
  state.equippedToolId = tool.instanceId;
  return { ok: true, message: `Equipped ${toolDefinition(tool.definitionId).displayName}` };
}

/** Unequip the active tool so gathering and combat use the bare-hands rules. */
export function equipBareHands(state: GameState): CommandResult {
  state.equippedToolId = null;
  return { ok: true, message: 'Switched to bare hands' };
}

/**
 * Attempts to collect the whole nearby drop. A full inventory leaves it in
 * place.
 *
 * Blueprints on the ground answer to the same button. They are the thing a
 * player is most likely to be running back for, so they are taken first — a
 * corpse run must never fail because a stack of wood was fractionally nearer.
 */
export function collectNearestGroundDrop(state: GameState, range = INTERACTION_RANGE_PX): CommandResult {
  // The death cache outranks everything. It is the only thing here on a
  // countdown the player cannot restart, and it is what they walked back
  // through a danger phase for.
  if (deathCacheInReach(state, range)) return recoverDeathCache(state, range);
  const blueprint = nearestBlueprintDrop(state, range);
  if (blueprint) return recoverBlueprintDrop(state, blueprint.id);
  // A put-down tool outranks loose resources for the same reason: it is the
  // thing the player walked back for, and it is the one that cannot restack.
  const droppedTool = nearestToolDrop(state, range);
  if (droppedTool) return recoverToolDrop(state, droppedTool.id);
  const drop = nearestGroundDrop(state, range);
  if (!drop) return { ok: false, message: 'Move closer to a dropped resource' };
  if (!tryAddResource(state, drop.resource, drop.amount)) {
    return { ok: false, message: 'Inventory full', targetId: drop.id };
  }
  state.groundDrops = state.groundDrops.filter((item) => item.id !== drop.id);
  return { ok: true, message: `Picked up ${drop.amount} ${drop.resource}`, targetId: drop.id };
}

/** Split one displayed resource stack into two Bag slots. */
export function splitResourceStack(state: GameState, resource: ResourceId, stackIndex: number, amount: number): CommandResult {
  const stacks = resourceStacksForAmount(state, resource, state.inventory[resource]);
  const stack = stacks[stackIndex];
  if (stack === undefined) return { ok: false, message: 'That stack is no longer available' };
  if (!Number.isInteger(amount) || amount < 1 || amount >= stack) {
    return { ok: false, message: `Choose an amount from 1 to ${Math.max(1, stack - 1)}` };
  }
  if (usedInventorySlots(state) >= inventoryCapacity(state)) {
    return { ok: false, message: 'No empty Bag slot for the split stack' };
  }
  stacks.splice(stackIndex, 1, amount, stack - amount);
  state.inventoryStacks[resource] = stacks;
  return { ok: true, message: `Split ${amount} ${resource} into a new stack` };
}

/** Drop the whole selected stack at the player for five minutes. */
export function dropResourceStack(state: GameState, resource: ResourceId, stackIndex: number): CommandResult {
  const stacks = resourceStacksForAmount(state, resource, state.inventory[resource]);
  const amount = stacks[stackIndex];
  if (amount === undefined) return { ok: false, message: 'That stack is no longer available' };
  stacks.splice(stackIndex, 1);
  state.inventoryStacks[resource] = stacks;
  state.inventory[resource] -= amount;
  addGroundDrop(state, resource, amount, state.player.x, state.player.y, state.tick + 5 * 60 * 60);
  return { ok: true, message: `Dropped ${amount} ${resource}` };
}

/**
 * How long a put-down tool lies in the world.
 *
 * Ten real minutes at the fixed 60 Hz tick, matching a dropped blueprint. A
 * tool is worth more than a stack of wood, so it outlasts the five-minute
 * resource drop — but it still goes, because the ground is not a chest.
 */
export const TOOL_DROP_TTL_TICKS = 10 * 60 * 60;

/**
 * Put a tool down at the player's feet.
 *
 * The instance leaves the bag whole and comes back whole, so wear and contract
 * ranks survive the round trip. Dropping the equipped tool also unequips it:
 * the alternative is swinging at a tree with something lying in the grass.
 */
export function dropTool(state: GameState, toolId: string): CommandResult {
  const index = state.tools.findIndex((candidate) => candidate.instanceId === toolId);
  if (index < 0) return { ok: false, message: 'Tool not found' };
  const tool = state.tools[index]!;
  state.tools.splice(index, 1);
  if (state.equippedToolId === tool.instanceId) state.equippedToolId = null;
  state.toolDrops.push({
    id: `tool-drop-${state.nextEntityId}`,
    tool,
    x: Math.round(state.player.x),
    y: Math.round(state.player.y),
    expiresAtTick: state.tick + TOOL_DROP_TTL_TICKS,
  });
  state.nextEntityId += 1;
  return { ok: true, message: `Dropped ${toolDefinition(tool.definitionId).displayName}` };
}

/** The nearest tool lying within reach, or null. */
export function nearestToolDrop(state: GameState, range = INTERACTION_RANGE_PX): ToolGroundDrop | null {
  let nearest: ToolGroundDrop | null = null;
  let bestDistance = range;
  for (const drop of state.toolDrops) {
    const distance = Math.hypot(drop.x - state.player.x, drop.y - state.player.y);
    if (distance <= bestDistance) {
      nearest = drop;
      bestDistance = distance;
    }
  }
  return nearest;
}

/** Pick a put-down tool back up, wear, ranks, and all. */
export function recoverToolDrop(state: GameState, dropId: string): CommandResult {
  const index = state.toolDrops.findIndex((drop) => drop.id === dropId);
  if (index < 0) return { ok: false, message: 'That tool is gone' };
  const drop = state.toolDrops[index]!;
  if (Math.hypot(drop.x - state.player.x, drop.y - state.player.y) > INTERACTION_RANGE_PX) {
    return { ok: false, message: 'Move closer' };
  }
  if (usedInventorySlots(state) >= inventoryCapacity(state)) return { ok: false, message: 'Bag is full' };
  state.toolDrops.splice(index, 1);
  state.tools.push(drop.tool);
  return {
    ok: true,
    message: `Picked up ${toolDefinition(drop.tool.definitionId).displayName}`,
    targetId: drop.id,
  };
}

/** Sweep tools whose ten-minute lifetime has elapsed. */
export function expireToolDrops(state: GameState): boolean {
  const before = state.toolDrops.length;
  state.toolDrops = state.toolDrops.filter((drop) => state.tick < drop.expiresAtTick);
  return state.toolDrops.length !== before;
}

/** Remove player-dropped stacks whose five-minute lifetime has elapsed. */
export function advanceGroundDropExpiry(state: GameState): boolean {
  const before = state.groundDrops.length;
  state.groundDrops = state.groundDrops.filter((drop) => drop.expiresAtTick === null || drop.expiresAtTick > state.tick);
  return state.groundDrops.length !== before;
}

export function equippedTool(state: GameState): ToolInstance | null {
  if (state.equippedToolId === null) return null;
  return state.tools.find((tool) => tool.instanceId === state.equippedToolId) ?? null;
}

/** Number of resource stacks plus one slot per non-stackable tool instance. */
export function usedInventorySlots(state: GameState): number {
  // Carried blueprints take one slot each: the space they cost is the pressure
  // to go home and register them.
  return state.tools.length + state.carriedBlueprints.length + (Object.keys(state.inventory) as ResourceId[]).reduce(
    (slots, resource) => slots + resourceStacksForAmount(state, resource, state.inventory[resource]).length, 0,
  );
}

function usedInventorySlotsAfterCost(state: GameState, cost: ResourceAmounts): number {
  return state.tools.length + state.carriedBlueprints.length + (Object.entries(state.inventory) as Array<[ResourceId, number]>).reduce(
    (slots, [resource, amount]) => slots + resourceStacksForAmount(
      state, resource, amount - (cost[resource] ?? 0),
    ).length, 0,
  );
}

/**
 * Whether a crafted resource fits after its ingredients have been consumed.
 * Crafting must evaluate the exchange as one transaction: checking the output
 * against the current bag incorrectly rejects recipes whose ingredients free
 * the slot the output needs.
 */
export function canAddResourceAfterCost(
  state: GameState,
  resource: ResourceId,
  amount: number,
  cost: ResourceAmounts,
): boolean {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  const afterCost = state.inventory[resource] - (cost[resource] ?? 0);
  if (afterCost < 0) return false;
  const slotsAfterCost = usedInventorySlotsAfterCost(state, cost);
  const outputSlotsBefore = resourceStacksForAmount(state, resource, afterCost).length;
  const outputSlotsAfter = resourceStacksForAmount(state, resource, afterCost + amount).length;
  return slotsAfterCost - outputSlotsBefore + outputSlotsAfter <= inventoryCapacity(state);
}

export function tryAddResource(state: GameState, resource: ResourceId, amount: number): boolean {
  if (!Number.isInteger(amount) || amount <= 0) return false;
  const current = state.inventory[resource];
  const currentStacks = resourceStacksForAmount(state, resource, current);
  const currentSlots = currentStacks.length;
  const resulting = resourceStacksForAmount(state, resource, current + amount);
  const resultingSlots = resulting.length;
  if (usedInventorySlots(state) - currentSlots + resultingSlots > inventoryCapacity(state)) return false;
  state.inventory[resource] += amount;
  state.inventoryStacks[resource] = resulting;
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

export function addGroundDrop(state: GameState, resource: ResourceId, amount: number, x: number, y: number, expiresAtTick: number | null = null): void {
  state.groundDrops.push({
    id: `drop-${state.nextEntityId}`,
    resource,
    amount,
    x,
    y,
    expiresAtTick,
  });
  state.nextEntityId += 1;
}

/**
 * Every repair — tool or structure — restores the thing in full and costs half
 * what making it from scratch costs, rounded up per material so a cheap recipe
 * never repairs for free. One flat price, so a player can read the button and
 * know what it takes without tracking how worn the item happens to be.
 */
export function repairCost(basis: ResourceAmounts): ResourceAmounts {
  return Object.fromEntries(
    Object.entries(basis).map(([resource, amount]) => [
      resource,
      Math.max(1, Math.ceil(amount / 2)),
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
  if (kind === 'metal') return 'Iron vein';
  if (kind === 'berry-bush') return 'Berry bush';
  return 'Plant';
}

function rollBaseYield(state: GameState, min: number, max: number): number {
  const rng = createRng(state.rngState);
  const result = rng.nextInt(min, max + 1);
  state.rngState = rng.getState();
  return result;
}

function rollChanceBps(state: GameState, chanceBps: number): boolean {
  if (chanceBps <= 0) return false;
  const rng = createRng(state.rngState);
  const succeeded = rng.nextInt(0, 10_000) < chanceBps;
  state.rngState = rng.getState();
  return succeeded;
}

/** Spec-exact fixed-point yield scaling with a persisted per-resource carry. */
export function applyDeterministicYield(
  state: GameState,
  resource: GatherableResourceId,
  baseUnits: number,
  yieldBonusBps: number,
): number {
  const scaled = baseUnits * (10_000 + yieldBonusBps) + state.yieldRemainderByResource[resource];
  const awardedUnits = Math.floor(scaled / 10_000);
  state.yieldRemainderByResource[resource] = scaled % 10_000;
  return awardedUnits;
}
