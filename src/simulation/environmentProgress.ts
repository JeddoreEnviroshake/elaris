import { AREA_TIERS, type AreaTier, type PlaceableDefinition } from '../config/areaGates';
import { CLOSING_CLASSES, buildableById, type BoundaryClass, type SurfaceKind } from '../content/buildingParts';
import type { BoundaryEdge, BuildingState, EnvironmentKind, GameState } from './state';
import { boundarySegmentAnchors, boundarySpan, effectiveBoundaryEdge } from './buildingGeometry';

/** A connected, player-created usable region. Natural terrain never counts. */
export interface EnvironmentInfo {
  /** Legacy markers keep their stable ID; unmarked regions use a deterministic ID. */
  id: string;
  kind: EnvironmentKind;
  cells: ReadonlySet<string>;
  area: number;
  largestFilledCore: number;
  enclosed: boolean;
  markerCount: number;
  valid: boolean;
  tier: AreaTier | 0;
}

export interface EnclosureGap {
  tileX: number;
  tileY: number;
  edge: BoundaryEdge;
  surfaceKind: SurfaceKind;
  reason: 'missing' | 'wrong-boundary';
}

export interface AreaGateResult {
  tier: AreaTier | 0;
  nextTier: (typeof AREA_TIERS)[number] | null;
}

export interface PlaceableGateResult { ok: boolean; reason?: string }

function requiredSurfaceReason(requiredSurface: SurfaceKind): string {
  return `Place it on ${requiredSurface === 'floor' ? 'a floor' : 'prepared ground'}`;
}

/** Pure footprint check shared by placement, operation, and proximity queries. */
export function evaluateRequiredSurfaceGate(
  buildings: readonly BuildingState[], requiredSurface: SurfaceKind,
  tileX: number, tileY: number, tilesWide: number, tilesHigh: number,
): PlaceableGateResult {
  const occupancy = buildOccupancy(buildings);
  for (let dy = 0; dy < tilesHigh; dy += 1) for (let dx = 0; dx < tilesWide; dx += 1) {
    if (surfaceKindAt(occupancy, tileX + dx, tileY + dy) !== requiredSurface) {
      return { ok: false, reason: requiredSurfaceReason(requiredSurface) };
    }
  }
  return { ok: true };
}

export interface EnvironmentMeasurement {
  kind: EnvironmentKind;
  area: number;
  largestFilledCore: number;
  enclosed: boolean;
  valid?: boolean;
}

export interface Occupancy {
  surfaces: Map<string, BuildingState>;
  /** Canonical shared-edge key -> boundary. */
  boundaries: Map<string, BuildingState>;
  markers: BuildingState[];
  facilities: BuildingState[];
}

export function cellKey(tileX: number, tileY: number): string { return `${tileX},${tileY}`; }

/**
 * Canonical shared-edge identity. A cell's east edge is its neighbour's west
 * edge, and likewise south/north, so duplicate boundaries are impossible.
 */
export function boundaryEdgeKey(tileX: number, tileY: number, edge: BoundaryEdge): string {
  switch (edge) {
    case 'north': return `h:${tileX},${tileY}`;
    case 'south': return `h:${tileX},${tileY + 1}`;
    case 'west': return `v:${tileX},${tileY}`;
    case 'east': return `v:${tileX + 1},${tileY}`;
  }
}

export function buildOccupancy(buildings: readonly BuildingState[]): Occupancy {
  const occupancy: Occupancy = { surfaces: new Map(), boundaries: new Map(), markers: [], facilities: [] };
  for (const building of buildings) {
    const definition = buildableById(building.definitionId);
    if (definition.layer === 'surface') occupancy.surfaces.set(cellKey(building.tileX, building.tileY), building);
    else if (definition.layer === 'boundary') {
      const edge = effectiveBoundaryEdge(building);
      for (const segment of boundarySegmentAnchors(building.tileX, building.tileY, edge, boundarySpan(definition))) {
        occupancy.boundaries.set(boundaryEdgeKey(segment.tileX, segment.tileY, segment.edge), building);
      }
    } else if (definition.footprintKind === 'marker') occupancy.markers.push(building);
    else if (definition.footprintKind === 'facility') occupancy.facilities.push(building);
  }
  return occupancy;
}

function surfaceKindAt(occupancy: Occupancy, tileX: number, tileY: number): SurfaceKind | null {
  const surface = occupancy.surfaces.get(cellKey(tileX, tileY));
  return surface ? buildableById(surface.definitionId).surfaceKind ?? null : null;
}

function expectedSurface(kind: EnvironmentKind): SurfaceKind { return kind === 'indoor' ? 'floor' : 'ground'; }

