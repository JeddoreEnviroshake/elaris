import { createDefaultGameBalance, GARDEN_BED_GROWTH_STEP_TICKS, WOODLOT_GROWTH_STEP_TICKS, type StrikeTarget } from '../config/balance';
import type { AreaTier } from '../config/areaGates';
import { WORLD_PX } from '../config/platform';
import type { NpcId } from '../content/npcs';
import { blueprintsGrantedAtLevel } from '../content/blueprintGates';
import { createOpeningChapter, type OpeningChapterState } from '../content/onboarding';
import { generateResourceNodes } from './worldGeneration';
import { generateAreaContainers, generateWildCreatures, generateOpeningTuftle } from './worldGeneration';

export type Facing = 'up' | 'down' | 'left' | 'right';
export type TraversalMode = 'foot' | 'boat';
export type BoundaryEdge = 'north' | 'east' | 'south' | 'west';
export type EnvironmentKind = 'indoor' | 'paddock' | 'workYard';
/**
 * One attribute per promise. Health, Stamina, Mana, their regenerations, and
 * Carry Weight used to be bundled three-to-an-attribute (Vitality, Endurance,
 * Intelligence), which meant a point bought things the player had not asked
 * for and no single row could ever be tuned on its own.
 */
export type AttributeId =
  | 'strength' | 'dexterity' | 'magic' | 'luck' | 'speed'
  | 'health' | 'healthRegen'
  | 'stamina' | 'staminaRegen'
  | 'carryWeight'
  | 'mana' | 'manaRegen';
export type PlayerAttributes = Record<AttributeId, number>;

/** Only NPC facts that cannot be reconstructed from the rest of GameState. */
export interface NpcMemoryState {
  visits: Partial<Record<NpcId, number>>;
  seenMomentIds: string[];
}

export function createNpcMemoryState(): NpcMemoryState {
  return { visits: {}, seenMomentIds: [] };
}

export interface PlayerState {
  /** World position in source pixels. */
  x: number;
  y: number;
  facing: Facing;
  /** Foot travel is the default; boat travel is entered explicitly at a shoreline. */
  traversalMode?: TraversalMode;
  hp: number;
  maxHp: number;
  stamina: number;
  maxStamina: number;
  mana: number;
  maxMana: number;
  level: number;
  xp: number;
  attributePoints: number;
  attributes: PlayerAttributes;
}

export type PlayerDefeatCause = 'exposure' | 'raider' | 'creature' | 'arcane-storm';

/** Durable defeat state; reloading cannot skip the respawn decision or loss. */
export interface PendingRespawnState {
  cause: PlayerDefeatCause;
  lostItemCount: number;
  defeatedAreaKey: string;
  defeatedAreaName: string;
  defeatedAreaX: number;
  defeatedAreaY: number;
  defeatedX: number;
  defeatedY: number;
  defeatedAtTick: number;
}

/**
 * Everything the bag was carrying, waiting where the player fell.
 *
 * Defeat used to destroy resources and tools outright. It now leaves them in
 * one cache on the ground with a deadline: the loss is the run back, not the
 * items, and the beacon on the map is what makes that run a decision — go now
 * and risk whatever killed you, or write the bag off.
 *
 * There is exactly one, and a second death replaces it. Two caches would let a
 * player bank losses indefinitely, and the map beacon would stop meaning "the
 * place you have to get to before the timer runs out".
 */
export interface DeathCacheState {
  id: string;
  /** Where it lies — the beacon reads all four so it can point across regions. */
  areaKey: string;
  areaName: string;
  areaX: number;
  areaY: number;
  x: number;
  y: number;
  /** Sparse: only resources actually lost appear, each a positive whole amount. */
  resources: Partial<Record<ResourceId, number>>;
  tools: ToolInstance[];
  createdAtTick: number;
  /** Absolute tick when the cache is gone for good. Never null: nothing waits forever. */
  expiresAtTick: number;
}

export type BasicResourceId = 'wood' | 'stone' | 'fiber';
/** Resources a node can yield: the only ids gathered, smelted, or stored in boxes. */
export type GatherableResourceId = BasicResourceId | 'iron-ore' | 'iron-ingot';
/** Handcrafted supplies. They live in the Bag exactly like gathered resources. */
export type CraftedSupplyId =
  | 'taming-snare' | 'reinforced-snare' | 'berry' | 'arrow' | 'cloth-mask'
  /** Bought from Elowen only; spent automatically to survive a defeat intact. */
  | 'safeguard-charm'
  /**
   * Salvage from scrapping a blueprint at a workbench. The one material that
   * cannot be gathered, grown, or smelted — it only ever comes from a duplicate
   * a player chose to destroy.
   */
  | 'draft-parchment';
/**
 * Materials that only a defeated creature yields. Nothing gathers, grows, or
 * smelts these, which is the whole point: they are the one supply line that
 * requires fighting, and the Reinforced Snare recipe wants one of each.
 */
export type CreatureTrophyId =
  | 'tuftle-down' | 'craghopper-shell' | 'stag-antler' | 'snarlfox-pelt'
  /** The homestead-defence roster's trophies; see CREATURE_DEFINITIONS. */
  | 'masonmole-claw' | 'boar-tusk' | 'quillfinch-quill' | 'mistmoth-scale' | 'slingtail-stone';
/**
 * Salvage: the material family found only in the field, at guarded sites that
 * refill (see content/sites). Nothing at a base produces any of these — no
 * facility, worker or expedition — which is the whole reason to leave.
 * Sealed Satchel, Vault Key and Recall Flare are unused until later phases.
 */
export type SalvageId =
  | 'scrap-iron' | 'clockwork' | 'lens' | 'arcane-dust' | 'construct-core' | 'ancient-alloy'
  | 'sealed-satchel' | 'vault-key' | 'recall-flare';
export type ResourceId = GatherableResourceId | CraftedSupplyId | CreatureTrophyId | SalvageId;
export type BagItemId = ResourceId;
export type MaterialId = GatherableResourceId | 'iron';
export type ResourceNodeKind = 'tree' | 'stone' | 'metal' | 'plant' | 'berry-bush';

export interface InventoryState {
  wood: number;
  stone: number;
  fiber: number;
  'iron-ore': number;
  'iron-ingot': number;
  'taming-snare': number;
  /** Trophy-built snare; the encounter spends one of these before a basic snare. */
  'reinforced-snare': number;
  berry: number;
  arrow: number;
  /** Stackable filters spent one at a time by poison-fog exposure. */
  'cloth-mask': number;
  'safeguard-charm': number;
  'draft-parchment': number;
  'tuftle-down': number;
  'craghopper-shell': number;
  'stag-antler': number;
  'snarlfox-pelt': number;
  'masonmole-claw': number;
  'boar-tusk': number;
  'quillfinch-quill': number;
  'mistmoth-scale': number;
  'slingtail-stone': number;
  'scrap-iron': number;
  'clockwork': number;
  'lens': number;
  'arcane-dust': number;
  'construct-core': number;
  'ancient-alloy': number;
  'sealed-satchel': number;
  'vault-key': number;
  'recall-flare': number;
}

/** Persisted resource-stack boundaries. Totals remain authoritative in inventory. */
export type InventoryStackState = Record<ResourceId, number[]>;

export type BasicInventoryState = Pick<InventoryState, BasicResourceId>;

