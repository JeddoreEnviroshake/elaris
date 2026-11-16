import { TOWN_PERIMETER_SEGMENTS, type TownPerimeterPoint } from './townDefences';

/** Authored water feature in the north-west of Elaris. */
export const ELARIS_WATER_TEMPLE = {
  tileX: 24,
  tileY: 24,
  lakeRadiusX: 21,
  lakeRadiusY: 18,
  islandRadiusX: 7,
  islandRadiusY: 5.5,
} as const;

/** The moat is deliberately broad enough to read from the mini map. */
export const ELARIS_MOAT_WIDTH_TILES = 3.25;

export type ElarisAuthoredWaterKind = 'shallow-water' | 'deep-water' | 'bridge';

/**
 * Elaris-only water authored over the procedural landscape. Tile centers are
 * sampled so this single mask can own movement, both renderers, and the maps.
 */
export function elarisAuthoredWaterAt(tileX: number, tileY: number): ElarisAuthoredWaterKind | null {
  const water = elarisUnderlyingWaterAt(tileX, tileY);
  return water && isGateCauseway({ x: tileX + .5, y: tileY + .5 }) ? 'bridge' : water;
}

/** Water beneath causeways, without any bridge or road overlay. */
export function elarisUnderlyingWaterAt(tileX: number, tileY: number): Exclude<ElarisAuthoredWaterKind, 'bridge'> | null {
  const point = { x: tileX + 0.5, y: tileY + 0.5 };
  const templeWater = waterTempleLakeAt(point);
  if (templeWater) return templeWater;

  if (isInsideTownPerimeter(point)) return null;
  const moatDistance = minimumPerimeterDistance(point);
  if (moatDistance > ELARIS_MOAT_WIDTH_TILES) return null;

  return moatDistance < 2.2 ? 'deep-water' : 'shallow-water';
}

/** Keep generated resources and creatures away from the temple platform. */
export function isElarisWaterTempleReservedTile(tileX: number, tileY: number): boolean {
  const dx = (tileX + 0.5 - (ELARIS_WATER_TEMPLE.tileX + 0.5)) / (ELARIS_WATER_TEMPLE.islandRadiusX + 1);
  const dy = (tileY + 0.5 - (ELARIS_WATER_TEMPLE.tileY + 0.5)) / (ELARIS_WATER_TEMPLE.islandRadiusY + 1);
  return dx * dx + dy * dy <= 1;
}

/** Generated scenery may not overlap either authored body of water or the shrine island. */
export function isElarisWaterSceneryReservedTile(tileX: number, tileY: number): boolean {
  return elarisAuthoredWaterAt(tileX, tileY) !== null || isElarisWaterTempleReservedTile(tileX, tileY);
}

function waterTempleLakeAt(point: TownPerimeterPoint): Exclude<ElarisAuthoredWaterKind, 'bridge'> | null {
  const centerX = ELARIS_WATER_TEMPLE.tileX + 0.5;
  const centerY = ELARIS_WATER_TEMPLE.tileY + 0.5;
  const islandDistance = Math.hypot(
    (point.x - centerX) / ELARIS_WATER_TEMPLE.islandRadiusX,
    (point.y - centerY) / ELARIS_WATER_TEMPLE.islandRadiusY,
  );
  if (islandDistance <= 1) return null;

  const lakeDistance = Math.hypot(
    (point.x - centerX) / ELARIS_WATER_TEMPLE.lakeRadiusX,
    (point.y - centerY) / ELARIS_WATER_TEMPLE.lakeRadiusY,
  );
  if (lakeDistance > 1) return null;
  return lakeDistance > 0.86 || islandDistance < 1.32 ? 'shallow-water' : 'deep-water';
}

function isGateCauseway(point: TownPerimeterPoint): boolean {
  const northCauseway = point.x >= 103.5 && point.x <= 105.5 && point.y >= 65.5 && point.y <= 70;
  // The west crossing is a full rectangle owned by terrainAt (see
  // isElarisWestCrossingTile), because it also spans the procedural river.
  return northCauseway;
}

function minimumPerimeterDistance(point: TownPerimeterPoint): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const segment of TOWN_PERIMETER_SEGMENTS) {
    minimum = Math.min(minimum, pointToSegmentDistance(point, segment.start, segment.end));
  }
  return minimum;
}

function pointToSegmentDistance(
  point: TownPerimeterPoint,
  start: TownPerimeterPoint,
  end: TownPerimeterPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}

function isInsideTownPerimeter(point: TownPerimeterPoint): boolean {
  let inside = false;
  const segments = TOWN_PERIMETER_SEGMENTS;
  for (let index = 0, previous = segments.length - 1; index < segments.length; previous = index, index += 1) {
    const a = segments[index]!.start;
    const b = segments[previous]!.start;
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}
