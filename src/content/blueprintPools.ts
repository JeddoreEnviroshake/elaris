import { CREATURE_DEFINITIONS, creatureDefinition } from './creatures';
import { blueprintQuality, type BlueprintQuality } from './blueprintQuality';
import { BLUEPRINT_ITEM_IDS, isBlueprintItemId } from '../simulation/blueprintKnowledge';
import type { AreaThemeId, SpeciesId } from '../simulation/state';

/**
 * Which blueprints each source is allowed to hand over.
 *
 * A drop used to be drawn from every blueprint the player did not know, which
 * made every source the same source: a meadow berry bush and a marsh raider
 * were two skins on one loot table. Scoping the pools is what gives a map, a
 * raider and a species something of their own to be worth visiting for.
 *
 * Pools overlap on purpose. Two regions both offering the Field Cache is not a
 * bug — it means a player who never crosses the marsh still gets there, slower.
 * What no two pools share is their *shape*: the marsh is the only place the
 * variant tools come from, and the storm is the only routine legendary.
 */

/**
 * The Ancient tool set is reserved for caves, which do not exist yet.
 *
 * Deliberately unobtainable rather than deleted: the recipes are real, the
 * Blueprints tab lists them, and the day caves ship they have a home to come
 * from. Excluded from every pool below by construction, so no future pool edit
 * can leak one by naming a prefix.
 */
export const CAVE_RESERVED_BLUEPRINT_IDS: ReadonlySet<string> = new Set(
  BLUEPRINT_ITEM_IDS.filter((id) => id.startsWith('ancient-')),
);

/** Ids with a given prefix, which keeps a whole material tier to one line. */
function tier(prefix: string): readonly string[] {
  return BLUEPRINT_ITEM_IDS.filter((id) => id.startsWith(prefix));
}

/**
 * Drop the reserved ids and anything misspelled. Pools are hand-written lists,
 * and a typo in one would otherwise become a blueprint that can never drop and
 * a counter that pays nothing.
 */
function pool(...ids: ReadonlyArray<string | readonly string[]>): readonly string[] {
  const flat = ids.flatMap((entry) => (typeof entry === 'string' ? [entry] : entry));
  const kept = flat.filter((id) => isBlueprintItemId(id) && !CAVE_RESERVED_BLUEPRINT_IDS.has(id));
  // Sorted so any roll over a pool is reproducible across clients regardless of
  // the order someone happened to type the ids in.
  return [...new Set(kept)].sort();
}

/**
 * What each region owns.
 *
 * Elaris is absent: the town is barren by design, and a player must never learn
 * that the safest ground is where the blueprints are.
 */
export const THEME_BLUEPRINT_POOLS: Readonly<Partial<Record<AreaThemeId, readonly string[]>>> = {
  // The starter region teaches the starter kit — thatch, the first tools, and
  // the two consumables a first danger phase asks for.
  meadow: pool(
    tier('thatch-'), 'wooden-axe', 'wooden-pick', 'wooden-sickle', 'wooden-sword',
    'arrow', 'cloth-mask', 'taming-snare', 'garden-bed', 'field-cache',
  ),
  // Forest is the homestead: the wood tier plus everything that makes a camp a
  // base you come back to.
  forest: pool(
    tier('wood-'), 'woodlot-planter', 'farm-counter', 'field-cache', 'bed',
    'small-pen', 'workbench',
  ),
  // Thicket is where creatures live, so it owns the gear for keeping them.
  thicket: pool(
    'taming-snare', 'reinforced-snare', 'small-pen', 'barn', 'bow', 'arrow',
    'wooden-sickle', 'stone-sickle', 'garden-bed',
  ),
  // Mountain is masonry and metal: the two hardest tiers and the yards that
  // process them.
  mountain: pool(
    tier('stone-'), tier('metal-'), tier('iron-'), 'furnace', 'cart-dock',
  ),
  // Marsh is the reward at the end of the worst commute in the game — the only
  // routine source of the variant tools.
  marsh: pool(
    tier('reinforced-'), tier('masterwork-'), 'air-purifier', 'water',
    'wood-bridge', 'stone-bridge', 'rowboat',
  ),
};

/**
 * Raiders drop what they came with: weapons, and the answers to a wave. They
 * are also the one source that is not tied to a region, which is what makes a
 * danger night worth standing outside for wherever the player has settled.
 */
export const RAIDER_BLUEPRINT_POOL: readonly string[] = pool(
  tier('metal-'), 'war-table', 'turret', 'bow', 'arrow',
  'wooden-sword', 'stone-sword', 'iron-sword',
  'reinforced-sword', 'reinforced-bow', 'masterwork-sword', 'masterwork-bow',
);

