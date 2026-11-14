import { afterEach, describe, expect, it } from 'vitest';
import { BUILDABLES } from '../../src/content/buildingParts';
import { TOOL_DEFINITIONS } from '../../src/config/balance';
import { BLUEPRINT_ITEM_IDS, CONSUMABLE_BLUEPRINT_IDS, learnBlueprint } from '../../src/simulation/blueprintKnowledge';
import { queueLevelBlueprints } from '../../src/simulation/blueprintGrants';
import { blueprintsGrantedAtLevel } from '../../src/content/blueprintGates';
import { createInitialState } from '../../src/simulation/state';
import {
  BLUEPRINTS,
  blueprintGroups,
  isBlueprintUnlocked,
} from '../../src/ui/blueprintCatalog';
import { BlueprintsPanel, UNKNOWN_BLUEPRINT_NAME } from '../../src/ui/blueprintsPanel';
import { InventoryPanel } from '../../src/ui/inventoryPanel';

afterEach(() => {
  document.body.replaceChildren();
});

const noopMenuActions = {
  onEquipTool: () => {}, onRepairTool: () => {}, onDropTool: () => {}, onSplitStack: () => {}, onDropStack: () => {}, onOpened: () => {},
};

describe('blueprint catalog', () => {
  it('lists every buildable and tool exactly once', () => {
    const keys = BLUEPRINTS.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const def of BUILDABLES.filter((candidate) => candidate.availableInPalette !== false)) {
      expect(keys).toContain(def.id);
    }
    for (const definition of TOOL_DEFINITIONS) expect(keys).toContain(definition.definitionId);
  });

  it('groups by material with tools beside the parts made of the same stuff', () => {
    const category = (key: string): string => BLUEPRINTS.find((entry) => entry.key === key)!.category;
    expect(category('thatch-wall')).toBe('thatch');
    expect(category('wooden-axe')).toBe('wood');
    expect(category('wood-bridge')).toBe('wood');
    expect(category('stone-pick')).toBe('stone');
    expect(category('iron-sword')).toBe('metal');
    expect(category('metal-gate')).toBe('metal');
    expect(category('magic-staff')).toBe('magic');
    expect(category('workbench')).toBe('facility');
    expect(category('cloth-mask')).toBe('utility');
    // Groups render in a fixed order and none of them is empty.
    expect(blueprintGroups().map((group) => group.id)).toEqual([
      'thatch', 'wood', 'stone', 'metal', 'variant', 'magic', 'facility', 'utility',
    ]);
    // Variants share the Iron tier but get their own group, so fifteen findable
    // recipes are not buried among the ones a level hands over.
    expect(category('ancient-axe')).toBe('variant');
    expect(category('iron-axe')).toBe('metal');
  });

  it('gives every learnable recipe a real id, consumables included', () => {
    const state = createInitialState(1);
    // Only the Magic Shop staff is exempt: it is bought, never learned.
    for (const entry of BLUEPRINTS) {
      if (entry.unlockId === null) expect(entry.station).toBe('shop');
      else expect(BLUEPRINT_ITEM_IDS).toContain(entry.unlockId);
    }
    for (const id of CONSUMABLE_BLUEPRINT_IDS) expect(BLUEPRINT_ITEM_IDS).toContain(id);
    // The consumables are ordinary blueprints now, so a fresh character does
    // not know them either.
    expect(isBlueprintUnlocked(state, BLUEPRINTS.find((e) => e.key === 'cloth-mask')!)).toBe(false);
    expect(isBlueprintUnlocked(state, BLUEPRINTS.find((e) => e.key === 'stone-axe')!)).toBe(false);
    expect(isBlueprintUnlocked(state, BLUEPRINTS.find((e) => e.key === 'magic-staff')!)).toBe(false);
    // The level-1 gathering tools are the exception: known from birth.
    expect(isBlueprintUnlocked(state, BLUEPRINTS.find((e) => e.key === 'wooden-axe')!)).toBe(true);
    learnBlueprint(state, 'cloth-mask');
    expect(isBlueprintUnlocked(state, BLUEPRINTS.find((e) => e.key === 'cloth-mask')!)).toBe(true);
  });
});

