import type { ResourceId, SpeciesId } from '../simulation/state';
import type { NonEmptyEfficiencyAxes } from './efficiency';
import type { UnlockRequirement } from '../simulation/unlocks';

export type ToolUpgradeAxis = 'power' | 'speed' | 'durability';

/** Fixed prices: no rotating stock, randomness, or clock-based pricing. */
export const SELL_PRICES: Readonly<Record<ResourceId, number>> = {
  wood: 2,
  stone: 3,
  fiber: 1,
  'iron-ore': 5,
  'iron-ingot': 12,
  'taming-snare': 4,
  'reinforced-snare': 20,
  berry: 1,
  arrow: 2,
  'cloth-mask': 3,
  // Elowen's charm resells poorly on purpose: it is insurance, not a commodity
  // to be bought from the Church and flipped at the Market for profit.
  'safeguard-charm': 40,
  // The most valuable thing a player can sell. Parchment only ever comes from
  // a blueprint someone chose to destroy, so its price is really the price of
  // that decision — and it has to stay worth more than the coins, or nobody
  // would ever feed the drafting table with it.
  'draft-parchment': 250,
  // Trophies are Tavi's premium line and the reason a hunting trip pays. Priced
  // well above any gathered stack so combat is a real income source rather than
  // a tax on the way to a resource node.
  'tuftle-down': 18,
  'craghopper-shell': 30,
  'stag-antler': 26,
  'snarlfox-pelt': 34,
  // The homestead-defence roster lives further out and hits harder, so its
  // trophies are Tavi's top shelf. The Slingtail Stone is the outlier on
  // purpose: it is heavy enough that hauling a bagful is a real decision.
  'masonmole-claw': 44,
  'boar-tusk': 52,
  'quillfinch-quill': 38,
  'mistmoth-scale': 60,
  'slingtail-stone': 46,
  // Salvage sells, but poorly next to what it builds: the price is a floor for
  // a full bag, not the reason to go out. The three zero-priced items are
  // quest and key items that `sellResource` refuses outright.
  'scrap-iron': 4,
  clockwork: 12,
  lens: 14,
  'arcane-dust': 10,
  'construct-core': 60,
  'ancient-alloy': 90,
  'sealed-satchel': 0,
  'vault-key': 0,
  'recall-flare': 0,
};

/**
 * Ranks 1–2 are the original apprentice work. Ranks 3–4 are Mara's Master
 * Tempering: steeply priced and gated behind a much higher Homestead Rating, so
 * they are a late-game coin sink rather than an early power spike.
 */
export const BLACKSMITH_UPGRADE_COSTS = [30, 70, 320, 900] as const;

/**
 * Tempering at your own Workbench: the same four ranks Mara sells for coins,
 * bought instead with salvage. Index 0 is rank 1. The bench's level caps the
 * rank (see WORKBENCH_MAX_TEMPER_RANK_BY_LEVEL).
 */
export const TEMPER_COSTS: readonly [
  Readonly<Partial<Record<ResourceId, number>>>, Readonly<Partial<Record<ResourceId, number>>>,
  Readonly<Partial<Record<ResourceId, number>>>, Readonly<Partial<Record<ResourceId, number>>>,
] = [
  { 'scrap-iron': 4 },
  { 'scrap-iron': 8, clockwork: 2 },
  { clockwork: 6, lens: 2 },
  { 'construct-core': 1, 'ancient-alloy': 1 },
];

/**
 * Scrap Iron returned for breaking a tool down at a Workbench, at full
 * durability; scaled by what durability remains. Wooden tools return nothing
 * and cannot be scrapped.
 */
export const TOOL_SCRAP_IRON = { stone: 1, iron: 2, reinforced: 4, masterwork: 6, ancient: 8 } as const;

export const FARM_ORDER_COSTS: Readonly<Record<SpeciesId, number>> = {
  tuftle: 120,
  craghopper: 180,
  'glade-stag': 240,
  snarlfox: 220,
  masonmole: 320,
  'bulwark-boar': 400,
  quillfinch: 300,
  mistmoth: 460,
  slingtail: 340,
};

/** Every town trainer charges the same deterministic price for one attribute increase. */
export const SKILL_POINT_COST = 100;
export const MAGIC_STAFF_COST = 3_000;

export const TOOL_POWER_PER_RANK = 3;
export const TOOL_SPEED_BPS_PER_RANK = 1_000;
export const TOOL_DURABILITY_BPS_PER_RANK = 2_500;
export const WORLD_BLACKSMITH_MAX_RANK = 4;

export const BLACKSMITH_RATING_BY_RANK = { 1: 100, 2: 500, 3: 2_000, 4: 6_000 } as const;
export const FARM_ORDER_RATING = 250;

export interface ContractDefinition {
  id: string;
  requirement: UnlockRequirement;
  efficiencyAxes: NonEmptyEfficiencyAxes;
}

export const BLACKSMITH_CONTRACTS: readonly (ContractDefinition & { axis: ToolUpgradeAxis; rank: 1 | 2 | 3 | 4 })[] = (
  (['power', 'speed', 'durability'] as const).flatMap((axis) => ([1, 2, 3, 4] as const).map((rank) => ({
    id: `blacksmith-${axis}-${rank}`,
    axis,
    rank,
    requirement: { allOf: [{ kind: 'highestRatingEver' as const, atLeast: BLACKSMITH_RATING_BY_RANK[rank] }] },
    efficiencyAxes: axis === 'power' || axis === 'speed' ? ['break'] as const : ['uptime'] as const,
  })))
);

/**
 * The bottleneck each species' farm order buys down. Kept as a table rather
 * than a ternary chain: with nine species the chain silently filed every new
 * one under the fallback axis, which is exactly the mislabelling content
 * validation exists to catch.
 */
const FARM_ORDER_AXES: Readonly<Record<SpeciesId, NonEmptyEfficiencyAxes>> = {
  tuftle: ['yield'],
  craghopper: ['break'],
  'glade-stag': ['travel'],
  snarlfox: ['safety'],
  // Every homestead-defence species buys down uptime — a base that survives the
  // night is a base still producing in the morning — except the Mistmoth, whose
  // purified square is squarely a safety purchase.
  masonmole: ['uptime'],
  'bulwark-boar': ['safety', 'uptime'],
  quillfinch: ['uptime'],
  mistmoth: ['safety'],
  slingtail: ['safety', 'uptime'],
};

export const FARM_ORDER_CONTRACTS: readonly (ContractDefinition & { speciesId: SpeciesId })[] = (
  (Object.keys(FARM_ORDER_AXES) as SpeciesId[]).map((speciesId) => ({
    id: `farm-order-${speciesId}`,
    speciesId,
    requirement: { allOf: [
      { kind: 'firstTamedSpecies' as const, speciesId },
      { kind: 'highestRatingEver' as const, atLeast: FARM_ORDER_RATING },
    ] },
    efficiencyAxes: FARM_ORDER_AXES[speciesId],
  }))
);
