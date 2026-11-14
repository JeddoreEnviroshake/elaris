import { TILE_SIZE } from '../config/platform';
import type { NpcId, NpcService } from './npcs';
import type { InteriorId } from './interiors';

export type TownBuildingId =
  | 'weaponsmith'
  | 'farm'
  | 'market'
  | 'church'
  | 'armoury'
  | 'magic-shop'
  | 'tavern'
  | 'arena';

export interface TilePoint { tileX: number; tileY: number }
export interface TileFootprint extends TilePoint { tilesWide: number; tilesHigh: number }

/** CSS and procedural-art colors shared by the exterior and interior renderers. */
export interface InteriorThemePalette {
  /** Free-form motif key: unknown future motifs still receive the generic shell. */
  id: string;
  background: string;
  surface: string;
  accent: string;
  glow: string;
  ink: string;
  exteriorWall: number;
  exteriorRoof: number;
  exteriorAccent: number;
}

/**
 * One physical place a service occupies. A service may stand in more than one
 * place: Elaris holds the convenient copy, and a weathered field copy of the
 * same building waits out in the world. Both doors open the one authored
 * interior, so a duplicate costs a site rather than a whole room.
 */
export interface TownBuildingSite {
  /** Surface-area coordinate key containing this authored building. */
  areaKey: string;
  footprint: TileFootprint;
  /** First perimeter tile occupied by the doorway. */
  door: TilePoint;
  /** Number of adjacent perimeter tiles occupied by the doorway. */
  doorWidth: number;
  /** Site-specific sign; the blueprint's name is used when this is absent. */
  displayName?: string;
  /**
   * Elaris sites are only in service while the town stands. Once it falls they
   * remain on the map as ruins, and the field copy carries the service.
   */
  requiresElarisStanding?: true;
}

/**
 * Static settlement services. Adding another service building only requires a new
 * registry entry plus an NPC/service implementation; generation, collision,
 * door detection, exterior rendering, and the interior shell consume this data.
 */
export interface TownBuildingBlueprint {
  id: TownBuildingId;
  displayName: string;
  /** Renderer-neutral local room definition entered through this building. */
  interiorId: InteriorId;
  service: NpcService;
  npcId: NpcId;
  interiorTheme: InteriorThemePalette;
  sites: readonly TownBuildingSite[];
}

/**
 * A blueprint resolved at one of its sites. Everything downstream of the
 * registry — generation, collision, doors, rendering — consumes placements, so
 * a second copy of a service is data rather than a code path.
 */
export interface TownBuildingDefinition {
  id: TownBuildingId;
  areaKey: string;
  displayName: string;
  interiorId: InteriorId;
  service: NpcService;
  npcId: NpcId;
  footprint: TileFootprint;
  door: TilePoint;
  doorWidth: number;
  interiorTheme: InteriorThemePalette;
  /** True for the Elaris copies that become ruins once the town falls. */
  requiresElarisStanding: boolean;
}

