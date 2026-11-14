import type { NpcId, NpcService } from './npcs';
import type { TownBuildingId } from './townBuildings';
import type { Facing } from '../simulation/state';

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
  | 'arena-ring' | 'training-post' | 'spectator-bench' | 'banner';

export type InteriorEffect =
  | 'forge-sparks' | 'chimney-embers' | 'dust-motes' | 'animal-idles'
  | 'market-bustle' | 'stained-light' | 'candle-flicker' | 'metal-glints'
  | 'rune-drift' | 'floating-pages' | 'hearth-embers' | 'crowd-motion';

export type InteriorNpcActivity =
  | 'hammering' | 'checking-ledger' | 'arranging-stock' | 'quiet-reflection'
  | 'armour-drill' | 'arcane-study' | 'serving-patrons' | 'coaching';

export interface InteriorPoint { readonly tileX: number; readonly tileY: number }
export interface InteriorSize { readonly tilesWide: number; readonly tilesHigh: number }
export interface InteriorPose extends InteriorPoint { readonly facing: Facing }

export interface InteriorCollider extends InteriorPoint, InteriorSize {
  readonly id: string;
}

export interface InteriorProp extends InteriorPoint {
  readonly id: string;
  readonly prefab: InteriorPropPrefab;
  readonly rotationDegrees: 0 | 90 | 180 | 270;
}

export interface InteriorExitHotspot extends InteriorPoint {
  readonly id: string;
  readonly kind: 'exit';
  readonly label: string;
}

export interface InteriorServiceHotspot extends InteriorPoint {
  readonly id: string;
  readonly kind: 'service';
  readonly label: string;
  readonly npcId: NpcId;
  readonly service: NpcService;
}

export interface InteriorExamineHotspot extends InteriorPoint {
  readonly id: string;
  readonly kind: 'examine';
  readonly label: string;
  readonly text: string;
}

export type InteriorHotspot = InteriorExitHotspot | InteriorServiceHotspot | InteriorExamineHotspot;

export interface InteriorNpcSpawn extends InteriorPose {
  readonly npcId: NpcId;
  readonly activity: InteriorNpcActivity;
  readonly interactionRadiusTiles: number;
}

export interface InteriorAmbience {
  readonly soundscape: string;
  readonly ambientColor: number;
  readonly ambientIntensity: number;
  readonly keyLightColor: number;
  readonly keyLightIntensity: number;
  readonly effects: readonly InteriorEffect[];
}

/**
 * Interiors only choose what the camera frames. The yaw, pitch, and distance
 * stay on the published overworld orientation so walking through a door never
 * swings the view — the lean the player tuned outside is the lean inside.
 */
export interface InteriorCameraConfig {
  readonly target: InteriorPoint;
}

export interface InteriorDefinition {
  readonly id: InteriorId;
  readonly buildingId: TownBuildingId;
  readonly displayName: string;
  readonly dimensions: InteriorSize;
  readonly playerSpawn: InteriorPose;
  readonly exit: InteriorExitHotspot;
  readonly collision: readonly InteriorCollider[];
  readonly props: readonly InteriorProp[];
  readonly hotspots: readonly InteriorHotspot[];
  readonly npcSpawns: readonly InteriorNpcSpawn[];
  readonly ambience: InteriorAmbience;
  readonly camera: InteriorCameraConfig;
}

