import { TILE_SIZE } from '../config/platform';

export interface TownPerimeterPoint {
  readonly x: number;
  readonly y: number;
}

export interface TownPerimeterSegment {
  readonly start: TownPerimeterPoint;
  readonly end: TownPerimeterPoint;
  readonly kind: 'fence' | 'gate';
}

/** The authored perimeter requested for Elaris, in tile-grid coordinates. */
export const TOWN_PERIMETER_POINTS: readonly TownPerimeterPoint[] = [
  { x: 61, y: 70 },
  { x: 110, y: 70 },
  { x: 110, y: 92 },
  { x: 87, y: 92 },
  { x: 87, y: 103 },
  { x: 63, y: 103 },
] as const;

/** Municipal purifiers; these are scenery, and they go cold when Elaris falls. */
export const TOWN_AIR_PURIFIERS: readonly TownPerimeterPoint[] = [
  { x: 70, y: 87 },
  { x: 98, y: 87 },
] as const;

/**
 * The one purifier that never goes cold. The municipal pair above is part of the
 * town's protection and dies with it, which leaves a high-level character caught
 * outdoors on a fog night with nothing to run to but their own build. This
 * column keeps breathing whether Elaris stands or lies in ruins, so there is
 * always one fixed point on the map that saves someone who is simply roaming.
 *
 * It sits beside the sanctuary waystone at (70, 90) deliberately: a player who
 * respawns there lands inside its air rather than back in the fog.
 */
export const PERMANENT_AIR_PURIFIER: TownPerimeterPoint = { x: 69, y: 90 } as const;

/**
 * Reach of the permanent purifier, in tiles from its own tile. Wider than a
 * player-built outdoor purifier's single tile because this one is a landmark to
 * run *to* — a 7x7 patch is findable at a sprint, while a 3x3 one would only
 * save a player already standing on it.
 */
export const PERMANENT_PURIFIER_RADIUS_TILES = 3;

/** True on the ground the permanent purifier keeps breathable. */
export function isWithinPermanentPurifierWorldPosition(worldX: number, worldY: number): boolean {
  const tileX = Math.floor(worldX / TILE_SIZE);
  const tileY = Math.floor(worldY / TILE_SIZE);
  return Math.abs(tileX - PERMANENT_AIR_PURIFIER.x) <= PERMANENT_PURIFIER_RADIUS_TILES
    && Math.abs(tileY - PERMANENT_AIR_PURIFIER.y) <= PERMANENT_PURIFIER_RADIUS_TILES;
}

const WEST_GATE_TOP = { x: 62, y: 82.5 } as const;
const WEST_GATE_BOTTOM = { x: 62, y: 84.5 } as const;
const NORTH_GATE_LEFT = { x: 103.5, y: 70 } as const;
const NORTH_GATE_RIGHT = { x: 105.5, y: 70 } as const;
const EAST_GATE_TOP = { x: 110, y: 84 } as const;
const EAST_GATE_BOTTOM = { x: 110, y: 86 } as const;

/**
 * The closing western run passes through the requested gate coordinates. This
 * preserves the slightly tapered perimeter while giving the gate exact,
 * walkable endpoints instead of approximating them onto the diagonal.
 */
const TOWN_PERIMETER_ROUTE: readonly TownPerimeterPoint[] = [
  TOWN_PERIMETER_POINTS[0]!,
  NORTH_GATE_LEFT,
  NORTH_GATE_RIGHT,
  TOWN_PERIMETER_POINTS[1]!,
  EAST_GATE_TOP,
  EAST_GATE_BOTTOM,
  TOWN_PERIMETER_POINTS[2]!,
  TOWN_PERIMETER_POINTS[3]!,
  TOWN_PERIMETER_POINTS[4]!,
  TOWN_PERIMETER_POINTS[5]!,
  WEST_GATE_BOTTOM,
  WEST_GATE_TOP,
  TOWN_PERIMETER_POINTS[0]!,
] as const;