export const TOWN_BUILDING_BLUEPRINTS: readonly TownBuildingBlueprint[] = [
  {
    id: 'weaponsmith', displayName: 'Weaponsmith', interiorId: 'weaponsmith-forge', service: 'weaponsmith', npcId: 'mara-smith',
    interiorTheme: {
      id: 'forge', background: '#160f0d', surface: '#35201a', accent: '#ffb24d', glow: '#ff6b2d', ink: '#fff0d6',
      exteriorWall: 0x765044, exteriorRoof: 0x3e3434, exteriorAccent: 0xe27a32,
    },
    sites: [
      {
        areaKey: '0,0', requiresElarisStanding: true,
        footprint: { tileX: 72, tileY: 74, tilesWide: 7, tilesHigh: 6 },
        door: { tileX: 75, tileY: 79 }, doorWidth: 2,
      },
      {
        areaKey: '-3,0', displayName: 'Cinderpost Forge',
        footprint: { tileX: 76, tileY: 70, tilesWide: 7, tilesHigh: 6 },
        door: { tileX: 78, tileY: 75 }, doorWidth: 2,
      },
    ],
  },
  {
    id: 'farm', displayName: 'Verdant Reach Farm', interiorId: 'verdant-reach-farm', service: 'farm', npcId: 'orin-stockkeeper',
    interiorTheme: {
      id: 'barn', background: '#17140d', surface: '#3a2c19', accent: '#d8c36d', glow: '#8fbf65', ink: '#fff6d8',
      exteriorWall: 0x9b7146, exteriorRoof: 0x6f382f, exteriorAccent: 0xd2b661,
    },
    sites: [
      {
        areaKey: '1,0',
        footprint: { tileX: 76, tileY: 76, tilesWide: 7, tilesHigh: 6 },
        door: { tileX: 78, tileY: 81 }, doorWidth: 2,
      },
    ],
  },
  {
    id: 'market', displayName: 'Market', interiorId: 'elaris-market', service: 'market', npcId: 'tavi-trader',
    interiorTheme: {
      id: 'market', background: '#10151b', surface: '#253342', accent: '#f0c85b', glow: '#5aa9a0', ink: '#f7f1dc',
      exteriorWall: 0x6d7885, exteriorRoof: 0x355b72, exteriorAccent: 0xe0b84e,
    },
    sites: [
      {
        areaKey: '0,0', requiresElarisStanding: true,
        footprint: { tileX: 76, tileY: 86, tilesWide: 9, tilesHigh: 6 },
        door: { tileX: 79, tileY: 86 }, doorWidth: 2,
      },
      {
        areaKey: '2,-2', displayName: 'Kestrel Crossing Market',
        footprint: { tileX: 74, tileY: 70, tilesWide: 9, tilesHigh: 6 },
        door: { tileX: 78, tileY: 70 }, doorWidth: 2,
      },
    ],
  },
  {
    id: 'church', displayName: 'Church', interiorId: 'elaris-church', service: 'church', npcId: 'elowen-caretaker',
    interiorTheme: {
      id: 'church', background: '#121722', surface: '#28334a', accent: '#f3d98b', glow: '#8eb8e8', ink: '#f8f4e8',
      exteriorWall: 0xc6bda8, exteriorRoof: 0x53647c, exteriorAccent: 0xe7cf7a,
    },
    sites: [
      {
        areaKey: '0,0', requiresElarisStanding: true,
        footprint: { tileX: 62, tileY: 74, tilesWide: 7, tilesHigh: 6 },
        door: { tileX: 64, tileY: 79 }, doorWidth: 2,
      },
      {
        areaKey: '-1,3', displayName: 'Stillwater Chapel',
        footprint: { tileX: 76, tileY: 70, tilesWide: 7, tilesHigh: 6 },
        door: { tileX: 78, tileY: 75 }, doorWidth: 2,
      },
    ],
  },
  {
    id: 'armoury', displayName: 'Armoury', interiorId: 'elaris-armoury', service: 'armoury', npcId: 'garrick-armourer',
    interiorTheme: {
      id: 'armoury', background: '#11171a', surface: '#2b3638', accent: '#c8d1d1', glow: '#8fa6a3', ink: '#f0f2ed',
      exteriorWall: 0x778486, exteriorRoof: 0x39484c, exteriorAccent: 0xb8c6c4,
    },
    sites: [
      {
        areaKey: '0,0', requiresElarisStanding: true,
        footprint: { tileX: 92, tileY: 74, tilesWide: 7, tilesHigh: 6 },
        door: { tileX: 94, tileY: 79 }, doorWidth: 2,
      },
      {
        areaKey: '0,-3', displayName: 'Ironwatch Armoury',
        footprint: { tileX: 76, tileY: 70, tilesWide: 7, tilesHigh: 6 },
        door: { tileX: 78, tileY: 75 }, doorWidth: 2,
      },
    ],
  },
  {
    id: 'magic-shop', displayName: 'Sylvaren Arcanum', interiorId: 'sylvaren-arcanum', service: 'magic-shop', npcId: 'selene-arcanist',
    interiorTheme: {
      id: 'arcane', background: '#120e22', surface: '#30244d', accent: '#d8a8ff', glow: '#6cd7e8', ink: '#f5ecff',
      exteriorWall: 0x69558c, exteriorRoof: 0x30234f, exteriorAccent: 0xb982df,
    },
    sites: [
      {
        areaKey: '2,0',
        footprint: { tileX: 76, tileY: 76, tilesWide: 7, tilesHigh: 6 },
        door: { tileX: 78, tileY: 81 }, doorWidth: 2,
      },
    ],
  },
  {
    id: 'tavern', displayName: 'Tavern', interiorId: 'elaris-tavern', service: 'tavern', npcId: 'bram-innkeeper',
    interiorTheme: {
      id: 'tavern', background: '#19110d', surface: '#422b1e', accent: '#e5b76b', glow: '#d76b3f', ink: '#fff0d7',
      exteriorWall: 0x8d6546, exteriorRoof: 0x553329, exteriorAccent: 0xd29a53,
    },
    sites: [
      {
        areaKey: '0,0', requiresElarisStanding: true,
        footprint: { tileX: 88, tileY: 86, tilesWide: 7, tilesHigh: 6 },
        door: { tileX: 90, tileY: 86 }, doorWidth: 2,
      },
      {
        areaKey: '1,2', displayName: 'Fallowmere Tavern',
        footprint: { tileX: 76, tileY: 70, tilesWide: 7, tilesHigh: 6 },
        door: { tileX: 78, tileY: 70 }, doorWidth: 2,
      },
    ],
  },
  {
    id: 'arena', displayName: 'Arena', interiorId: 'elaris-arena', service: 'arena', npcId: 'kael-arena-master',
    interiorTheme: {
      id: 'arena', background: '#18120e', surface: '#493526', accent: '#e4bd69', glow: '#d9583b', ink: '#fff0d2',
      exteriorWall: 0x9a7655, exteriorRoof: 0x5f3f31, exteriorAccent: 0xcf9f4d,
    },
    sites: [
      {
        areaKey: '0,0', requiresElarisStanding: true,
        footprint: { tileX: 67, tileY: 94, tilesWide: 13, tilesHigh: 8 },
        door: { tileX: 72, tileY: 94 }, doorWidth: 2,
      },
      {
        areaKey: '-2,-2', displayName: 'Hollowmarch Arena',
        footprint: { tileX: 74, tileY: 70, tilesWide: 13, tilesHigh: 8 },
        door: { tileX: 79, tileY: 70 }, doorWidth: 2,
      },
    ],
  },
] as const;

