import type { NpcId, NpcService } from './npcs';
import type { TownBuildingDefinition, TownBuildingId } from './townBuildings';
import type { Facing } from '../simulation/state';

/**
 * Walk-in town interiors.
 *
 * A service building is no longer a door into a separate scene: its room is
 * built inside the building's own footprint on the world map, and the player
 * walks through the doorway into it. Everything here is authored in
 * footprint-local tiles — (0, 0) is the footprint's north-west corner, x runs
 * east and y runs south, and fractions are allowed — so one layout serves
 * every placement of a blueprint (Elaris and its field copies share sizes).
 *
 * This module is the single source of truth for the room's geometry. The
 * simulation reads the walls, doorway and furniture as collision, the storm
 * and the raid read "between the walls" as shelter, and the renderer builds
 * the same walls, doorway and furniture from the same numbers.
 */

export type InteriorId =
  | 'weaponsmith-forge'
  | 'verdant-reach-farm'
  | 'elaris-market'
  | 'elaris-church'
  | 'elaris-armoury'
  | 'sylvaren-arcanum'
  | 'elaris-tavern'
  | 'elaris-arena';

export type InteriorPropPrefab =
  | 'forge' | 'anvil' | 'workbench' | 'tool-rack'
  | 'counter' | 'crate' | 'shelf' | 'barrel'
  | 'feed-sacks' | 'animal-pen' | 'ledger-desk'
  | 'market-stall' | 'merchant-scale' | 'produce-crates'
  | 'pew' | 'altar' | 'candle-stand' | 'stained-window'
  | 'armour-rack' | 'shield-display' | 'practice-dummy'
  | 'rune-circle' | 'bookcase' | 'staff-display' | 'floating-books'
  | 'hearth' | 'tavern-table' | 'stool' | 'notice-board'
  | 'training-post' | 'spectator-bench' | 'banner';

export type InteriorEffect =
  | 'forge-sparks' | 'chimney-embers' | 'dust-motes' | 'animal-idles'
  | 'market-bustle' | 'stained-light' | 'candle-flicker' | 'metal-glints'
  | 'rune-drift' | 'floating-pages' | 'hearth-embers' | 'crowd-motion';

export type InteriorNpcActivity =
  | 'hammering' | 'checking-ledger' | 'arranging-stock' | 'quiet-reflection'
  | 'armour-drill' | 'arcane-study' | 'serving-patrons' | 'coaching';

/** Footprint-local position in tiles. */
export interface RoomPoint { readonly x: number; readonly y: number }
export interface RoomPose extends RoomPoint { readonly facing: Facing }

/** Axis-aligned footprint-local rectangle, by its minimum corner. */
export interface RoomRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface InteriorProp extends RoomPoint {
  readonly id: string;
  readonly prefab: InteriorPropPrefab;
  /** Turn about the vertical axis. 0 faces south (+y), 90 east, 180 north, 270 west. */
  readonly rotationDegrees: 0 | 90 | 180 | 270;
  /** Uniform scale of the prefab; its collider scales with it. */
  readonly scale?: number;
}

export interface InteriorServiceHotspot extends RoomPoint {
  readonly id: string;
  readonly kind: 'service';
  readonly label: string;
  readonly npcId: NpcId;
  readonly service: NpcService;
}

export interface InteriorExamineHotspot extends RoomPoint {
  readonly id: string;
  readonly kind: 'examine';
  readonly label: string;
  readonly text: string;
}

export type InteriorHotspot = InteriorServiceHotspot | InteriorExamineHotspot;

export interface InteriorNpcSpawn extends RoomPose {
  readonly npcId: NpcId;
  readonly activity: InteriorNpcActivity;
}

/** A townsperson who only adds life to the room; solid like the keeper. */
export type InteriorPatron = RoomPose;

export interface InteriorAmbience {
  readonly soundscape: string;
  readonly ambientColor: number;
  readonly ambientIntensity: number;
  readonly keyLightColor: number;
  readonly keyLightIntensity: number;
  readonly effects: readonly InteriorEffect[];
}

