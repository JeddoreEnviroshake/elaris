import {
  BUILDABLES,
  buildableLockedReason,
  costText,
  describeBuildable,
  missingCost,
  type BuildableId,
  type PlacementCheck,
} from '../scenes/buildPlacement';
import type { GameState } from '../simulation/state';
import { RAIL_BOTTOMS, div, railButton, uiButton, wireDisclosure } from './controls';
import type { InventoryPanel } from './inventoryPanel';

export interface BuildMenuActions {
  /** A palette entry was chosen; the scene spawns the placement ghost. */
  onStartPlacing: (id: BuildableId) => void;
  /** The Place button was pressed; the scene confirms at the ghost tile. */
  onConfirm: () => void;
  /** Placement was cancelled from the UI; the scene removes the ghost. */
  onPlacingCancelled: () => void;
  /** The palette opened; the scene closes competing panels (craft). */
  onOpened: () => void;
}

export type BuildMenuMode = 'closed' | 'palette' | 'placing';

/**
 * DOM side of build mode: a Build toggle, the structure palette, and the
 * placement action bar (hint + Place/Cancel). Touch-first: every control is a
 * 48px target, and Place is an explicit tap so fat-fingering the world never
 * commits a structure. Desktop can also click the ground directly.
 */
export class BuildMenu {
  private readonly root: HTMLDivElement;
  private readonly buildButton: HTMLButtonElement;
  private readonly palette: HTMLDivElement;
  private readonly entries = new Map<BuildableId, HTMLButtonElement>();
  private readonly entryDetails = new Map<BuildableId, HTMLDivElement>();
  private readonly actionBar: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly placeButton: HTMLButtonElement;
  private currentMode: BuildMenuMode = 'closed';

  constructor(
    parent: HTMLElement,
    private readonly state: GameState,
    private readonly actions: BuildMenuActions,
  ) {
    this.root = div({ position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '12' });

    this.buildButton = railButton('🧱', 'Build', () => this.toggle());
    this.buildButton.style.bottom = RAIL_BOTTOMS.build;

    this.palette = div({
      position: 'absolute',
      right: 'calc(env(safe-area-inset-right) + 94px)',
      bottom: 'calc(env(safe-area-inset-bottom) + 94px)',
      width: 'min(280px, calc(100vw - 120px))',
      maxHeight: '46vh',
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
    this.palette.setAttribute('aria-label', 'Build palette');
    wireDisclosure(this.buildButton, this.palette, 'build-palette');
    const heading = document.createElement('strong');
    heading.textContent = 'Build';
    this.palette.appendChild(heading);
    for (const def of BUILDABLES) {
      const entry = uiButton(def.displayName, () => this.select(def.id));
      Object.assign(entry.style, {
        display: 'block',
        width: '100%',
        marginTop: '10px',
        textAlign: 'left',
        background: 'rgba(30,48,37,0.94)',
        touchAction: 'pan-y',
      });
      entry.textContent = '';
      const title = div({ display: 'flex', justifyContent: 'space-between', gap: '10px' });
      const name = document.createElement('strong');
      name.textContent = def.displayName;
      const cost = document.createElement('span');
      cost.textContent = costText(def.cost);
      cost.style.opacity = '0.85';
      title.append(name, cost);
      const detail = div({ marginTop: '3px', opacity: '0.72', fontSize: '12px' });
      detail.textContent = describeBuildable(def.id);
      entry.append(title, detail);
      this.entries.set(def.id, entry);
      this.entryDetails.set(def.id, detail);
      this.palette.appendChild(entry);
    }

    this.actionBar = div({
      position: 'absolute',
      left: '50%',
      bottom: 'calc(env(safe-area-inset-bottom) + 64px)',
      transform: 'translateX(-50%)',
      display: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '8px',
      pointerEvents: 'none',
    });
    this.hint = div({
      padding: '5px 10px',
      borderRadius: '8px',
      background: 'rgba(9,20,14,0.85)',
      font: '12px system-ui, sans-serif',
      whiteSpace: 'nowrap',
    });
    const buttons = div({ display: 'flex', gap: '10px' });
    // Cancel returns to the palette (which tears down the ghost via onOpened path).
    const cancel = uiButton('Cancel', () => this.openPalette());
    cancel.style.background = 'rgba(30,48,37,0.94)';
    this.placeButton = uiButton('Place', actions.onConfirm);
    Object.assign(this.placeButton.style, { minWidth: '96px', fontWeight: '700' });
    buttons.append(cancel, this.placeButton);
    this.actionBar.append(this.hint, buttons);

    this.root.append(this.buildButton, this.palette, this.actionBar);
    parent.appendChild(this.root);
  }

  get mode(): BuildMenuMode {
    return this.currentMode;
  }

  /** Move the palette into the shared gameplay menu; placement controls remain in-world. */
  attachToMenu(menu: InventoryPanel): void {
    this.buildButton.remove();
    menu.registerTab('build', 'Build', this.palette, () => this.openEmbeddedPalette());
  }

  private openEmbeddedPalette(): void {
    if (this.currentMode === 'placing') this.actions.onPlacingCancelled();
    this.currentMode = 'palette';
    this.refreshAffordability();
    this.palette.style.display = 'block';
    this.actionBar.style.display = 'none';
  }

  /** Build button / B key: closed → palette; anything open → fully closed. */
  toggle(): void {
    if (this.currentMode === 'closed') this.openPalette();
    else this.close();
  }

  openPalette(): void {
    if (this.currentMode === 'placing') this.actions.onPlacingCancelled();
    this.currentMode = 'palette';
    this.refreshAffordability();
    this.palette.style.display = 'block';
    this.actionBar.style.display = 'none';
    this.buildButton.setAttribute('aria-expanded', 'true');
    this.actions.onOpened();
  }

  /** Esc / toggle-off: leave build mode entirely, cancelling any ghost. */
  close(): void {
    if (this.currentMode === 'placing') this.actions.onPlacingCancelled();
    this.currentMode = 'closed';
    this.palette.style.display = 'none';
    this.actionBar.style.display = 'none';
    this.buildButton.setAttribute('aria-expanded', 'false');
  }

  /** Reflect ghost validity on the Place button and hint line. */
  setValidity(check: PlacementCheck): void {
    this.placeButton.disabled = !check.ok;
    if (check.ok) {
      this.hint.textContent = 'Tap or click the ground to position · Place or E to confirm';
      this.hint.style.color = '#e8f0ea';
    } else {
      this.hint.textContent = check.message;
      this.hint.style.color = '#ffd18a';
    }
  }

  /** Gray out undiscovered entries (with the unlock hint) and unaffordable ones. */
  refreshAffordability(): void {
    for (const def of BUILDABLES) {
      const entry = this.entries.get(def.id);
      const detail = this.entryDetails.get(def.id);
      if (!entry || !detail) continue;
      const locked = buildableLockedReason(this.state, def.id);
      entry.disabled = locked !== null || missingCost(this.state, def.cost) !== null;
      detail.textContent = locked ?? describeBuildable(def.id);
    }
  }

  private select(id: BuildableId): void {
    this.currentMode = 'placing';
    this.palette.style.display = 'none';
    // The disclosure tracks the palette itself, which placing mode hides.
    this.buildButton.setAttribute('aria-expanded', 'false');
    this.actionBar.style.display = 'flex';
    this.actions.onStartPlacing(id);
  }

  destroy(): void {
    this.root.remove();
  }
}