/** Save-backed container contents. Optional supply fields read legacy saves safely. */
export interface StorageInventoryState extends BasicInventoryState {
  'iron-ore'?: number;
  'iron-ingot'?: number;
  'taming-snare'?: number;
  'reinforced-snare'?: number;
  berry?: number;
  arrow?: number;
  'cloth-mask'?: number;
  'safeguard-charm'?: number;
  'draft-parchment'?: number;
  'tuftle-down'?: number;
  'craghopper-shell'?: number;
  'stag-antler'?: number;
  'snarlfox-pelt'?: number;
  'masonmole-claw'?: number;
  'boar-tusk'?: number;
  'quillfinch-quill'?: number;
  'mistmoth-scale'?: number;
  'slingtail-stone'?: number;
  'scrap-iron'?: number;
  'clockwork'?: number;
  'lens'?: number;
  'arcane-dust'?: number;
  'construct-core'?: number;
  'ancient-alloy'?: number;
  'sealed-satchel'?: number;
  'vault-key'?: number;
  'recall-flare'?: number;
}

/** Lifetime gathered resources; progression remains complete after spending. */
export interface ResourceCollectionState {
  wood: number;
  stone: number;
  fiber: number;
  'iron-ore': number;
  'iron-ingot': number;
}

/**
 * Lifetime event totals used by the expanded quest log. Values that can be
 * derived safely (current buildings, unlock ownership, rating, tools, bond)
 * deliberately stay out of this ledger.
 */
export interface QuestProgressState {
  crafted: Record<string, number>;
  buildingsPlaced: Record<string, number>;
  buildingsRemoved: Record<string, number>;
  renovationWoodPlaced: number;
  creatureEncounters: Record<SpeciesId, number>;
  creatureDefeats: Record<SpeciesId, number>;
  companionWins: Record<SpeciesId, number>;
  abilityUses: Record<string, number>;
  gatheredWithFollower: Record<SpeciesId, ResourceCollectionState>;
  areaKeysVisited: string[];
  areaThemesVisited: AreaThemeId[];
  areaKeysVisitedWithFollower: Record<SpeciesId, string[]>;
  resourcesSold: ResourceCollectionState;
  gardenFiberHarvested: number;
  woodlotWoodHarvested: number;
  storageDeposits: number;
  furnaceQueuePeak: number;
  upgradesPurchased: Record<string, number>;
  farmOrders: Record<SpeciesId, number>;
  rolesAssigned: Record<CreatureRole, number>;
  criticalIronRepairCandidates: string[];
  ironToolsRestoredFromCritical: number;
}

export interface RegionalContractProgressState {
  cycleIndex: number;
  progress: number;
  completed: boolean;
}

/** Durable exploration rewards and the current-cycle state of regional work. */
export interface RegionalProgressState {
  discoveredLandmarkIds: string[];
  contracts: Record<string, RegionalContractProgressState>;
  /** Lifetime completed cycles per regional contract, used for mastery. */
  contractCompletionCounts: Record<string, number>;
}

export function createRegionalProgressState(): RegionalProgressState {
  return { discoveredLandmarkIds: [], contracts: {}, contractCompletionCounts: {} };
}

const emptyResourceTotals = (): ResourceCollectionState => ({
  wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0,
});

const emptySpeciesTotals = (): Record<SpeciesId, number> => ({
  tuftle: 0, craghopper: 0, 'glade-stag': 0, snarlfox: 0,
  masonmole: 0, 'bulwark-boar': 0, quillfinch: 0, mistmoth: 0, slingtail: 0,
});

export function createQuestProgressState(): QuestProgressState {
  return {
    crafted: {},
    buildingsPlaced: {},
    buildingsRemoved: {},
    renovationWoodPlaced: 0,
    creatureEncounters: emptySpeciesTotals(),
    creatureDefeats: emptySpeciesTotals(),
    companionWins: emptySpeciesTotals(),
    abilityUses: {},
    gatheredWithFollower: {
      tuftle: emptyResourceTotals(), craghopper: emptyResourceTotals(),
      'glade-stag': emptyResourceTotals(), snarlfox: emptyResourceTotals(),
      masonmole: emptyResourceTotals(), 'bulwark-boar': emptyResourceTotals(),
      quillfinch: emptyResourceTotals(), mistmoth: emptyResourceTotals(),
      slingtail: emptyResourceTotals(),
    },
    areaKeysVisited: ['0,0'],
    areaThemesVisited: ['elaris'],
    areaKeysVisitedWithFollower: {
      tuftle: [], craghopper: [], 'glade-stag': [], snarlfox: [],
      masonmole: [], 'bulwark-boar': [], quillfinch: [], mistmoth: [], slingtail: [],
    },
    resourcesSold: emptyResourceTotals(),
    gardenFiberHarvested: 0,
    woodlotWoodHarvested: 0,
    storageDeposits: 0,
    furnaceQueuePeak: 0,
    upgradesPurchased: {},
    farmOrders: emptySpeciesTotals(),
    rolesAssigned: { rest: 0, follow: 0, work: 0 },
    criticalIronRepairCandidates: [],
    ironToolsRestoredFromCritical: 0,
  };
}

/** A resource yield that could not fit in the player's inventory. */
export interface GroundDropState {
  /** Stable, persisted entity ID allocated from nextEntityId. */
  id: string;
  resource: ResourceId;
  amount: number;
  x: number;
  y: number;
  /** Absolute simulation tick when this drop disappears; null means persistent. */
  expiresAtTick: number | null;
}

/**
 * One scheduled arcane strike: a place, a deadline, and whether it pays.
 *
 * Strikes are saved rather than derived because the target is the player's own
 * position at the moment the marker appeared — a reload has no way to
 * recompute where they were standing three seconds ago. Coordinates are tile
 * centres so they stay whole pixels, which canonicalizeGameState requires.
 */
export interface ArcaneStrikeState {
  /** Stable, persisted entity ID allocated from nextEntityId. */
  id: string;
  /** Survival cycle this strike belongs to; strikes never outlive their storm. */
  cycleIndex: number;
  /** Position in the storm's fixed schedule, counting from zero. */
  strikeIndex: number;
  /** Area the marker was placed in. Leaving that area dodges the strike. */
  areaKey: string;
  x: number;
  y: number;
  telegraphAtTick: number;
  impactAtTick: number;
  /** Iron ore this strike drops where it lands; zero for ordinary strikes. */
  rewardIronOre: number;
  /**
   * When the impact was applied, or null while pending. Recorded before any
   * side effect, so no reload can bill the damage or pay the ore twice, and
   * both renderers can play a short aftermath before the record is pruned.
   */
  resolvedAtTick: number | null;
}

export interface ArcaneStormState {
  /** Cycle the schedule below belongs to; null when no storm is running. */
  cycleIndex: number | null;
  /**
   * Next slot in the fixed schedule. Slots are consumed even when suppressed
   * (sanctuary, pending respawn, an encounter), so a storm always spends
   * exactly its seven, and a reload cannot re-create one already spent.
   */
  nextStrikeIndex: number;
  strikes: ArcaneStrikeState[];
}

export function createArcaneStormState(): ArcaneStormState {
  return { cycleIndex: null, nextStrikeIndex: 0, strikes: [] };
}

/**
 * Findable world containers. Unlike resource nodes these never renew: a cache
 * is a discovery, and a discovery that respawns is a farm. Contents are not
 * persisted — they are derived at open time from the container's stable id, so
 * a save carries one boolean per container rather than a loot table.
 */
export type WorldContainerKind = 'hollow-log' | 'supply-cache' | 'collapsed-cellar' | 'storm-cache';

export interface WorldContainerState {
  /** Stable, seed-derived identifier; also the seed for its contents. */
  id: string;
  kind: WorldContainerKind;
  x: number;
  y: number;
  /** One-shot: an opened container stays in the world as an empty prop. */
  opened: boolean;
}

