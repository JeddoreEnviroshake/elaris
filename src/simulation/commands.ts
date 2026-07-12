import { PLAYER_SPEED_PX_PER_S, SLOW_WALK_FACTOR, TILE_SIZE, WORLD_PX } from '../config/platform';
import type { Facing, GameState } from './state';

/**
 * Transient per-tick movement intention derived from input. Not part of saved
 * GameState — input is re-derived each frame. `x`/`y` are a direction in
 * [-1, 1]; magnitude may be < 1 for a partial (slow) walk.
 */
export interface MoveIntent {
  x: number;
  y: number;
  /** Explicit slow-walk request (Shift), independent of magnitude. */
  slow: boolean;
}

export const NO_MOVE: MoveIntent = { x: 0, y: 0, slow: false };

function facingFromVector(x: number, y: number, current: Facing): Facing {
  if (x === 0 && y === 0) return current;
  if (Math.abs(x) >= Math.abs(y)) return x < 0 ? 'left' : 'right';
  return y < 0 ? 'up' : 'down';
}

/** Half the player's collision box, used to keep the sprite inside world bounds. */
const PLAYER_HALF = TILE_SIZE / 2;

/**
 * Advance the player one fixed step. Pure with respect to the passed state:
 * mutates only `state.player` and `state.tick`. Diagonal input is normalized so
 * moving diagonally is not faster than moving straight.
 */
export function stepMovement(state: GameState, intent: MoveIntent, stepMs: number): void {
  state.tick += 1;

  let { x, y } = intent;
  const magnitude = Math.hypot(x, y);
  if (magnitude === 0) return;

  // Normalize direction; preserve partial magnitude (joystick) up to 1.
  const clampedMag = Math.min(1, magnitude);
  x = (x / magnitude) * clampedMag;
  y = (y / magnitude) * clampedMag;

  const slow = intent.slow || clampedMag < 1;
  const speed = PLAYER_SPEED_PX_PER_S * (slow ? SLOW_WALK_FACTOR : 1);
  const dt = stepMs / 1000;

  const player = state.player;
  player.x = clamp(player.x + x * speed * dt, PLAYER_HALF, WORLD_PX - PLAYER_HALF);
  player.y = clamp(player.y + y * speed * dt, PLAYER_HALF, WORLD_PX - PLAYER_HALF);
  player.facing = facingFromVector(x, y, player.facing);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
