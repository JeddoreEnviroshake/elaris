import type {
  AreaThemeId,
  BagItemId, BuildingDefinitionId, DangerThreat, EditableArcaneStormBalance, EditableBlueprintBalance,
  EditableResourceBalance,
  GameBalanceState, GameState,
  GatherableResourceId, RaidTargetPriority, RaiderKindId, RaiderState, ResourceId, ResourceNodeKind,
  EditableWorldBalance, SpeciesId, StructureFacilityId, ToolDefinitionId,
  VariantToolKind, VariantToolQuality, WildCreatureState,
} from '../simulation/state';
import { scaleByLevel } from '../simulation/enemyLevels';
import type { NonEmptyEfficiencyAxes } from '../content/efficiency';
import type { BuildingMaterialId } from '../content/buildingParts';
import { CREATURE_DEFINITIONS, creatureDefinition, type CreatureDefinition } from '../content/creatures';
import { RAIDER_DEFINITIONS, raiderDefinition, type RaiderDefinition } from '../content/raiders';
import { ELARIS_CAMERA_DEFAULT_TENTHS } from '../three/cameraControls';
import {
  FIXED_STEP_MS, PLAYER_SPEED_PX_PER_S, SPRINT_SPEED_TENTHS, SPRINT_STAMINA_PER_SECOND, TILE_SIZE,
} from './platform';

/** First vertical-slice balance values. All simulation values are integers. */
export const INTERACTION_RANGE_PX = 42;
export const TAMING_RANGE_PX = 42;
/** One Tuftle work attempt every three real-time seconds at the fixed 60 Hz tick. */
export const TUFTLE_WORK_TICKS = 180;
/** Tuftles work without tools, so a node takes several visits to harvest. */
export const TUFTLE_WORK_DAMAGE = 10;
/** Resource stacks use the same maximum size in Bags and storage boxes. */
export const FIELD_CACHE_STACK_SIZE = 99;
/** Storage Box (small) capacity: resource stacks and tools each occupy one space. */
export const STORAGE_BOX_SLOTS = 6;
/** Warehouse capacity; uses the same persisted stack model as small storage. */
export const WAREHOUSE_SLOTS = 24;
export const INVENTORY_SLOTS = 20;
export const RESOURCE_STACK_SIZE = 99;

/** Exact bag-weight scale. One displayed weight unit is 100 persisted units. */
export const BAG_WEIGHT_SCALE = 100;
export const DEFAULT_BAG_CAPACITY_HUNDREDTHS = 100 * BAG_WEIGHT_SCALE;
/** Shipped carry weight per Carry Weight point; the Admin panel retunes the live value. */
export const CARRY_WEIGHT_CAPACITY_HUNDREDTHS = 2 * BAG_WEIGHT_SCALE;
/**
 * Shipped recovery per point, in hundredths of a point per second. A quarter
 * of a point a second is deliberately slow: regeneration used to be a whole
 * point per pulse, which made the stat the only one worth buying.
 */
export const REGEN_PER_POINT_HUNDREDTHS = 25;
export const BAG_ITEM_IDS: readonly BagItemId[] = [
  'taming-snare', 'reinforced-snare', 'berry', 'arrow', 'cloth-mask', 'safeguard-charm',
  'draft-parchment',
  'wood', 'stone', 'fiber', 'iron-ingot', 'iron-ore',
  'tuftle-down', 'craghopper-shell', 'stag-antler', 'snarlfox-pelt',
  'masonmole-claw', 'boar-tusk', 'quillfinch-quill', 'mistmoth-scale', 'slingtail-stone',
];
/** Display names for every Bag item; ids stay kebab-case in the simulation. */
export const BAG_ITEM_LABELS: Readonly<Record<BagItemId, string>> = {
  'taming-snare': 'Taming Snare', 'reinforced-snare': 'Reinforced Snare',
  berry: 'Berry', arrow: 'Arrow', 'cloth-mask': 'Cloth Mask', 'safeguard-charm': 'Safeguard Charm',
  'draft-parchment': 'Draft Parchment',
  wood: 'Wood', stone: 'Stone', fiber: 'Fiber', 'iron-ingot': 'Iron Ingot', 'iron-ore': 'Iron Ore',
  'tuftle-down': 'Tuftle Down', 'craghopper-shell': 'Craghopper Shell',
  'stag-antler': 'Stag Antler', 'snarlfox-pelt': 'Snarlfox Pelt',
  'masonmole-claw': 'Masonmole Claw', 'boar-tusk': 'Boar Tusk',
  'quillfinch-quill': 'Quillfinch Quill', 'mistmoth-scale': 'Mistmoth Scale',
  'slingtail-stone': 'Slingtail Stone',
};
export const DEFAULT_ITEM_WEIGHT_HUNDREDTHS: Readonly<Record<BagItemId, number>> = {
  'taming-snare': 100,
  'reinforced-snare': 125,
  berry: 25,
  arrow: 25,
  'cloth-mask': 50,
  'safeguard-charm': 25,
  // Salvaged paper and vellum: light enough that a scrapping trip is never
  // limited by the bag.
  'draft-parchment': 25,
  wood: 100,
  stone: 300,
  fiber: 50,
  'iron-ingot': 500,
  'iron-ore': 300,
  // Trophies are light: a hunting trip should be limited by finding the
  // creatures, never by the bag refusing the reward for having found them.
  'tuftle-down': 25,
  'craghopper-shell': 150,
  'stag-antler': 100,
  'snarlfox-pelt': 75,
  'masonmole-claw': 100,
  'boar-tusk': 125,
  'quillfinch-quill': 25,
  'mistmoth-scale': 25,
  'slingtail-stone': 200,
};

export const RESOURCE_BALANCE: Readonly<Record<ResourceNodeKind, EditableResourceBalance>> = {
  tree: { maxHp: 30, yieldMin: 4, yieldMax: 4, yieldAmount: 4, resource: 'wood', respawnTicks: 7_200, hardness: 1, minimumToolTier: 0, berryYield: 0 },
  stone: { maxHp: 40, yieldMin: 3, yieldMax: 3, yieldAmount: 3, resource: 'stone', respawnTicks: 10_800, hardness: 2, minimumToolTier: 1, berryYield: 0 },
  metal: { maxHp: 60, yieldMin: 2, yieldMax: 4, yieldAmount: 3, resource: 'iron-ore', respawnTicks: 14_400, hardness: 3, minimumToolTier: 2, berryYield: 0 },
  plant: { maxHp: 20, yieldMin: 5, yieldMax: 5, yieldAmount: 5, resource: 'fiber', respawnTicks: 3_600, hardness: 1, minimumToolTier: 0, berryYield: 2 },
  'berry-bush': { maxHp: 15, yieldMin: 2, yieldMax: 2, yieldAmount: 2, resource: 'fiber', respawnTicks: 4_800, hardness: 1, minimumToolTier: 0, berryYield: 5 },
};

/**
 * Everything a swing can land on. Resource nodes were the original target
 * space; raiders and structures join it so one damage table can describe a
 * tool's whole relationship with the world — an axe that fells trees, chips
 * walls, and makes a poor weapon, all in the same row.
 */
export type StrikeTarget = ResourceNodeKind | 'raider' | 'creature' | 'structure';

