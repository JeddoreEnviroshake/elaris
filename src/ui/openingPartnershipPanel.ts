import type { GameState } from '../simulation/state';
import { tamingActionPreview, tamingMoodLabel, type TamingAction } from '../simulation/taming';
import { uiButton } from './controls';
import { TAMING_MOOD_DRIFT } from '../config/balance';

const ACTION_LABELS: Record<TamingAction, string> = {
  steady: 'Stay steady', offer: 'Offer a berry', approach: 'Approach gently', 'back-off': 'Give it space',
};

/** A resumable view of the simulation-owned trust interaction; no rewards live here. */
export class OpeningPartnershipPanel {
  private readonly root = document.createElement('div');
  private readonly card = document.createElement('section');
  private readonly heading = document.createElement('h2');
  private readonly description = document.createElement('p');
  private readonly meters = document.createElement('p');
  private readonly feedback = document.createElement('p');
  private readonly actions = document.createElement('div');
  private readonly nameForm = document.createElement('form');
  private readonly nameInput = document.createElement('input');
  private readonly closeButton: HTMLButtonElement;
  private readonly actionButtons = new Map<TamingAction, HTMLButtonElement>();
  private previousFocus: HTMLElement | null = null;
  private mode: 'trust' | 'name' | null = null;

  constructor(parent: HTMLElement, private readonly state: GameState, private readonly callbacks: {
    onAction: (action: TamingAction) => void;
    onName: (name: string) => boolean;
    onClose: () => void;
  }) {
    Object.assign(this.root.style, {
      position: 'absolute', inset: '0', zIndex: '90', display: 'none', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(5,14,9,.75)', padding: '16px', boxSizing: 'border-box', pointerEvents: 'auto',
    });
    Object.assign(this.card.style, {
      width: 'min(440px,100%)', maxHeight: 'calc(100dvh - 32px)', overflowY: 'auto', boxSizing: 'border-box',
      padding: '20px', border: '2px solid #8eaa75', borderRadius: '10px', background: '#172c20',
      color: '#f5ecd6', font: '15px system-ui,sans-serif', lineHeight: '1.45', boxShadow: '0 12px 40px #0008',
    });
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-labelledby', 'opening-partnership-title');
    this.card.dataset.testid = 'opening-partnership';
    this.heading.id = 'opening-partnership-title';
    Object.assign(this.heading.style, { fontSize: '22px', margin: '0 0 10px' });
    this.meters.setAttribute('role', 'status');
    this.meters.setAttribute('aria-live', 'polite');
    this.feedback.setAttribute('role', 'status');
    this.feedback.dataset.testid = 'opening-response';
    Object.assign(this.actions.style, { display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '10px' });
    for (const action of Object.keys(ACTION_LABELS) as TamingAction[]) {
      const button = uiButton(ACTION_LABELS[action], () => this.callbacks.onAction(action));
      button.style.minHeight = '68px';
      button.style.whiteSpace = 'pre-line';
      button.setAttribute('aria-label', ACTION_LABELS[action]);
      this.actionButtons.set(action, button);
      this.actions.append(button);
    }
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Your companion’s name';
    nameLabel.htmlFor = 'opening-companion-name';
    this.nameInput.id = nameLabel.htmlFor;
    this.nameInput.name = 'companion-name';
    this.nameInput.maxLength = 48;
    Object.assign(this.nameInput.style, { display: 'block', width: '100%', boxSizing: 'border-box', minHeight: '44px', margin: '8px 0', font: 'inherit' });
    const saveName = uiButton('Save name', () => this.nameForm.requestSubmit());
    saveName.type = 'button';
    saveName.style.minHeight = '44px';
    this.nameForm.append(nameLabel, this.nameInput, saveName);
    this.nameForm.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.callbacks.onName(this.nameInput.value)) this.close();
    });
    this.closeButton = uiButton('Continue later', () => this.close());
    Object.assign(this.closeButton.style, { minHeight: '44px', marginTop: '12px', width: '100%' });
    this.card.append(this.heading, this.description, this.meters, this.feedback, this.actions, this.nameForm, this.closeButton);
    this.root.append(this.card);
    parent.append(this.root);
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation());
    // Capture at the window before Phaser's keyboard handlers. Keep native button/input behavior.
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean { return this.mode !== null; }

  openTrust(): void { this.open('trust'); }
  openName(): void {
    this.nameInput.value = this.state.ownedCreatures.find((creature) => creature.id === this.state.onboarding.companionId)?.name ?? 'Tuftle';
    this.open('name');
  }

  private open(mode: 'trust' | 'name'): void {
    if (!this.isOpen) this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.mode = mode;
    this.root.style.display = 'flex';
    this.feedback.textContent = '';
    this.refresh();
    (mode === 'name' ? this.nameInput : this.actionButtons.get('steady'))?.focus();
  }

  refresh(message?: string): void {
    if (!this.mode) return;
    const trust = this.mode === 'trust';
    const session = this.state.onboarding.trustSession;
    this.heading.textContent = trust ? 'Earn the Tuftle’s trust' : 'A new friend';
    this.description.textContent = trust
      ? 'The roadside basket has berries to share. Stay steady when it is nervous; approach when it settles. You can always take a break and return.'
      : 'Your Tuftle has joined the roster and is following you. Choose a name, or keep Tuftle for now.';
    this.actions.style.display = trust ? 'grid' : 'none';
    this.nameForm.style.display = trust ? 'none' : 'block';
    this.meters.style.display = trust ? 'block' : 'none';
    this.closeButton.textContent = trust ? 'Continue later' : 'Keep Tuftle';
    if (message) this.feedback.textContent = message;
    if (session && trust) {
      this.meters.textContent = `${tamingMoodLabel(session.mood)} · Calm ${Math.floor(session.calmBps / 100)}% · Fear ${Math.floor(session.fearBps / 100)}% · ${session.beatsRemaining} actions left`;
      for (const [action, button] of this.actionButtons) {
        const preview = tamingActionPreview(session, action);
        const drift = TAMING_MOOD_DRIFT[session.mood];
        const meter = (value: number) => `${value >= 0 ? '+' : ''}${value / 100}%`;
        const delta = (current: number, change: number) => Math.max(0, Math.min(10_000, current + change)) - current;
        button.textContent = `${ACTION_LABELS[action]}\nCalm ${meter(delta(session.calmBps, preview.calmBps + drift.calmBps))} · Fear ${meter(delta(session.fearBps, preview.fearBps + drift.fearBps))}`;
      }
    }
  }

  close(): void {
    this.mode = null;
    this.root.style.display = 'none';
    this.previousFocus?.focus();
    this.callbacks.onClose();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.isOpen) return;
    event.stopImmediatePropagation();
    if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(this.card.querySelectorAll<HTMLElement>('button,input')).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.root.remove();
  }
}