export interface ResourceNodeState {
  /** Stable, seed-derived identifier. */
  id: string;
  kind: ResourceNodeKind;
  x: number;
  y: number;
  /** Integer hit points. Zero means depleted and persists across reloads. */
  hp: number;
  maxHp: number;
  /** Absolute fixed-step tick when a depleted node renews; null while live. */
  respawnAtTick: number | null;
}

export type AreaThemeId = 'elaris' | 'forest' | 'mountain' | 'meadow' | 'thicket' | 'marsh';

export interface AreaDescriptor {
  key: string;
  x: number;
  y: number;
  name: string;
  theme: AreaThemeId;
  seed: number;
  /** Sparse migration/player-made land clearings over deterministic terrain. */
  landClearingTiles?: string[];
}

/** Mutable, local entities preserved while the player visits another region. */
export interface AreaSnapshot extends AreaDescriptor {
  resourceNodes: ResourceNodeState[];
  wildCreatures: WildCreatureState[];
  groundDrops: GroundDropState[];
  containers: WorldContainerState[];
  buildings: BuildingState[];
  /** Live raiders. Absent areas resolve their raid abstractly, so this stays empty for them. */
  raiders: RaiderState[];
}

/**
 * Phase 1's original species, then the homestead-defence roster.
 *
 * The first four are gatherers: their Work role produces or protects. The five
 * that follow exist because a base could be prepared but never *kept* — every
 * one of them spends its Work shift on the walls, the turrets, the air, or
 * whatever is walking at the base. See CREATURE_WORK_PASSIVES.
 *
 * Wild entities are seed-derived until tamed.
 */
export type SpeciesId =
  | 'tuftle' | 'craghopper' | 'glade-stag' | 'snarlfox'
  | 'masonmole' | 'bulwark-boar' | 'quillfinch' | 'mistmoth' | 'slingtail';
export type CreatureRole = 'rest' | 'follow' | 'work';
export type CompanionAbilityId =
  | 'tuftle-guard' | 'tuftle-heal' | 'tuftle-recover' | 'tuftle-push'
  | 'craghopper-guard' | 'craghopper-fracture' | 'craghopper-tremor' | 'craghopper-slam'
  | 'glade-stag-forward' | 'glade-stag-withdraw' | 'glade-stag-veil' | 'glade-stag-charge'
  | 'snarlfox-flank' | 'snarlfox-harass' | 'snarlfox-pursue' | 'snarlfox-feint'
  | 'masonmole-brace' | 'masonmole-shore-up' | 'masonmole-burrow' | 'masonmole-collapse'
  | 'bulwark-boar-bulwark' | 'bulwark-boar-gore' | 'bulwark-boar-stand' | 'bulwark-boar-charge'
  | 'quillfinch-volley' | 'quillfinch-pin' | 'quillfinch-dart' | 'quillfinch-barb'
  | 'mistmoth-veil' | 'mistmoth-filter' | 'mistmoth-dust' | 'mistmoth-lull'
  | 'slingtail-lob' | 'slingtail-sling' | 'slingtail-stagger' | 'slingtail-barrage';
export type EnemyIntent = 'advance' | 'strike' | 'advance-strike' | 'retreat-strike' | 'watch';

/**
 * A wild creature as a live world entity. Health used to exist only inside an
 * encounter, which meant a creature the player had worn down was restored to
 * full the moment the battle screen closed. It lives here now, so damage,
 * capture chance, and hostility all persist in the world the player is standing
 * in. Every field is an integer: creature positions feed the canonical hash.
 */
export interface WildCreatureState {
  id: string;
  speciesId: SpeciesId;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /**
   * Difficulty rank, from 1. Stamped at spawn from how far the spawn point sits
   * from town, and never recomputed afterwards: the level a player read off the
   * plate before the fight has to be the level they fight, even if an Admin
   * edit moves the bands underneath it. See simulation/enemyLevels.
   */
  level: number;
  /** Spawn point the creature leashes back to and regenerates at. */
  homeX: number;
  homeY: number;
  /** Tick until which the creature stays hostile; 0 while it is placid. */
  aggroUntilTick: number;
  nextAttackTick: number;
  /** Skittish species only: tick until which it runs from the player. */
  fleeUntilTick: number;
  /** Capture chance accumulated by feeding, in basis points. */
  captureBonusBps: number;
  encounterCooldownUntilTick: number;
}

/**
 * Danger-minute raiders. Unlike wild creatures these are hostile, real-time,
 * and never enter the turn-based encounter system: they walk at the nearest
 * purified base and break whatever stands between them and its facilities.
 * Every field is an integer so the canonical state hash stays valid mid-raid.
 */
export type RaiderKindId = 'scavenger' | 'breaker' | 'stalker' | 'drifter' | 'poacher';

export interface RaiderState {
  id: string;
  kindId: RaiderKindId;
  /** Integer world pixels. Raiders move whole pixels per tick, never fractions. */
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Difficulty rank, from 1. Stamped at spawn; see WildCreatureState.level. */
  level: number;
  /** The structure currently being attacked; null while still walking. */
  targetBuildingId: string | null;
  nextAttackTick: number;
  /**
   * Set on hostiles that live in the world rather than arriving with a raid.
   * Roamers ignore buildings entirely, leash back to where they spawned, and
   * survive the cycle-boundary sweep that clears a finished raid wave.
   */
  roaming?: boolean;
  /** Spawn point a roamer returns to once it loses interest; absent on raiders. */
  homeX?: number;
  homeY?: number;
  /**
   * Present on site guards: the derived site this roamer stands watch over.
   * Guards post at the site, leash at `outlands.guardLeashTiles`, sit outside
   * the roamer quota, and a kill counts toward that site's `guardsDefeated`.
   */
  siteId?: string;
}

/** Present only on Turrets. Ammunition is arrows loaded by the player. */
export interface TurretState {
  ammo: number;
  nextFireTick: number;
}

export interface EncounterState {
  wildCreatureId: string;
  creatureHp: number;
  creatureMaxHp: number;
  round: number;
  message: string;
  /** Positions on the deterministic 0..100 battle track. */
  playerPos: number;
  creaturePos: number;
  /** The eligible follower snapshotted when this encounter began. */
  companionCreatureId: string | null;
  selectedCompanionAbilityId: CompanionAbilityId | null;
  /** Absolute encounter rounds on which each used ability becomes ready. */
  companionAbilityReadyRounds: Partial<Record<CompanionAbilityId, number>>;
  /** Persisted so reloading never changes the telegraphed enemy response. */
  enemyIntent: EnemyIntent;
}

/** Owned creatures deliberately have allocated IDs, separate from their spawn. */
export interface OwnedCreatureState {
  id: string;
  speciesId: SpeciesId;
  name: string;
  role: CreatureRole;
  /** Null means resting; an assigned Tuftle harvests that resource into a Storage Box (small). */
  assignment: GatherableResourceId | null;
  /** Stable building ID while working; null for rest/follow and legacy saves. */
  worksiteId: string | null;
  /** Absolute fixed-step tick when this creature may next perform work. */
  nextWorkTick: number;
  /** Stable Pen/Barn ID reserved by this creature; null when it is unhoused. */
  housingId?: string | null;
  /** Eligible producer time carried between online/offline settlement windows. */
  workRemainderMs?: number;
  /** Deterministic relationship progress; ability unlocks are derived from it. */
  bondXp: number;
  selectedBattleAbilityId: CompanionAbilityId;
  /**
   * The level the creature was tamed at. Carried over rather than reset so
   * hunting down a high-level specimen is worth the trip — a tamed level 4
   * Snarlfox keeps the health and hitting power it had in the wild.
   *
   * Optional for the same reason `housingId` is: every roster creature that
   * predates levelling reads as level 1, and nothing has to rewrite a save to
   * say so.
   */
  level?: number;
}

