import { TILE_SIZE, WORLD_TILES } from '../config/platform';
import { authoredWorldAreaByKey } from '../content/world';
import { townPrecinctForArea } from '../content/townBuildings';
import { isRegionalLandmarkTileClear } from '../content/regions';
import { elarisAuthoredWaterAt, elarisUnderlyingWaterAt, isElarisWaterTempleReservedTile } from '../content/elarisWaters';
import { isRoadTile } from '../content/roads';
import { ELARIS_WEST_ENTRANCE } from '../content/townDefences';
import { coordinateHash } from './biomes';
import type { AreaDescriptor, AreaThemeId, BuildingState, Facing, TraversalMode } from './state';

export type TerrainKind = 'ground' | 'shallow-water' | 'deep-water' | 'bridge' | 'rock-wall';

export interface TerrainCapabilities {
  readonly walkable: boolean;
  readonly boatable: boolean;
  readonly buildable: boolean;
  readonly spawnable: boolean;
}

export interface LandscapeContext {
  readonly x: number;
  readonly y: number;
  readonly theme: AreaThemeId;
  readonly landClearingTiles?: readonly string[];
}

const CAPABILITIES: Readonly<Record<TerrainKind, TerrainCapabilities>> = {
  ground: { walkable: true, boatable: false, buildable: true, spawnable: true },
  bridge: { walkable: true, boatable: false, buildable: false, spawnable: false },
  'shallow-water': { walkable: false, boatable: true, buildable: false, spawnable: false },
  'deep-water': { walkable: false, boatable: true, buildable: false, spawnable: false },
  'rock-wall': { walkable: false, boatable: false, buildable: false, spawnable: false },
};
const clearingCache = new WeakMap<readonly string[], ReadonlySet<string>>();

/** Convert a region-local tile to the one global tile plane used by every feature. */
export function globalTile(areaCoordinate: number, localTile: number): number {
  return areaCoordinate * WORLD_TILES + localTile;
}

export function terrainCapabilities(kind: TerrainKind): TerrainCapabilities {
  return CAPABILITIES[kind];
}

export function terrainAllows(kind: TerrainKind, mode: TraversalMode): boolean {
  const capabilities = terrainCapabilities(kind);
  return mode === 'boat' ? capabilities.boatable : capabilities.walkable;
}

/**
 * Deterministic terrain classification in global coordinates. Rivers and lake
 * polygons are therefore identical at opposite region borders regardless of
 * which region is generated first.
 */
export function terrainAt(
  worldSeed: number,
  area: LandscapeContext,
  tileX: number,
  tileY: number,
): TerrainKind {
  const base = terrainWithoutBridgesAt(worldSeed, area, tileX, tileY);
  const areaKey = `${area.x},${area.y}`;
  const water = base === 'shallow-water' || base === 'deep-water';
  if (isRoadTile(areaKey, tileX, tileY)) return water ? 'bridge' : 'ground';
  if (water && areaKey === '0,0' && elarisAuthoredWaterAt(tileX, tileY) === 'bridge') return 'bridge';
  if (water) {
    const gx = globalTile(area.x, tileX); const gy = globalTile(area.y, tileY);
    const river = riverSample(worldSeed, gx, gy);
    if (river.distance <= river.halfWidth && isBridgeCrossing(worldSeed, gx, gy, river.band, river.centerX, river.halfWidth)) return 'bridge';
  }
  return base;
}

/** Columns west of the Elaris gate that the entrance bridges may span. */
const WEST_CROSSING_MIN_X = 40;

/**
 * The bridges into Elaris's west gate are clean rectangles: exactly the gate's
 * width (rows 83-86, the road between the timber posts) and, per crossing, the
 * same length on every row. A river bank that wobbles across those four rows
 * is squared off instead, so the water (and the deck the road lays over it)
 * ends on one straight line at both banks.
 */
function isElarisWestCrossingWater(worldSeed: number, area: LandscapeContext, tileX: number, tileY: number): boolean {
  if (tileX < WEST_CROSSING_MIN_X || tileX >= ELARIS_WEST_ENTRANCE.x) return false;
  if (tileY < ELARIS_WEST_ENTRANCE.top || tileY >= ELARIS_WEST_ENTRANCE.bottom) return false;
  for (let row = ELARIS_WEST_ENTRANCE.top; row < ELARIS_WEST_ENTRANCE.bottom; row++) {
    const kind = naturalTerrainAt(worldSeed, area, tileX, row);
    if (kind === 'shallow-water' || kind === 'deep-water') return true;
  }
  return false;
}

/** The real terrain beneath generated roads and bridges, including saved land clearing. */
export function terrainWithoutBridgesAt(worldSeed: number, area: LandscapeContext, tileX: number, tileY: number): TerrainKind {
  const kind = naturalTerrainAt(worldSeed, area, tileX, tileY);
  if (kind === 'ground' && area.x === 0 && area.y === 0
    && !(area.landClearingTiles && clearingSet(area.landClearingTiles).has(`${tileX},${tileY}`))
    && isElarisWestCrossingWater(worldSeed, area, tileX, tileY)) return 'shallow-water';
  return kind;
}

