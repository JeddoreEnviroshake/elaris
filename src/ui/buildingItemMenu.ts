import { buildableById } from '../content/buildingParts';
import { demolitionRefund, isStructureDamaged, repairCost, structureHp, structureMaxHp } from '../simulation/gameplayCommands';
import type { BuildingState, GameState } from '../simulation/state';
import { canAffordCost, stockedCostText } from './costs';
import { div, uiButton } from './controls';

export interface BuildingItemMenuActions {
  /** Returns true when the selected building was deleted successfully. */
  onDelete: (buildingId: string) => boolean;
  /** Returns true when a damaged wall was repaired to full successfully. */
  onRepair: (buildingId: string) => boolean;
  /** Fired whenever the menu stops targeting a building, however it was dismissed. */
  onClosed: () => void;
}

/**
 * Small contextual menu for a placed part, raised by tapping a damaged wall.
 * Holding a part instead enters Delete mode (see BuildMenu.enterDeleteMode),
 * so this prompt's job is repair; Delete stays here as the local shortcut.
 */
export class BuildingItemMenu {
  private readonly panel: HTMLDivElement;
  private readonly title: HTMLElement;
  private readonly refund: HTMLDivElement;
  private readonly repairButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private selectedId: string | null = null;

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly actions: BuildingItemMenuActions,
  ) {
    this.panel = div({
      position: 'fixed',
      display: 'none',
      minWidth: '150px',
      padding: '10px',
      borderRadius: '12px',
      background: 'rgba(9,20,14,0.98)',
      border: '1px solid rgba(255,255,255,0.2)',
      boxShadow: '0 8px 28px rgba(0,0,0,0.48)',
      color: '#e8f0ea',
      font: '14px system-ui, sans-serif',
      pointerEvents: 'auto',
      zIndex: '1000001',
    });
    this.panel.setAttribute('role', 'menu');

    this.title = document.createElement('strong');
    Object.assign(this.title.style, { display: 'block', margin: '2px 4px 9px' });
    this.refund = div({
      margin: '0 4px 9px', color: '#a5f0bd', fontSize: '12px', whiteSpace: 'pre-line',
    });
    this.repairButton = uiButton('Repair', () => {
      if (this.selectedId && this.actions.onRepair(this.selectedId)) this.close();
    });
    this.repairButton.setAttribute('role', 'menuitem');
    this.repairButton.dataset['repairWall'] = '';
    Object.assign(this.repairButton.style, {
      width: '100%',
      marginBottom: '8px',
      color: '#09140e',
      background: '#a5f0bd',
      fontWeight: '700',
    });
    this.deleteButton = uiButton('Delete', () => {
      if (this.selectedId && this.actions.onDelete(this.selectedId)) this.close();
    });
    this.deleteButton.setAttribute('role', 'menuitem');
    Object.assign(this.deleteButton.style, {
      width: '100%',
      color: '#fff1f1',
      background: '#8b3434',
      fontWeight: '700',
    });
    this.panel.append(this.title, this.refund, this.repairButton, this.deleteButton);
    parent.appendChild(this.panel);

    document.addEventListener('pointerdown', this.onDocumentPointerDown, true);
    document.addEventListener('keydown', this.onKeyDown);
  }

  get isOpen(): boolean {
    return this.selectedId !== null;
  }

  open(building: BuildingState, clientX: number, clientY: number): void {
    const def = buildableById(building.definitionId);
    const name = def.displayName;
    this.selectedId = building.id;
    // A damaged wall leads with its health; everything else just names itself.
    this.title.textContent = isStructureDamaged(building)
      ? `${name} ${structureHp(building)}/${structureMaxHp(building)}`
      : name;
    // What demolition hands back: half the build materials, rounded down per material.
    this.refund.textContent = demolitionRefund(def)
      .map(([resource, amount]) => `+${amount} x ${resource}`)
      .join('\n');
    // Repair restores full health for half the price of building the wall again,
    // so it is priced and disabled the same way as a Craft or Build card.
    const repairable = isStructureDamaged(building);
    const cost = repairCost(def.cost);
    this.repairButton.style.display = repairable ? 'block' : 'none';
    this.repairButton.textContent = repairable
      ? `Repair (${stockedCostText(this.state, cost)})`
      : 'Repair';
    this.repairButton.disabled = repairable && !canAffordCost(this.state, cost);
    this.panel.setAttribute('aria-label', `${name} menu`);
    this.panel.style.display = 'block';

    // Keep the menu fully visible near screen and safe-area edges.
    const width = this.panel.offsetWidth;
    const height = this.panel.offsetHeight;
    const margin = 10;
    this.panel.style.left = `${Math.max(margin, Math.min(window.innerWidth - width - margin, clientX - width / 2))}px`;
    this.panel.style.top = `${Math.max(margin, Math.min(window.innerHeight - height - margin, clientY - height - 12))}px`;
    // A disabled Repair cannot take focus, so the menu opens on Delete instead.
    const initialFocus = repairable && !this.repairButton.disabled ? this.repairButton : this.deleteButton;
    initialFocus.focus({ preventScroll: true });
  }

  close(): void {
    const wasOpen = this.selectedId !== null;
    this.selectedId = null;
    this.panel.style.display = 'none';
    if (wasOpen) this.actions.onClosed();
  }

  private onDocumentPointerDown = (event: PointerEvent): void => {
    if (this.isOpen && !this.panel.contains(event.target as Node)) this.close();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.close();
  };

  destroy(): void {
    document.removeEventListener('pointerdown', this.onDocumentPointerDown, true);
    document.removeEventListener('keydown', this.onKeyDown);
    this.panel.remove();
  }
}
