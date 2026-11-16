import { TILE_SIZE } from '../config/platform';
import { buildableById } from '../content/buildingParts';
import type { BuildingState } from './state';
import { boundaryEdgeKey, buildOccupancy, type Occupancy } from './environmentProgress';
import { effectiveBoundaryEdge } from './buildingGeometry';

type CardinalComponent = -1 | 0 | 1;

/**
 * Whether a single-axis step of the player's centre crosses a solid
 * player-built boundary. Free movement advances one whole pixel at a time, so
 * a step crosses at most one grid line and can never tunnel through a wall at
 * any speed. Walls and fences are solid from both sides; doors and gates
 * deliberately share the enclosure edge without blocking movement.
 *
 * `occupancy` may be passed in so a tick that steps many pixels builds it once.
 */
export function isBuildingBoundaryStepBlocked(
  buildings: readonly BuildingState[],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  occupancy: Occupancy = buildOccupancy(buildings),
): boolean {
  const horizontal = toX !== fromX;
  if (horizontal === (toY !== fromY)) return false;
  const fromTile = Math.floor((horizontal ? fromX : fromY) / TILE_SIZE);
  const toTile = Math.floor((horizontal ? toX : toY) / TILE_SIZE);
  if (fromTile !== toTile) {
    const forward = (horizontal ? toX - fromX : toY - fromY) > 0;
    const edge = horizontal ? (forward ? 'east' : 'west') : (forward ? 'south' : 'north');
    const perpendicular = horizontal ? fromY : fromX;
    const perpendicularTile = Math.floor(perpendicular / TILE_SIZE);
    const keyFor = (tile: number) => horizontal
      ? boundaryEdgeKey(fromTile, tile, edge)
      : boundaryEdgeKey(tile, fromTile, edge);
    const keys = [keyFor(perpendicularTile)];
    // A centre exactly on a grid line crosses the seam shared by two
    // neighbouring wall sprites, so either segment must participate in
    // collision instead of leaving a one-point side gap.
    if (perpendicular % TILE_SIZE === 0) keys.push(keyFor(perpendicularTile - 1));
    const classes = keys
      .map((key) => occupancy.boundaries.get(key))
      .filter((boundary): boundary is BuildingState => boundary !== undefined)
      .map((boundary) => buildableById(boundary.definitionId).boundaryClass);
    // A door/gate at a junction owns the opening; an adjoining wall must not
    // make the entrance unusable merely because the player is on their seam.
    if (classes.some((boundaryClass) => boundaryClass === 'door' || boundaryClass === 'gate')) return false;
    if (classes.some((boundaryClass) => boundaryClass === 'wall' || boundaryClass === 'fence')) return true;
  }

  // Wall art fills a square tile around its saved enclosure edge. Checking only
  // that edge makes a horizontal wall passable from its left/right sides (and
  // a vertical wall passable from above/below), even though the player visibly
  // walks through the wall. Every wall sprite is the same axis-aligned square,
  // and the centre may not step into its open interior. A centre already inside
  // one (a legacy save) may always step, so nobody is ever trapped.
  const walls = buildings
    .filter((building) => buildableById(building.definitionId).boundaryClass === 'wall')
    .map(wallSpriteBounds);
  return pointInsideWallArt(toX, toY, walls) && !pointInsideWallArt(fromX, fromY, walls);
}

/**
 * Whether a point is inside the open interior of the union of wall squares.
 * Two squares side by side share a seam; a point on that seam is still inside
 * the solid run of wall, so it must not count as a gap.
 */
