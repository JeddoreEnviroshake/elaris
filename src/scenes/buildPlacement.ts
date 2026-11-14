import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import type { BoundaryEdge, BuildingDefinitionId, BuildingState, GameState, ResourceId } from '../simulation/state';
import { effectiveDimensions, placementDimensions } from '../simulation/buildingGeometry';
import {
  BUILD_RANGE_PX,
  BUILDABLES,
  buildableById,
  buildableLockedReason as simBuildableLockedReason,
  checkPlacement,
  defaultBoundaryEdgeFromFacing,
  placeBuilding,
  removeBuilding,
  undoBuildingPlacement,
  validatePlacement,
  type BuildableDefinition,
  type PlacementCheck,
  type PlacementOptions,
  type PlaceResult,
} from '../simulation/gameplayCommands';

/**
 * PRESENTATION ADAPTER for build mode. Placement logic is now the authoritative
 * simulation's: this module re-exports the sim's catalog/commands (which persist
 * to `state.buildings` and enforce ownership, overlap, and range) and adds only the
 * presentation-side concerns the sim does not carry — ghost geometry, palette
 * copy, and small display helpers. `BuildModeController` and `BuildMenu` import
 * everything build-related from here so the seam stays in one place.
 */

export type BuildableId = BuildingDefinitionId;

export {
  BUILD_RANGE_PX,
  BUILDABLES,
  buildableById,
  checkPlacement,
  defaultBoundaryEdgeFromFacing,
  placeBuilding,
  removeBuilding,
  undoBuildingPlacement,
  validatePlacement,
};
export type { BuildableDefinition, PlacementCheck, PlacementOptions, PlaceResult };

/** Palette copy per structure. Gates here match the sim's enforced requirements. */
const BUILD_DESCRIPTIONS: Readonly<Record<BuildableId, string>> = {
  'thatch-floor': 'Indoor surface. Floors define a room’s area.',
  'wood-floor': 'Sturdier indoor surface. Floors define a room’s area.',
  'stone-floor': 'Durable stone indoor surface worth 8 Rating.',
  'metal-floor': 'Fortified metal indoor surface worth 20 Rating.',
  'thatch-ground': 'Prepared ground. Defines a work yard’s area.',
  'wood-ground': 'Decked ground. Defines a work yard’s area.',
  'stone-ground': 'Durable prepared stone ground worth 8 Rating.',
  'metal-ground': 'Fortified prepared metal ground worth 20 Rating.',
  'thatch-wall': 'Closes a floor’s perimeter.',
  'wood-wall': 'Sturdier wall. Closes a floor’s perimeter.',
  'stone-wall': 'Durable wall. Closes a floor’s perimeter.',
  'metal-wall': 'Fortified wall. Closes a floor’s perimeter.',
  'thatch-door': 'Walk-through boundary for rooms.',
  'wood-door': 'Sturdier walk-through boundary for rooms.',
  'stone-door': 'Durable walk-through boundary for rooms.',
  'metal-door': 'Fortified walk-through boundary for rooms.',
  'thatch-fence': 'Closes a work yard’s perimeter.',
  'wood-fence': 'Sturdier fence. Closes a work yard’s perimeter.',
  'stone-fence': 'Durable fence. Closes a work yard’s perimeter.',
  'metal-fence': 'Fortified fence. Closes a work yard’s perimeter.',
  'thatch-gate': 'Walk-through boundary for yards.',
  'wood-gate': 'Sturdier walk-through boundary for yards.',
  'stone-gate': 'Durable walk-through boundary for yards.',
  'metal-gate': 'Fortified walk-through boundary for yards.',
  'wood-bridge': 'Two-tile wooden crossing. Place over water and rotate to span either direction.',
  'stone-bridge': 'Two-tile stone crossing. Place over water and rotate to span either direction.',
  water: 'Shape the map with shallow, boatable water. Bridges can be placed over it.',
  'environment-marker': 'Legacy environment anchor retained for existing saves.',
  'field-cache': 'Small storage that can be placed on any open footprint.',
  workbench: 'Shelter milestone: 8 enclosed tiles. Place on a 2-tile floor; no enclosure required.',
  warehouse: 'Bulk 24-space shared storage for supplies, materials, and tools.',
  'logistics-hub': 'Routes completed creature work output into ordered storage destinations.',
  furnace: 'Smelts iron ore indoors using wood fuel.',
  'farm-counter': 'Orders trained creatures from home after their species contract is unlocked.',
  'small-pen': 'One housing slot and a finite Tuftle collection bin inside a valid paddock.',
  barn: 'Three housing slots and a larger collection bin inside a valid paddock.',
  'stone-yard': 'A Craghopper worksite with a finite stone collection bin.',
  'cart-dock': 'A Glade Stag worksite that unloads raw-resource stacks into linked storage.',
  bed: 'Respawn anchor. You return here after being defeated.',
  'air-purifier': 'Purifies an enclosed room, or a 1-tile radius when outside one.',
  'garden-bed': 'Grows fiber renewably wherever its footprint is open.',
  'woodlot-planter': 'Grows renewable wood wherever its footprint is open.',
  'war-table': 'Plans the defence of your base. Unlocks Turrets and reports the coming raid.',
  turret: 'Shoots raiders during the danger minute. Load it with arrows to keep it firing.',
};

