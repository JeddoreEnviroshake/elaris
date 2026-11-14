import {
  cardinalDirection,
  resetGridMovement,
  type GridMovementState,
  type MoveIntent,
} from '../simulation/commands';
import type { Facing } from '../simulation/state';
import {
  isInteriorTileWalkable,
  type InteriorDefinition,
  type InteriorHotspot,
} from '../content/interiors';

export interface InteriorMovementState {
  readonly x: number;
  readonly y: number;
  readonly facing: Facing;
}

const WALK_SPEED_TILES_PER_SECOND = 3.2;
const ACTOR_RADIUS_TILES = 0.22;
export const INTERIOR_INTERACTION_RANGE_TILES = 1.4;

/** Cardinal, tile-sized local movement shared by every interior renderer. */
export function stepInteriorMovement(
  interior: InteriorDefinition,
  pose: InteriorMovementState,
  intent: MoveIntent,
  deltaMs: number,
  movement: GridMovementState,
): InteriorMovementState {
  if (deltaMs <= 0) return pose;
  let facing = pose.facing;

  if (!movement.moving) {
    const direction = cardinalDirection(intent);
    if (!direction) return pose;
    facing = direction.facing;
    const targetX = pose.x + direction.x;
    const targetY = pose.y + direction.y;
    if (!canOccupy(interior, targetX, targetY)) {
      resetGridMovement(movement);
      return { ...pose, facing };
    }
    movement.moving = true;
    movement.targetX = targetX;
    movement.targetY = targetY;
    movement.directionX = direction.x;
    movement.directionY = direction.y;
    movement.slow = intent.slow;
  }

  const remaining = Math.hypot(movement.targetX - pose.x, movement.targetY - pose.y);
  const speed = WALK_SPEED_TILES_PER_SECOND * (movement.slow ? 0.55 : 1);
  const distance = Math.max(0, speed * deltaMs / 1_000);
  let x = pose.x;
  let y = pose.y;
  if (distance >= remaining) {
    x = movement.targetX;
    y = movement.targetY;
    resetGridMovement(movement);
  } else {
    x += movement.directionX * distance;
    y += movement.directionY * distance;
  }
  return { x, y, facing };
}

export function nearestInteriorHotspot(
  interior: InteriorDefinition,
  pose: Pick<InteriorMovementState, 'x' | 'y'>,
  rangeTiles = INTERIOR_INTERACTION_RANGE_TILES,
): InteriorHotspot | null {
  let nearest: InteriorHotspot | null = null;
  let nearestDistance = rangeTiles;
  for (const hotspot of interior.hotspots) {
    const distance = Math.hypot(hotspot.tileX + 0.5 - pose.x, hotspot.tileY + 0.5 - pose.y);
    if (distance <= nearestDistance) {
      nearest = hotspot;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function canOccupy(interior: InteriorDefinition, x: number, y: number): boolean {
  return [
    [x - ACTOR_RADIUS_TILES, y - ACTOR_RADIUS_TILES],
    [x + ACTOR_RADIUS_TILES, y - ACTOR_RADIUS_TILES],
    [x - ACTOR_RADIUS_TILES, y + ACTOR_RADIUS_TILES],
    [x + ACTOR_RADIUS_TILES, y + ACTOR_RADIUS_TILES],
  ].every(([sampleX, sampleY]) => isInteriorTileWalkable(interior, Math.floor(sampleX!), Math.floor(sampleY!)));
}
