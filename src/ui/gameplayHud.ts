import { TOOL_DEFINITIONS, toolDefinition } from '../config/balance';
import { MAX_ACTIVE_FOLLOWERS, creatureDefinition } from '../content/creatures';
import { equippedTool, fieldCache, usedInventorySlots } from '../simulation/gameplayCommands';
import { ATTRIBUTE_DESCRIPTIONS, ATTRIBUTE_IDS, ATTRIBUTE_LABELS, inventoryCapacity, xpToNextLevel } from '../simulation/characterProgression';
import type { AttributeId, CreatureRole, GameState, GroundDropState, ResourceId, ResourceNodeState, ToolDefinitionId, WildCreatureState } from '../simulation/state';
import { RAIL_BOTTOMS, div, paletteCard, paletteSection, railButton, uiButton, wireDisclosure } from './controls';
import { ProgressionGuide } from './progressionGuide';
import type { InventoryPanel } from './inventoryPanel';
import type { NpcDefinition } from '../content/npcs';

export interface GameplayHudActions {
  onAction: () => void;
  onCraftTool: (definitionId: ToolDefinitionId) => void;
  onCraftSnare: () => void;
  onCraftArrows: () => void;
  onRepairTool: (toolId: string) => void;
  onEquipTool: (toolId: string) => void;
  onTameCreature: () => void;
  onSetCreatureRole: (creatureId: string, role: CreatureRole) => void;
  onWithdrawFromCache: (resource: ResourceId) => void;
  onSpendAttribute: (attribute: AttributeId) => void;
  /** The craft panel opened; the scene closes competing panels (build). */
  onCraftOpened: () => void;
}