export function describeBuildable(id: BuildableId): string {
  return BUILD_DESCRIPTIONS[id];
}

/**
 * Palette lock line for a not-yet-unlocked entry, or null when available.
 * Presentation alias of the sim's typed unlock evaluation.
 */
export function buildableLockedReason(state: GameState, id: BuildableId): string | null {
  return simBuildableLockedReason(state, id);
}

// Cost copy is shared with the Craft and facility panels; see ui/costs.ts.
export { canAffordCost, costText, stockedCostText } from '../ui/costs';

/** First resource the inventory cannot cover, or null when affordable. */
export function missingCost(
  state: GameState,
  cost: BuildableDefinition['cost'],
): { resource: ResourceId; amount: number } | null {
  for (const [resource, amount] of Object.entries(cost) as Array<[ResourceId, number]>) {
    const short = amount - state.inventory[resource];
    if (short > 0) return { resource, amount: short };
  }
  return null;
}

export function tileFromWorld(worldPx: number): number {
  return Math.floor(worldPx / TILE_SIZE);
}

/**
 * Resolve a pointer position to the closest shared tile edge. Boundary parts
 * are edge objects, so this keeps the stored edge aligned with the ghost the
 * player is actually placing instead of silently depending on player facing.
 */
export function boundaryPlacementFromWorld(
  worldX: number,
  worldY: number,
): { tileX: number; tileY: number; boundaryEdge: BoundaryEdge } {
  const tileX = Math.max(0, Math.min(WORLD_TILES - 1, tileFromWorld(worldX)));
  const tileY = Math.max(0, Math.min(WORLD_TILES - 1, tileFromWorld(worldY)));
  const localX = Math.max(0, Math.min(TILE_SIZE, worldX - tileX * TILE_SIZE));
  const localY = Math.max(0, Math.min(TILE_SIZE, worldY - tileY * TILE_SIZE));
  const candidates: ReadonlyArray<readonly [BoundaryEdge, number]> = [
    ['north', localY],
    ['west', localX],
    ['east', TILE_SIZE - localX],
    ['south', TILE_SIZE - localY],
  ];
  let closest = candidates[0]!;
  for (const candidate of candidates.slice(1)) if (candidate[1] < closest[1]) closest = candidate;
  return { tileX, tileY, boundaryEdge: closest[0] };
}

const PERIMETER_STEPS: ReadonlyArray<{ dx: number; dy: number; edge: BoundaryEdge }> = [
  { dx: 0, dy: -1, edge: 'north' },
  { dx: -1, dy: 0, edge: 'west' },
  { dx: 1, dy: 0, edge: 'east' },
  { dx: 0, dy: 1, edge: 'south' },
];

/**
 * Boundary art occupies a square around an edge, which made tapping the visual
 * center ambiguous and previously defaulted every tie to north. Near a matching
 * player surface, prefer its closest exposed perimeter edge. Free placement is
 * retained when no perimeter is nearby (for example, boundaries before floors).
 */
export function boundaryPlacementNearSurface(
  buildings: readonly BuildingState[],
  def: BuildableDefinition,
  worldX: number,
  worldY: number,
): { tileX: number; tileY: number; boundaryEdge: BoundaryEdge } {
  if (def.layer !== 'boundary' || !def.boundaryClass) return boundaryPlacementFromWorld(worldX, worldY);
  const targetKind = def.boundaryClass === 'wall' || def.boundaryClass === 'door' ? 'floor' : 'ground';
  const matchingCells = new Set<string>();
  for (const building of buildings) {
    const candidate = buildableById(building.definitionId);
    if (candidate.layer === 'surface' && candidate.surfaceKind === targetKind) {
      matchingCells.add(`${building.tileX},${building.tileY}`);
    }
  }

  let best: { tileX: number; tileY: number; boundaryEdge: BoundaryEdge; distanceSquared: number } | null = null;
  for (const key of matchingCells) {
    const [tileX, tileY] = key.split(',').map(Number) as [number, number];
    for (const { dx, dy, edge } of PERIMETER_STEPS) {
      if (matchingCells.has(`${tileX + dx},${tileY + dy}`)) continue;
      const midpointX = (tileX + (edge === 'east' ? 1 : edge === 'west' ? 0 : 0.5)) * TILE_SIZE;
      const midpointY = (tileY + (edge === 'south' ? 1 : edge === 'north' ? 0 : 0.5)) * TILE_SIZE;
      const distanceSquared = (worldX - midpointX) ** 2 + (worldY - midpointY) ** 2;
      if (!best || distanceSquared < best.distanceSquared) {
        best = { tileX, tileY, boundaryEdge: edge, distanceSquared };
      }
    }
  }
  return best && best.distanceSquared <= (TILE_SIZE * 1.25) ** 2
    ? { tileX: best.tileX, tileY: best.tileY, boundaryEdge: best.boundaryEdge }
    : boundaryPlacementFromWorld(worldX, worldY);
}