/** Bare hands: slow emergency gathering on soft targets only; never break. */
export const HANDS_DAMAGE_BY_TARGET: Readonly<Partial<Record<StrikeTarget, number>>> = {
  tree: 5,
  plant: 5,
  'berry-bush': 5,
  // Matches HANDS_WALL_DAMAGE, which this entry replaces as the source of
  // truth for an unarmed swing against a player-built structure.
  structure: 3,
  raider: 2,
  // A creature is flesh exactly as a raider is, so every row here mirrors the
  // raider figure. Species difficulty lives in the creature's own maxHp and
  // defense, not in a second per-species damage table that would say the same
  // thing four times.
  creature: 2,
};
/** Compatibility value used by the current gathering command. */
export const HANDS_DAMAGE_TREE = 5;
export const HANDS_ACTION_TICKS = 30;

/**
 * Structural health for player-built walls, by material. Walls are struck with
 * the equipped tool rather than gathered, so they carry their own health pool
 * instead of an entry in RESOURCE_BALANCE.
 */
export const WALL_MAX_HP: Readonly<Record<BuildingMaterialId, number>> = {
  wood: 200,
  thatch: 45,
  stone: 450,
  metal: 900,
};
/** Melee reach for striking a wall; deliberately shorter than gathering reach. */
export const WALL_ATTACK_RANGE_PX = TILE_SIZE * 3 / 2;
/** Bare hands chip a wall slowly; any tool is meaningfully faster. */
export const HANDS_WALL_DAMAGE = 3;

/**
 * Structural health for facilities. Facilities are not made of a single scored
 * material, so they carry explicit pools rather than reading WALL_MAX_HP. Every
 * facility can be destroyed by raiders and, at 0, is removed from the world.
 */
export const FACILITY_MAX_HP: Readonly<Partial<Record<BuildingDefinitionId, number>>> = {
  'field-cache': 60,
  workbench: 120,
  furnace: 160,
  'farm-counter': 100,
  'small-pen': 90,
  barn: 180,
  'stone-yard': 140,
  'cart-dock': 140,
  warehouse: 260,
  'logistics-hub': 220,
  bed: 80,
  // The Air Purifier is what keeps the danger minute survivable, so it is the
  // sturdiest thing in a base rather than the softest.
  'air-purifier': 200,
  'garden-bed': 60,
  'woodlot-planter': 80,
  'war-table': 140,
  turret: 110,
  'environment-marker': 40,
};

/**
 * Danger-minute raid. All values are integers on the fixed 60 Hz tick, and
 * raider speeds are whole pixels per tick so no raider position can ever become
 * fractional and break the canonical state hash.
 */
export const TURRET_DAMAGE = 12;
export const TURRET_FIRE_COOLDOWN_TICKS = 45;
export const TURRET_RANGE_TILES = 7;
export const TURRET_RANGE_PX = TILE_SIZE * TURRET_RANGE_TILES;
export const TURRET_AMMO_CAPACITY = 60;
/** Shots an idle turret can contribute when its base is raided off-screen. */
export const TURRET_ABSENT_ROUND_SHOTS = 40;

export const PLAYER_SHOT_DAMAGE = 18;
export const PLAYER_SHOT_COOLDOWN_TICKS = 24;
export const PLAYER_SHOT_RANGE_TILES = 6;
export const PLAYER_SHOT_RANGE_PX = TILE_SIZE * PLAYER_SHOT_RANGE_TILES;

/**
 * How close an unsheltered player has to be before raiders drop the base and
 * come for them instead.
 *
 * Deliberately wider than PLAYER_SHOT_RANGE_TILES: if aggro were the shorter
 * of the two, the optimal raid night would be standing just out of reach
 * plinking a wave that never answers. Being able to shoot means being close
 * enough to be chased, so opening fire is a commitment.
 */
export const RAIDER_AGGRO_RANGE_TILES = 10;

/**
 * Roaming hostiles: the reason a weapon is worth carrying outside the danger
 * minute. Their aggro zone is per kind now — see RaiderDefinition.aggroRangePx —
 * so a Drifter can be something to walk past and a Poacher something that
 * hunts, while the leash keeps either from following across the whole map.
 */
export const ROAMER_LEASH_TILES = 14;
export const ROAMERS_PER_AREA = 6;
export const ROAMER_RESPAWN_TICKS = 900;

/**
 * How the world hands out levels, and how thickly it populates a new area.
 *
 * The bands are sized against the map rather than picked freely: the area is
 * 160 tiles across, so a 20-tile band leaves the ring road outside town at
 * level 1 and puts the far corners around level 6. Each ring of areas then adds
 * a level on top, which is what makes travelling out the way a player raises
 * the stakes.
 */
export const LEVEL_BAND_TILES = 20;
export const LEVELS_PER_AREA_RING = 1;
export const MAX_ENEMY_LEVEL = 20;
export const CREATURES_PER_AREA = 14;

/**
 * The shipped world tuning as one object, so world generation has something to
 * fall back on. Generation runs in places that have no GameState — save
 * migration, the initial world — and those have to populate an area by the same
 * rule a live one does rather than by a second hardcoded copy of it.
 */
export const DEFAULT_WORLD_BALANCE: EditableWorldBalance = {
  levelBandTiles: LEVEL_BAND_TILES,
  levelsPerAreaRing: LEVELS_PER_AREA_RING,
  maxEnemyLevel: MAX_ENEMY_LEVEL,
  creaturesPerArea: CREATURES_PER_AREA,
};

/**
 * Default level multiplier, in basis points: a quarter of base per level. Low
 * enough that a level 2 of anything is a fight the same gear wins, and high
 * enough that a level 6 on the map's edge is a reason to go home and craft.
 */
export const LEVEL_MULTIPLIER_BPS = 2_500;

/**
 * Kill and tame awards, scaled by the enemy's level at the point they are paid.
 * Named because levelling made them arithmetic rather than literals.
 */
export const CREATURE_DEFEAT_XP = 40;
export const CREATURE_TAME_XP = 50;

/**
 * The survival cycle and its exposure rule. These live here rather than in
 * survivalCycle.ts because every one of them is Admin-editable balance;
 * survivalCycle re-exports them so existing callers and tests are unaffected.
 *
 * Exposure ramps rather than draining flat. A flat 40 HP/s meant that the tick
 * a wall fell was effectively the tick the player died, with nothing to do
 * about it; a ramp gives a real window to run for another purified room.
 */
export const SAFE_PHASE_SECONDS = 10 * 60;
/** The length every danger element ships at, before Admin retunes any of them. */
export const DANGER_PHASE_SECONDS = 60;
/**
 * Danger-phase length per element. Each one is tuned on its own — a fog night
 * and a raid night are different demands and do not have to be the same length.
 */
export const DANGER_PHASE_SECONDS_BY_THREAT: Readonly<Record<DangerThreat, number>> = {
  fog: DANGER_PHASE_SECONDS,
  raid: DANGER_PHASE_SECONDS,
  storm: DANGER_PHASE_SECONDS,
};
export const DANGER_GRACE_SECONDS = 10;
export const DANGER_EXPOSURE_DAMAGE_PER_SECOND = 6;
export const DANGER_EXPOSURE_RAMP_PER_SECOND = 4;
export const DANGER_EXPOSURE_MAX_DAMAGE_PER_SECOND = 40;
export const TICKS_PER_SECOND = Math.round(1000 / FIXED_STEP_MS);

/**
 * Cloth Mask: a stackable filter, spent one at a time, that holds the fog off
 * for a few seconds each. Deliberately far shorter than the danger phase — a
 * pocketful of masks buys a run home, never a night spent outdoors.
 */
export const CLOTH_MASK_PROTECTION_SECONDS = 5;
export const CLOTH_MASK_CRAFT_COST: Readonly<Partial<Record<ResourceId, number>>> = { fiber: 4 };
/** One workbench Bow; without it arrows are so much firewood. */
/**
 * The remaining handcraft consumables. Declared here rather than inline in the
 * craft commands so the HUD can price a card from the same numbers it spends.
 */
