import {
  ARROWS_CRAFT_COST,
  ARROWS_PER_CRAFT,
  CLOTH_MASK_CRAFT_COST,
  CLOTH_MASK_PROTECTION_SECONDS,
  REINFORCED_SNARE_CRAFT_COST,
  REINFORCED_SNARES_PER_CRAFT,
  TAMING_SNARE_CRAFT_COST,
  TOOL_DEFINITIONS,
  isHandcraftTool,
} from '../config/balance';
import { BUILDABLES, type ResourceAmounts } from '../content/buildingParts';
import { describeBuildable } from '../scenes/buildPlacement';
import { ROWBOAT_CRAFT_COST } from '../simulation/gameplayCommands';
import { VARIANT_BLUEPRINT_IDS, knowsBlueprint } from '../simulation/blueprintKnowledge';

import type { GameState } from '../simulation/state';
import type { UiIconName } from './icons';

const VARIANT_BLUEPRINT_ID_SET: ReadonlySet<string> = new Set(VARIANT_BLUEPRINT_IDS);

/**
 * One catalog behind the Blueprints tab and the merged Craft tab.
 *
 * Every recipe in the game — buildable parts, facilities, tools, and the
 * handcraft consumables — is a blueprint. Blueprints lists all of them, known
 * or not, grouped by material so a player can see the shape of what the game
 * holds and how much of it they are still missing. Craft (and each work table)
 * then shows only the blueprints they already know, so the making surfaces stay
 * short and never dead-end on a "Locked" card.
 */

export type BlueprintCategoryId =
  | 'thatch' | 'wood' | 'stone' | 'metal' | 'variant' | 'magic' | 'facility' | 'utility';

/** Where an owned blueprint is actually made. Craft only ever shows `hand`. */
export type BlueprintStation = 'hand' | 'workbench' | 'build' | 'shop';

export interface BlueprintEntry {
  key: string;
  displayName: string;
  category: BlueprintCategoryId;
  station: BlueprintStation;
  cost: ResourceAmounts;
  description: string;
  icon: UiIconName;
  /**
   * The blueprint id this recipe is learned under. Null only for the Magic
   * Shop staff, which is bought outright and never learned.
   */
  unlockId: string | null;
}

export const BLUEPRINT_CATEGORIES: ReadonlyArray<{ id: BlueprintCategoryId; label: string }> = [
  { id: 'thatch', label: 'Thatch' },
  { id: 'wood', label: 'Wood' },
  { id: 'stone', label: 'Stone' },
  { id: 'metal', label: 'Metal' },
  { id: 'variant', label: 'Variants' },
  { id: 'magic', label: 'Magic' },
  { id: 'facility', label: 'Facilities' },
  { id: 'utility', label: 'Utility' },
];

export const STATION_LABELS: Readonly<Record<BlueprintStation, string>> = {
  hand: 'Handcraft',
  workbench: 'Workbench',
  build: 'Build',
  shop: 'Magic Shop',
};

/** Tools group with the material of their tier, beside the parts made of it. */
const TIER_CATEGORIES: Readonly<Record<'wooden' | 'stone' | 'iron', BlueprintCategoryId>> = {
  wooden: 'wood',
  stone: 'stone',
  iron: 'metal',
};

function capitalize(word: string): string {
  return word[0]!.toUpperCase() + word.slice(1);
}

function buildableEntries(): BlueprintEntry[] {
  return BUILDABLES
    .filter((def) => def.availableInPalette !== false)
    .map((def) => ({
      key: def.id,
      displayName: def.displayName,
      // Scored parts carry a material; everything else is a facility or terrain.
      category: def.material ?? (def.footprintKind === 'facility' ? 'facility' : 'utility'),
      station: 'build' as const,
      cost: def.cost,
      description: describeBuildable(def.id),
      icon: 'build' as const,
      unlockId: def.id,
    }));
}

