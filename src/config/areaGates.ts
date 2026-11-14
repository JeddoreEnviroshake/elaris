import type { NonEmptyEfficiencyAxes } from '../content/efficiency';
import type { SurfaceKind } from '../content/buildingParts';
import type { UnlockRequirement } from '../simulation/unlocks';
import type { EnvironmentKind } from '../simulation/state';

/**
 * Area gates are data, not seven hand-written code paths. A qualified area
 * must meet both the total cell count and its filled-square requirement.
 */
export const AREA_TIERS = [
  // The onboarding objective promises that any four enclosed floor tiles form
  // a Nook. Larger tiers retain their filled-core shape requirements.
  { area: 4, filledCore: 1, label: 'Nook' },
  { area: 8, filledCore: 2, label: 'Shelter' },
  { area: 16, filledCore: 4, label: 'Workshop' },
  { area: 32, filledCore: 4, label: 'Yard' },
  { area: 64, filledCore: 8, label: 'Homestead' },
  { area: 128, filledCore: 8, label: 'Compound' },
  { area: 256, filledCore: 16, label: 'Estate' },
] as const;

export type AreaTier = (typeof AREA_TIERS)[number]['area'];
export type { EnvironmentKind } from '../simulation/state';

export interface PlaceableDefinition {
  id: 'field-cache' | 'workbench' | 'furnace' | 'bed' | 'air-purifier' | 'garden-bed' | 'woodlot-planter'
  | 'farm-counter' | 'small-pen' | 'barn' | 'stone-yard' | 'cart-dock' | 'war-table' | 'turret'
  | 'warehouse' | 'logistics-hub';
  displayName: string;
  /** The CURRENT environment must qualify for placement and operation. */
  /** Older facilities use area progression; omitted facilities have no tile threshold. */
  minEnvironmentArea?: AreaTier;
  /** Absent means any environment kind qualifies. */
  environmentKind?: EnvironmentKind;
  /** Natural terrain required beneath the footprint (soil-bound placeables). */
  requiredTerrain?: 'grassland' | 'forest';
  /** Player-built surface required beneath the footprint (e.g. workbench -> floor). */
  requiredSurface?: SurfaceKind;
  /**
   * Typed blueprint ownership: reaching an area tier for the first time
   * permanently discovers the placeable; current geometry still gates use.
   */
  requirement: UnlockRequirement;
  efficiencyAxes: NonEmptyEfficiencyAxes;
}

/** First facilities unlocked by the Milestone 1 environment arc. */
export const PLACEABLES: readonly PlaceableDefinition[] = [
  {
    id: 'field-cache',
    displayName: 'Storage Box (small)',
    minEnvironmentArea: 4,
    requirement: { allOf: [{ kind: 'highestAreaTierEver', atLeast: 4 }] },
    efficiencyAxes: ['carry', 'pickup'],
  },
  {
    id: 'workbench',
    displayName: 'Workbench',
    requiredSurface: 'floor',
    requirement: { allOf: [{ kind: 'highestAreaTierEver', atLeast: 8 }] },
    efficiencyAxes: ['break', 'uptime'],
  },
  {
    id: 'warehouse',
    displayName: 'Warehouse',
    requiredSurface: 'floor',
    requirement: { alwaysUnlocked: true },
    efficiencyAxes: ['carry', 'pickup'],
  },
  {
    id: 'logistics-hub',
    displayName: 'Logistics Hub',
    environmentKind: 'indoor',
    requiredSurface: 'floor',
    requirement: { alwaysUnlocked: true },
    efficiencyAxes: ['carry', 'pickup', 'uptime'],
  },
  {
    id: 'furnace',
    displayName: 'Furnace',
    environmentKind: 'indoor',
    requirement: { allOf: [{ kind: 'materialDiscovered', materialId: 'iron' }] },
    efficiencyAxes: ['process', 'uptime'],
  },
  {
    id: 'farm-counter',
    displayName: 'Farm Counter',
    requiredSurface: 'floor',
    requirement: { alwaysUnlocked: true },
    efficiencyAxes: ['yield', 'pickup'],
  },
  {
    id: 'small-pen',
    displayName: 'Small Pen',
    environmentKind: 'workYard',
    requiredSurface: 'ground',
    requirement: { alwaysUnlocked: true },
    efficiencyAxes: ['yield', 'uptime'],
  },
  {
    id: 'barn',
    displayName: 'Barn',
    environmentKind: 'workYard',
    requiredSurface: 'ground',
    requirement: { alwaysUnlocked: true },
    efficiencyAxes: ['yield', 'uptime'],
  },
  {
    id: 'stone-yard',
    displayName: 'Stone Yard',
    environmentKind: 'workYard',
    requiredSurface: 'ground',
    requirement: { alwaysUnlocked: true },
    efficiencyAxes: ['yield', 'pickup'],
  },
  {
    id: 'cart-dock',
    displayName: 'Cart Dock',
    environmentKind: 'workYard',
    requiredSurface: 'ground',
    requirement: { alwaysUnlocked: true },
    efficiencyAxes: ['carry', 'pickup'],
  },
  {
    id: 'bed',
    displayName: 'Bed',
    environmentKind: 'indoor',
    requiredSurface: 'floor',
    requirement: { allOf: [{ kind: 'highestAreaTierEver', atLeast: 4 }] },
    efficiencyAxes: ['safety', 'uptime'],
  },
  {
    id: 'air-purifier',
    displayName: 'Air Purifier',
    // A floor is still required, but the purifier may be installed before its
    // surrounding walls are complete; unenclosed placement gets local range.
    requiredSurface: 'floor',
    requirement: { allOf: [{ kind: 'highestAreaTierEver', atLeast: 4 }] },
    efficiencyAxes: ['safety', 'uptime'],
  },
  {
    id: 'garden-bed',
    displayName: 'Garden Bed',
    minEnvironmentArea: 8,
    environmentKind: 'workYard',
    requiredTerrain: 'grassland',
    requirement: { allOf: [{ kind: 'highestAreaTierEver', atLeast: 8 }] },
    efficiencyAxes: ['renew', 'travel'],
  },
  {
    id: 'war-table',
    displayName: 'War Table',
    environmentKind: 'indoor',
    requiredSurface: 'floor',
    requirement: { allOf: [{ kind: 'highestAreaTierEver', atLeast: 8 }] },
    efficiencyAxes: ['safety', 'uptime'],
  },
  {
    // Deliberately unconstrained beyond the universal "player-built surface
    // beneath every tile" rule in evaluateFacilityGate, so a Turret works on a
    // wall line indoors or out in an open work yard.
    id: 'turret',
    displayName: 'Turret',
    requirement: { allOf: [{ kind: 'facilityPlaced', definitionId: 'war-table' }] },
    efficiencyAxes: ['safety'],
  },
  {
    id: 'woodlot-planter',
    displayName: 'Woodlot Planter',
    minEnvironmentArea: 16,
    environmentKind: 'workYard',
    requiredTerrain: 'forest',
    requirement: { allOf: [{ kind: 'highestAreaTierEver', atLeast: 16 }] },
    efficiencyAxes: ['renew', 'travel'],
  },
];

export type PlaceableId = PlaceableDefinition['id'];