export const TAMING_SNARE_CRAFT_COST: Readonly<Partial<Record<ResourceId, number>>> = { wood: 1, fiber: 2 };
export const ARROWS_CRAFT_COST: Readonly<Partial<Record<ResourceId, number>>> = { wood: 1, stone: 1 };
/** Arrows come off the bench three at a time. */
export const ARROWS_PER_CRAFT = 3;

/**
 * The Reinforced Snare wants one trophy from each of the four founding species,
 * so the best capture tool in the game is gated on having hunted a spread of the
 * roster rather than on hoarding one easy creature. It comes off the bench in
 * pairs to keep the twelve-or-so defeats that fund it worth the trip.
 *
 * The homestead-defence species deliberately stayed out of the recipe: their
 * trophies are what a player earns *after* a base is worth defending, and
 * routing the capture tool through them would gate taming behind the very
 * creatures taming exists to acquire.
 */
export const REINFORCED_SNARE_CRAFT_COST: Readonly<Partial<Record<ResourceId, number>>> = {
  'tuftle-down': 1, 'craghopper-shell': 1, 'stag-antler': 1, 'snarlfox-pelt': 1, fiber: 4,
};
export const REINFORCED_SNARES_PER_CRAFT = 2;

/**
 * Where blueprints come from, and how fast.
 *
 * Blueprints used to be rolled per node at a flat per-biome rate, which made
 * the whole system unanswerable: a player could work a marsh for an hour and
 * have nothing to show, and no amount of explaining the odds makes that feel
 * like anything but the game withholding. Counters replace the roll outright.
 * Every source owes a blueprint after so much work, and the only thing left to
 * chance is exactly which swing pays and which recipe it turns out to be.
 *
 * The targets below are what a player should end up saying out loud: trees are
 * about twenty, stone about fifteen. The jitter is what stops them ever being
 * able to count to it — see EditableBlueprintBalance.
 */
export const BLUEPRINT_BALANCE: Readonly<EditableBlueprintBalance> = {
  nodeTargets: {
    tree: 20,
    stone: 15,
    metal: 15,
    plant: 30,
    'berry-bush': 30,
  },
  // Shorter than any gathering counter because raiders only exist for part of
  // one night in a cycle: eight defeats is most of a wave, not an evening.
  raiderTarget: 8,
  creatureTarget: 10,
  jitterBps: 2_000,
  // The risk dial. Elaris is barren by design — town has no nodes, and a player
  // must never learn that the safest ground is where the paper is.
  rareShareBpsByTheme: {
    elaris: 0,
    meadow: 500,
    forest: 1_000,
    thicket: 1_500,
    mountain: 2_200,
    marsh: 3_000,
  },
  fogRareMultiplierBps: 20_000,
  rareShareMaxBps: 6_000,
  raiderTierWeights: { common: 45, rare: 35, epic: 20 },
  stormCacheTierWeights: { rare: 55, epic: 35, legendary: 10 },
  stormCachesPerStorm: 3,
  stormCacheBlueprintBps: 5_000,
};

/**
 * Defeats of one species per trophy it yields. A counter rather than a roll:
 * this codebase promises players that nothing "fails randomly", and a counter
 * is also the only version that stays stable under deterministic replay.
 */
export const TROPHY_DEFEATS_PER_DROP = 3;

/** Every building that carries a health pool, in stable Admin display order. */
export const STRUCTURE_FACILITY_IDS: readonly StructureFacilityId[] = [
  'air-purifier', 'war-table', 'turret', 'bed', 'workbench', 'furnace',
  'field-cache', 'garden-bed', 'woodlot-planter', 'farm-counter', 'small-pen', 'barn', 'environment-marker',
  'stone-yard', 'cart-dock',
  'warehouse', 'logistics-hub',
];
export const WALL_MATERIAL_IDS: readonly BuildingMaterialId[] = ['wood', 'thatch', 'stone', 'metal'];

/** Raiders per wave at the first raid, before scaling by raid number and rating. */
export const RAID_WAVE_BASE_SIZE = 3;
export const RAID_WAVE_MAX_SIZE = 14;
/**
 * Extra raiders per completed raid, in fixed-point tenths. Doubled from 4 when
 * raids moved to every other cycle: growth is counted per raid now, so without
 * this the curve would have flattened to half its old slope.
 */
export const RAID_WAVE_GROWTH_TENTHS = 8;
/** Extra raiders per point of Homestead Rating, in fixed-point tenths. */
export const RAID_WAVE_RATING_TENTHS = 2;
/**
 * Warning window. Raiders used to appear on the map edge the instant the danger
 * phase began, which left no time to load turrets or get behind a wall; they
 * now spend the first stretch of the minute approaching from off-map.
 */
export const RAID_SPAWN_DELAY_SECONDS = 15;
/** Raiders chew through the rest of a base before the Air Purifier. */
export const RAID_TARGET_PRIORITY: RaidTargetPriority = 'purifier-last';

/**
 * The Arcane Storm's metronome, tuned so a default 60-second phase holds
 * exactly seven impacts: the first at 0:08 and one every 8 seconds after, the
 * last at 0:56. Three seconds of telegraph is enough to walk two tiles clear at
 * base speed and not enough to ignore. 35 damage is a third of a starting
 * health pool — a caught player is hurt, never one-shot, and a player who
 * ignores three markers dies.
 */
/**
 * The most an admin may set a single impact to. Half a starting health pool:
 * above that, one missed marker takes a fresh character from full to nearly
 * dead, and the event stops being a test the player can learn by failing it.
 */
export const ARCANE_STORM_MAX_PLAYER_DAMAGE = 50;

export const ARCANE_STORM_BALANCE: Readonly<EditableArcaneStormBalance> = {
  firstImpactSeconds: 8,
  intervalSeconds: 8,
  telegraphSeconds: 3,
  impactRadiusTiles: 2,
  playerDamage: 35,
  rewardEveryStrikes: 3,
  rewardIronOre: 1,
};

/** Exact requirement shown when a target is ineligible for the current tool. */
export const REQUIRED_TOOL_LABEL: Readonly<Record<ResourceNodeKind, string>> = {
  tree: 'an axe',
  stone: 'a pick',
  metal: 'a Stone pick',
  plant: 'a sickle',
  'berry-bush': 'a sickle',
};

/**
 * Garden Bed: renewable fiber growth inside a qualifying grassland work yard.
 * One batch matches a plant node's yield and respawn pacing, but grows next to
 * the player's base. All values are integers on the fixed 60 Hz tick.
 */
export const GARDEN_BED_GROW_TICKS = 3_600;
export const GARDEN_BED_YIELD_FIBER = 5;
/** Grown fiber waits in the bed up to this cap; a full bed pauses growth. */
export const GARDEN_BED_READY_CAP = 15;
/** Growth advances in one-second quanta so environment validity is re-derived cheaply. */
export const GARDEN_BED_GROWTH_STEP_TICKS = 60;

/** Woodlot Planter: slower renewable wood from a qualifying forest work yard. */
export const WOODLOT_GROW_TICKS = 7_200;
export const WOODLOT_YIELD_WOOD = 4;
export const WOODLOT_READY_CAP = 12;
export const WOODLOT_GROWTH_STEP_TICKS = 60;

export type ToolKind = 'axe' | 'pick' | 'sickle' | 'sword' | 'bow' | 'staff';

/** Tool material tiers as numeric ranks for minimum-tier gates (hands are 0). */
export const TOOL_TIER_RANK: Readonly<Record<'wooden' | 'stone' | 'iron', number>> = {
  wooden: 1,
  stone: 2,
  iron: 3,
};

