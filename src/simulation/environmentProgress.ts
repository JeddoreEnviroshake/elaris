import { AREA_TIERS, type AreaTier, type EnvironmentKind, type PlaceableDefinition } from '../config/areaGates';
import { WORLD_TILES } from '../config/platform';
import type { BuildingState, GameState } from './state';

/** Derived geometry supplied by the future grid/enclosure system. */
export interface EnvironmentMeasurement {
  kind: EnvironmentKind;
  /** Number of four-way-connected player-created surface cells. */
  area: number;
  /** Side length of the largest completely filled axis-aligned square. */
  largestFilledCore: number;
  /** All perimeter edges are correctly closed for this environment kind. */
  enclosed: boolean;
}

export interface AreaGateResult {
  tier: AreaTier | 0;
  nextTier: (typeof AREA_TIERS)[number] | null;
}

export interface PlaceableGateResult {
  ok: boolean;
  reason?: string;
}

/** Measures the wall-bounded four-way region containing one tile. */
export function measureEnvironment(
  buildings: readonly BuildingState[],
  tileX: number,
  tileY: number,
  kind: EnvironmentKind = 'indoor',
): EnvironmentMeasurement {
  const walls = new Set(
    buildings
      .filter((building) => building.definitionId === 'palisade-wall')
      .map((building) => `${building.tileX},${building.tileY}`),
  );
  if (!inBounds(tileX, tileY) || walls.has(`${tileX},${tileY}`)) {
    return { kind, area: 0, largestFilledCore: 0, enclosed: false };
  }

  const cells = new Set<string>();
  const queue: Array<readonly [number, number]> = [[tileX, tileY]];
  let enclosed = true;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const [x, y] = queue[cursor]!;
    const key = `${x},${y}`;
    if (cells.has(key) || walls.has(key)) continue;
    cells.add(key);
    if (x === 0 || y === 0 || x === WORLD_TILES - 1 || y === WORLD_TILES - 1) enclosed = false;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (inBounds(nx, ny) && !cells.has(`${nx},${ny}`) && !walls.has(`${nx},${ny}`)) queue.push([nx, ny]);
    }
  }
  return {
    kind,
    area: enclosed ? cells.size : 0,
    largestFilledCore: enclosed ? largestFilledSquare(cells) : 0,
    enclosed,
  };
}

/** Deterministically returns every enclosed region, ordered by its first row-major tile. */
export function measureEnclosedAreas(buildings: readonly BuildingState[]): EnvironmentMeasurement[] {
  const walls = new Set(buildings.filter((b) => b.definitionId === 'palisade-wall').map((b) => `${b.tileX},${b.tileY}`));
  const visited = new Set<string>();
  const result: EnvironmentMeasurement[] = [];
  for (let y = 0; y < WORLD_TILES; y += 1) for (let x = 0; x < WORLD_TILES; x += 1) {
    const key = `${x},${y}`;
    if (walls.has(key) || visited.has(key)) continue;
    const measurement = measureEnvironment(buildings, x, y);
    const queue: Array<readonly [number, number]> = [[x, y]];
    for (let i = 0; i < queue.length; i += 1) {
      const [cx, cy] = queue[i]!; const cellKey = `${cx},${cy}`;
      if (visited.has(cellKey) || walls.has(cellKey)) continue;
      visited.add(cellKey);
      for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]] as const)
        if (inBounds(nx, ny)) queue.push([nx, ny]);
    }
    if (measurement.enclosed) result.push(measurement);
  }
  return result;
}

function inBounds(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < WORLD_TILES && y < WORLD_TILES;
}

function largestFilledSquare(cells: ReadonlySet<string>): number {
  const dp = new Map<string, number>();
  let largest = 0;
  for (let y = 0; y < WORLD_TILES; y += 1) for (let x = 0; x < WORLD_TILES; x += 1) {
    const key = `${x},${y}`;
    if (!cells.has(key)) continue;
    const side = 1 + Math.min(dp.get(`${x - 1},${y}`) ?? 0, dp.get(`${x},${y - 1}`) ?? 0, dp.get(`${x - 1},${y - 1}`) ?? 0);
    dp.set(key, side);
    largest = Math.max(largest, side);
  }
  return largest;
}

/** Returns the highest currently valid tier. Invalid/unclosed regions have no tier. */
export function evaluateAreaGate(measurement: EnvironmentMeasurement): AreaGateResult {
  if (!measurement.enclosed) return { tier: 0, nextTier: AREA_TIERS[0] };

  let tier: AreaTier | 0 = 0;
  for (const candidate of AREA_TIERS) {
    if (measurement.area < candidate.area || measurement.largestFilledCore < candidate.filledCore) break;
    tier = candidate.area;
  }
  const nextTier = AREA_TIERS.find((candidate) => candidate.area > tier) ?? null;
  return { tier, nextTier };
}

/** Sticky unlock ownership: shrinking or opening a space never removes earned tiers. */
export function recordHighestAreaTier(state: GameState, measurement: EnvironmentMeasurement): AreaTier | 0 {
  const { tier } = evaluateAreaGate(measurement);
  if (tier > state.highestAreaTierEver) state.highestAreaTierEver = tier;
  return tier;
}

/** Pure placement gate for the HUD preview and the eventual placement command. */
export function evaluatePlaceableGate(
  definition: PlaceableDefinition,
  measurement: EnvironmentMeasurement,
): PlaceableGateResult {
  const currentTier = evaluateAreaGate(measurement).tier;
  if (currentTier < definition.minEnvironmentArea) {
    return {
      ok: false,
      reason: `Needs ${definition.minEnvironmentArea}-tile area; current valid area is ${measurement.area}`,
    };
  }
  if ('environmentKind' in definition && definition.environmentKind !== measurement.kind) {
    return { ok: false, reason: `Requires a ${definition.environmentKind} environment` };
  }
  return { ok: true };
}