function pointInsideWallArt(x: number, y: number, walls: readonly Bounds[]): boolean {
  if (walls.some((bounds) => pointInsideOpenBounds(x, y, bounds))) return true;
  const straddles = (onSeam: (bounds: Bounds) => 'low' | 'high' | null) => {
    let low = false;
    let high = false;
    for (const bounds of walls) {
      const side = onSeam(bounds);
      if (side === 'low') low = true;
      if (side === 'high') high = true;
    }
    return low && high;
  };
  const insideY = (bounds: Bounds) => y > bounds.top && y < bounds.bottom;
  const insideX = (bounds: Bounds) => x > bounds.left && x < bounds.right;
  return straddles((bounds) => !insideY(bounds) ? null : bounds.right === x ? 'low' : bounds.left === x ? 'high' : null)
    || straddles((bounds) => !insideX(bounds) ? null : bounds.bottom === y ? 'low' : bounds.top === y ? 'high' : null);
}

/**
 * Whether a one-tile cardinal move crosses a solid player-built boundary.
 * Free movement uses isBuildingBoundaryStepBlocked; this whole-tile form stays
 * for tile-stepping pathfinders (the opening supply run). Walls and fences are solid from both sides; doors and gates deliberately
 * share the enclosure edge without blocking movement.
 */
export function isBuildingBoundaryCrossingBlocked(
  buildings: readonly BuildingState[],
  currentX: number,
  currentY: number,
  directionX: CardinalComponent,
  directionY: CardinalComponent,
): boolean {
  if ((directionX === 0) === (directionY === 0)) return false;
  const tileX = Math.floor(currentX / TILE_SIZE);
  const tileY = Math.floor(currentY / TILE_SIZE);
  const edge = directionX < 0 ? 'west'
    : directionX > 0 ? 'east'
      : directionY < 0 ? 'north'
        : 'south';
  const occupancy = buildOccupancy(buildings);
  const keys = [boundaryEdgeKey(tileX, tileY, edge)];
  // The saved player can stand exactly on grid lines. At that position a move
  // crosses the seam shared by two neighboring wall sprites, so either segment
  // must participate in collision instead of leaving a one-point side gap.
  if (directionX !== 0 && isGridLine(currentY)) {
    keys.push(boundaryEdgeKey(tileX, tileY - 1, edge));
  } else if (directionY !== 0 && isGridLine(currentX)) {
    keys.push(boundaryEdgeKey(tileX - 1, tileY, edge));
  }
  const classes = keys
    .map((key) => occupancy.boundaries.get(key))
    .filter((boundary): boundary is BuildingState => boundary !== undefined)
    .map((boundary) => buildableById(boundary.definitionId).boundaryClass);
  // A door/gate at a junction owns the opening; an adjoining wall must not
  // make the entrance unusable merely because the player is on their seam.
  if (classes.some((boundaryClass) => boundaryClass === 'door' || boundaryClass === 'gate')) return false;
  if (classes.some((boundaryClass) => boundaryClass === 'wall' || boundaryClass === 'fence')) return true;

  // Wall art fills a square tile around its saved enclosure edge. Checking only
  // that edge makes a horizontal wall passable from its left/right sides (and
  // a vertical wall passable from above/below), even though the player visibly
  // walks through the wall. Treat every wall sprite as the same axis-aligned
  // square so its collision is universal and does not depend on orientation.
  return buildings.some((building) => {
    if (buildableById(building.definitionId).boundaryClass !== 'wall') return false;
    const bounds = wallSpriteBounds(building);
    return directionX !== 0
      ? horizontalMoveIntersectsOpenBounds(currentX, currentX + directionX * TILE_SIZE, currentY, bounds)
      : verticalMoveIntersectsOpenBounds(currentY, currentY + directionY * TILE_SIZE, currentX, bounds);
  });
}

/**
 * The first solid player-built boundary a straight line between two points
 * crosses, or null when nothing stands in the way.
 *
 * This is the sight line, not a step: it exists so a hostile cannot swing at
 * something it could not walk to. The player is deliberately exempt — a swing
 * or an arrow from behind cover is the whole point of cover, and the asymmetry
 * is what makes a half-built wall worth standing behind.
 *
 * Solidity matches `isBuildingBoundaryCrossingBlocked` exactly: walls and
 * fences block, doors and gates do not. A raider that can walk through the
 * doorway must also be able to hit through it, or the opening would read as
 * safe while a raider strolled in.
 *
 * Crossings are found analytically against the boundary grid rather than by
 * sampling, so a wall can never be missed by landing between two samples. Only
 * comparisons are floating point; nothing here is written back to state.
 */
