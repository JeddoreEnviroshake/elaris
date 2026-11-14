import type { BuildingDefinitionId, GameState, ToolDefinitionId } from './state';

/**
 * What the player knows how to make.
 *
 * Blueprints are earned, never purchased — there is no unlock currency. A
 * blueprint becomes known one of two ways: a core grant from a level gate or a
 * quest, or by registering a blueprint item found in the field at a workbench.
 * Either way the end state is the same, a stable definition id in
 * `state.unlockedItemIds`, so every making surface has exactly one question to
 * ask: does the player know this?
 *
 * The persisted field keeps its original name. It has always held precisely
 * this set, and renaming it would cost a save migration to buy nothing.
 */

/**
 * Recipes that are neither a building nor a tool: the handcraft consumables and
 * the one-off Rowboat. They had no id at all while every recipe was either
 * placed or equipped, so they were simply always known. They are blueprints
 * like anything else now, which is what lets a level gate hand over Arrows and
 * the Snare, and what lets the rest be found in the field.
 */
export type ConsumableBlueprintId =
  | 'taming-snare' | 'reinforced-snare' | 'arrow' | 'cloth-mask' | 'rowboat';

export type BlueprintItemId =
  | Exclude<BuildingDefinitionId, 'environment-marker'>
  // The Magic Staff is bought at the Magic Shop, never learned, so it stays out.
  | Exclude<ToolDefinitionId, 'magic-staff'>
  | ConsumableBlueprintId;

/**
 * Kept nameable on its own because the consumables are the one class of
 * blueprint with no placed or equipped object behind it, so callers that reason
 * about buildables and tools — the unlock quest line, for one — need to be able
 * to say "everything except these".
 */
export const CONSUMABLE_BLUEPRINT_IDS: readonly ConsumableBlueprintId[] = [
  'taming-snare', 'reinforced-snare', 'arrow', 'cloth-mask', 'rowboat',
];

/**
 * The field-only variant tools. No level grants them and no shop sells them, so
 * a blueprint is the only route to one — they are the reward the whole system
 * points at.
 */
export const VARIANT_BLUEPRINT_IDS: readonly BlueprintItemId[] = [
  'reinforced-axe', 'reinforced-pick', 'reinforced-sickle', 'reinforced-sword', 'reinforced-bow',
  'masterwork-axe', 'masterwork-pick', 'masterwork-sickle', 'masterwork-sword', 'masterwork-bow',
  'ancient-axe', 'ancient-pick', 'ancient-sickle', 'ancient-sword', 'ancient-bow',
];

/**
 * Every blueprint the game holds, in one list. Order is not meaningful; callers
 * that need determinism sort.
 */
export const BLUEPRINT_ITEM_IDS: readonly BlueprintItemId[] = [
  'thatch-floor', 'thatch-ground', 'thatch-wall', 'thatch-door', 'thatch-fence', 'thatch-gate',
  'wood-floor', 'wood-ground', 'wood-wall', 'wood-door', 'wood-fence', 'wood-gate',
  'stone-floor', 'stone-ground', 'stone-wall', 'stone-door', 'stone-fence', 'stone-gate',
  'metal-floor', 'metal-ground', 'metal-wall', 'metal-door', 'metal-fence', 'metal-gate',
  'wooden-axe', 'wooden-pick', 'wooden-sickle', 'wooden-sword',
  'stone-axe', 'stone-pick', 'stone-sickle', 'stone-sword',
  'iron-axe', 'iron-pick', 'iron-sickle', 'iron-sword',
  'wood-bridge', 'stone-bridge', 'water', 'field-cache', 'bow',
  'workbench', 'furnace', 'farm-counter', 'small-pen', 'barn', 'stone-yard',
  'cart-dock', 'warehouse', 'logistics-hub', 'bed', 'air-purifier',
  'garden-bed', 'woodlot-planter', 'war-table', 'turret',
  ...CONSUMABLE_BLUEPRINT_IDS,
  ...VARIANT_BLUEPRINT_IDS,
];

const BLUEPRINT_ITEM_ID_SET: ReadonlySet<string> = new Set(BLUEPRINT_ITEM_IDS);

export function isBlueprintItemId(id: string): id is BlueprintItemId {
  return BLUEPRINT_ITEM_ID_SET.has(id);
}

export function knowsBlueprint(state: GameState, id: string): boolean {
  return state.unlockedItemIds.includes(id);
}

/**
 * Record a blueprint as permanently known. Idempotent, and the only way the
 * known set ever grows — core grants and workbench registration both land here.
 * Returns whether this call was the one that taught it.
 */
export function learnBlueprint(state: GameState, id: string): boolean {
  if (knowsBlueprint(state, id)) return false;
  state.unlockedItemIds.push(id);
  return true;
}

/**
 * Why a recipe cannot be made, or null once it is known. There is no price to
 * quote any more — the only answer is that the blueprint has not been found.
 */
export function blueprintLockedReason(state: GameState, id: string): string | null {
  return knowsBlueprint(state, id) ? null : 'Blueprint not yet discovered';
}

/** Blueprints the player has yet to learn, sorted so rolls stay reproducible. */
export function unknownBlueprintIds(state: GameState): string[] {
  return BLUEPRINT_ITEM_IDS.filter((id) => !knowsBlueprint(state, id)).sort();
}