export interface InteriorDefinition {
  readonly id: InteriorId;
  readonly buildingId: TownBuildingId;
  readonly displayName: string;
  readonly props: readonly InteriorProp[];
  readonly hotspots: readonly InteriorHotspot[];
  readonly npcSpawns: readonly InteriorNpcSpawn[];
  readonly patrons: readonly InteriorPatron[];
  readonly ambience: InteriorAmbience;
}

/**
 * Collision size of each prefab at scale 1 and rotation 0, in tiles: `width`
 * along x, `depth` along y. `null` is wall or floor dressing nobody bumps into.
 * The renderer builds every prefab to these proportions.
 */
export const INTERIOR_PROP_FOOTPRINTS: Readonly<Record<InteriorPropPrefab, { width: number; depth: number } | null>> = {
  forge: { width: 2.6, depth: 1.5 },
  hearth: { width: 1.55, depth: 1.5 },
  anvil: { width: 1.25, depth: 0.62 },
  workbench: { width: 2.2, depth: 0.78 },
  counter: { width: 2.8, depth: 0.78 },
  'ledger-desk': { width: 2.2, depth: 0.78 },
  'tool-rack': { width: 1.65, depth: 0.5 },
  'armour-rack': { width: 1.65, depth: 0.5 },
  bookcase: { width: 1.65, depth: 0.5 },
  shelf: { width: 1.65, depth: 0.5 },
  barrel: { width: 0.96, depth: 0.96 },
  crate: { width: 0.85, depth: 0.72 },
  'produce-crates': { width: 2.3, depth: 0.72 },
  'feed-sacks': { width: 1.2, depth: 0.9 },
  'animal-pen': { width: 2.6, depth: 2.6 },
  'market-stall': { width: 2.5, depth: 0.8 },
  'merchant-scale': { width: 1.2, depth: 0.3 },
  pew: { width: 2.7, depth: 0.62 },
  altar: { width: 2.5, depth: 1 },
  'candle-stand': { width: 1.3, depth: 0.55 },
  'stained-window': null,
  'shield-display': null,
  'practice-dummy': { width: 0.9, depth: 0.4 },
  'rune-circle': null,
  'staff-display': { width: 1.65, depth: 0.75 },
  'floating-books': null,
  'tavern-table': { width: 2.1, depth: 2.1 },
  stool: { width: 0.76, depth: 0.76 },
  'notice-board': null,
  'training-post': { width: 0.45, depth: 0.45 },
  'spectator-bench': { width: 2.2, depth: 0.62 },
  banner: { width: 0.3, depth: 0.3 },
};

/** Keepers and patrons are as solid as the counter they stand behind. */
export const INTERIOR_PERSON_SIZE = 0.5;

