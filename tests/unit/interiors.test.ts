import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../../src/config/platform';
import {
  interiorContentValidationErrors,
  validateInteriorPlacement,
} from '../../src/content/interiorValidation';
import {
  BODY_CLEARANCE,
  INTERIOR_DEFINITIONS,
  interiorDefinitionById,
  interiorDefinitionForBuilding,
  isInsideTownShell,
  nearestInteriorHotspot,
  reachableShellPoints,
  shellDoorstep,
  shellThreshold,
  townBuildingShell,
  townShellBlocks,
  type InteriorDefinition,
} from '../../src/content/interiors';
import { TOWN_BUILDINGS, TOWN_BUILDING_BLUEPRINTS } from '../../src/content/townBuildings';
import { createInitialState } from '../../src/simulation/state';
import {
  isPlayerInsideTownBuilding,
  isTownPositionBlocked,
  positionPlayerOutsideDoor,
  recoverPlayerFromTownWalls,
  resolveTownMovement,
  townBuildingAroundPlayer,
} from '../../src/simulation/town';
import { ELARIS_LAST_SAFE_LEVEL } from '../../src/simulation/elarisFall';

const weaponsmith = TOWN_BUILDINGS.find((building) => building.id === 'weaponsmith' && building.areaKey === '0,0')!;
const market = TOWN_BUILDINGS.find((building) => building.id === 'market' && building.areaKey === '0,0')!;

/** World pixels of a footprint-local point, rounded the way the simulation stores positions. */
function worldPoint(building: typeof weaponsmith, local: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.round((building.footprint.tileX + local.x) * TILE_SIZE),
    y: Math.round((building.footprint.tileY + local.y) * TILE_SIZE),
  };
}