describe('blueprints tab', () => {
  it('shows a square tile per blueprint and offers nothing to buy', () => {
    const state = createInitialState(1);
    const menu = new InventoryPanel(document.body, state, noopMenuActions);
    const panel = new BlueprintsPanel(state);
    panel.attachToMenu(menu);
    menu.openTab('blueprints');

    const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-pressed]'))
      .filter((tile) => tile.querySelector('[data-blueprint-badge]'));
    expect(tiles).toHaveLength(BLUEPRINTS.length);
    for (const tile of tiles) expect(tile.style.aspectRatio).toBe('1 / 1');

    // The tab is a reference, not a shop: there is no way to spend anything.
    expect(document.querySelector('[aria-label^="Unlock "]')).toBeNull();

    panel.destroy();
    menu.destroy();
  });

  it('masks an undiscovered blueprint down to ???? and reveals it once learned', () => {
    const state = createInitialState(1);
    const menu = new InventoryPanel(document.body, state, noopMenuActions);
    const panel = new BlueprintsPanel(state);
    panel.attachToMenu(menu);
    menu.openTab('blueprints');

    const masked = Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-pressed]'))
      .filter((tile) => tile.getAttribute('aria-label') === 'Undiscovered blueprint');
    // The count is the point: the grid says how many blueprints are missing
    // from each category without naming any of them.
    expect(masked.length).toBeGreaterThan(0);
    for (const tile of masked) {
      expect(tile.querySelector('[data-blueprint-name]')!.textContent).toBe(UNKNOWN_BLUEPRINT_NAME);
    }
    expect(document.querySelector('[aria-label^="Storage Box (small),"]')).toBeNull();

    learnBlueprint(state, 'field-cache');
    panel.refresh();

    const revealed = document.querySelector<HTMLButtonElement>('[aria-label^="Storage Box (small),"]')!;
    expect(revealed.getAttribute('aria-label')).toContain('known, made at Build');
    expect(revealed.querySelector('[data-blueprint-name]')!.textContent).toBe('Storage Box (small)');

    panel.destroy();
    menu.destroy();
  });

  it('offers a claim banner for earned blueprints and reveals them on tap', () => {
    const state = createInitialState(1);
    const menu = new InventoryPanel(document.body, state, noopMenuActions);
    const panel = new BlueprintsPanel(state);
    panel.attachToMenu(menu);
    menu.openTab('blueprints');
    // Nothing earned yet, so the tab has nothing to act on.
    expect(document.querySelector('[aria-label^="Collect "]')).toBeNull();

    queueLevelBlueprints(state, 2);
    panel.refresh();
    const banner = document.querySelector<HTMLButtonElement>('[aria-label="Collect 2 earned blueprints"]')!;
    expect(banner.style.display).toBe('block');
    // Earned is still not known: the name stays masked until the tap.
    expect(document.querySelector('[aria-label^="Cloth Mask,"]')).toBeNull();

    banner.click();

    expect(state.pendingBlueprintGrantIds).toEqual([]);
    expect(document.querySelector('[aria-label^="Cloth Mask,"]')).not.toBeNull();
    expect(document.querySelector<HTMLButtonElement>('[aria-label^="Collect "]')).toBeNull();

    panel.destroy();
    menu.destroy();
  });

  it('names what the tap revealed where the banner was', () => {
    const state = createInitialState(1);
    const menu = new InventoryPanel(document.body, state, noopMenuActions);
    const panel = new BlueprintsPanel(state);
    panel.attachToMenu(menu);
    menu.openTab('blueprints');
    const note = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="blueprint-claim-reveal"]')!;
    expect(note().style.display).toBe('none');

    queueLevelBlueprints(state, 2);
    panel.refresh();
    // Nothing is named before the tap — the reveal is the reward.
    expect(note().style.display).toBe('none');

    document.querySelector<HTMLButtonElement>('[aria-label="Collect 2 earned blueprints"]')!.click();

    expect(note().style.display).toBe('block');
    expect(note().textContent).toContain('Unlocked: ');
    for (const id of blueprintsGrantedAtLevel(2)) {
      expect(note().textContent).toContain(BLUEPRINTS.find((e) => e.unlockId === id)!.displayName);
    }

    // Reopening the tab clears the receipt; the tiles are the lasting record.
    menu.openTab('bag');
    menu.openTab('blueprints');
    expect(note().style.display).toBe('none');

    panel.destroy();
    menu.destroy();
  });
});
