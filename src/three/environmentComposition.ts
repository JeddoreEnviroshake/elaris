import { isRoadPosition } from '../content/roads';
import { terrainAt } from '../simulation/landscape';

export interface EnvironmentPoint {
  readonly x: number;
  readonly z: number;
}

export interface EnvironmentPlacement extends EnvironmentPoint {
  readonly rotation: number;
  readonly scale: number;
  readonly variant: number;
}

export interface EnvironmentFootprint {
  readonly tileX: number;
  readonly tileY: number;
  readonly tilesWide: number;
  readonly tilesHigh: number;
}

export interface HeroEnvironmentComposition {
  readonly groundDetails: readonly EnvironmentPlacement[];
}

function hash(seed: number, x: number, z: number): number {
  let value = (seed ^ Math.imul(x, 0x45d9f3b) ^ Math.imul(z, 0x119de1f3)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b) >>> 0;
  value ^= value >>> 16;
  return value / 0x1_0000_0000;
}

export function isInsideBufferedFootprint(
  point: EnvironmentPoint,
  footprints: readonly EnvironmentFootprint[],
  buffer = 0,
): boolean {
  return footprints.some((footprint) => point.x >= footprint.tileX - buffer
    && point.x <= footprint.tileX + footprint.tilesWide + buffer
    && point.z >= footprint.tileY - buffer
    && point.z <= footprint.tileY + footprint.tilesHigh + buffer);
}

/**
 * Seed-stable composition for Elaris' authored hero zone. It deliberately
 * keeps decoration outside service-building footprints and leaves gameplay
 * resources as the only dense, nearby gatherable objects.
 */
export function composeHeroEnvironment(
  seed: number,
  footprints: readonly EnvironmentFootprint[],
): HeroEnvironmentComposition {
  const groundDetails: EnvironmentPlacement[] = [];
  for (let index = 0; index < 110; index += 1) {
    const point = {
      x: 48 + hash(seed ^ 0x4c45_4146, index, 5) * 68,
      z: 58 + hash(seed ^ 0x4d4f_5353, index, 6) * 58,
    };
    if (isInsideBufferedFootprint(point, footprints, 1.6)) continue;
    if (isRoadPosition('0,0', point.x, point.z, .5)) continue;
    if (terrainAt(seed, { x: 0, y: 0, theme: 'elaris' }, Math.floor(point.x), Math.floor(point.z)) !== 'ground') continue;
    groundDetails.push({
      ...point,
      rotation: hash(seed ^ 0x524f_544e, index, 7) * Math.PI * 2,
      scale: 0.72 + hash(seed ^ 0x5343_414c, index, 8) * 0.55,
      variant: hash(seed ^ 0x4445_544c, index, 9),
    });
  }

  return { groundDetails };
}

/** Distance from a point to a finite line segment in the ground plane. */
export function distanceToSegment(
  point: EnvironmentPoint,
  start: EnvironmentPoint,
  end: EnvironmentPoint,
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= 1e-8) return Math.hypot(point.x - start.x, point.z - start.z);
  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared));
  return Math.hypot(point.x - (start.x + dx * projection), point.z - (start.z + dz * projection));
}

export function isGroundOccluder(
  occluder: EnvironmentPoint,
  radius: number,
  camera: EnvironmentPoint,
  target: EnvironmentPoint,
): boolean {
  const cameraDistance = Math.hypot(target.x - camera.x, target.z - camera.z);
  if (cameraDistance <= 1e-4) return false;
  const along = ((occluder.x - camera.x) * (target.x - camera.x)
    + (occluder.z - camera.z) * (target.z - camera.z)) / (cameraDistance * cameraDistance);
  return along > 0.04 && along < 0.96 && distanceToSegment(occluder, camera, target) < radius;
}