function naturalTerrainAt(worldSeed: number, area: LandscapeContext, tileX: number, tileY: number): TerrainKind {
  const gx = globalTile(area.x, tileX);
  const gy = globalTile(area.y, tileY);
  const areaKey = `${area.x},${area.y}`;

  if (area.landClearingTiles && clearingSet(area.landClearingTiles).has(`${tileX},${tileY}`)) return 'ground';
  if (isRegionalLandmarkTileClear(areaKey, tileX, tileY)) return 'ground';

  const elarisWater = areaKey === '0,0' ? elarisUnderlyingWaterAt(tileX, tileY) : null;

  // The first expedition's east road is a guaranteed, seam-safe walking route.
  // Settlement precincts are equally authoritative: a service door must never
  // generate inside a lake or impassable ridge.
  if (authoredWorldAreaByKey(areaKey)) {
    // Authored water wins over the settlement's broad dry-land reservation.
    // The reservation protects building doors from procedural lakes, but the
    // Elaris moat intentionally occupies its outer western and southern edge.
    if (elarisWater) return elarisWater;
    const precinct = townPrecinctForArea(areaKey);
    if (tileX >= precinct.tileX && tileX < precinct.tileX + precinct.tilesWide
      && tileY >= precinct.tileY && tileY < precinct.tileY + precinct.tilesHigh) return 'ground';
  }

  if (elarisWater) return elarisWater;

  // Elaris' service precinct and onboarding clearing always remain dry land.
  // The authored river runs just west of this rectangle.
  if (gx >= 63 && gx <= 105 && gy >= 58 && gy <= 109) return 'ground';

  const river = riverSample(worldSeed, gx, gy);
  if (river.distance <= river.halfWidth) {
    return river.distance <= Math.max(1, river.halfWidth - 1.35) ? 'deep-water' : 'shallow-water';
  }

  const lake = lakeDepth(worldSeed, gx, gy);
  if (lake > 0) return lake > 0.44 ? 'deep-water' : 'shallow-water';

  if (isRockWall(worldSeed, gx, gy)) return 'rock-wall';
  return 'ground';
}

/**
 * Resolve generated terrain plus player landscaping. Bridges deliberately win
 * over water so a crossing can sit on top of a player-shaped channel.
 */
export function terrainAtWithBuildings(
  worldSeed: number,
  area: LandscapeContext,
  buildings: readonly BuildingState[],
  tileX: number,
  tileY: number,
): TerrainKind {
  if (buildings.some((building) => isLandscapeTile(building, tileX, tileY, 'bridge'))) return 'bridge';
  if (buildings.some((building) => isLandscapeTile(building, tileX, tileY, 'water'))) return 'shallow-water';
  return terrainAt(worldSeed, area, tileX, tileY);
}

function isLandscapeTile(
  building: BuildingState,
  tileX: number,
  tileY: number,
  kind: 'bridge' | 'water',
): boolean {
  const matches = kind === 'water'
    ? building.definitionId === 'water'
    : building.definitionId === 'wood-bridge' || building.definitionId === 'stone-bridge';
  if (!matches) return false;
  const canonicalWidth = kind === 'bridge' ? 2 : 1;
  const width = building.rotated ? 1 : canonicalWidth;
  const height = building.rotated ? canonicalWidth : 1;
  return tileX >= building.tileX && tileX < building.tileX + width
    && tileY >= building.tileY && tileY < building.tileY + height;
}

export function terrainAtWorldPosition(
  worldSeed: number,
  area: LandscapeContext,
  worldX: number,
  worldY: number,
): TerrainKind {
  return terrainAt(
    worldSeed,
    area,
    Math.max(0, Math.min(WORLD_TILES - 1, Math.floor(worldX / TILE_SIZE))),
    Math.max(0, Math.min(WORLD_TILES - 1, Math.floor(worldY / TILE_SIZE))),
  );
}

export function isTerrainSpawnable(worldSeed: number, area: LandscapeContext, worldX: number, worldY: number): boolean {
  if (`${area.x},${area.y}` === '0,0'
    && isElarisWaterTempleReservedTile(Math.floor(worldX / TILE_SIZE), Math.floor(worldY / TILE_SIZE))) return false;
  return terrainCapabilities(terrainAtWorldPosition(worldSeed, area, worldX, worldY)).spawnable;
}

export function adjacentTile(
  area: AreaDescriptor,
  tileX: number,
  tileY: number,
  facing: Facing,
): { areaX: number; areaY: number; tileX: number; tileY: number } {
  let nextX = tileX + (facing === 'left' ? -1 : facing === 'right' ? 1 : 0);
  let nextY = tileY + (facing === 'up' ? -1 : facing === 'down' ? 1 : 0);
  let areaX = area.x;
  let areaY = area.y;
  if (nextX < 0) { areaX -= 1; nextX = WORLD_TILES - 1; }
  if (nextX >= WORLD_TILES) { areaX += 1; nextX = 0; }
  if (nextY < 0) { areaY -= 1; nextY = WORLD_TILES - 1; }
  if (nextY >= WORLD_TILES) { areaY += 1; nextY = 0; }
  return { areaX, areaY, tileX: nextX, tileY: nextY };
}