/** The pool a use is paid out of. Arrows come from the bag; the rest are player pools. */
export type ToolCostResource = 'stamina' | 'mana' | 'arrow';

/**
 * What one use of a tool costs beyond durability — its cast value.
 *
 * Every weapon spends something to be swung, and which pool it spends is what
 * separates them: a sword is SP, a staff is MP, a bow is an arrow out of the
 * bag. Before this, every use of every tool cost the same flat two stamina no
 * matter what was in hand, so mana had nothing to do with the overworld and the
 * arrow was a rule the shot path kept to itself.
 */
export interface ToolUseCost {
  readonly resource: ToolCostResource;
  readonly amount: number;
}

/**
 * The cast value of one use, by tool kind.
 *
 * Kept as a table rather than a column on every row because the cost is a
 * property of what the tool *is*: an Ancient Sword is still a sword, and no
 * tier of anything has ever wanted its own figure here. Gathering tools carry
 * the flat two stamina every swing used to cost, so nothing about chopping or
 * mining changes; only the weapons gained a pool of their own.
 */
export const TOOL_USE_COST_BY_KIND: Readonly<Record<ToolKind, ToolUseCost>> = {
  axe: { resource: 'stamina', amount: 2 },
  pick: { resource: 'stamina', amount: 2 },
  sickle: { resource: 'stamina', amount: 2 },
  sword: { resource: 'stamina', amount: 1 },
  staff: { resource: 'mana', amount: 1 },
  // The bow's use is its shot, and a shot is paid in arrows. Its close-range
  // bash is not a use of the bow so much as a use of the player's arms, and
  // falls back to the bare-hand stamina cost — see `strikeUseCost`, which is
  // what keeps a player with no arrows left weak rather than unable to act.
  bow: { resource: 'arrow', amount: 1 },
};

export interface ToolDefinition {
  definitionId: ToolDefinitionId;
  displayName: string;
  kind: ToolKind;
  /** Omitted for ordinary recipes; shop tools can only enter play through their named service. */
  shopService?: 'magic-shop';
  tier: 'wooden' | 'stone' | 'iron';
  /**
   * Set on the rare above-Wooden recipe that is still made in the hands, so the
   * station a tool belongs to is a property of the recipe rather than something
   * every surface re-derives from its tier.
   */
  handcraft?: true;
  craftCost: Readonly<Partial<Record<GatherableResourceId, number>>>;
  maxDurability: number;
  /** Primary-target damage; kept as the headline number for previews/upgrades. */
  damage: number;
  actionTicks: number;
  wearPerHit: number;
  /**
   * How far this tool reaches, in world pixels, when it is used on something.
   *
   * A swung tool reaches `INTERACTION_RANGE_PX` — the same distance a gather
   * lands at — so reach and the interaction prompt agree. The Bow is the one
   * tool whose reach is its *shot*: this is the range an arrow can be fired at,
   * and its feeble close-range bash falls back to bare-hand reach rather than
   * letting a bow melee from six tiles away.
   */
  rangePx: number;
  /**
   * Explicit per-target eligibility. A missing entry means zero damage and an
   * ineligible target — never a default of one. Every positive damage entry
   * pairs with a positive wear multiplier (content validation enforces this).
   * Off-primary entries are deliberately weak and wear about twice as fast;
   * the penalty is visible in the HUD tool panel.
   */
  baseDamageByTarget: Readonly<Partial<Record<StrikeTarget, number>>>;
  wearMultiplierByTarget: Readonly<Partial<Record<StrikeTarget, number>>>;
  repairBasisCost: Readonly<Partial<Record<GatherableResourceId, number>>>;
  efficiencyAxes: NonEmptyEfficiencyAxes;
  /** What one use spends besides durability; derived from `kind`, never written per row. */
  useCost: ToolUseCost;
}

/** A hand-written row before its cast value is folded in from `kind`. */
type ToolRow = Omit<ToolDefinition, 'useCost'>;

