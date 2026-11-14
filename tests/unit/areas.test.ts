import { describe, expect, it } from 'vitest';
import { TILE_SIZE, WORLD_PX } from '../../src/config/platform';
import { describeArea, enterAdjacentArea } from '../../src/simulation/areas';
import { createInitialState } from '../../src/simulation/state';
import { canTravelToWorldArea, WORLD_BOUNDS } from '../../src/content/world';

describe('world areas', () => {
  it('calls the starter area Elaris and generates stable neighboring names', () => {
    expect(describeArea(123, 0, 0).name).toBe('Elaris');
    expect(describeArea(123, 1, 0)).toMatchObject({ key: '1,0', name: 'Verdant Reach', theme: 'meadow' });
    expect(describeArea(123, 2, 0)).toMatchObject({ key: '2,0', name: 'Sylvaren', theme: 'forest' });
    expect(describeArea(123, 2, -4)).toEqual(describeArea(123, 2, -4));
    expect(describeArea(123, 2, -4).name).not.toBe('Elaris');
  });

  it('weights generated resources toward the area theme', () => {
    const state = createInitialState(123);
    enterAdjacentArea(state, 'right');
    const counts = Object.groupBy(state.resourceNodes, (node) => node.kind);
    const theme = state.currentArea.theme;
    if (theme === 'forest') expect(counts.tree!.length).toBeGreaterThan(counts.stone!.length);
    if (theme === 'mountain') expect(counts.stone!.length).toBeGreaterThan(counts.tree!.length);
    if (theme === 'thicket') expect(counts['berry-bush']!.length).toBeGreaterThan(counts.stone!.length);
  });

  it('restores mutated area entities when the player returns', () => {
    const state = createInitialState(456);
    const originalCount = state.resourceNodes.length;
    state.resourceNodes.pop();
    enterAdjacentArea(state, 'right');
    enterAdjacentArea(state, 'left');
    expect(state.currentArea.name).toBe('Elaris');
    expect(state.resourceNodes).toHaveLength(originalCount - 1);
    expect(state.player.x).toBe(WORLD_PX - (TILE_SIZE / 2 + 1));
  });

  it('enforces the finite world while allowing legacy saves to travel inward', () => {
    expect(canTravelToWorldArea(WORLD_BOUNDS.minX, 0, WORLD_BOUNDS.minX - 1, 0)).toBe(false);
    expect(canTravelToWorldArea(WORLD_BOUNDS.minX - 2, 0, WORLD_BOUNDS.minX - 1, 0)).toBe(true);
    expect(canTravelToWorldArea(WORLD_BOUNDS.minX - 2, 0, WORLD_BOUNDS.minX - 3, 0)).toBe(false);

    const state = createInitialState(123);
    for (let x = 0; x > WORLD_BOUNDS.minX; x -= 1) expect(enterAdjacentArea(state, 'left')).toBe(true);
    expect(state.currentArea.x).toBe(WORLD_BOUNDS.minX);
    expect(enterAdjacentArea(state, 'left')).toBe(false);
    expect(state.currentArea.x).toBe(WORLD_BOUNDS.minX);
  });
});
