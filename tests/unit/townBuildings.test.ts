import { describe, expect, it } from 'vitest';
import { WORLD_TILES } from '../../src/config/platform';
import {
  TOWN_BUILDINGS,
  isTownFootprintWorldPosition,
  isWithinTownPrecinct,
  outsideDoorTile,
  townBuildingDoorTiles,
  townBuildingsInArea,
} from '../../src/content/townBuildings';
import { buildableById, validatePlacement } from '../../src/simulation/gameplayCommands';
import { enterWorldArea } from '../../src/simulation/areas';
import { createInitialState } from '../../src/simulation/state';
import {
  generateResourceNodes,
  generateWildCreatures,
  starterGroveAnchor,
} from '../../src/simulation/worldGeneration';
import { isWithinTownSafeZoneWorldPosition } from '../../src/content/townDefences';

function overlaps(a: typeof TOWN_BUILDINGS[number], b: typeof TOWN_BUILDINGS[number]): boolean {
  const af = a.footprint; const bf = b.footprint;
  return af.tileX < bf.tileX + bf.tilesWide && bf.tileX < af.tileX + af.tilesWide
    && af.tileY < bf.tileY + bf.tilesHigh && bf.tileY < af.tileY + af.tilesHigh;
}

describe('settlement building registry', () => {
  it('defines valid, reachable, non-overlapping footprints', () => {
    // A service may stand in two places, but never twice in one area.
    const placementKeys = TOWN_BUILDINGS.map((building) => `${building.id}@${building.areaKey}`);
    expect(new Set(placementKeys).size).toBe(TOWN_BUILDINGS.length);
    for (const building of TOWN_BUILDINGS) {
      const footprint = building.footprint;
      expect(footprint.tilesWide).toBeGreaterThan(0);
      expect(footprint.tilesHigh).toBeGreaterThan(0);
      expect(footprint.tileX).toBeGreaterThanOrEqual(0);
      expect(footprint.tileY).toBeGreaterThanOrEqual(0);
      expect(footprint.tileX + footprint.tilesWide).toBeLessThanOrEqual(WORLD_TILES);
      expect(footprint.tileY + footprint.tilesHigh).toBeLessThanOrEqual(WORLD_TILES);
      const onPerimeter = building.door.tileX === footprint.tileX
        || building.door.tileX === footprint.tileX + footprint.tilesWide - 1
        || building.door.tileY === footprint.tileY
        || building.door.tileY === footprint.tileY + footprint.tilesHigh - 1;
      expect(onPerimeter).toBe(true);
      const doorTiles = townBuildingDoorTiles(building);
      expect(doorTiles).toHaveLength(2);
      expect(doorTiles.every((door) => door.tileY === building.door.tileY)).toBe(true);
      expect(doorTiles.every((door) => door.tileX >= footprint.tileX
        && door.tileX < footprint.tileX + footprint.tilesWide)).toBe(true);
      const outside = outsideDoorTile(building);
      expect(TOWN_BUILDINGS.some((other) => {
        if (other.areaKey !== building.areaKey) return false;
        const f = other.footprint;
        return outside.tileX >= f.tileX && outside.tileX < f.tileX + f.tilesWide
          && outside.tileY >= f.tileY && outside.tileY < f.tileY + f.tilesHigh;
      })).toBe(false);
    }
    for (let i = 0; i < TOWN_BUILDINGS.length; i += 1) {
      for (let j = i + 1; j < TOWN_BUILDINGS.length; j += 1) {
        if (TOWN_BUILDINGS[i]!.areaKey === TOWN_BUILDINGS[j]!.areaKey) {
          expect(overlaps(TOWN_BUILDINGS[i]!, TOWN_BUILDINGS[j]!)).toBe(false);
        }
      }
    }
    expect(townBuildingsInArea('0,0').map((building) => building.id)).not.toContain('farm');
    expect(townBuildingsInArea('0,0').map((building) => building.id)).not.toContain('magic-shop');
    expect(townBuildingsInArea('1,0').map((building) => building.id)).toEqual(['farm']);
    expect(townBuildingsInArea('2,0').map((building) => building.id)).toEqual(['magic-shop']);
    // Every Elaris service has exactly one field copy to fall back on.
    for (const building of townBuildingsInArea('0,0')) {
      expect(building.requiresElarisStanding).toBe(true);
      const copies = TOWN_BUILDINGS.filter((other) =>
        other.id === building.id && !other.requiresElarisStanding);
      expect(copies).toHaveLength(1);
      expect(copies[0]!.areaKey).not.toBe('0,0');
    }
  });

  it('excludes Elaris resources, wild spawns, and player build placement from town footprints', () => {
    const resources = generateResourceNodes(0xe1a71);
    const creatures = generateWildCreatures(0xe1a71, '', true);
    // No resource ever sits on a building footprint.
    expect(resources.every((node) => !isTownFootprintWorldPosition(node.x, node.y))).toBe(true);
    expect(creatures.every((creature) => !isTownFootprintWorldPosition(creature.x, creature.y))).toBe(true);
    // Nothing generates inside the precinct or anywhere inside the walls — the
    // spawn point included. The tutorial cluster is the grove outside the gate.
    expect(resources.some((node) => isWithinTownPrecinct(node.x, node.y))).toBe(false);
    expect(resources.some((node) => isWithinTownSafeZoneWorldPosition(node.x, node.y))).toBe(false);
    const grove = starterGroveAnchor(0xe1a71);
    const groveNodes = resources.filter((node) =>
      Math.hypot(node.x - grove.x, node.y - grove.y) <= 96);
    expect(groveNodes.filter((node) => node.kind === 'tree').length).toBeGreaterThanOrEqual(3);
    expect(groveNodes.filter((node) => node.kind === 'plant').length).toBeGreaterThanOrEqual(2);
    expect(groveNodes.filter((node) => node.kind === 'stone').length).toBeGreaterThanOrEqual(2);

    const state = createInitialState(123);
    // Findable caches obey the same wall, in the world the player actually gets.
    expect(state.resourceNodes.some((node) => isWithinTownSafeZoneWorldPosition(node.x, node.y))).toBe(false);
    expect(state.containers.some((container) =>
      isWithinTownSafeZoneWorldPosition(container.x, container.y))).toBe(false);
    const weaponsmith = TOWN_BUILDINGS[0]!;
    state.player.x = weaponsmith.footprint.tileX * 16;
    state.player.y = weaponsmith.footprint.tileY * 16;
    expect(validatePlacement(
      state,
      state.buildings,
      buildableById('thatch-floor'),
      weaponsmith.footprint.tileX,
      weaponsmith.footprint.tileY,
    )).toMatchObject({ ok: false, message: 'Reserved for Elaris' });
  });

  it('clears generated entities and player construction from regional service precincts', () => {
    const state = createInitialState(321);
    expect(enterWorldArea(state, 1, 0)).toBe(true);
    expect(state.resourceNodes.every((node) => !isWithinTownPrecinct(node.x, node.y, '1,0'))).toBe(true);
    expect(state.wildCreatures.every((creature) => !isTownFootprintWorldPosition(creature.x, creature.y, '1,0'))).toBe(true);

    const farm = townBuildingsInArea('1,0')[0]!;
    expect(validatePlacement(
      state,
      state.buildings,
      buildableById('thatch-floor'),
      farm.footprint.tileX,
      farm.footprint.tileY,
    )).toMatchObject({ ok: false, message: 'Reserved for Verdant Reach' });
  });
});
