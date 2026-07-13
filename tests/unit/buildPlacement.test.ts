import { describe, expect, it } from 'vitest';
import { TILE_SIZE, WORLD_TILES } from '../../src/config/platform';
import {
  BUILDABLES,
  buildableById,
  checkPlacement,
  clampTileToBounds,
  costText,
  defaultGhostTile,
  describeBuildable,
  missingCost,
  placeBuilding,
  validatePlacement,
} from '../../src/scenes/buildPlacement';
import { createInitialState } from '../../src/simulation/state';

const SEED = 1234;

describe('build placement (presentation adapter over the building sim)', () => {
  it('spawns the ghost on the tile in front of the player', () => {
    const state = createInitialState(SEED);
    const wall = buildableById('palisade-wall');
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
  });

  it('reports affordability and formats palette copy', () => {
    const state = createInitialState(SEED);
    const wall = buildableById('palisade-wall');

    expect(missingCost(state, wall.cost)).toEqual({ resource: 'wood', amount: 1 });
    state.inventory.wood = 3;
    expect(missingCost(state, wall.cost)).toBeNull();

    expect(costText({ wood: 6, stone: 2 })).toBe('6 wood + 2 stone');
    for (const def of BUILDABLES) expect(describeBuildable(def.id)).toBeTruthy();
  });

  it('rejects placement that is unaffordable, overlapping a node, on the player, or out of range', () => {
    const state = createInitialState(SEED);
    const wall = buildableById('palisade-wall');
    const { tileX, tileY } = defaultGhostTile(state, wall);

    expect(checkPlacement(state, state.buildings, wall, tileX, tileY)).toEqual({
      ok: false,
      message: 'Need 1 more wood',
    });

    state.inventory.wood = 10;
    expect(checkPlacement(state, state.buildings, wall, tileX, tileY).ok).toBe(true);

    // Player tile is blocked.
    const playerTileX = Math.floor(state.player.x / TILE_SIZE);
    const playerTileY = Math.floor(state.player.y / TILE_SIZE);
    expect(validatePlacement(state, state.buildings, wall, playerTileX, playerTileY).message).toBe(
      "You're standing there",
    );

    // Resource nodes occupy their anchor tile.
    const tree = state.resourceNodes[0]!;
    expect(
      validatePlacement(
        state,
        state.buildings,
        wall,
        Math.floor(tree.x / TILE_SIZE),
        Math.floor(tree.y / TILE_SIZE),
      ).message,
    ).toBe('Blocked');

    // Clear nodes so distance is the only remaining rule in play.
    state.resourceNodes = [];
    expect(validatePlacement(state, state.buildings, wall, playerTileX + 10, playerTileY).message).toBe(
      'Too far away',
    );
    expect(validatePlacement(state, state.buildings, wall, -1, 0).message).toBe('Out of bounds');
  });

  it('persists a placed structure to state.buildings, deducts cost, and blocks overlap', () => {
    const state = createInitialState(SEED);
    state.inventory.wood = 10;
    state.resourceNodes = []; // building-vs-building overlap is what's under test

    const wall = buildableById('palisade-wall');
    state.player.facing = 'right';
    const spot = defaultGhostTile(state, wall);

    const result = placeBuilding(state, state.buildings, wall, spot.tileX, spot.tileY);
    expect(result.ok).toBe(true);
    expect(result.building?.definitionId).toBe('palisade-wall');
    expect(state.buildings).toHaveLength(1);
    expect(state.inventory.wood).toBe(9);

    // A second wall on the same tile overlaps the persisted footprint.
    const blocked = placeBuilding(state, state.buildings, wall, spot.tileX, spot.tileY);
    expect(blocked).toEqual({ ok: false, message: 'Blocked' });
    expect(state.buildings).toHaveLength(1);
    expect(state.inventory.wood).toBe(9);
  });

  it('gates a facility placeable until its enclosure requirement is met', () => {
    const state = createInitialState(SEED);
    state.inventory.wood = 20;
    state.inventory.stone = 20;
    state.resourceNodes = [];
    state.player.facing = 'right';

    const cache = buildableById('field-cache');
    const spot = defaultGhostTile(state, cache);

    // Affordable, in range, and not overlapping — the only blocker is the area gate.
    const gated = checkPlacement(state, state.buildings, cache, spot.tileX, spot.tileY);
    expect(gated.ok).toBe(false);
    expect(gated.message).not.toBe('Too far away');
    expect(gated.message.startsWith('Need ')).toBe(false);

    // A palisade wall at the same spot is ungated, proving cost/range/location are fine.
    const wall = buildableById('palisade-wall');
    expect(checkPlacement(state, state.buildings, wall, spot.tileX, spot.tileY).ok).toBe(true);
  });
});
