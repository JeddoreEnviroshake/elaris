import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameplayHud, type GameplayHudActions } from '../../src/ui/gameplayHud';
import { createOrdinaryState as createInitialState } from './helpers/ordinaryWorld';
import { InventoryPanel } from '../../src/ui/inventoryPanel';
import { BlueprintsPanel } from '../../src/ui/blueprintsPanel';
import { spendAttributePoints } from '../../src/simulation/characterProgression';

afterEach(() => {
  document.body.replaceChildren();
});

describe('click-to-open storage interaction', () => {
  it('opens the nearby Storage Box (small) inventory and targets that specific box', () => {
    const state = createInitialState(123);
    const nearbyBox = {
      id: 'cache-near',
      definitionId: 'field-cache' as const,
      tileX: 1,
      tileY: 1,
      storage: { wood: 7, stone: 0, fiber: 2 },
    };
    state.buildings.push(
      {
        id: 'cache-first', definitionId: 'field-cache', tileX: 20, tileY: 20,
        storage: { wood: 99, stone: 99, fiber: 99 },
      },
      nearbyBox,
    );
    const onWithdrawFromCache = vi.fn();
    const onWithdrawResourceFromCache = vi.fn();
    const noop = (): void => {};
    const actions: GameplayHudActions = {
      onAction: noop,
      onCraftTool: noop,
      onCraftSnare: noop, onCraftReinforcedSnare: noop,
      onCraftArrows: noop, onCraftClothMask: noop,
      onEnqueueIronSmelt: noop,
      onCollectFurnace: noop,
      onEquipTool: noop,
      onSetCreatureRole: noop,
      onSetBattleCompanion: noop,
      onSelectCompanionAbility: noop,
      onWithdrawFromCache,
      onWithdrawResourceFromCache,
      onSpendAttribute: noop,
      onClaimQuestReward: () => false, onCraftOpened: noop,
    };
    const hud = new GameplayHud(document.body, state, actions);

    hud.openFacility(nearbyBox);
    const panel = document.querySelector<HTMLElement>('[aria-label="Facility actions"]')!;
    expect(panel.style.display).toBe('block');
    expect(panel.querySelector('[aria-label="Bag inventory"]')).not.toBeNull();
    expect(panel.querySelector('[aria-label="Storage Box (small) inventory"]')).not.toBeNull();
    expect(panel.textContent).toContain('2/6 spaces');
    const takeWood = panel.querySelector<HTMLButtonElement>('[aria-label="Move wood stack, 7, to Bag"]')!;
    takeWood.click();
    expect(onWithdrawResourceFromCache).toHaveBeenCalledWith('wood', 0, 'cache-near');
    expect(hud.getOpenFacilityId()).toBe('cache-near');

    const closeButton = Array.from(panel.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Close')!;
    expect(closeButton).toBeDefined();
    closeButton.click();
    expect(panel.style.display).toBe('none');
    expect(hud.getOpenFacilityId()).toBeNull();

    hud.destroy();
  });
});

describe('click-to-open crafting facility interaction', () => {
  const actions = (overrides: Partial<GameplayHudActions> = {}): GameplayHudActions => {
    const noop = (): void => {};
    return {
      onAction: noop,
      onCraftTool: noop,
      onCraftSnare: noop, onCraftReinforcedSnare: noop,
      onCraftArrows: noop, onCraftClothMask: noop,
      onEnqueueIronSmelt: noop,
      onCollectFurnace: noop,
      onEquipTool: noop,
      onSetCreatureRole: noop,
      onSetBattleCompanion: noop,
      onSelectCompanionAbility: noop,
      onWithdrawFromCache: noop,
      onSpendAttribute: noop,
      onClaimQuestReward: () => false, onCraftOpened: noop,
      ...overrides,
    };
  };

  it('opens the nearby Furnace in the center and targets that furnace', () => {
    const state = createInitialState(123);
    state.inventory.wood = 2;
    state.inventory['iron-ore'] = 4;
    const nearbyFurnace = {
      id: 'furnace-near',
      definitionId: 'furnace' as const,
      tileX: 1,
      tileY: 1,
      furnace: { queue: [] },
    };
    state.buildings.push(nearbyFurnace);
    const onEnqueueIronSmelt = vi.fn();
    const hud = new GameplayHud(document.body, state, actions({ onEnqueueIronSmelt }));

    hud.openFacility(nearbyFurnace);
    const panel = document.querySelector<HTMLElement>('[aria-label="Facility actions"]')!;
    expect(panel.style.display).toBe('block');
    expect(hud.getOpenFacilityId()).toBe('furnace-near');
    expect(panel.style.left).toBe('50%');
    expect(panel.style.top).toBe('50%');
    expect(panel.style.transform).toBe('translate(-50%, -50%)');
    const smelt = Array.from(panel.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.getAttribute('aria-label') === 'Smelt iron ingot')!;
    expect(smelt.disabled).toBe(false);
    smelt.click();
    expect(onEnqueueIronSmelt).toHaveBeenCalledWith('furnace-near');

    hud.destroy();
  });

  it('keeps Furnace controls out of Handcraft and in the clicked Furnace menu', () => {
    const state = createInitialState(123);
    const furnace = {
      id: 'furnace-near',
      definitionId: 'furnace' as const,
      tileX: 1,
      tileY: 1,
      furnace: { queue: [] },
    };
    state.buildings.push(furnace);
    const hud = new GameplayHud(document.body, state, actions());

    const handcraft = document.querySelector<HTMLElement>('[aria-label="Handcraft"]')!;
    expect(handcraft.textContent).not.toContain('Furnace');
    expect(handcraft.querySelector('[aria-label="Smelt iron ingot"]')).toBeNull();
    expect(handcraft.querySelector('[aria-label="Collect iron ingots"]')).toBeNull();

    hud.openFacility(furnace);
    const panel = document.querySelector<HTMLElement>('[aria-label="Facility actions"]')!;
    expect(panel.querySelector('[aria-label="Smelt iron ingot"]')).not.toBeNull();
    expect(panel.querySelector('[aria-label="Collect iron ingots"]')).not.toBeNull();

    hud.destroy();
  });

  it('opens the Workbench menu in the center with Furnace-style recipe cards', () => {
    const state = createInitialState(123);
    const workbench = { id: 'workbench-near', definitionId: 'workbench' as const, tileX: 1, tileY: 1 };
    state.buildings.push(workbench);
    const hud = new GameplayHud(document.body, state, actions());

    hud.openFacility(workbench);
    const panel = document.querySelector<HTMLElement>('[aria-label="Facility actions"]')!;
    expect(panel.style.left).toBe('50%');
    expect(panel.style.top).toBe('50%');
    expect(panel.style.transform).toBe('translate(-50%, -50%)');
    expect(panel.textContent).toContain('Recipes');
    // Unowned blueprints are bought in the Blueprints tab, never at the table,
    // so a locked recipe is hidden here rather than shown as a dead card.
    const recipe = panel.querySelector<HTMLButtonElement>('[data-facility-recipe="stone-pick"]')!;
    const emptyNote = panel.querySelector<HTMLElement>('[data-facility-recipes-empty]')!;
    expect(recipe.style.display).toBe('none');
    expect(emptyNote.style.display).toBe('block');
    expect(panel.querySelector('[aria-label="Unlock Stone Pick"]')).toBeNull();

    state.unlockedItemIds.push('stone-pick');
    hud.openFacility(workbench);
    expect(recipe.style.display).toBe('block');
    expect(recipe.textContent).toContain('Stone Pick');
    expect(recipe.style.width).toBe('100%');
    expect(recipe.style.minHeight).toBe('58px');
    expect(recipe.style.background).toBe('rgba(30, 48, 37, 0.94)');
    expect(emptyNote.style.display).toBe('none');

    hud.destroy();
  });
});

describe('character menu', () => {
  it('opens the Character tab when the XP bar is clicked', () => {
    const state = createInitialState(123);
    const noop = (): void => {};
    const actions: GameplayHudActions = {
      onAction: noop,
      onCraftTool: noop,
      onCraftSnare: noop, onCraftReinforcedSnare: noop,
      onCraftArrows: noop, onCraftClothMask: noop,
      onEnqueueIronSmelt: noop,
      onCollectFurnace: noop,
      onEquipTool: noop,
      onSetCreatureRole: noop,
      onSetBattleCompanion: noop,
      onSelectCompanionAbility: noop,
      onWithdrawFromCache: noop,
      onSpendAttribute: noop,
      onClaimQuestReward: () => false, onCraftOpened: noop,
    };
    const hud = new GameplayHud(document.body, state, actions);
    const menu = new InventoryPanel(document.body, state, {
      onEquipTool: noop, onRepairTool: noop, onDropTool: noop, onSplitStack: noop, onDropStack: noop, onOpened: noop,
    });
    hud.attachToMenu(menu);

    const stats = document.querySelector<HTMLElement>('[aria-label="Character stats"]')!;
    expect(stats.style.display).toBe('none');
    document.querySelector<HTMLElement>('[data-player-xp]')!.click();
    expect(stats.style.display).toBe('block');

    menu.destroy();
    hud.destroy();
  });

  it('merges attributes with every maximum and derived character stat', () => {
    const state = createInitialState(123);
    state.player.maxHp = 130;
    state.player.maxStamina = 120;
    state.player.maxMana = 50;
    state.player.attributes = {
      strength: 2, dexterity: 3, magic: 4, luck: 0, speed: 2,
      health: 3, healthRegen: 1, stamina: 2, staminaRegen: 1, carryWeight: 2, mana: 2, manaRegen: 1,
    };
    const noop = (): void => {};
    const actions: GameplayHudActions = {
      onAction: noop,
      onCraftTool: noop,
      onCraftSnare: noop, onCraftReinforcedSnare: noop,
      onCraftArrows: noop, onCraftClothMask: noop,
      onEnqueueIronSmelt: noop,
      onCollectFurnace: noop,
      onEquipTool: noop,
      onSetCreatureRole: noop,
      onSetBattleCompanion: noop,
      onSelectCompanionAbility: noop,
      onWithdrawFromCache: noop,
      onSpendAttribute: noop,
      onClaimQuestReward: () => false, onCraftOpened: noop,
    };

    const hud = new GameplayHud(document.body, state, actions);
    const stats = document.querySelector('[aria-label="Maximum stats and attributes"]')!;
    const labels = Array.from(stats.children).map((stat) => stat.getAttribute('aria-label'));

    expect(labels).toHaveLength(12);
    expect(labels).toEqual(expect.arrayContaining([
      // The weapon is the base and the attribute is the bonus, so the sheet
      // shows the part the attribute owns rather than a total that would be
      // wrong the moment the player equipped something else.
      expect.stringContaining('Strength, attribute 2. Melee Damage +4'),
      expect.stringContaining('Dexterity, attribute 3. Ranged Damage +6'),
      expect.stringContaining('Magic, attribute 4. Magic Damage +8'),
      expect.stringContaining(`Speed, attribute 2. Walk Speed ${state.gameBalance.characterDefaults.walkSpeed + 20} px/s`),
      expect.stringContaining('Health, attribute 3. Health 130'),
      // A quarter a second per point, on top of the base rate for that vital.
      expect.stringContaining('Health Regeneration, attribute 1. Health Regen 0.25 HP/s'),
      expect.stringContaining('Stamina, attribute 2. Stamina 120'),
      expect.stringContaining('Stamina Regeneration, attribute 1. Stamina Regen 5.25 SP/s'),
      expect.stringContaining('Carry Weight, attribute 2. Carry Weight 104'),
      expect.stringContaining('Mana, attribute 2. Mana 50'),
      expect.stringContaining('Mana Regeneration, attribute 1. Mana Regen 2.25 MP/s'),
    ]));
    expect(document.querySelector('[aria-label="Character stats"]')!.textContent).not.toContain('Unlock points');

    hud.destroy();
  });

  it('stages plus and minus choices, explains them, and only spends on Apply', () => {
    const state = createInitialState(123);
    state.player.attributePoints = 3;
    const noop = (): void => {};
    const onApplyAttributes = vi.fn((
      allocation: Parameters<NonNullable<GameplayHudActions['onApplyAttributes']>>[0],
    ) => { spendAttributePoints(state, allocation); });
    const actions: GameplayHudActions = {
      onAction: noop, onCraftTool: noop,
      onCraftSnare: noop, onCraftReinforcedSnare: noop, onCraftArrows: noop, onCraftClothMask: noop,
      onEnqueueIronSmelt: noop, onCollectFurnace: noop, onEquipTool: noop,
      onSetCreatureRole: noop, onSetBattleCompanion: noop, onSelectCompanionAbility: noop,
      onWithdrawFromCache: noop, onSpendAttribute: noop, onApplyAttributes, onClaimQuestReward: () => false, onCraftOpened: noop,
    };
    const hud = new GameplayHud(document.body, state, actions);
    const healthPlus = document.querySelector<HTMLButtonElement>('[data-attribute-increase="health"]')!;
    const healthMinus = document.querySelector<HTMLButtonElement>('[data-attribute-decrease="health"]')!;
    const strengthPlus = document.querySelector<HTMLButtonElement>('[data-attribute-increase="strength"]')!;

    healthPlus.click();
    healthPlus.click();
    strengthPlus.click();
    expect(state.player.attributePoints).toBe(3);
    expect(state.player.maxHp).toBe(100);
    expect(healthPlus.disabled).toBe(true);
    expect(document.querySelector('[data-attribute-row="health"]')!.textContent).toContain('Health 100 → 120');

    healthMinus.click();
    const apply = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Apply 2 points')!;
    apply.click();

    expect(onApplyAttributes).toHaveBeenCalledWith({ strength: 1, health: 1 });
    expect(state.player).toMatchObject({ attributePoints: 1, maxHp: 110, hp: 110 });
    expect(state.player.attributes).toMatchObject({ strength: 1, health: 1 });
    expect(healthMinus.disabled).toBe(true);

    const info = document.querySelector<HTMLButtonElement>('[data-attribute-info="health"]')!;
    info.click();
    expect(info.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector<HTMLElement>('#attribute-health-details')!.style.display).toBe('block');
    expect(document.querySelector('#attribute-health-details')!.textContent).toContain('10 maximum health');

    hud.destroy();
  });

  it('previews a staged maximum from the published per-point value', () => {
    const state = createInitialState(123);
    state.player.attributePoints = 1;
    // The retuned knob, not the shipped 10: a preview that ignored this promised
    // a bonus the spent point would never grant.
    state.gameBalance.attributeGains.staminaMaxStamina = 2;
    const noop = (): void => {};
    const actions: GameplayHudActions = {
      onAction: noop, onCraftTool: noop,
      onCraftSnare: noop, onCraftReinforcedSnare: noop, onCraftArrows: noop, onCraftClothMask: noop,
      onEnqueueIronSmelt: noop, onCollectFurnace: noop, onEquipTool: noop,
      onSetCreatureRole: noop, onSetBattleCompanion: noop, onSelectCompanionAbility: noop,
      onWithdrawFromCache: noop, onSpendAttribute: noop,
      onApplyAttributes: (allocation) => { spendAttributePoints(state, allocation); },
      onClaimQuestReward: () => false, onCraftOpened: noop,
    };
    const hud = new GameplayHud(document.body, state, actions);
    const before = state.player.maxStamina;

    document.querySelector<HTMLButtonElement>('[data-attribute-increase="stamina"]')!.click();

    expect(document.querySelector('[data-attribute-row="stamina"]')!.textContent)
      .toContain(`Stamina ${before} → ${before + 2}`);

    Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent === 'Apply 1 point')!.click();
    expect(state.player.maxStamina).toBe(before + 2);

    hud.destroy();
  });
});

