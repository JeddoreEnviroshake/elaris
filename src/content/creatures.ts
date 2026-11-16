import type { BuildingDefinitionId, CreatureTrophyId, GatherableResourceId, ResourceId, SpeciesId } from '../simulation/state';
import type { NonEmptyEfficiencyAxes } from './efficiency';
import { companionAbilities, type CompanionAbilityDefinition } from './companionAbilities';
import type { CreatureWorkPassiveId } from './creatureWorkPassives';

export type CombatStyle = 'melee' | 'ranged' | 'magic';

export type FollowerModifierDefinition = {
  stat: 'actionSpeed';
  targets: readonly ('stone' | 'metal')[];
  amountBps: number;
  stackingGroup: string;
} | {
  stat: 'gatherYield';
  targets: readonly GatherableResourceId[];
  amountBps: number;
  rangePx: number;
  stackingGroup: string;
};

export interface CreatureDefinition {
  speciesId: SpeciesId;
  displayName: string;
  temperament: 'passive' | 'neutral' | 'skittish' | 'aggressive';
  habitat: 'grassland' | 'hills' | 'forest';
  followRole: string;
  /** The concrete bottleneck improved while assigned to follow. */
  followEfficiencyAxes: NonEmptyEfficiencyAxes;
  /** How the creature accompanies the player and modifies travel. */
  followMode: 'companion' | 'mount';
  /** Multiplicative travel modifier while this creature is assigned to follow. */
  travelSpeedMultiplier: number;
  /** Typed, strongest-per-group overworld bonus sources. */
  followerModifiers: readonly FollowerModifierDefinition[];
  rosterLimit: number;
  /**
   * How this species is tamed in the world (taming-chance-plan.md). Each lever
   * is weighted per species so the roster plays differently without new code:
   * a Craghopper is mostly worn down, a Glade Stag mostly approached unseen.
   */
  tame: {
    /** The item an Offer spends for the large bonus. Any berry gives a small one. */
    favourite: ResourceId;
    /** Chance added at 0 HP, scaled linearly by missing health. */
    hpWeightBps: number;
    /** Most that offering alone can contribute. */
    foodCapBps: number;
    /** Bonus for a throw it never noticed; doubled while it eats. */
    unnoticedBps: number;
  };
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
    moveSpeed: number;
    attackRange: number;
    behavior: 'chase' | 'kite';
    preferredRange?: number;
    /**
     * Overworld combat profile. Deliberately separate from the battle-track
     * numbers above: `moveSpeed` and `attackRange` are positions on a 0..100
     * turn track, which say nothing about world pixels or tick cadence. Whole
     * pixels and whole ticks only — creature positions feed the state hash.
     */
    speedPxPerTick: number;
    attackRangePx: number;
    /** Ticks between contact hits. Cadence, not attack power, sets world DPS. */
    attackIntervalTicks: number;
    /** How close before the creature turns hostile unprovoked; 0 means never. */
    aggroRangePx: number;
    /**
     * How much of the base stats each level past the first adds, in basis
     * points; 2500 is the shipped quarter. Applies to health and the damage
     * numbers only — see leveledCreatureDefinition.
     */
    levelMultiplierBps: number;
    /** How far it will travel from its spawn before losing interest. */
    leashPx: number;
    /** Distance a `kite` creature backs off to; ignored by `chase`. */
    preferredRangePx: number;
    /**
     * How far from its spawn an unbothered creature ambles. This is what makes
     * the roster look alive rather than placed: a grazer keeps to a small patch
     * while a stag ranges. Always well inside `leashPx`, or a creature would
     * wander itself out of its own territory and immediately turn around.
     */
    wanderRadiusPx: number;
    /** Chance in basis points that a wander segment is spent standing still. */
    wanderRestBps: number;
    /** Resources granted when the creature is defeated at 0 HP. */
    loot: Readonly<Partial<Record<ResourceId, number>>>;
    /**
     * The species-exclusive material this creature yields every
     * TROPHY_DEFEATS_PER_DROP defeats, on top of `loot`.
     */
    trophy: CreatureTrophyId;
    battleAbilities: readonly CompanionAbilityDefinition[];
  };
  work: null | {
    eligibleWorksites: readonly BuildingDefinitionId[];
    resource: GatherableResourceId | null;
    intervalTicks: number;
    damage: number;
    /**
     * The non-production job this species does on shift, or null for the
     * gatherers. A species declares either a `resource` producer or a passive,
     * never both — the two run off different clocks and would compete for
     * `nextWorkTick`. See CREATURE_WORK_PASSIVES.
     */
    passive: CreatureWorkPassiveId | null;
    /** The concrete bottleneck improved while assigned to work. */
    efficiencyAxes: NonEmptyEfficiencyAxes;
  };
  efficiencyAxes: NonEmptyEfficiencyAxes;
}