export const INTERIOR_DEFINITIONS: readonly InteriorDefinition[] = [
  {
    id: 'weaponsmith-forge', buildingId: 'weaponsmith', displayName: "Mara's Forge",
    props: [
      { id: 'forge', prefab: 'forge', x: 2.0, y: 1.55, rotationDegrees: 0, scale: 0.8 },
      { id: 'workbench', prefab: 'workbench', x: 4.9, y: 1.25, rotationDegrees: 180, scale: 0.9 },
      { id: 'tool-rack', prefab: 'tool-rack', x: 6.16, y: 3.4, rotationDegrees: 270 },
      { id: 'anvil', prefab: 'anvil', x: 2.3, y: 3.3, rotationDegrees: 90 },
      { id: 'coal-barrel', prefab: 'barrel', x: 1.35, y: 4.45, rotationDegrees: 0, scale: 0.8 },
    ],
    hotspots: [
      { id: 'mara-service', kind: 'service', label: 'Present a tool to Mara', npcId: 'mara-smith', service: 'weaponsmith', x: 3.6, y: 3.3 },
      { id: 'inspect-anvil', kind: 'examine', label: 'Inspect anvil', text: 'The face is polished by years of deliberate blows.', x: 2.3, y: 3.3 },
    ],
    npcSpawns: [{ npcId: 'mara-smith', activity: 'hammering', x: 3.2, y: 2.7, facing: 'left' }],
    patrons: [],
    ambience: { soundscape: 'interior-forge', ambientColor: 0x6f3927, ambientIntensity: 0.55, keyLightColor: 0xff8a3d, keyLightIntensity: 1.35, effects: ['forge-sparks', 'chimney-embers'] },
  },
  {
    id: 'verdant-reach-farm', buildingId: 'farm', displayName: 'Verdant Reach Stockhouse',
    props: [
      { id: 'pen', prefab: 'animal-pen', x: 1.95, y: 2.05, rotationDegrees: 0, scale: 0.65 },
      { id: 'ledger', prefab: 'ledger-desk', x: 4.7, y: 2.2, rotationDegrees: 180, scale: 0.85 },
      { id: 'feed-sacks', prefab: 'feed-sacks', x: 5.55, y: 4.35, rotationDegrees: 0 },
      { id: 'supply-barrel', prefab: 'barrel', x: 1.35, y: 4.45, rotationDegrees: 0, scale: 0.8 },
    ],
    hotspots: [
      { id: 'orin-service', kind: 'service', label: "Review Orin's ledger", npcId: 'orin-stockkeeper', service: 'farm', x: 4.7, y: 3.0 },
      { id: 'inspect-pen', kind: 'examine', label: 'Inspect training pen', text: 'Fresh bedding and patient routines keep the animals calm.', x: 2.0, y: 3.25 },
    ],
    npcSpawns: [{ npcId: 'orin-stockkeeper', activity: 'checking-ledger', x: 4.7, y: 1.35, facing: 'down' }],
    patrons: [],
    ambience: { soundscape: 'interior-stockhouse', ambientColor: 0x8b7042, ambientIntensity: 0.7, keyLightColor: 0xd8d58a, keyLightIntensity: 1, effects: ['dust-motes', 'animal-idles'] },
  },
  {
    id: 'elaris-market', buildingId: 'market', displayName: 'Elaris Market Hall',
    props: [
      { id: 'west-stall', prefab: 'market-stall', x: 1.45, y: 3.1, rotationDegrees: 90, scale: 0.85 },
      { id: 'east-stall', prefab: 'market-stall', x: 7.55, y: 3.1, rotationDegrees: 270, scale: 0.85 },
      { id: 'trader-counter', prefab: 'counter', x: 4.5, y: 3.75, rotationDegrees: 0, scale: 0.85 },
      { id: 'produce', prefab: 'produce-crates', x: 6.6, y: 1.3, rotationDegrees: 0, scale: 0.75 },
      { id: 'scale', prefab: 'merchant-scale', x: 2.6, y: 4.5, rotationDegrees: 0 },
    ],
    hotspots: [
      { id: 'tavi-service', kind: 'service', label: 'Place goods on the counter', npcId: 'tavi-trader', service: 'market', x: 4.5, y: 3.0 },
      { id: 'inspect-scale', kind: 'examine', label: 'Inspect merchant scale', text: 'The brass weights are marked with the seal of Elaris.', x: 2.6, y: 4.5 },
    ],
    npcSpawns: [{ npcId: 'tavi-trader', activity: 'arranging-stock', x: 4.5, y: 4.6, facing: 'up' }],
    patrons: [{ x: 2.9, y: 2.2, facing: 'left' }],
    ambience: { soundscape: 'interior-market', ambientColor: 0x8da0a8, ambientIntensity: 0.75, keyLightColor: 0xffd77a, keyLightIntensity: 1.1, effects: ['dust-motes', 'market-bustle'] },
  },
  {
    id: 'elaris-church', buildingId: 'church', displayName: 'Sanctuary of Elaris',
    props: [
      { id: 'altar', prefab: 'altar', x: 3.5, y: 1.35, rotationDegrees: 0, scale: 0.85 },
      { id: 'window', prefab: 'stained-window', x: 3.5, y: 0.84, rotationDegrees: 0 },
      { id: 'candles', prefab: 'candle-stand', x: 1.45, y: 1.3, rotationDegrees: 0, scale: 0.9 },
      { id: 'west-pew-a', prefab: 'pew', x: 1.75, y: 3.2, rotationDegrees: 0, scale: 0.6 },
      { id: 'east-pew-a', prefab: 'pew', x: 5.25, y: 3.2, rotationDegrees: 0, scale: 0.6 },
      { id: 'west-pew-b', prefab: 'pew', x: 1.75, y: 4.2, rotationDegrees: 0, scale: 0.6 },
      { id: 'east-pew-b', prefab: 'pew', x: 5.25, y: 4.2, rotationDegrees: 0, scale: 0.6 },
    ],
    hotspots: [
      { id: 'elowen-service', kind: 'service', label: 'Reflect with Elowen', npcId: 'elowen-caretaker', service: 'church', x: 4.9, y: 2.7 },
      { id: 'inspect-window', kind: 'examine', label: 'Study the stained glass', text: 'Colored light gathers around a path through a painted storm.', x: 3.0, y: 2.1 },
    ],
    npcSpawns: [{ npcId: 'elowen-caretaker', activity: 'quiet-reflection', x: 5.05, y: 1.95, facing: 'down' }],
    patrons: [],
    ambience: { soundscape: 'interior-sanctuary', ambientColor: 0x7189ac, ambientIntensity: 0.62, keyLightColor: 0xf5dfa0, keyLightIntensity: 1.2, effects: ['stained-light', 'candle-flicker'] },
  },
  {
    id: 'elaris-armoury', buildingId: 'armoury', displayName: "Garrick's Armoury",
    props: [
      { id: 'west-rack', prefab: 'armour-rack', x: 0.84, y: 2.4, rotationDegrees: 90 },
      { id: 'east-rack', prefab: 'armour-rack', x: 6.16, y: 2.4, rotationDegrees: 270 },
      { id: 'counter', prefab: 'counter', x: 4.3, y: 2.5, rotationDegrees: 0, scale: 0.75 },
      { id: 'dummy', prefab: 'practice-dummy', x: 2.1, y: 3.9, rotationDegrees: 0 },
      { id: 'shield', prefab: 'shield-display', x: 2.6, y: 0.86, rotationDegrees: 0 },
    ],
    hotspots: [
      { id: 'garrick-service', kind: 'service', label: 'Begin a drill with Garrick', npcId: 'garrick-armourer', service: 'armoury', x: 4.3, y: 3.2 },
      { id: 'inspect-dummy', kind: 'examine', label: 'Inspect practice dummy', text: 'Its smallest painted targets carry the deepest dents.', x: 2.1, y: 3.9 },
    ],
    npcSpawns: [{ npcId: 'garrick-armourer', activity: 'armour-drill', x: 4.3, y: 1.55, facing: 'down' }],
    patrons: [],
    ambience: { soundscape: 'interior-armoury', ambientColor: 0x778486, ambientIntensity: 0.65, keyLightColor: 0xdde6e3, keyLightIntensity: 1, effects: ['dust-motes', 'metal-glints'] },
  },
  {
    id: 'sylvaren-arcanum', buildingId: 'magic-shop', displayName: 'Sylvaren Arcanum',
    props: [
      { id: 'west-books', prefab: 'bookcase', x: 0.84, y: 2.4, rotationDegrees: 90 },
      { id: 'east-books', prefab: 'bookcase', x: 6.16, y: 2.4, rotationDegrees: 270 },
      { id: 'rune', prefab: 'rune-circle', x: 3.5, y: 2.75, rotationDegrees: 0, scale: 0.7 },
      { id: 'books', prefab: 'floating-books', x: 5.0, y: 1.4, rotationDegrees: 0, scale: 0.7 },
      { id: 'staff-case', prefab: 'staff-display', x: 5.0, y: 4.3, rotationDegrees: 0, scale: 0.8 },
    ],
    hotspots: [
      { id: 'selene-service', kind: 'service', label: 'Channel the service rune', npcId: 'selene-arcanist', service: 'magic-shop', x: 3.5, y: 2.75 },
      { id: 'inspect-staff', kind: 'examine', label: 'Inspect Magic Staff', text: 'Its focus crystal hums in sympathy with every nearby material.', x: 5.0, y: 4.3 },
    ],
    npcSpawns: [{ npcId: 'selene-arcanist', activity: 'arcane-study', x: 3.5, y: 1.45, facing: 'down' }],
    patrons: [],
    ambience: { soundscape: 'interior-arcanum', ambientColor: 0x5f4b87, ambientIntensity: 0.55, keyLightColor: 0x77e5f0, keyLightIntensity: 1.3, effects: ['rune-drift', 'floating-pages'] },
  },
  {
    id: 'elaris-tavern', buildingId: 'tavern', displayName: 'The Wayfarer Tavern',
    props: [
      { id: 'hearth', prefab: 'hearth', x: 1.3, y: 3.6, rotationDegrees: 90, scale: 0.8 },
      { id: 'bar', prefab: 'counter', x: 4.6, y: 4.0, rotationDegrees: 0, scale: 0.85 },
      { id: 'table', prefab: 'tavern-table', x: 2.6, y: 2.6, rotationDegrees: 0, scale: 0.55 },
      { id: 'notice', prefab: 'notice-board', x: 6.25, y: 2.2, rotationDegrees: 270 },
    ],
    hotspots: [
      { id: 'bram-service', kind: 'service', label: 'Ask Bram for a story', npcId: 'bram-innkeeper', service: 'tavern', x: 4.6, y: 3.2 },
      { id: 'inspect-notice-board', kind: 'examine', label: 'Read local notices', text: 'Half the notices are jobs. The other half warn against taking them.', x: 5.8, y: 2.2 },
    ],
    npcSpawns: [{ npcId: 'bram-innkeeper', activity: 'serving-patrons', x: 4.6, y: 4.7, facing: 'up' }],
    patrons: [{ x: 1.65, y: 1.75, facing: 'right' }],
    ambience: { soundscape: 'interior-tavern', ambientColor: 0x805438, ambientIntensity: 0.7, keyLightColor: 0xffbc68, keyLightIntensity: 1.2, effects: ['hearth-embers', 'dust-motes'] },
  },
  {
    id: 'elaris-arena', buildingId: 'arena', displayName: 'Elaris Arena',
    props: [
      { id: 'west-benches', prefab: 'spectator-bench', x: 1.6, y: 4.0, rotationDegrees: 90, scale: 0.9 },
      { id: 'east-benches', prefab: 'spectator-bench', x: 11.4, y: 4.0, rotationDegrees: 270, scale: 0.9 },
      { id: 'west-post', prefab: 'training-post', x: 4.2, y: 3.2, rotationDegrees: 0 },
      { id: 'south-post', prefab: 'training-post', x: 8.4, y: 5.4, rotationDegrees: 0 },
      { id: 'banner', prefab: 'banner', x: 6.5, y: 7.0, rotationDegrees: 180 },
    ],
    hotspots: [
      { id: 'kael-service', kind: 'service', label: 'Choose a drill with Kael', npcId: 'kael-arena-master', service: 'arena', x: 9.5, y: 3.3 },
      { id: 'inspect-ring', kind: 'examine', label: 'Inspect the arena ring', text: 'The sand records every hesitation more faithfully than any audience.', x: 6.5, y: 4.4 },
    ],
    npcSpawns: [{ npcId: 'kael-arena-master', activity: 'coaching', x: 10.2, y: 2.9, facing: 'left' }],
    patrons: [{ x: 1.7, y: 3.3, facing: 'right' }, { x: 11.3, y: 4.7, facing: 'left' }],
    ambience: { soundscape: 'interior-arena', ambientColor: 0x9a7655, ambientIntensity: 0.8, keyLightColor: 0xffd181, keyLightIntensity: 1.3, effects: ['dust-motes', 'crowd-motion'] },
  },
] as const;