export type ExpeditionRouteId = 'short-forage' | 'long-haul' | 'deep-survey';

/**
 * One creature sent out to work while the player is elsewhere — including
 * closed. Contents are not stored: the payout is derived from `rollIndex` and
 * the route, so a save cannot be edited to reroll a trip that is already under
 * way, and the same dispatch always brings back the same goods.
 */
export interface ExpeditionState {
  id: string;
  creatureId: string;
  routeId: ExpeditionRouteId;
  /** Whole milliseconds of travel left; zero means home with goods waiting. */
  remainingMs: number;
  /** Fixed at dispatch, so each trip pays differently but reproducibly. */
  rollIndex: number;
}

export type ToolDefinitionId =
  | 'wooden-axe' | 'wooden-pick' | 'wooden-sickle'
  | 'stone-axe' | 'stone-pick' | 'stone-sickle'
  | 'iron-axe' | 'iron-pick' | 'iron-sickle'
  | 'wooden-sword' | 'stone-sword' | 'iron-sword'
  | 'bow' | 'magic-staff'
  | VariantToolDefinitionId;

/**
 * The field-only variant tools.
 *
 * Three grades above Iron, one per blueprint quality, for every tool kind. They
 * are never gated by level and never sold: the only way to make one is to find,
 * draft, or trade its blueprint and carry it home, which is what the whole
 * blueprint system exists to be for.
 */
export type VariantToolQuality = 'reinforced' | 'masterwork' | 'ancient';
export type VariantToolKind = 'axe' | 'pick' | 'sickle' | 'sword' | 'bow';
export type VariantToolDefinitionId = `${VariantToolQuality}-${VariantToolKind}`;

export interface EditableToolBalance {
  /** Full records keep the persisted shape stable and easy to validate. */
  craftCost: Record<GatherableResourceId, number>;
  maxDurability: number;
  actionTicks: number;
  wearPerHit: number;
  /** Reach in world pixels; for the Bow this is how far it can shoot. */
  rangePx: number;
  damageByTarget: Record<StrikeTarget, number>;
  wearMultiplierByTarget: Record<StrikeTarget, number>;
}

export interface EditableResourceBalance {
  maxHp: number;
  yieldMin: number;
  yieldMax: number;
  /** Fixed yield used by creature workers. */
  yieldAmount: number;
  resource: GatherableResourceId;
  respawnTicks: number;
  hardness: number;
  minimumToolTier: number;
  berryYield: number;
}

/**
 * One raider kind's fighting profile. `speedPxPerTick` is deliberately whole
 * pixels: raider positions live in GameState and canonicalizeGameState rejects
 * non-integer numbers, so a fractional speed would break the state hash the
 * moment a raid started. Wall damage is a whole percent for the same reason.
 */
export interface EditableRaiderBalance {
  maxHp: number;
  speedPxPerTick: number;
  /** Damage per landed hit against a wall or facility. */
  damage: number;
  /** Damage per landed hit against the player, tuned independently of `damage`. */
  playerDamage: number;
  attackCooldownTicks: number;
  /** Whole percent applied to damage against walls and fences; 100 is unchanged. */
  wallDamagePercent: number;
  /** First raid night this kind can appear in, counting raids rather than cycles. */
  unlockCycle: number;
  /**
   * How close this kind notices an unsheltered player and gives chase, in world
   * pixels; 0 means never. Per kind rather than one number for every roamer so
   * a Drifter can be something you walk past and a Poacher something that
   * hunts you, and it matches the field wild creatures already carry.
   */
  aggroRangePx: number;
  /**
   * Level multiplier in basis points: 2500 is the 0.25x per level the Admin
   * panel shows. Basis points because every balance value has to stay a whole
   * number — canonicalizeGameState rejects fractions anywhere in state.
   */
  levelMultiplierBps: number;
}

/**
 * What a wave walks toward first. `purifier-last` exists because aiming the
 * whole wave at the Air Purifier ends shelter — and therefore the player's
 * life — before the base has lost anything else.
 *
 * `player-first` is the odd one out: it ranks the player above every building,
 * so a wave ignores the base and comes for them from anywhere on the map,
 * falling back to the building order only once the player is sealed in or down.
 */
export type RaidTargetPriority = 'purifier-first' | 'purifier-last' | 'nearest' | 'player-first';

/**
 * What a danger phase brings. The rotation and the player-facing names live in
 * content/dangerThreats.ts; the type is here because balance is keyed by it.
 */
export type DangerThreat = 'fog' | 'raid' | 'storm';

/** Raid cadence, wave composition, and the danger-minute exposure rule. */
export interface EditableRaidBalance {
  safePhaseSeconds: number;
  /**
   * How long the danger phase runs, per danger element. Separate values because
   * the two nights ask for different things: fog is survived by sitting still in
   * a purified room, so a long one is only a long wait, while a raid is played
   * out and wants room to breathe. The cycle length therefore varies with which
   * threat a cycle brings — see survivalCycle.
   */
  dangerPhaseSecondsByThreat: Record<DangerThreat, number>;
  /** Warning window: seconds into the danger phase before raiders appear. */
  spawnDelaySeconds: number;
  /** Seconds outside shelter before exposure starts draining health. */
  graceSeconds: number;
  /** Drain during the first second of exposure. */
  exposureDamagePerSecond: number;
  /** Added to the drain for every further exposed second; 0 keeps it flat. */
  exposureRampPerSecond: number;
  /** Ceiling the ramp climbs to, so exposure stays survivable-but-urgent. */
  exposureMaxDamagePerSecond: number;
  waveBaseSize: number;
  waveMaxSize: number;
  /** Extra raiders per completed raid, in fixed-point tenths. */
  waveGrowthTenths: number;
  /** Extra raiders per point of Homestead Rating, in fixed-point tenths. */
  waveRatingTenths: number;
  targetPriority: RaidTargetPriority;
}

/**
 * The Arcane Storm's cadence and bite. Kept separate from EditableRaidBalance
 * because nothing here is shared with a raid: the storm has no waves, no
 * shelter rule, and no exposure ramp — only a metronome and a radius.
 */
export interface EditableArcaneStormBalance {
  /** Seconds into the danger phase before the first impact lands. */
  firstImpactSeconds: number;
  /** Seconds between impacts thereafter. */
  intervalSeconds: number;
  /** How long a marker is visible before it lands — the whole dodge window. */
  telegraphSeconds: number;
  /** Radius of the damaging area, in tiles, measured from the marker centre. */
  impactRadiusTiles: number;
  /** Damage a caught player takes per impact. */
  playerDamage: number;
  /** Every Nth strike carries ore; 3 pays on strikes 3 and 6 of seven. */
  rewardEveryStrikes: number;
  /** Iron ore a rewarding strike leaves at its centre until the storm ends. */
  rewardIronOre: number;
}

/** Turret and player-bow numbers — everything that shoots back at a raid. */
export interface EditableDefenseBalance {
  turretDamage: number;
  turretCooldownTicks: number;
  turretRangeTiles: number;
  turretAmmoCapacity: number;
  /** Shots an idle turret contributes when its base is raided off-screen. */
  turretAbsentRoundShots: number;
  playerShotDamage: number;
  playerShotCooldownTicks: number;
  /** How close an unsheltered player must be before raiders come for them instead. */
  raiderAggroRangeTiles: number;
  /** How far a roamer will chase from its spawn before giving up and walking home. */
  roamerLeashTiles: number;
  /** Live roamers an area is kept stocked with. */
  roamersPerArea: number;
  /** Ticks between top-ups when an area is under its roamer quota. */
  roamerRespawnTicks: number;
}

