import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../../src/config/platform';
import { workerCreaturePlacements, workerCreaturePose } from '../../src/presentation/workerCreatures';
import { createInitialState, type GameState, type OwnedCreatureState } from '../../src/simulation/state';

function stateWithWorker(overrides: Partial<OwnedCreatureState> = {}): GameState {
  const state = createInitialState(4242);
  state.buildings.push({ id: 'pen', definitionId: 'small-pen', tileX: 10, tileY: 6 });
  state.ownedCreatures.push({
    id: 'creature-1', speciesId: 'tuftle', name: 'Moss', role: 'work', assignment: 'fiber',
    worksiteId: 'pen', housingId: 'pen', nextWorkTick: 0, bondXp: 0, selectedBattleAbilityId: 'tuftle-guard',
    ...overrides,
  });
  return state;
}

describe('working creature presentation', () => {
  it('places only working creatures whose worksite stands in this area', () => {
    expect(workerCreaturePlacements(stateWithWorker())).toHaveLength(1);
    expect(workerCreaturePlacements(stateWithWorker({ role: 'rest' }))).toHaveLength(0);
    expect(workerCreaturePlacements(stateWithWorker({ role: 'follow' }))).toHaveLength(0);
    expect(workerCreaturePlacements(stateWithWorker({ worksiteId: 'elsewhere' }))).toHaveLength(0);
  });

  it('walks a loop that stays near the worksite', () => {
    const placement = workerCreaturePlacements(stateWithWorker())[0]!;
    let moved = false;
    let paused = false;
    let previous = workerCreaturePose(placement, 0);
    for (let timeMs = 0; timeMs <= 60_000; timeMs += 90) {
      const pose = workerCreaturePose(placement, timeMs);
      expect(Math.abs(pose.x - placement.centerX)).toBeLessThanOrEqual(placement.radiusX + 0.001);
      expect(Math.abs(pose.y - placement.centerY)).toBeLessThanOrEqual(placement.radiusY + 0.001);
      // Never teleports: one sample step is a short walk, not a jump.
      expect(Math.hypot(pose.x - previous.x, pose.y - previous.y)).toBeLessThan(TILE_SIZE);
      moved ||= pose.moving;
      paused ||= !pose.moving;
      previous = pose;
    }
    expect(moved).toBe(true);
    expect(paused).toBe(true);
  });

  it('gives each creature its own phase so a shared pen never marches in step', () => {
    const state = stateWithWorker();
    state.ownedCreatures.push({ ...state.ownedCreatures[0]!, id: 'creature-2', name: 'Fern' });
    const [first, second] = workerCreaturePlacements(state);
    expect(first!.phase).not.toBe(second!.phase);
    // Two workers can cross paths, so the property is that they separate over
    // the loop rather than that they differ at any one instant.
    let widest = 0;
    for (let timeMs = 0; timeMs <= 30_000; timeMs += 250) {
      const poseA = workerCreaturePose(first!, timeMs);
      const poseB = workerCreaturePose(second!, timeMs);
      widest = Math.max(widest, Math.hypot(poseA.x - poseB.x, poseA.y - poseB.y));
    }
    expect(widest).toBeGreaterThan(TILE_SIZE);
  });
});
