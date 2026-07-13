import type { BuildingDefinitionId, ResourceId, SpeciesId } from '../simulation/state';

export type CombatStyle = 'melee' | 'ranged' | 'magic';

export interface CreatureDefinition {
  speciesId: SpeciesId;
  displayName: string;
  temperament: 'passive' | 'neutral' | 'skittish' | 'aggressive';
  habitat: 'grassland' | 'hills' | 'forest';
  followRole: string;
  /** How the creature accompanies the player and modifies travel. */
  followMode: 'companion' | 'mount';
  /** Multiplicative travel modifier while this creature is assigned to follow. */
  travelSpeedMultiplier: number;
  tameCost: Readonly<Partial<Record<ResourceId, number>>>;
  rosterLimit: number;
  encounter: {
    maxHp: number;
    attackPower: number;
    defense: number;
    tameEaseBps: number;
    /** Attack style this species takes 150% damage from. */
    weakTo: CombatStyle;
    /** Attack style this species takes 50% damage from. */
    resistTo: CombatStyle;
    /** Chance in basis points to dodge an otherwise-landing strike. */
    dodgeBps: number;
    /** Resources granted when the creature is defeated at 0 HP. */
    loot: Readonly<Partial<Record<ResourceId, number>>>;
  };
  work: null | {
    eligibleWorksites: readonly BuildingDefinitionId[];
    resource: ResourceId;
    intervalTicks: number;
    damage: number;
  };
  efficiencyAxes: readonly ('yield' | 'automation' | 'speed' | 'travel' | 'safety')[];
}

export const MAX_CREATURE_ROSTER = 20;
export const MAX_ACTIVE_FOLLOWERS = 3;

/** Species behavior remains content-driven; systems never branch on names. */
export const CREATURE_DEFINITIONS: readonly CreatureDefinition[] = [{
  speciesId: 'tuftle',
  displayName: 'Tuftle',
  temperament: 'passive',
  habitat: 'grassland',
  followRole: 'Improves nearby plant gathering',
  followMode: 'companion',
  travelSpeedMultiplier: 1,
  tameCost: { fiber: 3 },
  rosterLimit: 1,
  encounter: { maxHp: 36, attackPower: 5, defense: 1, tameEaseBps: 7000, weakTo: 'melee', resistTo: 'ranged', dodgeBps: 500, loot: { fiber: 2 } },
  work: {
    eligibleWorksites: ['woodlot-planter', 'field-cache'],
    resource: 'fiber',
    intervalTicks: 180,
    damage: 10,
  },
  efficiencyAxes: ['yield', 'automation'],
}, {
  speciesId: 'craghopper',
  displayName: 'Craghopper',
  temperament: 'neutral',
  habitat: 'hills',
  followRole: 'Speeds up mining actions',
  followMode: 'companion',
  travelSpeedMultiplier: 1,
  tameCost: { stone: 4, fiber: 2 },
  rosterLimit: 1,
  encounter: { maxHp: 54, attackPower: 8, defense: 4, tameEaseBps: 5200, weakTo: 'magic', resistTo: 'melee', dodgeBps: 300, loot: { stone: 3 } },
  work: null,
  efficiencyAxes: ['speed'],
}, {
  speciesId: 'glade-stag',
  displayName: 'Glade Stag',
  temperament: 'skittish',
  habitat: 'forest',
  followRole: 'Mount for faster travel',
  followMode: 'mount',
  travelSpeedMultiplier: 1.7,
  tameCost: { fiber: 6 },
  rosterLimit: 1,
  encounter: { maxHp: 46, attackPower: 6, defense: 2, tameEaseBps: 4500, weakTo: 'ranged', resistTo: 'magic', dodgeBps: 2200, loot: { wood: 2, fiber: 2 } },
  work: null,
  efficiencyAxes: ['travel'],
}, {
  speciesId: 'snarlfox',
  displayName: 'Snarlfox',
  temperament: 'aggressive',
  habitat: 'forest',
  followRole: 'Reduces dangerous interruptions',
  followMode: 'companion',
  travelSpeedMultiplier: 1,
  tameCost: { wood: 3, fiber: 5 },
  rosterLimit: 1,
  encounter: { maxHp: 42, attackPower: 10, defense: 2, tameEaseBps: 3800, weakTo: 'magic', resistTo: 'ranged', dodgeBps: 1500, loot: { fiber: 3 } },
  work: null,
  efficiencyAxes: ['safety'],
}];

export const CREATURE_SPECIES_IDS: ReadonlySet<string> = new Set(
  CREATURE_DEFINITIONS.map((definition) => definition.speciesId),
);

export function isSpeciesId(value: unknown): value is SpeciesId {
  return typeof value === 'string' && CREATURE_SPECIES_IDS.has(value);
}

export function creatureDefinition(speciesId: SpeciesId): CreatureDefinition {
  const definition = CREATURE_DEFINITIONS.find((candidate) => candidate.speciesId === speciesId);
  if (!definition) throw new Error(`unknown creature species ${speciesId}`);
  return definition;
}
