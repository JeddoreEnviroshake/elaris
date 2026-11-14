import { describe, expect, it } from 'vitest';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { environments, recordHighestAreaTier } from '../../src/simulation/environmentProgress';
import { buildableById, demolitionRefund, placeBuilding, removeBuilding } from '../../src/simulation/gameplayCommands';
import { createInitialState } from '../../src/simulation/state';
import { enclosedEnvironment } from './helpers/buildings';

describe('authoritative building simulation', () => {
  it('requires rebuilds for material changes and refunds half per input without rounding up', () => {
    const state = createInitialState(91);
    state.resourceNodes = [];
    state.unlockedItemIds.push('stone-floor', 'metal-floor');
    state.inventory.stone = 10;
    state.inventory['iron-ingot'] = 10;
    const tileX = Math.floor(state.player.x / 16);
    const tileY = Math.floor(state.player.y / 16);
    const stone = placeBuilding(state, state.buildings, buildableById('stone-floor'), tileX, tileY);
    expect(stone.ok).toBe(true);
    expect(placeBuilding(state, state.buildings, buildableById('metal-floor'), tileX, tileY).ok).toBe(false);
    expect(removeBuilding(state, stone.building!.id).ok).toBe(true);
    expect(state.inventory.stone).toBe(9);
    expect(placeBuilding(state, state.buildings, buildableById('metal-floor'), tileX, tileY).ok).toBe(true);
    expect(demolitionRefund(buildableById('stone-wall'))).toEqual([['stone', 1]]);
    expect(demolitionRefund(buildableById('metal-door'))).toEqual([['iron-ingot', 2]]);
  });
  it('measures player surfaces enclosed by canonical boundary edges', () => {
    const buildings = enclosedEnvironment(10, 10, 4, 4, 'indoor');
    expect(environments(buildings)[0]).toMatchObject({
      kind: 'indoor', area: 16, largestFilledCore: 4, enclosed: true, valid: true, tier: 16,
    });
    const northEdge = buildings.find((building) => building.boundaryEdge === 'north')!;
    expect(environments(buildings.filter((building) => building.id !== northEdge.id))[0]).toMatchObject({
      area: 16, largestFilledCore: 0, enclosed: false, valid: false, tier: 0,
    });
  });

  it('atomically validates cost, environment gate, edge overlap, and removal range', () => {
    const state = createInitialState(7);
    state.resourceNodes = [];
    state.buildings = enclosedEnvironment(40, 40, 3, 3, 'indoor');
    state.player.x = 41 * 16;
    state.player.y = 41 * 16;
    state.highestAreaTierEver = 8;
    state.unlockedItemIds.push('workbench', 'wood-wall');
    state.inventory.wood = 7;
    const before = canonicalizeGameState(state);

    expect(placeBuilding(state, state.buildings, buildableById('workbench'), 40, 40)).toMatchObject({ ok: false });
    expect(canonicalizeGameState(state)).toBe(before);

    state.inventory.wood = 9;
    const placed = placeBuilding(state, state.buildings, buildableById('workbench'), 40, 40);
    expect(placed.ok).toBe(true);
    expect(state.inventory.wood).toBe(1);
    expect(state.highestAreaTierEver).toBe(8);
    expect(placeBuilding(
      state, state.buildings, buildableById('wood-wall'), 40, 40, { boundaryEdge: 'north' },
    )).toMatchObject({ ok: false, message: 'Edge occupied by Wood Wall' });

    state.player.x = 0; state.player.y = 0;
    expect(removeBuilding(state, placed.building!.id)).toMatchObject({ ok: false, message: 'Too far away' });
    state.player.x = 41 * 16; state.player.y = 41 * 16;
    expect(removeBuilding(state, placed.building!.id)).toMatchObject({ ok: true });
  });

  it('places a Workbench in an enclosed 8-tile room without an Environment Marker', () => {
    const state = createInitialState(8);
    state.resourceNodes = [];
    state.buildings = enclosedEnvironment(40, 40, 4, 2, 'indoor')
      .filter((building) => building.definitionId !== 'environment-marker');
    state.player.x = 42 * 16;
    state.player.y = 42 * 16;
    state.inventory.wood = 8;
    state.unlockedItemIds.push('workbench');

    // Finishing the enclosure discovers the Shelter tier; no extra marker step.
    expect(environments(state.buildings)[0]).toMatchObject({ area: 8, valid: true, tier: 8, markerCount: 0 });
    recordHighestAreaTier(state);
    expect(placeBuilding(state, state.buildings, buildableById('workbench'), 40, 40).ok).toBe(true);
  });

  it('treats a legacy Environment Marker as removable metadata, not occupied floor space', () => {
    const state = createInitialState(9);
    state.resourceNodes = [];
    state.buildings = enclosedEnvironment(40, 40, 4, 2, 'indoor');
    state.player.x = 42 * 16;
    state.player.y = 42 * 16;
    state.highestAreaTierEver = 8;
    state.inventory.wood = 8;
    state.unlockedItemIds.push('workbench');
    const marker = state.buildings.find((building) => building.definitionId === 'environment-marker')!;

    // The 2x1 footprint deliberately covers the marker's cell.
    expect(placeBuilding(state, state.buildings, buildableById('workbench'), 42, 41).ok).toBe(true);
    expect(removeBuilding(state, marker.id).ok).toBe(true);
    expect(environments(state.buildings)[0]).toMatchObject({ area: 8, valid: true, tier: 8, markerCount: 0 });
  });

  it('allocates identical persisted boundary edges for identical command streams', () => {
    const run = () => {
      const state = createInitialState(99);
      state.resourceNodes = [];
      state.inventory.wood = 1;
      state.unlockedItemIds.push('wood-wall');
      state.player.facing = 'right';
      const x = Math.floor(state.player.x / 16) + 1;
      const y = Math.floor(state.player.y / 16);
      expect(placeBuilding(state, state.buildings, buildableById('wood-wall'), x, y).ok).toBe(true);
      expect(state.buildings[0]!.boundaryEdge).toBe('west');
      return canonicalizeGameState(state);
    };
    expect(run()).toBe(run());
  });
});
