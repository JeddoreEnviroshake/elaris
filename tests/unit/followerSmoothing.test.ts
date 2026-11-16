import { describe, expect, it } from 'vitest';
import { befriendOpeningTuftle } from '../helpers/openingJourney';
import { createInitialState } from '../../src/simulation/state';
import { starterGroveAnchor } from '../../src/simulation/worldGeneration';
import { easeFollowerToward, followerCreaturePlacements, FOLLOWER_SNAP_DISTANCE } from '../../src/presentation/followerCreatures';

function companion() {
  const state = createInitialState(42);
  state.player.x = 82 * 16; state.player.y = 82 * 16;
  befriendOpeningTuftle(state);
  Object.assign(state.player, starterGroveAnchor(state.seed));
  return state;
}

describe('follower presentation smoothing', () => {
  it('forms up around the drawn player pose, not the fixed-step sim position', () => {
    const state = companion();
    const atSim = followerCreaturePlacements(state, { x: 0, y: 1 })[0]!;
    const drawn = { x: state.player.x + 6, y: state.player.y + 4 };
    const atDrawn = followerCreaturePlacements(state, { x: 0, y: 1 }, false, drawn)[0]!;
    expect(atDrawn.x - atSim.x).toBe(6);
    expect(atDrawn.y - atSim.y).toBe(4);
  });

  it('trots toward a moved slot over several frames instead of teleporting', () => {
    let pose = { x: 0, z: 0 };
    const slot = { x: 2, z: 0 };
    pose = easeFollowerToward(pose, slot, 1 / 60);
    expect(pose.x).toBeGreaterThan(0);
    expect(pose.x).toBeLessThan(0.3);
    for (let frame = 0; frame < 60; frame++) pose = easeFollowerToward(pose, slot, 1 / 60);
    expect(pose.x).toBeCloseTo(2, 2);
  });

  it('is frame-rate independent and snaps across a door or area change', () => {
    let fast = { x: 0, z: 0 };
    for (let frame = 0; frame < 4; frame++) fast = easeFollowerToward(fast, { x: 1, z: 1 }, 1 / 120);
    const slow = easeFollowerToward({ x: 0, z: 0 }, { x: 1, z: 1 }, 1 / 30);
    expect(fast.x).toBeCloseTo(slow.x, 6);
    expect(easeFollowerToward({ x: 0, z: 0 }, { x: FOLLOWER_SNAP_DISTANCE + 1, z: 0 }, 1 / 60)).toEqual({ x: FOLLOWER_SNAP_DISTANCE + 1, z: 0 });
    expect(easeFollowerToward({ x: 1, z: 1 }, { x: 3, z: 1 }, 0)).toEqual({ x: 1, z: 1 });
  });
});