const INTERIORS_BY_ID = new Map(INTERIOR_DEFINITIONS.map((interior) => [interior.id, interior]));
const INTERIORS_BY_BUILDING = new Map(INTERIOR_DEFINITIONS.map((interior) => [interior.buildingId, interior]));

export function interiorDefinitionById(id: InteriorId): InteriorDefinition {
  const interior = INTERIORS_BY_ID.get(id);
  if (!interior) throw new Error(`unknown interior ${id}`);
  return interior;
}

export function interiorDefinitionForBuilding(buildingId: TownBuildingId): InteriorDefinition {
  const interior = INTERIORS_BY_BUILDING.get(buildingId);
  if (!interior) throw new Error(`no interior for town building ${buildingId}`);
  return interior;
}

// ---------------------------------------------------------------------------
// The shell: walls, doorway and floor of a walk-in building.
// ---------------------------------------------------------------------------

/** Wall centre lines sit this far inside the footprint's east/west edges. */
export const SHELL_SIDE_INSET = 0.45;
/** Wall centre lines sit this far inside the footprint's north/south edges. */
export const SHELL_END_INSET = 0.55;
/** How far a wall's masonry reaches into the room from its centre line. */
export const SHELL_WALL_INNER = 0.25;
/**
 * The player's body clearance from walls and furniture. Collision treats the
 * player as a point; this keeps that point — and a first-person eye at it —
 * from touching a surface.
 */
