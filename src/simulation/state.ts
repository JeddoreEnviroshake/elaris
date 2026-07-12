import { WORLD_PX } from '../config/platform';

export type Facing = 'up' | 'down' | 'left' | 'right';

export interface PlayerState {
  /** World position in source pixels. */
  x: number;
  y: number;
  facing: Facing;
}

/**
 * The single serializable authoritative game state. Milestone 0 holds only
 * what movement needs; inventory, world deltas, structures, roster, etc. are
 * added by later milestones. `rngState` and `seed` make the sim reproducible.
 */
export interface GameState {
  seed: number;
  rngState: number;
  tick: number;
  player: PlayerState;
}

export function createInitialState(seed: number): GameState {
  return {
    seed,
    rngState: seed >>> 0,
    tick: 0,
    player: {
      x: WORLD_PX / 2,
      y: WORLD_PX / 2,
      facing: 'down',
    },
  };
}
