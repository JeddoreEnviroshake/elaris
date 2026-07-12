import { describe, expect, it } from 'vitest';
import { PLAYER_SPEED_PX_PER_S, SLOW_WALK_FACTOR, TILE_SIZE, WORLD_PX } from '../../src/config/platform';
import { stepMovement } from '../../src/simulation/commands';
import { createInitialState } from '../../src/simulation/state';

const SEED = 1234;

describe('stepMovement', () => {
  it('moves at full speed for a unit cardinal intent and advances the tick', () => {
    const state = createInitialState(SEED);
    const startX = state.player.x;
    stepMovement(state, { x: 1, y: 0, slow: false }, 1000);
    expect(state.player.x - startX).toBeCloseTo(PLAYER_SPEED_PX_PER_S, 6);
    expect(state.player.facing).toBe('right');
    expect(state.tick).toBe(1);
  });

  it('normalizes diagonal movement so it is not faster than cardinal', () => {
    const state = createInitialState(SEED);
    const sx = state.player.x;
    const sy = state.player.y;
    stepMovement(state, { x: 1, y: 1, slow: false }, 1000);
    const dist = Math.hypot(state.player.x - sx, state.player.y - sy);
    expect(dist).toBeCloseTo(PLAYER_SPEED_PX_PER_S, 6);
  });

  it('applies slow-walk factor for partial joystick magnitude', () => {
    const state = createInitialState(SEED);
    const sx = state.player.x;
    // magnitude 0.5 < 1 => slow walk
    stepMovement(state, { x: 0.5, y: 0, slow: false }, 1000);
    expect(state.player.x - sx).toBeCloseTo(PLAYER_SPEED_PX_PER_S * SLOW_WALK_FACTOR * 0.5, 6);
  });

  it('does not move and preserves facing on a zero intent', () => {
    const state = createInitialState(SEED);
    state.player.facing = 'up';
    const sx = state.player.x;
    stepMovement(state, { x: 0, y: 0, slow: false }, 1000);
    expect(state.player.x).toBe(sx);
    expect(state.player.facing).toBe('up');
    expect(state.tick).toBe(1);
  });

  it('clamps the player inside world bounds', () => {
    const state = createInitialState(SEED);
    state.player.x = WORLD_PX - 1;
    stepMovement(state, { x: 1, y: 0, slow: false }, 1000);
    expect(state.player.x).toBe(WORLD_PX - TILE_SIZE / 2);
  });
});
