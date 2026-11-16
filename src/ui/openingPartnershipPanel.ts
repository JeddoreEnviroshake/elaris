import type { GameState } from '../simulation/state';
import { uiButton } from './controls';
import {characterPortrait} from './portraits';

/**
 * The one dialog left in the Tuftle introduction: naming the new partner.
 * Taming itself happens in the world, from the hotbar — a berry, then a
 * snare — exactly as it does for every other creature, so the tutorial
 * teaches the real controls instead of a menu that never appears again.
 */
export class OpeningPartnershipPanel {
  private readonly root = document.createElement('div');
  private readonly card = document.createElement('section');
  private readonly heading = document.createElement('h2');
  private readonly description = document.createElement('p');
  private readonly feedback = document.createElement('p');
  private readonly nameForm = document.createElement('form');
  private readonly nameInput = document.createElement('input');
  private readonly closeButton: HTMLButtonElement;
  private previousFocus: HTMLElement | null = null;
  private openState = false;

  constructor(parent: HTMLElement, private readonly state: GameState, private readonly callbacks: {
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
    this.card.classList.add('elaris-surface');
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-modal', 'true');
    this.card.setAttribute('aria-labelledby', 'opening-partnership-title');
    this.card.dataset.testid = 'opening-partnership';
    this.heading.id = 'opening-partnership-title';
    this.heading.textContent = 'A new friend';
    Object.assign(this.heading.style, { fontSize: '22px', margin: '0 0 10px' });
    this.description.textContent = 'Your Tuftle has joined the roster and is following you. Choose a name, or keep Tuftle for now.';
    this.feedback.setAttribute('role', 'status');
    this.feedback.dataset.testid = 'opening-response';
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
    this.closeButton = uiButton('Keep Tuftle', () => this.close());
    Object.assign(this.closeButton.style, { minHeight: '44px', marginTop: '12px', width: '100%' });
    const portrait=characterPortrait('tuftle',84);portrait.classList.add('elaris-trust-portrait');
    this.card.append(portrait, this.heading, this.description, this.feedback, this.nameForm, this.closeButton);
    this.root.append(this.card);
    parent.append(this.root);
    this.root.addEventListener('pointerdown', (event) => event.stopPropagation());
    // Capture at the window before Phaser's keyboard handlers. Keep native button/input behavior.
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  get isOpen(): boolean { return this.openState; }

  openName(): void {
    if (!this.openState) this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.openState = true;
    this.nameInput.value = this.state.ownedCreatures.find((creature) => creature.id === this.state.onboarding.companionId)?.name ?? 'Tuftle';
    this.feedback.textContent = '';
    this.root.style.display = 'flex';
    this.nameInput.focus();
  }

  refresh(message?: string): void {
    if (message) this.feedback.textContent = message;
  }

  close(): void {
    this.openState = false;
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
