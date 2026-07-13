import { INVENTORY_SLOTS, toolDefinition } from '../config/balance';
import { usedInventorySlots } from '../simulation/gameplayCommands';
import type { GameState } from '../simulation/state';
import { RAIL_BOTTOMS, div, railButton, uiButton, wireDisclosure } from './controls';
import { durabilityColor, inventorySlotEntries } from './inventorySlots';

export interface InventoryPanelActions {
  /** A tool cell was tapped; equipping stays explicit. */
  onEquipTool: (toolId: string) => void;
  /** The panel opened; the scene closes competing panels (craft/build). */
  onOpened: () => void;
}

export type MenuTabId = 'bag' | 'craft' | 'build' | 'quests' | 'creatures' | 'character';

interface MenuTab {
  button: HTMLButtonElement;
  content: HTMLElement;
  onActivate: (() => void) | undefined;
}

const TAB_ORDER: readonly MenuTabId[] = ['bag', 'craft', 'build', 'quests', 'creatures', 'character'];

/**
 * Shared gameplay menu: a Menu toggle plus a centered, tabbed panel whose Bag
 * tab contains the slot grid mirroring the
 * simulation's slot accounting — resource stacks, one cell per tool (with a
 * durability bar; tap to equip), and dimmed empties. Read-only against the
 * sim apart from the existing equip command; repair lives in the craft panel.
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

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly actions: InventoryPanelActions,
  ) {
    this.root = div({ position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '13' });

    this.menuButton = railButton('🎒', 'Menu', () => this.toggle());
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
      display: 'grid',
      gridTemplateColumns: 'repeat(6, minmax(0, 1fr))',
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

    this.bagContent.appendChild(this.grid);
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
    this.panel.style.display = 'none';
    this.menuButton.setAttribute('aria-expanded', 'false');
  }

  /** Add one of the existing gameplay panels to the shared menu popup. */
  registerTab(id: MenuTabId, label: string, content: HTMLElement, onActivate?: () => void): void {
    const button = uiButton(label, () => this.openTab(id));
    Object.assign(button.style, {
      minWidth: '0', minHeight: '42px', padding: '6px 3px', fontSize: '12px',
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
    next.onActivate?.();
  }

  /** Rebuild the grid from state; cheap at INVENTORY_SLOTS cells. */
  refresh(): void {
    if (!this.open) return;
    this.slotCount.textContent = `${usedInventorySlots(this.state)}/${INVENTORY_SLOTS} slots`;
    this.grid.textContent = '';
    for (const entry of inventorySlotEntries(this.state)) {
      if (entry.kind === 'resource') {
        const cell = this.cell('div');
        const name = div({ fontSize: '12px', fontWeight: '600', textTransform: 'capitalize' });
        name.textContent = entry.resource;
        const amount = div({ fontSize: '12px', opacity: '0.8' });
        amount.textContent = `×${entry.amount}`;
        cell.append(name, amount);
      } else if (entry.kind === 'tool') {
        const cell = this.cell('button') as HTMLButtonElement;
        const { tool, equipped } = entry;
        cell.style.borderColor = equipped ? '#ffe08a' : 'rgba(255,255,255,0.16)';
        cell.setAttribute('aria-pressed', equipped ? 'true' : 'false');
        cell.setAttribute(
          'aria-label',
          `${toolDefinition(tool.definitionId).displayName} ${tool.durability}/${tool.maxDurability}${equipped ? ', equipped' : ''}`,
        );
        cell.addEventListener('click', (event) => {
          event.stopPropagation();
          this.actions.onEquipTool(tool.instanceId);
        });
        const icon = div({ fontSize: '16px', lineHeight: '1' });
        icon.textContent = '⛏';
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

  destroy(): void {
    this.root.remove();
  }
}