export type WallMaterialId = 'wood' | 'thatch' | 'stone' | 'metal';
/** Every building that carries a health pool and can be reduced to rubble. */
export type StructureFacilityId =
  | 'field-cache' | 'workbench' | 'furnace' | 'bed' | 'air-purifier'
  | 'garden-bed' | 'woodlot-planter' | 'farm-counter' | 'small-pen' | 'barn'
  | 'stone-yard' | 'cart-dock'
  | 'warehouse' | 'logistics-hub'
  | 'war-table' | 'turret' | 'environment-marker';

export interface EditableStructureBalance {
  wallHp: Record<WallMaterialId, number>;
  facilityHp: Record<StructureFacilityId, number>;
}

/** A wild creature's battle profile; identity and abilities stay in content. */
export interface EditableCreatureBalance {
  maxHp: number;
  attackPower: number;
  defense: number;
  tameEaseBps: number;
  dodgeBps: number;
  moveSpeed: number;
  attackRange: number;
  /** Overworld profile. See CreatureDefinition.encounter for what each means. */
  speedPxPerTick: number;
  attackRangePx: number;
  attackIntervalTicks: number;
  aggroRangePx: number;
  leashPx: number;
  preferredRangePx: number;
  /** Level multiplier in basis points; see EditableRaiderBalance. */
  levelMultiplierBps: number;
}

/**
 * How the world hands out levels, and how thickly it is populated.
 *
 * Levels are a function of distance from town rather than of player level: an
 * area the player cleared at level 3 stays a level 3 area, so travelling
 * further out is the thing that raises the stakes. See simulation/enemyLevels.
 */
export interface EditableWorldBalance {
  /** Tiles of distance from the town centre that buy one extra level. */
  levelBandTiles: number;
  /** Levels added for each ring of areas away from the home area. */
  levelsPerAreaRing: number;
  /** Ceiling no spawn passes, however far out it generates. */
  maxEnemyLevel: number;
  /** Wild creatures a freshly generated area is populated with. */
  creaturesPerArea: number;
}

/** Save-backed tuning edited by the in-game Admin panel. */
export interface GameBalanceState {
  /** Values shared by every character; starting values apply on creation. */
  characterDefaults: {
    startingHp: number;
    startingStamina: number;
    startingMana: number;
    startingAttributePoints: number;
    /**
     * Base recovery per second, in hundredths of a point so the saved document
     * stays whole-numbered while the Admin panel edits it as a decimal: 25 is
     * a quarter of a point per second. Used both by the overworld pulse and by
     * a battle turn.
     */
    hpRegenBaseHundredths: number;
    staminaRegenBaseHundredths: number;
    manaRegenBaseHundredths: number;
    /** Base pixels/second before per-character Speed and mount bonuses. */
    walkSpeed: number;
    /**
     * Sprint speed as tenths of the walking speed, so the published document
     * stays whole-numbered: 15 is the shipped 1.5x.
     */
    sprintSpeedTenths: number;
    /** Stamina spent for each full second of sprinting. */
    sprintStaminaPerSecond: number;
  };
  /**
   * What one point in an attribute buys. Every number the character sheet
   * promises per point lives here, so the whole progression curve is retunable
   * without a build. The `Max` entries cap a bonus no matter how many points go
   * in; without them a per-point change past a handful of points is invisible.
   *
   * Maximums derived at spend time — health, stamina, mana — are not
   * retroactive: raising `healthMaxHp` grows the next point spent, not the
   * ones already spent, the same way a published Walk Speed applies live while
   * a stored Max HP does not.
   *
   * Values whose key ends in `Hundredths` are fixed point: the number stored
   * is a hundredth of the value the player is promised, so a knob can be tuned
   * in decimals without putting a fraction into saved state.
   */
  attributeGains: {
    /** Strength: melee attack power, and damage per hit against resources. */
    strengthMeleeDamage: number;
    strengthGatherDamage: number;
    dexterityRangedDamage: number;
    magicDamage: number;
    /** Luck, in basis points where 10000 is 100%. */
    luckHitChanceBps: number;
    luckHitChanceMaxBps: number;
    luckDodgeChanceBps: number;
    luckDodgeChanceMaxBps: number;
    luckTamingChanceBps: number;
    luckTamingChanceMaxBps: number;
    luckDoubleDropChanceBps: number;
    luckDoubleDropChanceMaxBps: number;
    /** Speed: overworld pixels/second, and battle movement tiles. */
    speedWalkPxPerSecond: number;
    speedBattleTiles: number;
    speedBattleTilesMax: number;
    healthMaxHp: number;
    /** Health Regeneration: HP per second, in hundredths. 25 is 0.25 HP/s. */
    healthRegenHundredths: number;
    staminaMaxStamina: number;
    /** Stamina Regeneration: SP per second, in hundredths. */
    staminaRegenHundredths: number;
    /** Carry weight in hundredths, matching `bagWeight`. */
    carryWeightHundredths: number;
    manaMaxMana: number;
    /** Mana Regeneration: MP per second, in hundredths. */
    manaRegenHundredths: number;
  };
  /** Rewards applied once for every character level gained. */
  levelUp: {
    /** Points automatically added to every attribute. */
    attributePointsPerStat: number;
    /** Unassigned points the player can distribute from the character sheet. */
    spendableAttributePoints: number;
    /** Coins added to the purse. */
    coins: number;
  };
  /** Bag capacity and per-unit item weights, stored in hundredths for exact saves. */
  bagWeight: {
    capacityHundredths: number;
    itemHundredths: Record<BagItemId, number>;
  };
  /**
   * How the 3D overworld camera frames the character, in tenths of a degree so
   * the published document stays whole-numbered. Shared by every client: an
   * angle that stops one player feeling sick is the angle the game is shot at.
   */
  camera: {
    yawTenths: number;
    pitchTenths: number;
  };
  hands: {
    actionTicks: number;
    /** Bare-hand reach; also the reach of a bow used as a club. */
    rangePx: number;
    damageByTarget: Record<StrikeTarget, number>;
  };
  objects: Record<ResourceNodeKind, EditableResourceBalance>;
  tools: Record<ToolDefinitionId, EditableToolBalance>;
  raiders: Record<RaiderKindId, EditableRaiderBalance>;
  raid: EditableRaidBalance;
  storm: EditableArcaneStormBalance;
  defense: EditableDefenseBalance;
  structures: EditableStructureBalance;
  creatures: Record<SpeciesId, EditableCreatureBalance>;
  world: EditableWorldBalance;
  blueprints: EditableBlueprintBalance;
  outlands: EditableOutlandsBalance;
}

/**
 * How often blueprints are found, and how good they are when they are.
 *
 * Every number a player could feel about the drop system lives here rather than
 * in module constants, because this is the one part of the game where "how long
 * until the next one" is the entire experience. A find that arrives twice as
 * often is a different game, and finding that out should not need a build.
 */
/** Field sites: refill rhythm, search times and guards. See content/sites. */
export interface EditableOutlandsBalance {
  /** Survival cycles between refills. */
  restockCycles: number;
  /** Ordinary sites generated per area. */
  sitesPerArea: number;
  /** Ticks to search an ordinary container. */
  searchTicks: number;
  /** Ticks to search a site's strongbox. */
  strongboxSearchTicks: number;
  /** Guards posted at an ordinary site. */
  guardsPerSite: number;
  /** How far, in tiles, a guard chases from its post. */
  guardLeashTiles: number;
  /** Basis-point chance a strongbox carries a blueprint this refill. */
  strongboxBlueprintBps: number;
  /** Extra uncommon loot entries when a container is searched in a danger phase. */
  dangerBonusRolls: number;
}