export const MAX_CREATURE_ROSTER = 20;
export const MAX_ACTIVE_FOLLOWERS = 3;

/** Species behavior remains content-driven; systems never branch on names. */
export const CREATURE_DEFINITIONS: readonly CreatureDefinition[] = [{
  speciesId: 'tuftle',
  displayName: 'Tuftle',
  temperament: 'passive',
  tame: { favourite: 'berry', hpWeightBps: 3_500, foodCapBps: 5_000, unnoticedBps: 1_000 },
  habitat: 'grassland',
  followRole: 'Improves nearby plant gathering',
  followEfficiencyAxes: ['yield'],
  followMode: 'companion',
  travelSpeedMultiplier: 1,
  followerModifiers: [{ stat: 'gatherYield', targets: ['fiber'], amountBps: 2_500, rangePx: 48, stackingGroup: 'companion-plant-yield' }],
  rosterLimit: 1,
  encounter: { maxHp: 36, attackPower: 5, defense: 1, tameEaseBps: 7000, weakTo: 'melee', resistTo: 'ranged', dodgeBps: 500, moveSpeed: 5, attackRange: 8, behavior: 'chase', speedPxPerTick: 1, attackRangePx: 24, attackIntervalTicks: 180, aggroRangePx: 0, levelMultiplierBps: 2_500, leashPx: 160, preferredRangePx: 0, wanderRadiusPx: 48, wanderRestBps: 6_000, loot: { fiber: 5, berry: 2 }, trophy: 'tuftle-down', battleAbilities: companionAbilities('tuftle') },
  work: {
    eligibleWorksites: ['small-pen', 'barn'],
    resource: 'fiber',
    intervalTicks: 900,
    damage: 0,
    passive: null,
    efficiencyAxes: ['pickup', 'yield'],
  },
  efficiencyAxes: ['yield', 'pickup'],
}, {
  speciesId: 'craghopper',
  displayName: 'Craghopper',
  temperament: 'neutral',
  tame: { favourite: 'iron-ore', hpWeightBps: 5_500, foodCapBps: 2_500, unnoticedBps: 1_000 },
  habitat: 'hills',
  followRole: 'Speeds up mining actions',
  followEfficiencyAxes: ['break'],
  followMode: 'companion',
  travelSpeedMultiplier: 1,
  followerModifiers: [{ stat: 'actionSpeed', targets: ['stone', 'metal'], amountBps: 5_000, stackingGroup: 'companion-mining-speed' }],
  rosterLimit: 1,
  encounter: { maxHp: 54, attackPower: 8, defense: 4, tameEaseBps: 5200, weakTo: 'magic', resistTo: 'melee', dodgeBps: 300, moveSpeed: 8, attackRange: 10, behavior: 'chase', speedPxPerTick: 1, attackRangePx: 28, attackIntervalTicks: 150, aggroRangePx: 72, levelMultiplierBps: 2_500, leashPx: 192, preferredRangePx: 0, wanderRadiusPx: 64, wanderRestBps: 5_000, loot: { stone: 6, 'iron-ore': 1 }, trophy: 'craghopper-shell', battleAbilities: companionAbilities('craghopper') },
  work: {
    eligibleWorksites: ['stone-yard'], resource: 'stone', intervalTicks: 3_600, damage: 0,
    passive: null, efficiencyAxes: ['yield', 'pickup'],
  },
  efficiencyAxes: ['break'],
}, {
  speciesId: 'glade-stag',
  displayName: 'Glade Stag',
  temperament: 'skittish',
  tame: { favourite: 'fiber', hpWeightBps: 3_000, foodCapBps: 3_500, unnoticedBps: 2_000 },
  habitat: 'forest',
  followRole: 'Mount for faster travel',
  followEfficiencyAxes: ['travel'],
  followMode: 'mount',
  travelSpeedMultiplier: 1.7,
  followerModifiers: [],
  rosterLimit: 1,
  encounter: { maxHp: 46, attackPower: 6, defense: 2, tameEaseBps: 4500, weakTo: 'ranged', resistTo: 'magic', dodgeBps: 2200, moveSpeed: 10, attackRange: 10, behavior: 'chase', speedPxPerTick: 2, attackRangePx: 28, attackIntervalTicks: 150, aggroRangePx: 0, levelMultiplierBps: 2_500, leashPx: 224, preferredRangePx: 0, wanderRadiusPx: 160, wanderRestBps: 3_000, loot: { wood: 5, fiber: 4 }, trophy: 'stag-antler', battleAbilities: companionAbilities('glade-stag') },
  work: {
    eligibleWorksites: ['cart-dock'], resource: null, intervalTicks: 0, damage: 0,
    passive: null, efficiencyAxes: ['carry', 'pickup'],
  },
  efficiencyAxes: ['travel'],
}, {
  speciesId: 'snarlfox',
  displayName: 'Snarlfox',
  temperament: 'aggressive',
  tame: { favourite: 'berry', hpWeightBps: 4_000, foodCapBps: 3_000, unnoticedBps: 1_000 },
  habitat: 'forest',
  followRole: 'Reduces dangerous interruptions',
  followEfficiencyAxes: ['safety'],
  followMode: 'companion',
  travelSpeedMultiplier: 1,
  followerModifiers: [],
  rosterLimit: 1,
  encounter: { maxHp: 42, attackPower: 10, defense: 2, tameEaseBps: 3800, weakTo: 'magic', resistTo: 'ranged', dodgeBps: 1500, moveSpeed: 12, attackRange: 25, behavior: 'kite', preferredRange: 22, speedPxPerTick: 2, attackRangePx: 96, attackIntervalTicks: 120, aggroRangePx: 144, levelMultiplierBps: 2_500, leashPx: 224, preferredRangePx: 80, wanderRadiusPx: 128, wanderRestBps: 2_000, loot: { fiber: 6, 'taming-snare': 1 }, trophy: 'snarlfox-pelt', battleAbilities: companionAbilities('snarlfox') },
  work: {
    eligibleWorksites: ['small-pen', 'barn'], resource: null, intervalTicks: 0, damage: 0,
    passive: null, efficiencyAxes: ['safety'],
  },
  efficiencyAxes: ['safety'],
}, {
  /**
   * The wall-keeper. Assigned to a War Table it walks the perimeter and packs
   * damage back into whatever the last raid opened, which is what turns a wall
   * from a consumable into a structure.
   */
  speciesId: 'masonmole',
  displayName: 'Masonmole',
  temperament: 'neutral',
  tame: { favourite: 'stone', hpWeightBps: 3_000, foodCapBps: 5_000, unnoticedBps: 1_000 },
  habitat: 'hills',
  followRole: 'Keeps structures standing longer',
  followEfficiencyAxes: ['uptime'],
  followMode: 'companion',
  travelSpeedMultiplier: 1,
  followerModifiers: [],
  rosterLimit: 1,
  encounter: { maxHp: 78, attackPower: 9, defense: 7, tameEaseBps: 3200, weakTo: 'magic', resistTo: 'melee', dodgeBps: 200, moveSpeed: 6, attackRange: 9, behavior: 'chase', speedPxPerTick: 1, attackRangePx: 26, attackIntervalTicks: 165, aggroRangePx: 64, levelMultiplierBps: 2_500, leashPx: 200, preferredRangePx: 0, wanderRadiusPx: 56, wanderRestBps: 5_500, loot: { stone: 8, wood: 4 }, trophy: 'masonmole-claw', battleAbilities: companionAbilities('masonmole') },
  work: {
    eligibleWorksites: ['war-table'], resource: null, intervalTicks: 0, damage: 0,
    passive: 'rebuild-walls', efficiencyAxes: ['uptime'],
  },
  efficiencyAxes: ['uptime'],
}, {
  /**
   * The one that meets whatever got through. Short reach, heavy hit: a Bulwark
   * Boar is the answer to a breach, not to a wave still crossing the field.
   */
  speciesId: 'bulwark-boar',
  displayName: 'Bulwark Boar',
  temperament: 'aggressive',
  tame: { favourite: 'berry', hpWeightBps: 5_500, foodCapBps: 2_500, unnoticedBps: 500 },
  habitat: 'grassland',
  followRole: 'Fights back when something closes in',
  followEfficiencyAxes: ['safety'],
  followMode: 'mount',
  travelSpeedMultiplier: 1.3,
  followerModifiers: [],
  rosterLimit: 1,
  encounter: { maxHp: 92, attackPower: 14, defense: 5, tameEaseBps: 2600, weakTo: 'ranged', resistTo: 'melee', dodgeBps: 400, moveSpeed: 9, attackRange: 11, behavior: 'chase', speedPxPerTick: 2, attackRangePx: 30, attackIntervalTicks: 130, aggroRangePx: 160, levelMultiplierBps: 2_500, leashPx: 240, preferredRangePx: 0, wanderRadiusPx: 96, wanderRestBps: 3_500, loot: { fiber: 8, berry: 4 }, trophy: 'boar-tusk', battleAbilities: companionAbilities('bulwark-boar') },
  work: {
    eligibleWorksites: ['war-table'], resource: null, intervalTicks: 0, damage: 0,
    passive: 'defend-base', efficiencyAxes: ['safety', 'uptime'],
  },
  efficiencyAxes: ['safety'],
}, {
  /**
   * A hoarder that was already carrying things back to one place; the Turret is
   * simply the place. Assigned to one it ferries arrows out of nearby storage,
   * so a raid answered while the player is away is decided by the stockpile
   * rather than by what happened to be loaded when they left.
   */
  speciesId: 'quillfinch',
  displayName: 'Quillfinch',
  temperament: 'skittish',
  tame: { favourite: 'fiber', hpWeightBps: 3_000, foodCapBps: 3_500, unnoticedBps: 2_000 },
  habitat: 'forest',
  followRole: 'Keeps defences supplied',
  followEfficiencyAxes: ['carry'],
  followMode: 'companion',
  travelSpeedMultiplier: 1,
  followerModifiers: [],
  rosterLimit: 1,
  encounter: { maxHp: 52, attackPower: 8, defense: 2, tameEaseBps: 4000, weakTo: 'melee', resistTo: 'ranged', dodgeBps: 2800, moveSpeed: 13, attackRange: 22, behavior: 'kite', preferredRange: 20, speedPxPerTick: 2, attackRangePx: 88, attackIntervalTicks: 110, aggroRangePx: 0, levelMultiplierBps: 2_500, leashPx: 240, preferredRangePx: 72, wanderRadiusPx: 144, wanderRestBps: 2_500, loot: { fiber: 5, arrow: 4 }, trophy: 'quillfinch-quill', battleAbilities: companionAbilities('quillfinch') },
  work: {
    eligibleWorksites: ['turret'], resource: null, intervalTicks: 0, damage: 0,
    passive: 'restock-turrets', efficiencyAxes: ['uptime', 'carry'],
  },
  efficiencyAxes: ['carry'],
}, {
  /**
   * Clean air on legs. The square it holds is smaller than any room and has no
   * roof, so it is somewhere to ride out a fog minute far from home rather than
   * a reason to stop building purified rooms.
   */
  speciesId: 'mistmoth',
  displayName: 'Mistmoth',
  temperament: 'passive',
  tame: { favourite: 'fiber', hpWeightBps: 3_000, foodCapBps: 5_000, unnoticedBps: 1_500 },
  habitat: 'forest',
  followRole: 'Filters the air it settles in',
  followEfficiencyAxes: ['safety'],
  followMode: 'companion',
  travelSpeedMultiplier: 1,
  followerModifiers: [],
  rosterLimit: 1,
  encounter: { maxHp: 48, attackPower: 6, defense: 3, tameEaseBps: 2200, weakTo: 'ranged', resistTo: 'magic', dodgeBps: 3200, moveSpeed: 11, attackRange: 14, behavior: 'kite', preferredRange: 18, speedPxPerTick: 2, attackRangePx: 64, attackIntervalTicks: 175, aggroRangePx: 0, levelMultiplierBps: 2_500, leashPx: 208, preferredRangePx: 64, wanderRadiusPx: 120, wanderRestBps: 4_500, loot: { fiber: 6, 'cloth-mask': 1 }, trophy: 'mistmoth-scale', battleAbilities: companionAbilities('mistmoth') },
  work: {
    eligibleWorksites: ['small-pen', 'barn'], resource: null, intervalTicks: 0, damage: 0,
    passive: 'purified-zone', efficiencyAxes: ['safety'],
  },
  efficiencyAxes: ['safety'],
}, {
  /**
   * A free turret with a bad rate of fire. It reaches further than anything
   * else on the roster and costs nothing to run, which is deliberately paid for
   * in how little each stone does.
   */
  speciesId: 'slingtail',
  displayName: 'Slingtail',
  temperament: 'neutral',
  tame: { favourite: 'stone', hpWeightBps: 4_000, foodCapBps: 3_000, unnoticedBps: 1_000 },
  habitat: 'hills',
  followRole: 'Harries hostiles from a distance',
  followEfficiencyAxes: ['safety'],
  followMode: 'companion',
  travelSpeedMultiplier: 1,
  followerModifiers: [{ stat: 'actionSpeed', targets: ['stone'], amountBps: 2_500, stackingGroup: 'companion-mining-speed' }],
  rosterLimit: 1,
  encounter: { maxHp: 64, attackPower: 11, defense: 4, tameEaseBps: 3000, weakTo: 'melee', resistTo: 'ranged', dodgeBps: 1200, moveSpeed: 10, attackRange: 28, behavior: 'kite', preferredRange: 26, speedPxPerTick: 1, attackRangePx: 112, attackIntervalTicks: 140, aggroRangePx: 128, levelMultiplierBps: 2_500, leashPx: 232, preferredRangePx: 96, wanderRadiusPx: 88, wanderRestBps: 4_000, loot: { stone: 10, 'iron-ore': 2 }, trophy: 'slingtail-stone', battleAbilities: companionAbilities('slingtail') },
  work: {
    eligibleWorksites: ['stone-yard'], resource: null, intervalTicks: 0, damage: 0,
    passive: 'throw-rocks', efficiencyAxes: ['safety', 'uptime'],
  },
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