const STEPS: ReadonlyArray<{ dx: number; dy: number; edge: BoundaryEdge }> = [
  { dx: 0, dy: -1, edge: 'north' },
  { dx: -1, dy: 0, edge: 'west' },
  { dx: 1, dy: 0, edge: 'east' },
  { dx: 0, dy: 1, edge: 'south' },
];

function boundaryAt(occupancy: Occupancy, tileX: number, tileY: number, edge: BoundaryEdge): BuildingState | undefined {
  return occupancy.boundaries.get(boundaryEdgeKey(tileX, tileY, edge));
}

/** Flood matching surfaces, stopping at every logical boundary including open doors/gates. */
export function floodSurfaceRegion(
  occupancy: Occupancy,
  tileX: number,
  tileY: number,
  requiredKind: SurfaceKind | null = null,
): { cells: Set<string>; kind: SurfaceKind } | null {
  const kind = surfaceKindAt(occupancy, tileX, tileY);
  if (!kind || (requiredKind && kind !== requiredKind)) return null;
  const cells = new Set<string>([cellKey(tileX, tileY)]);
  const queue: Array<readonly [number, number]> = [[tileX, tileY]];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const [x, y] = queue[cursor]!;
    for (const { dx, dy, edge } of STEPS) {
      if (boundaryAt(occupancy, x, y, edge)) continue;
      const key = cellKey(x + dx, y + dy);
      if (cells.has(key) || surfaceKindAt(occupancy, x + dx, y + dy) !== kind) continue;
      cells.add(key);
      queue.push([x + dx, y + dy]);
    }
  }
  return { cells, kind };
}

function markerKind(marker: BuildingState, occupancy: Occupancy): EnvironmentKind {
  if (marker.environmentKind) return marker.environmentKind;
  return surfaceKindAt(occupancy, marker.tileX, marker.tileY) === 'floor' ? 'indoor' : 'workYard';
}

function environmentForSurface(
  occupancy: Occupancy,
  tileX: number,
  tileY: number,
): EnvironmentInfo | null {
  const region = floodSurfaceRegion(occupancy, tileX, tileY);
  if (!region) return null;
  const regionMarkers = occupancy.markers.filter((candidate) =>
    region.cells.has(cellKey(candidate.tileX, candidate.tileY)),
  );
  const marker = regionMarkers.length === 1 ? regionMarkers[0] : undefined;
  const inferredKind: EnvironmentKind = region.kind === 'floor' ? 'indoor' : 'workYard';
  const kind = marker ? markerKind(marker, occupancy) : inferredKind;
  const closing = CLOSING_CLASSES[region.kind];
  let enclosed = true;
  for (const key of region.cells) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    for (const { dx, dy, edge } of STEPS) {
      if (region.cells.has(cellKey(x + dx, y + dy))) continue;
      const boundary = boundaryAt(occupancy, x, y, edge);
      const boundaryClass = boundary ? buildableById(boundary.definitionId).boundaryClass : undefined;
      if (!boundaryClass || !closing.includes(boundaryClass as BoundaryClass)) { enclosed = false; break; }
    }
    if (!enclosed) break;
  }
  const markerCount = regionMarkers.length;
  const valid = enclosed && markerCount <= 1 && expectedSurface(kind) === region.kind;
  const largestFilledCore = valid ? largestFilledSquare(region.cells) : 0;
  const { tier } = evaluateAreaGate({ area: region.cells.size, largestFilledCore, valid });
  const firstCell = [...region.cells].sort()[0]!;
  return {
    id: marker?.id ?? `environment:${region.kind}:${firstCell}`,
    kind, cells: region.cells, area: region.cells.size,
    largestFilledCore, enclosed, markerCount, valid, tier: valid ? tier : 0,
  };
}

/** Compatibility helper for callers inspecting a marker from an older save. */
export function environmentForMarker(occupancy: Occupancy, marker: BuildingState): EnvironmentInfo | null {
  return environmentForSurface(occupancy, marker.tileX, marker.tileY);
}

export function environments(buildings: readonly BuildingState[]): EnvironmentInfo[] {
  const occupancy = buildOccupancy(buildings);
  const visited = new Set<string>();
  const result: EnvironmentInfo[] = [];
  const surfaceCells = [...occupancy.surfaces.keys()].sort();
  for (const key of surfaceCells) {
    if (visited.has(key)) continue;
    const [tileX, tileY] = key.split(',').map(Number) as [number, number];
    const environment = environmentForSurface(occupancy, tileX, tileY);
    if (!environment) continue;
    for (const cell of environment.cells) visited.add(cell);
    result.push(environment);
  }
  return result;
}