export interface SiteProgress {
  /** The refill this record describes. */
  restockIndex: number;
  /** Container indices searched this refill, ascending. */
  searched: number[];
  /** Guards killed this refill. */
  guardsDefeated: number;
}

export interface ActiveSearch {
  siteId: string;
  containerIndex: number;
  /** Whole pixels where the search began; moving more than 4 px cancels it. */
  startX: number;
  startY: number;
  hpAtStart: number;
  completesAtTick: number;
}

export interface EditableBlueprintBalance {
  /**
   * Nodes of each kind depleted per blueprint, before jitter. The counter is
   * per node kind *per area theme*, so these are the same everywhere: a biome
   * changes what a find is worth, never how long it takes.
   */
  nodeTargets: Record<ResourceNodeKind, number>;
  /** Raiders defeated per blueprint, before jitter. */
  raiderTarget: number;
  /** Defeats of one species per blueprint from that species, before jitter. */
  creatureTarget: number;
  /**
   * How far a target may wander from its base, in basis points: 2000 spreads a
   * 20-target over 16–24. Zero makes every counter exact and countable, which
   * is precisely the feeling this number exists to prevent.
   */
  jitterBps: number;
  /**
   * Odds a node find comes out Rare rather than Common, by region. This is the
   * risk dial: a marsh find is worth six of a meadow one, and it is the only
   * reason to gather anywhere unpleasant.
   */
  rareShareBpsByTheme: Record<AreaThemeId, number>;
  /**
   * Multiplier applied to the rare share while poison fog is up, in basis
   * points where 10000 is unchanged. Working outside in fog is the risk; better
   * paper is what it buys.
   */
  fogRareMultiplierBps: number;
  /** Ceiling the fog multiplier climbs to, so a find never becomes reliably Rare. */
  rareShareMaxBps: number;
  /** Relative tier weights for a raider drop. Members of a tier split its share. */
  raiderTierWeights: { common: number; rare: number; epic: number };
  /** Relative tier weights for a storm cache's blueprint. */
  stormCacheTierWeights: { rare: number; epic: number; legendary: number };
  /** Caches the arcane storm scatters across the area it starts in. */
  stormCachesPerStorm: number;
  /**
   * Odds one of those caches holds a blueprint at all. Below 10000 on purpose:
   * a cache that always pays is a checklist, and the walk through a storm has
   * to be a gamble to be worth telling anyone about.
   */
  stormCacheBlueprintBps: number;
}

export interface ToolInstance {
  instanceId: string;
  definitionId: ToolDefinitionId;
  durability: number;
  maxDurability: number;
  /** Independent Weaponsmith contract ranks. Rank zero is the crafted tool. */
  powerRank: number;
  speedRank: number;
  durabilityRank: number;
}

export type BuildingDefinitionId =
  // Player surfaces — the cells that define environment area.
  | 'thatch-floor' | 'wood-floor' | 'stone-floor' | 'metal-floor'
  | 'thatch-ground' | 'wood-ground' | 'stone-ground' | 'metal-ground'
  // Boundary parts — walls/doors close floors; fences/gates close ground.
  | 'thatch-wall' | 'wood-wall' | 'thatch-door' | 'wood-door'
  | 'thatch-fence' | 'wood-fence' | 'thatch-gate' | 'wood-gate'
  | 'stone-wall' | 'metal-wall' | 'stone-door' | 'metal-door'
  | 'stone-fence' | 'metal-fence' | 'stone-gate' | 'metal-gate'
  // Landscaping tiles — persisted build pieces that override local terrain.
  | 'wood-bridge' | 'stone-bridge' | 'water'
  // The marker that anchors a named environment; its ID is the environment ID.
  | 'environment-marker'
  // Facilities.
  | 'field-cache' | 'workbench' | 'furnace' | 'bed' | 'air-purifier'
  | 'woodlot-planter' | 'garden-bed' | 'farm-counter' | 'small-pen' | 'barn'
  | 'stone-yard' | 'cart-dock'
  | 'warehouse' | 'logistics-hub'
  // Defence facilities, used by the danger-minute raid.
  | 'war-table' | 'turret';

export type ProcessingRecipeId = 'iron-ingot';

export interface FurnaceQueueItem {
  recipe: ProcessingRecipeId;
  /** Whole milliseconds remaining; zero means output is waiting to collect. */
  remainingWorkMs: number;
  /** Inputs are removed atomically on enqueue and remain visible in the save. */
  reservedInputs: Readonly<Partial<Record<GatherableResourceId, number>>>;
  /** Completed units retained at the Furnace, never an invisible backlog. */
  completedOutput: number;
  /** Persisted presentation/diagnostic flag, updated by every queue settlement. */
  blocked: boolean;
}

export interface FurnaceState {
  queue: FurnaceQueueItem[];
}

/** Finite producer output retained by one Pen/Barn until explicitly collected. */
export interface WorkerHousingState {
  bin: {
    fiber: number;
    berry: number;
  };
}

export function createWorkerHousingState(): WorkerHousingState {
  return { bin: { fiber: 0, berry: 0 } };
}

/** Finite output retained by a dedicated worker facility such as a Stone Yard. */
export interface WorkerProducerState {
  bin: { stone: number };
}

export function createWorkerProducerState(): WorkerProducerState {
  return { bin: { stone: 0 } };
}

/** Stable Cart Dock link plus entry-edge bookkeeping and player-facing feedback. */
export interface CartDockState {
  linkedStorageId: string | null;
  playerInside: boolean;
  lastTransferMessage: string | null;
}

export function createCartDockState(): CartDockState {
  return { linkedStorageId: null, playerInside: false, lastTransferMessage: null };
}

/** One stable, ordered automation link owned by a Logistics Hub. */
export interface LogisticsRouteState {
  sourceWorkerId: string;
  destinationContainerIds: string[];
}

export interface LogisticsHubState {
  routes: LogisticsRouteState[];
  lastRoutingMessage: string | null;
}

export function createLogisticsHubState(): LogisticsHubState {
  return { routes: [], lastRoutingMessage: null };
}

/**
 * Deterministic Garden Bed growth bookkeeping. Integer ticks only; environment
 * validity is always re-derived from wall geometry, never persisted here.
 */
export interface GardenBedState {
  /** Fixed-step ticks of valid growth accumulated toward the next batch. */
  progressTicks: number;
  /** Grown fiber waiting in the bed until the player harvests it. */
  readyFiber: number;
  /** Absolute tick when growth may next advance; prevents double-granting. */
  nextGrowthTick: number;
}

export function createGardenBedState(tick: number): GardenBedState {
  return { progressTicks: 0, readyFiber: 0, nextGrowthTick: tick + GARDEN_BED_GROWTH_STEP_TICKS };
}

export interface WoodlotPlanterState {
  progressTicks: number;
  readyWood: number;
  nextGrowthTick: number;
}

export function createWoodlotPlanterState(tick: number): WoodlotPlanterState {
  return { progressTicks: 0, readyWood: 0, nextGrowthTick: tick + WOODLOT_GROWTH_STEP_TICKS };
}

/**
 * A blueprint lying in the world — dropped on death, or put down deliberately
 * to hand to another player. Both cases use the same rules, because a trade
 * handoff should be its own tense moment rather than a safe one.
 */