describe('top-right status stack', () => {
  it('locks XP below the timer and stacks every transient vital beneath it', () => {
    const state = createInitialState(123);
    const noop = (): void => {};
    const actions: GameplayHudActions = {
      onAction: noop,
      onCraftTool: noop,
      onCraftSnare: noop, onCraftReinforcedSnare: noop,
      onCraftArrows: noop, onCraftClothMask: noop,
      onEnqueueIronSmelt: noop,
      onCollectFurnace: noop,
      onEquipTool: noop,
      onSetCreatureRole: noop,
      onSetBattleCompanion: noop,
      onSelectCompanionAbility: noop,
      onWithdrawFromCache: noop,
      onSpendAttribute: noop,
      onClaimQuestReward: () => false, onCraftOpened: noop,
    };
    const hud = new GameplayHud(document.body, state, actions);
    const stack = document.querySelector<HTMLElement>('[data-hud-status-stack]')!;
    // Gold lives above the mini map now, so the navigator mounts it instead.
    const badge = hud.coinBadge;

    expect(stack.style.top).toContain('safe-area-inset-top');
    expect(stack.style.right).toContain('safe-area-inset-right');
    expect(Array.from(stack.children).map((child) => Array.from((child as HTMLElement).attributes)
      .find((attribute) => attribute.name.startsWith('data-'))?.name)).toEqual([
      // The blueprint claim strip rides under the XP bar that announced the
      // level, ahead of the vitals that come and go.
      'data-survival-timer', 'data-player-xp', 'data-testid', 'data-player-health',
      'data-player-stamina', 'data-player-mana',
    ]);
    expect(stack.style.flexDirection).toBe('column');
    expect(stack.querySelector<HTMLElement>('[data-player-health]')!.style.minHeight).toBe('');
    expect(stack.querySelector<HTMLElement>('[data-player-health]')!.style.height).toBe('34px');
    expect(badge.textContent).toBe('Gold0');
    expect(badge.getAttribute('aria-label')).toBe('Gold: 0');

    state.coins = 1_234;
    hud.refresh(null);
    expect(badge.textContent).toBe('Gold1,234');
    expect(badge.getAttribute('aria-label')).toBe('Gold: 1234');

    hud.showResourceTotals(['34 wood']);
    const resourceFlash = document.querySelector<HTMLElement>('[data-resource-total-flash]')!;
    expect(resourceFlash.textContent).toBe('34 wood');
    expect(resourceFlash.style.display).toBe('flex');
    expect(resourceFlash.style.top).toContain('safe-area-inset-top');
    expect(resourceFlash.style.right).toContain('safe-area-inset-right');

    hud.destroy();
  });
});