export const INTERIOR_DEFINITIONS: readonly InteriorDefinition[] = [
  {
    id: 'weaponsmith-forge', buildingId: 'weaponsmith', displayName: "Mara's Forge",
    dimensions: { tilesWide: 12, tilesHigh: 10 },
    playerSpawn: { tileX: 5, tileY: 8, facing: 'up' },
    exit: { id: 'forge-exit', kind: 'exit', label: 'Leave the Weaponsmith', tileX: 5, tileY: 9 },
    collision: [
      { id: 'forge-hearth', tileX: 1, tileY: 1, tilesWide: 3, tilesHigh: 2 },
      { id: 'forge-workbench', tileX: 7, tileY: 1, tilesWide: 3, tilesHigh: 1 },
      { id: 'forge-rack', tileX: 10, tileY: 1, tilesWide: 1, tilesHigh: 4 },
      { id: 'forge-anvil', tileX: 4, tileY: 4, tilesWide: 1, tilesHigh: 1 },
    ],
    props: [
      { id: 'forge', prefab: 'forge', tileX: 1, tileY: 1, rotationDegrees: 0 },
      { id: 'anvil', prefab: 'anvil', tileX: 4, tileY: 4, rotationDegrees: 0 },
      { id: 'workbench', prefab: 'workbench', tileX: 7, tileY: 1, rotationDegrees: 180 },
      { id: 'tool-rack', prefab: 'tool-rack', tileX: 10, tileY: 2, rotationDegrees: 270 },
      { id: 'coal-barrel', prefab: 'barrel', tileX: 1, tileY: 7, rotationDegrees: 0 },
    ],
    hotspots: [
      { id: 'forge-exit', kind: 'exit', label: 'Leave the Weaponsmith', tileX: 5, tileY: 9 },
      { id: 'mara-service', kind: 'service', label: 'Present a tool to Mara', npcId: 'mara-smith', service: 'weaponsmith', tileX: 7, tileY: 5 },
      { id: 'inspect-anvil', kind: 'examine', label: 'Inspect anvil', text: 'The face is polished by years of deliberate blows.', tileX: 4, tileY: 5 },
    ],
    npcSpawns: [
      { npcId: 'mara-smith', activity: 'hammering', interactionRadiusTiles: 2, tileX: 8, tileY: 4, facing: 'left' },
    ],
    ambience: { soundscape: 'interior-forge', ambientColor: 0x6f3927, ambientIntensity: 0.55, keyLightColor: 0xff8a3d, keyLightIntensity: 1.35, effects: ['forge-sparks', 'chimney-embers'] },
    camera: { target: { tileX: 5, tileY: 4 } },
  },
  {
    id: 'verdant-reach-farm', buildingId: 'farm', displayName: 'Verdant Reach Stockhouse',
    dimensions: { tilesWide: 14, tilesHigh: 11 },
    playerSpawn: { tileX: 6, tileY: 9, facing: 'up' },
    exit: { id: 'farm-exit', kind: 'exit', label: 'Leave the Farm', tileX: 6, tileY: 10 },
    collision: [
      { id: 'west-pen', tileX: 1, tileY: 2, tilesWide: 3, tilesHigh: 4 },
      { id: 'east-pen', tileX: 10, tileY: 2, tilesWide: 3, tilesHigh: 4 },
      { id: 'feed-stack', tileX: 1, tileY: 8, tilesWide: 3, tilesHigh: 1 },
      { id: 'ledger-desk', tileX: 7, tileY: 4, tilesWide: 2, tilesHigh: 1 },
    ],
    props: [
      { id: 'west-pen', prefab: 'animal-pen', tileX: 1, tileY: 2, rotationDegrees: 0 },
      { id: 'east-pen', prefab: 'animal-pen', tileX: 10, tileY: 2, rotationDegrees: 0 },
      { id: 'feed-sacks', prefab: 'feed-sacks', tileX: 1, tileY: 8, rotationDegrees: 0 },
      { id: 'ledger', prefab: 'ledger-desk', tileX: 7, tileY: 4, rotationDegrees: 180 },
      { id: 'supply-barrel', prefab: 'barrel', tileX: 12, tileY: 8, rotationDegrees: 0 },
    ],
    hotspots: [
      { id: 'farm-exit', kind: 'exit', label: 'Leave the Farm', tileX: 6, tileY: 10 },
      { id: 'orin-service', kind: 'service', label: "Review Orin's ledger", npcId: 'orin-stockkeeper', service: 'farm', tileX: 7, tileY: 5 },
      { id: 'inspect-pen', kind: 'examine', label: 'Inspect training pen', text: 'Fresh bedding and patient routines keep the animals calm.', tileX: 4, tileY: 3 },
    ],
    npcSpawns: [
      { npcId: 'orin-stockkeeper', activity: 'checking-ledger', interactionRadiusTiles: 2, tileX: 8, tileY: 3, facing: 'down' },
    ],
    ambience: { soundscape: 'interior-stockhouse', ambientColor: 0x8b7042, ambientIntensity: 0.7, keyLightColor: 0xd8d58a, keyLightIntensity: 1, effects: ['dust-motes', 'animal-idles'] },
    camera: { target: { tileX: 6, tileY: 5 } },
  },
  {
    id: 'elaris-market', buildingId: 'market', displayName: 'Elaris Market Hall',
    dimensions: { tilesWide: 14, tilesHigh: 10 },
    playerSpawn: { tileX: 6, tileY: 1, facing: 'down' },
    exit: { id: 'market-exit', kind: 'exit', label: 'Leave the Market', tileX: 6, tileY: 0 },
    collision: [
      { id: 'west-stall', tileX: 1, tileY: 2, tilesWide: 3, tilesHigh: 2 },
      { id: 'east-stall', tileX: 10, tileY: 2, tilesWide: 3, tilesHigh: 2 },
      { id: 'west-crates', tileX: 1, tileY: 7, tilesWide: 2, tilesHigh: 1 },
      { id: 'trader-counter', tileX: 6, tileY: 6, tilesWide: 3, tilesHigh: 1 },
    ],
    props: [
      { id: 'west-stall', prefab: 'market-stall', tileX: 1, tileY: 2, rotationDegrees: 90 },
      { id: 'east-stall', prefab: 'market-stall', tileX: 10, tileY: 2, rotationDegrees: 270 },
      { id: 'produce', prefab: 'produce-crates', tileX: 1, tileY: 7, rotationDegrees: 0 },
      { id: 'trader-counter', prefab: 'counter', tileX: 6, tileY: 6, rotationDegrees: 0 },
      { id: 'scale', prefab: 'merchant-scale', tileX: 9, tileY: 7, rotationDegrees: 0 },
    ],
    hotspots: [
      { id: 'market-exit', kind: 'exit', label: 'Leave the Market', tileX: 6, tileY: 0 },
      { id: 'tavi-service', kind: 'service', label: 'Place goods on the counter', npcId: 'tavi-trader', service: 'market', tileX: 7, tileY: 7 },
      { id: 'inspect-scale', kind: 'examine', label: 'Inspect merchant scale', text: 'The brass weights are marked with the seal of Elaris.', tileX: 9, tileY: 7 },
    ],
    npcSpawns: [
      { npcId: 'tavi-trader', activity: 'arranging-stock', interactionRadiusTiles: 2, tileX: 7, tileY: 5, facing: 'down' },
    ],
    ambience: { soundscape: 'interior-market', ambientColor: 0x8da0a8, ambientIntensity: 0.75, keyLightColor: 0xffd77a, keyLightIntensity: 1.1, effects: ['dust-motes', 'market-bustle'] },
    camera: { target: { tileX: 6, tileY: 5 } },
  },
  {
    id: 'elaris-church', buildingId: 'church', displayName: 'Sanctuary of Elaris',
    dimensions: { tilesWide: 11, tilesHigh: 13 },
    playerSpawn: { tileX: 5, tileY: 11, facing: 'up' },
    exit: { id: 'church-exit', kind: 'exit', label: 'Leave the Church', tileX: 5, tileY: 12 },
    collision: [
      { id: 'west-pews-a', tileX: 1, tileY: 6, tilesWide: 3, tilesHigh: 1 },
      { id: 'east-pews-a', tileX: 7, tileY: 6, tilesWide: 3, tilesHigh: 1 },
      { id: 'west-pews-b', tileX: 1, tileY: 8, tilesWide: 3, tilesHigh: 1 },
      { id: 'east-pews-b', tileX: 7, tileY: 8, tilesWide: 3, tilesHigh: 1 },
      { id: 'altar', tileX: 4, tileY: 2, tilesWide: 3, tilesHigh: 1 },
    ],
    props: [
      { id: 'west-pews-a', prefab: 'pew', tileX: 1, tileY: 6, rotationDegrees: 0 },
      { id: 'east-pews-a', prefab: 'pew', tileX: 7, tileY: 6, rotationDegrees: 0 },
      { id: 'west-pews-b', prefab: 'pew', tileX: 1, tileY: 8, rotationDegrees: 0 },
      { id: 'east-pews-b', prefab: 'pew', tileX: 7, tileY: 8, rotationDegrees: 0 },
      { id: 'altar', prefab: 'altar', tileX: 4, tileY: 2, rotationDegrees: 0 },
      { id: 'window', prefab: 'stained-window', tileX: 5, tileY: 0, rotationDegrees: 0 },
      { id: 'candles', prefab: 'candle-stand', tileX: 8, tileY: 3, rotationDegrees: 0 },
    ],
    hotspots: [
      { id: 'church-exit', kind: 'exit', label: 'Leave the Church', tileX: 5, tileY: 12 },
      { id: 'elowen-service', kind: 'service', label: 'Reflect with Elowen', npcId: 'elowen-caretaker', service: 'church', tileX: 5, tileY: 4 },
      { id: 'inspect-window', kind: 'examine', label: 'Study the stained glass', text: 'Colored light gathers around a path through a painted storm.', tileX: 5, tileY: 1 },
    ],
    npcSpawns: [
      { npcId: 'elowen-caretaker', activity: 'quiet-reflection', interactionRadiusTiles: 2, tileX: 6, tileY: 3, facing: 'down' },
    ],
    ambience: { soundscape: 'interior-sanctuary', ambientColor: 0x7189ac, ambientIntensity: 0.62, keyLightColor: 0xf5dfa0, keyLightIntensity: 1.2, effects: ['stained-light', 'candle-flicker'] },
    camera: { target: { tileX: 5, tileY: 5 } },
  },
  {
    id: 'elaris-armoury', buildingId: 'armoury', displayName: "Garrick's Armoury",
    dimensions: { tilesWide: 12, tilesHigh: 10 },
    playerSpawn: { tileX: 5, tileY: 8, facing: 'up' },
    exit: { id: 'armoury-exit', kind: 'exit', label: 'Leave the Armoury', tileX: 5, tileY: 9 },
    collision: [
      { id: 'west-rack', tileX: 1, tileY: 1, tilesWide: 1, tilesHigh: 5 },
      { id: 'east-rack', tileX: 10, tileY: 1, tilesWide: 1, tilesHigh: 5 },
      { id: 'dummy', tileX: 3, tileY: 4, tilesWide: 1, tilesHigh: 1 },
      { id: 'armour-counter', tileX: 7, tileY: 5, tilesWide: 3, tilesHigh: 1 },
    ],
    props: [
      { id: 'west-rack', prefab: 'armour-rack', tileX: 1, tileY: 2, rotationDegrees: 90 },
      { id: 'east-rack', prefab: 'armour-rack', tileX: 10, tileY: 2, rotationDegrees: 270 },
      { id: 'dummy', prefab: 'practice-dummy', tileX: 3, tileY: 4, rotationDegrees: 0 },
      { id: 'counter', prefab: 'counter', tileX: 7, tileY: 5, rotationDegrees: 0 },
      { id: 'shield', prefab: 'shield-display', tileX: 6, tileY: 1, rotationDegrees: 0 },
    ],
    hotspots: [
      { id: 'armoury-exit', kind: 'exit', label: 'Leave the Armoury', tileX: 5, tileY: 9 },
      { id: 'garrick-service', kind: 'service', label: 'Begin a drill with Garrick', npcId: 'garrick-armourer', service: 'armoury', tileX: 7, tileY: 6 },
      { id: 'inspect-dummy', kind: 'examine', label: 'Inspect practice dummy', text: 'Its smallest painted targets carry the deepest dents.', tileX: 3, tileY: 5 },
    ],
    npcSpawns: [
      { npcId: 'garrick-armourer', activity: 'armour-drill', interactionRadiusTiles: 2, tileX: 8, tileY: 4, facing: 'down' },
    ],
    ambience: { soundscape: 'interior-armoury', ambientColor: 0x778486, ambientIntensity: 0.65, keyLightColor: 0xdde6e3, keyLightIntensity: 1, effects: ['dust-motes', 'metal-glints'] },
    camera: { target: { tileX: 5, tileY: 4 } },
  },
  {
    id: 'sylvaren-arcanum', buildingId: 'magic-shop', displayName: 'Sylvaren Arcanum',
    dimensions: { tilesWide: 12, tilesHigh: 11 },
    playerSpawn: { tileX: 5, tileY: 9, facing: 'up' },
    exit: { id: 'arcanum-exit', kind: 'exit', label: 'Leave the Arcanum', tileX: 5, tileY: 10 },
    collision: [
      { id: 'west-books', tileX: 1, tileY: 1, tilesWide: 1, tilesHigh: 5 },
      { id: 'east-books', tileX: 10, tileY: 1, tilesWide: 1, tilesHigh: 5 },
      { id: 'staff-case', tileX: 8, tileY: 7, tilesWide: 2, tilesHigh: 1 },
    ],
    props: [
      { id: 'west-books', prefab: 'bookcase', tileX: 1, tileY: 2, rotationDegrees: 90 },
      { id: 'east-books', prefab: 'bookcase', tileX: 10, tileY: 2, rotationDegrees: 270 },
      { id: 'rune', prefab: 'rune-circle', tileX: 5, tileY: 5, rotationDegrees: 0 },
      { id: 'staff-case', prefab: 'staff-display', tileX: 8, tileY: 7, rotationDegrees: 180 },
      { id: 'books', prefab: 'floating-books', tileX: 6, tileY: 2, rotationDegrees: 0 },
    ],
    hotspots: [
      { id: 'arcanum-exit', kind: 'exit', label: 'Leave the Arcanum', tileX: 5, tileY: 10 },
      { id: 'selene-service', kind: 'service', label: 'Channel the service rune', npcId: 'selene-arcanist', service: 'magic-shop', tileX: 5, tileY: 5 },
      { id: 'inspect-staff', kind: 'examine', label: 'Inspect Magic Staff', text: 'Its focus crystal hums in sympathy with every nearby material.', tileX: 7, tileY: 7 },
    ],
    npcSpawns: [
      { npcId: 'selene-arcanist', activity: 'arcane-study', interactionRadiusTiles: 2, tileX: 6, tileY: 3, facing: 'down' },
    ],
    ambience: { soundscape: 'interior-arcanum', ambientColor: 0x5f4b87, ambientIntensity: 0.55, keyLightColor: 0x77e5f0, keyLightIntensity: 1.3, effects: ['rune-drift', 'floating-pages'] },
    camera: { target: { tileX: 5, tileY: 5 } },
  },
  {
    id: 'elaris-tavern', buildingId: 'tavern', displayName: 'The Wayfarer Tavern',
    dimensions: { tilesWide: 14, tilesHigh: 10 },
    playerSpawn: { tileX: 6, tileY: 1, facing: 'down' },
    exit: { id: 'tavern-exit', kind: 'exit', label: 'Leave the Tavern', tileX: 6, tileY: 0 },
    collision: [
      { id: 'hearth', tileX: 1, tileY: 5, tilesWide: 2, tilesHigh: 2 },
      { id: 'bar', tileX: 8, tileY: 4, tilesWide: 4, tilesHigh: 1 },
      { id: 'west-table', tileX: 3, tileY: 3, tilesWide: 2, tilesHigh: 2 },
      { id: 'south-table', tileX: 4, tileY: 7, tilesWide: 2, tilesHigh: 2 },
    ],
    props: [
      { id: 'hearth', prefab: 'hearth', tileX: 1, tileY: 5, rotationDegrees: 90 },
      { id: 'bar', prefab: 'counter', tileX: 8, tileY: 4, rotationDegrees: 0 },
      { id: 'west-table', prefab: 'tavern-table', tileX: 3, tileY: 3, rotationDegrees: 0 },
      { id: 'south-table', prefab: 'tavern-table', tileX: 4, tileY: 7, rotationDegrees: 0 },
      { id: 'notice', prefab: 'notice-board', tileX: 12, tileY: 7, rotationDegrees: 270 },
    ],
    hotspots: [
      { id: 'tavern-exit', kind: 'exit', label: 'Leave the Tavern', tileX: 6, tileY: 0 },
      { id: 'bram-service', kind: 'service', label: 'Ask Bram for a story', npcId: 'bram-innkeeper', service: 'tavern', tileX: 8, tileY: 5 },
      { id: 'inspect-notice-board', kind: 'examine', label: 'Read local notices', text: 'Half the notices are jobs. The other half warn against taking them.', tileX: 12, tileY: 6 },
    ],
    npcSpawns: [
      { npcId: 'bram-innkeeper', activity: 'serving-patrons', interactionRadiusTiles: 2, tileX: 9, tileY: 3, facing: 'down' },
    ],
    ambience: { soundscape: 'interior-tavern', ambientColor: 0x805438, ambientIntensity: 0.7, keyLightColor: 0xffbc68, keyLightIntensity: 1.2, effects: ['hearth-embers', 'dust-motes'] },
    camera: { target: { tileX: 6, tileY: 5 } },
  },
  {
    id: 'elaris-arena', buildingId: 'arena', displayName: 'Elaris Arena',
    dimensions: { tilesWide: 18, tilesHigh: 14 },
    playerSpawn: { tileX: 8, tileY: 1, facing: 'down' },
    exit: { id: 'arena-exit', kind: 'exit', label: 'Leave the Arena', tileX: 8, tileY: 0 },
    collision: [
      { id: 'west-benches', tileX: 1, tileY: 3, tilesWide: 2, tilesHigh: 8 },
      { id: 'east-benches', tileX: 15, tileY: 3, tilesWide: 2, tilesHigh: 8 },
      { id: 'north-post', tileX: 7, tileY: 11, tilesWide: 1, tilesHigh: 1 },
      { id: 'south-post', tileX: 10, tileY: 3, tilesWide: 1, tilesHigh: 1 },
    ],
    props: [
      { id: 'ring', prefab: 'arena-ring', tileX: 6, tileY: 6, rotationDegrees: 0 },
      { id: 'west-benches', prefab: 'spectator-bench', tileX: 1, tileY: 5, rotationDegrees: 90 },
      { id: 'east-benches', prefab: 'spectator-bench', tileX: 15, tileY: 5, rotationDegrees: 270 },
      { id: 'north-post', prefab: 'training-post', tileX: 7, tileY: 11, rotationDegrees: 0 },
      { id: 'south-post', prefab: 'training-post', tileX: 10, tileY: 3, rotationDegrees: 0 },
      { id: 'banner', prefab: 'banner', tileX: 8, tileY: 13, rotationDegrees: 180 },
    ],
    hotspots: [
      { id: 'arena-exit', kind: 'exit', label: 'Leave the Arena', tileX: 8, tileY: 0 },
      { id: 'kael-service', kind: 'service', label: 'Choose a drill with Kael', npcId: 'kael-arena-master', service: 'arena', tileX: 13, tileY: 5 },
      { id: 'inspect-ring', kind: 'examine', label: 'Inspect the arena ring', text: 'The sand records every hesitation more faithfully than any audience.', tileX: 8, tileY: 6 },
    ],
    npcSpawns: [
      { npcId: 'kael-arena-master', activity: 'coaching', interactionRadiusTiles: 2, tileX: 14, tileY: 4, facing: 'left' },
    ],
    ambience: { soundscape: 'interior-arena', ambientColor: 0x9a7655, ambientIntensity: 0.8, keyLightColor: 0xffd181, keyLightIntensity: 1.3, effects: ['dust-motes', 'crowd-motion'] },
    camera: { target: { tileX: 8, tileY: 7 } },
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

export function interiorTileKey(point: InteriorPoint): string {
  return `${point.tileX},${point.tileY}`;
}

export function isInteriorTileWalkable(interior: InteriorDefinition, tileX: number, tileY: number): boolean {
  if (!Number.isSafeInteger(tileX) || !Number.isSafeInteger(tileY)) return false;
  if (tileX < 0 || tileY < 0 || tileX >= interior.dimensions.tilesWide || tileY >= interior.dimensions.tilesHigh) return false;
  return !interior.collision.some((collider) =>
    tileX >= collider.tileX && tileX < collider.tileX + collider.tilesWide
      && tileY >= collider.tileY && tileY < collider.tileY + collider.tilesHigh,
  );
}

/** Four-way walkable component used by validation and future interior movement. */
export function reachableInteriorTileKeys(interior: InteriorDefinition): ReadonlySet<string> {
  if (!isInteriorTileWalkable(interior, interior.playerSpawn.tileX, interior.playerSpawn.tileY)) return new Set();
  const reachable = new Set<string>();
  const queue: InteriorPoint[] = [interior.playerSpawn];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const point = queue[cursor]!;
    const key = interiorTileKey(point);
    if (reachable.has(key) || !isInteriorTileWalkable(interior, point.tileX, point.tileY)) continue;
    reachable.add(key);
    queue.push(
      { tileX: point.tileX + 1, tileY: point.tileY },
      { tileX: point.tileX - 1, tileY: point.tileY },
      { tileX: point.tileX, tileY: point.tileY + 1 },
      { tileX: point.tileX, tileY: point.tileY - 1 },
    );
  }
  return reachable;
}