export const BODY_CLEARANCE = 0.2;
/** Half of the doorway the walls leave open. */
export const DOORWAY_HALF_WIDTH = 0.75;
/** How close to a hotspot the player must stand to use it. */
export const INTERIOR_INTERACTION_RANGE_TILES = 1.4;

export type ShellSide = 'north' | 'south' | 'west' | 'east';

export interface TownBuildingShell {
  readonly kind: 'room' | 'ring';
  readonly tilesWide: number;
  readonly tilesHigh: number;
  /** Wall centre lines (room) or the fence's bounding box (ring). */
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  /** Where the player can stand: the room inside its wall faces, less clearance. */
  readonly walk: RoomRect;
  readonly door: {
    readonly side: ShellSide;
    /** Doorway centre along its wall, in the footprint-local axis of that wall. */
    readonly along: number;
  };
}

/** Fence ellipse of the open-air arena, inside its footprint. */
const RING_INSET_X = 0.5;
const RING_INSET_Y = 0.3;
/** The walkable sand stops this far inside the fence posts. */
const RING_WALK_INSET = 0.45;

export function townBuildingShell(building: TownBuildingDefinition): TownBuildingShell {
  const { footprint, door, doorWidth } = building;
  const tilesWide = footprint.tilesWide;
  const tilesHigh = footprint.tilesHigh;
  const localDoorX = door.tileX - footprint.tileX;
  const localDoorY = door.tileY - footprint.tileY;
  const side: ShellSide = localDoorY === 0 ? 'north'
    : localDoorY === tilesHigh - 1 ? 'south'
      : localDoorX === 0 ? 'west' : 'east';
  const along = side === 'north' || side === 'south' ? localDoorX + doorWidth / 2 : localDoorY + doorWidth / 2;
  if (building.id === 'arena') {
    const left = RING_INSET_X;
    const right = tilesWide - RING_INSET_X;
    const top = RING_INSET_Y;
    const bottom = tilesHigh - RING_INSET_Y;
    return {
      kind: 'ring', tilesWide, tilesHigh, left, right, top, bottom,
      walk: {
        x: left + RING_WALK_INSET, y: top + RING_WALK_INSET,
        width: right - left - RING_WALK_INSET * 2, height: bottom - top - RING_WALK_INSET * 2,
      },
      door: { side, along },
    };
  }
  const left = SHELL_SIDE_INSET;
  const right = tilesWide - SHELL_SIDE_INSET;
  const top = SHELL_END_INSET;
  const bottom = tilesHigh - SHELL_END_INSET;
  const inset = SHELL_WALL_INNER + BODY_CLEARANCE;
  return {
    kind: 'room', tilesWide, tilesHigh, left, right, top, bottom,
    walk: { x: left + inset, y: top + inset, width: right - left - inset * 2, height: bottom - top - inset * 2 },
    door: { side, along },
  };
}