describe('player health bar', () => {
  it('keeps current HP visible on the play screen and updates its fill', () => {
    const state = createInitialState(123);
    state.player.maxHp = 160;
    state.player.hp = 80;
    const noop = (): void => {};
    const actions: GameplayHudActions = {
      onAction: noop, onCraftTool: noop, onCraftSnare: noop, onCraftReinforcedSnare: noop, onCraftArrows: noop, onCraftClothMask: noop,
      onEnqueueIronSmelt: noop, onCollectFurnace: noop, onEquipTool: noop, onSetCreatureRole: noop, onSetBattleCompanion: noop,
      onSelectCompanionAbility: noop, onWithdrawFromCache: noop, onSpendAttribute: noop, onClaimQuestReward: () => false, onCraftOpened: noop,
    };
    const hud = new GameplayHud(document.body, state, actions);
    const bar = document.querySelector<HTMLElement>('[data-player-health]')!;
    const fill = bar.querySelector<HTMLElement>('[data-player-health-fill]')!;

    expect(bar.textContent).toBe('HP80/160');
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('80');
    expect(bar.getAttribute('aria-valuemax')).toBe('160');
    expect(fill.style.width).toBe('50%');

    state.player.hp = 32;
    hud.refresh(null);
    expect(bar.textContent).toBe('HP32/160');
    expect(bar.getAttribute('aria-label')).toBe('Health 32 of 160');
    expect(fill.style.width).toBe('20%');
    expect(fill.style.background).toBe('rgb(239, 100, 100)');

    hud.destroy();
  });
});

