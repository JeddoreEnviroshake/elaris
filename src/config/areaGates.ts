/**
 * Area gates are data, not seven hand-written code paths. A qualified area
 * must meet both the total cell count and its filled-square requirement.
 */
export const AREA_TIERS = [
  { area: 4, filledCore: 2, label: 'Nook' },
  { area: 8, filledCore: 2, label: 'Shelter' },
  { area: 16, filledCore: 4, label: 'Workshop' },
  { area: 32, filledCore: 4, label: 'Yard' },
  { area: 64, filledCore: 8, label: 'Homestead' },
  { area: 128, filledCore: 8, label: 'Compound' },
  { area: 256, filledCore: 16, label: 'Estate' },
] as const;

export type AreaTier = (typeof AREA_TIERS)[number]['area'];
export type EnvironmentKind = 'indoor' | 'paddock' | 'workYard';

/** First facilities unlocked by the Milestone 1 environment arc. */
export const PLACEABLES = [
  { id: 'field-cache', displayName: 'Field Cache', minEnvironmentArea: 4 },
  { id: 'workbench', displayName: 'Workbench', minEnvironmentArea: 8, environmentKind: 'indoor' },
  { id: 'garden-bed', displayName: 'Garden Bed', minEnvironmentArea: 8, environmentKind: 'workYard', requiredTerrain: 'grassland', discoverAtAreaTier: 8 },
  { id: 'woodlot-planter', displayName: 'Woodlot Planter', minEnvironmentArea: 16, environmentKind: 'workYard', requiredTerrain: 'forest', discoverAtAreaTier: 16 },
] as const;

export type PlaceableId = (typeof PLACEABLES)[number]['id'];
export type PlaceableDefinition = (typeof PLACEABLES)[number];
