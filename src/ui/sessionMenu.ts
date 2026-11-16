import type { LocalWorld } from '../persistence/localWorlds';
import { uiButton } from './controls';
import { createUiIcon } from './icons';

export interface SessionMenuActions {
  onContinue: (world: LocalWorld) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onRetry: () => Promise<void>;
}

/** The menu owns focus until a world has loaded successfully. */
export class SessionMenu {
  private readonly root = document.createElement('main');
  private readonly list = document.createElement('div');
  private readonly message = document.createElement('p');
  private readonly form = document.createElement('form');
  private readonly name = document.createElement('input');
  private readonly newGame: HTMLButtonElement;
  private readonly retry: HTMLButtonElement;
  private busy = false;

  constructor(parent: HTMLElement, private readonly actions: SessionMenuActions) {
    const style = document.createElement('style');
    style.textContent = `
.elaris-session { position:absolute; inset:0; z-index:60; overflow:auto; touch-action:pan-y; box-sizing:border-box; padding:max(24px, env(safe-area-inset-top)) max(18px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(18px, env(safe-area-inset-left)); background:radial-gradient(ellipse at 20% 0%, #304b3a, transparent 65%), #0e1b15; color:var(--elaris-ink); }
.elaris-session-inner { width:min(100%, 640px); margin:auto; padding:clamp(8px, 5vh, 64px) 0; }
.elaris-session-brand { display:flex; align-items:center; gap:18px; margin-bottom:28px; }
.elaris-session-brand svg { color:var(--elaris-accent); flex-shrink:0; }
.elaris-session h1 { margin:0; font:clamp(38px, 9vw, 60px) var(--elaris-font-display); letter-spacing:.07em; color:#e9d5a0; }
.elaris-session p { line-height:1.6; color:var(--elaris-ink-muted); }
.elaris-session h2 { font:22px var(--elaris-font-display); color:#e9d5a0; margin:0 0 16px; }
.elaris-session-card { padding:clamp(18px,4vw,28px); margin-bottom:18px; border:1px solid #6b7954; border-top:3px solid #b69550; border-radius:8px; background:#18281fee; box-shadow:0 12px 32px #0004; }
.elaris-world-list { display:grid; gap:12px; }
.elaris-world-list button { text-align:left; width:100%; display:grid; gap:6px; padding:16px; white-space:normal; overflow-wrap:anywhere; }
.elaris-world-list strong { font:20px var(--elaris-font-display); }
.elaris-world-list small { font-size:12px; color:#c1cdbb; line-height:1.5; }
.elaris-session-actions { display:flex; gap:12px; flex-wrap:wrap; }
.elaris-session-actions button { flex:1; }
.elaris-session-form { margin-top:20px; }
.elaris-session label { display:block; margin-bottom:8px; }
.elaris-session input { box-sizing:border-box; width:100%; min-height:48px; padding:12px; margin-bottom:14px; background:#0d1913; border:1px solid #8da27d; border-radius:4px; color:#f5ecd6; font:16px var(--elaris-font-body); }
.elaris-session input:focus-visible { outline:3px solid var(--elaris-accent); outline-offset:2px; }
.elaris-session [role=alert] { color:#ffd0b3; }
.elaris-session-note { font-size:13px; text-align:center; }
`;
    this.root.className = 'elaris-session';
    this.root.style.display = 'none';
    this.root.dataset.sessionMenu = '';
    this.root.setAttribute('aria-label', 'World menu');
    const inner = document.createElement('div'); inner.className = 'elaris-session-inner';
    const brand = document.createElement('header'); brand.className = 'elaris-session-brand';
    const title = document.createElement('div');
    const heading = document.createElement('h1'); heading.textContent = 'Elaris';
    const tagline = document.createElement('p'); tagline.textContent = 'A world to wander. A place to belong.';
    title.append(heading, tagline); brand.append(createUiIcon('crest', 60), title);
    const card = document.createElement('section'); card.className = 'elaris-session-card';
    const continueHeading = document.createElement('h2'); continueHeading.textContent = 'Continue';
    this.list.className = 'elaris-world-list';
    this.list.setAttribute('aria-label', 'Your local worlds');
    card.append(continueHeading, this.list);
    const choices = document.createElement('section'); choices.className = 'elaris-session-card';
    const buttons = document.createElement('div'); buttons.className = 'elaris-session-actions';
    this.newGame = uiButton('New Game', () => {
      this.form.hidden = false; this.message.textContent = ''; this.name.focus();
    });
    const join = uiButton('Join Game', () => {
      this.form.hidden = true;
      this.message.setAttribute('role', 'status');
      this.message.textContent = 'Online play is not available yet. Create or continue a local world to play offline.';
    });
    buttons.append(this.newGame, join);
    this.form.hidden = true; this.form.className = 'elaris-session-form';
    const label = document.createElement('label'); label.htmlFor = 'local-world-name'; label.textContent = 'World name';
    this.name.id = 'local-world-name'; this.name.name = 'worldName'; this.name.required = true; this.name.maxLength = 64;
    this.name.autocomplete = 'off'; this.name.placeholder = 'My woodland home';
    const formActions = document.createElement('div'); formActions.className = 'elaris-session-actions';
    const create = uiButton('Create world', () => {}); create.type = 'submit';
    const cancel = uiButton('Cancel', () => { this.form.hidden = true; this.newGame.focus(); }); cancel.type = 'button';
    formActions.append(create, cancel); this.form.append(label, this.name, formActions);
    this.form.addEventListener('submit', event => {
      event.preventDefault();
      void this.run(() => this.actions.onCreate(this.name.value));
    });
    this.message.setAttribute('role', 'status'); this.message.setAttribute('aria-live', 'polite');
    this.retry = uiButton('Try again', () => { void this.run(() => this.actions.onRetry()); });
    this.retry.hidden = true;
    choices.append(buttons, this.form, this.message, this.retry);
    const note = document.createElement('p'); note.className = 'elaris-session-note';
    note.textContent = 'Local worlds are saved on this device and playable offline. Export a save to keep a portable copy.';
    inner.append(brand, card, choices, note); this.root.append(style, inner); parent.append(this.root);
  }

