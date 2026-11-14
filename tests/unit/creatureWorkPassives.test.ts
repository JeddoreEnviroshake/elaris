import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../../src/config/platform';
import { CREATURE_WORK_PASSIVES } from '../../src/content/creatureWorkPassives';
import { CREATURE_DEFINITIONS } from '../../src/content/creatures';
import { advanceCreatureWorkPassives } from '../../src/simulation/creatureWorkPassives';
import { creaturePurifiedCells } from '../../src/simulation/creatureRoles';
import { canonicalizeGameState } from '../../src/simulation/determinism';
import { structureHp, structureMaxHp } from '../../src/simulation/gameplayCommands';
import { isPlayerSheltered } from '../../src/simulation/survivalCycle';
import { createInitialState } from '../../src/simulation/state';
import type {
  BuildingDefinitionId, BuildingState, GameState, OwnedCreatureState, RaiderState, SpeciesId,
} from '../../src/simulation/state';

/**
 * One enclosed environment, id-prefixed so a test can build several without
 * the surfaces of one colliding with the boundaries of another.
 */
function environment(
  prefix: string,
  left: number,
  top: number,
  width: number,
  height: number,
  kind: 'indoor' | 'workYard',
): BuildingState[] {
  const surface: BuildingDefinitionId = kind === 'indoor' ? 'wood-floor' : 'wood-ground';
  const boundary: BuildingDefinitionId = kind === 'indoor' ? 'wood-wall' : 'wood-fence';
  const buildings: BuildingState[] = [];
  let id = 1;
  for (let y = top; y < top + height; y += 1) for (let x = left; x < left + width; x += 1) {
    buildings.push({ id: `${prefix}-surface-${id++}`, definitionId: surface, tileX: x, tileY: y });
  }
  for (let x = left; x < left + width; x += 1) {
    buildings.push({ id: `${prefix}-edge-${id++}`, definitionId: boundary, tileX: x, tileY: top, boundaryEdge: 'north' });
    buildings.push({ id: `${prefix}-edge-${id++}`, definitionId: boundary, tileX: x, tileY: top + height - 1, boundaryEdge: 'south' });
  }
  for (let y = top; y < top + height; y += 1) {
    buildings.push({ id: `${prefix}-edge-${id++}`, definitionId: boundary, tileX: left, tileY: y, boundaryEdge: 'west' });
    buildings.push({ id: `${prefix}-edge-${id++}`, definitionId: boundary, tileX: left + width - 1, tileY: y, boundaryEdge: 'east' });
  }
  buildings.push({
    id: `${prefix}-marker`, definitionId: 'environment-marker',
    tileX: left + width - 1, tileY: top + height - 1, environmentKind: kind,
  });
  return buildings;
}

/** An indoor room with the defence facilities, plus a fenced yard with the pens. */
function homestead(): BuildingState[] {
  return [
    ...environment('room', 10, 10, 5, 3, 'indoor'),
    { id: 'war-table', definitionId: 'war-table', tileX: 11, tileY: 11 },
    { id: 'turret', definitionId: 'turret', tileX: 10, tileY: 12 },
    { id: 'cache', definitionId: 'field-cache', tileX: 14, tileY: 12 },
    ...environment('yard', 20, 20, 6, 4, 'workYard'),
    { id: 'pen', definitionId: 'small-pen', tileX: 20, tileY: 20 },
    { id: 'stone-yard', definitionId: 'stone-yard', tileX: 23, tileY: 20 },
  ];
}

function creature(speciesId: SpeciesId, worksiteId: string): OwnedCreatureState {
  return {
    id: `owned-${speciesId}`,
    speciesId,
    name: speciesId,
    role: 'work',
    assignment: null,
    worksiteId,
    housingId: 'pen',
    nextWorkTick: 0,
    workRemainderMs: 0,
    bondXp: 0,
    selectedBattleAbilityId: CREATURE_DEFINITIONS
      .find((definition) => definition.speciesId === speciesId)!.encounter.battleAbilities[0]!.id,
  };
}

function hostile(id: string, x: number, y: number, roaming = false): RaiderState {
  return {
    id,
    kindId: 'scavenger',
    x,
    y,
    hp: 200,
    maxHp: 200,
    level: 1,
    targetBuildingId: null,
    nextAttackTick: 0,
    ...(roaming ? { roaming: true, homeX: x, homeY: y } : {}),
  };
}