export interface BlueprintGroundDrop {
  id: string;
  blueprintId: string;
  x: number;
  y: number;
  /** Absolute tick when it is gone for good. Never null: nothing waits forever. */
  expiresAtTick: number;
}

/**
 * A tool lying in the world after being put down from the Bag.
 *
 * The whole instance travels with the drop rather than just its definition id:
 * a tool's wear and its three contract ranks are what make it that tool, and a
 * player who puts down a rank-3 axe at half durability must pick up the same
 * axe, not a fresh one.
 */
export interface ToolGroundDrop {
  id: string;
  tool: ToolInstance;
  x: number;
  y: number;
  /** Absolute tick when it is gone for good. Never null: nothing waits forever. */
  expiresAtTick: number;
}

/**
 * One physical blueprint in the bag. Instances are distinct so duplicates can
 * be carried, sold, traded, or scrapped one at a time — the id says which
 * recipe, the instanceId says which piece of paper.
 */
export interface CarriedBlueprint {
  instanceId: string;
  blueprintId: string;
}

export interface BuildingState {
  /** Stable, persisted entity ID allocated from nextEntityId. */
  id: string;
  definitionId: BuildingDefinitionId;
  /** Top-left footprint position in whole world tiles. */
  tileX: number;
  tileY: number;
  /** Exactly two orientations: the catalog orientation and 90 degrees clockwise. */
  rotated?: boolean;
  /** Boundary parts occupy this edge of the anchor cell, never the cell. */
  boundaryEdge?: BoundaryEdge;
  /** Present only on Environment Markers; the marker declares the region kind. */
  environmentKind?: EnvironmentKind;
  /** Present only on Storage Boxes (small). Kept on the building so contents persist. */
  storage?: StorageInventoryState;
  /** Explicit stack boundaries for its six inventory spaces. */
  storageStacks?: Partial<InventoryStackState>;
  /** Non-stackable tools stored in this box. */
  storedTools?: ToolInstance[];
  /** Unregistered blueprints stashed here; each one keeps radiating raider heat. */
  storedBlueprints?: CarriedBlueprint[];
  /** Present only on Garden Beds. Growth state persists on the building. */
  garden?: GardenBedState;
  /** Present only on Woodlot Planters. Sapling growth persists on the building. */
  woodlot?: WoodlotPlanterState;
  /** Present only on Furnaces. */
  furnace?: FurnaceState;
  /** Present only on Small Pens and Barns. */
  housing?: WorkerHousingState;
  /** Present only on Stone Yards. */
  producer?: WorkerProducerState;
  /** Present only on Cart Docks. */
  cartDock?: CartDockState;
  /** Present only on Logistics Hubs. */
  logistics?: LogisticsHubState;
  /** Present only on Turrets. Loaded ammunition persists between raids. */
  turret?: TurretState;
  /**
   * Structural health, written only once a wall has actually been damaged.
   * Absent means undamaged, so older saves read as full health without a
   * migration and an untouched wall costs nothing to persist.
   */
  hp?: number;
}

/**
 * One blueprint source's progress toward its next find.
 *
 * `cycle` is not a statistic — it is the seed input that makes each payout's
 * jittered target a different number, so a player who has just watched a
 * counter pay at 17 trees cannot conclude the next one is also 17.
 */
export interface BlueprintProgress {
  /** Nodes depleted, or enemies defeated, since this source last paid. */
  struck: number;
  /** How many times this source has already paid. */
  cycle: number;
}

/**
 * The single serializable authoritative game state. Resource HP, inventory,
 * tools, and cooldowns live here so gathering is deterministic and reload-safe.
 */
export interface GameState {
  onboarding: OpeningChapterState;
  seed: number;
  rngState: number;
  tick: number;
  /** First unsafe tick in this danger phase; cleared outright by reaching shelter. */
  dangerExposureStartedAtTick: number | null;
  /** Non-null from defeat until the player explicitly chooses a destination. */
  pendingRespawn: PendingRespawnState | null;
  /** Brief protection after awakening, principally to prevent a raider spawn loop. */
  respawnProtectionUntilTick: number | null;
  /** The bag left where the player last fell, or null once recovered or expired. */
  deathCache: DeathCacheState | null;
  player: PlayerState;
  /** A workbench-crafted portable rowboat. Ownership is durable and unique. */
  rowboatOwned?: boolean;
  /**
   * A workbench-crafted bow. Arrows are inert without it: every shot — the
   * raid-night shot and the ranged encounter action alike — asks for this
   * first, so ammunition alone never makes the player a shooter.
   */
  /**
   * First tick at which the worn Cloth Mask's filter has run out, or null when
   * none is worn. A mask is drawn from the stack automatically the moment
   * poison fog would otherwise start draining health.
   */
  clothMaskActiveUntilTick: number | null;
  currentArea: AreaDescriptor;
  visitedAreas: Record<string, AreaSnapshot>;
  inventory: InventoryState;
  /** Explicit stack boundaries created by Split Stack. */
  inventoryStacks: InventoryStackState;
  /**
   * Permanent Reinforced Pack ranks bought from Garrick. Kept out of
   * `gameBalance.bagWeight` deliberately: that record is Admin-tunable, and a
   * retune must never silently erase something the player paid coins for.
   */
  packRanks: number;
  /** Arcane Study purchases from Selene; each one raises the price of the next. */
  arcaneStudyPurchases: number;
  /**
   * Stable definition IDs of every blueprint the player knows. Grown only by
   * `learnBlueprint` — core level/quest grants and workbench registration.
   */
  unlockedItemIds: string[];
  /**
   * Core blueprints earned but not yet collected. A level-up drops its grants
   * here rather than straight into the known set, so the Blueprints tab can
   * hold the `????` until the player taps the banner and sees the reveal.
   */
  pendingBlueprintGrantIds: string[];
  /**
   * Supplementary blueprints found in the field and not yet registered. These
   * are the losable ones: they sit in the bag taking a slot each, they draw
   * raiders, and they only become knowledge at a workbench.
   */
  carriedBlueprints: CarriedBlueprint[];
  /** Blueprints lying in the world, each on its own expiry. */
  blueprintDrops: BlueprintGroundDrop[];
  /** Tools put down from the Bag, each on its own expiry. */
  toolDrops: ToolGroundDrop[];
  /**
   * How close each blueprint source is to paying out. See simulation/blueprintFinds.
   *
   * Sparse: a key appears the first time that source is worked, so a save
   * carries counters for the regions the player has actually been to rather
   * than a full matrix of every theme against every node kind.
   */
  blueprintProgress: Record<string, BlueprintProgress>;
  /**
   * Per-site search and guard records, keyed by derived site id. Sparse: a
   * record appears when the player first comes within range of a site, which
   * is also what marks the site discovered. A record whose `restockIndex` is
   * behind the current one describes a refill that has already turned over.
   */
  siteProgress: Record<string, SiteProgress>;
  /** The container search under way, or null. Cancelled by movement or damage. */
  activeSearch: ActiveSearch | null;
  /** Single fixed-point Phase 1 currency. One integer unit is one coin. */
  coins: number;
  /** Lifetime units sold, used by economy objectives and diagnostics. */
  resourcesSold: number;
  /** Sticky discovery: trained copies may only be ordered after a first tame. */
  firstTamedSpeciesIds: SpeciesId[];
  resourcesCollected: ResourceCollectionState;
  /** Fixed-point deterministic-yield carry, one remainder per resource. */
  yieldRemainderByResource: Record<GatherableResourceId, number>;
  /** Number of successful repair commands, used by the tutorial milestone. */
  repairsMade: number;
  /** Durable quest history; predicates are still re-evaluated on every load. */
  completedQuestIds: string[];
  claimedQuestRewardIds: string[];
  /** Minimal durable memory for authored conversations and one-time moments. */
  npcMemory: NpcMemoryState;
  /** Non-derivable lifetime counters for optional and mastery quests. */
  questProgress: QuestProgressState;
  /** Landmark discoveries and cycle-scoped regional gathering contracts. */
  regionalProgress: RegionalProgressState;
  /** Lifetime resources delivered by creature work, even after cache withdrawal. */
  workerResourcesProduced: number;
  groundDrops: GroundDropState[];
  /** Findable one-shot containers in the current area. */
  containers: WorldContainerState[];
  buildings: BuildingState[];
  /** Highest valid enclosed area tier ever reached; never decreases. */
  highestAreaTierEver: AreaTier | 0;
  /**
   * Highest Homestead Rating ever reached, in fixed-point tenths so the
   * canonical state stays integer-only. Sticky: demolition never lowers it.
   */
  highestRatingEverTenths: number;
  resourceNodes: ResourceNodeState[];
  wildCreatures: WildCreatureState[];
  /** Hostile raiders in the current area during a danger minute; empty otherwise. */
  raiders: RaiderState[];
  /** Scheduled arcane strikes for the storm currently running, if any. */
  arcaneStorm: ArcaneStormState;
  /** Survival cycle index the raid bookkeeping below belongs to; null before any raid. */
  raidCycleIndex: number | null;
  /**
   * Area keys already settled this cycle, live or abstractly. An area the
   * player defended in person is recorded the moment its wave spawns, so the
   * end-of-round absent-base pass can never bill the same base twice.
   */
  raidSettledAreaKeys: string[];
  activeEncounter: EncounterState | null;
  ownedCreatures: OwnedCreatureState[];
  /** Creatures currently away on a route; they are unavailable until they return. */
  expeditions: ExpeditionState[];
  /** Lifetime dispatches; also the roll index handed to the next expedition. */
  expeditionsDispatched: number;
  /** One active follower may support ordinary encounters. */
  battleCompanionId: string | null;
  tools: ToolInstance[];
  equippedToolId: string | null;
  nextEntityId: number;
  actionCooldownUntilTick: number;
  /** Authoritative, per-save gameplay tuning; Admin updates persist here. */
  gameBalance: GameBalanceState;
}

