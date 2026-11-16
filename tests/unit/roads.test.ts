import { describe, expect, it } from 'vitest';
import { isResourceClearOfRoad, isRoadPosition, isRoadTile } from '../../src/content/roads';
import { TILE_SIZE, WORLD_TILES } from '../../src/config/platform';
import { authoredWorldAreaAt } from '../../src/content/world';
import { generateAreaResourceNodes, generateResourceNodes, starterResourceNodes } from '../../src/simulation/worldGeneration';
import { terrainAt, terrainWithoutBridgesAt } from '../../src/simulation/landscape';
import { createInitialState } from '../../src/simulation/state';
import { enterWorldArea, reconcileRoadResources, saveCurrentArea } from '../../src/simulation/areas';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { migrateToCurrent } from '../../src/persistence/migrations';
import { storageBoxContents } from '../../src/simulation/storageBox';

describe('roads, scenery clearance, and real water crossings', () => {
  it('upgrades a v88 road-side save without losing inventory or player storage', () => {
    const state = createInitialState(42); state.inventory.wood = 17;
    state.buildings.push({ id: 'player-road-box', definitionId: 'field-cache', tileX: 30, tileY: 85, storage: { ...state.inventory, wood: 12, fiber: 0, stone: 0 } });
    storageBoxContents(state.buildings[0]!);
    const loaded = migrateToCurrent({ meta: { saveVersion: 88, contentVersion: 66, worldGenVersion: 12, appVersion: 'test', savedAt: 1 }, state }).save;
    expect(loaded.meta).toMatchObject({ saveVersion: 91, contentVersion: 69, worldGenVersion: 13 });
    expect(loaded.state.inventory.wood).toBe(17); expect(loaded.state.buildings[0]!.storage!.wood).toBe(12);
  });
  it('covers the full four-tile main road and bridges exactly the wet parts across seeds and regions', () => {
    for (const seed of [0, 1, 7, 42, 1234, 0xffffffff]) for (const [x, y] of [[0, 0], [1, 0], [2, 0], [-3, 0]] as const) {
      const area = authoredWorldAreaAt(x, y)!;
      for (let tileY = 83; tileY <= 86; tileY++) for (let tileX = 0; tileX < WORLD_TILES; tileX++) {
        expect(isRoadTile(area.key, tileX, tileY)).toBe(true);
        const base = terrainWithoutBridgesAt(seed, area, tileX, tileY);
        expect(terrainAt(seed, area, tileX, tileY)).toBe(base === 'shallow-water' || base === 'deep-water' ? 'bridge' : 'ground');
      }
    }
  });

  it('never authors a bridge over dry terrain, including town causeways and procedural river crossings', () => {
    for (const seed of [42, 1234, 99]) for (const [x, y] of [[0, 0], [-3, 0]] as const) {
      const area = authoredWorldAreaAt(x, y)!; let bridges = 0;
      for (let tileY = 0; tileY < WORLD_TILES; tileY++) for (let tileX = 0; tileX < WORLD_TILES; tileX++) {
        if (terrainAt(seed, area, tileX, tileY) !== 'bridge') continue;
        bridges++; expect(['shallow-water', 'deep-water']).toContain(terrainWithoutBridgesAt(seed, area, tileX, tileY));
      }
      expect(bridges).toBeGreaterThan(0);
    }
  });

  it('keeps resource footprints away from main roads, town paths, and the square while retaining every starter fixture', () => {
    for (const seed of [0, 1, 7, 42, 99, 12345, 0xffffffff]) {
      const nodes = generateResourceNodes(seed);
      expect(nodes.every((node) => isResourceClearOfRoad('0,0', node))).toBe(true);
      for (const starter of starterResourceNodes(seed)) expect(nodes).toContainEqual(starter);
      const area = authoredWorldAreaAt(1, 0)!;
      const remote = generateAreaResourceNodes(seed, { tree: 100, stone: 100, metal: 20, plant: 60, 'berry-bush': 20 }, false, undefined, area, seed, area.key);
      expect(remote.length).toBeGreaterThan(100); expect(remote.every((node) => isResourceClearOfRoad(area.key, node))).toBe(true);
    }
    expect(isRoadPosition('0,0', 82, 84)).toBe(true);
    expect(isResourceClearOfRoad('0,0', { kind: 'tree', x: 40 * TILE_SIZE, y: 88.5 * TILE_SIZE })).toBe(false);
  });

  it('cleans old active and visited scenery, relocates existing starter IDs without restoring HP, and preserves player property', () => {
    const state = createInitialState(42); const starter = { ...starterResourceNodes(42)[0]!, x: 52 * TILE_SIZE, y: 85 * TILE_SIZE, hp: 0, respawnAtTick: 12345 };
    const offRoad = { ...starter, id: 'off-road', x: 40 * TILE_SIZE, y: 45 * TILE_SIZE };
    state.resourceNodes = [starter, offRoad, { ...starter, id: 'old-road-rock', kind: 'stone' }];
    state.buildings.push({ id: 'player-road-storage', definitionId: 'field-cache', tileX: 40, tileY: 85, storage: { wood: 12, stone: 0, fiber: 0 } });
    saveCurrentArea(state); const home = state.visitedAreas['0,0']!;
    state.visitedAreas['1,0'] = { ...home, key: '1,0', x: 1, name: 'East', resourceNodes: [{ ...starter, id: 'east-road-rock', kind: 'stone' }], buildings: [] };
    const property = structuredClone(state.buildings); const bag = { ...state.inventory }; const progress = structuredClone(state.onboarding);
    reconcileRoadResources(state);
    expect(state.resourceNodes.find((node) => node.id === starter.id)).toMatchObject({ hp: 0, respawnAtTick: 12345 });
    expect(state.resourceNodes.find((node) => node.id === starter.id)).toMatchObject({ x: starterResourceNodes(42)[0]!.x, y: starterResourceNodes(42)[0]!.y });
    expect(state.resourceNodes.some((node) => node.id === 'old-road-rock')).toBe(false); expect(state.resourceNodes).toContainEqual(offRoad);
    expect(state.visitedAreas['1,0']!.resourceNodes).toEqual([]); expect(state.buildings).toEqual(property); expect(state.inventory).toEqual(bag); expect(state.onboarding).toEqual(progress);
    const before = canonicalizeGameState(state); reconcileRoadResources(state); expect(canonicalizeGameState(state)).toBe(before);
    enterWorldArea(state, 1, 0); expect(state.resourceNodes).toEqual([]);
  });
});
