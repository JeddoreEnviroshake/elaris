import { describe, expect, it } from 'vitest';
import { learnBlueprint } from '../../src/simulation/blueprintKnowledge';
import { TILE_SIZE, WORLD_TILES } from '../../src/config/platform';
import { createGridMovementState, stepMovement } from '../../src/simulation/commands';
import { craftRowboat, craftTool, toggleRowboat } from '../../src/simulation/gameplayCommands';
import { terrainAt, terrainAtWithBuildings, terrainCapabilities } from '../../src/simulation/landscape';
import { createInitialState, type GameState } from '../../src/simulation/state';
import { reconcileElarisWaters } from '../../src/simulation/areas';
import { enclosedEnvironment } from './helpers/buildings';

const SEED = 1234;
const ELARIS = { key: '0,0', x: 0, y: 0, name: 'Elaris', theme: 'elaris' as const, seed: SEED };

function shorelineAt(tileY = 70): { landX: number; waterX: number } {
  for (let tileX = 1; tileX < WORLD_TILES; tileX += 1) {
    const left = terrainAt(SEED, ELARIS, tileX - 1, tileY);
    const current = terrainAt(SEED, ELARIS, tileX, tileY);
    if (terrainCapabilities(left).walkable && terrainCapabilities(current).boatable) {
      return { landX: tileX - 1, waterX: tileX };
    }
  }
  throw new Error('expected an Elaris shoreline');
}

function addWorkingWorkbench(state: GameState): void {
  state.buildings = enclosedEnvironment(10, 10, 3, 3, 'indoor');
  state.buildings.push({ id: 'workbench-test', definitionId: 'workbench', tileX: 10, tileY: 11 });
  state.player.x = 11 * TILE_SIZE;
  state.player.y = 11.5 * TILE_SIZE;
}

describe('authoritative landscape', () => {
  it('samples the identical global terrain through either side of a region border', () => {
    const right = { ...ELARIS, key: '1,0', x: 1, name: 'East', theme: 'forest' as const };
    for (let tileY = 0; tileY < WORLD_TILES; tileY += 7) {
      expect(terrainAt(SEED, ELARIS, WORLD_TILES, tileY)).toBe(terrainAt(SEED, right, 0, tileY));
    }
  });

  it('gives Elaris a blocking river and a walkable bridge', () => {
    const riverTiles = Array.from({ length: WORLD_TILES }, (_, tileX) => terrainAt(SEED, ELARIS, tileX, 70));
    expect(riverTiles.some((kind) => terrainCapabilities(kind).boatable)).toBe(true);
    expect(Array.from({ length: WORLD_TILES }, (_, tileX) => terrainAt(SEED, ELARIS, tileX, 83)).some((kind) => kind === 'bridge')).toBe(true);
  });

  it('wraps the Elaris fence in a moat with gate causeways', () => {
    // Every authored run has water immediately outside it, including the
    // western/southern runs that overlap the town's dry precinct rectangle.
    expect(terrainAt(SEED, ELARIS, 90, 68)).toBe('deep-water');
    expect(terrainAt(SEED, ELARIS, 111, 80)).toBe('deep-water');
    expect(terrainAt(SEED, ELARIS, 100, 93)).toBe('deep-water');
    expect(terrainAt(SEED, ELARIS, 88, 95)).toBe('deep-water');
    expect(terrainAt(SEED, ELARIS, 75, 104)).toBe('deep-water');
    expect(terrainAt(SEED, ELARIS, 60, 94)).toBe('deep-water');
    expect(terrainAt(SEED, ELARIS, 90, 72)).toBe('ground');
    expect(terrainAt(SEED, ELARIS, 104, 67)).toBe('bridge');
  });

  it('places the north-west water temple on a dry island in a large lake', () => {
    expect(terrainAt(SEED, ELARIS, 24, 24)).toBe('ground');
    expect(terrainAt(SEED, ELARIS, 34, 24)).toBe('deep-water');
    expect(terrainAt(SEED, ELARIS, 44, 24)).toBe('shallow-water');
    expect(terrainAt(SEED, ELARIS, 46, 24)).toBe('ground');
  });

  it('clears pre-upgrade generated scenery from the new Elaris waters and temple island', () => {
    const state = createInitialState(SEED);
    state.resourceNodes = [
      { id: 'lake-stone', kind: 'stone', x: 34.5 * TILE_SIZE, y: 24.5 * TILE_SIZE, hp: 1, maxHp: 1, respawnAtTick: null },
      { id: 'temple-tree', kind: 'tree', x: 24.5 * TILE_SIZE, y: 24.5 * TILE_SIZE, hp: 1, maxHp: 1, respawnAtTick: null },
      { id: 'dry-stone', kind: 'stone', x: 50.5 * TILE_SIZE, y: 24.5 * TILE_SIZE, hp: 1, maxHp: 1, respawnAtTick: null },
    ];
    reconcileElarisWaters(state);
    expect(state.resourceNodes.map((node) => node.id)).toEqual(['dry-stone']);
  });

  it('keeps the authored eastern road walkable through every first-expedition region', () => {
    for (const [x, name, theme] of [
      [0, 'Elaris', 'elaris'],
      [1, 'Verdant Reach', 'meadow'],
      [2, 'Sylvaren', 'forest'],
    ] as const) {
      const area = { key: `${x},0`, x, y: 0, name, theme, seed: SEED };
      expect(Array.from({ length: WORLD_TILES }, (_, tileX) =>
        terrainCapabilities(terrainAt(SEED, area, tileX, 85)).walkable,
      ).every(Boolean)).toBe(true);
    }
  });

  it('blocks foot movement into water but allows boat movement', () => {
    const state = createInitialState(SEED);
    const movement = createGridMovementState();
    const shore = shorelineAt();
    state.player.x = (shore.landX + 0.5) * TILE_SIZE;
    state.player.y = 70.5 * TILE_SIZE;

    // On foot the collision box stops at the shoreline and never enters water.
    for (let tick = 0; tick < 60; tick += 1) stepMovement(state, { x: 1, y: 0, slow: false, continuous: true }, 1000 / 60, movement);
    expect(Math.floor((state.player.x + 4) / TILE_SIZE)).toBe(shore.landX);

    // Afloat the same box stops at the shoreline from the water side.
    state.rowboatOwned = true;
    state.player.traversalMode = 'boat';
    state.player.x = (shore.waterX + 0.5) * TILE_SIZE;
    for (let tick = 0; tick < 60; tick += 1) stepMovement(state, { x: -1, y: 0, slow: false, continuous: true }, 1000 / 60, movement);
    expect(Math.floor((state.player.x - 5) / TILE_SIZE)).toBe(shore.waterX);
    expect(state.player.x).toBeLessThan((shore.waterX + 0.5) * TILE_SIZE);
  });

  it('lets placed water override ground and a placed bridge override that water', () => {
    const buildings: GameState['buildings'] = [
      { id: 'water-a', definitionId: 'water', tileX: 40, tileY: 40 },
      { id: 'water-b', definitionId: 'water', tileX: 41, tileY: 40 },
    ];
    expect(terrainAtWithBuildings(SEED, ELARIS, buildings, 40, 40)).toBe('shallow-water');
    buildings.push({ id: 'bridge', definitionId: 'stone-bridge', tileX: 40, tileY: 40 });
    expect(terrainAtWithBuildings(SEED, ELARIS, buildings, 40, 40)).toBe('bridge');
    expect(terrainAtWithBuildings(SEED, ELARIS, buildings, 41, 40)).toBe('bridge');
  });
});