/** Solid rectangles of every keeper, patron and piece of furniture, with clearance added. */
export function interiorColliders(interior: InteriorDefinition): RoomRect[] {
  const rects: RoomRect[] = [];
  const push = (x: number, y: number, width: number, depth: number): void => {
    rects.push({
      x: x - width / 2 - BODY_CLEARANCE,
      y: y - depth / 2 - BODY_CLEARANCE,
      width: width + BODY_CLEARANCE * 2,
      height: depth + BODY_CLEARANCE * 2,
    });
  };
  for (const prop of interior.props) {
    const size = INTERIOR_PROP_FOOTPRINTS[prop.prefab];
    if (!size) continue;
    const scale = prop.scale ?? 1;
    const turned = prop.rotationDegrees === 90 || prop.rotationDegrees === 270;
    push(prop.x, prop.y, (turned ? size.depth : size.width) * scale, (turned ? size.width : size.depth) * scale);
  }
  for (const person of [...interior.npcSpawns, ...interior.patrons]) {
    push(person.x, person.y, INTERIOR_PERSON_SIZE, INTERIOR_PERSON_SIZE);
  }
  return rects;
}

/** Keyed by the definition itself, so an edited copy is never served stale colliders. */
const COLLIDERS_BY_INTERIOR = new WeakMap<InteriorDefinition, RoomRect[]>();

