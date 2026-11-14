import { buildingCenterPx } from '../simulation/buildingGeometry';
import type { BuildingState } from '../simulation/state';

/**
 * Directional picking for Delete mode. The d-pad steers the delete cursor the
 * same way it steers the placement ghost, so removing a part is aim-then-commit
 * too: nudge until the right structure is lit red, then press Delete.
 *
 * Pure geometry, kept out of BuildModeController so it can be tested without a
 * Phaser scene.
 */

/** Ignore parts that sit dead on the step axis; they are not "that way". */
const AXIS_EPSILON_PX = 0.5;

/**
 * Sideways drift costs double, so a d-pad press lands on the part actually in
 * front of the cursor rather than a nearer one off to the side.
 */
const PERPENDICULAR_WEIGHT = 2;

export function nearestBuilding(
  buildings: readonly BuildingState[],
  x: number,
  y: number,
): BuildingState | null {
  let nearest: BuildingState | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const building of buildings) {
    const center = buildingCenterPx(building);
    const distance = Math.hypot(center.x - x, center.y - y);
    if (distance >= nearestDistance) continue;
    nearest = building;
    nearestDistance = distance;
  }
  return nearest;
}

/**
 * The next placed part one d-pad press away from `from`, or null when nothing
 * lies that way — the cursor then stays put rather than jumping across the map.
 */
export function nextBuildingInDirection(
  buildings: readonly BuildingState[],
  from: BuildingState,
  dx: number,
  dy: number,
): BuildingState | null {
  if (dx === 0 && dy === 0) return null;
  const origin = buildingCenterPx(from);
  let best: BuildingState | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const building of buildings) {
    if (building.id === from.id) continue;
    const center = buildingCenterPx(building);
    const offsetX = center.x - origin.x;
    const offsetY = center.y - origin.y;
    const along = dx !== 0 ? offsetX * Math.sign(dx) : offsetY * Math.sign(dy);
    if (along <= AXIS_EPSILON_PX) continue;
    const perpendicular = Math.abs(dx !== 0 ? offsetY : offsetX);
    const cost = along + perpendicular * PERPENDICULAR_WEIGHT;
    if (cost >= bestCost) continue;
    best = building;
    bestCost = cost;
  }
  return best;
}
