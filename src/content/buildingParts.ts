import type { NonEmptyEfficiencyAxes } from './efficiency';
import type { BuildingDefinitionId, ResourceId } from '../simulation/state';

/**
 * Building materials and the buildable part catalog. Parts live on four
 * occupancy layers per the spec: player surface cells, boundary parts,
 * environment markers, and facility footprints. Boundary parts occupy whole
 * tiles in Phase 1 (a deliberate simplification of the spec's edge model —
 * the logical rules, kinds, and scoring are unchanged by the representation).
 */

export type BuildingMaterialId = 'thatch' | 'wood' | 'stone' | 'metal';

/** Canonical Homestead Rating values for every construction material. */
export const MATERIAL_VALUES: Readonly<Record<BuildingMaterialId, number>> = {
  thatch: 1,
  wood: 3,
  stone: 8,
  metal: 20,
};

export type PartLayer = 'surface' | 'boundary' | 'footprint';
export type FootprintKind = 'marker' | 'facility' | 'landscape';
export type LandscapeKind = 'bridge' | 'water';
/** floor cells form indoor rooms; prepared ground forms work yards/paddocks. */
export type SurfaceKind = 'floor' | 'ground';
/** Walls/doors close floors; fences/gates close prepared ground. */
export type BoundaryClass = 'wall' | 'door' | 'fence' | 'gate';

export type ResourceAmounts = Readonly<Partial<Record<ResourceId, number>>>;

export interface BuildableDefinition {
  id: BuildingDefinitionId;
  displayName: string;
  layer: PartLayer;
  cost: ResourceAmounts;
  tilesWide: number;
  tilesHigh: number;
  /** Scored parts (surfaces and boundaries) carry a material value. */
  material?: BuildingMaterialId;
  surfaceKind?: SurfaceKind;
  boundaryClass?: BoundaryClass;
  footprintKind?: FootprintKind;
  /** Terrain presented by a landscaping footprint. */
  landscapeKind?: LandscapeKind;
  /** False for compatibility-only definitions that should not appear in Build. */
  availableInPalette?: boolean;
  efficiencyAxes: NonEmptyEfficiencyAxes;
}

const surface = (
  id: BuildingDefinitionId,
  displayName: string,
  material: BuildingMaterialId,
  surfaceKind: SurfaceKind,
  cost: ResourceAmounts,
): BuildableDefinition => ({
  id, displayName, layer: 'surface', material, surfaceKind, cost,
  tilesWide: 1, tilesHigh: 1,
  // Player-created usable space is what unlocks and hosts every facility.
  efficiencyAxes: ['uptime'],
});

const boundary = (
  id: BuildingDefinitionId,
  displayName: string,
  material: BuildingMaterialId,
  boundaryClass: BoundaryClass,
  cost: ResourceAmounts,
  tilesLong = 1,
): BuildableDefinition => ({
  id, displayName, layer: 'boundary', material, boundaryClass, cost,
  tilesWide: tilesLong, tilesHigh: 1,
  efficiencyAxes: ['safety', 'uptime'],
});