describe('bow', () => {
  it('is handcrafted into the bag rather than owned, with no workbench needed', () => {
    const state = createInitialState(SEED);
    state.inventory.wood = 12;
    state.inventory.fiber = 6;
    state.unlockedItemIds.push('bow');
    expect(craftTool(state, 'bow')).toMatchObject({ ok: true });
    // A carried, wearing tool that occupies a bag slot — not a durable flag.
    expect(state.tools.map((tool) => tool.definitionId)).toContain('bow');
    expect(state.inventory).toMatchObject({ wood: 0, fiber: 0 });
  });
});

describe('rowboat', () => {
  it('is crafted once at a usable workbench', () => {
    const state = createInitialState(SEED);
    learnBlueprint(state, 'rowboat');
    addWorkingWorkbench(state);
    state.inventory.wood = 24;
    state.inventory.fiber = 8;

    expect(craftRowboat(state)).toMatchObject({ ok: true });
    expect(state.rowboatOwned).toBe(true);
    expect(state.inventory).toMatchObject({ wood: 0, fiber: 0 });
    expect(craftRowboat(state)).toMatchObject({ ok: false });
  });

  it('launches and disembarks only across a shoreline', () => {
    const state = createInitialState(SEED);
    const shore = shorelineAt();
    state.rowboatOwned = true;
    state.player.x = (shore.landX + 0.5) * TILE_SIZE;
    state.player.y = 70.5 * TILE_SIZE;
    state.player.facing = 'right';

    expect(toggleRowboat(state)).toMatchObject({ ok: true, message: 'Rowboat launched' });
    expect(state.player.traversalMode).toBe('boat');
    expect(Math.floor(state.player.x / TILE_SIZE)).toBe(shore.waterX);

    state.player.facing = 'left';
    expect(toggleRowboat(state)).toMatchObject({ ok: true, message: 'Stepped ashore' });
    expect(state.player.traversalMode).toBe('foot');
    expect(Math.floor(state.player.x / TILE_SIZE)).toBe(shore.landX);
  });
});