function cachedColliders(interior: InteriorDefinition): readonly RoomRect[] {
  let rects = COLLIDERS_BY_INTERIOR.get(interior);
  if (!rects) {
    rects = interiorColliders(interior);
    COLLIDERS_BY_INTERIOR.set(interior, rects);
  }
  return rects;
}

function insideRect(rect: RoomRect, x: number, y: number): boolean {
  return x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height;
}

function insideWalkArea(shell: TownBuildingShell, x: number, y: number): boolean {
  const { walk } = shell;
  if (shell.kind === 'room') {
    return x >= walk.x && x <= walk.x + walk.width && y >= walk.y && y <= walk.y + walk.height;
  }
  const rx = walk.width / 2;
  const ry = walk.height / 2;
  const dx = (x - (walk.x + rx)) / rx;
  const dy = (y - (walk.y + ry)) / ry;
  return dx * dx + dy * dy <= 1;
}

/** The doorway passage, from the footprint edge through the wall into the room. */
function insideDoorway(shell: TownBuildingShell, x: number, y: number): boolean {
  const half = DOORWAY_HALF_WIDTH - BODY_CLEARANCE;
  const { side, along } = shell.door;
  const centreX = shell.walk.x + shell.walk.width / 2;
  const centreY = shell.walk.y + shell.walk.height / 2;
  switch (side) {
    case 'north': return Math.abs(x - along) <= half && y >= 0 && y <= centreY;
    case 'south': return Math.abs(x - along) <= half && y >= centreY && y <= shell.tilesHigh;
    case 'west': return Math.abs(y - along) <= half && x >= 0 && x <= centreX;
    case 'east': return Math.abs(y - along) <= half && x >= centreX && x <= shell.tilesWide;
  }
}

/**
 * Whether a footprint-local point is solid for a walking body. Outside the
 * footprint nothing here is solid. Inside it, the walls are solid except at
 * the doorway, and an `furnished` room's keepers and furniture are solid too.
 */
