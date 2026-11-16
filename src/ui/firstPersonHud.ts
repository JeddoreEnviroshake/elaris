import type { FirstPersonView } from '../three/firstPersonView';
import { RAIL_BOTTOMS, railButton, uiButton } from './controls';

/**
 * The first-person view's own HUD: the rail toggle, a fixed crosshair dot, the
 * name of whatever is under it, and the second action button (inspect/repair
 * a building), which only exists in first person because world long-press does
 * not.
 *
 * The crosshair never moves. It is the stable reference point a motion-prone
 * player's eye can rest on while the world turns around it.
 */
export class FirstPersonHud {
  private readonly toggleButton: HTMLButtonElement;
  private readonly crosshair: HTMLDivElement;
  private readonly targetLabel: HTMLDivElement;
  private readonly targetName: HTMLDivElement;
  private readonly healthRow: HTMLDivElement;
  private readonly healthFill: HTMLDivElement;
  private readonly healthText: HTMLSpanElement;
  private readonly secondaryButton: HTMLButtonElement;
  private secondaryAction: (() => void) | null = null;
  private readonly unsubscribe: () => void;

  constructor(parent: HTMLElement, private readonly view: FirstPersonView, onToggle: () => void) {
    this.toggleButton = railButton('compass', 'First person', () => {
      view.toggle();
      onToggle();
    });
    this.toggleButton.dataset.viewToggle = '';
    this.toggleButton.style.bottom = RAIL_BOTTOMS.view;
    parent.appendChild(this.toggleButton);

    this.crosshair = document.createElement('div');
    this.crosshair.dataset.firstPersonCrosshair = '';
    this.crosshair.setAttribute('aria-hidden', 'true');
    Object.assign(this.crosshair.style, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '6px',
      height: '6px',
      margin: '-3px 0 0 -3px',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.92)',
      boxShadow: '0 0 0 1.5px rgba(20,30,24,0.65)',
      pointerEvents: 'none',
      zIndex: '9',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.crosshair);

    this.targetLabel = document.createElement('div');
    this.targetLabel.dataset.firstPersonTarget = '';
    this.targetLabel.setAttribute('role', 'status');
    Object.assign(this.targetLabel.style, {
      position: 'absolute',
      left: '50%',
      top: 'calc(50% + 14px)',
      transform: 'translateX(-50%)',
      padding: '3px 8px',
      borderRadius: '6px',
      background: 'rgba(20,30,24,0.72)',
      color: '#f5ecd6',
      font: '600 12px system-ui, sans-serif',
      whiteSpace: 'nowrap',
      textAlign: 'center',
      pointerEvents: 'none',
      zIndex: '9',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    this.targetName = document.createElement('div');
    this.targetLabel.appendChild(this.targetName);
    // Health sits under the name once the target has been hit, so the player
    // sees each strike land without looking away from the crosshair.
    this.healthRow = document.createElement('div');
    this.healthRow.dataset.firstPersonTargetHealth = '';
    Object.assign(this.healthRow.style, {
      display: 'none', alignItems: 'center', gap: '6px', marginTop: '3px',
      font: '600 10px system-ui, sans-serif',
    } satisfies Partial<CSSStyleDeclaration>);
    const track = document.createElement('div');
    Object.assign(track.style, {
      width: '64px', height: '5px', borderRadius: '3px', overflow: 'hidden',
      background: 'rgba(255,255,255,0.18)',
    } satisfies Partial<CSSStyleDeclaration>);
    this.healthFill = document.createElement('div');
    Object.assign(this.healthFill.style, { height: '100%', width: '100%', background: '#7fd37a' } satisfies Partial<CSSStyleDeclaration>);
    track.appendChild(this.healthFill);
    this.healthText = document.createElement('span');
    this.healthRow.append(track, this.healthText);
    this.targetLabel.appendChild(this.healthRow);
    parent.appendChild(this.targetLabel);

    this.secondaryButton = uiButton('Inspect', () => this.secondaryAction?.());
    this.secondaryButton.dataset.firstPersonSecondary = '';
    Object.assign(this.secondaryButton.style, {
      position: 'absolute',
      right: 'calc(env(safe-area-inset-right) + 96px)',
      bottom: 'calc(env(safe-area-inset-bottom) + 40px)',
      minWidth: '72px',
      zIndex: '11',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.secondaryButton);

    this.unsubscribe = view.onChange(() => this.syncToggle());
    this.syncToggle();
  }

  /** Show or hide the first-person furniture; called every frame by WorldScene. */
  update(
    active: boolean,
    targetName: string | null,
    secondary: { label: string; run: () => void } | null,
    health: { hp: number; maxHp: number } | null = null,
  ): void {
    this.crosshair.style.display = active ? 'block' : 'none';
    const label = active ? targetName : null;
    if (this.targetName.textContent !== (label ?? '')) this.targetName.textContent = label ?? '';
    this.targetLabel.style.display = label ? 'block' : 'none';
    const showHealth = label !== null && health !== null && health.maxHp > 0;
    this.healthRow.style.display = showHealth ? 'flex' : 'none';
    if (showHealth) {
      const hp = Math.max(0, Math.min(health.hp, health.maxHp));
      const ratio = hp / health.maxHp;
      const width = `${Math.round(ratio * 100)}%`;
      if (this.healthFill.style.width !== width) this.healthFill.style.width = width;
      this.healthFill.style.background = ratio > 0.5 ? '#7fd37a' : ratio > 0.25 ? '#e8c35a' : '#e06a5a';
      const text = `${Math.ceil(hp)}/${health.maxHp}`;
      if (this.healthText.textContent !== text) this.healthText.textContent = text;
    }
    const showSecondary = active && secondary !== null;
    this.secondaryAction = showSecondary ? secondary.run : null;
    if (showSecondary && this.secondaryButton.textContent !== secondary.label) {
      this.secondaryButton.textContent = secondary.label;
      this.secondaryButton.setAttribute('aria-label', secondary.label);
    }
    this.secondaryButton.style.display = showSecondary ? 'block' : 'none';
  }

  private syncToggle(): void {
    const firstPerson = this.view.requested === 'first-person';
    this.toggleButton.setAttribute('aria-pressed', String(firstPerson));
    const text = this.toggleButton.lastElementChild;
    if (text) text.textContent = firstPerson ? 'Overhead' : 'First person';
  }

  destroy(): void {
    this.unsubscribe();
    this.toggleButton.remove();
    this.crosshair.remove();
    this.targetLabel.remove();
    this.secondaryButton.remove();
  }
}