function samePoint(a: TownPerimeterPoint, b: TownPerimeterPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function isGate(start: TownPerimeterPoint, end: TownPerimeterPoint): boolean {
  return (samePoint(start, NORTH_GATE_LEFT) && samePoint(end, NORTH_GATE_RIGHT))
    || (samePoint(start, NORTH_GATE_RIGHT) && samePoint(end, NORTH_GATE_LEFT))
    || (samePoint(start, EAST_GATE_TOP) && samePoint(end, EAST_GATE_BOTTOM))
    || (samePoint(start, EAST_GATE_BOTTOM) && samePoint(end, EAST_GATE_TOP))
    || (samePoint(start, WEST_GATE_TOP) && samePoint(end, WEST_GATE_BOTTOM))
    || (samePoint(start, WEST_GATE_BOTTOM) && samePoint(end, WEST_GATE_TOP));
}

function subdivide(start: TownPerimeterPoint, end: TownPerimeterPoint): TownPerimeterSegment[] {
  const kind = isGate(start, end) ? 'gate' : 'fence';
  // Municipal fences use the same two-grid-space footprint as player-built
  // fences. The old one-space subdivision placed a full two-space model at
  // every point, so adjacent models occupied the same half-space. Gates have
  // two-space openings; a final short fence is only needed
  // where an odd-length run meets a corner or gate.
  const run = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
  const count = kind === 'gate' ? 1 : Math.max(1, Math.ceil(run / 2));
  return Array.from({ length: count }, (_, index) => ({
    start: {
      x: start.x + (end.x - start.x) * Math.min(index * 2, run) / run,
      y: start.y + (end.y - start.y) * Math.min(index * 2, run) / run,
    },
    end: {
      x: start.x + (end.x - start.x) * Math.min((index + 1) * 2, run) / run,
      y: start.y + (end.y - start.y) * Math.min((index + 1) * 2, run) / run,
    },
    kind,
  }));
}

/** Two-space fence pieces and Elaris's traversable gates. */
export const TOWN_PERIMETER_SEGMENTS: readonly TownPerimeterSegment[] = TOWN_PERIMETER_ROUTE
  .slice(0, -1)
  .flatMap((point, index) => subdivide(point, TOWN_PERIMETER_ROUTE[index + 1]!));

/** True for the protected ground inside (or exactly on) the Elaris perimeter. */
export function isWithinTownSafeZoneWorldPosition(worldX: number, worldY: number): boolean {
  const point = { x: worldX / TILE_SIZE, y: worldY / TILE_SIZE };
  for (const segment of TOWN_PERIMETER_SEGMENTS) {
    if (pointOnSegment(point, segment.start, segment.end)) return true;
  }

  let inside = false;
  for (let index = 0, previous = TOWN_PERIMETER_ROUTE.length - 2; index < TOWN_PERIMETER_ROUTE.length - 1; previous = index, index += 1) {
    const a = TOWN_PERIMETER_ROUTE[index]!;
    const b = TOWN_PERIMETER_ROUTE[previous]!;
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** True when a cardinal player step crosses an indestructible fence piece. */
export function townFenceBlocksWorldMove(
  currentWorldX: number,
  currentWorldY: number,
  nextWorldX: number,
  nextWorldY: number,
): boolean {
  const start = { x: currentWorldX / TILE_SIZE, y: currentWorldY / TILE_SIZE };
  const end = { x: nextWorldX / TILE_SIZE, y: nextWorldY / TILE_SIZE };
  // Player movement keeps its original grid offset. Characters aligned to an
  // integer grid line therefore cross at a gate endpoint, where the gate and
  // its neighboring fence share a vertex. The opening must win that junction,
  // just as player-built gates override an adjoining fence collision.
  if (TOWN_PERIMETER_SEGMENTS.some((segment) =>
    segment.kind === 'gate' && segmentsCross(start, end, segment.start, segment.end))) return false;
  return TOWN_PERIMETER_SEGMENTS.some((segment) =>
    segment.kind === 'fence' && segmentsCross(start, end, segment.start, segment.end));
}

function pointOnSegment(point: TownPerimeterPoint, start: TownPerimeterPoint, end: TownPerimeterPoint): boolean {
  const cross = (point.x - start.x) * (end.y - start.y) - (point.y - start.y) * (end.x - start.x);
  if (Math.abs(cross) > 1e-7) return false;
  return point.x >= Math.min(start.x, end.x) - 1e-7 && point.x <= Math.max(start.x, end.x) + 1e-7
    && point.y >= Math.min(start.y, end.y) - 1e-7 && point.y <= Math.max(start.y, end.y) + 1e-7;
}

function segmentsCross(
  moveStart: TownPerimeterPoint,
  moveEnd: TownPerimeterPoint,
  fenceStart: TownPerimeterPoint,
  fenceEnd: TownPerimeterPoint,
): boolean {
  const moveX = moveEnd.x - moveStart.x;
  const moveY = moveEnd.y - moveStart.y;
  const fenceX = fenceEnd.x - fenceStart.x;
  const fenceY = fenceEnd.y - fenceStart.y;
  const denominator = moveX * fenceY - moveY * fenceX;
  // Moving along a fence is allowed; only crossing from one side to the other
  // is collision. Cardinal movement never begins on this authored perimeter.
  if (Math.abs(denominator) < 1e-9) return false;
  const offsetX = fenceStart.x - moveStart.x;
  const offsetY = fenceStart.y - moveStart.y;
  const moveT = (offsetX * fenceY - offsetY * fenceX) / denominator;
  const fenceT = (offsetX * moveY - offsetY * moveX) / denominator;
  return moveT > 1e-7 && moveT <= 1 + 1e-7 && fenceT >= -1e-7 && fenceT <= 1 + 1e-7;
}