/**
 * Every edge that the authoritative enclosure validator still considers open.
 * This deliberately derives from the same flooded regions and closing-class
 * rules as `environments`, so the build overlay cannot disagree with quests.
 */
export function enclosureGaps(buildings: readonly BuildingState[]): EnclosureGap[] {
  const occupancy = buildOccupancy(buildings);
  const seen = new Set<string>();
  const result: EnclosureGap[] = [];
  for (const environment of environments(buildings)) {
    for (const key of environment.cells) {
      const [x, y] = key.split(',').map(Number) as [number, number];
      const surfaceKind = surfaceKindAt(occupancy, x, y);
      if (!surfaceKind) continue;
      const closing = CLOSING_CLASSES[surfaceKind];
      for (const { dx, dy, edge } of STEPS) {
        if (environment.cells.has(cellKey(x + dx, y + dy))) continue;
        const canonicalKey = boundaryEdgeKey(x, y, edge);
        if (seen.has(canonicalKey)) continue;
        seen.add(canonicalKey);
        const boundary = boundaryAt(occupancy, x, y, edge);
        const boundaryClass = boundary ? buildableById(boundary.definitionId).boundaryClass : undefined;
        if (boundaryClass && closing.includes(boundaryClass as BoundaryClass)) continue;
        result.push({
          tileX: x,
          tileY: y,
          edge,
          surfaceKind,
          reason: boundary ? 'wrong-boundary' : 'missing',
        });
      }
    }
  }
  return result;
}

export function environmentAt(buildings: readonly BuildingState[], tileX: number, tileY: number): EnvironmentInfo | null {
  const key = cellKey(tileX, tileY);
  return environments(buildings).find((environment) => environment.cells.has(key)) ?? null;
}

export function largestFilledSquare(cells: ReadonlySet<string>): number {
  if (cells.size === 0) return 0;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const key of cells) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const dp = new Map<string, number>(); let largest = 0;
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    const key = cellKey(x, y); if (!cells.has(key)) continue;
    const side = 1 + Math.min(dp.get(cellKey(x - 1, y)) ?? 0, dp.get(cellKey(x, y - 1)) ?? 0, dp.get(cellKey(x - 1, y - 1)) ?? 0);
    dp.set(key, side); largest = Math.max(largest, side);
  }
  return largest;
}

export function evaluateAreaGate(measurement: { area: number; largestFilledCore: number; valid?: boolean; enclosed?: boolean }): AreaGateResult {
  const valid = measurement.valid ?? measurement.enclosed ?? false;
  if (!valid) return { tier: 0, nextTier: AREA_TIERS[0] };
  let tier: AreaTier | 0 = 0;
  for (const candidate of AREA_TIERS) {
    if (measurement.area < candidate.area || measurement.largestFilledCore < candidate.filledCore) break;
    tier = candidate.area;
  }
  return { tier, nextTier: AREA_TIERS.find((candidate) => candidate.area > tier) ?? null };
}

export function recordHighestAreaTier(state: GameState): AreaTier | 0 {
  let highestCurrent: AreaTier | 0 = 0;
  for (const environment of environments(state.buildings)) if (environment.tier > highestCurrent) highestCurrent = environment.tier;
  if (highestCurrent > state.highestAreaTierEver) state.highestAreaTierEver = highestCurrent;
  return highestCurrent;
}

/** Pure gate retained for menus/tests; current geometry is supplied by the caller. */
export function evaluatePlaceableGate(placeable: PlaceableDefinition, environment: EnvironmentMeasurement): PlaceableGateResult {
  const valid = environment.valid ?? environment.enclosed;
  if (!valid) return { ok: false, reason: 'Environment is not valid and enclosed' };
  if (placeable.environmentKind && placeable.environmentKind !== environment.kind) {
    return { ok: false, reason: `Requires ${placeable.environmentKind === 'indoor' ? 'an indoor room (floors)' : placeable.environmentKind === 'paddock' ? 'a paddock (prepared ground)' : 'a work yard (prepared ground)'}` };
  }
  if (placeable.minEnvironmentArea !== undefined) {
    const required = AREA_TIERS.find((candidate) => candidate.area === placeable.minEnvironmentArea)!;
    if (environment.area < required.area) return { ok: false, reason: `Needs ${required.area}-tile area; current valid area is ${environment.area}` };
    if (environment.largestFilledCore < required.filledCore) return { ok: false, reason: `${required.label} needs a solid ${required.filledCore}x${required.filledCore} core` };
  }
  return { ok: true };
}