export const TOWN_BUILDINGS: readonly TownBuildingDefinition[] = TOWN_BUILDING_BLUEPRINTS
  .flatMap(({ sites, ...blueprint }) => sites.map((site) => ({
    ...blueprint,
    areaKey: site.areaKey,
    displayName: site.displayName ?? blueprint.displayName,
    footprint: site.footprint,
    door: site.door,
    doorWidth: site.doorWidth,
    requiresElarisStanding: site.requiresElarisStanding === true,
  })));

const EMPTY_TOWN_BUILDINGS: readonly TownBuildingDefinition[] = [];
const TOWN_BUILDINGS_BY_AREA = (() => {
  const byArea = new Map<string, TownBuildingDefinition[]>();
  for (const building of TOWN_BUILDINGS) {
    const buildings = byArea.get(building.areaKey) ?? [];
    buildings.push(building);
    byArea.set(building.areaKey, buildings);
  }
  return byArea;
})();

export function townBuildingById(id: TownBuildingId): TownBuildingDefinition {
  const building = TOWN_BUILDINGS.find((candidate) => candidate.id === id);
  if (!building) throw new Error(`unknown town building ${id}`);
  return building;
}

/**
 * Every placement standing in an area, in service or ruined. Generation,
 * collision, and the precinct read this list so a site occupies the same ground
 * whatever the player's progress: an online world cannot have one client's
 * terrain disagree with another's.
 */
export function townBuildingsInArea(areaKey: string): readonly TownBuildingDefinition[] {
  return TOWN_BUILDINGS_BY_AREA.get(areaKey) ?? EMPTY_TOWN_BUILDINGS;
}

/** True once Elaris has fallen for this player and the placement is one of its ruins. */
export function isRuinedTownBuilding(building: TownBuildingDefinition, elarisFallen: boolean): boolean {
  return elarisFallen && building.requiresElarisStanding;
}

/** Placements whose doors still open and whose NPC is still at the counter. */
export function servingTownBuildingsInArea(
  areaKey: string,
  elarisFallen: boolean,
): readonly TownBuildingDefinition[] {
  if (!elarisFallen) return townBuildingsInArea(areaKey);
  return townBuildingsInArea(areaKey).filter((building) => !isRuinedTownBuilding(building, elarisFallen));
}

export function townBuildingAtTile(tileX: number, tileY: number, areaKey = '0,0'): TownBuildingDefinition | null {
  return townBuildingsInArea(areaKey).find(({ footprint }) =>
    tileX >= footprint.tileX && tileX < footprint.tileX + footprint.tilesWide
      && tileY >= footprint.tileY && tileY < footprint.tileY + footprint.tilesHigh,
  ) ?? null;
}