export function solidBoundaryBetween(
  buildings: readonly BuildingState[],
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): BuildingState | null {
  const deltaX = toX - fromX;
  const deltaY = toY - fromY;
  const crossings: { t: number; key: string }[] = [];

  if (deltaX !== 0) {
    const stepX = deltaX > 0 ? 1 : -1;
    // The first grid line strictly past the origin, so a shooter standing
    // exactly on a line does not count the line under their own feet.
    const firstLine = deltaX > 0 ? Math.floor(fromX / TILE_SIZE) + 1 : Math.ceil(fromX / TILE_SIZE) - 1;
    for (let line = firstLine; ; line += stepX) {
      const t = (line * TILE_SIZE - fromX) / deltaX;
      if (t >= 1) break;
      if (t <= 0) continue;
      const tileY = Math.floor((fromY + deltaY * t) / TILE_SIZE);
      // A vertical grid line is the west edge of the tile to its right, which is
      // the same canonical key as the east edge of the tile to its left.
      crossings.push({ t, key: boundaryEdgeKey(line, tileY, 'west') });
    }
  }

  if (deltaY !== 0) {
    const stepY = deltaY > 0 ? 1 : -1;
    const firstLine = deltaY > 0 ? Math.floor(fromY / TILE_SIZE) + 1 : Math.ceil(fromY / TILE_SIZE) - 1;
    for (let line = firstLine; ; line += stepY) {
      const t = (line * TILE_SIZE - fromY) / deltaY;
      if (t >= 1) break;
      if (t <= 0) continue;
      const tileX = Math.floor((fromX + deltaX * t) / TILE_SIZE);
      crossings.push({ t, key: boundaryEdgeKey(tileX, line, 'north') });
    }
  }

  if (crossings.length === 0) return null;
  // Nearest first: a raider blocked by its own base's outer wall should attack
  // that wall, not the inner one it cannot reach yet.
  crossings.sort((left, right) => left.t - right.t);
  const occupancy = buildOccupancy(buildings);
  for (const crossing of crossings) {
    const boundary = occupancy.boundaries.get(crossing.key);
    if (!boundary) continue;
    const boundaryClass = buildableById(boundary.definitionId).boundaryClass;
    if (boundaryClass === 'wall' || boundaryClass === 'fence') return boundary;
  }
  return null;
}

interface Bounds { left: number; right: number; top: number; bottom: number }

function wallSpriteBounds(building: BuildingState): Bounds {
  const edge = effectiveBoundaryEdge(building);
  const centerX = (building.tileX + (edge === 'east' ? 1 : edge === 'west' ? 0 : 0.5)) * TILE_SIZE;
  const centerY = (building.tileY + (edge === 'south' ? 1 : edge === 'north' ? 0 : 0.5)) * TILE_SIZE;
  const half = TILE_SIZE / 2;
  return { left: centerX - half, right: centerX + half, top: centerY - half, bottom: centerY + half };
}

function pointInsideOpenBounds(x: number, y: number, bounds: Bounds): boolean {
  return x > bounds.left && x < bounds.right && y > bounds.top && y < bounds.bottom;
}

function horizontalMoveIntersectsOpenBounds(startX: number, endX: number, y: number, bounds: Bounds): boolean {
  if (y <= bounds.top || y >= bounds.bottom) return false;
  return Math.max(Math.min(startX, endX), bounds.left) < Math.min(Math.max(startX, endX), bounds.right);
}

function verticalMoveIntersectsOpenBounds(startY: number, endY: number, x: number, bounds: Bounds): boolean {
  if (x <= bounds.left || x >= bounds.right) return false;
  return Math.max(Math.min(startY, endY), bounds.top) < Math.min(Math.max(startY, endY), bounds.bottom);
}

function isGridLine(position: number): boolean {
  const scaled = position / TILE_SIZE;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}