/** Ghost spawns on the tile(s) directly in front of the player. */
export function defaultGhostTile(
  state: GameState,
  def: BuildableDefinition,
): { tileX: number; tileY: number } {
  const px = tileFromWorld(state.player.x);
  const py = tileFromWorld(state.player.y);
  const edge = def.layer === 'boundary' ? defaultBoundaryEdgeFromFacing(state.player.facing) : undefined;
  const dimensions = def.layer === 'boundary'
    ? placementDimensions(def, edge ? { boundaryEdge: edge } : {})
    : effectiveDimensions(def);
  let tileX = px - Math.floor((dimensions.tilesWide - 1) / 2);
  let tileY = py - Math.floor((dimensions.tilesHigh - 1) / 2);
  switch (state.player.facing) {
    case 'down':
      tileY = py + 1;
      break;
    case 'up':
      tileY = py - dimensions.tilesHigh;
      break;
    case 'left':
      tileX = px - dimensions.tilesWide;
      break;
    case 'right':
      tileX = px + 1;
      break;
  }
  return clampTileToBounds(tileX, tileY, def, false, edge);
}

export function clampTileToBounds(
  tileX: number,
  tileY: number,
  def: BuildableDefinition,
  rotated = false,
  boundaryEdge?: BoundaryEdge,
): { tileX: number; tileY: number } {
  const dimensions = def.layer === 'boundary'
    ? placementDimensions(def, { rotated, ...(boundaryEdge ? { boundaryEdge } : {}) })
    : effectiveDimensions(def, rotated);
  return {
    tileX: Math.max(0, Math.min(WORLD_TILES - dimensions.tilesWide, tileX)),
    tileY: Math.max(0, Math.min(WORLD_TILES - dimensions.tilesHigh, tileY)),
  };
}

export interface PlacementTarget {
  readonly tileX: number;
  readonly tileY: number;
  readonly boundaryEdge?: BoundaryEdge;
  readonly magnetized: boolean;
}

/**
 * Convert a world-space pointer into the footprint anchor the player means.
 * If that exact anchor is illegal, a valid neighbour within one tile wins by
 * screen/world distance. This small amount of forgiveness fixes near-edge
 * clicks without moving already-valid exact placements.
 */
export function placementTargetFromWorld(
  state: GameState,
  def: BuildableDefinition,
  worldX: number,
  worldY: number,
  options: PlacementOptions = {},
): PlacementTarget {
  if (def.layer === 'boundary') {
    const target = boundaryPlacementNearSurface(state.buildings, def, worldX, worldY);
    return { ...target, magnetized: false };
  }

  const dimensions = effectiveDimensions(def, options.rotated === true);
  const raw = clampTileToBounds(
    tileFromWorld(worldX - ((dimensions.tilesWide - 1) * TILE_SIZE) / 2),
    tileFromWorld(worldY - ((dimensions.tilesHigh - 1) * TILE_SIZE) / 2),
    def,
    options.rotated === true,
  );
  if (checkPlacement(state, state.buildings, def, raw.tileX, raw.tileY, options).ok) {
    return { ...raw, magnetized: false };
  }

  let best: { tileX: number; tileY: number; distanceSquared: number } | null = null;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const candidate = clampTileToBounds(raw.tileX + dx, raw.tileY + dy, def, options.rotated === true);
      if (candidate.tileX === raw.tileX && candidate.tileY === raw.tileY) continue;
      if (!checkPlacement(state, state.buildings, def, candidate.tileX, candidate.tileY, options).ok) continue;
      const centerX = (candidate.tileX + dimensions.tilesWide / 2) * TILE_SIZE;
      const centerY = (candidate.tileY + dimensions.tilesHigh / 2) * TILE_SIZE;
      const distanceSquared = (worldX - centerX) ** 2 + (worldY - centerY) ** 2;
      if (!best || distanceSquared < best.distanceSquared) best = { ...candidate, distanceSquared };
    }
  }
  return best && best.distanceSquared <= (TILE_SIZE * 1.35) ** 2
    ? { tileX: best.tileX, tileY: best.tileY, magnetized: true }
    : { ...raw, magnetized: false };
}