/**
 * Arcane storm caches. The storm night has nothing to fight, so its reward is
 * the only routine route to a Legendary — the reason to be outside in it.
 */
export const STORM_CACHE_BLUEPRINT_POOL: readonly string[] = pool(
  'warehouse', 'logistics-hub', tier('masterwork-'), 'air-purifier', 'war-table',
  'turret', 'stone-yard', 'cart-dock', 'barn', 'rowboat', 'field-cache', 'stone-bridge',
);

/**
 * What a site's strongbox may carry: the workshop and haulage pieces a base
 * needs once it starts spending salvage. Capped at Rare by the source ceiling.
 */
export const SITE_BLUEPRINT_POOL: readonly string[] = pool(
  'workbench', 'furnace', 'cart-dock', 'warehouse', 'logistics-hub', 'stone-yard',
  'field-cache', 'turret', 'air-purifier', tier('reinforced-'),
);

/**
 * A species drops the blueprints for the utilities it can work at.
 *
 * Derived from the species' own `work.eligibleWorksites` rather than tabled
 * here, so a new creature joins the drop system by existing and can never
 * disagree with the panel that assigns it a worksite. A species with no work
 * role drops nothing, which is the honest answer: there is no utility to pair
 * it with.
 */
export function creatureBlueprintPool(speciesId: SpeciesId): readonly string[] {
  const work = creatureDefinition(speciesId).work;
  return work ? pool(work.eligibleWorksites) : [];
}

/** Every species that can drop anything, for tests and the Admin panel. */
export const BLUEPRINT_DROPPING_SPECIES: readonly SpeciesId[] = CREATURE_DEFINITIONS
  .filter((definition) => creatureBlueprintPool(definition.speciesId).length > 0)
  .map((definition) => definition.speciesId);

/**
 * The best tier a source may hand over. This is the whole "later blueprints are
 * found later" rule in one table: gathering never produces an Epic, however
 * long you gather, because the answer to wanting one is to go somewhere
 * dangerous rather than to keep swinging.
 */
export type BlueprintSourceKind = 'node' | 'raider' | 'creature' | 'storm-cache' | 'cellar' | 'site';

export const SOURCE_QUALITY_CEILING: Readonly<Record<BlueprintSourceKind, BlueprintQuality>> = {
  node: 'rare',
  raider: 'epic',
  creature: 'epic',
  'storm-cache': 'legendary',
  // The one deliberately unthemed source. A Collapsed Cellar is the reward for
  // exploring rather than for surviving anything, so it draws from everything
  // below Legendary instead of owning a slice — which is also what keeps a
  // player who never fights a raider from being locked out of the metal tier.
  cellar: 'epic',
  // A strongbox is the reward for a run, not for surviving a storm: it can hand
  // over a Rare but never an Epic, which stays with raiders and creatures.
  site: 'rare',
};

const QUALITY_RANK: Readonly<Record<BlueprintQuality, number>> = {
  common: 0, rare: 1, epic: 2, legendary: 3,
};

/** Whether a blueprint is at or below a ceiling. */
export function withinCeiling(id: string, ceiling: BlueprintQuality): boolean {
  return QUALITY_RANK[blueprintQuality(id)] <= QUALITY_RANK[ceiling];
}

/** Every blueprint a source could ever produce, ceiling included. */
export function sourceBlueprintPool(
  kind: BlueprintSourceKind,
  context: { theme?: AreaThemeId; speciesId?: SpeciesId } = {},
): readonly string[] {
  const base = kind === 'node'
    ? (context.theme ? THEME_BLUEPRINT_POOLS[context.theme] ?? [] : [])
    : kind === 'raider'
      ? RAIDER_BLUEPRINT_POOL
      : kind === 'creature'
        ? (context.speciesId ? creatureBlueprintPool(context.speciesId) : [])
        : kind === 'storm-cache'
          ? STORM_CACHE_BLUEPRINT_POOL
          : kind === 'site'
          ? SITE_BLUEPRINT_POOL
          // The cellar's pool *is* its ceiling — see SOURCE_QUALITY_CEILING.
          : ceilingBlueprintPool('cellar');
  return base.filter((id) => withinCeiling(id, SOURCE_QUALITY_CEILING[kind]));
}

/**
 * Everything a source may fall back to once its own pool is exhausted: any
 * blueprint at or below its ceiling. Keeps a finished region paying out
 * something the player still wants without letting a berry bush ever produce
 * what only a storm is supposed to.
 */
export function ceilingBlueprintPool(kind: BlueprintSourceKind): readonly string[] {
  return BLUEPRINT_ITEM_IDS
    .filter((id) => !CAVE_RESERVED_BLUEPRINT_IDS.has(id) && withinCeiling(id, SOURCE_QUALITY_CEILING[kind]))
    .slice()
    .sort();
}