describe('player XP bar', () => {
  it('shows level progress and updates its fill', () => {
    const state = createInitialState(123);
    state.player.level = 2;
    state.player.xp = 75;
    const noop = (): void => {};
    const actions: GameplayHudActions = {
      onAction: noop, onCraftTool: noop, onCraftSnare: noop, onCraftReinforcedSnare: noop, onCraftArrows: noop, onCraftClothMask: noop,
      onEnqueueIronSmelt: noop, onCollectFurnace: noop, onEquipTool: noop, onSetCreatureRole: noop, onSetBattleCompanion: noop,
      onSelectCompanionAbility: noop, onWithdrawFromCache: noop, onSpendAttribute: noop, onClaimQuestReward: () => false, onCraftOpened: noop,
    };
    const hud = new GameplayHud(document.body, state, actions);
    const bar = document.querySelector<HTMLElement>('[data-player-xp]')!;
    const fill = bar.querySelector<HTMLElement>('[data-player-xp-fill]')!;

    expect(bar.textContent).toBe('XP75/150');
    expect(bar.getAttribute('aria-valuenow')).toBe('75');
    expect(bar.getAttribute('aria-valuemax')).toBe('150');
    expect(bar.getAttribute('aria-label')).toBe('Level 2 experience 75 of 150 · open Character');
    expect(fill.style.width).toBe('50%');
    expect(bar.classList.contains('elaris-xp-points-ready')).toBe(false);

    state.player.xp = 120;
    state.player.attributePoints = 2;
    hud.refresh(null);
    expect(fill.style.width).toBe('80%');
    expect(bar.classList.contains('elaris-xp-points-ready')).toBe(true);
    expect(bar.dataset.unspentAttributePoints).toBe('2');
    expect(bar.title).toBe('2 attribute points ready to spend · opens Character');

    state.player.attributePoints = 0;
    hud.refresh(null);
    expect(bar.classList.contains('elaris-xp-points-ready')).toBe(false);
    expect(bar.title).toBe('Opens Character');
    hud.destroy();
  });
});

