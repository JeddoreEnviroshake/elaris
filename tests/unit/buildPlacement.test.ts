import { describe, expect, it } from 'vitest';
import { TILE_SIZE, WORLD_TILES } from '../../src/config/platform';
import {
  BUILDABLES,
  boundaryPlacementFromWorld,
  boundaryPlacementNearSurface,
  buildableById,
  checkPlacement,
  clampTileToBounds,
  costText,
  defaultGhostTile,
  describeBuildable,
  missingCost,
  placementTargetFromWorld,
  placeBuilding,
  undoBuildingPlacement,
  validatePlacement,
} from '../../src/scenes/buildPlacement';
import { createInitialState } from '../../src/simulation/state';
import { starterGroveAnchor } from '../../src/simulation/worldGeneration';
import { boundaryEdgeKey, buildOccupancy } from '../../src/simulation/environmentProgress';

const SEED = 1234;

describe('build placement (presentation adapter over the building sim)', () => {
  it('maps boundary clicks to the nearest canonical tile edge', () => {
    expect(boundaryPlacementFromWorld(10 * TILE_SIZE + 8, 20 * TILE_SIZE + 1)).toEqual({
      tileX: 10, tileY: 20, boundaryEdge: 'north',
    });
    expect(boundaryPlacementFromWorld(10 * TILE_SIZE + 15, 20 * TILE_SIZE + 8)).toEqual({
      tileX: 10, tileY: 20, boundaryEdge: 'east',
    });
    expect(boundaryPlacementFromWorld(10 * TILE_SIZE + 8, 20 * TILE_SIZE + 15)).toEqual({
      tileX: 10, tileY: 20, boundaryEdge: 'south',
    });
    expect(boundaryPlacementFromWorld(10 * TILE_SIZE + 1, 20 * TILE_SIZE + 8)).toEqual({
      tileX: 10, tileY: 20, boundaryEdge: 'west',
    });
  });

  it('snaps an ambiguous outside-tile tap to the nearest exposed floor perimeter', () => {
    const floors = [
      { id: 'floor-a', definitionId: 'wood-floor' as const, tileX: 10, tileY: 10 },
      { id: 'floor-b', definitionId: 'wood-floor' as const, tileX: 11, tileY: 10 },
      { id: 'floor-c', definitionId: 'wood-floor' as const, tileX: 10, tileY: 11 },
      { id: 'floor-d', definitionId: 'wood-floor' as const, tileX: 11, tileY: 11 },
    ];
    const worldX = 9.5 * TILE_SIZE;
    const worldY = 10.5 * TILE_SIZE;

    expect(boundaryPlacementFromWorld(worldX, worldY)).toEqual({
      tileX: 9, tileY: 10, boundaryEdge: 'north',
    });
    expect(boundaryPlacementNearSurface(floors, buildableById('wood-wall'), worldX, worldY)).toEqual({
      tileX: 10, tileY: 10, boundaryEdge: 'west',
    });
  });

  it('spawns the ghost on the tile in front of the player', () => {
    const state = createInitialState(SEED);
    state.resourcesCollected.wood = 1;
    const wall = buildableById('wood-wall');
    const playerTileX = Math.floor(state.player.x / TILE_SIZE);
    const playerTileY = Math.floor(state.player.y / TILE_SIZE);

    state.player.facing = 'down';
    expect(defaultGhostTile(state, wall)).toEqual({ tileX: playerTileX, tileY: playerTileY + 1 });
    state.player.facing = 'right';
    expect(defaultGhostTile(state, wall)).toEqual({ tileX: playerTileX + 1, tileY: playerTileY });

    // A 2×2 footprint placed upward must clear its full height.
    const planter = buildableById('woodlot-planter');
    state.player.facing = 'up';
    expect(defaultGhostTile(state, planter).tileY).toBe(playerTileY - planter.tilesHigh);
  });

  it('clamps ghost tiles to world bounds for every catalog footprint', () => {
    for (const def of BUILDABLES) {
      expect(clampTileToBounds(-5, -5, def)).toEqual({ tileX: 0, tileY: 0 });
      expect(clampTileToBounds(WORLD_TILES, WORLD_TILES, def)).toEqual({
        tileX: WORLD_TILES - def.tilesWide,
        tileY: WORLD_TILES - def.tilesHigh,
      });
    }
    const workbench = buildableById('workbench');
    expect(clampTileToBounds(WORLD_TILES, WORLD_TILES, workbench, true)).toEqual({
      tileX: WORLD_TILES - workbench.tilesHigh,
      tileY: WORLD_TILES - workbench.tilesWide,
    });
  });

  it('reports affordability and formats palette copy', () => {
    const state = createInitialState(SEED);
    const wall = buildableById('wood-wall');

    expect(missingCost(state, wall.cost)).toEqual({ resource: 'wood', amount: 1 });
    state.inventory.wood = 3;
    expect(missingCost(state, wall.cost)).toBeNull();

    expect(costText({ wood: 6, stone: 2 })).toBe('6 wood + 2 stone');
    for (const def of BUILDABLES) expect(describeBuildable(def.id)).toBeTruthy();
  });

  it('rejects placement that is unaffordable, overlapping a node, on the player, or out of range', () => {
    const state = createInitialState(SEED);
    // The starter fixtures stand in the grove outside the walls, not on the
    // spawn point, and this test needs a node within build range.
    const grove = starterGroveAnchor(state.seed);
    state.player.x = grove.x;
    state.player.y = grove.y;
    state.resourcesCollected.wood = 1;
    state.unlockedItemIds.push('wood-wall');
    const wall = buildableById('wood-wall');
    const { tileX, tileY } = defaultGhostTile(state, wall);

    expect(checkPlacement(state, state.buildings, wall, tileX, tileY)).toEqual({
      ok: false,
      message: 'Need 1 more wood',
    });

    state.inventory.wood = 10;
    expect(checkPlacement(state, state.buildings, wall, tileX, tileY).ok).toBe(true);

    // A boundary edge does not occupy the player/surface cell.
    const playerTileX = Math.floor(state.player.x / TILE_SIZE);
    const playerTileY = Math.floor(state.player.y / TILE_SIZE);
    expect(validatePlacement(state, state.buildings, wall, playerTileX, playerTileY).ok).toBe(true);

    // Boundary edges do not occupy cells; surfaces still cannot cover a resource node.
    const tree = state.resourceNodes[0]!;
    expect(validatePlacement(
      state,
      state.buildings,
      wall,
      Math.floor(tree.x / TILE_SIZE),
      Math.floor(tree.y / TILE_SIZE),
    ).ok).toBe(true);
    const floor = buildableById('wood-floor');
    expect(
      validatePlacement(
        state,
        state.buildings,
        floor,
        Math.floor(tree.x / TILE_SIZE),
        Math.floor(tree.y / TILE_SIZE),
      ).message,
    ).toBe('Tree is in the way');

    // Clear nodes so distance is the only remaining rule in play, and stand
    // inland: ten tiles east of the grove is Elaris's moat, and "requires solid
    // ground" would answer before the range rule ever ran.
    state.resourceNodes = [];
    state.player.x = 40 * TILE_SIZE;
    state.player.y = 40 * TILE_SIZE;
    expect(validatePlacement(state, state.buildings, wall, 50, 40).message).toBe(
      'Outside build range — move closer',
    );
    expect(validatePlacement(state, state.buildings, wall, -1, 0).message).toBe('Out of bounds');
  });

  it('allows building within six blocks of the player and rejects the seventh block', () => {
    const state = createInitialState(SEED);
    state.player.x = 40 * TILE_SIZE;
    state.player.y = 40 * TILE_SIZE;
    state.resourceNodes = [];
    state.unlockedItemIds.push('wood-wall');
    const wall = buildableById('wood-wall');

    expect(validatePlacement(state, state.buildings, wall, 46, 40).ok).toBe(true);
    expect(validatePlacement(state, state.buildings, wall, 47, 40)).toEqual({
      ok: false,
      message: 'Outside build range — move closer',
    });
  });

  it('persists a placed structure to state.buildings, deducts cost, and blocks overlap', () => {
    const state = createInitialState(SEED);
    state.inventory.wood = 10;
    state.unlockedItemIds.push('wood-wall');
    state.resourceNodes = []; // building-vs-building overlap is what's under test

    const wall = buildableById('wood-wall');
    state.player.facing = 'right';
    const spot = defaultGhostTile(state, wall);

    const result = placeBuilding(state, state.buildings, wall, spot.tileX, spot.tileY);
    expect(result.ok).toBe(true);
    expect(result.building?.definitionId).toBe('wood-wall');
    expect(state.buildings).toHaveLength(1);
    expect(state.inventory.wood).toBe(9);

    // A second wall on the same tile overlaps the persisted footprint.
    const blocked = placeBuilding(state, state.buildings, wall, spot.tileX, spot.tileY);
    expect(blocked).toMatchObject({ ok: false, message: 'Edge occupied by Wood Wall' });
    expect(state.buildings).toHaveLength(1);
    expect(state.inventory.wood).toBe(9);
  });

  it('makes each fence occupy two consecutive boundary spaces', () => {
    const state = createInitialState(SEED);
    state.player.x = 41 * TILE_SIZE;
    state.player.y = 41 * TILE_SIZE;
    state.resourceNodes = [];
    state.inventory.wood = 10;
    state.unlockedItemIds.push('wood-fence', 'wood-wall');
    const fence = buildableById('wood-fence');

    expect(fence).toMatchObject({ tilesWide: 2, tilesHigh: 1 });
    expect(placeBuilding(state, state.buildings, fence, 40, 40, { boundaryEdge: 'north' }).ok).toBe(true);

    const occupancy = buildOccupancy(state.buildings);
    expect(occupancy.boundaries.get(boundaryEdgeKey(40, 40, 'north'))?.definitionId).toBe('wood-fence');
    expect(occupancy.boundaries.get(boundaryEdgeKey(41, 40, 'north'))?.definitionId).toBe('wood-fence');

    expect(validatePlacement(
      state, state.buildings, buildableById('wood-wall'), 41, 40, { boundaryEdge: 'north' },
    )).toMatchObject({ ok: false, message: 'Edge occupied by Wood Fence' });
    expect(validatePlacement(
      state, state.buildings, fence, 42, 40, { boundaryEdge: 'north' },
    ).ok).toBe(true);
  });

  it('makes fence gates open across two consecutive boundary spaces', () => {
    const state = createInitialState(SEED);
    state.player.x = 41 * TILE_SIZE;
    state.player.y = 41 * TILE_SIZE;
    state.resourceNodes = [];
    state.inventory.wood = 10;
    state.unlockedItemIds.push('wood-gate');
    const gate = buildableById('wood-gate');

    expect(gate).toMatchObject({ tilesWide: 2, tilesHigh: 1, boundaryClass: 'gate' });
    expect(placeBuilding(state, state.buildings, gate, 40, 40, { boundaryEdge: 'north' }).ok).toBe(true);
    const occupancy = buildOccupancy(state.buildings);
    expect(occupancy.boundaries.get(boundaryEdgeKey(40, 40, 'north'))?.definitionId).toBe('wood-gate');
    expect(occupancy.boundaries.get(boundaryEdgeKey(41, 40, 'north'))?.definitionId).toBe('wood-gate');
  });

  it('places water on open ground and layers a rotatable two-tile bridge over it', () => {
    const state = createInitialState(SEED);
    state.player.x = 40 * TILE_SIZE;
    state.player.y = 40 * TILE_SIZE;
    state.resourceNodes = [];
    state.inventory.wood = 10;
    state.unlockedItemIds.push('water', 'wood-bridge');
    const water = buildableById('water');
    const bridge = buildableById('wood-bridge');

    expect(placeBuilding(state, state.buildings, water, 41, 40).ok).toBe(true);
    expect(placeBuilding(state, state.buildings, water, 42, 40).ok).toBe(true);
    expect(bridge).toMatchObject({ tilesWide: 2, tilesHigh: 1, landscapeKind: 'bridge' });
    expect(placeBuilding(state, state.buildings, bridge, 41, 40).ok).toBe(true);
    expect(state.buildings.map((building) => building.definitionId)).toEqual(['water', 'water', 'wood-bridge']);

    state.buildings.push({ id: 'existing-floor', definitionId: 'wood-floor', tileX: 43, tileY: 40 });
    expect(validatePlacement(state, state.buildings, water, 43, 40)).toMatchObject({ ok: false, message: 'Occupied by Wood Floor' });

    expect(validatePlacement(state, state.buildings, bridge, 41, 42, { rotated: true })).toMatchObject({
      ok: false,
      message: 'Bridge must span water',
    });
  });

  it('allows an unlocked facility anywhere in range on an open footprint', () => {
    const state = createInitialState(SEED);
    state.inventory.wood = 20;
    state.inventory.stone = 20;
    state.resourceNodes = [];
    state.player.facing = 'right';

    const cache = buildableById('field-cache');
    const spot = defaultGhostTile(state, cache);

    // Affordable, in range, and not overlapping — the only blocker is the area gate.
    expect(checkPlacement(state, state.buildings, cache, spot.tileX, spot.tileY).message).toMatch(/Blueprint not yet discovered/);
    state.unlockedItemIds.push('field-cache');
    expect(checkPlacement(state, state.buildings, cache, spot.tileX, spot.tileY).ok).toBe(true);
    expect(placeBuilding(state, state.buildings, cache, spot.tileX, spot.tileY).ok).toBe(true);
  });

  it('builds over a knocked-down resource and retires it permanently', () => {
    const state = createInitialState(SEED);
    state.player.x = 40 * TILE_SIZE;
    state.player.y = 40 * TILE_SIZE;
    state.inventory.wood = 20;
    state.unlockedItemIds.push('wood-floor');
    const playerX = Math.floor(state.player.x / TILE_SIZE);
    const playerY = Math.floor(state.player.y / TILE_SIZE);
    const floor = buildableById('wood-floor');
    const stump = {
      id: 'tree-900',
      kind: 'tree' as const,
      x: (playerX + 1) * TILE_SIZE + TILE_SIZE / 2,
      y: playerY * TILE_SIZE + TILE_SIZE / 2,
      hp: 0,
      maxHp: 10,
      respawnAtTick: state.tick + 100,
    };
    state.resourceNodes = [stump];

    // Standing resources still block; a depleted one is clear ground.
    expect(validatePlacement(state, state.buildings, floor, playerX + 1, playerY).ok).toBe(true);
    state.resourceNodes = [{ ...stump, hp: stump.maxHp, respawnAtTick: null }];
    expect(validatePlacement(state, state.buildings, floor, playerX + 1, playerY).message).toBe('Tree is in the way');

    // Placing over the stump drops the node, so it can never renew there.
    state.resourceNodes = [stump];
    expect(placeBuilding(state, state.buildings, floor, playerX + 1, playerY).ok).toBe(true);
    expect(state.resourceNodes).toEqual([]);
  });

  it('persists exactly two orientations and swaps a rectangular footprint', () => {
    const state = createInitialState(SEED);
    state.player.x = 40 * TILE_SIZE;
    state.player.y = 40 * TILE_SIZE;
    state.resourceNodes = [];
    state.inventory.wood = 20;
    state.unlockedItemIds.push('workbench', 'field-cache');
    const playerX = Math.floor(state.player.x / TILE_SIZE);
    const playerY = Math.floor(state.player.y / TILE_SIZE);
    const workbench = buildableById('workbench');
    expect(validatePlacement(state, state.buildings, workbench, playerX + 1, playerY - 1, { rotated: true })).toEqual({
      ok: false,
      message: 'Place it on a floor',
    });
    state.buildings.push(
      { id: 'bench-floor-a', definitionId: 'wood-floor', tileX: playerX + 1, tileY: playerY - 1 },
      { id: 'bench-floor-b', definitionId: 'thatch-floor', tileX: playerX + 1, tileY: playerY },
    );
    const placed = placeBuilding(state, state.buildings, workbench, playerX + 1, playerY - 1, { rotated: true });
    expect(placed).toMatchObject({ ok: true, building: { rotated: true } });

    const cache = buildableById('field-cache');
    expect(validatePlacement(state, state.buildings, cache, playerX + 1, playerY).message).toBe('Occupied by Workbench');
    expect(validatePlacement(state, state.buildings, cache, playerX + 2, playerY - 1).ok).toBe(true);
  });

  it('keeps exact valid clicks and magnetizes an obstructed near-edge click to a valid neighbour', () => {
    const state = createInitialState(SEED);
    state.player.x = 40 * TILE_SIZE;
    state.player.y = 40 * TILE_SIZE;
    state.resourceNodes = [];
    state.inventory.wood = 10;
    state.unlockedItemIds.push('wood-floor');
    const floor = buildableById('wood-floor');

    const exact = placementTargetFromWorld(state, floor, 41.5 * TILE_SIZE, 40.5 * TILE_SIZE);
    expect(exact).toEqual({ tileX: 41, tileY: 40, magnetized: false });

    expect(placeBuilding(state, state.buildings, floor, 41, 40).ok).toBe(true);
    const forgiven = placementTargetFromWorld(state, floor, 42 * TILE_SIZE - 1, 40.5 * TILE_SIZE);
    expect(forgiven).toEqual({ tileX: 42, tileY: 40, magnetized: true });
  });

  it('undoes the latest placement with its full material cost', () => {
    const state = createInitialState(SEED);
    state.player.x = 40 * TILE_SIZE;
    state.player.y = 40 * TILE_SIZE;
    state.resourceNodes = [];
    state.inventory.wood = 4;
    state.inventoryStacks.wood = [4];
    state.unlockedItemIds.push('wood-wall');
    const placed = placeBuilding(state, state.buildings, buildableById('wood-wall'), 41, 40, { boundaryEdge: 'north' });
    expect(placed.ok).toBe(true);
    expect(state.inventory.wood).toBe(3);

    expect(undoBuildingPlacement(state, placed.building!.id)).toMatchObject({ ok: true, message: 'Undid Wood Wall' });
    expect(state.buildings).toHaveLength(0);
    expect(state.inventory.wood).toBe(4);
    expect(state.inventoryStacks.wood).toEqual([4]);
  });
});
