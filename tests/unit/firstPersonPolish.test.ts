import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../src/simulation/state';
import { beginOpeningTrust, actOpeningTrust } from '../../src/simulation/onboarding';
import { starterGroveAnchor } from '../../src/simulation/worldGeneration';
import { followerCreaturePlacements, followerRadiusTiles } from '../../src/presentation/followerCreatures';
import { doorSwingTarget } from '../../src/three/doorPresentation';

function party() {
  const state = createInitialState(42);
  state.player.x = 82 * 16; state.player.y = 82 * 16;
  beginOpeningTrust(state);
  for (let i = 0; i < 4; i++) actOpeningTrust(state, 'steady');
  Object.assign(state.player, starterGroveAnchor(state.seed));
  return state;
}

describe('first-person presentation clearance', () => {
  it('opens a gate while it is still ahead and holds it open as the player clears it', () => {
    expect(doorSwingTarget(3.5, 0, true)).toBe(1);
    expect(doorSwingTarget(3.5, 0, false)).toBe(0);
    expect(doorSwingTarget(4.2, 0, true)).toBe(0);
    expect(doorSwingTarget(4.2, 1, true)).toBe(1);
    expect(doorSwingTarget(5.1, 1, true)).toBe(0);
    expect(doorSwingTarget(1, .5, false)).toBe(1);
  });

  it('keeps a mixed party behind the player with body clearance and leaves gameplay state untouched', () => {
    const state = party();
    state.ownedCreatures.push({ ...state.ownedCreatures[0]!, id: 'moth-follower', speciesId: 'mistmoth' });
    const before = JSON.stringify(state);
    const placements = followerCreaturePlacements(state, { x: 0, y: -1 }, true);
    expect(placements).toHaveLength(2);
    for (const position of placements) {
      expect(position.y - state.player.y).toBeGreaterThan(2.5 * 16);
      expect(Math.hypot(position.x - state.player.x, position.y - state.player.y)).toBeGreaterThan(3 * 16);
    }
    const [a, b] = placements;
    expect(Math.hypot(a!.x - b!.x, a!.y - b!.y)).toBeGreaterThan(
      (followerRadiusTiles(a!.speciesId) + followerRadiusTiles(b!.speciesId)) * 16);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('never falls back to the player position when enclosed with no safe follower slot', () => {
    const state = party();
    const tileX = Math.floor(state.player.x / 16), tileY = Math.floor(state.player.y / 16);
    state.player.x = (tileX + .5) * 16; state.player.y = (tileY + .5) * 16;
    state.buildings = (['north', 'east', 'south', 'west'] as const).map(boundaryEdge => ({
      id: boundaryEdge, definitionId: 'wood-fence', tileX, tileY, boundaryEdge,
    }));
    expect(followerCreaturePlacements(state, { x: 0, y: -1 }, true)).toEqual([]);
    expect(followerCreaturePlacements(state, { x: 0, y: -1 })).toEqual([]);
  });
});