describe('resource proximity hint', () => {
  it('does not show text beneath the hotbar for a nearby resource', () => {
    const state = createInitialState(123);
    const noop = (): void => {};
    const actions: GameplayHudActions = {
      onAction: noop, onCraftTool: noop, onCraftSnare: noop, onCraftReinforcedSnare: noop, onCraftArrows: noop, onCraftClothMask: noop,
      onEnqueueIronSmelt: noop, onCollectFurnace: noop, onEquipTool: noop, onSetCreatureRole: noop, onSetBattleCompanion: noop,
      onSelectCompanionAbility: noop, onWithdrawFromCache: noop, onSpendAttribute: noop, onClaimQuestReward: () => false, onCraftOpened: noop,
    };
    const hud = new GameplayHud(document.body, state, actions);

    hud.refreshTargets(state.resourceNodes[0]!);

    const hint = document.querySelector<HTMLElement>('[data-target-hint]')!;
    expect(hint.style.display).toBe('none');
    expect(hint.textContent).toBe('');
    expect(hint.dataset.resourceTargetId).toBe(state.resourceNodes[0]!.id);
    hud.destroy();
  });
});

describe('context action override', () => {
  it('shows an explicit building or interior action and restores Gather', () => {
    const state = createInitialState(123);
    const noop = (): void => {};
    const actions: GameplayHudActions = {
      onAction: noop, onCraftTool: noop, onCraftSnare: noop, onCraftReinforcedSnare: noop, onCraftArrows: noop, onCraftClothMask: noop,
      onEnqueueIronSmelt: noop, onCollectFurnace: noop, onEquipTool: noop, onSetCreatureRole: noop, onSetBattleCompanion: noop,
      onSelectCompanionAbility: noop, onWithdrawFromCache: noop, onSpendAttribute: noop, onClaimQuestReward: () => false, onCraftOpened: noop,
    };
    const hud = new GameplayHud(document.body, state, actions);
    const button = document.querySelector<HTMLButtonElement>('[data-action-button]')!;
    const hint = document.querySelector<HTMLElement>('[data-target-hint]')!;

    hud.setContextActionOverride('Enter Weaponsmith', "Mara's forge · E / Space");
    expect(button.textContent).toBe('Enter Weaponsmith');
    expect(hint.textContent).toBe("Mara's forge · E / Space");

    hud.setContextActionOverride(null);
    expect(button.textContent).toBe('Gather');
    hud.destroy();
  });
});