function stagedHomestead(speciesId: SpeciesId, worksiteId: string): GameState {
  const state = createInitialState(11);
  state.buildings = homestead();
  state.ownedCreatures = [creature(speciesId, worksiteId)];
  state.tick = 10_000;
  return state;
}

function building(state: GameState, id: string): BuildingState {
  return state.buildings.find((candidate) => candidate.id === id)!;
}

describe('rebuild-walls', () => {
  it('repairs a damaged wall near its worksite on the passive interval', () => {
    const state = stagedHomestead('masonmole', 'war-table');
    const wall = state.buildings.find((candidate) => candidate.definitionId === 'wood-wall')!;
    const max = structureMaxHp(wall, state.gameBalance)!;
    wall.hp = max - 20;

    expect(advanceCreatureWorkPassives(state)).toBe(true);
    expect(structureHp(wall, state.gameBalance)).toBe(max - 20 + CREATURE_WORK_PASSIVES['rebuild-walls'].amount);

    // The clock is real: nothing happens again until the interval elapses.
    expect(advanceCreatureWorkPassives(state)).toBe(false);
    state.tick += CREATURE_WORK_PASSIVES['rebuild-walls'].intervalTicks;
    expect(advanceCreatureWorkPassives(state)).toBe(true);
  });

  it('drops the health field entirely once a structure is whole again', () => {
    const state = stagedHomestead('masonmole', 'war-table');
    const wall = state.buildings.find((candidate) => candidate.definitionId === 'wood-wall')!;
    wall.hp = structureMaxHp(wall, state.gameBalance)! - 1;

    advanceCreatureWorkPassives(state);
    expect(wall.hp).toBeUndefined();
    // Nothing is damaged any more, so the next shift finds no work at all.
    state.tick += CREATURE_WORK_PASSIVES['rebuild-walls'].intervalTicks;
    expect(advanceCreatureWorkPassives(state)).toBe(false);
  });

  it('does nothing while the creature is resting', () => {
    const state = stagedHomestead('masonmole', 'war-table');
    state.ownedCreatures[0]!.role = 'rest';
    const wall = state.buildings.find((candidate) => candidate.definitionId === 'wood-wall')!;
    wall.hp = 5;

    expect(advanceCreatureWorkPassives(state)).toBe(false);
    expect(wall.hp).toBe(5);
  });
});

describe('defend-base', () => {
  it('hits a raider that reaches the worksite', () => {
    const state = stagedHomestead('bulwark-boar', 'war-table');
    const raider = hostile('raider-1', 12 * TILE_SIZE, 11 * TILE_SIZE);
    state.raiders = [raider];

    expect(advanceCreatureWorkPassives(state)).toBe(true);
    expect(raider.hp).toBe(200 - CREATURE_WORK_PASSIVES['defend-base'].amount);
  });

  it('ignores roaming wildlife and anything out of reach', () => {
    const state = stagedHomestead('bulwark-boar', 'war-table');
    const roamer = hostile('roamer-1', 12 * TILE_SIZE, 11 * TILE_SIZE, true);
    const distant = hostile('raider-2', 40 * TILE_SIZE, 40 * TILE_SIZE);
    state.raiders = [roamer, distant];

    expect(advanceCreatureWorkPassives(state)).toBe(false);
    expect(roamer.hp).toBe(200);
    expect(distant.hp).toBe(200);
  });
});

describe('restock-turrets', () => {
  it('moves arrows out of nearby storage and into its own turret', () => {
    const state = stagedHomestead('quillfinch', 'turret');
    const cache = building(state, 'cache');
    cache.storage = { wood: 0, stone: 0, fiber: 0, arrow: 20 };

    expect(advanceCreatureWorkPassives(state)).toBe(true);
    const moved = CREATURE_WORK_PASSIVES['restock-turrets'].amount;
    expect(building(state, 'turret').turret?.ammo).toBe(moved);
    expect(cache.storage.arrow).toBe(20 - moved);
    // The stack boundaries follow the total down rather than going stale.
    expect(cache.storageStacks?.arrow).toEqual([20 - moved]);
  });

  it('does nothing when storage holds no arrows', () => {
    const state = stagedHomestead('quillfinch', 'turret');
    building(state, 'cache').storage = { wood: 0, stone: 0, fiber: 0, arrow: 0 };

    expect(advanceCreatureWorkPassives(state)).toBe(false);
    expect(building(state, 'turret').turret?.ammo ?? 0).toBe(0);
  });

  it('stops at the turret ammunition capacity', () => {
    const state = stagedHomestead('quillfinch', 'turret');
    const capacity = state.gameBalance.defense.turretAmmoCapacity;
    building(state, 'cache').storage = { wood: 0, stone: 0, fiber: 0, arrow: 99 };
    building(state, 'turret').turret = { ammo: capacity - 1, nextFireTick: 0 };

    advanceCreatureWorkPassives(state);
    expect(building(state, 'turret').turret?.ammo).toBe(capacity);
  });
});