export const BUILDABLES: readonly BuildableDefinition[] = [
  surface('thatch-floor', 'Thatch Floor', 'thatch', 'floor', { fiber: 1 }),
  surface('wood-floor', 'Wood Floor', 'wood', 'floor', { wood: 1 }),
  surface('stone-floor', 'Stone Floor', 'stone', 'floor', { stone: 2 }),
  surface('metal-floor', 'Metal Floor', 'metal', 'floor', { 'iron-ingot': 2 }),
  surface('thatch-ground', 'Thatch Ground Cover', 'thatch', 'ground', { fiber: 1 }),
  surface('wood-ground', 'Wood Ground Deck', 'wood', 'ground', { wood: 1 }),
  surface('stone-ground', 'Stone Ground', 'stone', 'ground', { stone: 2 }),
  surface('metal-ground', 'Metal Ground', 'metal', 'ground', { 'iron-ingot': 2 }),
  boundary('thatch-wall', 'Thatch Wall', 'thatch', 'wall', { fiber: 2 }),
  boundary('wood-wall', 'Wood Wall', 'wood', 'wall', { wood: 1 }),
  boundary('stone-wall', 'Stone Wall', 'stone', 'wall', { stone: 3 }),
  boundary('metal-wall', 'Metal Wall', 'metal', 'wall', { 'iron-ingot': 3 }),
  boundary('thatch-door', 'Thatch Door', 'thatch', 'door', { fiber: 3 }),
  boundary('wood-door', 'Wood Door', 'wood', 'door', { wood: 2 }),
  boundary('stone-door', 'Stone Door', 'stone', 'door', { stone: 4 }),
  boundary('metal-door', 'Metal Door', 'metal', 'door', { 'iron-ingot': 4 }),
  boundary('thatch-fence', 'Thatch Fence', 'thatch', 'fence', { fiber: 1 }, 2),
  boundary('wood-fence', 'Wood Fence', 'wood', 'fence', { wood: 1 }, 2),
  boundary('stone-fence', 'Stone Fence', 'stone', 'fence', { stone: 2 }, 2),
  boundary('metal-fence', 'Metal Fence', 'metal', 'fence', { 'iron-ingot': 2 }, 2),
  boundary('thatch-gate', 'Thatch Gate', 'thatch', 'gate', { fiber: 2 }, 2),
  boundary('wood-gate', 'Wood Gate', 'wood', 'gate', { wood: 2 }, 2),
  boundary('stone-gate', 'Stone Gate', 'stone', 'gate', { stone: 4 }, 2),
  boundary('metal-gate', 'Metal Gate', 'metal', 'gate', { 'iron-ingot': 4 }, 2),
  {
    id: 'wood-bridge',
    displayName: 'Wood Bridge',
    layer: 'footprint',
    footprintKind: 'landscape',
    landscapeKind: 'bridge',
    material: 'wood',
    cost: { wood: 4 },
    tilesWide: 2,
    tilesHigh: 1,
    efficiencyAxes: ['travel'],
  },
  {
    id: 'stone-bridge',
    displayName: 'Stone Bridge',
    layer: 'footprint',
    footprintKind: 'landscape',
    landscapeKind: 'bridge',
    material: 'stone',
    cost: { stone: 6 },
    tilesWide: 2,
    tilesHigh: 1,
    efficiencyAxes: ['travel'],
  },
  {
    id: 'water',
    displayName: 'Water',
    layer: 'footprint',
    footprintKind: 'landscape',
    landscapeKind: 'water',
    cost: {},
    tilesWide: 1,
    tilesHigh: 1,
    efficiencyAxes: ['travel'],
  },
  {
    id: 'environment-marker',
    displayName: 'Environment Marker',
    layer: 'footprint',
    footprintKind: 'marker',
    // Older saves can still contain markers, but rooms and yards are now
    // inferred from their surfaces and boundaries without player busywork.
    availableInPalette: false,
    cost: { wood: 2, fiber: 2 },
    tilesWide: 1,
    tilesHigh: 1,
    efficiencyAxes: ['uptime'],
  },
  {
    id: 'field-cache',
    displayName: 'Storage Box (small)',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 4 },
    tilesWide: 1,
    tilesHigh: 1,
    efficiencyAxes: ['carry', 'pickup'],
  },
  {
    id: 'workbench',
    displayName: 'Workbench',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 8 },
    tilesWide: 2,
    tilesHigh: 1,
    efficiencyAxes: ['break', 'uptime'],
  },
  {
    id: 'warehouse',
    displayName: 'Warehouse',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 24, stone: 16, 'iron-ingot': 2 },
    tilesWide: 3,
    tilesHigh: 2,
    efficiencyAxes: ['carry', 'pickup'],
  },
  {
    id: 'logistics-hub',
    displayName: 'Logistics Hub',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 16, stone: 12, 'iron-ingot': 6 },
    tilesWide: 2,
    tilesHigh: 2,
    efficiencyAxes: ['carry', 'pickup', 'uptime'],
  },
  {
    id: 'furnace',
    displayName: 'Furnace',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 4, stone: 8 },
    tilesWide: 2,
    tilesHigh: 1,
    efficiencyAxes: ['process', 'uptime'],
  },
  {
    id: 'farm-counter',
    displayName: 'Farm Counter',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 8, fiber: 2 },
    tilesWide: 2,
    tilesHigh: 1,
    efficiencyAxes: ['yield', 'pickup'],
  },
  {
    id: 'small-pen',
    displayName: 'Small Pen',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 10, fiber: 4 },
    tilesWide: 2,
    tilesHigh: 2,
    efficiencyAxes: ['yield', 'uptime'],
  },
  {
    id: 'barn',
    displayName: 'Barn',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 24, stone: 8, fiber: 8 },
    tilesWide: 3,
    tilesHigh: 2,
    efficiencyAxes: ['yield', 'uptime'],
  },
  {
    id: 'stone-yard',
    displayName: 'Stone Yard',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 12, stone: 8 },
    tilesWide: 2,
    tilesHigh: 2,
    efficiencyAxes: ['yield', 'pickup'],
  },
  {
    id: 'cart-dock',
    displayName: 'Cart Dock',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 16, stone: 4, fiber: 4 },
    tilesWide: 2,
    tilesHigh: 2,
    efficiencyAxes: ['carry', 'pickup'],
  },
  {
    id: 'bed',
    displayName: 'Bed',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 4, fiber: 2 },
    tilesWide: 2,
    tilesHigh: 1,
    efficiencyAxes: ['safety', 'uptime'],
  },
  {
    id: 'air-purifier',
    displayName: 'Air Purifier',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 4, stone: 2 },
    tilesWide: 1,
    tilesHigh: 1,
    efficiencyAxes: ['safety', 'uptime'],
  },
  {
    id: 'garden-bed',
    displayName: 'Garden Bed',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 4, fiber: 2 },
    tilesWide: 2,
    tilesHigh: 1,
    efficiencyAxes: ['renew', 'travel'],
  },
  {
    id: 'war-table',
    displayName: 'War Table',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 12, stone: 6 },
    tilesWide: 2,
    tilesHigh: 1,
    efficiencyAxes: ['safety', 'uptime'],
  },
  {
    id: 'turret',
    displayName: 'Turret',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 8, stone: 6, 'iron-ingot': 1 },
    tilesWide: 1,
    tilesHigh: 1,
    efficiencyAxes: ['safety'],
  },
  {
    id: 'woodlot-planter',
    displayName: 'Woodlot Planter',
    layer: 'footprint',
    footprintKind: 'facility',
    cost: { wood: 6, stone: 2 },
    tilesWide: 2,
    tilesHigh: 2,
    efficiencyAxes: ['renew', 'travel'],
  },
];

export function buildableById(id: BuildingDefinitionId): BuildableDefinition {
  const definition = BUILDABLES.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`unknown buildable ${id}`);
  return definition;
}

export const BUILDING_DEFINITION_IDS: ReadonlySet<string> = new Set(
  BUILDABLES.map((definition) => definition.id),
);

/** Boundary classes that close each surface kind's perimeter. */
export const CLOSING_CLASSES: Readonly<Record<SurfaceKind, readonly BoundaryClass[]>> = {
  floor: ['wall', 'door'],
  ground: ['fence', 'gate'],
};