describe('survival timer badge', () => {
  it('shows the alternating safe and danger countdown states', () => {
    const state = createInitialState(123);
    // Exercise exposed/sheltered badge states away from Elaris's permanent
    // municipal safe zone.
    state.currentArea = { key: '1,0', x: 1, y: 0, name: 'Away', theme: 'forest', seed: 9 };
    const noop = (): void => {};
    const actions: GameplayHudActions = {
      onAction: noop, onCraftTool: noop, onCraftSnare: noop, onCraftReinforcedSnare: noop, onCraftArrows: noop, onCraftClothMask: noop,
      onEnqueueIronSmelt: noop, onCollectFurnace: noop, onEquipTool: noop, onSetCreatureRole: noop, onSetBattleCompanion: noop,
      onSelectCompanionAbility: noop, onWithdrawFromCache: noop, onSpendAttribute: noop, onClaimQuestReward: () => false, onCraftOpened: noop,
    };
    const hud = new GameplayHud(document.body, state, actions);
    const timer = document.querySelector<HTMLElement>('[data-survival-timer]')!;

    // The badge names the threat during the safe phase, because which one is
    // coming decides whether the player should be stocking filters or arrows.
    expect(timer.textContent).toBe('POISON FOG IN  9:59');
    expect(timer.getAttribute('aria-label')).toBe('Safe phase, poison fog in 9:59');

    state.tick = 10 * 60 * 60;
    state.dangerExposureStartedAtTick = state.tick;
    hud.refresh(null);
    expect(timer.textContent).toBe('POISON FOG  0:59');
    expect(timer.getAttribute('aria-label')).toContain('exposed');
    const grace = document.querySelector<HTMLElement>('[data-danger-grace-timer]')!;
    expect(grace.textContent).toBe('GET TO SAFETY  0:10');
    expect(grace.style.display).toBe('grid');
    expect(grace.style.color).toBe('rgb(255, 107, 107)');

    state.tick += 10 * 60 + 1;
    hud.refresh(null);
    expect(grace.textContent).toBe('EXPOSURE  ·  -6+ HP/s');
    expect(grace.getAttribute('aria-label')).toBe('Exposure draining 6 health per second and rising');

    state.dangerExposureStartedAtTick = null;
    hud.refresh(null);
    expect(grace.style.display).toBe('none');

    // Cycle 1 is a raid night: the badge switches threat, and the exposure
    // countdown stays silent because the air is clean.
    state.tick = 11 * 60 * 60;
    state.dangerExposureStartedAtTick = state.tick;
    hud.refresh(null);
    expect(timer.textContent).toBe('NIGHT RAID IN  9:59');
    expect(timer.getAttribute('aria-label')).toBe('Safe phase, night raid in 9:59');

    state.tick = 21 * 60 * 60;
    hud.refresh(null);
    expect(timer.textContent).toBe('NIGHT RAID  0:59');
    expect(grace.style.display).toBe('none');
    hud.destroy();
  });

  it('names the arcane storm, counts its impacts, and calls out charged ore', () => {
    const state = createInitialState(124);
    state.currentArea = { key: '1,0', x: 1, y: 0, name: 'Away', theme: 'forest', seed: 9 };
    const noop = (): void => {};
    const actions: GameplayHudActions = {
      onAction: noop, onCraftTool: noop, onCraftSnare: noop, onCraftReinforcedSnare: noop, onCraftArrows: noop, onCraftClothMask: noop,
      onEnqueueIronSmelt: noop, onCollectFurnace: noop, onEquipTool: noop, onSetCreatureRole: noop, onSetBattleCompanion: noop,
      onSelectCompanionAbility: noop, onWithdrawFromCache: noop, onSpendAttribute: noop, onClaimQuestReward: () => false, onCraftOpened: noop,
    };
    const hud = new GameplayHud(document.body, state, actions);
    const timer = document.querySelector<HTMLElement>('[data-survival-timer]')!;
    const grace = document.querySelector<HTMLElement>('[data-danger-grace-timer]')!;

    // Cycle 4's safe phase: the first storm is what the player is counting down to.
    const cycleTicks = 11 * 60 * 60;
    state.tick = cycleTicks * 4;
    hud.refresh(null);
    expect(timer.textContent).toBe('ARCANE STORM IN  9:59');
    expect(timer.getAttribute('aria-label')).toBe('Safe phase, arcane storm in 9:59');

    state.tick = cycleTicks * 4 + 10 * 60 * 60;
    hud.refresh(null);
    expect(timer.textContent).toBe('ARCANE STORM  0:59');
    expect(timer.getAttribute('aria-label')).toBe('Arcane storm, 0:59 remaining, exposed');
    // No marker has been scheduled yet, so no impact badge either.
    expect(grace.style.display).toBe('none');

    state.arcaneStorm = {
      cycleIndex: 4,
      nextStrikeIndex: 3,
      strikes: [{
        id: 'strike-1',
        cycleIndex: 4,
        strikeIndex: 2,
        areaKey: '1,0',
        x: state.player.x,
        y: state.player.y,
        telegraphAtTick: state.tick,
        impactAtTick: state.tick + 3 * 60,
        rewardIronOre: 1,
        resolvedAtTick: null,
      }],
    };
    hud.refresh(null);
    expect(grace.style.display).toBe('grid');
    expect(grace.textContent).toBe('IMPACT  0:03  ·  MOVE OUT OF THE RING  ·  CHARGED ORE');
    expect(grace.getAttribute('aria-label'))
      .toBe('Arcane impact in 3 seconds, you are inside the ring, move out, drops 1 charged iron ore');

    // Walking clear changes what the badge says without hiding the countdown.
    state.player.x += 5 * 16;
    hud.refresh(null);
    expect(grace.textContent).toBe('IMPACT  0:03  ·  CLEAR  ·  CHARGED ORE');
    hud.destroy();
  });
});