/** The hand-written rows. Variants are derived from these, never the reverse. */
const BASE_TOOL_DEFINITIONS: readonly ToolRow[] = [
  { definitionId: 'wooden-axe', displayName: 'Wooden Axe', kind: 'axe', tier: 'wooden', craftCost: { wood: 5 }, maxDurability: 48, damage: 10, actionTicks: 24, wearPerHit: 1, rangePx: INTERACTION_RANGE_PX, baseDamageByTarget: { tree: 10, plant: 4, raider: 3, creature: 3, structure: 10 }, wearMultiplierByTarget: { tree: 1, plant: 2, raider: 2, creature: 2, structure: 1 }, repairBasisCost: { wood: 5 }, efficiencyAxes: ['break', 'uptime'] },
  { definitionId: 'wooden-pick', displayName: 'Wooden Pick', kind: 'pick', tier: 'wooden', craftCost: { wood: 5 }, maxDurability: 48, damage: 10, actionTicks: 24, wearPerHit: 1, rangePx: INTERACTION_RANGE_PX, baseDamageByTarget: { stone: 10, raider: 3, creature: 3, structure: 10 }, wearMultiplierByTarget: { stone: 1, raider: 2, creature: 2, structure: 1 }, repairBasisCost: { wood: 5 }, efficiencyAxes: ['break', 'uptime'] },
  { definitionId: 'wooden-sickle', displayName: 'Wooden Sickle', kind: 'sickle', tier: 'wooden', craftCost: { wood: 4 }, maxDurability: 44, damage: 10, actionTicks: 22, wearPerHit: 1, rangePx: INTERACTION_RANGE_PX, baseDamageByTarget: { plant: 10, tree: 4, raider: 2, creature: 2, structure: 10 }, wearMultiplierByTarget: { plant: 1, tree: 2, raider: 2, creature: 2, structure: 1 }, repairBasisCost: { wood: 4 }, efficiencyAxes: ['break', 'yield', 'uptime'] },
  { definitionId: 'stone-axe', displayName: 'Stone Axe', kind: 'axe', tier: 'stone', craftCost: { wood: 2, stone: 6 }, maxDurability: 96, damage: 15, actionTicks: 18, wearPerHit: 1, rangePx: INTERACTION_RANGE_PX, baseDamageByTarget: { tree: 15, plant: 6, raider: 4, creature: 4, structure: 15 }, wearMultiplierByTarget: { tree: 1, plant: 2, raider: 2, creature: 2, structure: 1 }, repairBasisCost: { wood: 2, stone: 6 }, efficiencyAxes: ['break', 'uptime'] },
  { definitionId: 'stone-pick', displayName: 'Stone Pick', kind: 'pick', tier: 'stone', craftCost: { wood: 2, stone: 6 }, maxDurability: 96, damage: 15, actionTicks: 18, wearPerHit: 1, rangePx: INTERACTION_RANGE_PX, baseDamageByTarget: { stone: 15, metal: 15, raider: 4, creature: 4, structure: 15 }, wearMultiplierByTarget: { stone: 1, metal: 1, raider: 2, creature: 2, structure: 1 }, repairBasisCost: { wood: 2, stone: 6 }, efficiencyAxes: ['break', 'uptime'] },
  { definitionId: 'stone-sickle', displayName: 'Stone Sickle', kind: 'sickle', tier: 'stone', craftCost: { wood: 2, stone: 5 }, maxDurability: 88, damage: 15, actionTicks: 17, wearPerHit: 1, rangePx: INTERACTION_RANGE_PX, baseDamageByTarget: { plant: 15, tree: 6, raider: 3, creature: 3, structure: 15 }, wearMultiplierByTarget: { plant: 1, tree: 2, raider: 2, creature: 2, structure: 1 }, repairBasisCost: { wood: 2, stone: 5 }, efficiencyAxes: ['break', 'yield', 'uptime'] },
  { definitionId: 'iron-axe', displayName: 'Iron Axe', kind: 'axe', tier: 'iron', craftCost: { wood: 2, 'iron-ingot': 4 }, maxDurability: 240, damage: 24, actionTicks: 12, wearPerHit: 1, rangePx: INTERACTION_RANGE_PX, baseDamageByTarget: { tree: 24, plant: 10, raider: 6, creature: 6, structure: 24 }, wearMultiplierByTarget: { tree: 1, plant: 2, raider: 2, creature: 2, structure: 1 }, repairBasisCost: { wood: 2, 'iron-ingot': 4 }, efficiencyAxes: ['break', 'uptime'] },
  { definitionId: 'iron-pick', displayName: 'Iron Pick', kind: 'pick', tier: 'iron', craftCost: { wood: 2, 'iron-ingot': 4 }, maxDurability: 240, damage: 24, actionTicks: 12, wearPerHit: 1, rangePx: INTERACTION_RANGE_PX, baseDamageByTarget: { stone: 24, metal: 24, raider: 6, creature: 6, structure: 24 }, wearMultiplierByTarget: { stone: 1, metal: 1, raider: 2, creature: 2, structure: 1 }, repairBasisCost: { wood: 2, 'iron-ingot': 4 }, efficiencyAxes: ['break', 'uptime'] },
  { definitionId: 'iron-sickle', displayName: 'Iron Sickle', kind: 'sickle', tier: 'iron', craftCost: { wood: 2, 'iron-ingot': 4 }, maxDurability: 220, damage: 24, actionTicks: 11, wearPerHit: 1, rangePx: INTERACTION_RANGE_PX, baseDamageByTarget: { plant: 24, tree: 10, raider: 4, creature: 4, structure: 24 }, wearMultiplierByTarget: { plant: 1, tree: 2, raider: 2, creature: 2, structure: 1 }, repairBasisCost: { wood: 2, 'iron-ingot': 4 }, efficiencyAxes: ['break', 'yield', 'uptime'] },
  // Swords: the traveller's kit. One bag slot that harvests everything at a
  // reduced rate and is the only tool that fights well, paid for in durability
  // (every resource row wears double) and in never touching metal — ore is the
  // one thing that must still require the right tool.
  { definitionId: 'wooden-sword', displayName: 'Wooden Sword', kind: 'sword', tier: 'wooden', craftCost: { wood: 6 }, maxDurability: 44, damage: 12, actionTicks: 20, wearPerHit: 1, rangePx: INTERACTION_RANGE_PX, baseDamageByTarget: { tree: 4, stone: 3, plant: 5, 'berry-bush': 5, raider: 12, creature: 12, structure: 6 }, wearMultiplierByTarget: { tree: 2, stone: 2, plant: 2, 'berry-bush': 2, raider: 1, creature: 1, structure: 2 }, repairBasisCost: { wood: 6 }, efficiencyAxes: ['break', 'uptime'] },
  { definitionId: 'stone-sword', displayName: 'Stone Sword', kind: 'sword', tier: 'stone', craftCost: { wood: 2, stone: 7 }, maxDurability: 90, damage: 18, actionTicks: 16, wearPerHit: 1, rangePx: INTERACTION_RANGE_PX, baseDamageByTarget: { tree: 6, stone: 5, plant: 8, 'berry-bush': 8, raider: 18, creature: 18, structure: 9 }, wearMultiplierByTarget: { tree: 2, stone: 2, plant: 2, 'berry-bush': 2, raider: 1, creature: 1, structure: 2 }, repairBasisCost: { wood: 2, stone: 7 }, efficiencyAxes: ['break', 'uptime'] },
  { definitionId: 'iron-sword', displayName: 'Iron Sword', kind: 'sword', tier: 'iron', craftCost: { wood: 2, 'iron-ingot': 5 }, maxDurability: 230, damage: 24, actionTicks: 12, wearPerHit: 1, rangePx: INTERACTION_RANGE_PX, baseDamageByTarget: { tree: 10, stone: 8, plant: 12, 'berry-bush': 12, raider: 24, creature: 24, structure: 12 }, wearMultiplierByTarget: { tree: 2, stone: 2, plant: 2, 'berry-bush': 2, raider: 1, creature: 1, structure: 2 }, repairBasisCost: { wood: 2, 'iron-ingot': 5 }, efficiencyAxes: ['break', 'uptime'] },
  // The Bow is a tool like everything else: it takes a bag slot, wears out, and
  // has to be held to be used. Its *shot* damage is deliberately not in this
  // table — a shot is fired, not swung, and stays `defense.playerShotDamage`,
  // the Admin dial already labelled "Bow damage" and shared with the arrow
  // presentation. Its *range*, though, is an ordinary tool Range: how far an
  // arrow reaches is a property of the bow, so it sits beside every other
  // weapon's reach rather than in a separate defense dial.
  // The raider row here is the desperate close-range bash, kept
  // feeble so a bow-in-hand player caught with no arrows is weak, not helpless.
  // It is also the one Stone recipe made in the hands: a bow is bent wood and
  // cord, and ranged play should not wait on a floored workbench.
  { definitionId: 'bow', displayName: 'Bow', kind: 'bow', tier: 'stone', handcraft: true, craftCost: { wood: 12, fiber: 6 }, maxDurability: 120, damage: 3, actionTicks: 24, wearPerHit: 1, rangePx: PLAYER_SHOT_RANGE_PX, baseDamageByTarget: { raider: 3, creature: 3 }, wearMultiplierByTarget: { raider: 1, creature: 1 }, repairBasisCost: { wood: 12, fiber: 6 }, efficiencyAxes: ['break', 'uptime'] },
  // Selene's shop-exclusive universal weapon. Its material cost is used only
  // for repairs; the staff itself is purchased with coins, never crafted.
  { definitionId: 'magic-staff', displayName: 'Magic Staff', kind: 'staff', shopService: 'magic-shop', tier: 'iron', craftCost: { wood: 2, 'iron-ingot': 5 }, maxDurability: 240, damage: 18, actionTicks: 14, wearPerHit: 1, rangePx: INTERACTION_RANGE_PX, baseDamageByTarget: { tree: 12, stone: 12, metal: 12, plant: 12, 'berry-bush': 12, raider: 18, creature: 18 }, wearMultiplierByTarget: { tree: 2, stone: 2, metal: 2, plant: 2, 'berry-bush': 2, raider: 1, creature: 1 }, repairBasisCost: { wood: 2, 'iron-ingot': 5 }, efficiencyAxes: ['break', 'uptime'] },
];

/**
 * The three grades above Iron, one per blueprint quality.
 *
 * Built from a table rather than fifteen hand-written rows: every variant is
 * the Iron recipe of its kind scaled by one multiplier set, so writing them out
 * longhand would be fifteen chances to mistype a damage figure and no clearer
 * for it. Each row is still an ordinary ToolDefinition afterwards, so the Admin
 * panel, the repair path, and the efficiency axes all see them as tools.
 *
 * These are the only recipes in the game with no route but a blueprint: no
 * level grants them, no shop sells them.
 */
