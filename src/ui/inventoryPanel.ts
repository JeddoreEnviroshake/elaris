import { BAG_ITEM_LABELS, INVENTORY_SLOTS, toolDefinition } from '../config/balance';
import { nextRepairCost, usedInventorySlots } from '../simulation/gameplayCommands';
import { bagItemWeightHundredths, bagWeightHundredths, effectiveBagCapacityHundredths, formatWeight, isBagOverweight } from '../simulation/bagWeight';
import type { GameState, ResourceId, ToolInstance } from '../simulation/state';
import { canAffordCost, stockedCostText } from './costs';
import { RAIL_BOTTOMS, div, railButton, uiButton, wireDisclosure } from './controls';
import { durabilityColor, inventorySlotEntries } from './inventorySlots';
import { setUiIcon } from './icons';

export interface InventoryPanelActions {
  /** A tool cell was tapped; equipping stays explicit. */
  onEquipTool: (toolId: string) => void;
  /** Restore a worn tool to full, charged at the same price the Craft panel used. */
  onRepairTool: (toolId: string) => void;
  /** Put a tool on the ground, wear and ranks intact. */
  onDropTool: (toolId: string) => void;
  /** Put a tool on the hotbar — the way back after one was long-pressed off. */
  onAssignHotbar?: (toolId: string) => void;
  /** Whether a tool already occupies a hotbar slot, so the card can say so. */
  isOnHotbar?: (toolId: string) => boolean;
  /** Split one resource stack at a selected slot boundary. */
  onSplitStack: (resource: ResourceId, stackIndex: number, amount: number) => void;
  /** Drop the whole selected resource stack into the world. */
  onDropStack: (resource: ResourceId, stackIndex: number) => void;
  /** File a carried blueprint at a workbench, making it permanent. */
  onRegisterBlueprint?: (instanceId: string) => void;
  /** Put a carried blueprint on the ground — a trade handoff, or shedding heat. */
  onDropBlueprint?: (instanceId: string) => void;
  /** Break a carried blueprint down for Draft Parchment, at a workbench. */
  onScrapBlueprint?: (instanceId: string) => void;
  /** The panel opened; the scene closes competing panels (craft/build). */
  onOpened: () => void;
}

export type MenuTabId = 'bag' | 'craft' | 'blueprints' | 'quests' | 'creatures' | 'character' | 'shelter' | 'paddock' | 'supply-run' | 'garden';

interface MenuTab {
  button: HTMLButtonElement;
  content: HTMLElement;
  onActivate: (() => void) | undefined;
}

const TAB_ORDER: readonly MenuTabId[] = ['bag', 'craft', 'shelter', 'paddock', 'supply-run', 'garden', 'blueprints', 'quests', 'creatures', 'character'];

/**
 * Shared gameplay menu: a Menu toggle plus a centered, tabbed panel whose Bag
 * tab contains the slot grid mirroring the
 * simulation's slot accounting — resource stacks, one cell per tool (with a
 * durability bar; tap for its action card), and dimmed empties. Tapping any
 * occupied cell asks what to do with it: split/drop for a stack, repair/drop
 * for a tool. Equipping stays on the hotbar and the Craft tool list.
 */