export function townShellBlocks(
  shell: TownBuildingShell,
  interior: InteriorDefinition | null,
  x: number,
  y: number,
): boolean {
  if (x < 0 || y < 0 || x >= shell.tilesWide || y >= shell.tilesHigh) return false;
  const walkable = insideWalkArea(shell, x, y) || insideDoorway(shell, x, y);
  if (!walkable) return true;
  if (!interior) return false;
  return cachedColliders(interior).some((rect) => insideRect(rect, x, y));
}

/** Whether a footprint-local point is indoors: between the walls, past the threshold. */
export function isInsideTownShell(shell: TownBuildingShell, x: number, y: number): boolean {
  if (shell.kind === 'ring') return insideWalkArea(shell, x, y);
  const face = SHELL_WALL_INNER;
  return x > shell.left + face && x < shell.right - face && y > shell.top + face && y < shell.bottom - face;
}

/** Footprint-local point just outside the doorway, where a visitor steps out. */
export function shellDoorstep(shell: TownBuildingShell): RoomPoint {
  const { side, along } = shell.door;
  switch (side) {
    case 'north': return { x: along, y: -0.5 };
    case 'south': return { x: along, y: shell.tilesHigh + 0.5 };
    case 'west': return { x: -0.5, y: along };
    case 'east': return { x: shell.tilesWide + 0.5, y: along };
  }
}

/** Footprint-local point just inside the doorway, where a visitor arrives. */
export function shellThreshold(shell: TownBuildingShell): RoomPoint {
  const { side, along } = shell.door;
  const { walk } = shell;
  switch (side) {
    case 'north': return { x: along, y: walk.y + 0.25 };
    case 'south': return { x: along, y: walk.y + walk.height - 0.25 };
    case 'west': return { x: walk.x + 0.25, y: along };
    case 'east': return { x: walk.x + walk.width - 0.25, y: along };
  }
}

/** The nearest hotspot within reach of a footprint-local point. */
export function nearestInteriorHotspot(
  interior: InteriorDefinition,
  x: number,
  y: number,
  rangeTiles = INTERIOR_INTERACTION_RANGE_TILES,
): InteriorHotspot | null {
  let nearest: InteriorHotspot | null = null;
  let nearestDistance = rangeTiles;
  for (const hotspot of interior.hotspots) {
    const distance = Math.hypot(hotspot.x - x, hotspot.y - y);
    if (distance <= nearestDistance) {
      nearest = hotspot;
      nearestDistance = distance;
    }
  }
  return nearest;
}

/** Sampling step for reachability checks: one eighth of a tile (two pixels). */
const REACH_STEP = 0.125;

/**
 * Footprint-local sample points a visitor can walk to from outside the door,
 * moving in four directions on a two-pixel lattice. Used by content validation
 * so no layout can wall a keeper off from the doorway.
 */
export function reachableShellPoints(shell: TownBuildingShell, interior: InteriorDefinition): RoomPoint[] {
  const columns = Math.round(shell.tilesWide / REACH_STEP);
  const rows = Math.round(shell.tilesHigh / REACH_STEP);
  const start = shellDoorstep(shell);
  const toIndex = (x: number, y: number): [number, number] => [Math.round(x / REACH_STEP), Math.round(y / REACH_STEP)];
  const [startColumn, startRow] = toIndex(
    Math.min(shell.tilesWide - REACH_STEP, Math.max(0, start.x)),
    Math.min(shell.tilesHigh - REACH_STEP, Math.max(0, start.y)),
  );
  const seen = new Set<number>();
  const queue: Array<[number, number]> = [[startColumn, startRow]];
  const points: RoomPoint[] = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const [column, row] = queue[cursor]!;
    if (column < 0 || row < 0 || column >= columns || row >= rows) continue;
    const key = row * columns + column;
    if (seen.has(key)) continue;
    seen.add(key);
    const x = column * REACH_STEP;
    const y = row * REACH_STEP;
    if (townShellBlocks(shell, interior, x, y)) continue;
    points.push({ x, y });
    queue.push([column + 1, row], [column - 1, row], [column, row + 1], [column, row - 1]);
  }
  return points;
}