const VARIANT_GRADES: readonly {
  quality: VariantToolQuality;
  label: string;
  /** Applied to the Iron row's damage and durability, in basis points. */
  powerBps: number;
  durabilityBps: number;
  /** Extra ingots on top of the Iron cost. */
  extraIngots: number;
}[] = [
  { quality: 'reinforced', label: 'Reinforced', powerBps: 12_500, durabilityBps: 15_000, extraIngots: 2 },
  { quality: 'masterwork', label: 'Masterwork', powerBps: 15_000, durabilityBps: 20_000, extraIngots: 5 },
  { quality: 'ancient', label: 'Ancient', powerBps: 20_000, durabilityBps: 30_000, extraIngots: 9 },
];

/** The Iron row each variant kind is scaled from; the Bow has no Iron tier. */
const VARIANT_BASE_BY_KIND: Readonly<Record<VariantToolKind, ToolDefinitionId>> = {
  axe: 'iron-axe',
  pick: 'iron-pick',
  sickle: 'iron-sickle',
  sword: 'iron-sword',
  bow: 'bow',
};

const VARIANT_TOOL_KINDS: readonly VariantToolKind[] = ['axe', 'pick', 'sickle', 'sword', 'bow'];

function scaleBps(value: number, bps: number): number {
  return Math.max(1, Math.round(value * bps / 10_000));
}

function variantToolDefinitions(): ToolRow[] {
  const definitions: ToolRow[] = [];
  for (const grade of VARIANT_GRADES) {
    for (const kind of VARIANT_TOOL_KINDS) {
      const baseId = VARIANT_BASE_BY_KIND[kind];
      const base = BASE_TOOL_DEFINITIONS.find((candidate) => candidate.definitionId === baseId)!;
      const craftCost = {
        ...base.craftCost,
        'iron-ingot': (base.craftCost['iron-ingot'] ?? 0) + grade.extraIngots,
      };
      // `handcraft` is stripped rather than set to undefined:
      // exactOptionalPropertyTypes treats an explicit undefined as a type error,
      // and an absent key is what "not a handcraft recipe" actually means.
      const { handcraft: _handcraft, ...withoutHandcraft } = base;
      definitions.push({
        ...withoutHandcraft,
        definitionId: `${grade.quality}-${kind}` as ToolDefinitionId,
        displayName: `${grade.label} ${base.displayName.split(' ').at(-1)}`,
        // Every variant is bench work, including the Bow, whose ordinary recipe
        // is handcraft. A tool this far above Iron should cost a trip to the
        // bench even when its plain version does not.
        tier: 'iron',
        craftCost,
        repairBasisCost: craftCost,
        maxDurability: scaleBps(base.maxDurability, grade.durabilityBps),
        damage: scaleBps(base.damage, grade.powerBps),
        baseDamageByTarget: Object.fromEntries(
          Object.entries(base.baseDamageByTarget).map(
            ([target, amount]) => [target, scaleBps(amount as number, grade.powerBps)],
          ),
        ) as ToolDefinition['baseDamageByTarget'],
      });
    }
  }
  return definitions;
}

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  ...BASE_TOOL_DEFINITIONS,
  ...variantToolDefinitions(),
].map((row) => ({ ...row, useCost: TOOL_USE_COST_BY_KIND[row.kind] }));

/** The variant grades in display order, for surfaces that group by them. */
export const VARIANT_TOOL_GRADES: readonly { quality: VariantToolQuality; label: string }[] =
  VARIANT_GRADES.map(({ quality, label }) => ({ quality, label }));

/** Which grade a tool belongs to, or null for the base Wooden/Stone/Iron rows. */
export function variantToolGrade(id: ToolDefinitionId): VariantToolQuality | null {
  const grade = VARIANT_GRADES.find((candidate) => id.startsWith(`${candidate.quality}-`));
  return grade?.quality ?? null;
}

/**
 * Whether a tool is made in the hands rather than at a workbench. Wooden tools
 * always are; above that only recipes that opt in with `handcraft`. Every
 * surface that sorts recipes between Handcraft and the workbench asks this.
 */
export function isHandcraftTool(definition: ToolDefinition): boolean {
  return definition.tier === 'wooden' || definition.handcraft === true;
}

/** Recipe-driven surfaces and quests must not expose shop-exclusive tools. */
export const CRAFTABLE_TOOL_DEFINITIONS: readonly ToolDefinition[] = TOOL_DEFINITIONS.filter(
  (definition) => definition.shopService === undefined,
);

/** Furnace queue/output bounds and the one processing recipe in this slice. */
export const FURNACE_QUEUE_CAPACITY = 4;
export const FURNACE_OUTPUT_CAPACITY = 1;
export const IRON_SMELT_WORK_MS = 5_000;
export const IRON_SMELT_INPUTS = { 'iron-ore': 2, wood: 1 } as const;

/**
 * Snare taming (spec formula, fixed-point basis points):
 *   chance = clamp(speciesEase × snareTier × (1.5 − hpPercent), 0.05, 0.90)
 */
export const TAMING_SNARE_TIER_BPS = 10_000; // basic snare = 1.0×
export const REINFORCED_SNARE_TIER_BPS = 16_000; // trophy snare = 1.6×
export const SNARE_CHANCE_MIN_BPS = 500;
export const SNARE_CHANCE_MAX_BPS = 9_000;

/**
 * Taming session. A landed snare captures but does not tame: it opens a short
 * session of `beats`, during which the player nudges the creature's Calm up and
 * its Fear down. Every session yields the creature — what the player is playing
 * for is its disposition, not its capture.
 *
 * All values are basis points or whole beats. `canonicalizeGameState` throws on
 * non-integer numbers, so nothing here may ever become fractional.
 */
export const TAMING_BEATS_BASIC = 4;
export const TAMING_BEATS_REINFORCED = 6;

/** Calm/Fear the session opens on, before the first mood drift. */
export const TAMING_START_CALM_BPS = 2_000;
export const TAMING_START_FEAR_BPS = 3_000;

/**
 * The success band drawn on the meter. Landing inside it at beat exhaustion
 * tames properly; reaching the top edge early ends the session with beats to
 * spare, which is the only route to `eager`.
 */
export const TAMING_BAND_LOW_BPS = 5_000;
export const TAMING_BAND_HIGH_BPS = 8_500;
/** The Reinforced Snare lowers the band's floor as well as buying beats. */
export const TAMING_BAND_WIDEN_BPS = 1_000;

/**
 * Peak Fear at or above this grades the tame `wary` no matter how it finished.
 * This is the whole tension of the mechanic: Approach is the fastest way to the
 * band and the fastest way past this line.
 */
export const TAMING_WARY_FEAR_BPS = 7_000;

/**
 * Fear at or above this ends the session immediately as `broken` � the creature
 * is past calming. This is what stops Approach-spam from being a free dominant
 * line: without it, mashing the biggest Calm gain never actually fails, and
 * Back off has no reason to exist.
 */
export const TAMING_FEAR_BREAK_BPS = 9_500;

/** Per-action effect on the two meters. Positive fear is worse for the player. */
export const TAMING_ACTION_EFFECTS = {
  steady: { calmBps: 900, fearBps: -200 },
  /** Both figures are the tense-mood case; a calm creature uses the constants below. */
  approach: { calmBps: 1_000, fearBps: 1_400 },
  offer: { calmBps: 1_400, fearBps: -1_600 },
  'back-off': { calmBps: -400, fearBps: -2_400 },
} as const;

/**
 * Approach against a creature that is *not* tense. This is the whole reward for
 * reading the telegraph: closing on a settled animal is the single strongest
 * move in the session, and closing on a straining one is among the worst. The
 * tell has to change both axes or the read is not worth making.
 */
export const TAMING_APPROACH_CALM_CALM_BPS = 2_600;
export const TAMING_APPROACH_CALM_FEAR_BPS = 200;