describe('walk-in town interiors', () => {
  it('defines one valid, linked room for every town building', () => {
    // One room per blueprint, not per placement: a field copy of a service is
    // furnished exactly like its Elaris original, and validated at its own site.
    expect(INTERIOR_DEFINITIONS).toHaveLength(TOWN_BUILDING_BLUEPRINTS.length);
    expect(interiorContentValidationErrors()).toEqual([]);
    for (const building of TOWN_BUILDINGS) {
      const interior = interiorDefinitionById(building.interiorId);
      expect(interior.buildingId).toBe(building.id);
      expect(interiorDefinitionForBuilding(building.id)).toBe(interior);
      expect(interior.npcSpawns.some((spawn) => spawn.npcId === building.npcId)).toBe(true);
    }
  });

  it('builds each room inside its own footprint, with the doorway on the saved door', () => {
    for (const building of TOWN_BUILDINGS) {
      const shell = townBuildingShell(building);
      expect(shell.left).toBeGreaterThan(0);
      expect(shell.top).toBeGreaterThan(0);
      expect(shell.right).toBeLessThan(building.footprint.tilesWide);
      expect(shell.bottom).toBeLessThan(building.footprint.tilesHigh);
      const doorCentre = building.door.tileX - building.footprint.tileX + building.doorWidth / 2;
      expect(shell.door.along, `${building.id} at ${building.areaKey}`).toBeCloseTo(doorCentre);
      const threshold = shellThreshold(shell);
      expect(isInsideTownShell(shell, threshold.x, threshold.y)).toBe(true);
      expect(townShellBlocks(shell, interiorDefinitionById(building.interiorId), threshold.x, threshold.y)).toBe(false);
    }
  });

  it('reaches every keeper and hotspot on foot from outside each doorway', () => {
    for (const building of TOWN_BUILDINGS) {
      const shell = townBuildingShell(building);
      const interior = interiorDefinitionById(building.interiorId);
      const reachable = reachableShellPoints(shell, interior);
      for (const hotspot of interior.hotspots) {
        expect(reachable.some((point) => nearestInteriorHotspot(interior, point.x, point.y)?.id === hotspot.id),
          `${building.id} at ${building.areaKey}: ${hotspot.id}`).toBe(true);
      }
    }
  });

  it('solidifies walls, furniture and keepers, but never the doorway', () => {
    const shell = townBuildingShell(weaponsmith);
    const forge = interiorDefinitionForBuilding('weaponsmith');
    // A wall line, away from the door, is solid from both sides.
    expect(townShellBlocks(shell, forge, shell.left, 2.5)).toBe(true);
    expect(townShellBlocks(shell, forge, 1.5, shell.bottom)).toBe(true);
    // The doorway passage is open from the footprint edge into the room.
    for (let y = 3; y < weaponsmith.footprint.tilesHigh; y += 0.125) {
      expect(townShellBlocks(shell, forge, shell.door.along, y), `doorway at y ${y}`).toBe(false);
    }
    // Just past the doorway's jamb the wall is solid again.
    expect(townShellBlocks(shell, forge, shell.door.along + 0.8, shell.bottom)).toBe(true);
    // The anvil and Mara are solid; the floor between them is not.
    const anvil = forge.props.find((prop) => prop.id === 'anvil')!;
    expect(townShellBlocks(shell, forge, anvil.x, anvil.y)).toBe(true);
    const mara = forge.npcSpawns[0]!;
    expect(townShellBlocks(shell, forge, mara.x, mara.y)).toBe(true);
    expect(townShellBlocks(shell, forge, mara.x + 0.25 + BODY_CLEARANCE + 0.05, mara.y + 0.6)).toBe(false);
    // Outside the footprint the shell claims nothing.
    expect(townShellBlocks(shell, forge, -0.5, 2)).toBe(false);
  });

  it('lets the player walk in through the door and stand indoors', () => {
    const state = createInitialState(42);
    const shell = townBuildingShell(weaponsmith);
    const outside = worldPoint(weaponsmith, shellDoorstep(shell));
    const inside = worldPoint(weaponsmith, shellThreshold(shell));
    state.player.x = outside.x;
    state.player.y = outside.y;
    expect(isPlayerInsideTownBuilding(state)).toBe(false);
    // Step pixel by pixel from the doorstep to the threshold, as movement does.
    while (state.player.y !== inside.y) {
      const next = resolveTownMovement(state, state.player.x, state.player.y, state.player.x, state.player.y - 1);
      expect(next.y, `blocked at ${state.player.y}`).toBe(state.player.y - 1);
      state.player.y = next.y;
    }
    expect(isPlayerInsideTownBuilding(state)).toBe(true);
    expect(townBuildingAroundPlayer(state)?.id).toBe('weaponsmith');

    // A step sideways into the wall beside the doorway is refused.
    state.player.x = outside.x;
    state.player.y = worldPoint(weaponsmith, { x: 0, y: shell.bottom }).y;
    const sideways = resolveTownMovement(state, state.player.x, state.player.y, state.player.x + TILE_SIZE, state.player.y);
    expect(sideways.x).toBe(state.player.x);
  });

  it('keeps a ruin\'s walls but not its roof or keeper', () => {
    const state = createInitialState(43);
    state.player.level = ELARIS_LAST_SAFE_LEVEL + 1;
    const inside = worldPoint(market, { x: 4.5, y: 2.5 });
    state.player.x = inside.x;
    state.player.y = inside.y;
    expect(isPlayerInsideTownBuilding(state)).toBe(false);
    expect(townBuildingAroundPlayer(state)).toBeNull();
    // The counter is gone with the keeper; the walls still stand.
    const tavi = interiorDefinitionForBuilding('market').npcSpawns[0]!;
    const atTavi = worldPoint(market, tavi);
    expect(isTownPositionBlocked(state, atTavi.x, atTavi.y)).toBe(false);
    const wall = worldPoint(market, { x: townBuildingShell(market).left, y: 3 });
    expect(isTownPositionBlocked(state, wall.x, wall.y)).toBe(true);
  });

  it('recovers a position stuck in a wall to the doorstep and leaves walkable ones alone', () => {
    const state = createInitialState(44);
    // The old interior visit parked the player on the door tile, which is now
    // the wall line beside the doorway when the door is off-centre.
    const wall = worldPoint(weaponsmith, { x: 1, y: townBuildingShell(weaponsmith).bottom });
    state.player.x = wall.x;
    state.player.y = wall.y;
    expect(recoverPlayerFromTownWalls(state)?.id).toBe('weaponsmith');
    const doorstep = worldPoint(weaponsmith, shellDoorstep(townBuildingShell(weaponsmith)));
    expect(state.player).toMatchObject({ x: doorstep.x, y: doorstep.y, facing: 'down' });
    expect(Number.isInteger(state.player.x) && Number.isInteger(state.player.y)).toBe(true);

    const inside = worldPoint(weaponsmith, shellThreshold(townBuildingShell(weaponsmith)));
    state.player.x = inside.x;
    state.player.y = inside.y;
    expect(recoverPlayerFromTownWalls(state)).toBeNull();
    expect(state.player.x).toBe(inside.x);

    positionPlayerOutsideDoor(state, market);
    expect(state.player.facing).toBe('up');
    expect(isTownPositionBlocked(state, state.player.x, state.player.y)).toBe(false);
  });

  it('lets a player stuck inside something solid walk free', () => {
    const state = createInitialState(45);
    const anvil = interiorDefinitionForBuilding('weaponsmith').props.find((prop) => prop.id === 'anvil')!;
    const stuck = worldPoint(weaponsmith, anvil);
    state.player.x = stuck.x;
    state.player.y = stuck.y;
    expect(isTownPositionBlocked(state, stuck.x, stuck.y)).toBe(true);
    const moved = resolveTownMovement(state, stuck.x, stuck.y, stuck.x + 1, stuck.y);
    expect(moved.x).toBe(stuck.x + 1);
  });

  it('reports a layout that walls a keeper off from the doorway', () => {
    const forge = interiorDefinitionById('weaponsmith-forge');
    expect(interiorContentValidationErrors([forge, forge])).toContain('interior:weaponsmith-forge is duplicated');
    const sealed: InteriorDefinition = {
      ...forge,
      props: [...forge.props, { id: 'barricade', prefab: 'counter', x: 3.5, y: 4.0, rotationDegrees: 0, scale: 2.2 }],
    };
    const errors = validateInteriorPlacement(sealed, weaponsmith);
    expect(errors).toContain('interior:weaponsmith-forge at 0,0 hotspot:mara-service cannot be reached from the doorway');
  });
});
