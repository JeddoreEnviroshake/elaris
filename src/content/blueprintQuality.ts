import { BLUEPRINT_ITEM_IDS, type BlueprintItemId } from '../simulation/blueprintKnowledge';

/**
 * How rare a blueprint is.
 *
 * Quality exists so the drafting table's weighting is legible. "Lower quality
 * is more common" is invisible to a player unless the thing carries a stated
 * tier, and a Legendary pull should read as different from a Common one the
 * moment it lands rather than after they look the recipe up.
 *
 * Deliberately scoped to blueprints. Putting a tier on every item in the game
 * would touch every tooltip and icon for no mechanical gain; here it drives an
 * actual roll.
 */
export type BlueprintQuality = 'common' | 'rare' | 'epic' | 'legendary';

export const BLUEPRINT_QUALITIES: readonly BlueprintQuality[] = [
  'common', 'rare', 'epic', 'legendary',
];

export const BLUEPRINT_QUALITY_LABELS: Readonly<Record<BlueprintQuality, string>> = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

/** Tier colours, reused by the Blueprints tab and any future item chrome. */
export const BLUEPRINT_QUALITY_COLORS: Readonly<Record<BlueprintQuality, string>> = {
  common: '#c8d6cb',
  rare: '#7fb4e3',
  epic: '#c08ce0',
  legendary: '#f0b957',
};

/**
 * Relative weight of each tier when the drafting table rolls.
 *
 * Weights are per *tier*, not per blueprint, so adding a dozen Common recipes
 * never quietly drowns out the Legendary pool — a tier's share of the roll is
 * fixed and the members split it evenly.
 */
export const BLUEPRINT_QUALITY_WEIGHTS: Readonly<Record<BlueprintQuality, number>> = {
  common: 50,
  rare: 30,
  epic: 15,
  legendary: 5,
};

/**
 * Explicit tiers. Anything unlisted falls to `common`, which is the safe
 * default: a new recipe someone forgets to tier shows up too often rather than
 * becoming an accidental Legendary nobody can find.
 */
const QUALITY_BY_ID: Readonly<Partial<Record<BlueprintItemId, BlueprintQuality>>> = {
  // Rare — the stone tier and the homestead facilities that make a base a base.
  'stone-floor': 'rare', 'stone-ground': 'rare', 'stone-wall': 'rare',
  'stone-door': 'rare', 'stone-fence': 'rare', 'stone-gate': 'rare',
  'stone-axe': 'rare', 'stone-pick': 'rare', 'stone-sickle': 'rare', 'stone-sword': 'rare',
  'stone-bridge': 'rare', 'wood-bridge': 'rare',
  furnace: 'rare', 'farm-counter': 'rare', 'small-pen': 'rare', 'garden-bed': 'rare',
  'woodlot-planter': 'rare', 'field-cache': 'rare', bed: 'rare', rowboat: 'rare',

  // Epic — the metal tier, and the facilities that only matter to a base that
  // has already survived something.
  'metal-floor': 'epic', 'metal-ground': 'epic', 'metal-wall': 'epic',
  'metal-door': 'epic', 'metal-fence': 'epic', 'metal-gate': 'epic',
  'iron-axe': 'epic', 'iron-pick': 'epic', 'iron-sickle': 'epic', 'iron-sword': 'epic',
  barn: 'epic', 'stone-yard': 'epic', 'cart-dock': 'epic', 'war-table': 'epic',
  turret: 'epic', 'air-purifier': 'epic', 'reinforced-snare': 'epic',

  // Legendary — the logistics endgame and the two things that answer a siege.
  warehouse: 'legendary', 'logistics-hub': 'legendary',

  // The variant tools carry their grade as their tier: one whole tool set per
  // quality above Iron, findable only as blueprints.
  'reinforced-axe': 'rare', 'reinforced-pick': 'rare', 'reinforced-sickle': 'rare',
  'reinforced-sword': 'rare', 'reinforced-bow': 'rare',
  'masterwork-axe': 'epic', 'masterwork-pick': 'epic', 'masterwork-sickle': 'epic',
  'masterwork-sword': 'epic', 'masterwork-bow': 'epic',
  'ancient-axe': 'legendary', 'ancient-pick': 'legendary', 'ancient-sickle': 'legendary',
  'ancient-sword': 'legendary', 'ancient-bow': 'legendary',
};

export function blueprintQuality(id: string): BlueprintQuality {
  return QUALITY_BY_ID[id as BlueprintItemId] ?? 'common';
}

/** Every blueprint at one tier, sorted so rolls over it stay reproducible. */
export function blueprintsOfQuality(quality: BlueprintQuality): readonly string[] {
  return BLUEPRINT_ITEM_IDS.filter((id) => blueprintQuality(id) === quality).slice().sort();
}