describe('purified-zone', () => {
  it('holds a 2x2 square of clean air around the worksite', () => {
    const state = stagedHomestead('mistmoth', 'pen');
    const pen = building(state, 'pen');

    expect([...creaturePurifiedCells(state)].sort()).toEqual([
      `${pen.tileX},${pen.tileY}`,
      `${pen.tileX},${pen.tileY + 1}`,
      `${pen.tileX + 1},${pen.tileY}`,
      `${pen.tileX + 1},${pen.tileY + 1}`,
    ].sort());
  });

  it('shelters a player standing in it, and only while the creature is working', () => {
    const state = stagedHomestead('mistmoth', 'pen');
    state.player.x = 20.5 * TILE_SIZE;
    state.player.y = 20.5 * TILE_SIZE;
    expect(isPlayerSheltered(state)).toBe(true);

    state.ownedCreatures[0]!.role = 'rest';
    expect(isPlayerSheltered(state)).toBe(false);
  });

  it('has no per-tick work of its own', () => {
    const state = stagedHomestead('mistmoth', 'pen');
    expect(advanceCreatureWorkPassives(state)).toBe(false);
  });
});

describe('throw-rocks', () => {
  it('reaches roaming hostiles the base defender will not', () => {
    const state = stagedHomestead('slingtail', 'stone-yard');
    // Nine tiles out: past defend-base's reach, inside throw-rocks'.
    const roamer = hostile('roamer-1', 24 * TILE_SIZE, 30 * TILE_SIZE, true);
    state.raiders = [roamer];

    expect(advanceCreatureWorkPassives(state)).toBe(true);
    expect(roamer.hp).toBe(200 - CREATURE_WORK_PASSIVES['throw-rocks'].amount);
  });

  it('picks the nearest target and leaves the rest alone', () => {
    const state = stagedHomestead('slingtail', 'stone-yard');
    const far = hostile('roamer-far', 24 * TILE_SIZE, 30 * TILE_SIZE, true);
    const near = hostile('roamer-near', 24 * TILE_SIZE, 24 * TILE_SIZE, true);
    state.raiders = [far, near];

    advanceCreatureWorkPassives(state);
    expect(near.hp).toBe(200 - CREATURE_WORK_PASSIVES['throw-rocks'].amount);
    expect(far.hp).toBe(200);
  });
});

describe('work passive bookkeeping', () => {
  it('rests a creature whose worksite was demolished rather than working on nothing', () => {
    const state = stagedHomestead('masonmole', 'war-table');
    state.buildings = state.buildings.filter((candidate) => candidate.id !== 'war-table');
    expect(advanceCreatureWorkPassives(state)).toBe(false);
  });

  it('leaves the canonical state hashable — every write is a whole number', () => {
    const state = stagedHomestead('masonmole', 'war-table');
    const wall = state.buildings.find((candidate) => candidate.definitionId === 'wood-wall')!;
    wall.hp = structureMaxHp(wall, state.gameBalance)! - 20;
    advanceCreatureWorkPassives(state);
    expect(() => canonicalizeGameState(state)).not.toThrow();
  });

  it('gives every declared passive exactly one species to run it', () => {
    const declared = CREATURE_DEFINITIONS
      .map((definition) => definition.work?.passive)
      .filter((passive): passive is NonNullable<typeof passive> => passive != null);
    expect(new Set(declared)).toEqual(new Set(Object.keys(CREATURE_WORK_PASSIVES)));
    expect(declared.length).toBe(new Set(declared).size);
  });

  it('never gives one species both a producer resource and a passive', () => {
    for (const definition of CREATURE_DEFINITIONS) {
      if (!definition.work?.passive) continue;
      expect(definition.work.resource).toBeNull();
    }
  });
});