export function createInitialState(seed: number, suppliedBalance?: GameBalanceState): GameState {
  const gameBalance = structuredClone(suppliedBalance ?? createDefaultGameBalance());
  return {
    onboarding: createOpeningChapter(seed),
    seed,
    rngState: seed >>> 0,
    tick: 0,
    dangerExposureStartedAtTick: null,
    pendingRespawn: null,
    respawnProtectionUntilTick: null,
    deathCache: null,
    player: createPlayerState(gameBalance),
    rowboatOwned: false,
    clothMaskActiveUntilTick: null,
    currentArea: { key: '0,0', x: 0, y: 0, name: 'Elaris', theme: 'elaris', seed },
    visitedAreas: {},
    inventory: {
      wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0,
      'taming-snare': 0, 'reinforced-snare': 0, berry: 2, arrow: 5, 'cloth-mask': 0,
      'safeguard-charm': 0, 'draft-parchment': 0,
      'tuftle-down': 0, 'craghopper-shell': 0, 'stag-antler': 0, 'snarlfox-pelt': 0,
      'masonmole-claw': 0, 'boar-tusk': 0, 'quillfinch-quill': 0, 'mistmoth-scale': 0,
      'slingtail-stone': 0,
      'scrap-iron': 0, 'clockwork': 0, 'lens': 0, 'arcane-dust': 0, 'construct-core': 0, 'ancient-alloy': 0, 'sealed-satchel': 0, 'vault-key': 0, 'recall-flare': 0,
    },
    inventoryStacks: {
      wood: [], stone: [], fiber: [], 'iron-ore': [], 'iron-ingot': [],
      'taming-snare': [], 'reinforced-snare': [], berry: [2], arrow: [5], 'cloth-mask': [],
      'safeguard-charm': [], 'draft-parchment': [],
      'tuftle-down': [], 'craghopper-shell': [], 'stag-antler': [], 'snarlfox-pelt': [],
      'masonmole-claw': [], 'boar-tusk': [], 'quillfinch-quill': [], 'mistmoth-scale': [],
      'slingtail-stone': [],
      'scrap-iron': [], 'clockwork': [], 'lens': [], 'arcane-dust': [], 'construct-core': [], 'ancient-alloy': [], 'sealed-satchel': [], 'vault-key': [], 'recall-flare': [],
    },
    packRanks: 0,
    arcaneStudyPurchases: 0,
    // The level-1 gate is knowledge a character starts with, not something they
    // collect from a banner they never saw earned.
    unlockedItemIds: [...blueprintsGrantedAtLevel(1)],
    pendingBlueprintGrantIds: [],
    carriedBlueprints: [],
    blueprintDrops: [],
    toolDrops: [],
    blueprintProgress: {},
    siteProgress: {},
    activeSearch: null,
    coins: 0,
    resourcesSold: 0,
    firstTamedSpeciesIds: [],
    resourcesCollected: { wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0 },
    yieldRemainderByResource: { wood: 0, stone: 0, fiber: 0, 'iron-ore': 0, 'iron-ingot': 0 },
    repairsMade: 0,
    completedQuestIds: [],
    claimedQuestRewardIds: [],
    npcMemory: createNpcMemoryState(),
    questProgress: createQuestProgressState(),
    regionalProgress: createRegionalProgressState(),
    workerResourcesProduced: 0,
    groundDrops: [],
    containers: generateAreaContainers(seed, '', true, { x: 0, y: 0, theme: 'elaris' }, seed, '0,0'),
    buildings: [],
    highestAreaTierEver: 0,
    highestRatingEverTenths: 0,
    resourceNodes: generateResourceNodes(seed, gameBalance.objects),
    wildCreatures: [...generateWildCreatures(seed, '', true, undefined, seed, '0,0', gameBalance.world), generateOpeningTuftle(seed)],
    raiders: [],
    arcaneStorm: createArcaneStormState(),
    raidCycleIndex: null,
    raidSettledAreaKeys: [],
    activeEncounter: null,
    ownedCreatures: [],
    expeditions: [],
    expeditionsDispatched: 0,
    battleCompanionId: null,
    tools: [],
    equippedToolId: null,
    nextEntityId: 1,
    actionCooldownUntilTick: 0,
    gameBalance,
  };
}

/** Create one character from the current global starting-value configuration. */
export function createPlayerState(gameBalance: GameBalanceState): PlayerState {
  const defaults = gameBalance.characterDefaults;
  return {
    x: WORLD_PX / 2,
    y: WORLD_PX / 2,
    facing: 'down',
    traversalMode: 'foot',
    hp: defaults.startingHp,
    maxHp: defaults.startingHp,
    stamina: defaults.startingStamina,
    maxStamina: defaults.startingStamina,
    mana: defaults.startingMana,
    maxMana: defaults.startingMana,
    level: 1,
    xp: 0,
    attributePoints: defaults.startingAttributePoints,
    attributes: {
      strength: 0,
      dexterity: 0,
      magic: 0,
      luck: 0,
      speed: 0,
      health: 0,
      healthRegen: 0,
      stamina: 0,
      staminaRegen: 0,
      carryWeight: 0,
      mana: 0,
      manaRegen: 0,
    },
  };
}