/** Compact inventory, context action, and first-recipe crafting UI. */
export class GameplayHud {
  private readonly root: HTMLDivElement;
  private readonly inventory: HTMLDivElement;
  private readonly target: HTMLDivElement;
  private readonly craftPanel: HTMLDivElement;
  private readonly craftButton: HTMLButtonElement;
  private readonly actionButton: HTMLButtonElement;
  private readonly creatureButton: HTMLButtonElement;
  private readonly creaturePanel: HTMLDivElement;
  private readonly creatureRoster: HTMLDivElement;
  private readonly creatureStatus: HTMLDivElement;
  private readonly statsButton: HTMLButtonElement;
  private readonly statsPanel: HTMLDivElement;
  private readonly statsSummary: HTMLDivElement;
  private readonly attributeButtons = new Map<AttributeId, HTMLButtonElement>();
  private readonly assignmentButtons = new Map<CreatureRole, HTMLButtonElement>();
  private readonly withdrawButtons = new Map<ResourceId, HTMLButtonElement>();
  private readonly recipeButtons = new Map<ToolDefinitionId, HTMLButtonElement>();
  private readonly toolsList: HTMLDivElement;
  private readonly feedback: HTMLDivElement;
  private readonly progressionGuide: ProgressionGuide;
  private feedbackTimer: ReturnType<typeof setTimeout> | null = null;
  private selectedCreatureId: string | null = null;
  /** The single thumb button morphs Gather ↔ Tame with the nearest target. */
  private tameMode = false;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly actions: GameplayHudActions,
  ) {
    this.root = div({ position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '11' });

    this.inventory = div({
      marginBottom: '10px',
      padding: '9px 10px',
      borderRadius: '8px',
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.1)',
      font: '600 12px system-ui, sans-serif',
      lineHeight: '1.45',
    });

    this.target = div({
      position: 'absolute',
      left: '50%',
      bottom: 'calc(env(safe-area-inset-bottom) + 18px)',
      transform: 'translateX(-50%)',
      padding: '6px 10px',
      borderRadius: '8px',
      background: 'rgba(9,20,14,0.78)',
      font: '13px system-ui, sans-serif',
      whiteSpace: 'nowrap',
      display: 'none',
    });

    // One context-sensitive thumb action: Gather normally, Tame beside a
    // wild creature. Same spot, distinct color, explicit cost in the target
    // line — no second button fighting the joystick for the bottom-left.
    this.actionButton = uiButton('Gather', () =>
      this.tameMode ? this.actions.onTameCreature() : this.actions.onAction(),
    );
    this.actionButton.setAttribute('aria-label', 'Gather');
    Object.assign(this.actionButton.style, {
      position: 'absolute',
      right: 'calc(env(safe-area-inset-right) + 18px)',
      bottom: 'calc(env(safe-area-inset-bottom) + 34px)',
      width: '72px',
      height: '72px',
      borderRadius: '50%',
      background: 'rgba(47,107,67,0.92)',
      fontWeight: '700',
    });

    this.craftButton = railButton('🛠', 'Craft', () => this.toggleCraft());
    this.craftButton.style.bottom = RAIL_BOTTOMS.craft;

    this.creatureButton = railButton('Cr', 'Creatures', () => this.toggleCreatures());
    this.creatureButton.style.bottom = RAIL_BOTTOMS.creatures;
    this.creatureButton.style.display = 'none';
    this.creaturePanel = div({
      position: 'absolute',
      right: 'calc(env(safe-area-inset-right) + 94px)',
      bottom: 'calc(env(safe-area-inset-bottom) + 94px)',
      width: 'min(270px, calc(100vw - 110px))',
      padding: '14px',
      borderRadius: '12px',
      background: 'rgba(9,20,14,0.97)',
      border: '1px solid rgba(255,255,255,0.18)',
      boxShadow: '0 6px 22px rgba(0,0,0,0.4)',
      display: 'none',
      pointerEvents: 'auto',
      font: '14px system-ui, sans-serif',
    });
    this.creaturePanel.setAttribute('role', 'dialog');
    this.creaturePanel.setAttribute('aria-label', 'Creature roster and assignments');
    wireDisclosure(this.creatureButton, this.creaturePanel, 'creature-panel');
    const workerHeading = document.createElement('strong');
    workerHeading.textContent = 'Creature roster';
    this.creatureRoster = div({ marginTop: '2px' });
    this.creatureStatus = div({
      marginTop: '12px', padding: '10px 12px', borderRadius: '9px',
      background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.1)',
      fontSize: '12px', lineHeight: '1.45', opacity: '0.9',
    });
    const assignments = div({ display: 'grid', gap: '7px', marginTop: '4px' });
    for (const role of ['follow', 'work', 'rest'] as const) {
      const button = uiButton('', () => this.assignSelectedCreature(role));
      Object.assign(button.style, {
        minWidth: '0', minHeight: '58px', padding: '8px 10px',
        background: 'rgba(30,48,37,0.94)', textAlign: 'left', lineHeight: '1.25',
      });
      this.setAssignmentButtonContent(button, role);
      button.setAttribute('aria-label', `${role[0]!.toUpperCase() + role.slice(1)} selected creature`);
      this.assignmentButtons.set(role, button);
      assignments.appendChild(button);
    }
    const withdraw = div({ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '7px', marginTop: '4px' });
    for (const resource of ['wood', 'stone', 'fiber'] as const) {
      const button = uiButton(`Take ${resource}`, () => this.actions.onWithdrawFromCache(resource));
      Object.assign(button.style, { minWidth: '0', minHeight: '44px', padding: '6px 3px', fontSize: '11px', background: 'rgba(30,48,37,0.94)' });
      this.withdrawButtons.set(resource, button);
      withdraw.appendChild(button);
    }
    this.creaturePanel.append(
      workerHeading, this.creatureRoster, this.creatureStatus,
      paletteSection('Assignment'), assignments,
      paletteSection('Field cache'), withdraw,
    );

    this.statsButton = railButton('★', 'Character', () => this.toggleStats());
    this.statsButton.style.bottom = RAIL_BOTTOMS.stats;
    this.statsPanel = div({
      position: 'absolute', right: 'calc(env(safe-area-inset-right) + 94px)',
      top: 'calc(env(safe-area-inset-top) + 64px)', width: 'min(300px, calc(100vw - 110px))',
      maxHeight: 'calc(100vh - 140px)', overflowY: 'auto', padding: '14px', borderRadius: '12px',
      background: 'rgba(9,20,14,0.97)', border: '1px solid rgba(255,255,255,0.18)',
      boxShadow: '0 6px 22px rgba(0,0,0,0.4)', display: 'none', pointerEvents: 'auto',
      font: '14px system-ui, sans-serif', boxSizing: 'border-box', zIndex: '3',
    });
    this.statsPanel.setAttribute('role', 'dialog');
    this.statsPanel.setAttribute('aria-label', 'Character stats');
    wireDisclosure(this.statsButton, this.statsPanel, 'stats-panel');
    const statsHeading = document.createElement('strong');
    statsHeading.textContent = 'Character';
    this.statsSummary = div({
      marginTop: '10px', padding: '10px 12px', borderRadius: '9px', lineHeight: '1.5',
      background: 'rgba(255,255,255,0.055)', border: '1px solid rgba(255,255,255,0.1)', opacity: '0.92',
    });
    this.statsPanel.append(statsHeading, this.statsSummary, this.inventory, paletteSection('Attributes'));
    for (const attribute of ATTRIBUTE_IDS) {
      const button = uiButton('', () => this.actions.onSpendAttribute(attribute));
      paletteCard(button);
      button.style.lineHeight = '1.35';
      this.attributeButtons.set(attribute, button);
      this.statsPanel.appendChild(button);
    }

    this.craftPanel = div({
      position: 'absolute',
      right: 'calc(env(safe-area-inset-right) + 94px)',
      bottom: 'calc(env(safe-area-inset-bottom) + 94px)',
      width: 'min(280px, calc(100vw - 110px))',
      maxHeight: '58vh',
      overflowY: 'auto',
      overscrollBehavior: 'contain',
      padding: '14px',
      borderRadius: '12px',
      background: 'rgba(9,20,14,0.97)',
      border: '1px solid rgba(255,255,255,0.18)',
      boxShadow: '0 6px 22px rgba(0,0,0,0.4)',
      display: 'none',
      pointerEvents: 'auto',
      font: '14px system-ui, sans-serif',
    });
    this.craftPanel.setAttribute('aria-label', 'Handcraft');
    wireDisclosure(this.craftButton, this.craftPanel, 'craft-panel');
    const heading = document.createElement('strong');
    heading.textContent = 'Handcraft';
    const recipe = div({ marginTop: '2px', lineHeight: '1.4' });
    this.craftPanel.append(heading, paletteSection('Recipes'));
    for (const definition of TOOL_DEFINITIONS) {
      const recipeButton = paletteCard(uiButton('', () => actions.onCraftTool(definition.definitionId)));
      this.recipeButtons.set(definition.definitionId, recipeButton);
      recipe.appendChild(recipeButton);
    }
    const snare = paletteCard(uiButton('', () => actions.onCraftSnare()));
    snare.replaceChildren(this.cardTitle('Taming Snare', '1 wood + 2 fiber'), this.cardDetail('Tame weakened creatures during encounters.'));
    snare.setAttribute('aria-label', 'Craft Taming Snare');
    recipe.appendChild(snare);
    const arrows = paletteCard(uiButton('', () => actions.onCraftArrows()));
    arrows.replaceChildren(this.cardTitle('Arrows ×3', '1 wood + 1 stone'), this.cardDetail('Ammunition for ranged encounter actions.'));
    arrows.setAttribute('aria-label', 'Craft Arrows');
    recipe.appendChild(arrows);
    this.toolsList = div({ marginTop: '2px' });
    this.craftPanel.append(recipe, paletteSection('Your tools'), this.toolsList);

    this.feedback = div({
      position: 'absolute',
      left: '50%',
      top: '22%',
      transform: 'translateX(-50%)',
      maxWidth: '86vw',
      padding: '8px 12px',
      borderRadius: '8px',
      background: 'rgba(9,20,14,0.9)',
      opacity: '0',
      transition: 'opacity 0.15s',
      font: '600 14px system-ui, sans-serif',
      lineHeight: '1.35',
      textAlign: 'center',
    });
    this.feedback.setAttribute('role', 'status');
    this.feedback.setAttribute('aria-live', 'polite');

    this.root.append(this.target, this.actionButton, this.craftButton, this.creatureButton, this.statsButton, this.craftPanel, this.creaturePanel, this.statsPanel, this.feedback);
    parent.appendChild(this.root);
    this.progressionGuide = new ProgressionGuide(this.root, this.state);
    this.refresh(null);
  }

  /** Move the former standalone panels into the shared gameplay menu. */
  attachToMenu(menu: InventoryPanel): void {
    this.craftButton.remove();
    this.creatureButton.remove();
    this.statsButton.remove();
    menu.registerTab('craft', 'Craft', this.craftPanel, () => {
      this.craftPanel.style.display = 'block';
      this.refreshTools();
    });
    this.progressionGuide.attachToMenu(menu);
    menu.registerTab('creatures', 'Creatures', this.creaturePanel, () => {
      this.creaturePanel.style.display = 'block';
      this.refreshCreatures();
    });
    menu.registerTab('character', 'Character', this.statsPanel, () => {
      this.statsPanel.style.display = 'block';
      this.refreshStats();
    });
  }

  refresh(
    targetNode: ResourceNodeState | null,
    targetDrop: GroundDropState | null = null,
    targetCreature: WildCreatureState | null = null,
    targetNpc: NpcDefinition | null = null,
  ): void {
    const tool = equippedTool(this.state);
    const toolText = tool
      ? `${toolDefinition(tool.definitionId).displayName} ${tool.durability}/${tool.maxDurability}`
      : this.state.tools.some((item) => item.durability === 0)
        ? 'Tool broken'
        : 'Hands';
    const slots = `Slots ${usedInventorySlots(this.state)}/${inventoryCapacity(this.state)}`;
    this.inventory.textContent = `Lv ${this.state.player.level}  ·  HP ${this.state.player.hp}/${this.state.player.maxHp}  ·  SP ${this.state.player.stamina}/${this.state.player.maxStamina}  ·  Wood ${this.state.inventory.wood}  ·  Stone ${this.state.inventory.stone}  ·  Fiber ${this.state.inventory.fiber}  ·  Snares ${this.state.consumables.tamingSnares}  ·  Arrows ${this.state.consumables.arrows}  ·  ${slots}  ·  ${toolText}`;
    for (const definition of TOOL_DEFINITIONS) {
      const recipeButton = this.recipeButtons.get(definition.definitionId)!;
      const missing = Object.entries(definition.craftCost)
        .map(([resource, amount]) => `${amount} ${resource}`)
        .join(' + ');
      recipeButton.disabled = Object.entries(definition.craftCost).some(
        ([resource, amount]) => this.state.inventory[resource as keyof typeof this.state.inventory] < amount,
      );
      recipeButton.replaceChildren(
        this.cardTitle(definition.displayName, missing),
        this.cardDetail(`${definition.kind[0]!.toUpperCase() + definition.kind.slice(1)} · ${definition.maxDurability} durability · equips on creation`),
      );
      if (definition.definitionId === 'wooden-pick') {
        recipeButton.setAttribute('aria-label', 'Craft & equip');
        recipeButton.title = `Wooden Pick: ${missing}`;
      } else {
        recipeButton.removeAttribute('aria-label');
        recipeButton.title = '';
      }
    }
    this.refreshTools();
    this.progressionGuide.refresh();
    this.refreshAction(targetNode, targetDrop, targetCreature, targetNpc);
    this.refreshCreatures();
    this.refreshStats();
  }

  private refreshAction(
    targetNode: ResourceNodeState | null,
    targetDrop: GroundDropState | null,
    targetCreature: WildCreatureState | null,
    targetNpc: NpcDefinition | null,
  ): void {
    this.tameMode = targetCreature !== null;
    const definition = targetCreature ? creatureDefinition(targetCreature.speciesId) : null;
    this.actionButton.textContent = targetNpc ? 'Talk' : this.tameMode ? 'Encounter' : 'Gather';
    this.actionButton.setAttribute('aria-label', targetNpc ? `Talk to ${targetNpc.name}` : this.tameMode ? 'Start encounter' : 'Gather');
    this.actionButton.style.background = targetNpc
      ? 'rgba(168,116,47,0.96)'
      : this.tameMode ? 'rgba(113,75,132,0.94)' : 'rgba(47,107,67,0.92)';
    this.actionButton.disabled = false;
    this.actionButton.style.opacity = this.actionButton.disabled ? '0.6' : '1';

    if (targetNpc) {
      this.target.textContent = `${targetNpc.name}, ${targetNpc.title} · E / Space`;
      this.target.style.display = 'block';
    } else if (targetCreature) {
      this.target.textContent = `Wild ${definition!.displayName} · start encounter`;
      this.target.style.display = 'block';
    } else if (targetNode) {
      const name = targetNode.kind === 'tree' ? 'Tree' : targetNode.kind === 'stone' ? 'Stone' : 'Plant';
      this.target.textContent = `${name} ${targetNode.hp}/${targetNode.maxHp} · E / Space`;
      this.target.style.display = 'block';
    } else if (targetDrop) {
      this.target.textContent = `${targetDrop.resource} ×${targetDrop.amount} on the ground · E / Space`;
      this.target.style.display = 'block';
    } else {
      this.target.style.display = 'none';
    }
  }

  /** Per-tool durability rows with explicit Repair/Equip (never implicit). */
  private refreshTools(): void {
    this.toolsList.textContent = '';
    if (this.state.tools.length === 0) {
      const empty = div({
        marginTop: '10px', padding: '12px', borderRadius: '9px',
        background: 'rgba(255,255,255,0.045)', opacity: '0.68', fontSize: '12px',
      });
      empty.textContent = 'Craft a tool and it will appear here for repair or equipping.';
      this.toolsList.appendChild(empty);
    }
    for (const tool of this.state.tools) {
      const row = div({
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '10px', padding: '10px 12px',
        border: '1px solid rgba(255,255,255,0.16)', borderRadius: '9px',
        background: 'rgba(30,48,37,0.94)',
      });
      const label = div({ flex: '1', fontSize: '13px', lineHeight: '1.3' });
      const equipped = tool.instanceId === this.state.equippedToolId;
      label.textContent = `${toolDefinition(tool.definitionId).displayName} ${tool.durability}/${tool.maxDurability}${equipped ? ' · equipped' : ''}`;
      const equip = uiButton('Equip', () => this.actions.onEquipTool(tool.instanceId));
      equip.style.minHeight = '44px';
      equip.disabled = equipped || tool.durability <= 0;
      const repair = uiButton('Repair', () => this.actions.onRepairTool(tool.instanceId));
      repair.style.minHeight = '44px';
      repair.style.background = 'rgba(30,48,37,0.94)';
      repair.disabled = tool.durability >= tool.maxDurability;
      row.append(label, equip, repair);
      this.toolsList.appendChild(row);
    }
  }

  toggleCraft(): void {
    const opening = this.craftPanel.style.display === 'none';
    this.craftPanel.style.display = opening ? 'block' : 'none';
    this.craftButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) this.actions.onCraftOpened();
  }

  closeCraft(): void {
    this.craftPanel.style.display = 'none';
    this.craftButton.setAttribute('aria-expanded', 'false');
  }

  private toggleStats(): void {
    const opening = this.statsPanel.style.display === 'none';
    this.statsPanel.style.display = opening ? 'block' : 'none';
    this.statsButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) this.refreshStats();
  }

  private refreshStats(): void {
    const player = this.state.player;
    this.statsSummary.textContent = `Level ${player.level} · XP ${player.xp}/${xpToNextLevel(player.level)} · ${player.attributePoints} point${player.attributePoints === 1 ? '' : 's'} available`;
    for (const attribute of ATTRIBUTE_IDS) {
      const button = this.attributeButtons.get(attribute)!;
      button.replaceChildren();
      const label = div({ fontWeight: '700' });
      label.textContent = `${ATTRIBUTE_LABELS[attribute]}  ${player.attributes[attribute]}${player.attributePoints > 0 ? '  +' : ''}`;
      const description = div({ marginTop: '3px', fontSize: '11px', fontWeight: '400', opacity: '0.78' });
      description.textContent = ATTRIBUTE_DESCRIPTIONS[attribute];
      button.append(label, description);
      button.setAttribute('aria-label', `${ATTRIBUTE_LABELS[attribute]} ${player.attributes[attribute]}. ${ATTRIBUTE_DESCRIPTIONS[attribute]}${player.attributePoints > 0 ? ' Spend one attribute point.' : ''}`);
      button.disabled = player.attributePoints <= 0;
    }
  }

  private toggleCreatures(): void {
    const opening = this.creaturePanel.style.display === 'none';
    this.creaturePanel.style.display = opening ? 'block' : 'none';
    this.creatureButton.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) this.refreshCreatures();
  }

  private assignSelectedCreature(role: CreatureRole): void {
    const creature = this.state.ownedCreatures.find((candidate) => candidate.id === this.selectedCreatureId);
    if (creature) this.actions.onSetCreatureRole(creature.id, role);
  }

  private refreshCreatures(): void {
    const owned = this.state.ownedCreatures;
    if (!owned.some((creature) => creature.id === this.selectedCreatureId)) {
      this.selectedCreatureId = owned[0]?.id ?? null;
    }
    const creature = owned.find((candidate) => candidate.id === this.selectedCreatureId);
    this.creatureButton.style.display = creature ? 'flex' : 'none';
    if (!creature) {
      this.creatureRoster.replaceChildren();
      this.creatureStatus.textContent = 'No creatures tamed yet. Encounter a wild creature to add it to your roster.';
      for (const button of this.assignmentButtons.values()) button.disabled = true;
      for (const button of this.withdrawButtons.values()) button.disabled = true;
      return;
    }
    this.creatureRoster.replaceChildren();
    for (const rosterCreature of owned) {
      const rosterDefinition = creatureDefinition(rosterCreature.speciesId);
      const selected = rosterCreature.id === creature.id;
      const button = uiButton(`${rosterCreature.name} · ${rosterDefinition.displayName} · ${rosterCreature.role}`, () => {
        this.selectedCreatureId = rosterCreature.id;
        this.refreshCreatures();
      });
      paletteCard(button);
      button.style.borderColor = selected ? '#ffe08a' : 'rgba(255,255,255,0.16)';
      button.style.background = selected ? 'rgba(47,107,67,0.96)' : 'rgba(30,48,37,0.94)';
      button.setAttribute('aria-label', `Select ${rosterCreature.name}, ${rosterDefinition.displayName}, currently ${rosterCreature.role}`);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
      this.creatureRoster.appendChild(button);
    }
    const cache = fieldCache(this.state);
    const storage = cache?.storage ?? { wood: 0, stone: 0, fiber: 0 };
    const worksite = creature.worksiteId ? this.state.buildings.find((building) => building.id === creature.worksiteId) : null;
    const definition = creatureDefinition(creature.speciesId);
    const followers = owned.filter((candidate) => candidate.role === 'follow').length;
    const activeAbility = creature.role === 'follow' && definition.followMode === 'mount'
      ? ` · Mounted (${definition.travelSpeedMultiplier}× speed)`
      : '';
    this.creatureStatus.textContent = `${definition.followRole}${activeAbility} · Followers ${followers}/${MAX_ACTIVE_FOLLOWERS}${worksite ? ` · Worksite: ${worksite.definitionId}` : ''} · Cache: ${storage.wood} wood, ${storage.stone} stone, ${storage.fiber} fiber`;
    for (const [id, button] of this.assignmentButtons) {
      this.setAssignmentButtonContent(button, id, definition);
      button.disabled = id === 'work' && (!definition.work || !cache);
      button.title = id === 'work' && !definition.work ? 'Work role unlocks with a later facility' : '';
      button.style.borderColor = creature.role === id ? '#ffe08a' : 'rgba(255,255,255,0.16)';
      button.style.background = creature.role === id ? '#2f6b43' : 'rgba(30,48,37,0.94)';
    }
    for (const [resource, button] of this.withdrawButtons) {
      const amount = storage[resource];
      button.textContent = `Take ${resource} (${amount})`;
      button.disabled = !cache || amount === 0;
    }
  }

  private setAssignmentButtonContent(
    button: HTMLButtonElement,
    role: CreatureRole,
    definition?: ReturnType<typeof creatureDefinition>,
  ): void {
    const label = role === 'follow' && definition?.followMode === 'mount'
      ? 'Mount'
      : role[0]!.toUpperCase() + role.slice(1);
    const description = role === 'follow'
      ? definition ? `Travels with you · ${definition.followRole}` : 'Travels with you and provides a species bonus.'
      : role === 'work'
        ? definition?.work
          ? `Automatically gathers ${definition.work.resource} at the nearest eligible worksite.`
          : 'Automatically gathers resources at an eligible worksite.'
        : 'Stops following or working and remains inactive.';
    const title = div({ fontWeight: '700', fontSize: '13px' });
    title.textContent = label;
    const detail = div({ marginTop: '3px', fontWeight: '400', fontSize: '11px', opacity: '0.78' });
    detail.textContent = description;
    button.replaceChildren(title, detail);
  }

  showFeedback(message: string, success: boolean): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.feedback.textContent = message;
    this.feedback.style.color = success ? '#e8f0ea' : '#ffd18a';
    this.feedback.style.opacity = '1';
    this.feedbackTimer = setTimeout(() => {
      this.feedback.style.opacity = '0';
      this.feedbackTimer = null;
    }, 1300);
  }

  private cardTitle(nameText: string, metaText: string): HTMLDivElement {
    const title = div({ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' });
    const name = document.createElement('strong');
    name.textContent = nameText;
    const meta = document.createElement('span');
    meta.textContent = metaText;
    Object.assign(meta.style, { opacity: '0.82', fontSize: '12px', fontWeight: '400', textAlign: 'right' });
    title.append(name, meta);
    return title;
  }

  private cardDetail(text: string): HTMLDivElement {
    const detail = div({ marginTop: '3px', opacity: '0.72', fontSize: '12px', fontWeight: '400' });
    detail.textContent = text;
    return detail;
  }

  destroy(): void {
    if (this.feedbackTimer) clearTimeout(this.feedbackTimer);
    this.progressionGuide.destroy();
    this.root.remove();
  }
}
