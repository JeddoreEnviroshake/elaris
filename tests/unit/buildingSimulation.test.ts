import { describe, expect, it } from 'vitest';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { measureEnvironment } from '../../src/simulation/environmentProgress';
import { buildableById, placeBuilding, removeBuilding } from '../../src/simulation/gameplayCommands';
import { createInitialState, type BuildingState } from '../../src/simulation/state';

function wallsAround(left: number, top: number, width: number, height: number): BuildingState[] {
  const walls: BuildingState[] = [];
  let id = 1;
  for (let x = left; x < left + width + 2; x += 1) {
    walls.push({ id: `wall-${id++}`, definitionId: 'palisade-wall', tileX: x, tileY: top });
    walls.push({ id: `wall-${id++}`, definitionId: 'palisade-wall', tileX: x, tileY: top + height + 1 });
  }
  for (let y = top + 1; y < top + height + 1; y += 1) {
    walls.push({ id: `wall-${id++}`, definitionId: 'palisade-wall', tileX: left, tileY: y });
    walls.push({ id: `wall-${id++}`, definitionId: 'palisade-wall', tileX: left + width + 1, tileY: y });
  }
  return walls;
}

describe('authoritative building simulation', () => {
  it('measures a four-way enclosed area and its largest filled core', () => {
    const walls = wallsAround(10, 10, 4, 4);
    expect(measureEnvironment(walls, 11, 11)).toEqual({
      kind: 'indoor', area: 16, largestFilledCore: 4, enclosed: true,
    });
    walls.pop();
    expect(measureEnvironment(walls, 11, 11)).toMatchObject({ area: 0, largestFilledCore: 0, enclosed: false });
  });

  it('atomically validates cost, enclosure gate, overlap, and removal range', () => {
    const state = createInitialState(7);
    state.resourceNodes = [];
    state.buildings = wallsAround(75, 75, 3, 3);
    state.player.x = 77 * 16;
    state.player.y = 77 * 16;
    state.inventory.wood = 7;
    const before = canonicalizeGameState(state);

    const tooExpensive = placeBuilding(state, [], buildableById('workbench'), 76, 76);
    expect(tooExpensive).toMatchObject({ ok: false });
    expect(canonicalizeGameState(state)).toBe(before);

    state.inventory.wood = 9;
    const placed = placeBuilding(state, [], buildableById('workbench'), 76, 76);
    expect(placed.ok).toBe(true);
    expect(state.inventory.wood).toBe(1);
    expect(state.buildings).toContainEqual(placed.building);
    expect(state.highestAreaTierEver).toBe(8);
    expect(placeBuilding(state, [], buildableById('palisade-wall'), 76, 76)).toMatchObject({ ok: false, message: 'Blocked' });

    state.player.x = 0; state.player.y = 0;
    expect(removeBuilding(state, placed.building!.id)).toMatchObject({ ok: false, message: 'Too far away' });
    state.player.x = 77 * 16; state.player.y = 77 * 16;
    expect(removeBuilding(state, placed.building!.id)).toMatchObject({ ok: true });
    expect(state.highestAreaTierEver).toBe(8);
  });

  it('allocates identical persisted buildings for identical command streams', () => {
    const run = () => {
      const state = createInitialState(99);
      state.resourceNodes = [];
      state.inventory.wood = 1;
      const def = buildableById('palisade-wall');
      const x = Math.floor(state.player.x / 16) + 1;
      const y = Math.floor(state.player.y / 16);
      expect(placeBuilding(state, [], def, x, y).ok).toBe(true);
      return canonicalizeGameState(state);
    };
    expect(run()).toBe(run());
  });
});
