import type { DialogueView } from '../presentation/npcDialogue';
import { div, uiButton } from './controls';

export interface NpcDialogueCallbacks {
  readonly onChoice: (choiceId: string) => void;
  readonly onClose: () => void;
}

/** Compact lower-screen conversation surface shared by 2D and 3D interiors. */
export class NpcDialogue {
  readonly root: HTMLDivElement;
  private readonly portrait: HTMLDivElement;
  private readonly name: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly line: HTMLDivElement;
  private readonly choices: HTMLDivElement;
  private view: DialogueView | null = null;
  private revealedCharacters = 0;
  private revealTimer: number | null = null;
  private readonly reducedMotion: boolean;

  constructor(parent: HTMLElement, private readonly callbacks: NpcDialogueCallbacks) {
    this.reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.root = div({
      position: 'fixed', left: 'max(10px, env(safe-area-inset-left))', right: 'max(10px, env(safe-area-inset-right))',
      bottom: 'max(10px, env(safe-area-inset-bottom))', zIndex: '41', display: 'none',
      maxWidth: '820px', margin: '0 auto', padding: '14px', borderRadius: '16px',
      color: '#fff4dc', background: 'linear-gradient(145deg, rgba(35,25,22,.97), rgba(17,21,27,.98))',
      border: '1px solid rgba(255,190,105,.42)', boxShadow: '0 18px 48px rgba(0,0,0,.55)',
      gridTemplateColumns: '64px minmax(0, 1fr)', gap: '12px', pointerEvents: 'auto',
    });
    this.root.dataset.uiPanel = 'npc-dialogue';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'NPC conversation');
    this.root.tabIndex = -1;
    this.portrait = div({
      width: '58px', height: '58px', borderRadius: '50%', display: 'grid', placeItems: 'center',
      fontSize: '23px', fontWeight: '850', border: '2px solid #ffb24d', background: '#8f3d32',
      boxShadow: 'inset 0 0 0 3px rgba(0,0,0,.2)',
    });
    const body = div({ minWidth: '0' });
    const identity = div({ display: 'flex', gap: '7px', alignItems: 'baseline', flexWrap: 'wrap' });
    this.name = div({ fontWeight: '850', fontSize: '17px' });
    this.title = div({ opacity: '.68', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.08em' });
    identity.append(this.name, this.title);
    this.line = div({ marginTop: '6px', minHeight: '42px', lineHeight: '1.45', fontSize: '15px' });
    this.line.setAttribute('aria-live', 'polite');
    this.line.addEventListener('click', () => this.revealNow());
    this.choices = div({ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px', marginTop: '12px' });
    body.append(identity, this.line, this.choices);
    this.root.append(this.portrait, body);
    parent.append(this.root);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  open(view: DialogueView): void {
    this.view = view;
    this.root.style.display = 'grid';
    this.renderIdentity(view);
    this.startReveal();
    this.root.focus({ preventScroll: true });
  }

  update(view: DialogueView): void {
    this.view = view;
    this.renderIdentity(view);
    this.startReveal();
  }

  close(): void {
    this.clearRevealTimer();
    this.view = null;
    this.root.style.display = 'none';
    this.choices.replaceChildren();
  }

  destroy(): void {
    this.close();
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.root.remove();
  }

  private renderIdentity(view: DialogueView): void {
    this.portrait.textContent = view.portraitInitials;
    this.portrait.style.background = view.portraitPrimary;
    this.portrait.style.borderColor = view.portraitAccent;
    this.name.textContent = view.npcName;
    this.title.textContent = view.npcTitle;
    this.root.setAttribute('aria-label', `Conversation with ${view.npcName}`);
    this.root.dataset.nodeId = view.nodeId;
  }

  private startReveal(): void {
    this.clearRevealTimer();
    this.revealedCharacters = this.reducedMotion ? (this.view?.text.length ?? 0) : 0;
    this.renderLine();
    if (this.reducedMotion) return;
    this.revealTimer = window.setInterval(() => {
      if (!this.view) return;
      this.revealedCharacters = Math.min(this.view.text.length, this.revealedCharacters + 2);
      this.renderLine();
      if (this.revealedCharacters >= this.view.text.length) this.clearRevealTimer();
    }, 18);
  }

  private renderLine(): void {
    if (!this.view) return;
    const complete = this.revealedCharacters >= this.view.text.length;
    this.line.textContent = this.view.text.slice(0, this.revealedCharacters);
    this.choices.replaceChildren();
    if (!complete) {
      const hint = div({ opacity: '.62', fontSize: '12px', minHeight: '44px', display: 'flex', alignItems: 'center' });
      hint.textContent = 'Enter, Space, or tap the dialogue to reveal';
      this.choices.append(hint);
      return;
    }
    this.view.choices.forEach((choice, index) => {
      const button = uiButton(`${index + 1}. ${choice.label}`, () => this.callbacks.onChoice(choice.id));
      button.dataset.choiceId = choice.id;
      button.style.minHeight = '44px';
      this.choices.append(button);
    });
    (this.choices.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }

  private revealNow(): boolean {
    if (!this.view || this.revealedCharacters >= this.view.text.length) return false;
    this.revealedCharacters = this.view.text.length;
    this.clearRevealTimer();
    this.renderLine();
    return true;
  }

  private clearRevealTimer(): void {
    if (this.revealTimer !== null) window.clearInterval(this.revealTimer);
    this.revealTimer = null;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.view) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); this.callbacks.onClose(); return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (this.revealNow()) { event.preventDefault(); event.stopPropagation(); }
      return;
    }
    const index = Number(event.key) - 1;
    const choice = this.view.choices[index];
    if (Number.isInteger(index) && choice && this.revealedCharacters >= this.view.text.length) {
      event.preventDefault(); event.stopPropagation(); this.callbacks.onChoice(choice.id);
    }
  };
}