interface RiverSample { readonly band: number; readonly centerX: number; readonly halfWidth: number; readonly distance: number }

function riverSample(seed: number, gx: number, gy: number): RiverSample {
  // The first band passes Elaris at x ~= 56. Further bands repeat far enough
  // apart to create broad land masses between major waterways.
  const spacing = WORLD_TILES * 3;
  const band = Math.round((gx - 56) / spacing);
  const phase = coordinateHash(seed ^ 0x5249_5645, band, 0) * Math.PI * 2;
  const centerX = 56 + band * spacing
    + Math.sin(gy / 31 + phase) * 3.1
    + Math.sin(gy / 73 - phase * 0.6) * 2.2;
  const halfWidth = 2.25 + coordinateHash(seed ^ 0x5749_4454, band, Math.floor(gy / 48)) * 1.35;
  return { band, centerX, halfWidth, distance: Math.abs(gx + 0.5 - centerX) };
}

function isBridgeCrossing(
  seed: number,
  gx: number,
  gy: number,
  band: number,
  centerX: number,
  halfWidth: number,
): boolean {
  const elarisBridge = gx >= 0 && gx < WORLD_TILES && gy >= 83 && gy <= 84;
  const interval = 97;
  const phase = Math.floor(coordinateHash(seed ^ 0x4252_4447, band, 0) * interval);
  const bridgeY = Math.round((gy - phase) / interval) * interval + phase;
  // Elaris's west entrance owns this stretch of river; a generated crossing
  // beside it would bolt a ragged extra lane onto the gate bridge.
  const nearElarisCrossing = gx >= 0 && gx < WORLD_TILES && Math.abs(gy - 85) <= 8;
  const generatedBridge = !nearElarisCrossing && Math.abs(gy - bridgeY) <= 0;
  return (elarisBridge || generatedBridge) && Math.abs(gx + 0.5 - centerX) <= halfWidth + 1;
}

/** Signed lake interior depth, evaluated against neighboring macro cells. */
function lakeDepth(seed: number, gx: number, gy: number): number {
  // Keep the authored starter region legible; its river provides the water
  // tutorial while large lakes begin in surrounding regions.
  if (gx >= 0 && gx < WORLD_TILES && gy >= 0 && gy < WORLD_TILES) return 0;
  const cellSize = WORLD_TILES * 2;
  const cellX = Math.floor(gx / cellSize);
  const cellY = Math.floor(gy / cellSize);
  let best = 0;
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const cx = cellX + ox;
      const cy = cellY + oy;
      const exists = coordinateHash(seed ^ 0x4c41_4b45, cx, cy);
      if (exists < 0.57) continue;
      const centerX = (cx + 0.18 + coordinateHash(seed ^ 0x4c58_504f, cx, cy) * 0.64) * cellSize;
      const centerY = (cy + 0.18 + coordinateHash(seed ^ 0x4c59_504f, cy, cx) * 0.64) * cellSize;
      const radiusX = 25 + coordinateHash(seed ^ 0x4c52_4144, cx, cy) * 31;
      const radiusY = radiusX * (0.68 + coordinateHash(seed ^ 0x4c41_5350, cy, cx) * 0.58);
      const normalized = Math.hypot((gx + 0.5 - centerX) / radiusX, (gy + 0.5 - centerY) / radiusY);
      best = Math.max(best, 1 - normalized);
    }
  }
  return best;
}

function isRockWall(seed: number, gx: number, gy: number): boolean {
  const frequency = 0.42;
  const ridgeBand = Math.round(gy / (WORLD_TILES * 1.7));
  if (coordinateHash(seed ^ 0x5249_4447, ridgeBand, 0) > frequency) return false;
  const phase = coordinateHash(seed ^ 0x5247_5048, ridgeBand, 1) * Math.PI * 2;
  const centerY = ridgeBand * WORLD_TILES * 1.7
    + Math.sin(gx / 29 + phase) * 5.5
    + Math.sin(gx / 67 - phase) * 3;
  const thickness = 1.35 + coordinateHash(seed ^ 0x5247_5744, ridgeBand, 2) * 1.15;
  const gapNoise = coordinateHash(seed ^ 0x5041_5353, Math.floor(gx / 13), ridgeBand);
  return gapNoise > 0.13 && Math.abs(gy + 0.5 - centerY) <= thickness;
}

function clearingSet(tiles: readonly string[]): ReadonlySet<string> {
  const cached = clearingCache.get(tiles);
  if (cached) return cached;
  const created = new Set(tiles);
  clearingCache.set(tiles, created);
  return created;
}
