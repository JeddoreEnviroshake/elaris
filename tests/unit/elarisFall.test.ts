import { describe, expect, it } from 'vitest';
import { TILE_SIZE } from '../../src/config/platform';
import { TOWN_BUILDINGS, townBuildingsInArea } from '../../src/content/townBuildings';
import { enterWorldArea } from '../../src/simulation/areas';
import {
  ELARIS_LAST_SAFE_LEVEL,
  areaDisplayName,
  hasElarisFallen,
  isElarisSanctuary,
  ruinedTownBuildings,
  servingTownBuildings,
} from '../../src/simulation/elarisFall';
import { createInitialState } from '../../src/simulation/state';
import {
  isElarisTownSafeZone,
  nearestTownBuildingDoor,
  resolveTownMovement,
  townBuildingAtPlayerDoor,
} from '../../src/simulation/town';
import { isPlayerEnclosed, isPlayerSheltered, respawnDestinations } from '../../src/simulation/survivalCycle';
import type { GameState } from '../../src/simulation/state';

const center = (tile: number): number => (tile + 0.5) * TILE_SIZE;

function placeAtDoor(state: GameState, areaKey: string, id: string): void {
  const building = townBuildingsInArea(areaKey).find((candidate) => candidate.id === id)!;
  state.player.x = center(building.door.tileX);
  state.player.y = center(building.door.tileY);
}

function stateAtLevel(level: number): GameState {
  const state = createInitialState(0xfa11);
  state.player.level = level;
  return state;
}

describe('the fall of Elaris', () => {
  it('stands through the last safe level and falls on the next', () => {
    expect(hasElarisFallen(stateAtLevel(ELARIS_LAST_SAFE_LEVEL))).toBe(false);
    expect(hasElarisFallen(stateAtLevel(ELARIS_LAST_SAFE_LEVEL + 1))).toBe(true);
    expect(isElarisSanctuary(stateAtLevel(ELARIS_LAST_SAFE_LEVEL))).toBe(true);
    expect(isElarisSanctuary(stateAtLevel(ELARIS_LAST_SAFE_LEVEL + 1))).toBe(false);
    expect(areaDisplayName(stateAtLevel(ELARIS_LAST_SAFE_LEVEL))).toBe('Elaris');
    expect(areaDisplayName(stateAtLevel(ELARIS_LAST_SAFE_LEVEL + 1))).toBe('Ruins of Elaris');
  });

  it('withdraws town protection once the town is gone', () => {
    const standing = stateAtLevel(ELARIS_LAST_SAFE_LEVEL);
    standing.player.x = center(80);
    standing.player.y = center(80);
    expect(isElarisTownSafeZone(standing)).toBe(true);
    expect(isPlayerSheltered(standing)).toBe(true);
    expect(isPlayerEnclosed(standing)).toBe(true);

    const fallen = stateAtLevel(ELARIS_LAST_SAFE_LEVEL + 1);
    fallen.player.x = center(80);
    fallen.player.y = center(80);
    expect(isElarisTownSafeZone(fallen)).toBe(false);
    expect(isPlayerSheltered(fallen)).toBe(false);
    expect(isPlayerEnclosed(fallen)).toBe(false);
  });

  it('breaches the perimeter fence', () => {
    // A step across the eastern fence run, clear of both its gate and every
    // building footprint (ruins stay solid).
    const from = { x: center(112), y: center(78) };
    const to = { x: center(108), y: center(78) };

    const standing = stateAtLevel(ELARIS_LAST_SAFE_LEVEL);
    expect(resolveTownMovement(standing, from.x, from.y, to.x, to.y).x).toBe(from.x);

    const fallen = stateAtLevel(ELARIS_LAST_SAFE_LEVEL + 1);
    expect(resolveTownMovement(fallen, from.x, from.y, to.x, to.y).x).toBe(to.x);
  });

  it('closes every Elaris door and leaves the field copies open', () => {
    const standing = stateAtLevel(ELARIS_LAST_SAFE_LEVEL);
    placeAtDoor(standing, '0,0', 'arena');
    expect(townBuildingAtPlayerDoor(standing)?.id).toBe('arena');
    expect(nearestTownBuildingDoor(standing)?.id).toBe('arena');
    expect(ruinedTownBuildings(standing)).toEqual([]);

    const fallen = stateAtLevel(ELARIS_LAST_SAFE_LEVEL + 1);
    placeAtDoor(fallen, '0,0', 'arena');
    expect(townBuildingAtPlayerDoor(fallen)).toBeNull();
    expect(nearestTownBuildingDoor(fallen)).toBeNull();
    expect(servingTownBuildings(fallen)).toEqual([]);
    expect(ruinedTownBuildings(fallen).map((building) => building.id).sort()).toEqual(
      ['arena', 'armoury', 'church', 'market', 'tavern', 'weaponsmith'],
    );

    // The arena the player must travel to instead.
    expect(enterWorldArea(fallen, -2, -2)).toBe(true);
    placeAtDoor(fallen, '-2,-2', 'arena');
    expect(townBuildingAtPlayerDoor(fallen)?.id).toBe('arena');
    expect(servingTownBuildings(fallen).map((building) => building.id)).toEqual(['arena']);
  });

  it('keeps every Elaris service reachable in the field', () => {
    const fallen = stateAtLevel(ELARIS_LAST_SAFE_LEVEL + 1);
    for (const building of townBuildingsInArea('0,0')) {
      const copy = TOWN_BUILDINGS.find((other) =>
        other.service === building.service && !other.requiresElarisStanding)!;
      expect(copy).toBeDefined();
      expect(enterWorldArea(fallen, copy.areaKey.split(',').map(Number)[0]!, copy.areaKey.split(',').map(Number)[1]!)).toBe(true);
      expect(servingTownBuildings(fallen).map((serving) => serving.service)).toContain(building.service);
    }
  });

  it('stops advertising the sanctuary respawn as enclosed shelter', () => {
    const standing = respawnDestinations(stateAtLevel(ELARIS_LAST_SAFE_LEVEL))[0]!;
    expect(standing).toMatchObject({ id: 'elaris-sanctuary', sheltered: true, safe: true });

    // The ruins give no enclosure, so a raid night finds you in the open. The
    // air is the one thing the fall does not take: the permanent purifier next
    // to the waystone still runs, so the landing tile stays breathable.
    const fallen = respawnDestinations(stateAtLevel(ELARIS_LAST_SAFE_LEVEL + 1))[0]!;
    expect(fallen).toMatchObject({ id: 'elaris-sanctuary', sheltered: false, safe: true });
    expect(fallen.label).toBe('Elaris Ruins');
  });
});