export function evaluateFacilityGate(
  buildings: readonly BuildingState[], placeable: PlaceableDefinition,
  tileX: number, tileY: number, tilesWide: number, tilesHigh: number,
): PlaceableGateResult {
  const occupancy = buildOccupancy(buildings);
  if (placeable.requiredSurface) {
    const surfaceGate = evaluateRequiredSurfaceGate(
      buildings, placeable.requiredSurface, tileX, tileY, tilesWide, tilesHigh,
    );
    if (!surfaceGate.ok) return surfaceGate;
  }
  for (let dy = 0; dy < tilesHigh; dy += 1) for (let dx = 0; dx < tilesWide; dx += 1) {
    if (!surfaceKindAt(occupancy, tileX + dx, tileY + dy)) return { ok: false, reason: 'Needs player-built floor or ground beneath every tile' };
  }
  if (!placeable.environmentKind && placeable.minEnvironmentArea === undefined) return { ok: true };
  const environment = environmentAt(buildings, tileX, tileY);
  if (!environment) return { ok: false, reason: 'The footprint must sit on one connected player-built surface' };
  for (let dy = 0; dy < tilesHigh; dy += 1) for (let dx = 0; dx < tilesWide; dx += 1) {
    if (!environment.cells.has(cellKey(tileX + dx, tileY + dy))) return { ok: false, reason: 'The whole footprint must sit in one environment' };
  }
  if (!environment.enclosed) return { ok: false, reason: `Enclose the space fully with ${environment.kind === 'indoor' ? 'walls and doors' : 'fences and gates'}` };
  if (!environment.valid) return { ok: false, reason: 'This space is not a valid enclosed environment' };
  return evaluatePlaceableGate(placeable, environment);
}

export function surfaceMergeConflict(buildings: readonly BuildingState[], surfaceKind: SurfaceKind, tileX: number, tileY: number): boolean {
  const occupancy = buildOccupancy(buildings); const markerIds = new Set<string>();
  for (const { dx, dy, edge } of STEPS) {
    if (boundaryAt(occupancy, tileX, tileY, edge) || surfaceKindAt(occupancy, tileX + dx, tileY + dy) !== surfaceKind) continue;
    const region = floodSurfaceRegion(occupancy, tileX + dx, tileY + dy, surfaceKind); if (!region) continue;
    for (const marker of occupancy.markers) if (region.cells.has(cellKey(marker.tileX, marker.tileY))) markerIds.add(marker.id);
  }
  return markerIds.size >= 2;
}

export function markerPlacementGate(
  buildings: readonly BuildingState[], tileX: number, tileY: number, kind: EnvironmentKind,
): PlaceableGateResult {
  const occupancy = buildOccupancy(buildings);
  const region = floodSurfaceRegion(occupancy, tileX, tileY, expectedSurface(kind));
  if (!region) return { ok: false, reason: `Place the marker on player-built ${kind === 'indoor' ? 'floor' : 'prepared ground'}` };
  for (const marker of occupancy.markers) if (region.cells.has(cellKey(marker.tileX, marker.tileY))) return { ok: false, reason: 'This space already has an Environment Marker' };
  return { ok: true };
}

/** Removing this edge would join two independently marked surface regions. */
export function boundaryRemovalMergeConflict(buildings: readonly BuildingState[], boundary: BuildingState): boolean {
  const without = buildings.filter((candidate) => candidate.id !== boundary.id);
  const occupancy = buildOccupancy(without);
  const edge = effectiveBoundaryEdge(boundary);
  const definition = buildableById(boundary.definitionId);
  for (const segment of boundarySegmentAnchors(boundary.tileX, boundary.tileY, edge, boundarySpan(definition))) {
    const sides: Array<readonly [number, number]> = edge === 'north'
      ? [[segment.tileX, segment.tileY], [segment.tileX, segment.tileY - 1]]
      : edge === 'south'
        ? [[segment.tileX, segment.tileY], [segment.tileX, segment.tileY + 1]]
        : edge === 'west'
          ? [[segment.tileX, segment.tileY], [segment.tileX - 1, segment.tileY]]
          : [[segment.tileX, segment.tileY], [segment.tileX + 1, segment.tileY]];
    const [a, b] = sides;
    const kindA = surfaceKindAt(occupancy, a![0], a![1]); const kindB = surfaceKindAt(occupancy, b![0], b![1]);
    if (!kindA || kindA !== kindB) continue;
    const region = floodSurfaceRegion(occupancy, a![0], a![1], kindA); if (!region) continue;
    if (occupancy.markers.filter((marker) => region.cells.has(cellKey(marker.tileX, marker.tileY))).length > 1) return true;
  }
  return false;
}