export function townBuildingAtDoorTile(tileX: number, tileY: number, areaKey = '0,0'): TownBuildingDefinition | null {
  return townBuildingsInArea(areaKey).find((building) => townBuildingDoorTiles(building)
    .some((door) => door.tileX === tileX && door.tileY === tileY)) ?? null;
}

/** Every perimeter tile occupied by a town doorway. */
export function townBuildingDoorTiles(building: TownBuildingDefinition): TilePoint[] {
  const { footprint, door, doorWidth } = building;
  const horizontal = door.tileY === footprint.tileY
    || door.tileY === footprint.tileY + footprint.tilesHigh - 1;
  return Array.from({ length: doorWidth }, (_, offset) => ({
    tileX: door.tileX + (horizontal ? offset : 0),
    tileY: door.tileY + (horizontal ? 0 : offset),
  }));
}

export function isTownFootprintTile(tileX: number, tileY: number, areaKey = '0,0'): boolean {
  return townBuildingAtTile(tileX, tileY, areaKey) !== null;
}

export function isTownFootprintWorldPosition(x: number, y: number, areaKey = '0,0'): boolean {
  return isTownFootprintTile(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE), areaKey);
}

/** Tiles of clearance kept around the buildings so resources never crowd the town or its paths. */
const TOWN_PRECINCT_BUFFER_TILES = 3;

/**
 * Bounding box (in tiles) enclosing every service building, expanded by the
 * precinct buffer. Resource generation clears this whole rectangle so nodes
 * never spawn between buildings where they would block placement and movement.
 */
export function townPrecinctForArea(areaKey: string): TileFootprint {
  const buildings = townBuildingsInArea(areaKey);
  if (buildings.length === 0) return { tileX: 0, tileY: 0, tilesWide: 0, tilesHigh: 0 };
  let minTileX = Number.POSITIVE_INFINITY;
  let minTileY = Number.POSITIVE_INFINITY;
  let maxTileX = Number.NEGATIVE_INFINITY;
  let maxTileY = Number.NEGATIVE_INFINITY;
  for (const { footprint } of buildings) {
    minTileX = Math.min(minTileX, footprint.tileX);
    minTileY = Math.min(minTileY, footprint.tileY);
    maxTileX = Math.max(maxTileX, footprint.tileX + footprint.tilesWide);
    maxTileY = Math.max(maxTileY, footprint.tileY + footprint.tilesHigh);
  }
  return {
    tileX: minTileX - TOWN_PRECINCT_BUFFER_TILES,
    tileY: minTileY - TOWN_PRECINCT_BUFFER_TILES,
    tilesWide: maxTileX - minTileX + TOWN_PRECINCT_BUFFER_TILES * 2,
    tilesHigh: maxTileY - minTileY + TOWN_PRECINCT_BUFFER_TILES * 2,
  };
}

/** Compatibility export for the starter town's authored precinct. */
export const TOWN_PRECINCT: TileFootprint = townPrecinctForArea('0,0');

/** True when a world position sits anywhere inside the buffered town precinct. */
export function isWithinTownPrecinct(x: number, y: number, areaKey = '0,0'): boolean {
  const precinct = townPrecinctForArea(areaKey);
  const tileX = Math.floor(x / TILE_SIZE);
  const tileY = Math.floor(y / TILE_SIZE);
  return tileX >= precinct.tileX && tileX < precinct.tileX + precinct.tilesWide
    && tileY >= precinct.tileY && tileY < precinct.tileY + precinct.tilesHigh;
}

/** The deterministic safe tile used after leaving, inferred from the perimeter door. */
export function outsideDoorTile(building: TownBuildingDefinition): TilePoint {
  const { footprint, door } = building;
  if (door.tileY === footprint.tileY) return { tileX: door.tileX, tileY: door.tileY - 1 };
  if (door.tileY === footprint.tileY + footprint.tilesHigh - 1) return { tileX: door.tileX, tileY: door.tileY + 1 };
  if (door.tileX === footprint.tileX) return { tileX: door.tileX - 1, tileY: door.tileY };
  if (door.tileX === footprint.tileX + footprint.tilesWide - 1) return { tileX: door.tileX + 1, tileY: door.tileY };
  throw new Error(`${building.id} door is not on its footprint perimeter`);
}