  show(worlds: readonly LocalWorld[], error?: string): void {
    this.list.replaceChildren();
    for (const world of worlds) {
      const button = uiButton('', () => { void this.run(() => this.actions.onContinue(world)); });
      button.setAttribute('aria-label', `Continue ${world.name}`);
      const name = document.createElement('strong'); name.textContent = world.name;
      const detail = document.createElement('small');
      detail.textContent = `Yours · 1 member · Local · Last played ${new Date(world.lastPlayedAt).toLocaleString()}`;
      button.append(name, detail); this.list.append(button);
    }
    if (!worlds.length) {
      const empty = document.createElement('p'); empty.textContent = 'Your next adventure starts here. Create your first world below.';
      this.list.append(empty);
    }
    this.form.hidden = true; this.name.value = '';
    this.message.textContent = error ?? '';
    this.message.setAttribute('role', error ? 'alert' : 'status');
    this.retry.hidden = !error;
    this.root.style.display = 'block';
    this.root.querySelector<HTMLButtonElement>('button')?.focus();
  }

  hide(): void { this.root.style.display = 'none'; }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true; this.root.setAttribute('aria-busy', 'true');
    for (const control of this.root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) control.disabled = true;
    this.message.textContent = 'Loading…'; this.message.setAttribute('role', 'status');
    try { await action(); }
    catch (error) {
      this.message.setAttribute('role', 'alert');
      this.message.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      this.busy = false; this.root.removeAttribute('aria-busy');
      for (const control of this.root.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button')) control.disabled = false;
    }
  }
}