/** Berries spent per Offer. */
export const TAMING_OFFER_BERRY_COST = 1;

/**
 * Drift applied at the top of each beat by the telegraphed mood. `tense` moods
 * are the ones that make Approach expensive, and the label is the player's only
 * warning — see `tamingMoodLabel`.
 */
export const TAMING_MOOD_DRIFT = {
  settling: { calmBps: 400, fearBps: -300, tense: false },
  watching: { calmBps: -200, fearBps: 100, tense: false },
  straining: { calmBps: -600, fearBps: 500, tense: true },
  panicking: { calmBps: -1_200, fearBps: 1_000, tense: true },
} as const;

/**
 * Mood weights per species temperament, before the Fear skew. A skittish
 * creature spends most of the session tense; a passive one hands the player
 * openings. Weights are relative and need not sum to anything.
 */
export const TAMING_MOOD_WEIGHTS = {
  passive: { settling: 40, watching: 35, straining: 20, panicking: 5 },
  neutral: { settling: 25, watching: 35, straining: 30, panicking: 10 },
  skittish: { settling: 15, watching: 25, straining: 40, panicking: 20 },
  aggressive: { settling: 15, watching: 30, straining: 35, panicking: 20 },
} as const;

/**
 * How hard current Fear skews the mood roll toward the tense moods, in bps of
 * the fear meter. Fear is not just a lose condition — it feeds back into how
 * hard the creature is to read, which is what makes a fear spiral recoverable
 * only by spending beats on Back off.
 */
export const TAMING_FEAR_SKEW_BPS = 6_000;

/** Eat Berry restores this share of max HP (capped at full health). */
export const BERRY_HEAL_BPS = 3_000;

/** Capped forward-only offline settlement window for respawns and growers. */
export const OFFLINE_CAP_MS = 8 * 60 * 60 * 1_000;

export function toolDefinition(id: ToolDefinitionId): ToolDefinition {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.definitionId === id);
  if (!definition) throw new Error(`unknown tool ${id}`);
  return definition;
}

const GATHERABLE_RESOURCE_IDS: readonly GatherableResourceId[] = ['wood', 'stone', 'fiber', 'iron-ore', 'iron-ingot'];
export const RESOURCE_NODE_KINDS: readonly ResourceNodeKind[] = ['tree', 'stone', 'metal', 'plant', 'berry-bush'];
/**
 * Every region theme in one stable order: town first, then outward by how
 * unpleasant the ground is to work. Used by the Admin panel's per-region rows
 * and by balance validation, both of which need the list to be enumerable
 * rather than only inhabitable.
 */
export const AREA_THEME_IDS: readonly AreaThemeId[] = [
  'elaris', 'meadow', 'forest', 'thicket', 'mountain', 'marsh',
];
/**
 * Stable order for every strike target, used by save defaults, the Admin panel,
 * and save validation. Node kinds come first so existing rows keep their place.
 */
export const STRIKE_TARGETS: readonly StrikeTarget[] = [...RESOURCE_NODE_KINDS, 'raider', 'creature', 'structure'];

/** Convert immutable shipped defaults into the authoritative save-backed shape. */
export function createDefaultGameBalance(): GameBalanceState {
  const zeroResources = (): Record<GatherableResourceId, number> => Object.fromEntries(
    GATHERABLE_RESOURCE_IDS.map((resource) => [resource, 0]),
  ) as Record<GatherableResourceId, number>;
  const zeroTargets = (): Record<StrikeTarget, number> => Object.fromEntries(
    STRIKE_TARGETS.map((target) => [target, 0]),
  ) as Record<StrikeTarget, number>;
  const tools = Object.fromEntries(TOOL_DEFINITIONS.map((definition) => {
    const craftCost = zeroResources();
    for (const [resource, amount] of Object.entries(definition.craftCost) as Array<[GatherableResourceId, number]>) {
      craftCost[resource] = amount;
    }
    const damageByTarget = zeroTargets();
    const wearMultiplierByTarget = zeroTargets();
    for (const target of STRIKE_TARGETS) {
      damageByTarget[target] = definition.baseDamageByTarget[target] ?? 0;
      wearMultiplierByTarget[target] = definition.wearMultiplierByTarget[target] ?? 0;
    }
    return [definition.definitionId, {
      craftCost,
      maxDurability: definition.maxDurability,
      actionTicks: definition.actionTicks,
      wearPerHit: definition.wearPerHit,
      rangePx: definition.rangePx,
      damageByTarget,
      wearMultiplierByTarget,
    }];
  })) as GameBalanceState['tools'];
  const handDamage = zeroTargets();
  for (const target of STRIKE_TARGETS) handDamage[target] = HANDS_DAMAGE_BY_TARGET[target] ?? 0;
  return {
    characterDefaults: {
      startingHp: 100,
      startingStamina: 100,
      startingMana: 30,
      startingAttributePoints: 0,
      hpRegenBaseHundredths: 0,
      staminaRegenBaseHundredths: 5 * 100,
      manaRegenBaseHundredths: 2 * 100,
      walkSpeed: PLAYER_SPEED_PX_PER_S,
      sprintSpeedTenths: SPRINT_SPEED_TENTHS,
      sprintStaminaPerSecond: SPRINT_STAMINA_PER_SECOND,
    },
    attributeGains: {
      strengthMeleeDamage: 2,
      strengthGatherDamage: 1,
      dexterityRangedDamage: 2,
      magicDamage: 2,
      luckHitChanceBps: 100,
      luckHitChanceMaxBps: 1_500,
      luckDodgeChanceBps: 150,
      luckDodgeChanceMaxBps: 2_000,
      luckTamingChanceBps: 250,
      luckTamingChanceMaxBps: 2_500,
      luckDoubleDropChanceBps: 250,
      luckDoubleDropChanceMaxBps: 2_500,
      speedWalkPxPerSecond: 10,
      speedBattleTiles: 1,
      speedBattleTilesMax: 10,
      healthMaxHp: 10,
      healthRegenHundredths: REGEN_PER_POINT_HUNDREDTHS,
      staminaMaxStamina: 10,
      staminaRegenHundredths: REGEN_PER_POINT_HUNDREDTHS,
      carryWeightHundredths: CARRY_WEIGHT_CAPACITY_HUNDREDTHS,
      manaMaxMana: 10,
      manaRegenHundredths: REGEN_PER_POINT_HUNDREDTHS,
    },
    levelUp: {
      attributePointsPerStat: 1,
      spendableAttributePoints: 2,
      coins: 0,
    },
    bagWeight: {
      capacityHundredths: DEFAULT_BAG_CAPACITY_HUNDREDTHS,
      itemHundredths: { ...DEFAULT_ITEM_WEIGHT_HUNDREDTHS },
    },
    camera: { ...ELARIS_CAMERA_DEFAULT_TENTHS },
    hands: { actionTicks: HANDS_ACTION_TICKS, rangePx: INTERACTION_RANGE_PX, damageByTarget: handDamage },
    objects: structuredClone(RESOURCE_BALANCE),
    tools,
    raiders: Object.fromEntries(RAIDER_DEFINITIONS.map((definition) => [definition.kindId, {
      maxHp: definition.maxHp,
      speedPxPerTick: definition.speedPxPerTick,
      damage: definition.damage,
      playerDamage: definition.playerDamage,
      attackCooldownTicks: definition.attackCooldownTicks,
      wallDamagePercent: definition.wallDamagePercent,
      unlockCycle: definition.unlockCycle,
      aggroRangePx: definition.aggroRangePx,
      levelMultiplierBps: definition.levelMultiplierBps,
    }])) as GameBalanceState['raiders'],
    raid: {
      safePhaseSeconds: SAFE_PHASE_SECONDS,
      dangerPhaseSecondsByThreat: { ...DANGER_PHASE_SECONDS_BY_THREAT },
      spawnDelaySeconds: RAID_SPAWN_DELAY_SECONDS,
      graceSeconds: DANGER_GRACE_SECONDS,
      exposureDamagePerSecond: DANGER_EXPOSURE_DAMAGE_PER_SECOND,
      exposureRampPerSecond: DANGER_EXPOSURE_RAMP_PER_SECOND,
      exposureMaxDamagePerSecond: DANGER_EXPOSURE_MAX_DAMAGE_PER_SECOND,
      waveBaseSize: RAID_WAVE_BASE_SIZE,
      waveMaxSize: RAID_WAVE_MAX_SIZE,
      waveGrowthTenths: RAID_WAVE_GROWTH_TENTHS,
      waveRatingTenths: RAID_WAVE_RATING_TENTHS,
      targetPriority: RAID_TARGET_PRIORITY,
    },
    storm: { ...ARCANE_STORM_BALANCE },
    defense: {
      turretDamage: TURRET_DAMAGE,
      turretCooldownTicks: TURRET_FIRE_COOLDOWN_TICKS,
      turretRangeTiles: TURRET_RANGE_TILES,
      turretAmmoCapacity: TURRET_AMMO_CAPACITY,
      turretAbsentRoundShots: TURRET_ABSENT_ROUND_SHOTS,
      playerShotDamage: PLAYER_SHOT_DAMAGE,
      playerShotCooldownTicks: PLAYER_SHOT_COOLDOWN_TICKS,
      raiderAggroRangeTiles: RAIDER_AGGRO_RANGE_TILES,
      roamerLeashTiles: ROAMER_LEASH_TILES,
      roamersPerArea: ROAMERS_PER_AREA,
      roamerRespawnTicks: ROAMER_RESPAWN_TICKS,
    },
    structures: {
      wallHp: { ...WALL_MAX_HP },
      facilityHp: Object.fromEntries(STRUCTURE_FACILITY_IDS.map(
        (id) => [id, FACILITY_MAX_HP[id] ?? 0],
      )) as GameBalanceState['structures']['facilityHp'],
    },
    creatures: Object.fromEntries(CREATURE_DEFINITIONS.map((definition) => [definition.speciesId, {
      maxHp: definition.encounter.maxHp,
      attackPower: definition.encounter.attackPower,
      defense: definition.encounter.defense,
      tameEaseBps: definition.encounter.tameEaseBps,
      dodgeBps: definition.encounter.dodgeBps,
      moveSpeed: definition.encounter.moveSpeed,
      attackRange: definition.encounter.attackRange,
      speedPxPerTick: definition.encounter.speedPxPerTick,
      attackRangePx: definition.encounter.attackRangePx,
      attackIntervalTicks: definition.encounter.attackIntervalTicks,
      aggroRangePx: definition.encounter.aggroRangePx,
      leashPx: definition.encounter.leashPx,
      preferredRangePx: definition.encounter.preferredRangePx,
      levelMultiplierBps: definition.encounter.levelMultiplierBps,
    }])) as GameBalanceState['creatures'],
    world: { ...DEFAULT_WORLD_BALANCE },
    blueprints: structuredClone(BLUEPRINT_BALANCE) as GameBalanceState['blueprints'],
  };
}