function toolEntries(): BlueprintEntry[] {
  return TOOL_DEFINITIONS.map((definition) => {
    const shopOnly = definition.shopService !== undefined;
    return {
      key: definition.definitionId,
      displayName: definition.displayName,
      // Variants share the Iron tier but are their own thing entirely: filing
      // them under Metal would bury fifteen findable recipes among the ones a
      // level hands over.
      category: shopOnly ? 'magic'
        : VARIANT_BLUEPRINT_ID_SET.has(definition.definitionId) ? 'variant'
          : TIER_CATEGORIES[definition.tier],
      // The Wooden starters and the handcraft-flagged exceptions (the Bow) are
      // made in the hands; the rest of the tool table is workbench work.
      station: shopOnly ? 'shop' : isHandcraftTool(definition) ? 'hand' : 'workbench',
      cost: definition.craftCost,
      description: `${capitalize(definition.kind)} · ${definition.maxDurability} durability · equips on creation`,
      icon: definition.kind,
      unlockId: shopOnly ? null : definition.definitionId,
    };
  });
}

/**
 * The handcraft consumables and the Rowboat. These used to be always known for
 * want of an id rather than by design; they are ordinary blueprints now, so
 * Arrows and the Taming Snare can sit on level gates and the rest can be found.
 */
function consumableEntries(): BlueprintEntry[] {
  return [
    {
      key: 'taming-snare',
      displayName: 'Taming Snare',
      category: 'utility',
      station: 'hand',
      cost: TAMING_SNARE_CRAFT_COST,
      description: 'Tame weakened creatures during encounters.',
      icon: 'craft',
      unlockId: 'taming-snare',
    },
    {
      key: 'reinforced-snare',
      displayName: `Reinforced Snare ×${REINFORCED_SNARES_PER_CRAFT}`,
      category: 'utility',
      station: 'hand',
      cost: REINFORCED_SNARE_CRAFT_COST,
      description: 'Trophy snare, far likelier to hold. Thrown before a basic snare.',
      icon: 'craft',
      unlockId: 'reinforced-snare',
    },
    {
      key: 'arrow',
      displayName: `Arrows ×${ARROWS_PER_CRAFT}`,
      category: 'utility',
      station: 'hand',
      cost: ARROWS_CRAFT_COST,
      description: 'Ammunition for ranged encounter actions and turrets.',
      icon: 'craft',
      unlockId: 'arrow',
    },
    {
      key: 'cloth-mask',
      displayName: 'Cloth Mask',
      category: 'utility',
      station: 'hand',
      cost: CLOTH_MASK_CRAFT_COST,
      description: `Filters poison fog for ${CLOTH_MASK_PROTECTION_SECONDS}s. Stacks; one is used automatically.`,
      icon: 'craft',
      unlockId: 'cloth-mask',
    },
    {
      key: 'rowboat',
      displayName: 'Rowboat',
      category: 'utility',
      station: 'workbench',
      cost: ROWBOAT_CRAFT_COST,
      description: 'Travel across rivers and lakes.',
      icon: 'craft',
      unlockId: 'rowboat',
    },
  ];
}

export const BLUEPRINTS: readonly BlueprintEntry[] = [
  ...buildableEntries(),
  ...toolEntries(),
  ...consumableEntries(),
];

/** The catalog in display order: category groups, each already non-empty. */
export function blueprintGroups(): ReadonlyArray<{ id: BlueprintCategoryId; label: string; entries: readonly BlueprintEntry[] }> {
  return BLUEPRINT_CATEGORIES
    .map((category) => ({
      ...category,
      entries: BLUEPRINTS.filter((entry) => entry.category === category.id),
    }))
    .filter((group) => group.entries.length > 0);
}

/**
 * Whether the player knows this blueprint. Shop-exclusive recipes are never
 * learned, so they stay listed but unknown until bought.
 */
export function isBlueprintUnlocked(state: GameState, entry: BlueprintEntry): boolean {
  if (entry.unlockId === null) return entry.station !== 'shop';
  return knowsBlueprint(state, entry.unlockId);
}