describe('blueprint unlock notifications', () => {
  const noop = (): void => {};
  const actions: GameplayHudActions = {
    onAction: noop,
    onCraftTool: noop,
    onCraftSnare: noop, onCraftReinforcedSnare: noop,
    onCraftArrows: noop, onCraftClothMask: noop,
    onEnqueueIronSmelt: noop,
    onCollectFurnace: noop,
    onEquipTool: noop,
    onSetCreatureRole: noop,
    onSetBattleCompanion: noop,
    onSelectCompanionAbility: noop,
    onWithdrawFromCache: noop,
    onSpendAttribute: noop,
    onClaimQuestReward: () => false, onCraftOpened: noop,
  };

  const mount = (state: ReturnType<typeof createInitialState>) => {
    const hud = new GameplayHud(document.body, state, actions);
    const menu = new InventoryPanel(document.body, state, {
      onEquipTool: noop, onRepairTool: noop, onDropTool: noop, onSplitStack: noop, onDropStack: noop, onOpened: noop,
    });
    hud.attachToMenu(menu);
    const blueprints = new BlueprintsPanel(state);
    blueprints.attachToMenu(menu);
    return { hud, menu, blueprints };
  };

  it('flashes Claim Blueprint under the XP bar and opens the Blueprints tab', () => {
    const state = createInitialState(123);
    const { hud, menu } = mount(state);
    const strip = document.querySelector<HTMLElement>('[data-testid="blueprint-claim-strip"]')!;
    const panel = document.querySelector<HTMLElement>('[aria-label="Blueprints"]')!;

    expect(strip.style.display).toBe('none');
    expect(strip.classList.contains('elaris-quest-ready')).toBe(false);

    state.pendingBlueprintGrantIds.push('cloth-mask', 'garden-bed');
    hud.refresh(null);

    expect(strip.style.display).toBe('flex');
    expect(strip.textContent).toBe('Claim Blueprint');
    // The name is withheld on purpose; the Blueprints tab owns the reveal.
    expect(strip.getAttribute('aria-label')).toContain('2 earned blueprints waiting');
    expect(strip.classList.contains('elaris-quest-ready')).toBe(true);

    expect(panel.style.display).toBe('none');
    strip.click();
    expect(panel.style.display).toBe('block');

    // Collecting them clears the strip.
    state.pendingBlueprintGrantIds.length = 0;
    hud.refresh(null);
    expect(strip.style.display).toBe('none');
    expect(strip.getAttribute('aria-label')).toBeNull();

    menu.destroy();
    hud.destroy();
  });

  it('pops a banner naming each newly learned blueprint, and opens Blueprints on tap', () => {
    const state = createInitialState(123);
    const { hud, menu } = mount(state);
    const banner = document.querySelector<HTMLElement>('[data-testid="blueprint-unlocked-banner"]')!;
    const strip = banner.parentElement!;
    const panel = document.querySelector<HTMLElement>('[aria-label="Blueprints"]')!;

    // Nothing already known announces itself.
    hud.refresh(null);
    expect(strip.style.display).toBe('none');

    state.unlockedItemIds.push('garden-bed', 'war-table');
    hud.refresh(null);

    expect(strip.style.display).toBe('flex');
    expect(banner.textContent).toContain('Blueprint unlocked');
    expect(banner.textContent).toContain('Garden Bed');
    // The second one waits its turn rather than being lost.
    expect(banner.textContent).toContain('+1');

    banner.click();
    expect(panel.style.display).toBe('block');
    expect(strip.style.display).toBe('none');

    menu.destroy();
    hud.destroy();
  });
});