/** Immutable raider identity plus the save-backed numbers the Admin panel edits. */
export function gameRaiderDefinition(state: GameState, kindId: RaiderKindId): RaiderDefinition {
  const shipped = raiderDefinition(kindId);
  const editable = state.gameBalance.raiders[kindId];
  return { ...shipped, ...editable };
}

/** Immutable creature identity plus the save-backed battle numbers. */
export function gameCreatureDefinition(state: GameState, speciesId: SpeciesId): CreatureDefinition {
  const shipped = creatureDefinition(speciesId);
  return { ...shipped, encounter: { ...shipped.encounter, ...state.gameBalance.creatures[speciesId] } };
}

/**
 * The save-backed definition with this individual's level applied.
 *
 * Only health and the damage numbers move. Speed, aggro range, leash, tame
 * ease, and dodge stay at base on purpose: a levelled enemy should be a longer,
 * costlier fight, never one the player is less able to walk away from or less
 * able to tame. That distinction is what keeps a level 6 creature a decision
 * rather than a wall.
 */
export function leveledCreatureDefinition(
  state: GameState,
  creature: Pick<WildCreatureState, 'speciesId' | 'level'>,
): CreatureDefinition {
  const base = gameCreatureDefinition(state, creature.speciesId);
  const level = Math.max(1, creature.level);
  if (level === 1) return base;
  const bps = base.encounter.levelMultiplierBps;
  return {
    ...base,
    encounter: {
      ...base.encounter,
      maxHp: scaleByLevel(base.encounter.maxHp, level, bps),
      attackPower: scaleByLevel(base.encounter.attackPower, level, bps),
      defense: scaleByLevel(base.encounter.defense, level, bps),
    },
  };
}

/** The save-backed raider definition with this individual's level applied. */
export function leveledRaiderDefinition(
  state: GameState,
  raider: Pick<RaiderState, 'kindId' | 'level'>,
): RaiderDefinition {
  const base = gameRaiderDefinition(state, raider.kindId);
  const level = Math.max(1, raider.level);
  if (level === 1) return base;
  const bps = base.levelMultiplierBps;
  return {
    ...base,
    maxHp: scaleByLevel(base.maxHp, level, bps),
    damage: scaleByLevel(base.damage, level, bps),
    playerDamage: scaleByLevel(base.playerDamage, level, bps),
  };
}

/** Immutable identity/content plus save-backed gameplay numbers. */
export function gameToolDefinition(state: GameState, id: ToolDefinitionId): ToolDefinition {
  const shipped = toolDefinition(id);
  const editable = state.gameBalance.tools[id];
  // Every strike target, not just resource nodes: dropping 'raider' and
  // 'structure' here would silently zero a tool's combat and wall rows the
  // moment the definition was read back through save-backed balance.
  const baseDamageByTarget = Object.fromEntries(STRIKE_TARGETS
    .filter((target) => editable.damageByTarget[target] > 0)
    .map((target) => [target, editable.damageByTarget[target]])) as Partial<Record<StrikeTarget, number>>;
  const wearMultiplierByTarget = Object.fromEntries(STRIKE_TARGETS
    .filter((target) => editable.damageByTarget[target] > 0)
    .map((target) => [target, editable.wearMultiplierByTarget[target]])) as Partial<Record<StrikeTarget, number>>;
  const craftCost = Object.fromEntries(GATHERABLE_RESOURCE_IDS
    .filter((resource) => editable.craftCost[resource] > 0)
    .map((resource) => [resource, editable.craftCost[resource]])) as Partial<Record<GatherableResourceId, number>>;
  return {
    ...shipped,
    craftCost,
    repairBasisCost: craftCost,
    maxDurability: editable.maxDurability,
    damage: Math.max(...Object.values(baseDamageByTarget), 0),
    actionTicks: editable.actionTicks,
    wearPerHit: editable.wearPerHit,
    rangePx: editable.rangePx,
    baseDamageByTarget,
    wearMultiplierByTarget,
  };
}

/** Compatibility export retained for existing callers and saves/tests. */
export const WOODEN_PICK = {
  ...toolDefinition('wooden-pick'),
  woodCost: toolDefinition('wooden-pick').craftCost.wood!,
  stoneDamage: toolDefinition('wooden-pick').damage,
} as const;