export class InventoryPanel {
  private readonly root: HTMLDivElement;
  private readonly menuButton: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly slotCount: HTMLSpanElement;
  private readonly grid: HTMLDivElement;
  private readonly heading: HTMLElement;
  private readonly tabs: HTMLDivElement;
  private readonly bagContent: HTMLDivElement;
  private readonly tabViews = new Map<MenuTabId, MenuTab>();
  private activeTab: MenuTabId = 'bag';
  private actionOverlay: HTMLDivElement | null = null;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly actions: InventoryPanelActions,
  ) {
    this.root = div({ position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '13' });

    this.menuButton = railButton('bag', 'Menu', () => this.toggle());
    this.menuButton.style.bottom = RAIL_BOTTOMS.menu;

    this.panel = div({
      position: 'absolute',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: 'min(560px, calc(100vw - 24px))',
      height: 'min(570px, calc(100vh - 48px))',
      maxHeight: '76vh',
      overflow: 'hidden',
      overscrollBehavior: 'contain',
      padding: '14px',
      boxSizing: 'border-box',
      borderRadius: '12px',
      background: 'rgba(9,20,14,0.97)',
      border: '1px solid rgba(255,255,255,0.18)',
      boxShadow: '0 6px 22px rgba(0,0,0,0.4)',
      display: 'none',
      pointerEvents: 'auto',
      font: '14px system-ui, sans-serif',
      color: '#e8f0ea',
    });
    this.panel.classList.add('elaris-panel');

    this.panel.setAttribute('aria-label', 'Game menu');
    wireDisclosure(this.menuButton, this.panel, 'game-menu-panel');

    const header = div({ display: 'flex', alignItems: 'center', gap: '10px' });
    this.heading = document.createElement('strong');
    this.heading.textContent = 'Bag';
    this.slotCount = document.createElement('span');
    Object.assign(this.slotCount.style, { flex: '1', opacity: '0.75', fontSize: '13px' });
    const close = uiButton('Close', () => this.close());
    Object.assign(close.style, { minHeight: '44px', background: 'rgba(30,48,37,0.94)' });
    header.append(this.heading, this.slotCount, close);

    this.tabs = div({
      display: 'flex',
      flexWrap: 'nowrap',
      overflowX: 'auto',
      touchAction: 'pan-x',
      gap: '5px',
      marginTop: '10px',
      paddingBottom: '10px',
      borderBottom: '1px solid rgba(255,255,255,0.12)',
    });

    this.bagContent = div({
      height: 'calc(100% - 104px)', overflowY: 'auto', overscrollBehavior: 'contain', touchAction: 'pan-y',
    });
    this.bagContent.style.setProperty('-webkit-overflow-scrolling', 'touch');

    this.grid = div({
      display: 'grid',
      gridTemplateColumns: 'repeat(5, 1fr)',
      gap: '8px',
      marginTop: '12px',
    });

    this.bagContent.append(this.grid);
    this.panel.append(header, this.tabs, this.bagContent);
    this.root.append(this.menuButton, this.panel);
    parent.appendChild(this.root);
    this.registerTab('bag', 'Bag', this.bagContent, () => this.refresh());
  }

  get open(): boolean {
    return this.panel.style.display !== 'none';
  }

  toggle(): void {
    if (this.open) this.close();
    else {
      this.openTab(this.activeTab);
    }
  }

  close(): void {
    this.closeItemActions();
    this.panel.style.display = 'none';
    this.menuButton.setAttribute('aria-expanded', 'false');
  }

  /** Add one of the existing gameplay panels to the shared menu popup. */
  registerTab(id: MenuTabId, label: string, content: HTMLElement, onActivate?: () => void): void {
    const button = uiButton(label, () => this.openTab(id));
    Object.assign(button.style, {
      flex: '0 0 auto', minWidth: '64px', minHeight: '42px', padding: '6px 8px', fontSize: '12px',
      background: 'rgba(30,48,37,0.94)',
    });
    button.setAttribute('role', 'tab');
    content.setAttribute('role', 'tabpanel');
    content.style.position = 'static';
    content.style.width = 'auto';
    content.style.maxHeight = 'none';
    content.style.height = 'calc(100% - 104px)';
    content.style.boxSizing = 'border-box';
    content.style.margin = '0';
    content.style.padding = id === 'bag' ? '0' : '12px 2px 2px';
    content.style.border = '0';
    content.style.borderRadius = '0';
    content.style.boxShadow = 'none';
    content.style.background = 'transparent';
    content.style.overflowY = 'auto';
    content.style.overscrollBehavior = 'contain';
    content.style.touchAction = 'pan-y';
    content.style.setProperty('-webkit-overflow-scrolling', 'touch');
    content.style.display = 'none';
    if (content.parentElement !== this.panel) this.panel.appendChild(content);
    this.tabs.appendChild(button);
    this.tabViews.set(id, { button, content, onActivate });
    for (const tabId of TAB_ORDER) {
      const tab = this.tabViews.get(tabId);
      if (tab) this.tabs.appendChild(tab.button);
    }
  }

  /** Open the popup directly to a tab; calling it for the active open tab toggles it closed. */
  toggleTab(id: MenuTabId): void {
    if (this.open && this.activeTab === id) this.close();
    else this.openTab(id);
  }

  openTab(id: MenuTabId): void {
    const next = this.tabViews.get(id);
    if (!next) return;
    this.actions.onOpened();
    this.activeTab = id;
    this.panel.style.display = 'block';
    this.menuButton.setAttribute('aria-expanded', 'true');
    this.heading.textContent = id === 'bag' ? 'Bag' : next.button.textContent ?? 'Bag';
    this.slotCount.style.display = id === 'bag' ? '' : 'none';
    for (const [tabId, tab] of this.tabViews) {
      const selected = tabId === id;
      tab.content.style.display = selected ? 'block' : 'none';
      tab.button.setAttribute('aria-selected', selected ? 'true' : 'false');
      tab.button.style.background = selected ? '#2f6b43' : 'rgba(30,48,37,0.94)';
      tab.button.style.borderColor = selected ? '#ffe08a' : 'rgba(255,255,255,0.16)';
    }
    next.button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    next.onActivate?.();
  }

  /** Rebuild the grid from state; cheap at INVENTORY_SLOTS cells. */
  refresh(): void {
    if (!this.open) return;
    const currentWeight = bagWeightHundredths(this.state);
    const capacity = effectiveBagCapacityHundredths(this.state);
    this.slotCount.textContent = `${usedInventorySlots(this.state)}/${INVENTORY_SLOTS} slots · Weight ${formatWeight(currentWeight)}/${formatWeight(capacity)}`;
    this.slotCount.style.color = isBagOverweight(this.state) ? '#ff9b7b' : '';
    this.grid.textContent = '';
    for (const entry of inventorySlotEntries(this.state)) {
      if (entry.kind === 'resource') {
        const cell = this.cell('button') as HTMLButtonElement;
        cell.setAttribute('aria-label', `${BAG_ITEM_LABELS[entry.resource]} stack, ${entry.amount}`);
        cell.addEventListener('click', (event) => {
          event.stopPropagation();
          this.openItemActions(entry.resource, entry.stackIndex, entry.amount);
        });
        const name = div({ fontSize: '12px', fontWeight: '600' });
        name.textContent = BAG_ITEM_LABELS[entry.resource];
        const amount = div({ fontSize: '12px', opacity: '0.8' });
        const totalWeight = entry.amount * bagItemWeightHundredths(this.state, entry.resource);
        amount.textContent = `×${entry.amount} · Weight ${formatWeight(totalWeight)}`;
        cell.append(name, amount);
      } else if (entry.kind === 'blueprint') {
        // Unregistered, so it reads as cargo rather than as knowledge: the
        // name is plain, and the cell says what it is still waiting for.
        const cell = this.cell('button') as HTMLButtonElement;
        cell.style.borderColor = '#ffd18a';
        const name = entry.carried.blueprintId.replace(/-/g, ' ');
        cell.setAttribute('aria-label', `Blueprint: ${name}, unregistered`);
        cell.addEventListener('click', (event) => {
          event.stopPropagation();
          this.openBlueprintActions(entry.carried.instanceId, name);
        });
        const icon = div({ display: 'grid', placeItems: 'center', lineHeight: '1' });
        setUiIcon(icon, 'blueprint', 20);
        const label = div({ fontSize: '11px', fontWeight: '600', textTransform: 'capitalize' });
        label.textContent = name;
        const hint = div({ fontSize: '10px', opacity: '0.8', color: '#ffd18a' });
        hint.textContent = 'Register at a workbench';
        cell.append(icon, label, hint);
      } else if (entry.kind === 'tool') {
        const cell = this.cell('button') as HTMLButtonElement;
        const { tool, equipped } = entry;
        cell.style.borderColor = equipped ? '#ffe08a' : 'rgba(255,255,255,0.16)';
        // A tool cell opens the same action card a resource stack does, so it is
        // a menu button rather than the equip toggle it used to be.
        cell.setAttribute('aria-haspopup', 'dialog');
        cell.setAttribute(
          'aria-label',
          `${toolDefinition(tool.definitionId).displayName} ${tool.durability}/${tool.maxDurability}${equipped ? ', equipped' : ''}`,
        );
        cell.addEventListener('click', (event) => {
          event.stopPropagation();
          this.openToolActions(tool);
        });
        const icon = div({ display: 'grid', placeItems: 'center', lineHeight: '1' });
        setUiIcon(icon, toolDefinition(tool.definitionId).kind, 20);
        const bar = div({
          width: '80%',
          height: '4px',
          marginTop: '5px',
          borderRadius: '2px',
          background: 'rgba(255,255,255,0.14)',
          overflow: 'hidden',
        });
        const ratio = tool.durability / tool.maxDurability;
        const fill = div({
          width: `${Math.round(ratio * 100)}%`,
          height: '100%',
          borderRadius: '2px',
          background: durabilityColor(ratio),
        });
        bar.appendChild(fill);
        cell.append(icon, bar);
      } else {
        const cell = this.cell('div');
        cell.style.opacity = '0.35';
      }
    }
  }

  private cell(tag: 'div' | 'button'): HTMLElement {
    const cell = document.createElement(tag);
    Object.assign(cell.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      aspectRatio: '1',
      padding: '2px',
      border: '1px solid rgba(255,255,255,0.16)',
      borderRadius: '9px',
      color: '#e8f0ea',
      background: 'rgba(30,48,37,0.94)',
      font: '600 12px system-ui, sans-serif',
      cursor: tag === 'button' ? 'pointer' : 'default',
      touchAction: 'manipulation',
    } satisfies Partial<CSSStyleDeclaration>);
    this.grid.appendChild(cell);
    return cell;
  }

  private openItemActions(resource: ResourceId, stackIndex: number, amount: number): void {
    this.closeItemActions();
    const overlay = div({
      position: 'absolute', inset: '0', zIndex: '4', display: 'grid', placeItems: 'center',
      padding: '18px', background: 'rgba(3,8,5,0.72)', borderRadius: '12px',
    });
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${BAG_ITEM_LABELS[resource]} stack actions`);
    const card = div({
      width: 'min(320px, 100%)', padding: '18px', borderRadius: '12px',
      background: '#13271a', border: '1px solid rgba(255,255,255,0.2)',
      boxShadow: '0 8px 30px rgba(0,0,0,0.55)', boxSizing: 'border-box',
    });
    const title = document.createElement('strong');
    title.textContent = `${BAG_ITEM_LABELS[resource]} ×${amount}`;
    const actions = div({ display: 'grid', gap: '9px', marginTop: '14px' });
    const split = uiButton('Split Stack', () => this.showSplitPrompt(card, resource, stackIndex, amount));
    split.disabled = amount < 2;
    const drop = uiButton('Drop', () => {
      this.closeItemActions();
      this.actions.onDropStack(resource, stackIndex);
    });
    drop.style.background = '#71392f';
    const cancel = uiButton('Cancel', () => this.closeItemActions());
    actions.append(split, drop, cancel);
    card.append(title, actions);
    overlay.appendChild(card);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) this.closeItemActions(); });
    this.panel.appendChild(overlay);
    this.actionOverlay = overlay;
    split.focus();
  }

  /**
   * The tool popup, opened by tapping a tool cell — the same gesture and the
   * same card a resource stack uses, so one tap on anything in the Bag asks
   * what to do with it.
   *
   * Repair is priced carried-over-required and disabled when the bag is short,
   * exactly as the Craft panel priced it, so the button never fails on click.
   * Assign Hotbar is the counterpart to the bar's press-and-hold removal, and
   * the only way back onto the bar for a tool sitting past the fifth slot.
   */
  private openToolActions(tool: ToolInstance): void {
    this.closeItemActions();
    const definition = toolDefinition(tool.definitionId);
    const overlay = div({
      position: 'absolute', inset: '0', zIndex: '4', display: 'grid', placeItems: 'center',
      padding: '18px', background: 'rgba(3,8,5,0.72)', borderRadius: '12px',
    });
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${definition.displayName} actions`);
    const card = div({
      width: 'min(320px, 100%)', padding: '18px', borderRadius: '12px',
      background: '#13271a', border: '1px solid rgba(255,255,255,0.2)',
      boxShadow: '0 8px 30px rgba(0,0,0,0.55)', boxSizing: 'border-box',
    });
    const title = document.createElement('strong');
    const equipped = tool.instanceId === this.state.equippedToolId;
    title.textContent = `${definition.displayName}${equipped ? ' · equipped' : ''}`;
    const note = div({ marginTop: '6px', fontSize: '12px', opacity: '0.8' });
    note.textContent = `Durability ${tool.durability}/${tool.maxDurability}`;
    const actions = div({ display: 'grid', gap: '9px', marginTop: '14px' });

    const worn = tool.durability < tool.maxDurability;
    const cost = nextRepairCost(this.state, tool);
    const repair = uiButton(worn ? `Repair (${stockedCostText(this.state, cost)})` : 'Repair', () => {
      this.closeItemActions();
      this.actions.onRepairTool(tool.instanceId);
    });
    repair.disabled = !worn || !canAffordCost(this.state, cost);
    // Already-assigned tools keep the button on screen, disabled, so the card
    // answers "is this on my bar?" without the player having to go look.
    const onHotbar = this.actions.isOnHotbar?.(tool.instanceId) ?? false;
    const assign = uiButton(onHotbar ? 'On Hotbar' : 'Assign Hotbar', () => {
      this.closeItemActions();
      this.actions.onAssignHotbar?.(tool.instanceId);
    });
    assign.disabled = onHotbar || !this.actions.onAssignHotbar;
    const drop = uiButton('Drop', () => {
      this.closeItemActions();
      this.actions.onDropTool(tool.instanceId);
    });
    drop.style.background = '#71392f';
    const cancel = uiButton('Cancel', () => this.closeItemActions());
    actions.append(repair, assign, drop, cancel);
    card.append(title, note, actions);
    overlay.appendChild(card);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) this.closeItemActions(); });
    this.panel.appendChild(overlay);
    this.actionOverlay = overlay;
    ([repair, assign, drop].find((button) => !button.disabled) ?? cancel).focus();
  }

  /**
   * Register, or put it down. Dropping is a real choice rather than a mistake:
   * it is how a trade is handed over, and how a player sheds the raider heat
   * when a run home has stopped being survivable.
   */
  private openBlueprintActions(instanceId: string, name: string): void {
    this.closeItemActions();
    const overlay = div({
      position: 'absolute', inset: '0', zIndex: '4', display: 'grid', placeItems: 'center',
      padding: '18px', background: 'rgba(3,8,5,0.72)', borderRadius: '12px',
    });
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Blueprint actions: ${name}`);
    const card = div({
      width: 'min(320px, 100%)', padding: '18px', borderRadius: '12px',
      background: '#13271a', border: '1px solid rgba(255,255,255,0.2)',
      boxShadow: '0 8px 30px rgba(0,0,0,0.55)', boxSizing: 'border-box',
    });
    const title = document.createElement('strong');
    title.textContent = name;
    title.style.textTransform = 'capitalize';
    const note = div({ marginTop: '6px', fontSize: '12px', opacity: '0.8' });
    note.textContent = 'Unregistered. Raiders are drawn to it until it is filed at a workbench. '
      + 'Registering and scrapping both need a workbench; Tavi buys it anywhere.';
    const actions = div({ display: 'grid', gap: '9px', marginTop: '14px' });
    const register = uiButton(`Register ${name}`, () => {
      this.closeItemActions();
      this.actions.onRegisterBlueprint?.(instanceId);
    });
    register.style.background = '#2f5f3f';
    const scrap = uiButton('Scrap for Draft Parchment', () => {
      this.closeItemActions();
      this.actions.onScrapBlueprint?.(instanceId);
    });
    scrap.style.background = '#5a4a2a';
    const drop = uiButton('Drop', () => {
      this.closeItemActions();
      this.actions.onDropBlueprint?.(instanceId);
    });
    drop.style.background = '#71392f';
    const cancel = uiButton('Cancel', () => this.closeItemActions());
    actions.append(register, scrap, drop, cancel);
    card.append(title, note, actions);
    overlay.appendChild(card);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) this.closeItemActions(); });
    this.panel.appendChild(overlay);
    this.actionOverlay = overlay;
    register.focus();
  }

  private showSplitPrompt(card: HTMLDivElement, resource: ResourceId, stackIndex: number, amount: number): void {
    card.textContent = '';
    const label = document.createElement('label');
    label.textContent = `How many ${BAG_ITEM_LABELS[resource]} would you like to split?`;
    Object.assign(label.style, { display: 'block', fontWeight: '700', marginBottom: '10px' });
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.max = String(amount - 1);
    input.step = '1';
    input.value = String(Math.max(1, Math.floor(amount / 2)));
    input.setAttribute('aria-label', 'Split amount');
    Object.assign(input.style, {
      width: '100%', minHeight: '44px', padding: '8px 10px', boxSizing: 'border-box',
      borderRadius: '8px', border: '1px solid rgba(255,255,255,0.25)',
      background: '#08150d', color: '#e8f0ea', font: '16px system-ui, sans-serif',
    });
    const actions = div({ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px', marginTop: '12px' });
    const confirm = uiButton('Split', () => {
      const splitAmount = Number(input.value);
      if (!Number.isInteger(splitAmount) || splitAmount < 1 || splitAmount >= amount) {
        input.setCustomValidity(`Enter a whole number from 1 to ${amount - 1}`);
        input.reportValidity();
        return;
      }
      this.closeItemActions();
      this.actions.onSplitStack(resource, stackIndex, splitAmount);
    });
    const cancel = uiButton('Cancel', () => this.closeItemActions());
    actions.append(confirm, cancel);
    card.append(label, input, actions);
    input.focus();
    input.select();
  }

  private closeItemActions(): void {
    this.actionOverlay?.remove();
    this.actionOverlay = null;
  }

  destroy(): void {
    this.root.remove();
  }
}
