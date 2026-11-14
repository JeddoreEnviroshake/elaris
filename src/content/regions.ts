import type { GatherableResourceId, ResourceNodeKind, SpeciesId } from '../simulation/state';

export type RegionalLandmarkKind = 'sunwheel-orchard' | 'moonwell-spire';

export interface RegionalIdentityDefinition {
  readonly areaKey: string;
  readonly characteristicCreature: { readonly speciesId: SpeciesId; readonly label: string };
  readonly signatureResource: { readonly resourceId: GatherableResourceId; readonly label: string };
  readonly resourceWeights: Readonly<Record<ResourceNodeKind, number>>;
  readonly landmark: {
    readonly id: string;
    readonly name: string;
    readonly summary: string;
    readonly tileX: number;
    readonly tileY: number;
    readonly kind: RegionalLandmarkKind;
    readonly color: string;
  };
  readonly discoveryReward: { readonly coins: number };
  readonly contract: {
    readonly id: string;
    readonly title: string;
    readonly summary: string;
    readonly resourceId: GatherableResourceId;
    readonly target: number;
    readonly rewardCoins: number;
  };
}

/** One registry drives generation, landmarks, repeatable work, and map copy. */
export const REGIONAL_IDENTITIES: readonly RegionalIdentityDefinition[] = [
  {
    areaKey: '1,0',
    characteristicCreature: { speciesId: 'tuftle', label: 'Tuftle herds' },
    signatureResource: { resourceId: 'fiber', label: 'Sungrass Fiber' },
    resourceWeights: { tree: 20, stone: 12, metal: 0, plant: 125, 'berry-bush': 55 },
    landmark: {
      id: 'sunwheel-orchard',
      name: 'Sunwheel Orchard',
      summary: 'A living harvest calendar planted by the first farmers of the Reach.',
      tileX: 104,
      tileY: 68,
      kind: 'sunwheel-orchard',
      color: '#f4cf62',
    },
    discoveryReward: { coins: 80 },
    contract: {
      id: 'verdant-fiber-run',
      title: 'Fiber Run',
      summary: 'Gather fresh fiber in Verdant Reach before the survival cycle turns.',
      resourceId: 'fiber',
      target: 12,
      rewardCoins: 60,
    },
  },
  {
    areaKey: '2,0',
    characteristicCreature: { speciesId: 'glade-stag', label: 'Glade Stag circles' },
    signatureResource: { resourceId: 'wood', label: 'Moonbark Timber' },
    resourceWeights: { tree: 130, stone: 14, metal: 0, plant: 58, 'berry-bush': 32 },
    landmark: {
      id: 'moonwell-spire',
      name: 'Moonwell Spire',
      summary: 'An elven waystone that gathers moonlight above a spring-fed well.',
      tileX: 102,
      tileY: 102,
      kind: 'moonwell-spire',
      color: '#c9a6ff',
    },
    discoveryReward: { coins: 100 },
    contract: {
      id: 'sylvaren-moonbark-survey',
      title: 'Moonbark Survey',
      summary: 'Gather timber in Sylvaren for the city wardens before the cycle turns.',
      resourceId: 'wood',
      target: 10,
      rewardCoins: 80,
    },
  },
] as const;

export function regionalIdentityForArea(areaKey: string): RegionalIdentityDefinition | null {
  return REGIONAL_IDENTITIES.find((definition) => definition.areaKey === areaKey) ?? null;
}

export function regionalIdentityForLandmark(landmarkId: string): RegionalIdentityDefinition | null {
  return REGIONAL_IDENTITIES.find((definition) => definition.landmark.id === landmarkId) ?? null;
}

export function isRegionalLandmarkTileClear(
  areaKey: string,
  tileX: number,
  tileY: number,
  radiusTiles = 4,
): boolean {
  const definition = regionalIdentityForArea(areaKey);
  if (!definition) return false;
  return Math.hypot(
    tileX + 0.5 - (definition.landmark.tileX + 0.5),
    tileY + 0.5 - (definition.landmark.tileY + 0.5),
  ) <= radiusTiles;
}
