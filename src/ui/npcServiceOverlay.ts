import type { TownBuildingDefinition } from '../content/townBuildings';
import { npcDefinition } from '../content/npcs';
import type { GameState } from '../simulation/state';
import type { CommandResult } from '../simulation/gameplayCommands';
import { div, uiButton } from './controls';
import { NpcServiceActions } from './npcServiceActions';

export interface NpcServiceOverlayOpenOptions {
  readonly closeLabel?: string;
  readonly closeAriaLabel?: string;
  readonly closeHint?: string;
}

/** Focused service surface shown over the still-rendered playable room. */
export class NpcServiceOverlay {
  readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly portrait: HTMLDivElement;
  private readonly buildingName: HTMLDivElement;
  private readonly name: HTMLHeadingElement;
  private readonly title: HTMLDivElement;
  private readonly summary: HTMLParagraphElement;
  private readonly leaveButton: HTMLButtonElement;
  private readonly hint: HTMLDivElement;
  private readonly serviceActions: NpcServiceActions;
  private currentBuilding: TownBuildingDefinition | null = null;
  private previouslyFocused: HTMLElement | null = null;

  constructor(
    parent: HTMLElement,
    state: GameState,
    onChanged: (result: CommandResult) => void,
    private readonly onClose: (building: TownBuildingDefinition) => void,
  ) {
    this.root = div({
      position: 'fixed', inset: '0', zIndex: '42', display: 'none', placeItems: 'center',
      padding: 'max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left))',
      color: 'var(--town-ink)', background: 'rgba(5, 8, 7, .66)', pointerEvents: 'auto',
      font: '14px/1.5 system-ui, sans-serif', isolation: 'isolate',
    });
    this.root.dataset.testid = 'npc-service-overlay';
    this.root.dataset.uiPanel = 'npc-service-overlay';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');

    this.panel = div({
      width: 'min(920px, 100%)', maxHeight: 'min(820px, 100%)', overflowY: 'auto', overscrollBehavior: 'contain',
      padding: 'clamp(14px, 3vw, 26px)', borderRadius: '16px',
      background: 'linear-gradient(145deg, color-mix(in srgb, var(--town-surface) 94%, black), var(--town-bg))',
      border: '2px solid var(--town-accent)', boxShadow: '0 24px 80px rgba(0,0,0,.62)',
    });
    const header = div({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '14px' });
    const identity = div({ display: 'grid', gridTemplateColumns: '60px minmax(0, 1fr)', alignItems: 'center', gap: '12px', minWidth: '0' });
    this.portrait = div({
      width: '56px', height: '56px', display: 'grid', placeItems: 'center', borderRadius: '50%',
      color: 'var(--town-bg)', background: 'var(--town-accent)', border: '3px solid var(--town-glow)',
      fontSize: '24px', fontWeight: '900',
    });
    const identityCopy = div({ minWidth: '0' });
    this.buildingName = div({ color: 'var(--town-accent)', fontSize: '11px', fontWeight: '800', letterSpacing: '.12em', textTransform: 'uppercase' });
    this.name = document.createElement('h1');
    Object.assign(this.name.style, { margin: '1px 0 0', font: '800 clamp(22px, 4vw, 32px)/1.1 system-ui, sans-serif' });
    this.title = div({ opacity: '.76', fontSize: '13px' });
    identityCopy.append(this.buildingName, this.name, this.title);
    identity.append(this.portrait, identityCopy);
    this.leaveButton = uiButton('Back', () => this.close());
    this.leaveButton.style.flex = '0 0 auto';
    header.append(identity, this.leaveButton);

    this.summary = document.createElement('p');
    Object.assign(this.summary.style, { margin: '14px 0', paddingBottom: '12px', borderBottom: '1px solid color-mix(in srgb, var(--town-accent) 35%, transparent)', opacity: '.86' });
    this.summary.id = 'npc-service-summary';
    this.serviceActions = new NpcServiceActions(state, onChanged);
    this.hint = div({ marginTop: '12px', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', opacity: '.68', fontSize: '12px' });
    this.hint.id = 'npc-service-hint';
    this.panel.append(header, this.summary, this.serviceActions.root, this.hint);
    this.root.append(this.panel);
    this.root.setAttribute('aria-describedby', `${this.summary.id} ${this.hint.id}`);
    parent.append(this.root);
    document.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean { return this.currentBuilding !== null; }

  open(building: TownBuildingDefinition, options: NpcServiceOverlayOpenOptions = {}): void {
    const npc = npcDefinition(building.npcId);
    if (npc.service !== building.service) throw new Error(`${building.id} service does not match ${npc.id}`);
    this.currentBuilding = building;
    this.previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const palette = building.interiorTheme;
    this.root.style.setProperty('--town-bg', palette.background);
    this.root.style.setProperty('--town-surface', palette.surface);
    this.root.style.setProperty('--town-accent', palette.accent);
    this.root.style.setProperty('--town-glow', palette.glow);
    this.root.style.setProperty('--town-ink', palette.ink);
    this.root.dataset.theme = palette.id;
    this.root.dataset.interiorId = building.interiorId;
    this.root.setAttribute('aria-label', `${building.displayName} service`);
    this.portrait.textContent = npc.name[0] ?? '';
    this.buildingName.textContent = building.displayName;
    this.name.textContent = npc.name;
    this.title.textContent = `${npc.title} · ${npc.serviceLabel}`;
    this.summary.textContent = npc.summary;
    this.leaveButton.textContent = options.closeLabel ?? 'Back';
    this.leaveButton.setAttribute('aria-label', options.closeAriaLabel ?? 'Return to room');
    this.hint.textContent = options.closeHint ?? 'Press Escape or choose Back to continue exploring';
    this.serviceActions.show(npc.service);
    this.root.style.display = 'grid';
    this.panel.scrollTop = 0;
    this.leaveButton.focus({ preventScroll: true });
  }

  close(): void {
    const building = this.currentBuilding;
    if (!building) return;
    this.currentBuilding = null;
    this.root.style.display = 'none';
    this.onClose(building);
    this.previouslyFocused?.focus({ preventScroll: true });
    this.previouslyFocused = null;
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKeyDown, true);
    this.root.remove();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...this.root.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.offsetParent !== null || element === document.activeElement);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable.at(-1)!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
}
